import * as React from "react";
import type { Scope } from "@omriashke/core";

/**
 * Default host scope for React Native / Expo.
 *
 * Like the web runtime, we use Babel's *classic* JSX runtime in the compiler,
 * so dynamic components emit React.createElement(...) and only need:
 *   - `react`         — for createElement, hooks, etc.
 *   - `react-native`  — for primitives (View, Text, Image, ...)
 *
 * Hosts can extend the scope (design-system components, navigation hooks,
 * etc.) via <DynamicoProvider scope={...}>.
 */
declare const require: ((id: string) => unknown) | undefined;

const ReactNative: unknown = (() => {
  try {
    return typeof require === "function" ? require("react-native") : undefined;
  } catch {
    return undefined;
  }
})();

export const defaultScope: Scope = {
  react: React,
  "react-native": ReactNative,
};
