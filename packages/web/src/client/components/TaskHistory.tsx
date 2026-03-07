import React from "react";
import { Task } from "../lib/types";

interface Props {
  tasks: Task[];
  selectedId?: string;
  onSelect: (task: Task) => void;
  label?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-600",
  planning: "bg-blue-500",
  running: "bg-yellow-500 status-running",
  paused: "bg-orange-500",
  success: "bg-green-500",
  failed: "bg-red-500",
  cancelled: "bg-gray-500",
};

export function TaskHistory({ tasks, selectedId, onSelect, label }: Props) {
  return (
    <div>
      {label && (
        <div className="px-4 pt-3 pb-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        </div>
      )}
      {tasks.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-600">
          No tasks
        </div>
      ) : (
        <div className="divide-y divide-gray-800/50">
          {tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => onSelect(task)}
              className={`w-full text-left px-4 py-3 hover:bg-gray-800/50 transition-colors ${
                selectedId === task.id ? "bg-gray-800/70 border-l-2 border-forge-500" : ""
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[task.status] || "bg-gray-600"}`} />
                <span className="text-xs text-gray-500 font-mono">{task.id.slice(0, 8)}</span>
                <span className="text-xs text-gray-600 ml-auto">
                  {formatRelativeTime(task.createdAt)}
                </span>
              </div>
              <p className="text-sm text-gray-300 line-clamp-2">{task.prompt}</p>
              {task.plan && (
                <div className="flex gap-2 mt-1.5">
                  {task.plan.agents.slice(0, 3).map((agent) => (
                    <span key={agent.id} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">
                      {agent.type}
                    </span>
                  ))}
                  {task.plan.agents.length > 3 && (
                    <span className="text-[10px] text-gray-600">+{task.plan.agents.length - 3}</span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
