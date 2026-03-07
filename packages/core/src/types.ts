import { z } from "zod";

// ── Planner types ──

export const AgentDefinitionSchema = z.object({
  id: z.string(),
  type: z.enum(["claude-code", "codex", "gemini-cli", "ollama", "shell", "web-fetch"]),
  model: z.string().optional(),
  lockModelSelection: z.boolean().optional(),
  purpose: z.string(),
  prompt: z.string(),
  depends_on: z.array(z.string()).default([]),
  timeout_seconds: z.number().default(120),
});

export const ExecutionPlanSchema = z.object({
  task_summary: z.string(),
  agents: z.array(AgentDefinitionSchema).min(1),
  execution_order: z.enum(["sequential", "parallel", "dag"]),
  success_criteria: z.string(),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

// ── Agent runtime types ──

export type AgentStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export interface AgentResult {
  agentId: string;
  status: AgentStatus;
  output: string;
  outputPath?: string;
  error?: string;
  durationMs: number;
  exitCode?: number;
}

export interface AgentEvent {
  type: "status" | "log" | "error" | "result";
  agentId: string;
  taskId: string;
  timestamp: number;
  data: string;
}

// ── Task types ──

export type TaskStatus = "pending" | "planning" | "running" | "paused" | "success" | "failed" | "cancelled";

export interface Task {
  id: string;
  prompt: string;
  parentTaskId?: string;
  rootTaskId?: string;
  continuationInstruction?: string;
  lockSelectedModel?: boolean;
  lockedPlannerBackend?: PlannerBackend;
  lockedPlannerModel?: string;
  status: TaskStatus;
  plan?: ExecutionPlan;
  results: AgentResult[];
  createdAt: number;
  updatedAt: number;
  plannerModel: string;
  dryRun: boolean;
}

// ── Config types ──

export type PlannerBackend = "claude" | "openai" | "gemini" | "ollama" | "claudel";

export interface AgentForgeConfig {
  planner: PlannerBackend;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  ollamaUrl: string;
  ollamaModel: string;
  webPort: number;
  apiPort: number;
  defaultTimeout: number;
  maxRetries: number;
  autoConfirm: boolean;
}
