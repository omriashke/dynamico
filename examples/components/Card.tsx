import * as React from "react";
import Hello from "./Hello";

export default function Card() {
  return (
    <div
      style={{
        padding: 16,
        border: "1px solid #888",
        borderRadius: 12,
        background: "#fafafa",
      }}
    >
      <Hello name="from inside Card" />
      <p style={{ marginTop: 8, color: "#666" }}>
        This Card imports Hello from another dynamic file. Both can be edited
        independently and will hot-swap at runtime.
      </p>
    </div>
  );
}
