import * as React from 'react';
import { View, Text } from 'react-native';
import * as ReactNative from 'react-native';
import * as ReactNativeSvg from 'react-native-svg';
import * as DynamicoWeb from '@omriashke/dynamico-web';
import {
  createRemoteSource,
  createPackageScope,
  type Scope,
  type Source,
} from '@omriashke/dynamico-web';
import { stubPackage, stubProvider } from './stubScope.js';

/** Newscast UI primitives served from the registry (matches dynamico/expo/ui/registryComponents.ts). */
export const NEWSCAST_UI_COMPONENTS = [
  'Button',
  'GradientText',
  'IconButton',
  'SearchInput',
  'ViewToggle',
  'BottomNav',
  'TopicChip',
  'SourcesFavicons',
  'ArticleCard',
  'PhoneInput',
  'OtpInput',
  'ArrowIcon',
  'SearchIcon',
  'PersonIcon',
  'GlobeIcon',
  'BookmarkIcon',
  'BookmarkSolidIcon',
  'FilterIcon',
  'SparkleIcon',
  'MoreIcon',
  'SwipeableCard',
] as const;

const UI_STATIC_VALUES = {
  Colors: {
    white: '#FFFFFF',
    black: '#000000',
    primary: '#F53071',
    secondary: '#FFF5F5',
    grey: 'rgba(0,0,0,0.25)',
  },
  ThemeProvider: stubProvider,
  useTheme: () => ({
    theme: 'light' as const,
    colors: {},
    isDark: false,
    themeId: 'light',
  }),
};

const hostStub = stubPackage();

export function buildBookScope(source: Source): Scope {
  const scopeRef: { current: Record<string, unknown> } = { current: {} };
  const getScope = () => scopeRef.current;

  const uiPkg = createPackageScope(source, getScope, {
    components: NEWSCAST_UI_COMPONENTS,
    values: UI_STATIC_VALUES,
  });

  const scope: Scope = {
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
    '@newscast/utils-app-ui': uiPkg,
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
  scopeRef.current = scope;
  return scope;
}

export { createRemoteSource };
