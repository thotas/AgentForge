import { Command } from "commander";
import chalk from "chalk";
import { Engine } from "@agentforge/core";
import { formatTaskRow, formatInfo, formatStatus, formatResult } from "../ui/format";

export function registerHistoryCommand(program: Command): void {
  program
    .command("history")
    .description("List past tasks with outcomes")
    .option("-n, --limit <number>", "Number of tasks to show", "20")
    .option("--id <taskId>", "Show details for a specific task")
    .action((opts: { limit: string; id?: string }) => {
      const engine = new Engine();

      if (opts.id) {
        const task = engine.getTask(opts.id);
        if (!task) {
          console.log(chalk.red(`  Task ${opts.id} not found.`));
          return;
        }

        console.log("");
        console.log(chalk.bold.white("  Task Details"));
        console.log(chalk.gray("  ────────────────────────────────────────────────────────────────────"));
        console.log(chalk.bold("  ID:      ") + task.id);
        console.log(chalk.bold("  Status:  ") + formatStatus(task.status));
        console.log(chalk.bold("  Prompt:  ") + task.prompt);
        console.log(chalk.bold("  Planner: ") + task.plannerModel);
        console.log(chalk.bold("  Created: ") + new Date(task.createdAt).toLocaleString());

        if (task.plan) {
          console.log(chalk.bold("  Summary: ") + task.plan.task_summary);
          console.log(chalk.bold("  Agents:  ") + task.plan.agents.length);
          console.log(chalk.bold("  Mode:    ") + task.plan.execution_order);
        }

        if (task.results.length > 0) {
          console.log("");
          console.log(chalk.bold.white("  Agent Results:"));
          for (const result of task.results) {
            console.log(formatResult(result));
          }
        }

        console.log("");
        return;
      }

      const tasks = engine.listTasks(parseInt(opts.limit, 10));
      if (tasks.length === 0) {
        console.log(formatInfo("No task history."));
        return;
      }

      console.log("");
      console.log(chalk.bold.white("  Task History:"));
      console.log(chalk.gray("  ────────────────────────────────────────────────────────────────────"));

      for (const task of tasks) {
        console.log(formatTaskRow(task));
      }

      console.log("");
      console.log(chalk.gray("  Use: agentforge history --id <task-id> for details"));
      console.log("");
    });
}
