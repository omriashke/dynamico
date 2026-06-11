import * as React from 'react';
import { View, Text } from 'react-native';
import * as ReactNative from 'react-native';
import * as ReactNativeSvg from 'react-native-svg';
import * as DynamicoWeb from '@omriashke/dynamico-web';
import type { Scope } from '@omriashke/dynamico-web';
import { stubPackage, stubProvider } from './stubScope.js';

const hostStub = stubPackage();

/**
 * Generic web host scope for Dynamico Book. Consumer apps (e.g. Newscast) wire
 * their real design system in their own mobile/web hosts; the book shell stubs
 * missing bindings so catalog previews still mount.
 */
export const dynamicoScope: Scope = {
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
  '@newscast/utils-app-ui': hostStub,
  '@newscast/app-auth': {
    useAuth: () => ({ user: null, isAuthenticated: false, isLoading: false }),
    useAppTheme: () => ({ theme: 'light' as const, colors: {}, isDark: false }),
    AuthProvider: stubProvider,
    ThemeProvider: stubProvider,
  },
  '@newscast/app-hooks': hostStub,
  '@newscast/app-components': hostStub,
  '@newscast/app-constants': hostStub,
};
