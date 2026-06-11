import { parentPort, workerData } from "node:worker_threads";
import { runTest } from "@omriashke/dynamico-validator";
import type { PropsSchema } from "@omriashke/dynamico-core";

interface WorkerInput {
  name: string;
  componentCode: string;
  testCode: string;
  timeoutMs: number;
  allowedScope?: readonly string[];
}

interface WorkerOutput {
  ok: boolean;
  durationMs: number;
  propsSchema?: PropsSchema;
  error?: { phase: string; message: string; stack?: string };
}

async function main() {
  const data = workerData as WorkerInput;
  const result = await runTest({
    name: data.name,
    componentCode: data.componentCode,
    testCode: data.testCode,
    timeoutMs: data.timeoutMs,
    allowedScope: data.allowedScope,
  });
  const out: WorkerOutput = {
    ok: result.ok,
    durationMs: result.durationMs,
    propsSchema: result.propsSchema,
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
    error: { phase: "test", message: err instanceof Error ? err.message : String(err) },
  });
});
