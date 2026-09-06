import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

type ChartToolbarProps = {
  showEma: boolean;
  showRsi: boolean;
  showMacd: boolean;
  onToggleEma: () => void;
  onToggleRsi: () => void;
  onToggleMacd: () => void;
};

export function ChartToolbar({ showEma, showRsi, showMacd, onToggleEma, onToggleRsi, onToggleMacd }: ChartToolbarProps) {
  const colors = useColors();
  return (
    <View style={styles.toolRow}>
      <Tool label="EMA" active={showEma} onPress={onToggleEma} colors={colors} />
      <Tool label="RSI" active={showRsi} onPress={onToggleRsi} colors={colors} />
      <Tool label="MACD" active={showMacd} onPress={onToggleMacd} colors={colors} />
    </View>
  );
}

function Tool({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tool, { backgroundColor: active ? `${colors.primary}18` : `${colors.muted}12` }, pressed && styles.pressed]}>
      <Text style={[styles.toolText, { color: active ? colors.primary : colors.muted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toolRow: { flexDirection: "row", gap: 6 },
  tool: { minWidth: 42, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 9, alignItems: "center" },
  toolText: { fontSize: 11, fontWeight: "800" },
  pressed: { opacity: 0.76 },
});
