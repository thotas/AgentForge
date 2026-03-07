import Database from "better-sqlite3";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { Task, AgentResult, ExecutionPlan } from "../types";
import { readAgentOutput } from "../output";

const DB_DIR = path.join(os.homedir(), ".agentforge");
const DB_PATH = path.join(DB_DIR, "agentforge.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      parent_task_id TEXT,
      root_task_id TEXT,
      continuation_instruction TEXT,
      lock_selected_model INTEGER NOT NULL DEFAULT 0,
      locked_planner_backend TEXT,
      locked_planner_model TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      plan TEXT,
      results TEXT DEFAULT '[]',
      planner_model TEXT NOT NULL,
      dry_run INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
  `);

  ensureColumn(db, "tasks", "parent_task_id", "TEXT");
  ensureColumn(db, "tasks", "root_task_id", "TEXT");
  ensureColumn(db, "tasks", "continuation_instruction", "TEXT");
  ensureColumn(db, "tasks", "lock_selected_model", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "tasks", "locked_planner_backend", "TEXT");
  ensureColumn(db, "tasks", "locked_planner_model", "TEXT");
}

export function saveTask(task: Task): void {
  const db = getDb();
  const persistedResults = task.results.map((result) => ({
    ...result,
    output: "",
  }));

  db.prepare(`
    INSERT OR REPLACE INTO tasks (
      id, prompt, parent_task_id, root_task_id, continuation_instruction,
      lock_selected_model, locked_planner_backend, locked_planner_model,
      status, plan, results, planner_model, dry_run, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id,
    task.prompt,
    task.parentTaskId || null,
    task.rootTaskId || null,
    task.continuationInstruction || null,
    task.lockSelectedModel ? 1 : 0,
    task.lockedPlannerBackend || null,
    task.lockedPlannerModel || null,
    task.status,
    task.plan ? JSON.stringify(task.plan) : null,
    JSON.stringify(persistedResults),
    task.plannerModel,
    task.dryRun ? 1 : 0,
    task.createdAt,
    task.updatedAt,
  );
}

export function getTask(id: string): Task | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToTask(row) : null;
}

export function listTasks(limit = 50, statusFilter?: string): Task[] {
  const db = getDb();
  let query = "SELECT * FROM tasks";
  const params: unknown[] = [];

  if (statusFilter) {
    query += " WHERE status = ?";
    params.push(statusFilter);
  }

  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
  return rows.map(rowToTask);
}

export function getRunningTasks(): Task[] {
  return listTasks(100, "running");
}

function rowToTask(row: Record<string, unknown>): Task {
  const persistedResults = JSON.parse((row.results as string) || "[]") as AgentResult[];
  const hydratedResults = persistedResults.map((result) => ({
    ...result,
    output: readAgentOutput(result.outputPath),
  }));

  return {
    id: row.id as string,
    prompt: row.prompt as string,
    parentTaskId: (row.parent_task_id as string) || undefined,
    rootTaskId: (row.root_task_id as string) || undefined,
    continuationInstruction: (row.continuation_instruction as string) || undefined,
    lockSelectedModel: !!(row.lock_selected_model as number),
    lockedPlannerBackend: (row.locked_planner_backend as Task["lockedPlannerBackend"]) || undefined,
    lockedPlannerModel: (row.locked_planner_model as string) || undefined,
    status: row.status as Task["status"],
    plan: row.plan ? JSON.parse(row.plan as string) as ExecutionPlan : undefined,
    results: hydratedResults,
    plannerModel: row.planner_model as string,
    dryRun: !!(row.dry_run as number),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

function ensureColumn(db: Database.Database, table: string, column: string, type: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
