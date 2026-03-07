import { spawn } from "child_process";
import * as https from "https";
import * as http from "http";
import { AgentForgeConfig, ExecutionPlan, ExecutionPlanSchema, PlannerBackend } from "../types";
import { PLANNER_SYSTEM_PROMPT, buildPlannerMessage } from "./prompt";
import {
  getPlannerAttemptSequence,
  getPlannerModelCandidates,
  inferTaskKind,
  parseCsvList,
  resolveOllamaModelTargets,
} from "../models";
import { resolveAllowedDirectories } from "../paths";
import { shouldApplySkillPreambleForPlannerBackend, withSkillPreamble } from "../skill-preamble";

export class Planner {
  constructor(private config: AgentForgeConfig) {}

  async generatePlan(
    userTask: string,
    backendOverride?: PlannerBackend,
    modelOverride?: string,
    lockSelectedModel = false,
  ): Promise<ExecutionPlan> {
    const maxRetries = this.config.maxRetries;
    const preferredBackend = backendOverride || this.config.planner;
    const attempts = getPlannerAttemptSequence(userTask, preferredBackend, modelOverride, lockSelectedModel);
    const errors: string[] = [];

    for (let idx = 0; idx < attempts.length; idx++) {
      const attempt = attempts[idx];
      const tries = idx === 0 ? maxRetries + 1 : 1;
      for (let t = 0; t < tries; t++) {
        try {
          return await this.generateWithBackend(attempt.backend, userTask, attempt.model, lockSelectedModel);
        } catch (err) {
          errors.push(
            `${attempt.backend}${attempt.model ? `(${attempt.model})` : ""} attempt ${t + 1}/${tries}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    throw new Error(`Planner failed after configured attempts: ${errors.join(" | ")}`);
  }

  private extractJson(text: string): unknown {
    try { return JSON.parse(text); } catch {}

    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      try { return JSON.parse(codeBlockMatch[1].trim()); } catch {}
    }

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch {}
    }

    throw new Error("Could not extract valid JSON from planner response");
  }

  private async generateWithBackend(
    backend: PlannerBackend,
    userTask: string,
    modelOverride?: string,
    lockSelectedModel = false,
  ): Promise<ExecutionPlan> {
    const raw = await this.callBackend(backend, userTask, modelOverride, lockSelectedModel);
    const json = this.extractJson(raw);
    return ExecutionPlanSchema.parse(json);
  }

  private async callBackend(
    backend: PlannerBackend,
    userTask: string,
    modelOverride?: string,
    lockSelectedModel = false,
  ): Promise<string> {
    switch (backend) {
      case "claude": {
        if (lockSelectedModel) {
          return this.callClaudeCli(userTask, modelOverride);
        }
        const models = getPlannerModelCandidates("claude", userTask, modelOverride);
        return this.callCliWithModelFallback(userTask, models, (model) => this.callClaudeCli(userTask, model));
      }
      case "openai": {
        if (lockSelectedModel) {
          return this.callCodexCli(userTask, modelOverride);
        }
        const models = getPlannerModelCandidates("openai", userTask, modelOverride);
        return this.callCliWithModelFallback(userTask, models, (model) => this.callCodexCli(userTask, model));
      }
      case "gemini": {
        if (lockSelectedModel) {
          return this.callGeminiCli(userTask, modelOverride);
        }
        const models = getPlannerModelCandidates("gemini", userTask, modelOverride);
        return this.callCliWithModelFallback(userTask, models, (model) => this.callGeminiCli(userTask, model));
      }
      case "ollama": {
        return this.callOllamaWithFallback(userTask, modelOverride, lockSelectedModel);
      }
      case "claudel": {
        return this.callClaudelWithFallback(userTask, modelOverride, lockSelectedModel);
      }
    }
  }

  // ── CLI-based planners (use existing CLI auth) ──

  private callClaudeCli(userTask: string, model?: string): Promise<string> {
    const fullPrompt = this.buildPlannerPrompt(userTask, "claude");
    const args = ["-p", fullPrompt, "--output-format", "text"];
    if (model) args.push("--model", model);
    for (const dir of resolveAllowedDirectories(userTask)) {
      args.push("--add-dir", dir);
    }
    args.push("--dangerously-skip-permissions");
    return this.spawnCli("claude", args, 60000);
  }

  private callCodexCli(userTask: string, model?: string): Promise<string> {
    const fullPrompt = this.buildPlannerPrompt(userTask, "openai");
    const args = model
      ? ["-m", model, "-q", fullPrompt, "--dangerously-bypass-approvals-and-sandbox"]
      : ["-q", fullPrompt, "--dangerously-bypass-approvals-and-sandbox"];
    return this.spawnCli("codex", args, 60000);
  }

  private callGeminiCli(userTask: string, model?: string): Promise<string> {
    const fullPrompt = this.buildPlannerPrompt(userTask, "gemini");
    const args = model
      ? ["--model", model, "-p", fullPrompt, "--yolo"]
      : ["-p", fullPrompt, "--yolo"];
    return this.spawnCli("gemini", args, 60000);
  }

  private spawnCli(
    command: string,
    args: string[],
    timeoutMs: number,
    envOverrides?: Record<string, string>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const proc = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
      });

      proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error(`${command} CLI timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          const lower = stdout.toLowerCase();
          const recoverableSignals = [
            "you've hit your limit",
            "you have hit your limit",
            "rate limit",
            "quota",
            "outside the allowed workspace directories",
            "cannot access the directory",
            "cannot access directory",
          ];
          if (recoverableSignals.some((signal) => lower.includes(signal))) {
            reject(new Error(`Recoverable planner output failure: ${stdout.slice(0, 300)}`));
            return;
          }
          resolve(stdout);
        } else {
          reject(new Error(`${command} CLI exited with code ${code}: ${stderr.slice(0, 300)}`));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`${command} CLI not found or failed to start: ${err.message}`));
      });
    });
  }

  // ── Ollama uses HTTP (no CLI auth needed) ──

  private async callOllamaWithFallback(
    userTask: string,
    modelOverride?: string,
    lockSelectedModel = false,
  ): Promise<string> {
    const cloudUrl = process.env.AGENTFORGE_OLLAMA_CLOUD_URL;
    const cloudModels = parseCsvList(process.env.AGENTFORGE_OLLAMA_CLOUD_MODELS);
    const preferredModels = modelOverride ? [modelOverride] : [this.config.ollamaModel];
    const targets = await resolveOllamaModelTargets({
      localUrl: this.config.ollamaUrl,
      preferredModels,
      cloudUrl,
      cloudModels,
      strictPreferredOrder: lockSelectedModel || !!modelOverride,
    });

    const failures: string[] = [];
    for (const target of targets) {
      try {
        return await this.callOllama(userTask, target.model, target.baseUrl);
      } catch (err) {
        failures.push(`${target.model} (${target.source}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    throw new Error(`Ollama planner fallback exhausted: ${failures.join(" | ")}`);
  }

  private async callClaudelWithFallback(
    userTask: string,
    modelOverride?: string,
    lockSelectedModel = false,
  ): Promise<string> {
    const cloudUrl = process.env.AGENTFORGE_OLLAMA_CLOUD_URL;
    const cloudModels = parseCsvList(process.env.AGENTFORGE_OLLAMA_CLOUD_MODELS);
    const taskKind = inferTaskKind(userTask);
    const policyModels = taskKind === "writing"
      ? ["gpt-oss:20b"]
      : ["kimi-k2.5:cloud", "gpt-oss:20b"];
    const preferredModels = (modelOverride
      ? [modelOverride]
      : lockSelectedModel
        ? [this.config.ollamaModel]
      : policyModels)
      .map((model) => model.replace(/:cloud$/i, ""));
    const targets = await resolveOllamaModelTargets({
      localUrl: this.config.ollamaUrl,
      preferredModels,
      cloudUrl,
      cloudModels,
      strictPreferredOrder: true,
    });

    const failures: string[] = [];
    for (const target of targets) {
      try {
        return await this.callClaudelCli(userTask, target.model, target.baseUrl);
      } catch (err) {
        failures.push(`${target.model} (${target.source}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    throw new Error(`Claudel planner fallback exhausted: ${failures.join(" | ")}`);
  }

  private callClaudelCli(userTask: string, model: string, baseUrl: string): Promise<string> {
    const fullPrompt = this.buildPlannerPrompt(userTask, "claudel");
    const args = [
      "-p",
      fullPrompt,
      "--output-format",
      "text",
      "--model",
      model,
      "--dangerously-skip-permissions",
    ];
    for (const dir of resolveAllowedDirectories(userTask)) {
      args.push("--add-dir", dir);
    }

    return this.spawnCli(
      "claude",
      args,
      60000,
      {
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_AUTH_TOKEN: "ollama",
      },
    );
  }

  private callOllama(userTask: string, model: string, baseUrl: string): Promise<string> {
    const url = new URL(baseUrl);
    const isHttps = url.protocol === "https:";

    return this.httpRequest({
      hostname: url.hostname,
      port: parseInt(url.port, 10) || (isHttps ? 443 : 11434),
      path: "/api/chat",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, JSON.stringify({
      model,
      messages: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: buildPlannerMessage(userTask) },
      ],
      stream: false,
      options: { temperature: 0.2 },
    }), isHttps).then((body) => {
      const data = JSON.parse(body);
      return data.message?.content || "";
    });
  }

  private async callCliWithModelFallback(
    _userTask: string,
    models: Array<string | undefined>,
    caller: (model?: string) => Promise<string>,
  ): Promise<string> {
    const errors: string[] = [];
    for (const model of models) {
      try {
        return await caller(model);
      } catch (err) {
        errors.push(`${model || "default"}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(`All model attempts failed: ${errors.join(" | ")}`);
  }

  private httpRequest(
    options: https.RequestOptions,
    body: string,
    useHttps = true,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = useHttps ? https : http;
      const req = client.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString();
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${responseBody.slice(0, 500)}`));
          } else {
            resolve(responseBody);
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error("Request timeout")); });
      req.write(body);
      req.end();
    });
  }

  private buildPlannerPrompt(userTask: string, backend: PlannerBackend): string {
    const prompt = `${PLANNER_SYSTEM_PROMPT}\n\n${buildPlannerMessage(userTask)}`;
    return shouldApplySkillPreambleForPlannerBackend(backend) ? withSkillPreamble(prompt) : prompt;
  }
}
