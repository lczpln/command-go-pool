import { afterEach, describe, expect, it } from "vitest";
import { withServer, poolHeaders } from "../helpers.js";

function containsSecret(value: unknown, secrets: string[]): boolean {
  const raw = JSON.stringify(value);
  return secrets.some((s) => raw.includes(s));
}

describe("security gates", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("allows inference and admin routes when bound off loopback without an API key", async () => {
    const instance = await withServer({
      config: { server: { host: "0.0.0.0", port: 0 } },
      setup(_t, add) {
        add("Go #01");
      },
    });
    const v1 = await instance.app.inject({ method: "GET", url: "/v1/models" });
    const api = await instance.app.inject({ method: "GET", url: "/api/health" });
    expect(v1.statusCode).toBe(200);
    expect(api.statusCode).toBe(200);
    await instance.close();
  });

  it("requires the pool API key on external bind when one is set", async () => {
    const instance = await withServer({
      config: { server: { host: "0.0.0.0", port: 0, apiKey: "pool-secret" } },
      setup(_t, add) {
        add("Go #01");
      },
    });
    const denied = await instance.app.inject({ method: "GET", url: "/v1/models" });
    expect(denied.statusCode).toBe(401);
    const ok = await instance.app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer pool-secret" },
    });
    expect(ok.statusCode).toBe(200);
    await instance.close();
  });

  it("never returns credentials from admin JSON", async () => {
    const secret = "user_super_secret_credential";
    const instance = await withServer({
      setup(_t, _add, boot) {
        boot.runtime.pool.add({ label: "Go #01", apiKey: secret });
      },
    });
    const paths = ["/api/accounts", "/api/config", "/api/events", "/api/health", "/api/sessions", "/api/usage", "/api/oauth/usage", "/v1/usage"];
    for (const path of paths) {
      const res = await instance.app.inject({
        method: "GET",
        url: path,
        headers: path.startsWith("/v1/") ? poolHeaders(instance) : undefined,
      });
      expect(res.statusCode).toBe(200);
      expect(containsSecret(res.json(), [secret])).toBe(false);
      expect(JSON.stringify(res.json())).not.toMatch(/credentialRef/);
    }
    await instance.close();
  });

  it("redacts the pool API key from config", async () => {
    const instance = await withServer({
      config: { server: { apiKey: "pool-local-key" } },
    });
    const res = await instance.app.inject({
      method: "GET",
      url: "/api/config",
      headers: { authorization: "Bearer pool-local-key" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toContain("pool-local-key");
    expect(JSON.stringify(res.json())).toContain("[set]");
    await instance.close();
  });

  it("accepts accounts on loopback admin without sending the pool key and never echoes the credential", async () => {
    const secret = "user_web_form_secret_xyz";
    const instance = await withServer();
    const created = await instance.app.inject({
      method: "POST",
      url: "/api/accounts",
      payload: { label: "Go #01", credential: secret, monthlySubscriptionCost: 1 },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json() as { account: { id: string; label: string }; test: { ok: boolean } };
    expect(body.account.label).toBe("Go #01");
    expect(body.test.ok).toBe(true);
    expect(containsSecret(body, [secret])).toBe(false);

    const rotatedSecret = "user_rotated_web_secret";
    const rotated = await instance.app.inject({
      method: "PATCH",
      url: `/api/accounts/${body.account.id}`,
      payload: { credential: rotatedSecret },
    });
    expect(rotated.statusCode).toBe(200);
    expect(containsSecret(rotated.json(), [secret, rotatedSecret])).toBe(false);

    const listed = await instance.app.inject({ method: "GET", url: "/api/accounts" });
    expect(containsSecret(listed.json(), [secret, rotatedSecret])).toBe(false);
    await instance.close();
  });

  it("does not seat a key that fails authentication", async () => {
    const instance = await withServer({
      setup(transport) {
        transport.set("*", { failAuth: true });
      },
    });
    const created = await instance.app.inject({
      method: "POST",
      url: "/api/accounts",
      payload: { label: "Go #01", credential: "user_invalid_key" },
    });
    expect(created.statusCode).toBe(400);
    expect((created.json() as { error: string }).error).toMatch(/authentication failed/i);
    expect(instance.runtime.pool.list()).toHaveLength(0);
    const listed = await instance.app.inject({ method: "GET", url: "/api/accounts" });
    expect((listed.json() as { accounts: unknown[] }).accounts).toHaveLength(0);
    await instance.close();
  });

  it("does not seat a key when credential test fails after status lookup errors", async () => {
    const instance = await withServer({
      setup(transport) {
        transport.getAccountStatus = async () => {
          throw new Error("upstream unavailable");
        };
        transport.testCredential = async () => ({ ok: false, message: "Authentication failed" });
      },
    });
    const created = await instance.app.inject({
      method: "POST",
      url: "/api/accounts",
      payload: { label: "Go #01", credential: "user_invalid_key" },
    });
    expect(created.statusCode).toBe(400);
    expect(instance.runtime.pool.list()).toHaveLength(0);
    await instance.close();
  });

  it("applies a pool API key from PATCH without locking loopback admin", async () => {
    const instance = await withServer();
    const secret = "live-pool-key-xyz";
    const patched = await instance.app.inject({
      method: "PATCH",
      url: "/api/config",
      payload: { server: { apiKey: secret } },
    });
    expect(patched.statusCode).toBe(200);
    expect(containsSecret(patched.json(), [secret])).toBe(false);
    expect(JSON.stringify(patched.json())).toContain("[set]");

    const denied = await instance.app.inject({ method: "GET", url: "/v1/models" });
    expect(denied.statusCode).toBe(401);
    const ok = await instance.app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(ok.statusCode).toBe(200);

    const admin = await instance.app.inject({ method: "GET", url: "/api/health" });
    expect(admin.statusCode).toBe(200);
    await instance.close();
  });

  it("allows clearing the pool API key", async () => {
    const instance = await withServer({
      config: { server: { apiKey: "live-pool-key-xyz" } },
    });
    const res = await instance.app.inject({
      method: "PATCH",
      url: "/api/config",
      payload: { server: { apiKey: "" } },
    });
    expect(res.statusCode).toBe(200);
    expect(instance.runtime.config.server.apiKey).toBeUndefined();
    const open = await instance.app.inject({ method: "GET", url: "/v1/models" });
    expect(open.statusCode).toBe(200);
    await instance.close();
  });
});
