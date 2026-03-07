import { AgentDefinition, PlannerBackend } from "./types";

const SKILL_PREAMBLE_MARKER = "[AgentForge Skill Requirements]";

const SKILL_PREAMBLE = `${SKILL_PREAMBLE_MARKER}
Use the project's superpowers/skills workflow from AGENTS.md.
1. Invoke and follow \`using-superpowers\` before any response or action.
2. Use all relevant skills for the task/tool context (for example: \`brainstorming\`, \`systematic-debugging\`, \`test-driven-development\`, \`verification-before-completion\`).
3. If multiple skills apply, use the minimal correct set in order and explicitly follow each skill's required workflow.
4. Do not skip skill invocation because a task appears simple.
`;

export function shouldApplySkillPreambleForAgent(type: AgentDefinition["type"]): boolean {
  return type === "claude-code" || type === "codex" || type === "gemini-cli";
}

export function shouldApplySkillPreambleForPlannerBackend(backend: PlannerBackend): boolean {
  return backend === "claude" || backend === "openai" || backend === "gemini" || backend === "claudel";
}

export function withSkillPreamble(prompt: string): string {
  if (prompt.includes(SKILL_PREAMBLE_MARKER)) return prompt;
  return `${SKILL_PREAMBLE}\n${prompt}`;
}

