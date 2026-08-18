import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { SignalCard } from "@/components/signal-card";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

export default function SignalsScreen() {
  const colors = useColors();
  const signals = trpc.signal.list.useQuery({ limit: 30 });
  return (
    <ScreenContainer className="px-4" edges={["top", "left", "right"]}>
      <FlatList
        data={signals.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => <SignalCard signal={item} />}
        ListHeaderComponent={<View style={styles.header}><Text style={[styles.eyebrow, { color: colors.primary }]}>IMMUTABLE HISTORY</Text><Text style={[styles.title, { color: colors.foreground }]}>Signal snapshots</Text><Text style={[styles.subtitle, { color: colors.muted }]}>Each record is persisted from a completed candle before any Telegram notification attempt.</Text></View>}
        ListEmptyComponent={signals.isLoading ? <ActivityIndicator color={colors.primary} /> : <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.emptyTitle, { color: colors.foreground }]}>No snapshots recorded</Text><Text style={[styles.emptyCopy, { color: colors.muted }]}>The Freqtrade runner has not yet submitted a closed-candle result.</Text></View>}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingBottom: 28 },
  header: { gap: 7, marginBottom: 18 },
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 1.1 },
  title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  subtitle: { fontSize: 14, lineHeight: 21 },
  separator: { height: 12 },
  empty: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "700" },
  emptyCopy: { fontSize: 13, lineHeight: 19 },
});
