import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, listOllamaModels } from "@agentforge/core";
import { formatError, formatInfo } from "../ui/format";

export function registerModelsCommand(program: Command): void {
  const modelsCmd = program
    .command("models")
    .description("Manage available models");

  modelsCmd
    .command("list")
    .description("List available Ollama models and configured backends")
    .action(async () => {
      const config = loadConfig();

      console.log("");
      console.log(chalk.bold.white("  Configured Backends:"));
      console.log(chalk.gray("  ────────────────────────────────────────────────────────────────────"));
      console.log(`    ${chalk.bold("Claude")}    ${config.anthropicApiKey ? chalk.green("✔ ready") : chalk.gray("no API key")}  ${chalk.gray("claude-sonnet-4-20250514, claude-opus-4-20250514")}`);
      console.log(`    ${chalk.bold("OpenAI")}    ${config.openaiApiKey ? chalk.green("✔ ready") : chalk.gray("no API key")}  ${chalk.gray("gpt-4o, gpt-4o-mini, o1, o3-mini")}`);
      console.log(`    ${chalk.bold("Gemini")}    ${config.googleApiKey ? chalk.green("✔ ready") : chalk.gray("no API key")}  ${chalk.gray("gemini-2.0-flash, gemini-2.5-pro")}`);
      console.log(`    ${chalk.bold("Ollama")}    ${chalk.green("✔ local")}     ${chalk.gray(config.ollamaUrl)}`);
      console.log(`    ${chalk.bold("Claudel")}   ${chalk.green("✔ local/cloud")} ${chalk.gray("claude CLI + Ollama-compatible endpoint")}`);
      console.log("");

      const spinner = ora({ text: chalk.blue("  Fetching Ollama models..."), color: "cyan" }).start();

      try {
        const models = await listOllamaModels(config.ollamaUrl);
        spinner.stop();

        if (models.length === 0) {
          console.log(formatInfo("No Ollama models found. Run: ollama pull llama3.2"));
          return;
        }

        console.log(chalk.bold.white("  Ollama Models:"));
        console.log(chalk.gray("  ────────────────────────────────────────────────────────────────────"));

        for (const model of models) {
          const size = (model.size / 1e9).toFixed(1) + "GB";
          console.log(`    ${chalk.bold(model.name.padEnd(30))} ${chalk.gray(size.padEnd(8))} ${chalk.gray(model.modified)}`);
        }
        console.log("");
      } catch (err) {
        spinner.stop();
        console.log(formatInfo(`Could not connect to Ollama at ${config.ollamaUrl}`));
        console.log(chalk.gray("    Make sure Ollama is running: ollama serve"));
        console.log("");
      }
    });
}
