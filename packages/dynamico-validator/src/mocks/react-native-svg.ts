/**
 * Minimal react-native-svg mock for push validation on Node.
 * Icons and GradientText import Svg, Path, Circle, etc.
 */
import * as React from "react";

type SvgProps = Record<string, unknown> & { children?: React.ReactNode };

function createSvgHost(name: string) {
  const C = (props: SvgProps): React.ReactElement =>
    React.createElement(name, props, props.children);
  C.displayName = name;
  return C;
}

export const Svg = createSvgHost("Svg");
export const Circle = createSvgHost("Circle");
export const Rect = createSvgHost("Rect");
export const Path = createSvgHost("Path");
export const G = createSvgHost("G");
export const Line = createSvgHost("Line");
export const Defs = createSvgHost("Defs");
export const LinearGradient = createSvgHost("LinearGradient");
export const RadialGradient = createSvgHost("RadialGradient");
export const Stop = createSvgHost("Stop");
export const ClipPath = createSvgHost("ClipPath");
export const Text = createSvgHost("SvgText");
export const TSpan = createSvgHost("TSpan");
export const Polygon = createSvgHost("Polygon");
export const Polyline = createSvgHost("Polyline");
export const Ellipse = createSvgHost("Ellipse");
export const Mask = createSvgHost("Mask");
export const Use = createSvgHost("Use");
export const Symbol = createSvgHost("Symbol");
export const Image = createSvgHost("SvgImage");
export const ForeignObject = createSvgHost("ForeignObject");

export default {
  Svg,
  Circle,
  Rect,
  Path,
  G,
  Line,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  ClipPath,
  Text,
  TSpan,
  Polygon,
  Polyline,
  Ellipse,
  Mask,
  Use,
  Symbol,
  Image,
  ForeignObject,
};
