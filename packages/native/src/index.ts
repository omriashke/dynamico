import { createRuntime } from "@omriaske/core";
import { defaultScope } from "./defaultScope.js";

const runtime = createRuntime(defaultScope);

export const DynamicoProvider = runtime.DynamicoProvider;
export const DynamicComponent = runtime.DynamicComponent;
export const useDynamico = runtime.useDynamico;

export { defaultScope };
export { createRemoteSource } from "@omriaske/core";
export type {
  Source,
  CompiledModule,
  RegistryEntry,
  DynamicError,
  PropsSchema,
  Scope,
  DynamicoProviderProps,
  DynamicComponentProps,
} from "@omriaske/core";
