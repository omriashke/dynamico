import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CompiledModule, Diagnostic, PropsSchema } from "@omriashke/dynamico-core";
import { compile } from "./compile.js";
import { validateComponentBookPreviews } from "./bookValidate.js";

const TEST_TIMEOUT_MS_DEFAULT = 5000;

export interface ValidateInput {
  name: string;
  /** Already-compiled component module (output of compile()). */
  component: CompiledModule;
  /** Raw source of the .test.tsx file, or undefined if no test file exists. */
  testSource?: string;
  /** File extension of the test source ('.tsx' / '.jsx' / '.ts' / '.js'). */
  testExt?: string;
  /**
   * Per-test timeout. Worker is terminated if it exceeds this. Default 5s.
   */
  timeoutMs?: number;
  /**
   * Registry source directory. When set, book.config.json previews referencing
   * this component are validated against its propsSchema after the test passes.
   */
  sourceDir?: string;
}

export interface ValidateResult {
  ok: boolean;
  /** Component module, possibly with `error` set if validation failed. */
  component: CompiledModule;
  /** Wall-clock time the test ran for (only set when a test was executed). */
  durationMs?: number;
}

export interface ValidatePolicy {
  /**
   * If true, components without a co-located test file are accepted (with a
   * warning). If false (the default in production), every component must
   * have a test or its push is rejected.
   *
   * Set via the DYNAMICO_TEST_SKIP=1 env var on the registry process. This is
   * the operator escape hatch — there is NO author-side flag to bypass it.
   */
  skipTests: boolean;
  /**
   * Whitelist of bare specifiers the host's DynamicoProvider scope exposes.
   * When set, the test runner mirrors production strictness and rejects any
   * component whose imports reference specifiers outside this list. This
   * catches "module not in host scope" runtime errors at push time instead
   * of when a user navigates to the screen.
   *
   * Populated automatically: the @omriashke/dynamico-native client SDK
   * reports `Object.keys(scope)` to the registry on mount (POST /scope), and
   * the server passes the cached list here per-validate. Stays undefined
   * (permissive) until the first app boot.
   */
  allowedScope?: readonly string[];
}

export function loadPolicyFromEnv(): ValidatePolicy {
  const v = process.env.DYNAMICO_TEST_SKIP;
  return { skipTests: v === "1" || v === "true" };
}

/**
 * Validate a compiled component by running its co-located .test.tsx in a
 * worker thread. Returns:
 *
 *   - { ok: true, component }                    test passed (or test skipped by policy)
 *   - { ok: false, component: { ..., error } }   test failed; component has error attached
 *
 * When the worker times out or fails to start, the component is rejected
 * with a synthetic test-failure error so the push is denied.
 */
export async function validate(
  input: ValidateInput,
  policy: ValidatePolicy = loadPolicyFromEnv(),
): Promise<ValidateResult> {
  // Already-failed compilation: nothing to test, just pass through. The
  // existing compile-error handling will reject the push.
  if (input.component.error) {
    return { ok: false, component: input.component };
  }

  // No test file: enforce policy.
  if (!input.testSource) {
    if (policy.skipTests) {
      return { ok: true, component: input.component };
    }
    return {
      ok: false,
      component: errorOnComponent(input.component, {
        kind: "compile",
        message: `component '${input.name}' has no co-located test file. Create '${input.name}.test.tsx' next to the source, or set DYNAMICO_TEST_SKIP=1 on the registry to bypass.`,
        diagnostics: [
          {
            severity: "error",
            message: "missing test file",
            code: "NO_TEST",
          } as Diagnostic,
        ],
      }),
    };
  }

  // Compile the test file. Same Babel pipeline as the component. If the test
  // file itself doesn't compile, treat that as a validation failure.
  const compiledTest = await compile(`${input.name}.test`, input.testSource, input.testExt ?? ".tsx");
  if (compiledTest.error || !compiledTest.code) {
    return {
      ok: false,
      component: errorOnComponent(input.component, {
        kind: "compile",
        message: `test file failed to compile: ${compiledTest.error?.message ?? "unknown error"}`,
        diagnostics: compiledTest.error?.diagnostics,
      }),
    };
  }

  // Spin up a short-lived worker that runs the test.
  const result = await runInWorker({
    name: input.name,
    componentCode: input.component.code!,
    testCode: compiledTest.code!,
    timeoutMs: input.timeoutMs ?? TEST_TIMEOUT_MS_DEFAULT,
    allowedScope: policy.allowedScope,
  });

  if (!result.ok) {
    return {
      ok: false,
      durationMs: result.durationMs,
      component: errorOnComponent(input.component, {
        kind: "test",
        message: result.error?.message ?? "test failed",
        stack: result.error?.stack,
        diagnostics: [
          {
            severity: "error",
            message: `${result.error?.phase ?? "test"}: ${result.error?.message ?? "test failed"}`,
            code: "TEST_FAIL",
          } as Diagnostic,
        ],
      }),
    };
  }

  if (input.sourceDir && result.propsSchema) {
    const bookCheck = validateComponentBookPreviews(
      input.name,
      result.propsSchema,
      input.sourceDir,
    );
    if (!bookCheck.ok) {
      return {
        ok: false,
        durationMs: result.durationMs,
        component: errorOnComponent(input.component, {
          kind: "test",
          message: bookCheck.message,
          diagnostics: [
            {
              severity: "error",
              message: bookCheck.message,
              code: "BOOK_PREVIEW_FAIL",
            } as Diagnostic,
          ],
        }),
      };
    }
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
      worker = new Worker(workerPath, { workerData: input });
    } catch (err) {
      settle({
        ok: false,
        durationMs: 0,
        error: { phase: "load", message: `failed to spawn validator worker: ${err instanceof Error ? err.message : String(err)}` },
      });
      return;
    }

    const timer = setTimeout(() => {
      void worker.terminate();
      settle({
        ok: false,
        durationMs: input.timeoutMs,
        error: { phase: "test", message: `test timed out after ${input.timeoutMs}ms` },
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
        error: { phase: "test", message: err.message, stack: err.stack },
      });
    });
    worker.on("exit", (code) => {
      if (settled) return;
      clearTimeout(timer);
      settle({
        ok: false,
        durationMs: 0,
        error: { phase: "test", message: `worker exited unexpectedly with code ${code}` },
      });
    });
  });
}
