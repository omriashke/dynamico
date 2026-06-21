import * as React from "react";
import { Registry } from "../registry.js";
import { resolveModuleDefault } from "../loader.js";
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
  /**
   * Read the merged host scope from inside React. Useful in dynamic
   * components that want to introspect what the host gave them, or to
   * conditionally use scope features (`useScope()['@my/haptics']` may be
   * undefined if the host didn't register it).
   */
  useScope: () => Scope;
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

/**
 * Optional renderer-specific knobs passed by the platform package
 * (`@omriashke/dynamico-web`, `@omriashke/dynamico-native`).
 *
 * The web runtime is fine with the built-in `defaultErrorView` (which renders
 * a plain text Fragment via React.createElement), since DOM accepts text
 * nodes anywhere. React Native does NOT — bare strings throw "Text strings
 * must be rendered within a <Text> component". The native package supplies
 * its own `defaultErrorFallback` that wraps the message in `<Text>`.
 */
export interface CreateRuntimeOptions {
  defaultErrorFallback?: React.ComponentType<{ error: DynamicError }>;
}

export function createRuntime(
  defaultScope: Scope,
  options: CreateRuntimeOptions = {},
): RuntimeAPI {
  const Ctx = React.createContext<RuntimeContextValue | null>(null);
  const PlatformDefaultErrorFallback = options.defaultErrorFallback;

  function DynamicoProvider({ source, scope, children }: DynamicoProviderProps) {
    const registry = React.useMemo(() => {
      const merged: Scope = { ...defaultScope, ...(scope ?? {}) };
      return new Registry(source, merged);
    }, [source, scope]);

    // Auto-report host scope to the registry on mount so the server-side
    // test validator can enforce "every component imports something the host
    // actually provides". Source implementations that don't support scope
    // reporting (e.g. local in-memory sources) leave the call as a no-op.
    React.useEffect(() => {
      const merged: Scope = { ...defaultScope, ...(scope ?? {}) };
      const keys = Object.keys(merged);
      void source.reportScope?.(keys, "host");
      // Re-run whenever the set of keys changes (added/removed providers).
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

  function useScope(): Scope {
    return useRegistry().getScope();
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

  function renderError(
    errorFallback: DynamicComponentProps["errorFallback"],
    error: DynamicError,
  ): React.ReactNode {
    if (errorFallback) {
      if (typeof errorFallback === "function") {
        const Fallback = errorFallback as React.ComponentType<{ error: DynamicError }>;
        return <Fallback error={error} />;
      }
      return errorFallback;
    }
    if (PlatformDefaultErrorFallback) {
      return <PlatformDefaultErrorFallback error={error} />;
    }
    return defaultErrorView(error);
  }

  return { DynamicoProvider, DynamicComponent, useDynamico, useScope };
}

function pickDefault(factory: ComponentFactory): unknown {
  const d = resolveModuleDefault(factory);
  return typeof d === "function" ? d : undefined;
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
