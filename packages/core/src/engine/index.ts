import { EventEmitter } from "events";
import { v4 as uuid } from "uuid";
import { Planner } from "../planner";
import { Executor } from "./executor";
import { loadConfig } from "../config";
import { saveTask, getTask, listTasks, getRunningTasks } from "../db";
import { AgentEvent, AgentForgeConfig, AgentResult, ExecutionPlan, PlannerBackend, Task } from "../types";

export interface RunOptions {
  prompt: string;
  plannerBackend?: PlannerBackend;
  plannerModel?: string;
  lockSelectedModel?: boolean;
  dryRun?: boolean;
  autoConfirm?: boolean;
}

export class Engine extends EventEmitter {
  private config: AgentForgeConfig;
  private planner: Planner;
  private activeExecutors = new Map<string, Executor>();

  constructor(configOverrides?: Partial<AgentForgeConfig>) {
    super();
    this.config = { ...loadConfig(), ...configOverrides };
    this.planner = new Planner(this.config);
  }

  getConfig(): AgentForgeConfig {
    return this.config;
  }

  async plan(
    prompt: string,
    backend?: PlannerBackend,
    model?: string,
    lockSelectedModel = false,
  ): Promise<{ task: Task; plan: ExecutionPlan }> {
    return this.planWithMetadata(prompt, backend, model, lockSelectedModel);
  }

  private async planWithMetadata(
    prompt: string,
    backend?: PlannerBackend,
    model?: string,
    lockSelectedModel = false,
    meta?: {
      parentTaskId?: string;
      rootTaskId?: string;
      continuationInstruction?: string;
    },
  ): Promise<{ task: Task; plan: ExecutionPlan }> {
    const task: Task = {
      id: uuid(),
      prompt,
      parentTaskId: meta?.parentTaskId,
      rootTaskId: meta?.rootTaskId,
      continuationInstruction: meta?.continuationInstruction,
      lockSelectedModel,
      lockedPlannerBackend: lockSelectedModel ? backend || this.config.planner : undefined,
      lockedPlannerModel: lockSelectedModel ? model : undefined,
      status: "planning",
      results: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      plannerModel: backend || this.config.planner,
      dryRun: false,
    };

    if (!task.rootTaskId) {
      task.rootTaskId = task.id;
    }

    saveTask(task);
    this.emit("taskCreated", task);

    const plan = await this.planner.generatePlan(prompt, backend, model, lockSelectedModel);
    task.plan = plan;
    task.updatedAt = Date.now();
    saveTask(task);

    this.emit("planReady", task, plan);
    return { task, plan };
  }

  async run(options: RunOptions): Promise<{ task: Task; results: AgentResult[] }> {
    const { task, plan } = await this.planWithMetadata(
      options.prompt,
      options.plannerBackend,
      options.plannerModel,
      options.lockSelectedModel,
    );

    if (options.dryRun) {
      task.status = "success";
      task.dryRun = true;
      task.updatedAt = Date.now();
      saveTask(task);
      return { task, results: [] };
    }

    const executor = new Executor(task, {
      lockSelectedModel: task.lockSelectedModel,
      lockedBackend: task.lockedPlannerBackend,
      lockedModel: task.lockedPlannerModel,
    });
    this.activeExecutors.set(task.id, executor);

    executor.on("agentEvent", (event: AgentEvent) => {
      this.emit("agentEvent", event);
    });

    try {
      this.updateTaskStatus(task.id, "running");
      const results = await executor.execute();
      return { task, results };
    } finally {
      this.activeExecutors.delete(task.id);
    }
  }

  async executeTask(task: Task): Promise<{ task: Task; results: AgentResult[] }> {
    if (!task.plan) throw new Error("Task has no execution plan");

    const executor = new Executor(task, {
      lockSelectedModel: task.lockSelectedModel,
      lockedBackend: task.lockedPlannerBackend,
      lockedModel: task.lockedPlannerModel,
    });
    this.activeExecutors.set(task.id, executor);

    executor.on("agentEvent", (event: AgentEvent) => {
      this.emit("agentEvent", event);
    });

    try {
      this.updateTaskStatus(task.id, "running");
      const results = await executor.execute();
      return { task, results };
    } finally {
      this.activeExecutors.delete(task.id);
    }
  }

