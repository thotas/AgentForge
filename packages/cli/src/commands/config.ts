import { Command } from "commander";
import chalk from "chalk";
import * as readline from "readline";
import { loadConfig, setConfigValue, getConfigPath, isConfigured, saveConfig, getAvailableBackends, PlannerBackend } from "@agentforge/core";
import { formatSuccess, formatInfo, formatError } from "../ui/format";

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Manage AgentForge configuration");

  configCmd
    .command("show")
    .description("Show current configuration")
    .action(() => {
      const config = loadConfig();
      const available = getAvailableBackends(config);

      console.log("");
      console.log(chalk.bold.white("  Configuration:"));
      console.log(chalk.gray("  ────────────────────────────────────────────────────────────────────"));
      console.log(chalk.bold("  Config file:    ") + getConfigPath());
      console.log(chalk.bold("  Planner:        ") + chalk.yellow(config.planner));
      console.log(chalk.bold("  Ollama URL:     ") + config.ollamaUrl);
      console.log(chalk.bold("  Ollama model:   ") + config.ollamaModel);
      console.log(chalk.bold("  Web port:       ") + config.webPort);
      console.log(chalk.bold("  API port:       ") + config.apiPort);
      console.log(chalk.bold("  Timeout:        ") + `${config.defaultTimeout}s`);
      console.log(chalk.bold("  Max retries:    ") + config.maxRetries);
      console.log("");
      console.log(chalk.bold("  API Keys:"));
      console.log(`    Anthropic:  ${config.anthropicApiKey ? chalk.green("✔ configured") : chalk.gray("not set")}`);
      console.log(`    OpenAI:     ${config.openaiApiKey ? chalk.green("✔ configured") : chalk.gray("not set")}`);
      console.log(`    Google:     ${config.googleApiKey ? chalk.green("✔ configured") : chalk.gray("not set")}`);
      console.log(`    Ollama:     ${chalk.green("✔ no key needed")}`);
      console.log("");
      console.log(chalk.bold("  Available backends: ") + available.map((b) => chalk.green(b)).join(", "));
      console.log("");
    });

  configCmd
    .command("set")
    .description("Set a configuration value")
    .argument("<key>", "Configuration key (planner, ollama-url, ollama-model, etc.)")
    .argument("<value>", "Value to set")
    .action((key: string, value: string) => {
      // Normalize key names
      const keyMap: Record<string, string> = {
        "planner": "planner",
        "ollama-url": "ollamaUrl",
        "ollama-model": "ollamaModel",
        "web-port": "webPort",
        "api-port": "apiPort",
        "timeout": "defaultTimeout",
        "max-retries": "maxRetries",
        "auto-confirm": "autoConfirm",
      };

      const normalizedKey = keyMap[key] || key;
      setConfigValue(normalizedKey, value);
      console.log(formatSuccess(`Set ${key} = ${value}`));
    });

  configCmd
    .command("init")
    .description("Interactive configuration setup")
    .action(async () => {
      console.log("");
      console.log(chalk.bold.cyan("  AgentForge Setup Wizard"));
      console.log(chalk.gray("  ────────────────────────────────────────────────────────────────────"));
      console.log("");

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string, def?: string): Promise<string> =>
        new Promise((resolve) => {
          const defText = def ? chalk.gray(` (${def})`) : "";
          rl.question(chalk.white(`  ${q}${defText}: `), (answer) => {
            resolve(answer || def || "");
          });
        });

      try {
        const planner = await ask("Default planner [claude/openai/gemini/ollama/claudel]", "claude");
        const anthropicKey = await ask("Anthropic API key (or Enter to skip)");
        const openaiKey = await ask("OpenAI API key (or Enter to skip)");
        const googleKey = await ask("Google AI API key (or Enter to skip)");
        const ollamaUrl = await ask("Ollama URL", "http://localhost:11434");

        const config: Record<string, unknown> = {
          planner: planner as PlannerBackend,
          ollamaUrl,
        };

        if (anthropicKey) config.anthropicApiKey = anthropicKey;
        if (openaiKey) config.openaiApiKey = openaiKey;
        if (googleKey) config.googleApiKey = googleKey;

        saveConfig(config);

        console.log("");
        console.log(formatSuccess(`Configuration saved to ${getConfigPath()}`));
        console.log(formatInfo("You can also set API keys via environment variables."));
        console.log("");
      } finally {
        rl.close();
      }
    });
}
