import * as https from "https";
import * as http from "http";
import { BaseAgent } from "./base";
import { AgentDefinition, AgentResult } from "../types";

export class WebFetchAgent extends BaseAgent {
  constructor(definition: AgentDefinition, taskId: string) {
    super(definition, taskId);
  }

  async execute(previousOutputs: Map<string, string>): Promise<AgentResult> {
    this.startTime = Date.now();
    this.status = "running";
    this.emitEvent("status", "running");

    const input = this.interpolatePrompt(this.definition.prompt, previousOutputs);

    try {
      // Prompt can be a URL or JSON with url + method + headers + body
      const config = this.parseInput(input);
      const response = await this.fetch(config);
      this.output = response;
      this.emitEvent("log", response.slice(0, 2000) + (response.length > 2000 ? "\n... (truncated)" : ""));
      this.status = "success";
      this.emitEvent("status", "success");
      return this.buildResult("success");
    } catch (err) {
      if (this.isCancelled() || this.isAbortError(err)) {
        this.status = "cancelled";
        this.emitEvent("status", "cancelled");
        return this.buildResult("cancelled", "Cancelled by user");
      }
      this.status = "failed";
      this.emitEvent("status", "failed");
      return this.buildResult("failed", err instanceof Error ? err.message : String(err));
    }
  }

  private parseInput(input: string): FetchConfig {
    const trimmed = input.trim();

    // If it looks like JSON, parse it
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return {
          url: parsed.url,
          method: parsed.method || "GET",
          headers: parsed.headers || {},
          body: parsed.body,
        };
      } catch {}
    }

    // Otherwise treat as a plain URL
    return { url: trimmed, method: "GET", headers: {} };
  }

  private fetch(config: FetchConfig): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(config.url);
      const isHttps = url.protocol === "https:";
      const client = isHttps ? https : http;

      const req = client.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: config.method,
        headers: {
          "User-Agent": "AgentForge/1.0",
          ...config.headers,
        },
        signal: this.abortController.signal,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
          } else {
            resolve(body);
          }
        });
      });

      const timeout = setTimeout(() => {
        req.destroy();
        reject(new Error("Request timed out"));
      }, this.definition.timeout_seconds * 1000);

      req.on("error", (err) => { clearTimeout(timeout); reject(err); });
      req.on("close", () => clearTimeout(timeout));

      if (config.body) req.write(typeof config.body === "string" ? config.body : JSON.stringify(config.body));
      req.end();
    });
  }
}

interface FetchConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}
