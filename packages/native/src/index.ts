import * as React from "react";
import { Text } from "react-native";
import { createRuntime, type DynamicError } from "@omriashke/dynamico-core";
import { defaultScope } from "./defaultScope.js";

/**
 * RN-safe default error view. The renderer-agnostic default in dynamico-core
 * renders a bare string inside a Fragment, which crashes on React Native
 * with "Text strings must be rendered within a <Text> component". Wrap it.
 */
function NativeDefaultErrorFallback({ error }: { error: DynamicError }): React.ReactElement {
  return React.createElement(
    Text,
    { style: { color: "#ff3333", padding: 12, fontSize: 13 } },
    `[dynamico ${error.kind} error] ${error.name}: ${error.message}`,
  );
}

const runtime = createRuntime(defaultScope, {
  defaultErrorFallback: NativeDefaultErrorFallback,
});

export const DynamicoProvider = runtime.DynamicoProvider;
export const DynamicComponent = runtime.DynamicComponent;
export const useDynamico = runtime.useDynamico;
export const useScope = runtime.useScope;

export { defaultScope };
export { createRemoteSource, createPackageScope, createPackageScopeFromNames } from "@omriashke/dynamico-core";
export type {
  Source,
  CompiledModule,
  RegistryEntry,
  DynamicError,
  PropsSchema,
  Scope,
  DynamicoProviderProps,
  DynamicComponentProps,
  PackageScopeOptions,
} from "@omriashke/dynamico-core";
