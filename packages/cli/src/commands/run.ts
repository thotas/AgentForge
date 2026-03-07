import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as readline from "readline";
import { Engine, AgentEvent, PlannerBackend } from "@agentforge/core";
import { formatPlan, formatAgentEvent, formatResult, formatError, formatSuccess, formatInfo } from "../ui/format";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Execute a task using the agent orchestrator")
    .argument("<prompt>", "Task description for the agents")
    .option("-p, --planner <backend>", "Planner backend: claude, openai, gemini, ollama, claudel")
    .option("-m, --model <model>", "Override planner model")
    .option("--dry-run", "Show execution plan without running agents")
    .option("--auto", "Skip confirmation prompt (YOLO mode)")
    .action(async (prompt: string, opts: { planner?: string; model?: string; dryRun?: boolean; auto?: boolean }) => {
      const engine = new Engine();

      const spinner = ora({
        text: chalk.blue("Generating execution plan..."),
        color: "cyan",
      }).start();

      try {
        const { task, plan } = await engine.plan(
          prompt,
          opts.planner as PlannerBackend | undefined,
          opts.model,
        );

        spinner.stop();

        console.log(formatPlan(plan));

        if (opts.dryRun) {
          console.log(formatInfo("Dry run — no agents were executed."));
          console.log(formatInfo(`Task ID: ${task.id}`));
          return;
        }

        // Confirmation prompt unless --auto
        if (!opts.auto) {
          const confirmed = await confirm("Execute this plan?");
          if (!confirmed) {
            console.log(formatInfo("Cancelled."));
            return;
          }
        }

        console.log("");
        console.log(chalk.bold.white("  Executing agents...\n"));

        // Build a type map for formatting
        const typeMap = new Map(plan.agents.map((a) => [a.id, a.type]));

        engine.on("agentEvent", (event: AgentEvent) => {
          if (event.type === "log" || event.type === "error" || event.type === "status") {
            console.log(formatAgentEvent(event, typeMap.get(event.agentId)));
          }
        });

        // Handle Ctrl+C
        const cleanup = () => {
          console.log(formatInfo("\nCancelling all agents..."));
          engine.cancelTask(task.id);
        };
        process.on("SIGINT", cleanup);

        const { results } = await engine.executeTask(task);

        process.removeListener("SIGINT", cleanup);

        console.log("");
        console.log(chalk.bold.white("  Results:"));
        for (const result of results) {
          console.log(formatResult(result));
        }

        const allOk = results.every((r) => r.status === "success");
        console.log("");
        if (allOk) {
          console.log(formatSuccess("All agents completed successfully."));
        } else {
          const failed = results.filter((r) => r.status === "failed").length;
          console.log(formatError(`${failed} agent(s) failed.`));
        }
        console.log(formatInfo(`Task ID: ${task.id}`));
      } catch (err) {
        spinner.stop();
        console.log(formatError(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(chalk.yellow(`  ${question} `) + chalk.gray("[Y/n] "), (answer) => {
      rl.close();
      resolve(!answer || answer.toLowerCase().startsWith("y"));
    });
  });
}
