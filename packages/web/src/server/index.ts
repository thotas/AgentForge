// Ensure CLI tools can spawn without nesting issues
delete process.env.CLAUDECODE;

import express from "express";
import cors from "cors";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import { WebSocketServer, WebSocket } from "ws";
import {
  Engine,
  AgentEvent,
  PlannerBackend,
  loadConfig,
  saveConfig,
  setConfigValue,
  listOllamaModels,
} from "@agentforge/core";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const engine = new Engine();
const clients = new Set<WebSocket>();

// Broadcast to all connected WebSocket clients
function broadcast(type: string, payload: unknown): void {
  const message = JSON.stringify({ type, payload, timestamp: Date.now() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Forward engine events to WebSocket clients
engine.on("taskCreated", (task) => broadcast("taskCreated", task));
engine.on("planReady", (task, plan) => broadcast("planReady", { task, plan }));
engine.on("taskUpdated", (task) => broadcast("taskUpdated", task));
engine.on("agentEvent", (event: AgentEvent) => broadcast("agentEvent", event));

// WebSocket connection handling
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));

  // Send initial state
  const tasks = engine.listTasks(50);
  ws.send(JSON.stringify({ type: "init", payload: { tasks }, timestamp: Date.now() }));
});

// ── REST API ──

app.post("/api/tasks", async (req, res) => {
  const { prompt, planner, model, lockSelectedModel, dryRun } = req.body;

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  // Return immediately after planning, execute in background via WebSocket updates
  try {
    const { task, plan } = await engine.plan(
      prompt,
      planner as PlannerBackend | undefined,
      model,
      !!lockSelectedModel,
    );

    res.json({ task, plan });

    if (!dryRun) {
      engine.executeTask(task).then(({ task: completedTask, results }) => {
        broadcast("taskCompleted", { task: completedTask, results });
      }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        broadcast("taskError", { taskId: task.id, error: message });
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/tasks/plan", async (req, res) => {
  const { prompt, planner, model, lockSelectedModel } = req.body;

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  try {
    const { task, plan } = await engine.plan(
      prompt,
      planner as PlannerBackend | undefined,
      model,
      !!lockSelectedModel,
    );
    res.json({ task, plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get("/api/tasks", (_req, res) => {
  const tasks = engine.listTasks(50);
  res.json({ tasks });
});

app.get("/api/tasks/:id", (req, res) => {
  const task = engine.getTask(req.params.id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ task });
});

app.post("/api/tasks/:id/cancel", (req, res) => {
  const success = engine.cancelTask(req.params.id);
  res.json({ success });
});

app.post("/api/tasks/:id/pause", (req, res) => {
  const success = engine.pauseTask(req.params.id);
  res.json({ success });
});

app.post("/api/tasks/:id/resume", (req, res) => {
  const success = engine.resumeTask(req.params.id);
  res.json({ success });
});

app.post("/api/tasks/:id/instructions", async (req, res) => {
  const { instruction, planner, model, lockSelectedModel, dryRun } = req.body;

  if (!instruction || typeof instruction !== "string") {
    res.status(400).json({ error: "instruction is required" });
    return;
  }

  try {
    const { parentTask, task, plan } = await engine.continueTask(
      req.params.id,
      instruction,
      planner as PlannerBackend | undefined,
      model,
      typeof lockSelectedModel === "boolean" ? lockSelectedModel : undefined,
    );

    res.json({ parentTaskId: parentTask.id, task, plan });

    if (!dryRun) {
      engine.executeTask(task).then(({ task: completedTask, results }) => {
        broadcast("taskCompleted", { task: completedTask, results });
      }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        broadcast("taskError", { taskId: task.id, error: message });
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get("/api/config", (_req, res) => {
  const config = loadConfig();
  // Don't expose full API keys
  res.json({
    planner: config.planner,
    ollamaUrl: config.ollamaUrl,
    ollamaModel: config.ollamaModel,
    webPort: config.webPort,
    apiPort: config.apiPort,
    defaultTimeout: config.defaultTimeout,
    maxRetries: config.maxRetries,
    hasAnthropicKey: !!config.anthropicApiKey,
    hasOpenaiKey: !!config.openaiApiKey,
    hasGoogleKey: !!config.googleApiKey,
  });
});

app.put("/api/config", (req, res) => {
  const updates = req.body;
  const allowedKeys = ["planner", "ollamaUrl", "ollamaModel", "defaultTimeout", "maxRetries",
    "anthropicApiKey", "openaiApiKey", "googleApiKey"];

  const filtered: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in updates) filtered[key] = updates[key];
  }

  saveConfig(filtered);
  res.json({ success: true });
});

app.get("/api/models/ollama", async (_req, res) => {
  try {
    const config = loadConfig();
    const models = await listOllamaModels(config.ollamaUrl);
    res.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.json({ models: [], error: message });
  }
});

// Serve static files in production
const clientDist = path.join(__dirname, "../client");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const config = loadConfig();
const port = config.apiPort;

server.listen(port, () => {
  console.log(`AgentForge API server running on http://localhost:${port}`);
  console.log(`WebSocket available at ws://localhost:${port}/ws`);
});
