import type { Scope } from "@omriashke/dynamico-core";

const THEME_COLORS = {
  primary: "#F53071",
  secondary: "#FFF5F5",
  background: "#FFFFFF",
  surface: "#F8F9FA",
  text: "#2F2F2F",
  textSecondary: "rgba(0,0,0,0.5)",
  white: "#FFFFFF",
  black: "#000000",
  disabled: "#E0E0E0",
  grey: "rgba(0,0,0,0.25)",
};

const LIGHT_THEME = {
  id: "light" as const,
  name: "Light",
  colors: THEME_COLORS,
  variants: {
    light: THEME_COLORS,
    dark: { ...THEME_COLORS, background: "#121212", surface: "#1E1E1E", text: "#FFFFFF" },
  },
};

function makeThemeContext() {
  return {
    theme: LIGHT_THEME,
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
    availableThemes: [LIGHT_THEME],
    availablePersonas: [] as string[],
    personaNames: {} as Record<string, string>,
  };
}

/**
 * npm modules and synthetic packages available during worker validation when
 * listed in allowedScope. Built inside the worker thread (not passed via
 * workerData) because module objects are not structured-cloneable.
 */
export function validationHostScope(allowedScope?: readonly string[]): Scope {
  if (!allowedScope?.length) return {};
  const scope: Scope = {};
  if (allowedScope.includes("@newscast/utils-app-ui")) {
    const palette = {
      white: THEME_COLORS.white,
      black: THEME_COLORS.black,
      primary: THEME_COLORS.primary,
      secondary: THEME_COLORS.secondary,
      grey: THEME_COLORS.grey,
    };
    const themeCtx = makeThemeContext();
    scope["@newscast/utils-app-ui"] = {
      Colors: palette,
      useColors: () => palette,
      useTheme: () => themeCtx,
      useAppTheme: () => themeCtx,
      ThemeProvider: ({ children }: { children: unknown }) => children,
      usePressScale: () => ({
        scale: { __animatedValue: true },
        onPressIn: () => undefined,
        onPressOut: () => undefined,
      }),
      USE_NATIVE_DRIVER: false,
      BottomNav: () => null,
      ArrowIcon: () => null,
    };
  }
  if (allowedScope.includes("@newscast/app-auth")) {
    const themeCtx = makeThemeContext();
    scope["@newscast/app-auth"] = {
      useAuth: () => ({
        isAuthenticated: true,
        isLoading: false,
        accessToken: "test-token",
        logout: async () => undefined,
      }),
      useAppTheme: () => themeCtx,
      ThemeProvider: ({ children }: { children: unknown }) => children,
    };
  }
  if (allowedScope.includes("@newscast/app-hooks")) {
    scope["@newscast/app-hooks"] = {
      useUserStats: () => ({
        stats: { saved: 0, read: 0, topics: 0 },
        isLoading: false,
        fetchStats: () => undefined,
      }),
      usePersona: () => ({
        persona: "casual_reader",
        setPersona: async () => undefined,
        retake: async () => undefined,
        isLoading: false,
      }),
      useUserPreferences: () => ({
        preferences: { push_notifications: true },
        updatePreferences: async () => undefined,
        fetchPreferences: () => undefined,
      }),
      secureStore: {
        getItemAsync: async () => null,
        setItemAsync: async () => undefined,
      },
      createGqlClient: () => ({ request: async () => ({}) }),
    };
  }
  if (allowedScope.includes("@newscast/app-components")) {
    scope["@newscast/app-components"] = {
      QuizModal: () => null,
    };
  }
  if (allowedScope.includes("@newscast/app-constants")) {
    scope["@newscast/app-constants"] = {
      Spacing: { xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24 },
    };
  }
  return scope;
}
