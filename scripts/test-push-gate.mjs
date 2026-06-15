#!/usr/bin/env node
/**
 * Local push-gate regression: simulates production registry (NODE_ENV=production
 * parent) with the validateWorker NODE_ENV=development fix.
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { compile } from "../packages/registry-server/dist/compile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = join(__dirname, "../packages/registry-server/dist/validateWorker.js");
const NEWSCAST = process.env.NEWSCAST_ROOT ?? join(__dirname, "../../newscast");

const CASES = [
  {
    name: "ProfileScreen (good)",
    component: `${NEWSCAST}/dynamico/expo/screens/ProfileScreen.tsx`,
    test: `${NEWSCAST}/dynamico/expo/screens/ProfileScreen.test.tsx`,
    allowedScope: [
      "@newscast/utils-app-ui",
      "@newscast/app-auth",
      "@newscast/app-hooks",
      "@newscast/app-components",
      "@newscast/app-constants",
    ],
    expectOk: true,
  },
  {
    name: "TopicChip",
    component: `${NEWSCAST}/dynamico/expo/ui/TopicChip/TopicChip.tsx`,
    test: `${NEWSCAST}/dynamico/expo/ui/TopicChip/TopicChip.test.tsx`,
    allowedScope: ["@newscast/utils-app-ui"],
    expectOk: true,
  },
  {
    name: "ProfileScreen (broken currentColors)",
    component: "/tmp/registry-pull/ProfileScreen.tsx",
    test: `${NEWSCAST}/dynamico/expo/screens/ProfileScreen.test.tsx`,
    allowedScope: [
      "@newscast/utils-app-ui",
      "@newscast/app-auth",
      "@newscast/app-hooks",
      "@newscast/app-components",
      "@newscast/app-constants",
    ],
    expectOk: false,
    expectMessage: /currentColors|not defined|ReferenceError/i,
  },
];

async function runInWorker(input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: input,
      env: { ...process.env, NODE_ENV: "development" },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`timeout after ${input.timeoutMs}ms`));
    }, input.timeoutMs + 1000);

    worker.on("message", (msg) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(msg);
    });
    worker.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function runCase(testCase) {
  const componentSource = readFileSync(testCase.component, "utf8");
  const testSource = readFileSync(testCase.test, "utf8");
  const compiled = await compile(testCase.name, componentSource);
  const compiledTest = await compile(`${testCase.name}.test`, testSource);

  if (compiled.error || !compiled.code) {
    throw new Error(`${testCase.name}: component compile failed: ${compiled.error?.message}`);
  }
  if (compiledTest.error || !compiledTest.code) {
    throw new Error(`${testCase.name}: test compile failed: ${compiledTest.error?.message}`);
  }

  const result = await runInWorker({
    name: testCase.name.replace(/ \(.*\)$/, ""),
    componentCode: compiled.code,
    testCode: compiledTest.code,
    timeoutMs: 8000,
    allowedScope: testCase.allowedScope,
  });

  const ok = result.ok === testCase.expectOk;
  const messageMatch =
    !testCase.expectMessage ||
    (result.error?.message && testCase.expectMessage.test(result.error.message));

  return {
    label: testCase.name,
    pass: ok && messageMatch,
    expectOk: testCase.expectOk,
    gotOk: result.ok,
    message: result.error?.message,
    durationMs: result.durationMs,
  };
}

async function main() {
  if (process.env.NODE_ENV !== "production") {
    process.env.NODE_ENV = "production";
  }

  console.log(`Parent NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`Worker path: ${workerPath}`);
  console.log("");

  const results = [];
  for (const testCase of CASES) {
    try {
      const r = await runCase(testCase);
      results.push(r);
      const icon = r.pass ? "PASS" : "FAIL";
      console.log(
        `${icon}  ${r.label}  (expected ok=${r.expectOk}, got ok=${r.gotOk}, ${r.durationMs?.toFixed?.(0) ?? "?"}ms)`,
      );
      if (!r.pass && r.message) console.log(`       ${r.message}`);
    } catch (err) {
      results.push({ label: testCase.name, pass: false, error: err.message });
      console.log(`FAIL  ${testCase.name}`);
      console.log(`       ${err.message}`);
    }
  }

  console.log("");
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.error(`${failed.length}/${results.length} cases failed`);
    process.exit(1);
  }
  console.log(`All ${results.length} cases passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
