/**
 * Push-time validation for Dynamico components. The registry calls runValidate()
 * to render each component with default props and every book.config.json preview
 * (with configured providers). No author-written test files.
 */
export { runValidate, type RunValidateInput, type RunValidateResult } from "./runValidate.js";
