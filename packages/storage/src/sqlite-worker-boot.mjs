import { register } from "tsx/esm/api";

register();
await import("./sqlite-worker.ts");
