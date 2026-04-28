import * as React from "react";

export const propsSchema = {
  name: { type: "string", required: false },
} as const;

export default function Hello({ name = "world" }: { name?: string }) {
  return <span style={{ fontWeight: 600 }}>Hello, {name}!</span>;
}
