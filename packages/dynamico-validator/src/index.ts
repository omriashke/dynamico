/**
 * Push-time validation for Dynamico components. The registry calls runValidate()
 * to render each component with default props and every book.config.json preview
 * (with configured providers). No author-written test files.
 */
export { render, type RenderResult, type RenderOptions } from "./render.js";
export { press, longPress, changeText } from "./events.js";
export { findByText, findAllByType, queryByText } from "./queries.js";
export { interactSmoke } from "./interactSmoke.js";
export { sleep, flush } from "./timing.js";
export { expect, type Expectation } from "./expect.js";
export { runValidate, type RunValidateInput, type RunValidateResult } from "./runValidate.js";
export { validationHostScope } from "./hostScope.js";
export { runTest, type RunTestInput, type RunTestResult, setHostScope, getHostScope } from "./runTest.js";
