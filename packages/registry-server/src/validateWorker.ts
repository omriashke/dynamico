import { parentPort, workerData } from "node:worker_threads";
import { runValidate } from "@omriashke/dynamico-validator";

interface WorkerInput {
  name: string;
  componentCode: string;
  timeoutMs: number;
  allowedScope?: readonly string[];
  registeredComponents?: readonly string[];
  bookConfig?: import("@omriashke/dynamico-core").BookPreviewConfig;
}

interface WorkerOutput {
  ok: boolean;
  durationMs: number;
  error?: { phase: string; message: string; stack?: string };
}

async function main() {
  const data = workerData as WorkerInput;
  const result = await runValidate({
    name: data.name,
    componentCode: data.componentCode,
    timeoutMs: data.timeoutMs,
    allowedScope: data.allowedScope,
    registeredComponents: data.registeredComponents,
    bookConfig: data.bookConfig,
  });
  const out: WorkerOutput = {
    ok: result.ok,
    durationMs: result.durationMs,
    error: result.error
      ? { phase: result.error.phase, message: result.error.message, stack: result.error.stack }
      : undefined,
  };
  parentPort?.postMessage(out);
}

main().catch((err) => {
  parentPort?.postMessage({
    ok: false,
    durationMs: 0,
    error: { phase: "render", message: err instanceof Error ? err.message : String(err) },
  });
});
