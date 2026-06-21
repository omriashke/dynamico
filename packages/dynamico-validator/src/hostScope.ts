import type { Scope } from "@omriashke/dynamico-core";
import {
  createThemeProviderModule,
  createColorsModule,
  createAnimationModule,
} from "./registryStubs.js";

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
  border: "rgba(0,0,0,0.1)",
  placeholder: "rgba(0,0,0,0.4)",
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

function createHostStub(): Record<string, unknown> {
  const secureStore = {
    getItemAsync: async () => null,
    setItemAsync: async () => undefined,
    deleteItemAsync: async () => undefined,
  };
  const gqlClient = { request: async () => ({}) };
  return {
    secureStore,
    createGqlClient: () => gqlClient,
    publicGqlClient: gqlClient,
    loginImage: 1,
    MY_THEME_QUERY: "",
    UPDATE_THEME_MUTATION: "",
    FEED_QUERY: "",
    ARTICLE_QUERY: "",
    SAVE_ARTICLE_MUTATION: "",
    UNSAVE_ARTICLE_MUTATION: "",
    SEARCH_TOPICS_QUERY: "",
    SELECT_TOPICS_MUTATION: "",
    UNSELECT_TOPICS_MUTATION: "",
    MY_TOPICS_QUERY: "",
    TOPICS_DRAWER_QUERY: "",
    MY_STATS_QUERY: "",
    MY_PREFERENCES_QUERY: "",
    UPDATE_PREFERENCES_MUTATION: "",
    MARK_ARTICLE_READ_MUTATION: "",
    SAVED_ARTICLES_QUERY: "",
    READ_ARTICLES_QUERY: "",
  };
}

function createUiPackageStub(): Record<string, unknown> {
  const themeCtx = makeThemeContext();
  const colors = createColorsModule();
  const animation = createAnimationModule();
  const themeModule = createThemeProviderModule();
  return {
    ...colors,
    ...animation,
    ...themeModule,
    useColors: () => THEME_COLORS,
    useTheme: themeModule.useTheme,
    useAppTheme: themeModule.useAppTheme,
    lightTheme: LIGHT_THEME,
    darkTheme: LIGHT_THEME,
    ALL_THEMES: [LIGHT_THEME],
    getThemeById: () => LIGHT_THEME,
    PERSONA_IDS: [] as string[],
    PERSONA_NAMES: {} as Record<string, string>,
    ThemeProvider: themeModule.ThemeProvider,
  };
}

/**
 * Host scope stubs for automatic push validation — mirrors mobile app + book
 * runtime keys so a passing push means the component loads on every medium.
 */
export function validationHostScope(allowedScope?: readonly string[]): Scope {
  if (!allowedScope?.length) return {};
  const scope: Scope = {};
  const themeCtx = makeThemeContext();
  const uiPkg = createUiPackageStub();

  for (const key of allowedScope) {
    if (key === "@dynamico/ui" || key === "@newscast/utils-app-ui") {
      scope[key] = uiPkg;
      continue;
    }
    if (key === "@newscast/app-auth") {
      scope[key] = {
        useAuth: () => ({
          isAuthenticated: false,
          isLoading: false,
          accessToken: null,
          logout: async () => undefined,
          sendOtp: async () => true,
          verifyOtp: async () => true,
          clearError: () => undefined,
          error: null,
        }),
        useAppTheme: () => themeCtx,
        ThemeProvider: uiPkg.ThemeProvider,
        AuthProvider: ({ children }: { children: unknown }) => children,
      };
      continue;
    }
    if (key === "@newscast/host") {
      scope[key] = createHostStub();
      continue;
    }
    if (key === "@react-native-async-storage/async-storage") {
      const store = {
        getItem: async () => null,
        setItem: async () => undefined,
        removeItem: async () => undefined,
      };
      scope[key] = { ...store, default: store, __esModule: true };
      continue;
    }
    if (key === "libphonenumber-js") {
      const libPhone = {
        parsePhoneNumber: () => ({ isValid: () => true, formatInternational: () => "" }),
        isValidPhoneNumber: () => true,
        getCountries: () => ["US", "IL", "GB"],
        getCountryCallingCode: () => "1",
        AsYouType: function AsYouType() {
          return { input: () => "", getNumber: () => undefined };
        },
      };
      scope[key] = { ...libPhone, __esModule: true, default: libPhone };
    }
  }

  return scope;
}
