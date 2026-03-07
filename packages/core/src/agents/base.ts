import { EventEmitter } from "events";
import { AgentDefinition, AgentEvent, AgentResult, AgentStatus } from "../types";
import { shouldApplySkillPreambleForAgent, withSkillPreamble } from "../skill-preamble";

export abstract class BaseAgent extends EventEmitter {
  protected status: AgentStatus = "pending";
  protected output = "";
  protected startTime = 0;
  protected abortController = new AbortController();

  constructor(
    protected definition: AgentDefinition,
    protected taskId: string,
  ) {
    super();
  }

  abstract execute(previousOutputs: Map<string, string>): Promise<AgentResult>;

  cancel(): void {
    this.status = "cancelled";
    this.abortController.abort();
    this.emitEvent("status", "cancelled");
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  protected emitEvent(type: AgentEvent["type"], data: string): void {
    const event: AgentEvent = {
      type,
      agentId: this.definition.id,
      taskId: this.taskId,
      timestamp: Date.now(),
      data,
    };
    this.emit("event", event);
  }

  protected buildResult(status: "success" | "failed" | "cancelled", error?: string, exitCode?: number): AgentResult {
    return {
      agentId: this.definition.id,
      status,
      output: this.output,
      error,
      durationMs: Date.now() - this.startTime,
      exitCode,
    };
  }

  protected isCancelled(): boolean {
    return this.status === "cancelled" || this.abortController.signal.aborted;
  }

  protected isAbortError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as { name?: string; code?: string };
    return e.name === "AbortError" || e.code === "ABORT_ERR";
  }

  protected isLikelyModelFailure(message?: string): boolean {
    if (!message) return false;
    const lower = message.toLowerCase();
    return lower.includes("model")
      || lower.includes("not found")
      || lower.includes("unknown")
      || lower.includes("unsupported")
      || lower.includes("invalid model")
      || lower.includes("hit your limit")
      || lower.includes("rate limit")
      || lower.includes("quota")
      || lower.includes("resets")
      || lower.includes("outside the allowed workspace directories");
  }

  protected getRecoverableFailureReason(result: AgentResult): string | undefined {
    if (this.isLikelyModelFailure(result.error)) {
      return result.error;
    }

    const lowerOutput = (result.output || "").toLowerCase();
    const outputSignals = [
      "outside the allowed workspace directories",
      "cannot access the directory",
      "cannot access directory",
      "you've hit your limit",
      "you have hit your limit",
      "rate limit",
      "quota",
      "resets 12am",
    ];

    for (const signal of outputSignals) {
      if (lowerOutput.includes(signal)) {
        return `Recoverable failure detected in model output (${signal})`;
      }
    }

    return undefined;
  }

  protected interpolatePrompt(prompt: string, previousOutputs: Map<string, string>): string {
    let result = prompt;
    for (const [agentId, output] of previousOutputs) {
      result = result.replace(new RegExp(`\\{\\{${agentId}\\}\\}`, "g"), output);
    }
    if (shouldApplySkillPreambleForAgent(this.definition.type)) {
      result = withSkillPreamble(result);
    }
    return result;
  }
}
