#!/usr/bin/env node

// Ensure CLI tools can spawn without nesting issues
delete process.env.CLAUDECODE;

import { Command } from "commander";
import { formatBanner } from "./ui/format";
import { registerRunCommand } from "./commands/run";
import { registerStatusCommand } from "./commands/status";
import { registerHistoryCommand } from "./commands/history";
import { registerConfigCommand } from "./commands/config";
import { registerModelsCommand } from "./commands/models";

const program = new Command();

program
  .name("agentforge")
  .description("AgentForge — Multi-Model Agent Orchestrator")
  .version("1.0.0")
  .hook("preAction", () => {
    console.log(formatBanner());
  });

registerRunCommand(program);
registerStatusCommand(program);
registerHistoryCommand(program);
registerConfigCommand(program);
registerModelsCommand(program);

program.parse(process.argv);

// Show help if no command given
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
