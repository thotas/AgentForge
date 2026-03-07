import React, { useState, useEffect } from "react";

interface Props {
  onSubmit: (prompt: string, planner: string, model?: string, lockSelectedModel?: boolean) => void;
  isSubmitting: boolean;
}

export function TaskInput({ onSubmit, isSubmitting }: Props) {
  const [prompt, setPrompt] = useState("");
  const [planner, setPlanner] = useState("ollama");
  const [lockSelectedModel, setLockSelectedModel] = useState(false);

  // Load default planner from server config
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.planner) setPlanner(cfg.planner);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isSubmitting) return;
    onSubmit(prompt.trim(), planner, undefined, lockSelectedModel);
    setPrompt("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your task... (Cmd+Enter to submit)"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-forge-500 focus:border-transparent resize-none"
            rows={2}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex flex-col gap-2">
          <select
            value={planner}
            onChange={(e) => setPlanner(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:ring-2 focus:ring-forge-500"
          >
            <option value="claude">Claude</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
            <option value="ollama">Ollama</option>
            <option value="claudel">Claudel</option>
          </select>
          <button
            type="button"
            onClick={() => setLockSelectedModel((prev) => !prev)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              lockSelectedModel
                ? "border-forge-500 bg-forge-900/40 text-forge-200"
                : "border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200"
            }`}
          >
            {lockSelectedModel ? "Model Lock: On" : "Model Lock: Off"}
          </button>
          <button
            type="submit"
            disabled={!prompt.trim() || isSubmitting}
            className="bg-forge-600 hover:bg-forge-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Running
              </span>
            ) : (
              "Execute"
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
