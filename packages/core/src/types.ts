export type Version = string;

export type Scope = Record<string, unknown>;

export interface PropsSchemaField {
  /**
   * Runtime type. `function` validates `typeof v === 'function'` — useful for
   * dynamic screens/components that take callbacks. Function values render
   * fine inside dynamic components; the schema just lets you require them.
   */
  type:
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "function"
    | "any";
  required?: boolean;
}

export type PropsSchema = Record<string, PropsSchemaField>;

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  /** 1-based line in the source. */
  line?: number;
  /** 1-based column. */
  column?: number;
  /** TypeScript or Babel diagnostic code, e.g. "TS2304". */
  code?: string;
  /** A short snippet of the offending line, when available. */
  snippet?: string;
}

export interface CompiledModuleOk {
  name: string;
  version: Version;
  code: string;
  /** Type-check warnings that didn't block compilation. */
  warnings?: Diagnostic[];
  error?: undefined;
  removed?: undefined;
}

export interface CompiledModuleError {
  name: string;
  version: Version;
  code?: undefined;
  error: {
    kind: "compile" | "typecheck" | "render" | "test";
    message: string;
    stack?: string;
    diagnostics?: Diagnostic[];
  };
  removed?: undefined;
}

/** A removal event broadcast over WS when DELETE /component/:name is called. */
export interface CompiledModuleRemoved {
  name: string;
  version: Version;
  removed: true;
  code?: undefined;
  error?: undefined;
}

export type CompiledModule =
  | CompiledModuleOk
  | CompiledModuleError
  | CompiledModuleRemoved;

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
  /**
   * Optional: report the host's scope keys to the registry so the
   * server-side validator knows what bare specifiers it can expect
   * components to import. Called once on DynamicoProvider mount.
   *
   * Remote sources (createRemoteSource) implement this as POST /scope.
   * Local/test sources can leave it undefined.
   */
  reportScope?(keys: readonly string[], reportedBy?: string): Promise<void>;
}
