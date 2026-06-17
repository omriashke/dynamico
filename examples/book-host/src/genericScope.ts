import * as React from 'react';
import { View, Text } from 'react-native';
import * as ReactNative from 'react-native';
import * as ReactNativeSvg from 'react-native-svg';
import * as DynamicoWeb from '@omriashke/dynamico-web';
import {
  createPackageScope,
  createRegistryModuleSubscription,
  createUseRegistryModule,
  type Scope,
  type Source,
} from '@omriashke/dynamico-web';
import { stubPackage, stubProvider } from './stubScope.js';
import { usePressScale, USE_NATIVE_DRIVER } from './animation.js';
import {
  createAsyncStorageStub,
  createHostStub,
  createLibphonenumberStub,
} from './hostStubs.js';
import { THEME_SCOPE_VALUES } from './themeScopeValues.js';

/** Registry data modules (palette tokens) — not lazy React components in package scope. */
const REGISTRY_DATA_MODULES = new Set(['Colors']);

/** Synthetic npm packages backed by the full component registry. */
const PACKAGE_SCOPE_KEYS = ['@dynamico/ui', '@newscast/utils-app-ui'] as const;

const DEFAULT_COLORS = {
  white: '#FFFFFF',
  black: '#000000',
  primary: '#F53071',
  secondary: '#FFF5F5',
  grey: 'rgba(0,0,0,0.25)',
  background: '#FFFFFF',
  surface: '#F8F8F8',
  text: '#000000',
  textSecondary: 'rgba(0,0,0,0.6)',
  border: 'rgba(0,0,0,0.1)',
  placeholder: 'rgba(0,0,0,0.4)',
};

export interface RegistryMetadata {
  scopeKeys: string[];
  componentNames: string[];
}

export async function fetchRegistryMetadata(
  registryUrl: string,
  headers: Record<string, string> = {},
): Promise<RegistryMetadata> {
  const base = registryUrl.replace(/\/$/, '');
  const [scopeRes, configRes] = await Promise.all([
    fetch(`${base}/scope`, { headers, cache: 'no-store' }),
    fetch(`${base}/config`, { headers, cache: 'no-store' }),
  ]);

  let scopeKeys: string[] = [];
  if (scopeRes.ok) {
    const body = (await scopeRes.json()) as { keys?: string[] | null };
    if (Array.isArray(body.keys)) scopeKeys = body.keys;
  }

  let componentNames: string[] = [];
  if (configRes.ok) {
    const body = (await configRes.json()) as { components?: Record<string, unknown> };
    if (body.components && typeof body.components === 'object') {
      componentNames = Object.keys(body.components);
    }
  }

  if (componentNames.length === 0) {
    const listRes = await fetch(`${base}/components`, { headers, cache: 'no-store' });
    if (listRes.ok) {
      const list = (await listRes.json()) as Array<{ name?: string }>;
      componentNames = list.map((e) => e.name).filter((n): n is string => typeof n === 'string');
    }
  }

  return { scopeKeys, componentNames };
}

/** scopeKeys from book.config.json — used when GET /scope has no cached host report. */
export async function fetchBookConfigScopeKeys(
  registryUrl: string,
  headers: Record<string, string> = {},
): Promise<string[]> {
  const base = registryUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/book-config`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  const body = (await res.json()) as { scopeKeys?: unknown };
  if (!Array.isArray(body.scopeKeys)) return [];
  return body.scopeKeys.filter((k): k is string => typeof k === 'string' && k.length > 0);
}

function createUiPackageScope(
  source: Source,
  getScope: () => Scope,
  componentNames: readonly string[],
): Record<string, unknown> {
  const lazyComponents = componentNames.filter((n) => !REGISTRY_DATA_MODULES.has(n));

  const colorsSub = createRegistryModuleSubscription(source, getScope, 'Colors', DEFAULT_COLORS);
  const useColors = createUseRegistryModule(colorsSub);

  return createPackageScope(source, getScope, {
    components: lazyComponents,
    reexports: { ThemeProvider: ['useTheme', 'useAppTheme'] },
    values: {
      Colors: colorsSub.proxy,
      useColors,
      usePressScale,
      USE_NATIVE_DRIVER,
      ...THEME_SCOPE_VALUES,
    },
  });
}

function createAppAuthScope(uiPkg: Record<string, unknown>): Record<string, unknown> {
  return {
    useAuth: () => ({
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      logout: async () => undefined,
      sendOtp: async () => true,
      verifyOtp: async () => true,
      clearError: () => undefined,
      error: null,
    }),
    useAppTheme: uiPkg.useTheme,
    ThemeProvider: uiPkg.ThemeProvider,
    AuthProvider: stubProvider,
  };
}

/**
 * Build host scope for Dynamico Book:
 * - Platform modules (react, react-native, …) are always present.
 * - Keys from GET /scope (or book.config scopeKeys fallback) get stubs or registry-backed packages.
 */
export function buildGenericBookScope(
  source: Source,
  options: {
    scopeKeys: readonly string[];
    componentNames: readonly string[];
  },
): Scope {
  const scopeRef: { current: Record<string, unknown> } = { current: {} };
  const getScope = () => scopeRef.current;

  const platformScope: Scope = {
    react: React,
    'react-native': ReactNative,
    'react-native-safe-area-context': {
      SafeAreaView: View,
      SafeAreaProvider: stubProvider,
      useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    },
    'react-native-svg': ReactNativeSvg,
    'react-native-markdown-display': {
      default: function MarkdownStub({ children }: { children?: React.ReactNode }) {
        return React.createElement(Text, null, children);
      },
    },
    '@omriashke/dynamico-native': DynamicoWeb,
  };

  const keys = new Set(options.scopeKeys);
  let uiPkg: Record<string, unknown> | undefined;

  for (const pkgKey of PACKAGE_SCOPE_KEYS) {
    if (keys.has(pkgKey)) {
      uiPkg = createUiPackageScope(source, getScope, options.componentNames);
      break;
    }
  }

  const scope: Scope = { ...platformScope };

  for (const key of keys) {
    if (key in platformScope) continue;

    if (PACKAGE_SCOPE_KEYS.includes(key as (typeof PACKAGE_SCOPE_KEYS)[number])) {
      scope[key] = uiPkg ?? stubPackage();
      continue;
    }
    if (key === '@newscast/app-auth') {
      scope[key] = createAppAuthScope(uiPkg ?? stubPackage());
      continue;
    }
    if (key === '@newscast/host') {
      scope[key] = createHostStub();
      continue;
    }
    if (key === '@react-native-async-storage/async-storage') {
      scope[key] = createAsyncStorageStub();
      continue;
    }
    if (key === 'libphonenumber-js') {
      scope[key] = createLibphonenumberStub();
      continue;
    }
    scope[key] = stubPackage();
  }

  // When the registry has no cached scope yet, still expose common consumer packages.
  if (!uiPkg && options.componentNames.length > 0) {
    uiPkg = createUiPackageScope(source, getScope, options.componentNames);
    scope['@dynamico/ui'] = uiPkg;
    if (!scope['@newscast/app-auth']) {
      scope['@newscast/app-auth'] = createAppAuthScope(uiPkg);
    }
    if (!scope['@newscast/host']) {
      scope['@newscast/host'] = createHostStub();
    }
  }

  scopeRef.current = scope;
  return scope;
}

export { DEFAULT_COLORS };
