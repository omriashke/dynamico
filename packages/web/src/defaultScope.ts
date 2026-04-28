import * as React from "react";
import type { Scope } from "@dynamico/core";

/**
 * Default host scope for web. We use Babel's *classic* JSX runtime in the
 * compiler, so dynamic components only need `react` (for React.createElement,
 * hooks, and other top-level exports). Hosts can extend this via
 * <DynamicoProvider scope={...}>.
 */
export const defaultScope: Scope = {
  react: React,
};