  async continueTask(
    taskId: string,
    instruction: string,
    backend?: PlannerBackend,
    model?: string,
    lockSelectedModel?: boolean,
  ): Promise<{ parentTask: Task; task: Task; plan: ExecutionPlan }> {
    const parentTask = getTask(taskId);
    if (!parentTask) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (["running", "paused", "planning"].includes(parentTask.status)) {
      this.cancelTask(taskId);
    }

    const effectiveLockSelectedModel = typeof lockSelectedModel === "boolean"
      ? lockSelectedModel
      : !!parentTask.lockSelectedModel;
    const effectiveBackend = effectiveLockSelectedModel
      ? backend || parentTask.lockedPlannerBackend || this.config.planner
      : backend;
    const effectiveModel = effectiveLockSelectedModel
      ? model ?? parentTask.lockedPlannerModel
      : model;

    const continuationPrompt = this.buildContinuationPrompt(parentTask, instruction);
    const { task, plan } = await this.planWithMetadata(
      continuationPrompt,
      effectiveBackend,
      effectiveModel,
      effectiveLockSelectedModel,
      {
        parentTaskId: parentTask.id,
        rootTaskId: parentTask.rootTaskId || parentTask.id,
        continuationInstruction: instruction,
      },
    );
    return { parentTask, task, plan };
  }

  cancelTask(taskId: string): boolean {
    const executor = this.activeExecutors.get(taskId);
    if (executor) {
      executor.cancel();
      this.updateTaskStatus(taskId, "cancelled");
      return true;
    }
    return false;
  }

  pauseTask(taskId: string): boolean {
    const executor = this.activeExecutors.get(taskId);
    if (executor && !executor.isPaused()) {
      executor.pause();
      this.updateTaskStatus(taskId, "paused");
      return true;
    }
    return false;
  }

  resumeTask(taskId: string): boolean {
    const executor = this.activeExecutors.get(taskId);
    if (executor && executor.isPaused()) {
      executor.resume();
      this.updateTaskStatus(taskId, "running");
      return true;
    }
    return false;
  }

  cancelAll(): void {
    for (const executor of this.activeExecutors.values()) {
      executor.cancel();
    }
  }

  getTask(id: string): Task | null {
    return getTask(id);
  }

  listTasks(limit?: number, status?: string): Task[] {
    return listTasks(limit, status);
  }

  getRunningTasks(): Task[] {
    return getRunningTasks();
  }

  private buildContinuationPrompt(parentTask: Task, instruction: string): string {
    const lineage = this.getTaskLineage(parentTask).slice(-6);
    const rootTask = lineage[0] || parentTask;

    const history = lineage.map((task) => ({
      taskId: task.id,
      status: task.status,
      summary: task.plan?.task_summary || "",
      instruction: task.continuationInstruction || "",
      results: task.results.map((result) => ({
        agentId: result.agentId,
        status: result.status,
        error: result.error || "",
        output: (result.output || "").slice(0, 800),
      })),
    }));

    return [
      "You are continuing an existing AgentForge task thread. Keep full context and complete the goal.",
      `THREAD_ROOT_TASK_ID: ${rootTask.id}`,
      `CURRENT_PARENT_TASK_ID: ${parentTask.id}`,
      "",
      "ORIGINAL_USER_GOAL:",
      rootTask.prompt,
      "",
      "THREAD_HISTORY_JSON:",
      JSON.stringify(history, null, 2),
      "",
      "NEW_USER_INSTRUCTION:",
      instruction,
      "",
      "REQUIREMENTS:",
      "- Preserve continuity with original goal and prior progress.",
      "- Reuse successful outputs from prior tasks where applicable.",
      "- Address prior failures directly and continue to completion.",
      "- If one model/agent path fails, switch to the next reliable fallback.",
    ].join("\n");
  }

  private getTaskLineage(task: Task): Task[] {
    const lineage: Task[] = [];
    const visited = new Set<string>();
    let current: Task | null = task;

    while (current && !visited.has(current.id)) {
      lineage.unshift(current);
      visited.add(current.id);
      if (!current.parentTaskId) break;
      current = getTask(current.parentTaskId);
    }

    return lineage;
  }

  private updateTaskStatus(taskId: string, status: Task["status"]): void {
    const task = getTask(taskId);
    if (!task) return;
    task.status = status;
    task.updatedAt = Date.now();
    saveTask(task);
    this.emit("taskUpdated", task);
  }
}

export { Executor } from "./executor";
