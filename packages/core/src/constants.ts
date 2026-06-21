/** Registry manifest filename at the source directory root. */
export const MANIFEST_FILENAME = "dynamico.config.json" as const;

/** Matches co-located author test files — not registry components. */
export const COMPONENT_TEST_RE = /\.test\.(tsx|jsx|ts|js)$/;

export function isComponentTestFilename(filename: string): boolean {
  return COMPONENT_TEST_RE.test(filename);
}
