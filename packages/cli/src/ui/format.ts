import chalk from "chalk";
import { AgentEvent, AgentResult, ExecutionPlan, Task, TaskStatus } from "@agentforge/core";

const AGENT_COLORS: Record<string, chalk.Chalk> = {
  "claude-code": chalk.hex("#D97706"),
  codex: chalk.hex("#10B981"),
  "gemini-cli": chalk.hex("#3B82F6"),
  ollama: chalk.hex("#8B5CF6"),
  shell: chalk.hex("#6B7280"),
  "web-fetch": chalk.hex("#EC4899"),
};

function agentColor(type: string): chalk.Chalk {
  return AGENT_COLORS[type] || chalk.white;
}

export function formatBanner(): string {
  return chalk.bold.cyan(`
  ╔═══════════════════════════════════════╗
  ║   ⚡ AgentForge Orchestrator v1.0    ║
  ╚═══════════════════════════════════════╝
`);
}

export function formatPlan(plan: ExecutionPlan): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold.white("  Task: ") + plan.task_summary);
  lines.push(chalk.bold.white("  Mode: ") + chalk.yellow(plan.execution_order));
  lines.push(chalk.bold.white("  Agents: ") + chalk.yellow(String(plan.agents.length)));
  lines.push("");

  for (let i = 0; i < plan.agents.length; i++) {
    const agent = plan.agents[i];
    const color = agentColor(agent.type);
    const prefix = i === plan.agents.length - 1 ? "  └─" : "  ├─";
    const deps = agent.depends_on.length > 0
      ? chalk.gray(` (after: ${agent.depends_on.join(", ")})`)
      : "";

    lines.push(`${prefix} ${color.bold(`[${agent.type}]`)} ${chalk.white(agent.purpose)}${deps}`);
    lines.push(`  ${i === plan.agents.length - 1 ? "  " : "│ "}  ${chalk.gray(agent.prompt.slice(0, 80))}${agent.prompt.length > 80 ? chalk.gray("...") : ""}`);
  }

  lines.push("");
  lines.push(chalk.bold.white("  Success criteria: ") + chalk.gray(plan.success_criteria));
  lines.push("");
  return lines.join("\n");
}

export function formatAgentEvent(event: AgentEvent, agentType?: string): string {
  const color = agentColor(agentType || "shell");
  const label = color.bold(`[${event.agentId}]`);

  switch (event.type) {
    case "status":
      return `  ${label} ${formatStatus(event.data as TaskStatus)}`;
    case "log":
      return event.data.split("\n").map((line) => `  ${label} ${line}`).join("\n");
    case "error":
      return `  ${label} ${chalk.red(event.data)}`;
    case "result":
      return `  ${label} ${chalk.gray("completed")}`;
    default:
      return `  ${label} ${event.data}`;
  }
}

export function formatStatus(status: string): string {
  switch (status) {
    case "pending": return chalk.gray("● pending");
    case "planning": return chalk.blue("◉ planning");
    case "running": return chalk.yellow("◉ running");
    case "paused": return chalk.hex("#F59E0B")("◉ paused");
    case "success": return chalk.green("✔ success");
    case "failed": return chalk.red("✘ failed");
    case "cancelled": return chalk.gray("○ cancelled");
    default: return status;
  }
}

export function formatResult(result: AgentResult): string {
  const status = result.status === "success"
    ? chalk.green("✔")
    : result.status === "cancelled"
      ? chalk.gray("○")
      : chalk.red("✘");
  const duration = chalk.gray(`(${(result.durationMs / 1000).toFixed(1)}s)`);
  const error = result.error ? chalk.red(` — ${result.error}`) : "";
  return `  ${status} ${chalk.bold(result.agentId)} ${duration}${error}`;
}

export function formatTaskRow(task: Task): string {
  const id = chalk.gray(task.id.slice(0, 8));
  const status = formatStatus(task.status);
  const prompt = task.prompt.slice(0, 60) + (task.prompt.length > 60 ? "..." : "");
  const time = chalk.gray(new Date(task.createdAt).toLocaleString());
  return `  ${id}  ${status}  ${prompt}  ${time}`;
}

export function formatError(message: string): string {
  return chalk.red.bold("  Error: ") + chalk.red(message);
}

export function formatSuccess(message: string): string {
  return chalk.green.bold("  ✔ ") + message;
}

export function formatInfo(message: string): string {
  return chalk.blue("  ℹ ") + message;
}
