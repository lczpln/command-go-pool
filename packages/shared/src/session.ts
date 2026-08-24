import { createHash, randomBytes } from "node:crypto";
import type { NormalizedRequest } from "./types.js";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprintSession(request: NormalizedRequest): string {
  const system = request.system ?? firstText(request.messages.filter((m) => m.role === "system"));
  const firstUser = firstText(request.messages.filter((m) => m.role === "user"));
  const collision = sha256(`${firstUser.length}:${request.model}`).slice(0, 6);
  const material = [request.model, system, firstUser, collision].join("\u001f");
  return `fp_${sha256(material).slice(0, 20)}`;
}

export function identifySession(request: NormalizedRequest, headers: Record<string, string | undefined>): {
  id: string;
  source: string;
  sticky: boolean;
} {
  const stickyHeader = headers["x-command-go-sticky"];
  const sticky = request.sticky !== false && stickyHeader !== "0" && stickyHeader !== "false";
  const explicit = headers["x-command-go-session"] || request.sessionHint;
  if (explicit) return { id: explicit, source: "header", sticky };
  const meta = request.metadata ?? {};
  const fromMeta =
    stringish(meta.session) ||
    stringish(meta.session_id) ||
    stringish(meta.sessionId) ||
    stringish(meta["user_id"]) ||
    stringish(meta.userId);
  if (fromMeta) return { id: fromMeta, source: "metadata", sticky };
  if (request.promptCacheKey) return { id: `pck_${sha256(request.promptCacheKey).slice(0, 20)}`, source: "prompt_cache_key", sticky };
  return { id: fingerprintSession(request), source: "fingerprint", sticky };
}

function firstText(messages: { content: { type: string; text?: string }[] }[]): string {
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "text" && part.text) return part.text.slice(0, 2000);
    }
  }
  return "";
}

function stringish(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
