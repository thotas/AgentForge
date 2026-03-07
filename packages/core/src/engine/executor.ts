import { EventEmitter } from "events";
import { createAgent, BaseAgent } from "../agents";
import { AgentDefinition, AgentEvent, AgentResult, ExecutionPlan, PlannerBackend, Task } from "../types";
import { saveTask } from "../db";
import { writeAgentOutput } from "../output";
import { getAgentAttemptSequence } from "../models";

interface ExecutorOptions {
  lockSelectedModel?: boolean;
  lockedBackend?: PlannerBackend;
  lockedModel?: string;
}

export class Executor extends EventEmitter {
  private agents = new Map<string, BaseAgent>();
  private results = new Map<string, AgentResult>();
  private outputs = new Map<string, string>();
  private cancelled = false;
  private paused = false;
  private pauseWaiters = new Set<() => void>();

  constructor(private task: Task, private options?: ExecutorOptions) {
    super();
  }

  async execute(): Promise<AgentResult[]> {
    const plan = this.task.plan;
    if (!plan) throw new Error("No execution plan");

    this.task.status = "running";
    this.task.updatedAt = Date.now();
    saveTask(this.task);

    try {
      switch (plan.execution_order) {
        case "sequential":
          await this.executeSequential(plan);
          break;
        case "parallel":
          await this.executeParallel(plan);
          break;
        case "dag":
          await this.executeDag(plan);
          break;
      }

      const allResults = Array.from(this.results.values());
      const hasFailures = allResults.some((r) => r.status === "failed");
      const allSucceeded = allResults.length > 0 && allResults.every((r) => r.status === "success");
      const hasCancelled = this.cancelled || allResults.some((r) => r.status === "cancelled");
      this.task.status = hasCancelled ? "cancelled" : allSucceeded && !hasFailures ? "success" : "failed";
      this.task.results = allResults;
      this.task.updatedAt = Date.now();
      saveTask(this.task);

      return allResults;
    } catch (err) {
      this.task.status = this.cancelled ? "cancelled" : "failed";
      this.task.results = Array.from(this.results.values());
      this.task.updatedAt = Date.now();
      saveTask(this.task);
      throw err;
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.paused = false;
    for (const wake of this.pauseWaiters) {
      wake();
    }
    this.pauseWaiters.clear();

    for (const agent of this.agents.values()) {
      agent.cancel();
    }
  }

  pause(): void {
    if (this.cancelled || this.paused) return;
    this.paused = true;
  }

  resume(): void {
    if (this.cancelled || !this.paused) return;
    this.paused = false;
    for (const wake of this.pauseWaiters) {
      wake();
    }
    this.pauseWaiters.clear();
  }

  isPaused(): boolean {
    return this.paused;
  }

  private async waitIfPaused(): Promise<void> {
    while (this.paused && !this.cancelled) {
      await new Promise<void>((resolve) => {
        this.pauseWaiters.add(resolve);
      });
    }
  }

  private async executeSequential(plan: ExecutionPlan): Promise<void> {
    for (const def of plan.agents) {
      await this.waitIfPaused();
      if (this.cancelled) break;
      await this.runAgent(def);
    }
  }

  private async executeParallel(plan: ExecutionPlan): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const def of plan.agents) {
      await this.waitIfPaused();
      if (this.cancelled) break;
      promises.push(this.runAgent(def));
    }
    await Promise.all(promises);
  }

  private async executeDag(plan: ExecutionPlan): Promise<void> {
    const pending = new Set(plan.agents.map((a) => a.id));
    const running = new Set<string>();
    const completed = new Set<string>();
    const agentMap = new Map(plan.agents.map((a) => [a.id, a]));

    while (pending.size > 0 || running.size > 0) {
      await this.waitIfPaused();
      if (this.cancelled) break;

      // Find agents whose dependencies are all completed
      const ready: AgentDefinition[] = [];
      for (const id of pending) {
        const def = agentMap.get(id)!;
        const depsResolved = def.depends_on.every((dep) => completed.has(dep));
        if (depsResolved) ready.push(def);
      }

      if (ready.length === 0 && running.size === 0) {
        // Deadlock — remaining agents have unresolvable dependencies
        const remaining = Array.from(pending).join(", ");
        throw new Error(`DAG deadlock: agents [${remaining}] have unresolved dependencies`);
      }

      // Launch ready agents
      const promises: Promise<void>[] = [];
      for (const def of ready) {
        if (this.cancelled) break;
        pending.delete(def.id);
        running.add(def.id);
        promises.push(
          this.runAgent(def).then(() => {
            running.delete(def.id);
            completed.add(def.id);
          }),
        );
      }

      // Wait for at least one to complete before re-evaluating
      if (promises.length > 0) {
        await Promise.race(promises);
        // Small delay to let state settle before the next evaluation
        await new Promise((r) => setTimeout(r, 50));
      } else {
        // Wait for running agents
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  private async runAgent(definition: AgentDefinition): Promise<void> {
    if (this.cancelled) return;
    const candidateAttempts = getAgentAttemptSequence(definition, this.options);
    const attemptErrors: string[] = [];
    let finalResult: AgentResult | null = null;

    for (const [index, attempt] of candidateAttempts.entries()) {
      if (this.cancelled) break;

      const attemptDefinition: AgentDefinition = {
        ...definition,
        type: attempt.type,
        model: attempt.model,
        lockModelSelection: attempt.lockModelSelection,
      };

      if (index > 0) {
        this.emit("agentEvent", {
          type: "log",
          agentId: definition.id,
          taskId: this.task.id,
          timestamp: Date.now(),
          data: `\n[AgentForge] Agent fallback attempt ${index + 1}/${candidateAttempts.length}: switching to ${attempt.type}${attempt.model ? ` (${attempt.model})` : ""}\n`,
        });
      }

      const agent = createAgent(attemptDefinition, this.task.id);
      this.agents.set(definition.id, agent);

      agent.on("event", (event: AgentEvent) => {
        this.emit("agentEvent", event);
      });

      const result = await agent.execute(this.outputs);
      finalResult = result;

      if (result.status === "success" || result.status === "cancelled") {
        break;
      }

      attemptErrors.push(`${attempt.type}${attempt.model ? ` (${attempt.model})` : ""}: ${result.error || "unknown failure"}`);
    }

    if (!finalResult) {
      return;
    }

    if (finalResult.status === "failed" && attemptErrors.length > 0) {
      finalResult.error = `Agent fallback exhausted: ${attemptErrors.join(" | ")}`;
    }

    finalResult.outputPath = writeAgentOutput(this.task.id, definition.id, finalResult.output);
    this.results.set(definition.id, finalResult);

    if (finalResult.status === "success") {
      this.outputs.set(definition.id, finalResult.output);
    }
  }
}
