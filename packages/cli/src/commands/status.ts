import { Command } from "commander";
import chalk from "chalk";
import { Engine } from "@agentforge/core";
import { formatTaskRow, formatInfo } from "../ui/format";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show running and recent tasks")
    .option("-a, --all", "Show all tasks, not just running")
    .action((opts: { all?: boolean }) => {
      const engine = new Engine();

      const tasks = opts.all
        ? engine.listTasks(20)
        : engine.listTasks(20, "running");

      if (tasks.length === 0) {
        console.log(formatInfo(opts.all ? "No tasks found." : "No running tasks."));
        return;
      }

      console.log("");
      console.log(chalk.bold.white("  Tasks:"));
      console.log(chalk.gray("  ────────────────────────────────────────────────────────────────────"));

      for (const task of tasks) {
        console.log(formatTaskRow(task));
      }
      console.log("");
    });
}
