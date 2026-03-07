import React, { useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { TaskInput } from "./components/TaskInput";
import { ExecutionView } from "./components/ExecutionView";
import { AgentLogs } from "./components/AgentLogs";
import { TaskHistory } from "./components/TaskHistory";
import { ConfigPanel } from "./components/ConfigPanel";
import { Task } from "./lib/types";

type Tab = "execute" | "history" | "config";

const API_BASE = "/api";
const WS_URL = `ws://${window.location.hostname}:3001/ws`;

export default function App() {
  const { connected, tasks, agentLogs, agentStatuses, errors } = useWebSocket(WS_URL);
  const [activeTab, setActiveTab] = useState<Tab>("execute");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isControllingTask, setIsControllingTask] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [isSubmittingInstruction, setIsSubmittingInstruction] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (
    prompt: string,
    planner: string,
    model?: string,
    lockSelectedModel = false,
  ) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, planner, model, lockSelectedModel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || `Server error (${res.status})`);
        return;
      }
      if (data.task) setSelectedTask(data.task);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to connect to server");
    } finally {
      setIsSubmitting(false);
    }
  };

  const controlTask = async (taskId: string, action: "pause" | "resume" | "cancel") => {
    setIsControllingTask(true);
    setSubmitError(null);

    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setSubmitError(data.error || `Failed to ${action} task`);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : `Failed to ${action} task`);
    } finally {
      setIsControllingTask(false);
    }
  };

  const submitInstruction = async (taskId: string) => {
    if (!instruction.trim()) return;
    setIsSubmittingInstruction(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/instructions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instruction.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || `Failed to submit instruction`);
        return;
      }
      if (data.task) {
        setSelectedTask(data.task as Task);
      }
      setInstruction("");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit instruction");
    } finally {
      setIsSubmittingInstruction(false);
    }
  };

  // Keep selectedTask in sync with WebSocket updates
  const selectedId = selectedTask?.id;
  const activeTask = (selectedId ? tasks.find((t) => t.id === selectedId) : null)
    || tasks.find((t) => t.status === "running")
    || tasks.find((t) => t.status === "paused")
    || tasks[0];
  const latestCompletedWithOutput = tasks
    .filter((task) =>
      ["success", "failed", "cancelled"].includes(task.status)
      && task.results.some((result) => !!result.output),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <div className="w-72 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-yellow-400">⚡</span> AgentForge
          </h1>
          <p className="text-xs text-gray-500 mt-1">Multi-Model Agent Orchestrator</p>
          <div className="flex items-center gap-1.5 mt-2">
            <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-xs text-gray-400">{connected ? "Connected" : "Disconnected"}</span>
          </div>
        </div>

        {/* Nav tabs */}
        <div className="flex border-b border-gray-800">
          {(["execute", "history", "config"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-3 py-2.5 text-xs font-medium capitalize transition-colors ${
                activeTab === tab
                  ? "text-forge-400 border-b-2 border-forge-400 bg-gray-800/50"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Sidebar content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "history" && (
            <TaskHistory
              tasks={tasks}
              selectedId={selectedTask?.id}
              onSelect={(task) => {
                setSelectedTask(task);
                setActiveTab("execute");
              }}
            />
          )}
          {activeTab === "config" && <ConfigPanel apiBase={API_BASE} />}
          {activeTab === "execute" && (
            <TaskHistory
              tasks={tasks.filter((t) => ["running", "planning", "paused"].includes(t.status))}
              selectedId={selectedTask?.id}
              onSelect={(task) => setSelectedTask(task)}
              label="Active Tasks"
            />
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Task input */}
        <div className="border-b border-gray-800 bg-gray-900/50">
          <TaskInput onSubmit={handleSubmit} isSubmitting={isSubmitting} />
        </div>
        <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/30 flex items-center justify-between">
          <span className="text-xs text-gray-500">Task details and outputs</span>
          <button
            onClick={() => {
              if (!latestCompletedWithOutput) return;
              setSelectedTask(latestCompletedWithOutput);
              setActiveTab("execute");
            }}
            disabled={!latestCompletedWithOutput}
            className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Open latest completed output
          </button>
        </div>

        {/* Error banners */}
        {submitError && (
          <div className="px-4 py-2 bg-red-900/30 border-b border-red-800 text-sm text-red-300 flex items-center justify-between">
            <span>Error: {submitError}</span>
            <button onClick={() => setSubmitError(null)} className="text-red-400 hover:text-red-200 ml-4 text-xs">dismiss</button>
          </div>
        )}
        {activeTask && errors.get(activeTask.id) && (
          <div className="px-4 py-2 bg-red-900/30 border-b border-red-800 text-sm text-red-300">
            Execution error: {errors.get(activeTask.id)}
          </div>
        )}
        {activeTask && (activeTask.status === "running" || activeTask.status === "paused") && (
          <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/40 flex items-center gap-2">
            <span className="text-xs text-gray-400">
              Task <span className="font-mono text-gray-300">{activeTask.id.slice(0, 8)}</span>
            </span>
            {activeTask.status === "running" ? (
              <button
                onClick={() => controlTask(activeTask.id, "pause")}
                disabled={isControllingTask}
                className="text-xs px-2 py-1 rounded border border-orange-700/60 text-orange-300 hover:bg-orange-900/20 disabled:opacity-50"
              >
                Pause
              </button>
            ) : (
              <button
                onClick={() => controlTask(activeTask.id, "resume")}
                disabled={isControllingTask}
                className="text-xs px-2 py-1 rounded border border-blue-700/60 text-blue-300 hover:bg-blue-900/20 disabled:opacity-50"
              >
                Resume
              </button>
            )}
            <button
              onClick={() => controlTask(activeTask.id, "cancel")}
              disabled={isControllingTask}
              className="text-xs px-2 py-1 rounded border border-red-700/60 text-red-300 hover:bg-red-900/20 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
        {activeTask && (
          <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/30">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400">
                Send additional instructions to this task ({activeTask.status})
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Add guidance, feedback, or corrections..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-forge-500"
              />
              <button
                onClick={() => submitInstruction(activeTask.id)}
                disabled={!instruction.trim() || isSubmittingInstruction}
                className="text-xs px-3 py-1.5 rounded border border-forge-700/70 text-forge-300 hover:bg-forge-900/20 disabled:opacity-50"
              >
                {isSubmittingInstruction ? "Sending..." : "Send Instruction"}
              </button>
            </div>
          </div>
        )}

        {/* Execution area */}
        <div className="flex-1 flex overflow-hidden">
          {activeTask ? (
            <>
              {/* Plan / DAG view */}
              <div className="w-1/2 border-r border-gray-800 overflow-y-auto p-4">
                <ExecutionView
                  task={activeTask}
                  agentStatuses={agentStatuses}
                />
              </div>

              {/* Agent logs */}
              <div className="w-1/2 overflow-y-auto">
                <AgentLogs
                  task={activeTask}
                  agentLogs={agentLogs}
                  agentStatuses={agentStatuses}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-600">
              <div className="text-center">
                <p className="text-5xl mb-4">⚡</p>
                <p className="text-lg font-medium">No tasks yet</p>
                <p className="text-sm mt-1">Enter a task above to get started</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
