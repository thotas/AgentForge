import { spawn } from "child_process";
import { BaseAgent } from "./base";
import { AgentDefinition, AgentResult } from "../types";
import { getAgentModelCandidates } from "../models";

export class GeminiCliAgent extends BaseAgent {
  constructor(definition: AgentDefinition, taskId: string) {
    super(definition, taskId);
  }

  async execute(previousOutputs: Map<string, string>): Promise<AgentResult> {
    this.startTime = Date.now();
    this.status = "running";
    this.emitEvent("status", "running");

    const prompt = this.interpolatePrompt(this.definition.prompt, previousOutputs);
    const candidates = getAgentModelCandidates(this.definition);
    const errors: string[] = [];

    for (const [index, model] of candidates.entries()) {
      if (this.isCancelled()) {
        this.status = "cancelled";
        this.emitEvent("status", "cancelled");
        return this.buildResult("cancelled", "Cancelled by user");
      }

      this.emitEvent("log", `\n[AgentForge] Gemini model attempt ${index + 1}/${candidates.length}: ${model || "default"}\n`);
      const result = await this.executeOnce(prompt, model);
      const recoverableReason = this.getRecoverableFailureReason(result);

      if (result.status === "cancelled") {
        this.status = result.status;
        this.emitEvent("status", result.status);
        return result;
      }

      if (result.status === "success" && !recoverableReason) {
        this.status = result.status;
        this.emitEvent("status", result.status);
        return result;
      }

      errors.push(recoverableReason || result.error || `Unknown failure for model ${model || "default"}`);
    }

    this.status = "failed";
    this.emitEvent("status", "failed");
    return this.buildResult("failed", `Gemini model fallback exhausted: ${errors.join(" | ")}`);
  }

  private executeOnce(prompt: string, model?: string): Promise<AgentResult> {
    return new Promise((resolve) => {
      const args = model
        ? ["--model", model, "-p", prompt, "--yolo"]
        : ["-p", prompt, "--yolo"];
      let stderrOutput = "";
      const proc = spawn("gemini", args, {
        stdio: ["ignore", "pipe", "pipe"],
        signal: this.abortController.signal,
      });

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        this.output += text;
        this.emitEvent("log", text);
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrOutput += text;
        this.emitEvent("error", text);
      });

      const timeout = setTimeout(() => {
        proc.kill("SIGTERM");
        resolve(this.buildResult("failed", "Agent timed out", -1));
      }, this.definition.timeout_seconds * 1000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (this.isCancelled()) {
          resolve(this.buildResult("cancelled", "Cancelled by user", code ?? undefined));
          return;
        }
        resolve(this.buildResult(
          code === 0 ? "success" : "failed",
          code !== 0
            ? `Gemini CLI exited with code ${code}${stderrOutput ? `: ${stderrOutput.slice(0, 300)}` : ""}`
            : undefined,
          code ?? undefined,
        ));
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        if (this.isCancelled() || this.isAbortError(err)) {
          resolve(this.buildResult("cancelled", "Cancelled by user"));
          return;
        }
        resolve(this.buildResult("failed", `Failed to spawn gemini CLI: ${err.message}`));
      });
    });
  }
}
