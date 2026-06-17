import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CompiledModule, Diagnostic, BookPreviewConfig } from "@omriashke/dynamico-core";
import { readBookPreviewConfig } from "./bookValidate.js";

const VALIDATE_TIMEOUT_MS_DEFAULT = 5000;

export interface ValidateInput {
  name: string;
  component: CompiledModule;
  sourceDir?: string;
  registeredComponents?: readonly string[];
  timeoutMs?: number;
}

export interface ValidateResult {
  ok: boolean;
  component: CompiledModule;
  durationMs?: number;
}

export interface ValidatePolicy {
  /** Set DYNAMICO_VALIDATE_SKIP=1 (or legacy DYNAMICO_TEST_SKIP=1) on the registry. */
  skipValidation?: boolean;
  allowedScope?: readonly string[];
  registeredComponents?: readonly string[];
}

export function loadPolicyFromEnv(): ValidatePolicy {
  const v = process.env.DYNAMICO_VALIDATE_SKIP ?? process.env.DYNAMICO_TEST_SKIP;
  return { skipValidation: v === "1" || v === "true" };
}

/**
 * Automatic push validation — render smoke tests for default props and every
 * book.config.json preview (with configured providers). No author test files.
 */
export async function validate(
  input: ValidateInput,
  policy: ValidatePolicy = loadPolicyFromEnv(),
): Promise<ValidateResult> {
  if (input.component.error) {
    return { ok: false, component: input.component };
  }

  if (policy.skipValidation) {
    return { ok: true, component: input.component };
  }

  const bookConfig = input.sourceDir ? readBookPreviewConfig(input.sourceDir) : undefined;

  const result = await runInWorker({
    name: input.name,
    componentCode: input.component.code!,
    timeoutMs: input.timeoutMs ?? VALIDATE_TIMEOUT_MS_DEFAULT,
    allowedScope: policy.allowedScope,
    registeredComponents: input.registeredComponents ?? policy.registeredComponents,
    bookConfig,
  });

  if (!result.ok) {
    return {
      ok: false,
      durationMs: result.durationMs,
      component: errorOnComponent(input.component, {
        kind: "test",
        message: result.error?.message ?? "validation failed",
        stack: result.error?.stack,
        diagnostics: [
          {
            severity: "error",
            message: `${result.error?.phase ?? "render"}: ${result.error?.message ?? "validation failed"}`,
            code: "VALIDATE_FAIL",
          } as Diagnostic,
        ],
      }),
    };
  }

  return { ok: true, durationMs: result.durationMs, component: input.component };
}

function errorOnComponent(
  component: CompiledModule,
  err: {
    kind: "compile" | "test";
    message: string;
    stack?: string;
    diagnostics?: Diagnostic[];
  },
): CompiledModule {
  return {
    name: component.name,
    version: component.version,
    error: { kind: err.kind, message: err.message, stack: err.stack, diagnostics: err.diagnostics },
  };
}

interface WorkerInput {
  name: string;
  componentCode: string;
  timeoutMs: number;
  allowedScope?: readonly string[];
  registeredComponents?: readonly string[];
  bookConfig?: BookPreviewConfig;
}

interface WorkerOutput {
  ok: boolean;
  durationMs: number;
  error?: { phase: string; message: string; stack?: string };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runInWorker(input: WorkerInput): Promise<WorkerOutput> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: WorkerOutput) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const workerPath = join(__dirname, "validateWorker.js");
    let worker: Worker;
    try {
      worker = new Worker(workerPath, {
        workerData: input,
        env: { ...process.env, NODE_ENV: "development" },
      });
    } catch (err) {
      settle({
        ok: false,
        durationMs: 0,
        error: {
          phase: "load",
          message: `failed to spawn validator worker: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
      return;
    }

    const timer = setTimeout(() => {
      void worker.terminate();
      settle({
        ok: false,
        durationMs: input.timeoutMs,
        error: { phase: "render", message: `validation timed out after ${input.timeoutMs}ms` },
      });
    }, input.timeoutMs + 500);

    worker.on("message", (msg: WorkerOutput) => {
      clearTimeout(timer);
      void worker.terminate();
      settle(msg);
    });
    worker.on("error", (err) => {
      clearTimeout(timer);
      void worker.terminate();
      settle({
        ok: false,
        durationMs: 0,
        error: { phase: "render", message: err.message, stack: err.stack },
      });
    });
    worker.on("exit", (code) => {
      if (settled) return;
      clearTimeout(timer);
      settle({
        ok: false,
        durationMs: 0,
        error: { phase: "render", message: `worker exited unexpectedly with code ${code}` },
      });
    });
  });
}
