import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const OUTPUT_ROOT = path.join(os.homedir(), ".agentforge", "outputs");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function getOutputRoot(): string {
  ensureDir(OUTPUT_ROOT);
  return OUTPUT_ROOT;
}

export function getAgentOutputPath(taskId: string, agentId: string): string {
  const taskDir = path.join(getOutputRoot(), safeName(taskId));
  ensureDir(taskDir);
  return path.join(taskDir, `${safeName(agentId)}.md`);
}

export function writeAgentOutput(taskId: string, agentId: string, output: string): string {
  const outputPath = getAgentOutputPath(taskId, agentId);
  const cleanOutput = stripAnsi(output ?? "");
  fs.writeFileSync(outputPath, cleanOutput, "utf-8");
  return outputPath;
}

export function readAgentOutput(outputPath?: string): string {
  if (!outputPath) return "";
  try {
    return fs.readFileSync(outputPath, "utf-8");
  } catch {
    return "";
  }
}

function stripAnsi(text: string): string {
  // Matches common ANSI escape sequences used by CLIs.
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}
