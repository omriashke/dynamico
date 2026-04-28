import * as React from "react";

export const propsSchema = {
  initial: { type: "number", required: false },
  label: { type: "string", required: false },
} as const;

export default function Counter({
  initial = 0,
  label = "count",
}: {
  initial?: number;
  label?: string;
}) {
  const [n, setN] = React.useState(initial);
  return (
    <div style={{ padding: 12, border: "1px solid #ccc", borderRadius: 8 }}>
      <div style={{ marginBottom: 8 }}>
        {label}: <strong>{n}</strong>
      </div>
      <button onClick={() => setN((x) => x + 1)}>+1</button>
      <button onClick={() => setN((x) => x - 1)} style={{ marginLeft: 8 }}>
        -1
      </button>
    </div>
  );
}
