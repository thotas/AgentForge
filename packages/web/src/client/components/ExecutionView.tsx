import React from "react";
import { Task } from "../lib/types";

interface Props {
  task: Task;
  agentStatuses: Map<string, string>;
}

const TYPE_COLORS: Record<string, string> = {
  "claude-code": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  codex: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "gemini-cli": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  ollama: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  shell: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  "web-fetch": "bg-pink-500/20 text-pink-400 border-pink-500/30",
};

const STATUS_INDICATORS: Record<string, { color: string; label: string }> = {
  pending: { color: "bg-gray-500", label: "Pending" },
  running: { color: "bg-yellow-500 status-running", label: "Running" },
  success: { color: "bg-green-500", label: "Done" },
  failed: { color: "bg-red-500", label: "Failed" },
  cancelled: { color: "bg-gray-600", label: "Cancelled" },
};

export function ExecutionView({ task, agentStatuses }: Props) {
  const plan = task.plan;

  return (
    <div>
      {/* Task header */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <StatusBadge status={task.status} />
          <span className="text-xs text-gray-500 font-mono">{task.id.slice(0, 8)}</span>
        </div>
        <p className="text-sm text-gray-300">{task.prompt}</p>
        {task.results.length > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            Output saved to folder: <span className="font-mono">~/.agentforge/outputs/</span>
          </p>
        )}
      </div>

      {!plan ? (
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-forge-400" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Generating execution plan...
        </div>
      ) : (
        <>
          {/* Plan summary */}
          <div className="bg-gray-800/50 rounded-lg p-3 mb-4 border border-gray-700/50">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Plan</p>
            <p className="text-sm text-gray-200">{plan.task_summary}</p>
            <div className="flex gap-3 mt-2">
              <span className="text-xs text-gray-500">
                Mode: <span className="text-gray-300">{plan.execution_order}</span>
              </span>
              <span className="text-xs text-gray-500">
                Agents: <span className="text-gray-300">{plan.agents.length}</span>
              </span>
            </div>
          </div>

          {/* Agent DAG */}
          <div className="space-y-2">
            {plan.agents.map((agent, idx) => {
              const key = `${task.id}:${agent.id}`;
              const status = agentStatuses.get(key) || "pending";
              const resultData = task.results.find((r) => r.agentId === agent.id);
              const finalStatus = resultData?.status || status;
              const indicator = STATUS_INDICATORS[finalStatus] || STATUS_INDICATORS.pending;
              const typeColor = TYPE_COLORS[agent.type] || TYPE_COLORS.shell;

              return (
                <div
                  key={agent.id}
                  className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/40 hover:border-gray-600/60 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-2 h-2 rounded-full ${indicator.color}`} />
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${typeColor}`}>
                      {agent.type}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">{agent.id}</span>
                    {resultData && (
                      <span className="text-xs text-gray-500 ml-auto">
                        {(resultData.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-300 ml-4">{agent.purpose}</p>
                  {agent.depends_on.length > 0 && (
                    <p className="text-xs text-gray-600 ml-4 mt-1">
                      depends on: {agent.depends_on.join(", ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Success criteria */}
          <div className="mt-4 p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Success Criteria</p>
            <p className="text-sm text-gray-400">{plan.success_criteria}</p>
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-gray-700 text-gray-300",
    planning: "bg-blue-900/50 text-blue-400",
    running: "bg-yellow-900/50 text-yellow-400",
    paused: "bg-orange-900/50 text-orange-400",
    success: "bg-green-900/50 text-green-400",
    failed: "bg-red-900/50 text-red-400",
    cancelled: "bg-gray-700 text-gray-400",
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] || styles.pending}`}>
      {status}
    </span>
  );
}
