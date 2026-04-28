import * as React from "react";
import { Text, View } from "react-native";

export const propsSchema = {
  name: { type: "string", required: false },
} as const;

export default function HelloNative({ name = "world" }: { name?: string }) {
  return (
    <View style={{ padding: 8 }}>
      <Text style={{ fontSize: 18, fontWeight: "600" }}>Hello, {name}!</Text>
    </View>
  );
}
