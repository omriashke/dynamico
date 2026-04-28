import * as React from "react";
import { Pressable, Text, View } from "react-native";

export const propsSchema = {
  initial: { type: "number", required: false },
  label: { type: "string", required: false },
} as const;

export default function CounterNative({
  initial = 0,
  label = "count",
}: {
  initial?: number;
  label?: string;
}) {
  const [n, setN] = React.useState(initial);
  return (
    <View
      style={{
        padding: 12,
        borderWidth: 1,
        borderColor: "#ccc",
        borderRadius: 8,
        gap: 8,
      }}
    >
      <Text>
        {label}: {n}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={() => setN((x) => x + 1)}
          style={{ padding: 8, backgroundColor: "#eee", borderRadius: 4 }}
        >
          <Text>+1</Text>
        </Pressable>
        <Pressable
          onPress={() => setN((x) => x - 1)}
          style={{ padding: 8, backgroundColor: "#eee", borderRadius: 4 }}
        >
          <Text>-1</Text>
        </Pressable>
      </View>
    </View>
  );
}
