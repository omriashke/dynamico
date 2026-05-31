import * as React from "react";

const passthrough = (props: { children?: React.ReactNode }) =>
  React.createElement(React.Fragment, null, props.children);

export const SafeAreaProvider = passthrough;
export const SafeAreaView = passthrough;
export const SafeAreaInsetsContext = React.createContext({ top: 0, right: 0, bottom: 0, left: 0 });
export const SafeAreaFrameContext = React.createContext({ x: 0, y: 0, width: 390, height: 844 });
export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
export const useSafeAreaFrame = () => ({ x: 0, y: 0, width: 390, height: 844 });
export const initialWindowMetrics = {
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};
