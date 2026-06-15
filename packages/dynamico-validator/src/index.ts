/**
 * Public API surface of @omriashke/dynamico-validator.
 *
 * This package is consumed in two places:
 *
 *   1. By component authors writing `Foo.test.tsx` next to `Foo.tsx`. They
 *      import { render, press, findByText, sleep, expect } from
 *      '@omriashke/dynamico-validator' and write a default-exported async function.
 *
 *   2. By the registry-server's push validator, which uses runTest() to
 *      execute a compiled component + test pair in a worker thread. If the
 *      test throws, the push is rejected.
 *
 * The author API is small on purpose: less surface = fewer ways to write a
 * misleading test. Assertions are throw-on-failure — if the test function
 * returns, the component is considered valid.
 */
export { render, type RenderResult, type RenderOptions } from "./render.js";
export { press, longPress, changeText } from "./events.js";
export { findByText, findAllByType, queryByText } from "./queries.js";
export { interactSmoke } from "./interactSmoke.js";
export { sleep, flush } from "./timing.js";
export { expect, type Expectation } from "./expect.js";
export { runTest, type RunTestInput, type RunTestResult, setHostScope, getHostScope } from "./runTest.js";
