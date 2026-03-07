import * as http from "http";
import * as https from "https";
import { AgentDefinition, PlannerBackend } from "../types";

export type TaskKind = "technical" | "writing" | "general";

interface OllamaModelDescriptor {
  name: string;
  size: number;
  modified: string;
}

export interface OllamaModelTarget {
  model: string;
  baseUrl: string;
  source: "cloud" | "local";
}

export function inferTaskKind(text: string): TaskKind {
  const normalized = text.toLowerCase();
  const forceTechnicalSignals = [
    "planner",
    "planning",
    "consolidate",
    "consolidation",
    "consolidating",
    "test",
    "testing",
  ];
  const technicalSignals = [
    "code",
    "refactor",
    "bug",
    "fix",
    "build",
    "test",
    "api",
    "typescript",
    "javascript",
    "python",
    "java",
    "go",
    "rust",
    "sql",
    "database",
    "frontend",
    "backend",
    "component",
    "research",
    "review",
    "analyze",
    "analysis",
    "investigate",
    "architecture",
  ];
  const writingSignals = [
    "write",
    "writing",
    "summarize",
    "summary",
    "draft",
    "rewrite",
    "paraphrase",
    "blog",
    "article",
    "copy",
    "content",
    "explanation",
    "notes",
    "documentation",
  ];
  const analysisSignals = [
    "summarize",
    "report",
  ];

  if (forceTechnicalSignals.some((s) => normalized.includes(s))) return "technical";
  if (technicalSignals.some((s) => normalized.includes(s))) return "technical";
  if (writingSignals.some((s) => normalized.includes(s))) return "writing";
  if (analysisSignals.some((s) => normalized.includes(s))) return "technical";
  return "general";
}

export function getPlannerBackendOrder(preferred: PlannerBackend, userTask: string): PlannerBackend[] {
  const work = inferTaskKind(userTask);
  const baseline: PlannerBackend[] =
    work === "writing"
      ? ["ollama", "claudel", "claude", "openai", "gemini"]
      : ["claude", "openai", "gemini", "claudel"];

  return dedupe([preferred, ...baseline]);
}

export function getPlannerModelCandidates(
  backend: PlannerBackend,
  userTask: string,
  preferredModel?: string,
): Array<string | undefined> {
  const work = inferTaskKind(userTask);

  if (backend === "claude") {
    return dedupeWithUndefined([
      preferredModel,
      ...(work === "technical"
        ? ["claude-sonnet-4-5", "claude-opus-4-1"]
        : ["claude-opus-4-1", "claude-sonnet-4-5"]),
      undefined,
    ]);
  }

  if (backend === "openai") {
    return dedupeWithUndefined([
      preferredModel,
      ...(work === "technical"
        ? ["gpt-5-codex", "gpt-5", "o3"]
        : ["gpt-5", "o3", "gpt-4.1"]),
      undefined,
    ]);
  }

  if (backend === "gemini") {
    return dedupeWithUndefined([
      preferredModel,
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      undefined,
    ]);
  }

  if (backend === "claudel") {
    return dedupeWithUndefined([
      preferredModel,
      ...(work === "writing"
        ? ["gpt-oss:20b"]
        : ["kimi-k2.5:cloud", "gpt-oss:20b"]),
      undefined,
    ]);
  }

  if (backend === "ollama") {
    return dedupeWithUndefined([
      preferredModel,
      ...(work === "writing"
        ? ["gpt-oss:20b", "gemma3:4b"]
        : ["gpt-oss:20b", "gemma3:4b"]),
      undefined,
    ]);
  }

  return dedupeWithUndefined([preferredModel, undefined]);
}

export function getAgentModelCandidates(definition: AgentDefinition): Array<string | undefined> {
  if (definition.lockModelSelection) {
    return [definition.model];
  }

  const workSignal = `${definition.purpose}\n${definition.prompt}`;

  switch (definition.type) {
    case "claude-code":
      return getPlannerModelCandidates("claude", workSignal, definition.model);
    case "codex":
      return getPlannerModelCandidates("openai", workSignal, definition.model);
    case "gemini-cli":
      return getPlannerModelCandidates("gemini", workSignal, definition.model);
    default:
      return dedupeWithUndefined([definition.model, undefined]);
  }
}

export interface PlannerAttempt {
  backend: PlannerBackend;
  model?: string;
}

export function getPlannerAttemptSequence(
  userTask: string,
  preferredBackend?: PlannerBackend,
  modelOverride?: string,
  lockSelectedModel = false,
): PlannerAttempt[] {
  if (lockSelectedModel && preferredBackend) {
    return [{ backend: preferredBackend, model: modelOverride }];
  }

  const kind = inferTaskKind(userTask);
  const attempts: PlannerAttempt[] = [];

  if (preferredBackend || modelOverride) {
    attempts.push({ backend: preferredBackend || "claude", model: modelOverride });
  }

  if (kind === "writing") {
    attempts.push(
      { backend: "ollama", model: "gpt-oss:20b" },
      { backend: "claudel", model: "gpt-oss:20b" },
      { backend: "ollama", model: "gemma3:4b" },
      { backend: "claude" },
      { backend: "openai" },
      { backend: "gemini" },
    );
  } else {
    // technical + general
    attempts.push(
      { backend: "claude" },
      { backend: "openai" },
      { backend: "gemini" },
      { backend: "claudel", model: "kimi-k2.5:cloud" },
      { backend: "claudel", model: "gpt-oss:20b" },
    );
  }

  return dedupePlannerAttempts(attempts);
}

export interface AgentAttempt {
  type: AgentDefinition["type"];
  model?: string;
  lockModelSelection?: boolean;
}

