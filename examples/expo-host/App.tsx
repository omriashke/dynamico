import * as React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  DynamicoProvider,
  DynamicComponent,
  createRemoteSource,
  type DynamicError,
} from "@omriashke/dynamico-native";

declare const process: { env: Record<string, string | undefined> } | undefined;

const REGISTRY_URL =
  (typeof process !== "undefined" && process?.env?.EXPO_PUBLIC_DYNAMICO_REGISTRY) ||
  "http://localhost:4000";

const source = createRemoteSource({ url: REGISTRY_URL });

function ErrorView({ error }: { error: DynamicError }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>
        [{error.kind}] {error.name}@{error.version}: {error.message}
      </Text>
    </View>
  );
}

export default function App() {
  return (
    <DynamicoProvider source={source}>
      <ScrollView contentContainerStyle={styles.container}>
        <StatusBar style="auto" />
        <Text style={styles.title}>Dynamico — Expo Host</Text>
        <Text style={styles.subtitle}>Registry: {REGISTRY_URL}</Text>

        <View style={styles.section}>
          <Text style={styles.h2}>HelloNative</Text>
          <DynamicComponent
            name="HelloNative"
            props={{ name: "Expo" }}
            fallback={<Text>loading…</Text>}
            errorFallback={ErrorView}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>CounterNative</Text>
          <DynamicComponent
            name="CounterNative"
            props={{ initial: 5, label: "taps" }}
            fallback={<Text>loading…</Text>}
            errorFallback={ErrorView}
          />
        </View>
      </ScrollView>
    </DynamicoProvider>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 64, gap: 16 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { color: "#666" },
  section: { gap: 8 },
  h2: { fontSize: 16, fontWeight: "600" },
  errorBox: { padding: 8, backgroundColor: "#fee", borderRadius: 4 },
  errorText: { color: "#900" },
});
