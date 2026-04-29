import * as React from "react";
import {
  DynamicoProvider,
  DynamicComponent,
  createRemoteSource,
  type DynamicError,
} from "@omriashke/dynamico-web";

const REGISTRY_URL =
  (import.meta.env?.VITE_DYNAMICO_REGISTRY as string | undefined) ??
  "http://localhost:4000";

const source = createRemoteSource({ url: REGISTRY_URL });

function ErrorView({ error }: { error: DynamicError }) {
  return (
    <pre
      style={{
        background: "#fee",
        color: "#900",
        padding: 8,
        borderRadius: 4,
        whiteSpace: "pre-wrap",
      }}
    >
      [{error.kind}] {error.name}@{error.version}: {error.message}
    </pre>
  );
}

export default function App() {
  return (
    <DynamicoProvider source={source}>
      <h1>Dynamico — Web Host</h1>
      <p style={{ color: "#555" }}>
        Components below are loaded at runtime from <code>{REGISTRY_URL}</code>.
        Edit files in <code>examples/components/</code> while the CLI is running
        and watch them update without a page refresh.
      </p>

      <section style={{ marginTop: 24 }}>
        <h2>Hello</h2>
        <DynamicComponent
          name="Hello"
          props={{ name: "Dynamico" }}
          fallback={<em>loading Hello…</em>}
          errorFallback={ErrorView}
        />
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Counter</h2>
        <DynamicComponent
          name="Counter"
          props={{ initial: 5, label: "clicks" }}
          fallback={<em>loading Counter…</em>}
          errorFallback={ErrorView}
        />
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Card (imports Hello)</h2>
        <DynamicComponent
          name="Card"
          fallback={<em>loading Card…</em>}
          errorFallback={ErrorView}
        />
      </section>
    </DynamicoProvider>
  );
}
