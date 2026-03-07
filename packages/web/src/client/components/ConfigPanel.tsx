import React, { useState, useEffect } from "react";
import { AppConfig } from "../lib/types";

interface Props {
  apiBase: string;
}

export function ConfigPanel({ apiBase }: Props) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`${apiBase}/config`)
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
  }, [apiBase]);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      await fetch(`${apiBase}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      setMessage("Saved!");
      setEditing({});
      // Refresh config
      const res = await fetch(`${apiBase}/config`);
      setConfig(await res.json());
    } catch {
      setMessage("Failed to save");
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(""), 2000);
    }
  };

  if (!config) {
    return <div className="p-4 text-sm text-gray-500">Loading config...</div>;
  }

  const fields = [
    { key: "planner", label: "Default Planner", value: config.planner, type: "select", options: ["claude", "openai", "gemini", "ollama", "claudel"] },
    { key: "ollamaUrl", label: "Ollama URL", value: config.ollamaUrl, type: "text" },
    { key: "ollamaModel", label: "Ollama Model", value: config.ollamaModel, type: "text" },
    { key: "defaultTimeout", label: "Timeout (s)", value: String(config.defaultTimeout), type: "number" },
    { key: "maxRetries", label: "Max Retries", value: String(config.maxRetries), type: "number" },
  ];

  const apiKeyFields = [
    { key: "anthropicApiKey", label: "Anthropic API Key", configured: config.hasAnthropicKey },
    { key: "openaiApiKey", label: "OpenAI API Key", configured: config.hasOpenaiKey },
    { key: "googleApiKey", label: "Google API Key", configured: config.hasGoogleKey },
  ];

  return (
    <div className="p-4 space-y-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Settings</p>

      {fields.map(({ key, label, value, type, options }) => (
        <div key={key}>
          <label className="block text-xs text-gray-400 mb-1">{label}</label>
          {type === "select" ? (
            <select
              value={editing[key] ?? value}
              onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-forge-500"
            >
              {options?.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              type={type}
              value={editing[key] ?? value}
              onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-forge-500"
            />
          )}
        </div>
      ))}

      <div className="pt-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">API Keys</p>
        {apiKeyFields.map(({ key, label, configured }) => (
          <div key={key} className="mb-3">
            <label className="block text-xs text-gray-400 mb-1">
              {label}
              {configured && !editing[key] && (
                <span className="ml-2 text-green-500">configured</span>
              )}
            </label>
            <input
              type="password"
              placeholder={configured ? "••••••••" : "Not set"}
              value={editing[key] || ""}
              onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-forge-500"
            />
          </div>
        ))}
      </div>

      {Object.keys(editing).length > 0 && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-forge-600 hover:bg-forge-700 disabled:bg-gray-700 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      )}

      {message && (
        <p className={`text-xs text-center ${message === "Saved!" ? "text-green-400" : "text-red-400"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
