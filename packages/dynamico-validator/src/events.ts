import type { ReactTestInstance } from "react-test-renderer";
import { act } from "./act.js";

/**
 * Fire onPress on a node. The node may be a Pressable, Button, TouchableOpacity,
 * or any host component that accepts onPress. If onPress is missing, throws —
 * because asserting "this thing is pressable" is a useful test all by itself.
 */
export function press(node: ReactTestInstance, eventArg: unknown = {}): void {
  const onPress = node.props?.onPress as ((e: unknown) => void) | undefined;
  if (typeof onPress !== "function") {
    const type = typeof node.type === "string" ? node.type : (node.type as { displayName?: string }).displayName ?? "<anonymous>";
    throw new Error(`press(): node <${type}> has no onPress handler`);
  }
  act(() => {
    onPress(eventArg);
  });
}

export function longPress(node: ReactTestInstance, eventArg: unknown = {}): void {
  const onLongPress = node.props?.onLongPress as ((e: unknown) => void) | undefined;
  if (typeof onLongPress !== "function") {
    throw new Error(`longPress(): node has no onLongPress handler`);
  }
  act(() => {
    onLongPress(eventArg);
  });
}

export function changeText(node: ReactTestInstance, text: string): void {
  const onChangeText = node.props?.onChangeText as ((t: string) => void) | undefined;
  if (typeof onChangeText !== "function") {
    throw new Error(`changeText(): node has no onChangeText handler`);
  }
  act(() => {
    onChangeText(text);
  });
}
