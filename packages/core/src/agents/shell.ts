import { spawn } from "child_process";
import { BaseAgent } from "./base";
import { AgentDefinition, AgentResult } from "../types";

export class ShellAgent extends BaseAgent {
  constructor(definition: AgentDefinition, taskId: string) {
    super(definition, taskId);
  }

  async execute(previousOutputs: Map<string, string>): Promise<AgentResult> {
    this.startTime = Date.now();
    this.status = "running";
    this.emitEvent("status", "running");

    const command = this.interpolatePrompt(this.definition.prompt, previousOutputs);

    // Split command safely - use shell for complex commands
    return new Promise((resolve) => {
      const proc = spawn("/bin/sh", ["-c", command], {
        stdio: ["ignore", "pipe", "pipe"],
        signal: this.abortController.signal,
        cwd: process.cwd(),
      });

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        this.output += text;
        this.emitEvent("log", text);
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        this.output += text;
        this.emitEvent("error", text);
      });

      const timeout = setTimeout(() => {
        proc.kill("SIGTERM");
        this.status = "failed";
        this.emitEvent("status", "failed");
        resolve(this.buildResult("failed", "Shell command timed out", -1));
      }, this.definition.timeout_seconds * 1000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (this.isCancelled()) {
          this.status = "cancelled";
          this.emitEvent("status", "cancelled");
          resolve(this.buildResult("cancelled", "Cancelled by user", code ?? undefined));
          return;
        }
        this.status = code === 0 ? "success" : "failed";
        this.emitEvent("status", this.status);
        resolve(this.buildResult(
          code === 0 ? "success" : "failed",
          code !== 0 ? `Shell exited with code ${code}` : undefined,
          code ?? undefined,
        ));
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        if (this.isCancelled() || this.isAbortError(err)) {
          this.status = "cancelled";
          this.emitEvent("status", "cancelled");
          resolve(this.buildResult("cancelled", "Cancelled by user"));
          return;
        }
        this.status = "failed";
        this.emitEvent("status", "failed");
        resolve(this.buildResult("failed", `Shell error: ${err.message}`));
      });
    });
  }
}
