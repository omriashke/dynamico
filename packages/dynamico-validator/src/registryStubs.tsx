/**
 * Built-in stand-ins for registry components resolved via relative imports during
 * automatic push validation. Keeps dependency components out of the worker while
 * still exercising real theme / animation contracts.
 */
import * as React from "react";
import * as RNMock from "./mocks/react-native.js";

const THEME_COLORS = {
  primary: "#F53071",
  secondary: "#FFF5F5",
  background: "#FFFFFF",
  surface: "#F8F8F8",
  text: "#000000",
  textSecondary: "rgba(0,0,0,0.6)",
  white: "#FFFFFF",
  black: "#000000",
  border: "rgba(0,0,0,0.1)",
  placeholder: "rgba(0,0,0,0.4)",
  grey: "rgba(0,0,0,0.25)",
  disabled: "#E0E0E0",
};

function noopAnimatedValue() {
  return {
    setValue: () => undefined,
    interpolate: () => 0,
    addListener: () => "",
    removeListener: () => undefined,
    removeAllListeners: () => undefined,
    stopAnimation: () => undefined,
    resetAnimation: () => undefined,
    __getValue: () => 1,
  };
}

let themeProviderModule: Record<string, unknown> | undefined;

export function createThemeProviderModule(): Record<string, unknown> {
  if (themeProviderModule) return themeProviderModule;
  const theme = { id: "light" as const, name: "Light", colors: THEME_COLORS };
  const ctx = {
    theme,
    themeId: "light" as const,
    themeMode: "light" as const,
    setTheme: async () => undefined,
    setThemeId: async () => undefined,
    setThemeMode: async () => undefined,
    toggleTheme: () => undefined,
    toggleThemeMode: () => undefined,
    isDark: false,
    currentColors: THEME_COLORS,
    colors: THEME_COLORS,
    availableThemes: [theme],
    availablePersonas: [] as string[],
    personaNames: {} as Record<string, string>,
  };
  const Ctx = React.createContext(ctx);

  function ThemeProvider({ children }: { children?: React.ReactNode }) {
    return React.createElement(Ctx.Provider, { value: ctx }, children);
  }

  function useTheme() {
    return React.useContext(Ctx) ?? ctx;
  }

  themeProviderModule = {
    ThemeProvider,
    useTheme,
    useAppTheme: useTheme,
    useThemeColors: () => THEME_COLORS,
    default: ThemeProvider,
  };
  return themeProviderModule;
}

export function createColorsModule(): Record<string, unknown> {
  return {
    Colors: THEME_COLORS,
    DEFAULT_COLORS: THEME_COLORS,
    default: THEME_COLORS,
  };
}

export function createAnimationModule(): Record<string, unknown> {
  const scale = noopAnimatedValue();
  return {
    usePressScale: () => ({
      scale,
      onPressIn: () => undefined,
      onPressOut: () => undefined,
    }),
    USE_NATIVE_DRIVER: false,
  };
}

const FACTORIES: Record<string, () => Record<string, unknown>> = {
  ThemeProvider: createThemeProviderModule,
  Colors: createColorsModule,
};

export function resolveRegistryComponentStub(name: string): Record<string, unknown> | undefined {
  const factory = FACTORIES[name];
  return factory ? factory() : undefined;
}

const registeredComponentStubs = new Map<string, React.ComponentType<Record<string, unknown>>>();

/** Minimal React component for a registered peer during push validation. */
export function createRegisteredComponentStub(
  name: string,
): React.ComponentType<Record<string, unknown>> {
  let Stub = registeredComponentStubs.get(name);
  if (!Stub) {
    Stub = function RegisteredComponentStub(props: Record<string, unknown>) {
      const label =
        (typeof props.title === "string" && props.title) ||
        (typeof props.label === "string" && props.label) ||
        `[${name}]`;
      return React.createElement(
        RNMock.View,
        null,
        React.createElement(RNMock.Text, null, label),
      );
    };
    Stub.displayName = `RegistryStub(${name})`;
    registeredComponentStubs.set(name, Stub);
  }
  return Stub;
}

/** CommonJS module shape for `require("../ui/Button/Button")` etc. */
export function createRegisteredComponentStubModule(name: string): Record<string, unknown> {
  const Stub = createRegisteredComponentStub(name);
  return { __esModule: true, default: Stub, [name]: Stub };
}

export function resolveRegisteredComponentStubModule(
  name: string,
): Record<string, unknown> | undefined {
  const special = resolveRegistryComponentStub(name);
  if (special) return special;
  return createRegisteredComponentStubModule(name);
}

/** Provider components from book.config.json — same stubs used as wrappers. */
export function createProviderElement(
  name: string,
  children: React.ReactNode,
): React.ReactElement | null {
  const stub = resolveRegistryComponentStub(name);
  if (!stub) return null;
  const Provider = (stub.ThemeProvider ?? stub.default) as React.ComponentType<{
    children?: React.ReactNode;
  }>;
  if (typeof Provider !== "function") return null;
  return React.createElement(Provider, { children });
}

export function wrapWithBookProviders(
  element: React.ReactElement,
  providers: readonly string[],
): React.ReactElement {
  return providers.reduce<React.ReactElement>((child, name) => {
    const wrapped = createProviderElement(name, child);
    return wrapped ?? child;
  }, element);
}
