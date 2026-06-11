import * as React from 'react';
import { View, Text } from 'react-native';
import * as ReactNative from 'react-native';
import * as ReactNativeSvg from 'react-native-svg';
import * as AppUI from './appUiScope';
import * as DynamicoWeb from '@omriashke/dynamico-web';
import type { Scope } from '@omriashke/dynamico-web';

export const dynamicoScope: Scope = {
  react: React,
  'react-native': ReactNative,
  'react-native-safe-area-context': {
    SafeAreaView: View,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  },
  'react-native-svg': ReactNativeSvg,
  'react-native-markdown-display': {
    default: function MarkdownStub({ children }: { children?: React.ReactNode }) {
      return React.createElement(Text, null, children);
    },
  },
  '@omriashke/dynamico-native': DynamicoWeb,
  '@newscast/utils-app-ui': AppUI,
  '@newscast/app-auth': {
    useAuth: () => ({ user: null, isAuthenticated: false, isLoading: false }),
    useAppTheme: () => ({ theme: 'light' as const, colors: {}, isDark: false }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  },
  '@newscast/app-hooks': new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return () => ({});
      },
    },
  ),
  '@newscast/app-components': new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return () => null;
      },
    },
  ),
  '@newscast/app-constants': {
    Spacing: { xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, '2xl': 32, '3xl': 40, '4xl': 48, '5xl': 64 },
    BorderRadius: { sm: 8, base: 12, md: 16, lg: 20, xl: 24, full: 9999 },
    Typography: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 28, '4xl': 32 },
  },
};
