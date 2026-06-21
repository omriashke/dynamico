import { createRuntime } from "@omriashke/dynamico-core";
import { defaultScope } from "./defaultScope.js";

const runtime = createRuntime(defaultScope);

export const DynamicoProvider = runtime.DynamicoProvider;
export const DynamicComponent = runtime.DynamicComponent;
export const useDynamico = runtime.useDynamico;
export const useScope = runtime.useScope;

export { defaultScope };
export {
  createRemoteSource,
  createPackageScope,
  createPackageScopeFromNames,
  createRegistryModuleSubscription,
  createUseRegistryModule,
} from "@omriashke/dynamico-core";
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
  RegistryModuleSubscription,
} from "@omriashke/dynamico-core";
