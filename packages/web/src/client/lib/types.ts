export interface AgentDef {
  id: string;
  type: string;
  model?: string;
  purpose: string;
  prompt: string;
  depends_on: string[];
  timeout_seconds: number;
}

export interface ExecutionPlan {
  task_summary: string;
  agents: AgentDef[];
  execution_order: string;
  success_criteria: string;
}

export interface AgentResult {
  agentId: string;
  status: "success" | "failed" | "cancelled";
  output: string;
  outputPath?: string;
  error?: string;
  durationMs: number;
}

export interface Task {
  id: string;
  prompt: string;
  parentTaskId?: string;
  rootTaskId?: string;
  continuationInstruction?: string;
  lockSelectedModel?: boolean;
  lockedPlannerBackend?: string;
  lockedPlannerModel?: string;
  status: "pending" | "planning" | "running" | "paused" | "success" | "failed" | "cancelled";
  plan?: ExecutionPlan;
  results: AgentResult[];
  createdAt: number;
  updatedAt: number;
  plannerModel: string;
  dryRun: boolean;
}

export interface AgentEvent {
  type: "status" | "log" | "error" | "result";
  agentId: string;
  taskId: string;
  timestamp: number;
  data: string;
}

export interface WsMessage {
  type: string;
  payload: unknown;
  timestamp: number;
}

export interface AppConfig {
  planner: string;
  ollamaUrl: string;
  ollamaModel: string;
  webPort: number;
  apiPort: number;
  defaultTimeout: number;
  maxRetries: number;
  hasAnthropicKey: boolean;
  hasOpenaiKey: boolean;
  hasGoogleKey: boolean;
}
