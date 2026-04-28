import * as React from "react";
import { Registry } from "../registry.js";
import type {
  ComponentFactory,
  DynamicError,
  PropsSchema,
  RegistryEntry,
  Scope,
  Source,
} from "../types.js";
import { validateProps } from "../propsSchema.js";

export interface RuntimeAPI {
  DynamicoProvider: React.ComponentType<DynamicoProviderProps>;
  DynamicComponent: React.ComponentType<DynamicComponentProps>;
  useDynamico: (name: string) => RegistryEntry | undefined;
}

export interface DynamicoProviderProps {
  source: Source;
  scope?: Scope;
  children?: React.ReactNode;
}

export interface DynamicComponentProps {
  name: string;
  props?: Record<string, unknown>;
  fallback?: React.ReactNode;
  errorFallback?: React.ComponentType<{ error: DynamicError }> | React.ReactNode;
}

interface RuntimeContextValue {
  registry: Registry;
}

export function createRuntime(defaultScope: Scope): RuntimeAPI {
  const Ctx = React.createContext<RuntimeContextValue | null>(null);

  function DynamicoProvider({ source, scope, children }: DynamicoProviderProps) {
    const registry = React.useMemo(() => {
      const merged: Scope = { ...defaultScope, ...(scope ?? {}) };
      return new Registry(source, merged);
    }, [source, scope]);

    const value = React.useMemo<RuntimeContextValue>(() => ({ registry }), [registry]);
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  }

  function useRegistry(): Registry {
    const ctx = React.useContext(Ctx);
    if (!ctx) {
      throw new Error("dynamico: useDynamico/DynamicComponent must be inside <DynamicoProvider>");
    }
    return ctx.registry;
  }

  function useDynamico(name: string): RegistryEntry | undefined {
    const registry = useRegistry();
    const subscribe = React.useCallback(
      (cb: () => void) => registry.subscribe(name, cb),
      [registry, name],
    );
    const getSnapshot = React.useCallback(() => registry.peek(name), [registry, name]);
    const entry = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    React.useEffect(() => {
      if (!registry.peek(name)) void registry.ensure(name);
    }, [registry, name]);

    return entry;
  }

  function DynamicComponent({
    name,
    props,
    fallback = null,
    errorFallback,
  }: DynamicComponentProps): React.ReactElement | null {
    const entry = useDynamico(name);

    if (!entry) return <>{fallback}</>;

    if (entry.error) {
      return <>{renderError(errorFallback, entry.error)}</>;
    }

    if (!entry.factory) return <>{fallback}</>;

    const Comp = pickDefault(entry.factory);
    if (typeof Comp !== "function") {
      const err: DynamicError = {
        kind: "load",
        name,
        version: entry.version,
        message: `component '${name}' has no default export of a function/class`,
      };
      return <>{renderError(errorFallback, err)}</>;
    }

    const schema = entry.factory.propsSchema as PropsSchema | undefined;
    const validation = validateProps(schema, props ?? {});
    if (!validation.ok) {
      const err: DynamicError = {
        kind: "render",
        name,
        version: entry.version,
        message: `props validation failed: ${validation.errors.join("; ")}`,
      };
      return <>{renderError(errorFallback, err)}</>;
    }

    return (
      <ErrorBoundary
        key={`${name}@${entry.version}`}
        onError={(message, stack) => ({
          kind: "render",
          name,
          version: entry.version,
          message,
          stack,
        })}
        renderFallback={(err) => renderError(errorFallback, err)}
      >
        {React.createElement(Comp as React.ComponentType<Record<string, unknown>>, props ?? {})}
      </ErrorBoundary>
    );
  }

  return { DynamicoProvider, DynamicComponent, useDynamico };
}

function pickDefault(factory: ComponentFactory): unknown {
  if (factory && typeof factory === "object") {
    if ("default" in factory && factory.default) return factory.default;
    // CommonJS interop: the value itself may be the component
    if (typeof factory === "function") return factory;
  }
  if (typeof factory === "function") return factory;
  return undefined;
}

function renderError(
  errorFallback: DynamicComponentProps["errorFallback"],
  error: DynamicError,
): React.ReactNode {
  if (!errorFallback) return defaultErrorView(error);
  if (typeof errorFallback === "function") {
    const Fallback = errorFallback as React.ComponentType<{ error: DynamicError }>;
    return <Fallback error={error} />;
  }
  return errorFallback;
}

function defaultErrorView(error: DynamicError): React.ReactElement {
  // Renderer-agnostic: plain text node so it works on both DOM and RN.
  return React.createElement(
    React.Fragment,
    null,
    `[dynamico ${error.kind} error] ${error.name}: ${error.message}`,
  );
}

interface ErrorBoundaryProps {
  onError: (message: string, stack: string | undefined) => DynamicError;
  renderFallback: (err: DynamicError) => React.ReactNode;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  err: DynamicError | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { err: null };

  static getDerivedStateFromError(): ErrorBoundaryState | null {
    return null; // we set state in componentDidCatch where we have the message
  }

  componentDidCatch(error: unknown): void {
    const e = error instanceof Error ? error : new Error(String(error));
    this.setState({ err: this.props.onError(e.message, e.stack) });
  }

  render(): React.ReactNode {
    if (this.state.err) return this.props.renderFallback(this.state.err);
    return this.props.children;
  }
}
