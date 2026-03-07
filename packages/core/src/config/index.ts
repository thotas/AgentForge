import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { AgentForgeConfig, PlannerBackend } from "../types";

const CONFIG_DIR = path.join(os.homedir(), ".agentforge");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULTS: AgentForgeConfig = {
  planner: "claude",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  webPort: 3000,
  apiPort: 3001,
  defaultTimeout: 120,
  maxRetries: 2,
  autoConfirm: false,
};

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadFileConfig(): Partial<AgentForgeConfig> {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function loadEnvConfig(): Partial<AgentForgeConfig> {
  const env: Partial<AgentForgeConfig> = {};
  if (process.env.ANTHROPIC_API_KEY) env.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) env.openaiApiKey = process.env.OPENAI_API_KEY;
  if (process.env.GOOGLE_API_KEY) env.googleApiKey = process.env.GOOGLE_API_KEY;
  if (process.env.OLLAMA_URL) env.ollamaUrl = process.env.OLLAMA_URL;
  if (process.env.AGENTFORGE_PLANNER) env.planner = process.env.AGENTFORGE_PLANNER as PlannerBackend;
  if (process.env.AGENTFORGE_OLLAMA_MODEL) env.ollamaModel = process.env.AGENTFORGE_OLLAMA_MODEL;
  if (process.env.AGENTFORGE_WEB_PORT) env.webPort = parseInt(process.env.AGENTFORGE_WEB_PORT, 10);
  if (process.env.AGENTFORGE_API_PORT) env.apiPort = parseInt(process.env.AGENTFORGE_API_PORT, 10);
  return env;
}

export function loadConfig(): AgentForgeConfig {
  require("dotenv").config();
  const fileConfig = loadFileConfig();
  const envConfig = loadEnvConfig();
  return { ...DEFAULTS, ...fileConfig, ...envConfig };
}

export function saveConfig(updates: Partial<AgentForgeConfig>): void {
  ensureConfigDir();
  const existing = loadFileConfig();
  const merged = { ...existing, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + "\n");
}

export function getConfigValue(key: string): string | undefined {
  const config = loadConfig();
  return String((config as unknown as Record<string, unknown>)[key] ?? "");
}

export function setConfigValue(key: string, value: string): void {
  let parsed: unknown = value;
  if (value === "true") parsed = true;
  else if (value === "false") parsed = false;
  else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);
  saveConfig({ [key]: parsed } as Partial<AgentForgeConfig>);
}

export function isConfigured(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function hasApiKey(_config: AgentForgeConfig, _backend: PlannerBackend): boolean {
  // CLIs handle their own auth — all backends are always "available"
  return true;
}

export function getAvailableBackends(config: AgentForgeConfig): PlannerBackend[] {
  const backends: PlannerBackend[] = ["claude", "openai", "gemini", "ollama", "claudel"];
  return backends.filter((b) => hasApiKey(config, b));
}
