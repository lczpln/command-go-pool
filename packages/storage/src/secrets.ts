import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { paths } from "./paths.js";

const PREFIX = "cgp1";

export class SecretStore {
  constructor(
    private readonly file: string,
    private readonly masterKey: Buffer,
  ) {}

  static open(home?: string, env: NodeJS.ProcessEnv = process.env): SecretStore {
    const p = paths(home);
    const fromEnv = env.COMMAND_GO_PROXY_MASTER_KEY;
    let raw: Buffer;
    if (fromEnv) {
      raw = Buffer.from(fromEnv, fromEnv.length === 64 ? "hex" : "utf8");
    } else if (existsSync(p.masterKey)) {
      raw = readFileSync(p.masterKey);
    } else {
      raw = randomBytes(32);
      writeFileSync(p.masterKey, raw, { mode: 0o600 });
    }
    const key = raw.length === 32 ? raw : scryptSync(raw, "command-go-proxy", 32);
    return new SecretStore(p.secrets, key);
  }

  put(secret: string): string {
    const map = this.readAll();
    const ref = `sec_${randomBytes(8).toString("hex")}`;
    map[ref] = secret;
    this.writeAll(map);
    return ref;
  }

  get(ref: string): string | undefined {
    return this.readAll()[ref];
  }

  delete(ref: string): void {
    const map = this.readAll();
    delete map[ref];
    this.writeAll(map);
  }

  private readAll(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    const buf = readFileSync(this.file);
    if (buf.length < 16) return {};
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const dec = createDecipheriv("aes-256-gcm", this.masterKey, iv);
    dec.setAuthTag(tag);
    const json = Buffer.concat([dec.update(data), dec.final()]).toString("utf8");
    const parsed = JSON.parse(json) as { v: string; secrets: Record<string, string> };
    if (parsed.v !== PREFIX) return {};
    return parsed.secrets;
  }

  private writeAll(secrets: Record<string, string>): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    const payload = Buffer.concat([cipher.update(JSON.stringify({ v: PREFIX, secrets })), cipher.final()]);
    const tag = cipher.getAuthTag();
    writeFileSync(this.file, Buffer.concat([iv, tag, payload]), { mode: 0o600 });
    try {
      chmodSync(this.file, 0o600);
    } catch {
      /* ignore */
    }
  }
}
