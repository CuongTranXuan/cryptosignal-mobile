import * as Linking from "expo-linking";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

export default function ConfigurationScreen() {
  const colors = useColors();
  const config = trpc.bot.config.useQuery();
  const status = trpc.bot.status.useQuery();
  const telegramUrl = status.data?.telegramBotUrl;
  return (
    <ScreenContainer className="px-4" edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>READ-ONLY MIRROR</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Configuration</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>Telegram remains the authoritative control surface. Configuration changes are versioned and audited there.</Text>
        {config.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {config.data ? <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ConfigRow label="Config version" value={`v${config.data.configVersion}`} colors={colors} />
          <ConfigRow label="Watchlist" value={config.data.watchlist.join(", ")} colors={colors} />
          <ConfigRow label="Timeframes" value={config.data.timeframes.join(", ")} colors={colors} />
          <ConfigRow label="Rule families" value={config.data.ruleFamilies.join(", ")} colors={colors} />
          <ConfigRow label="Alert threshold" value={`${Math.round(config.data.alertThreshold * 100)}%`} colors={colors} />
          <ConfigRow label="Cooldown" value={`${config.data.cooldownMinutes} minutes`} colors={colors} />
          <ConfigRow label="Quiet hours" value={`${config.data.quietHours.start}–${config.data.quietHours.end} ${config.data.quietHours.timezone}`} colors={colors} />
        </View> : null}
        <Pressable disabled={!telegramUrl} onPress={() => telegramUrl ? Linking.openURL(telegramUrl) : undefined} style={({ pressed }) => [styles.button, { backgroundColor: colors.primary }, !telegramUrl ? styles.disabled : undefined, pressed && telegramUrl ? styles.pressed : undefined]}>
          <Text style={styles.buttonText}>{telegramUrl ? "Manage in Telegram" : "Telegram bot link not configured"}</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

function ConfigRow({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return <View style={styles.row}><Text style={[styles.label, { color: colors.muted }]}>{label}</Text><Text style={[styles.value, { color: colors.foreground }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingBottom: 32, gap: 14 },
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 1.1 },
  title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  subtitle: { fontSize: 14, lineHeight: 21, marginBottom: 6 },
  card: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  row: { padding: 15, gap: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#DCE3F0" },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  value: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  button: { minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 6 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
});
