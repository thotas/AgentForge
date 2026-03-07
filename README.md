# ⚡ AgentForge — Multi-Model Agent Orchestrator

AgentForge accepts tasks from users, generates execution plans using AI models, and orchestrates specialized agents across multiple backends (Claude Code, Codex, Gemini CLI, Ollama, shell, HTTP).

```
                          ┌──────────────────┐
                          │   User Task      │
                          └────────┬─────────┘
                                   │
                          ┌────────▼─────────┐
                          │  Planner Model   │
                          │ (Claude/GPT/     │
                          │  Gemini/Ollama)  │
                          └────────┬─────────┘
                                   │ JSON Plan
                          ┌────────▼─────────┐
                          │ Execution Engine │
                          │ (DAG Scheduler)  │
                          └────────┬─────────┘
                  ┌────────┬───────┴────┬──────────┐
            ┌─────▼──┐ ┌───▼───┐ ┌─────▼───┐ ┌────▼────┐
            │ Claude │ │ Codex │ │ Gemini  │ │ Ollama  │
            │  Code  │ │  CLI  │ │  CLI    │ │  Local  │
            └────────┘ └───────┘ └─────────┘ └─────────┘
                  ┌────────┬───────┘
            ┌─────▼──┐ ┌───▼───┐
            │ Shell  │ │  HTTP │
            │Commands│ │ Fetch │
            └────────┘ └───────┘
```

## Quick Start

```bash
# Install dependencies and build
npm install && npm run setup

# Interactive config wizard
node packages/cli/dist/index.js config init

# Run a task
node packages/cli/dist/index.js run "Build a REST API for a todo app"

# Or with options
node packages/cli/dist/index.js run "Refactor for performance" --planner ollama --model llama3.2
```

## Installation

**Requirements:** Node.js 18+

```bash
git clone <repo-url> agentforge
cd agentforge
npm install
npm run build
```

After building, add the CLI to your path (optional):

```bash
# Add to ~/.zshrc or ~/.bashrc
alias agentforge="node $(pwd)/packages/cli/dist/index.js"
```

## Configuration

AgentForge stores config at `~/.agentforge/config.json`. Set up via CLI or environment variables.

### CLI Setup

```bash
agentforge config init          # Interactive wizard
agentforge config set planner claude
agentforge config set ollama-url http://localhost:11434
agentforge config show          # View current config
```

### Environment Variables

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=AIza...
export OLLAMA_URL=http://localhost:11434
export AGENTFORGE_PLANNER=claude       # Default planner backend (claude/openai/gemini/ollama/claudel)
export AGENTFORGE_OLLAMA_MODEL=llama3.2
export AGENTFORGE_OLLAMA_CLOUD_URL=     # Optional Ollama-compatible cloud endpoint
export AGENTFORGE_OLLAMA_CLOUD_MODELS=  # Optional comma-separated cloud model list
```

## CLI Usage

### Run a Task

```bash
# Basic usage — sends to planner, shows plan, executes agents
agentforge run "Build me a REST API with Express and tests"

# Specify planner backend
agentforge run "Optimize database queries" --planner openai --model gpt-4o

# Use claudel backend (Claude CLI pointed at Ollama-compatible endpoint)
agentforge run "Implement a parser" --planner claudel

# Use local Ollama model
agentforge run "Write unit tests for auth module" --planner ollama --model llama3.2

# Preview plan without executing
agentforge run "Refactor the codebase" --dry-run

# Skip confirmation (YOLO mode)
agentforge run "Add logging" --auto
```

### Task Management

```bash
agentforge status              # Show running tasks
agentforge status --all        # Show all recent tasks
agentforge history             # List past tasks
agentforge history --id <id>   # View full task details
```

### Model Management

```bash
agentforge models list         # Show configured backends and Ollama models
```

## Web Dashboard

Start the web UI for a visual experience:

```bash
cd packages/web
npm run dev
# Open http://localhost:3000
```

Features:
- **Task Input** — text area + model selector
- **Live Execution View** — real-time agent status DAG with color-coded states
- **Agent Log Streams** — expandable panels showing live stdout per agent
- **Task History** — sidebar with all past tasks
- **Config Panel** — set API keys and defaults through the UI
- **WebSocket** — all updates stream in real-time

## Agent Types

| Type | Description | Requirements |
|------|-------------|--------------|
| `claude-code` | Claude Code CLI for complex coding tasks | `claude` CLI installed, `ANTHROPIC_API_KEY` |
| `codex` | OpenAI Codex CLI for code generation | `codex` CLI installed, `OPENAI_API_KEY` |
| `gemini-cli` | Google Gemini CLI for analysis | `gemini` CLI installed, `GOOGLE_API_KEY` |
| `ollama` | Local LLM via Ollama HTTP API | Ollama running locally |
| `shell` | Shell command execution | None |
| `web-fetch` | HTTP requests for data gathering | None |

## How It Works

1. **User submits a task** via CLI or web UI
2. **Planner model** (Claude/GPT/Gemini/Ollama) generates a JSON execution plan
3. **Execution engine** parses the plan and schedules agents based on execution order (sequential, parallel, or DAG)
4. **Agents execute** — CLI processes are spawned, HTTP calls are made, shell commands are run
5. **Output streams** in real-time to CLI and/or WebSocket clients
6. **Results are stored in files** under `~/.agentforge/outputs/`
7. **SQLite stores task metadata + output file paths** at `~/.agentforge/agentforge.db`
8. **Model fallback is automatic** — planner/agents try the next suitable model if the current one fails; for Ollama/Claudel, cloud models are tried before local models

## Project Structure

```
agentforge/
├── packages/
│   ├── core/              # Engine, planner, agent launchers, config, DB
│   │   └── src/
│   │       ├── agents/    # Agent implementations (claude, codex, gemini, ollama, shell, web-fetch)
│   │       ├── config/    # Config loading/saving
│   │       ├── db/        # SQLite persistence
│   │       ├── engine/    # DAG executor + orchestrator
│   │       ├── planner/   # Multi-backend planner with schema validation
│   │       └── types.ts   # Shared TypeScript types + Zod schemas
│   ├── cli/               # CLI interface (Commander + Chalk + Ora)
│   │   └── src/
│   │       ├── commands/  # run, status, history, config, models
│   │       └── ui/        # Formatting, colors, spinners
│   └── web/               # React dashboard + Express API + WebSocket
│       └── src/
│           ├── client/    # React + Tailwind frontend
│           └── server/    # Express + WS backend
├── .env.example
├── package.json           # npm workspaces root
└── README.md
```

## Execution Plan Schema

The planner outputs JSON matching this schema (validated with Zod):

```json
{
  "task_summary": "Build a REST API with CRUD endpoints",
  "agents": [
    {
      "id": "agent_1",
      "type": "shell",
      "purpose": "Initialize project",
      "prompt": "mkdir -p todo-api && cd todo-api && npm init -y",
      "depends_on": [],
      "timeout_seconds": 30
    },
    {
      "id": "agent_2",
      "type": "claude-code",
      "purpose": "Generate API code",
      "prompt": "Create an Express REST API with CRUD endpoints for todos...",
      "depends_on": ["agent_1"],
      "timeout_seconds": 300
    }
  ],
  "execution_order": "dag",
  "success_criteria": "API server starts and all endpoints return valid responses"
}
```

## License

MIT
