import type { Scope } from "@omriashke/dynamico-core";
import {
  createThemeProviderModule,
  createColorsModule,
  createAnimationModule,
} from "./registryStubs.js";

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
    loginImageSource: { uri: 'asset:/loginImage.png', width: 1024, height: 1536 },
    LoginHeroImage: () => null,
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
  const colors = createColorsModule();
  const animation = createAnimationModule();
  const themeModule = createThemeProviderModule();
  const themeColors = (colors.Colors ?? colors.default) as Record<string, string>;
  const lightTheme = { id: "light" as const, name: "Light", colors: themeColors };
  return {
    ...colors,
    ...animation,
    ...themeModule,
    useColors: () => themeColors,
    useTheme: themeModule.useTheme,
    useAppTheme: themeModule.useAppTheme,
    lightTheme,
    darkTheme: lightTheme,
    ALL_THEMES: [lightTheme],
    getThemeById: () => lightTheme,
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
  const uiPkg = createUiPackageStub();
  const themeModule = createThemeProviderModule();

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
        useAppTheme: themeModule.useAppTheme,
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
