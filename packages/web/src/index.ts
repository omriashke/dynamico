import { createRuntime } from "@omriashke/core";
import { defaultScope } from "./defaultScope.js";

const runtime = createRuntime(defaultScope);

export const DynamicoProvider = runtime.DynamicoProvider;
export const DynamicComponent = runtime.DynamicComponent;
export const useDynamico = runtime.useDynamico;

export { defaultScope };
export { createRemoteSource } from "@omriashke/core";
export type {
  Source,
  CompiledModule,
  RegistryEntry,
  DynamicError,
  PropsSchema,
  Scope,
  DynamicoProviderProps,
  DynamicComponentProps,
} from "@omriashke/core";
