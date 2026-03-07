import { AgentDefinition } from "../types";
import { BaseAgent } from "./base";
import { ClaudeCodeAgent } from "./claude-code";
import { CodexAgent } from "./codex";
import { GeminiCliAgent } from "./gemini-cli";
import { OllamaAgent } from "./ollama";
import { ShellAgent } from "./shell";
import { WebFetchAgent } from "./web-fetch";

export function createAgent(definition: AgentDefinition, taskId: string): BaseAgent {
  switch (definition.type) {
    case "claude-code": return new ClaudeCodeAgent(definition, taskId);
    case "codex": return new CodexAgent(definition, taskId);
    case "gemini-cli": return new GeminiCliAgent(definition, taskId);
    case "ollama": return new OllamaAgent(definition, taskId);
    case "shell": return new ShellAgent(definition, taskId);
    case "web-fetch": return new WebFetchAgent(definition, taskId);
    default:
      throw new Error(`Unknown agent type: ${(definition as AgentDefinition).type}`);
  }
}

export { BaseAgent } from "./base";
export { listOllamaModels } from "./ollama";
