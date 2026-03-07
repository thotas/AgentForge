import { useEffect, useRef, useCallback, useState } from "react";
import { WsMessage, Task, AgentEvent } from "../lib/types";

interface UseWebSocketReturn {
  connected: boolean;
  tasks: Task[];
  agentLogs: Map<string, string[]>;
  agentStatuses: Map<string, string>;
  errors: Map<string, string>;
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agentLogs, setAgentLogs] = useState<Map<string, string[]>>(new Map());
  const [agentStatuses, setAgentStatuses] = useState<Map<string, string>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          handleMessage(msg);
        } catch {}
      };
    }

    function handleMessage(msg: WsMessage) {
      switch (msg.type) {
        case "init": {
          const data = msg.payload as { tasks: Task[] };
          setTasks(data.tasks);
          break;
        }
        case "taskCreated": {
          const task = msg.payload as Task;
          setTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
          break;
        }
        case "planReady": {
          const { task } = msg.payload as { task: Task };
          setTasks((prev) => {
            if (prev.some((t) => t.id === task.id)) {
              return prev.map((t) => (t.id === task.id ? task : t));
            }
            return [task, ...prev];
          });
          break;
        }
        case "taskUpdated": {
          const task = msg.payload as Task;
          setTasks((prev) => {
            if (prev.some((t) => t.id === task.id)) {
              return prev.map((t) => (t.id === task.id ? task : t));
            }
            return [task, ...prev];
          });
          break;
        }
        case "agentEvent": {
          const event = msg.payload as AgentEvent;
          const key = `${event.taskId}:${event.agentId}`;

          if (event.type === "log" || event.type === "error") {
            setAgentLogs((prev) => {
              const next = new Map(prev);
              const existing = next.get(key) || [];
              next.set(key, [...existing, event.data]);
              return next;
            });
          }

          if (event.type === "status") {
            setAgentStatuses((prev) => {
              const next = new Map(prev);
              next.set(key, event.data);
              return next;
            });
          }
          break;
        }
        case "taskCompleted": {
          const { task } = msg.payload as { task: Task };
          setTasks((prev) => {
            if (prev.some((t) => t.id === task.id)) {
              return prev.map((t) => (t.id === task.id ? task : t));
            }
            return [task, ...prev];
          });
          break;
        }
        case "taskError": {
          const { taskId, error } = msg.payload as { taskId: string; error: string };
          setErrors((prev) => {
            const next = new Map(prev);
            next.set(taskId, error);
            return next;
          });
          // Mark task as failed in the list
          setTasks((prev) => prev.map((t) =>
            t.id === taskId ? { ...t, status: "failed" as const } : t
          ));
          break;
        }
      }
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [url]);

  return { connected, tasks, agentLogs, agentStatuses, errors };
}
