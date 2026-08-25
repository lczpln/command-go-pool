export interface ShutdownOptions {
  timeoutMs?: number;
  exit?: (code: number) => void;
}

export function createShutdown(close: () => Promise<void>, options: ShutdownOptions = {}) {
  let stopping = false;
  let exited = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  const finish = (code: number) => {
    if (exited) return;
    exited = true;
    if (timer) clearTimeout(timer);
    exit(code);
  };

  const stop = () => {
    if (stopping) {
      finish(1);
      return;
    }
    stopping = true;
    timer = setTimeout(() => finish(1), timeoutMs);
    void close()
      .catch(() => undefined)
      .then(() => finish(0));
  };

  return { stop };
}