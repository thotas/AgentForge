import { spawn } from "child_process";
import { BaseAgent } from "./base";
import { AgentDefinition, AgentResult } from "../types";
import {
  getAgentModelCandidates,
  parseCsvList,
  resolveOllamaModelTargets,
} from "../models";
import { resolveAllowedDirectories } from "../paths";
import { loadConfig } from "../config";

export class ClaudeCodeAgent extends BaseAgent {
  constructor(definition: AgentDefinition, taskId: string) {
    super(definition, taskId);
  }

  async execute(previousOutputs: Map<string, string>): Promise<AgentResult> {
    this.startTime = Date.now();
    this.status = "running";
    this.emitEvent("status", "running");

    const prompt = this.interpolatePrompt(this.definition.prompt, previousOutputs);
    const explicitClaudelModel = this.parseExplicitClaudelModel(this.definition.model);
    if (explicitClaudelModel) {
      const result = await this.runClaudelFallback(prompt, [explicitClaudelModel]);
      if (result) return result;
      this.status = "failed";
      this.emitEvent("status", "failed");
      return this.buildResult("failed", `Claudel fallback exhausted for ${explicitClaudelModel}`);
    }

    const candidates = getAgentModelCandidates(this.definition);
    const errors: string[] = [];

    for (const [index, model] of candidates.entries()) {
      if (this.isCancelled()) {
        this.status = "cancelled";
        this.emitEvent("status", "cancelled");
        return this.buildResult("cancelled", "Cancelled by user");
      }

      this.emitEvent("log", `\n[AgentForge] Claude model attempt ${index + 1}/${candidates.length}: ${model || "default"}\n`);
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
    return this.buildResult("failed", `Claude model fallback exhausted: ${errors.join(" | ")}`);
  }

  private executeOnce(prompt: string, model?: string, envOverrides?: Record<string, string>): Promise<AgentResult> {
    return new Promise((resolve) => {
      const args = ["-p", prompt, "--output-format", "text"];
      if (model) args.push("--model", model);
      for (const dir of resolveAllowedDirectories(prompt)) {
        args.push("--add-dir", dir);
      }
      args.push("--dangerously-skip-permissions");
      let stderrOutput = "";
      const proc = spawn("claude", args, {
        stdio: ["ignore", "pipe", "pipe"],
        signal: this.abortController.signal,
        env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
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
            ? `Process exited with code ${code}${stderrOutput ? `: ${stderrOutput.slice(0, 300)}` : ""}`
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
        resolve(this.buildResult("failed", `Failed to spawn claude CLI: ${err.message}`));
      });
    });
  }

  private parseExplicitClaudelModel(model?: string): string | undefined {
    if (!model) return undefined;
    const prefix = "claudel:";
    if (!model.startsWith(prefix)) return undefined;
    const parsed = model.slice(prefix.length).trim();
    return parsed || undefined;
  }

  private async runClaudelFallback(
    prompt: string,
    preferredModels: string[],
    errors: string[] = [],
  ): Promise<AgentResult | null> {
    const config = loadConfig();
    const cloudUrl = process.env.AGENTFORGE_OLLAMA_CLOUD_URL;
    const cloudModels = parseCsvList(process.env.AGENTFORGE_OLLAMA_CLOUD_MODELS);
    const normalizedModels = preferredModels.map((model) => model.replace(/:cloud$/i, ""));

    const claudelTargets = await resolveOllamaModelTargets({
      localUrl: config.ollamaUrl,
      preferredModels: normalizedModels,
      cloudUrl,
      cloudModels,
      strictPreferredOrder: true,
    });

    for (const [index, target] of claudelTargets.entries()) {
      if (this.isCancelled()) {
        this.status = "cancelled";
        this.emitEvent("status", "cancelled");
        return this.buildResult("cancelled", "Cancelled by user");
      }

      this.emitEvent(
        "log",
        `\n[AgentForge] Claudel fallback ${index + 1}/${claudelTargets.length}: ${target.model} (${target.source})\n`,
      );
      const result = await this.executeOnce(prompt, target.model, {
        ANTHROPIC_BASE_URL: target.baseUrl,
        ANTHROPIC_AUTH_TOKEN: "ollama",
      });
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

      errors.push(
        recoverableReason
        || result.error
        || `Unknown failure for claudel model ${target.model} (${target.source})`,
      );
    }

    return null;
  }
}
