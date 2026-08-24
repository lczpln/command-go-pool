import pino from "pino";
import { EventEmitter } from "node:events";
import type { ProxyEvent } from "@command-go-proxy/shared";

export function createLogger(level = process.env.COMMAND_GO_PROXY_LOG_LEVEL ?? "info") {
  const pretty = process.stdout.isTTY && !process.env.CI;
  return pino({
    level,
    redact: {
      paths: [
        "apiKey",
        "credential",
        "authorization",
        "headers.authorization",
        "req.headers.authorization",
        "req.body.credential",
        "req.body.apiKey",
        "req.body.server.apiKey",
      ],
      censor: "[redacted]",
    },
    transport: pretty ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } : undefined,
  });
}

export class EventBus extends EventEmitter {
  emitEvent(event: ProxyEvent): void {
    this.emit("event", event);
    this.emit(event.type, event);
  }

  onEvent(handler: (event: ProxyEvent) => void): () => void {
    this.on("event", handler);
    return () => this.off("event", handler);
  }
}
