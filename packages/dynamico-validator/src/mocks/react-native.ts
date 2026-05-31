/**
 * Minimal `react-native` mock for use inside the dynamico push validator.
 *
 * react-test-renderer treats every JSX tag whose component is a string OR a
 * function as a host component. The real react-native exports each primitive
 * (View, Text, Pressable, ...) as a class/native component that the JS runtime
 * doesn't have at validation time. We substitute each with a tiny functional
 * component that just renders its children. This is enough for:
 *
 *   - assertions about which sub-trees rendered (the test can still
 *     `find(node => node.type.name === 'Text' && node.props.children === 'X')`)
 *   - exercising onPress / onChangeText handlers via the press()/type() helpers
 *   - StyleSheet.create / Animated / Platform — stubbed to no-op
 *
 * We deliberately do NOT import the real `react-native` here: doing so pulls
 * in the iOS/Android bridge code which fails at require() time on Node.
 */
import * as React from "react";

type AnyProps = Record<string, unknown> & { children?: React.ReactNode };

function createHostComponent(displayName: string) {
  const C = (props: AnyProps): React.ReactElement =>
    React.createElement(displayName, props, props.children);
  C.displayName = displayName;
  return C;
}

export const View = createHostComponent("View");
export const Text = createHostComponent("Text");
export const Pressable = createHostComponent("Pressable");
export const TouchableOpacity = createHostComponent("TouchableOpacity");
export const TouchableHighlight = createHostComponent("TouchableHighlight");
export const TouchableWithoutFeedback = createHostComponent("TouchableWithoutFeedback");
export const ScrollView = createHostComponent("ScrollView");
export const SafeAreaView = createHostComponent("SafeAreaView");
export const Image = createHostComponent("Image");
export const TextInput = createHostComponent("TextInput");
export const Switch = createHostComponent("Switch");
export const Modal = createHostComponent("Modal");
export const ActivityIndicator = createHostComponent("ActivityIndicator");
export const KeyboardAvoidingView = createHostComponent("KeyboardAvoidingView");
export const RefreshControl = createHostComponent("RefreshControl");

// FlatList passes data/renderItem in real RN; the mock does the same so
// onPress handlers inside renderItem still get exercised by tests.
export function FlatList(props: AnyProps): React.ReactElement {
  const data = (props as { data?: unknown[] }).data ?? [];
  const renderItem = (props as { renderItem?: (info: { item: unknown; index: number }) => React.ReactElement | null }).renderItem;
  const keyExtractor = (props as { keyExtractor?: (item: unknown, i: number) => string }).keyExtractor;
  return React.createElement(
    "FlatList",
    props,
    ...data.map((item, index) => {
      const child = renderItem ? renderItem({ item, index }) : null;
      const key = keyExtractor ? keyExtractor(item, index) : String(index);
      return child ? React.cloneElement(child, { key }) : null;
    }),
  );
}

export const StyleSheet = {
  create<T extends Record<string, object>>(styles: T): T {
    return styles;
  },
  flatten(style: unknown): unknown {
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.filter(Boolean));
    }
    return style ?? {};
  },
  hairlineWidth: 1,
  absoluteFill: {},
  absoluteFillObject: {},
};

export const Platform = {
  OS: "ios" as const,
  Version: 17,
  select<T>(specifics: { ios?: T; android?: T; default?: T }): T | undefined {
    return specifics.ios ?? specifics.default;
  },
  isPad: false,
  isTV: false,
};

export const Dimensions = {
  get: (_what: "window" | "screen") => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  addEventListener: () => ({ remove: () => {} }),
  removeEventListener: () => {},
};

export const PixelRatio = {
  get: () => 3,
  getFontScale: () => 1,
  roundToNearestPixel: (n: number) => Math.round(n),
  getPixelSizeForLayoutSize: (n: number) => n * 3,
};

const noopAnimatedValue = () => ({
  setValue: () => {},
  interpolate: () => 0,
  addListener: () => "",
  removeListener: () => {},
  removeAllListeners: () => {},
  stopAnimation: () => {},
  resetAnimation: () => {},
  __getValue: () => 0,
});

export const Animated = {
  Value: function (this: unknown) {
    return noopAnimatedValue();
  } as unknown as new (n: number) => ReturnType<typeof noopAnimatedValue>,
  ValueXY: function (this: unknown) {
    return { x: noopAnimatedValue(), y: noopAnimatedValue() };
  } as unknown as new () => { x: ReturnType<typeof noopAnimatedValue>; y: ReturnType<typeof noopAnimatedValue> },
  View,
  Text,
  ScrollView,
  Image,
  FlatList,
  timing: () => ({ start: (cb?: () => void) => cb?.() }),
  spring: () => ({ start: (cb?: () => void) => cb?.() }),
  decay: () => ({ start: (cb?: () => void) => cb?.() }),
  parallel: (animations: Array<{ start: (cb?: () => void) => void }>) => ({
    start: (cb?: () => void) => {
      animations.forEach((a) => a.start());
      cb?.();
    },
  }),
  sequence: (animations: Array<{ start: (cb?: () => void) => void }>) => ({
    start: (cb?: () => void) => {
      animations.forEach((a) => a.start());
      cb?.();
    },
  }),
  loop: () => ({ start: () => {} }),
  createAnimatedComponent: <P,>(C: React.ComponentType<P>) => C,
  event: () => () => {},
};

export const Easing = {
  linear: (t: number) => t,
  ease: (t: number) => t,
  in: (e: (t: number) => number) => e,
  out: (e: (t: number) => number) => e,
  inOut: (e: (t: number) => number) => e,
};

export const Alert = {
  alert: () => {},
  prompt: () => {},
};

export const StatusBar = createHostComponent("StatusBar");

export const Keyboard = {
  dismiss: () => {},
  addListener: () => ({ remove: () => {} }),
  removeListener: () => {},
};

export const InteractionManager = {
  runAfterInteractions: (cb: () => void) => {
    cb();
    return { cancel: () => {} };
  },
  createInteractionHandle: () => 0,
  clearInteractionHandle: () => {},
};

export const NativeModules: Record<string, unknown> = {};

export default {
  View,
  Text,
  Pressable,
  TouchableOpacity,
  TouchableHighlight,
  TouchableWithoutFeedback,
  ScrollView,
  SafeAreaView,
  Image,
  TextInput,
  Switch,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  RefreshControl,
  FlatList,
  StyleSheet,
  Platform,
  Dimensions,
  PixelRatio,
  Animated,
  Easing,
  Alert,
  StatusBar,
  Keyboard,
  InteractionManager,
  NativeModules,
};
