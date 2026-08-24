import { describe, expect, it } from "vitest";
import { parseNdjsonLine, parseCreditsPayload, buildEnvelope } from "@command-go-proxy/transport-commandcode";
import { openaiToNormalized, openaiChatSchema } from "@command-go-proxy/protocol-openai";
import { anthropicToNormalized, anthropicMessageSchema } from "@command-go-proxy/protocol-anthropic";

describe("transport ndjson", () => {
  it("maps text and tool events", () => {
    expect(parseNdjsonLine('{"type":"text-delta","text":"Hi"}')).toEqual({ type: "text-delta", text: "Hi" });
    const tool = parseNdjsonLine('{"type":"tool-call","toolCallId":"c1","toolName":"read","input":{"p":1}}');
    expect(tool).toMatchObject({ type: "tool-call", id: "c1", name: "read" });
  });

  it("builds a strict config envelope", () => {
    const env = buildEnvelope({
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      stream: true,
    });
    const config = env.config as Record<string, unknown>;
    for (const key of ["workingDir", "date", "environment", "structure", "isGitRepo", "currentBranch", "mainBranch", "gitStatus", "recentCommits"]) {
      expect(config[key], key).toBeDefined();
    }
  });

  it("parses credits without inventing windows", () => {
    const quota = parseCreditsPayload({ credits: { monthlyCredits: 7.2 } });
    expect(quota.monthly?.remaining).toBe(7.2);
    expect(quota.monthly?.confidence).toBe("exact");
    expect(quota.fiveHour?.confidence).toBe("unknown");
  });
});

describe("protocol mapping", () => {
  it("maps openai images and tools", () => {
    const body = openaiChatSchema.parse({
      model: "flash",
      messages: [
        { role: "user", content: [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }] },
      ],
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
    });
    const n = openaiToNormalized(body, { flash: "deepseek/deepseek-v4-flash" });
    expect(n.model).toBe("deepseek/deepseek-v4-flash");
    expect(n.messages[0]?.content.some((p) => p.type === "image")).toBe(true);
    expect(n.tools?.[0]?.name).toBe("lookup");
  });

  it("maps anthropic tool_result to role tool", () => {
    const body = anthropicMessageSchema.parse({
      model: "m",
      max_tokens: 32,
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
        },
      ],
    });
    const n = anthropicToNormalized(body, {});
    expect(n.messages[0]?.role).toBe("tool");
  });
});
