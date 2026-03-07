import * as http from "http";
import * as https from "https";
import { BaseAgent } from "./base";
import { AgentDefinition, AgentResult } from "../types";
import { loadConfig } from "../config";
import {
  inferTaskKind,
  listOllamaModels,
  parseCsvList,
  resolveOllamaModelTargets,
} from "../models";

export class OllamaAgent extends BaseAgent {
  constructor(definition: AgentDefinition, taskId: string) {
    super(definition, taskId);
  }

  async execute(previousOutputs: Map<string, string>): Promise<AgentResult> {
    this.startTime = Date.now();
    this.status = "running";
    this.emitEvent("status", "running");

    const prompt = this.interpolatePrompt(this.definition.prompt, previousOutputs);
    const config = loadConfig();
    const cloudUrl = process.env.AGENTFORGE_OLLAMA_CLOUD_URL;
    const cloudModels = parseCsvList(process.env.AGENTFORGE_OLLAMA_CLOUD_MODELS);
    const taskKind = inferTaskKind(`${this.definition.purpose}\n${this.definition.prompt}`);
    const policyModels = taskKind === "writing"
      ? ["gpt-oss:20b", "gemma3:4b"]
      : ["gpt-oss:20b", "gemma3:4b"];
    const targets = await resolveOllamaModelTargets({
      localUrl: config.ollamaUrl,
      preferredModels: [this.definition.model, ...policyModels, config.ollamaModel],
      cloudUrl,
      cloudModels,
    });

    if (targets.length === 0) {
      this.status = "failed";
      this.emitEvent("status", "failed");
      return this.buildResult("failed", "No Ollama models available (cloud or local)");
    }

    const failures: string[] = [];

    for (const [index, target] of targets.entries()) {
      this.emitEvent(
        "log",
        `\n[AgentForge] Ollama attempt ${index + 1}/${targets.length}: ${target.model} (${target.source})\n`,
      );

      try {
        await this.streamChat(new URL(target.baseUrl), target.model, prompt);
        this.status = "success";
        this.emitEvent("status", "success");
        return this.buildResult("success");
      } catch (err) {
        if (this.isCancelled() || this.isAbortError(err)) {
          this.status = "cancelled";
          this.emitEvent("status", "cancelled");
          return this.buildResult("cancelled", "Cancelled by user");
        }

        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${target.model} (${target.source}): ${message}`);

        // Only stop early for non-model failures on the last attempt.
        const hasMoreTargets = index < targets.length - 1;
        if (hasMoreTargets) {
          this.emitEvent("error", `\n[AgentForge] Model failed, trying next model: ${message}\n`);
          continue;
        }
      }
    }

    this.status = "failed";
    this.emitEvent("status", "failed");
    return this.buildResult("failed", `All Ollama model attempts failed: ${failures.join(" | ")}`);
  }

  private streamChat(baseUrl: URL, model: string, prompt: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isHttps = baseUrl.protocol === "https:";
      const client = isHttps ? https : http;

      const body = JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      });

      const req = client.request({
        hostname: baseUrl.hostname,
        port: parseInt(baseUrl.port) || (isHttps ? 443 : 11434),
        path: "/api/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        signal: this.abortController.signal,
      }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => reject(new Error(`Ollama HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 300)}`)));
          return;
        }

        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.message?.content) {
                this.output += data.message.content;
                this.emitEvent("log", data.message.content);
              }
            } catch {}
          }
        });

        res.on("end", resolve);
      });

      const timeout = setTimeout(() => {
        req.destroy();
        reject(new Error("Ollama request timed out"));
      }, this.definition.timeout_seconds * 1000);

      req.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      req.on("close", () => clearTimeout(timeout));
      req.write(body);
      req.end();
    });
  }
}

export { listOllamaModels };
