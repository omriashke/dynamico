import * as React from 'react';
import { Text, View } from 'react-native';

/** Auto-stub unknown host scope bindings so any registry component can mount. */
export function stubPackage(): Record<string, unknown> {
  const stubComponent = (props: { title?: string; children?: React.ReactNode }) =>
    React.createElement(Text, null, props?.title ?? props?.children ?? 'Stub');

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === '__esModule') return true;
        if (prop === 'default') return stubComponent;
        if (typeof prop === 'string' && prop.startsWith('use')) return () => ({});
        if (prop === 'Colors') {
          return { primary: '#0066cc', white: '#ffffff', text: '#111111', border: '#dddddd' };
        }
        if (prop === 'Spacing') {
          return { xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24 };
        }
        return stubComponent;
      },
    },
  );
}

export function stubProvider({ children }: { children: React.ReactNode }) {
  return React.createElement(View, null, children);
}
