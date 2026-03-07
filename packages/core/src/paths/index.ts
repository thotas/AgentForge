import * as fs from "fs";
import * as path from "path";

export function resolveAllowedDirectories(text: string): string[] {
  const dirs = new Set<string>();
  dirs.add(process.cwd());

  for (const dir of parseCsv(process.env.AGENTFORGE_EXTRA_DIRS)) {
    const normalized = normalizeDir(dir);
    if (normalized) dirs.add(normalized);
  }

  const matches = text.match(/\/[^\s"'`]+/g) || [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[),.;:!?]+$/g, "");
    const normalized = normalizeDir(cleaned);
    if (normalized) dirs.add(normalized);
  }

  return Array.from(dirs);
}

function normalizeDir(input: string): string | null {
  if (!input) return null;

  const absolute = input.startsWith("/")
    ? path.normalize(input)
    : path.resolve(process.cwd(), input);

  try {
    const stat = fs.statSync(absolute);
    return stat.isDirectory() ? absolute : path.dirname(absolute);
  } catch {
    return null;
  }
}

function parseCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
