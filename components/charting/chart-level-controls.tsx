import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

type ChartLevelControlsProps = {
  hasLevels: boolean;
  onAddLevel: () => void;
  onClearLevels: () => void;
};

export function ChartLevelControls({ hasLevels, onAddLevel, onClearLevels }: ChartLevelControlsProps) {
  const colors = useColors();
  return (
    <View style={styles.levelRow}>
      <Pressable onPress={onAddLevel} style={({ pressed }) => [styles.levelButton, { borderColor: colors.primary }, pressed && styles.pressed]}>
        <Text style={[styles.levelText, { color: colors.primary }]}>Add close as level</Text>
      </Pressable>
      <Pressable disabled={!hasLevels} onPress={onClearLevels} style={({ pressed }) => [styles.levelButton, { borderColor: colors.border }, pressed && styles.pressed, !hasLevels && styles.disabled]}>
        <Text style={[styles.levelText, { color: colors.muted }]}>Clear levels</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  levelRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  levelButton: { minHeight: 32, borderWidth: 1, borderRadius: 8, justifyContent: "center", paddingHorizontal: 10 },
  levelText: { fontSize: 11, fontWeight: "800" },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.5 },
});
