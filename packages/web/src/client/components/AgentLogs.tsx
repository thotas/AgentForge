import React, { useState, useEffect, useRef } from "react";
import { Task } from "../lib/types";

interface Props {
  task: Task;
  agentLogs: Map<string, string[]>;
  agentStatuses: Map<string, string>;
}

const TYPE_COLORS: Record<string, string> = {
  "claude-code": "text-amber-400",
  codex: "text-emerald-400",
  "gemini-cli": "text-blue-400",
  ollama: "text-violet-400",
  shell: "text-gray-400",
  "web-fetch": "text-pink-400",
};

export function AgentLogs({ task, agentLogs, agentStatuses }: Props) {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const logEndRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const agents = task.plan?.agents || [];

  useEffect(() => {
    setExpandedAgents(new Set());
  }, [task.id]);

  // Auto-expand running agents
  useEffect(() => {
    for (const agent of agents) {
      const key = `${task.id}:${agent.id}`;
      const status = agentStatuses.get(key);
      if (status === "running") {
        setExpandedAgents((prev) => new Set(prev).add(agent.id));
      }
    }
  }, [agentStatuses, agents, task.id]);

  // Auto-expand agents that have persisted output so completed tasks show results immediately
  useEffect(() => {
    if (task.results.length === 0) return;
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      for (const result of task.results) {
        if (result.output || result.error) {
          next.add(result.agentId);
        }
      }
      return next;
    });
  }, [task.results]);

  // Auto-scroll logs
  useEffect(() => {
    for (const [key, ref] of logEndRefs.current) {
      ref?.scrollIntoView({ behavior: "smooth" });
    }
  }, [agentLogs, task.results]);

  const toggleAgent = (agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  if (agents.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500">
        Waiting for execution plan...
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-800">
      {agents.map((agent) => {
        const key = `${task.id}:${agent.id}`;
        const logs = agentLogs.get(key) || [];
        const liveOutput = logs.join("");
        const status = agentStatuses.get(key) || "pending";
        const isExpanded = expandedAgents.has(agent.id);
        const typeColor = TYPE_COLORS[agent.type] || "text-gray-400";
        const result = task.results.find((r) => r.agentId === agent.id);
        const savedOutput = result?.output || "";
        const finalOutput = liveOutput || savedOutput;

        return (
          <div key={agent.id}>
            <button
              onClick={() => toggleAgent(agent.id)}
              className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-800/50 transition-colors text-left"
            >
              <svg
                className={`w-3 h-3 text-gray-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M6.293 7.293a1 1 0 011.414 0L10 9.586l2.293-2.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" />
              </svg>
              <span className={`text-xs font-mono font-medium ${typeColor}`}>
                [{agent.type}]
              </span>
              <span className="text-sm text-gray-300 flex-1 truncate">{agent.purpose}</span>
              <StatusDot status={result?.status || status} />
              {(logs.length > 0 || savedOutput) && (
                <span className="text-xs text-gray-600">
                  {logs.length > 0 ? `${logs.length} lines` : "saved output"}
                </span>
              )}
            </button>

            {isExpanded && (
              <div className="bg-gray-950 border-t border-gray-800 max-h-80 overflow-y-auto">
                {!finalOutput ? (
                  <div className="px-4 py-3 text-xs text-gray-600">
                    {status === "running" ? "Waiting for output..." : "No output yet"}
                  </div>
                ) : (
                  <pre className="agent-log px-4 py-2 text-gray-400 whitespace-pre-wrap break-all">
                    {finalOutput}
                    <div ref={(el) => { if (el) logEndRefs.current.set(agent.id, el); }} />
                  </pre>
                )}
                {result?.error && (
                  <div className="px-4 py-2 text-xs text-red-400 bg-red-900/10 border-t border-red-900/20">
                    Error: {result.error}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-gray-600",
    running: "bg-yellow-500 status-running",
    paused: "bg-orange-500",
    success: "bg-green-500",
    failed: "bg-red-500",
    cancelled: "bg-gray-500",
  };

  return <div className={`w-2 h-2 rounded-full ${colors[status] || colors.pending}`} />;
}