export interface AgentSelectionOverride {
  lockSelectedModel?: boolean;
  lockedBackend?: PlannerBackend;
  lockedModel?: string;
}

export function getAgentAttemptSequence(
  definition: AgentDefinition,
  override?: AgentSelectionOverride,
): AgentAttempt[] {
  if (definition.type === "shell" || definition.type === "web-fetch") {
    return [{
      type: definition.type,
      model: definition.model,
      lockModelSelection: definition.lockModelSelection,
    }];
  }

  if (override?.lockSelectedModel && override.lockedBackend) {
    return [getLockedAgentAttempt(override.lockedBackend, override.lockedModel)];
  }

  const taskText = `${definition.purpose}\n${definition.prompt}`;
  const kind = inferTaskKind(taskText);

  if (kind === "writing") {
    return [
      { type: "ollama", model: "gpt-oss:20b", lockModelSelection: false },
      { type: "claude-code", model: "claudel:gpt-oss:20b", lockModelSelection: false },
      { type: "ollama", model: "gemma3:4b", lockModelSelection: false },
      { type: "claude-code", lockModelSelection: false },
      { type: "codex", lockModelSelection: false },
      { type: "gemini-cli", lockModelSelection: false },
    ];
  }

  return [
    { type: "claude-code", lockModelSelection: false },
    { type: "codex", lockModelSelection: false },
    { type: "gemini-cli", lockModelSelection: false },
    { type: "claude-code", model: "claudel:kimi-k2.5:cloud", lockModelSelection: false },
    { type: "claude-code", model: "claudel:gpt-oss:20b", lockModelSelection: false },
  ];
}

export async function resolveOllamaModelTargets(params: {
  localUrl: string;
  preferredModels: Array<string | undefined>;
  cloudUrl?: string;
  cloudModels?: string[];
  strictPreferredOrder?: boolean;
}): Promise<OllamaModelTarget[]> {
  const preferred = dedupe(params.preferredModels.filter(Boolean) as string[]);
  const configuredCloud = dedupe((params.cloudModels || []).filter(Boolean));

  const cloudDiscovered = params.cloudUrl
    ? await listOllamaModelsSafe(params.cloudUrl)
    : [];
  const localDiscovered = await listOllamaModelsSafe(params.localUrl);

  const cloudCandidates = params.strictPreferredOrder
    ? preferred
    : dedupe([
      ...preferred,
      ...configuredCloud,
      ...cloudDiscovered.map((m) => m.name),
    ]);
  const localCandidates = params.strictPreferredOrder
    ? preferred
    : dedupe([
      ...preferred,
      ...localDiscovered.map((m) => m.name),
    ]);

  const targets: OllamaModelTarget[] = [];
  if (params.cloudUrl) {
    for (const model of cloudCandidates) {
      targets.push({ model, baseUrl: params.cloudUrl, source: "cloud" });
    }
  }
  for (const model of localCandidates) {
    targets.push({ model, baseUrl: params.localUrl, source: "local" });
  }

  return dedupeTargets(targets);
}

export async function listOllamaModels(ollamaUrl: string): Promise<OllamaModelDescriptor[]> {
  const url = new URL(ollamaUrl);
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request({
      hostname: url.hostname,
      port: parseInt(url.port, 10) || (isHttps ? 443 : 11434),
      path: "/api/tags",
      method: "GET",
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          resolve((data.models || []).map((m: Record<string, unknown>) => ({
            name: String(m.name || ""),
            size: Number(m.size || 0),
            modified: String(m.modified_at || ""),
          })));
        } catch {
          reject(new Error("Failed to parse Ollama response"));
        }
      });
    });

    req.on("error", (err) => reject(new Error(`Cannot connect to Ollama at ${ollamaUrl}: ${err.message}`)));
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error("Ollama connection timed out"));
    });
    req.end();
  });
}

export function parseCsvList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function listOllamaModelsSafe(ollamaUrl: string): Promise<OllamaModelDescriptor[]> {
  try {
    return await listOllamaModels(ollamaUrl);
  } catch {
    return [];
  }
}

function dedupe<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function dedupeWithUndefined(values: Array<string | undefined>): Array<string | undefined> {
  const seen = new Set<string>();
  let hasUndefined = false;
  const out: Array<string | undefined> = [];

  for (const value of values) {
    if (typeof value === "undefined") {
      if (!hasUndefined) {
        out.push(undefined);
        hasUndefined = true;
      }
      continue;
    }
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }

  return out;
}

function dedupeTargets(targets: OllamaModelTarget[]): OllamaModelTarget[] {
  const seen = new Set<string>();
  const out: OllamaModelTarget[] = [];
  for (const target of targets) {
    const key = `${target.baseUrl}::${target.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

function dedupePlannerAttempts(attempts: PlannerAttempt[]): PlannerAttempt[] {
  const seen = new Set<string>();
  const out: PlannerAttempt[] = [];
  for (const attempt of attempts) {
    const key = `${attempt.backend}::${attempt.model || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(attempt);
  }
  return out;
}

function getLockedAgentAttempt(backend: PlannerBackend, model?: string): AgentAttempt {
  switch (backend) {
    case "claude":
      return { type: "claude-code", model, lockModelSelection: true };
    case "openai":
      return { type: "codex", model, lockModelSelection: true };
    case "gemini":
      return { type: "gemini-cli", model, lockModelSelection: true };
    case "ollama":
      return { type: "ollama", model, lockModelSelection: true };
    case "claudel":
      return {
        type: "claude-code",
        model: model ? `claudel:${model.replace(/^claudel:/i, "")}` : "claudel:gpt-oss:20b",
        lockModelSelection: true,
      };
  }
}
