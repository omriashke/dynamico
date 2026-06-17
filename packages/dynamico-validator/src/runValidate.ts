import * as React from "react";
import {
  loadModule,
  generateDefaultProps,
  collectBookPreviewPropSets,
  normalizeBookPreviewConfig,
  type Scope,
  type PropsSchema,
  type BookPreviewConfig,
} from "@omriashke/dynamico-core";
import { render } from "./render.js";
import { validationHostScope } from "./hostScope.js";
import { resolveRegistryComponentStub, wrapWithBookProviders } from "./registryStubs.js";
import * as RNMock from "./mocks/react-native.js";
import * as SafeAreaMock from "./mocks/safe-area-context.js";

export interface RunValidateInput {
  name: string;
  componentCode: string;
  allowedScope?: readonly string[];
  registeredComponents?: readonly string[];
  bookConfig?: BookPreviewConfig;
  timeoutMs?: number;
}

export interface RunValidateResult {
  ok: boolean;
  durationMs: number;
  propsSchema?: PropsSchema;
  error?: {
    message: string;
    stack?: string;
    phase: "load" | "scope" | "relative" | "render" | "book" | "no-default-export";
  };
}

const BUILT_IN_SCOPE: Scope = {
  react: React,
  "react-native": RNMock,
  "react-native-safe-area-context": SafeAreaMock,
  "react-native-svg": {},
  "react-native-markdown-display": {
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(RNMock.Text, null, children),
  },
  "@omriashke/dynamico-native": {},
};

function resolveRelativeComponentName(specifier: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../") && !specifier.startsWith("/")) {
    return null;
  }
  const base = specifier
    .replace(/^\.+\//, "")
    .replace(/\.[tj]sx?$/, "")
    .split("/")
    .pop();
  return base || null;
}

function makeStubModule(name: string): unknown {
  const noop = () => makeStubModule(`${name}()`);
  return new Proxy(noop as object, {
    get(_t, key) {
      if (key === "__esModule") return true;
      if (key === "default") return makeStubModule(name);
      if (key === Symbol.iterator) return function* () {};
      if (key === "length") return 0;
      if (typeof key === "symbol") return undefined;
      return makeStubModule(`${name}.${String(key)}`);
    },
    apply() {
      return makeStubModule(`${name}()`);
    },
    has() {
      return true;
    },
  });
}

function buildScope(allowedScope?: readonly string[]): Scope {
  const host = validationHostScope(allowedScope);
  return { ...BUILT_IN_SCOPE, ...host };
}

function requireRelative(
  specifier: string,
  registeredComponents?: readonly string[],
): unknown {
  const base = resolveRelativeComponentName(specifier);
  if (base) {
    const stub = resolveRegistryComponentStub(base);
    if (stub) return stub;
    if (registeredComponents?.length) {
      const registered = new Set(registeredComponents);
      if (!registered.has(base)) {
        throw new Error(
          `relative import '${specifier}' resolves to unregistered component '${base}'`,
        );
      }
    }
  }
  return makeStubModule(`relative:${specifier}`);
}

async function renderComponent(
  Component: React.ComponentType<Record<string, unknown>>,
  props: Record<string, unknown>,
  providers: readonly string[],
  scope: Scope,
): Promise<void> {
  let element = React.createElement(Component, props);
  element = wrapWithBookProviders(element, providers);
  await render(element, { scope, interact: true });
}

export async function runValidate(input: RunValidateInput): Promise<RunValidateResult> {
  const start = performance.now();
  const scope = buildScope(input.allowedScope);
  const bookConfig = input.bookConfig ? normalizeBookPreviewConfig(input.bookConfig) : undefined;
  const providers = bookConfig?.providers ?? [];

  let componentExports: unknown;
  try {
    componentExports = loadModule(input.componentCode, scope, (specifier) =>
      requireRelative(specifier, input.registeredComponents),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const phase = /is not in host scope/.test(msg)
      ? "scope"
      : /unregistered component/.test(msg)
        ? "relative"
        : "load";
    return {
      ok: false,
      durationMs: performance.now() - start,
      error: { phase, message: msg, stack: err instanceof Error ? err.stack : undefined },
    };
  }

  const Component = (componentExports as Record<string, unknown>)?.default as
    | React.ComponentType<Record<string, unknown>>
    | undefined;
  if (typeof Component !== "function") {
    return {
      ok: false,
      durationMs: performance.now() - start,
      error: {
        phase: "no-default-export",
        message: `component '${input.name}' has no default export of a function/class`,
      },
    };
  }

  const propsSchema = (componentExports as Record<string, unknown>)?.propsSchema as
    | PropsSchema
    | undefined;

  try {
    await renderComponent(Component, generateDefaultProps(propsSchema), providers, scope);
  } catch (err) {
    return {
      ok: false,
      durationMs: performance.now() - start,
      propsSchema,
      error: {
        phase: "render",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    };
  }

  if (bookConfig) {
    const previewSets = collectBookPreviewPropSets(bookConfig, input.name);
    for (const preview of previewSets) {
      try {
        await renderComponent(Component, preview.props, providers, scope);
      } catch (err) {
        return {
          ok: false,
          durationMs: performance.now() - start,
          propsSchema,
          error: {
            phase: "book",
            message: `book entry '${preview.entryId}' (${preview.location}): ${err instanceof Error ? err.message : String(err)}`,
            stack: err instanceof Error ? err.stack : undefined,
          },
        };
      }
    }
  }

  return { ok: true, durationMs: performance.now() - start, propsSchema };
}
