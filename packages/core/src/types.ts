export type Version = string;

export type Scope = Record<string, unknown>;

export interface PropsSchemaField {
  type: "string" | "number" | "boolean" | "object" | "array" | "any";
  required?: boolean;
}

export type PropsSchema = Record<string, PropsSchemaField>;

export interface CompiledModuleOk {
  name: string;
  version: Version;
  code: string;
  error?: undefined;
}

export interface CompiledModuleError {
  name: string;
  version: Version;
  code?: undefined;
  error: {
    kind: "compile";
    message: string;
    stack?: string;
  };
}

export type CompiledModule = CompiledModuleOk | CompiledModuleError;

export interface DynamicError {
  kind: "compile" | "load" | "render";
  name: string;
  version: Version;
  message: string;
  stack?: string;
}

export type ComponentFactory = {
  default?: unknown;
  propsSchema?: PropsSchema;
  [key: string]: unknown;
};

export interface RegistryEntry {
  name: string;
  version: Version;
  factory?: ComponentFactory;
  error?: DynamicError;
}

export type RegistryListener = (entry: RegistryEntry) => void;

export interface SourceUpdate {
  module: CompiledModule;
}

export interface Source {
  /** Fetch the latest version of a single component (initial load). */
  fetch(name: string): Promise<CompiledModule>;
  /** Subscribe to updates for any component. Returns unsubscribe fn. */
  subscribe(listener: (update: SourceUpdate) => void): () => void;
  /** Optional disposal hook. */
  dispose?(): void;
}
