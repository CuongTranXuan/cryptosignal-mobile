import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { PriceHistoryChart } from "@/components/price-history-chart";
import { ScreenContainer } from "@/components/screen-container";
import { SignalCard } from "@/components/signal-card";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

const ASSETS = ["BTC/USDT", "ETH/USDT", "BNB/USDT"] as const;
const TIMEFRAMES = ["30m", "1h", "4h"] as const;

export default function SignalsScreen() {
  const colors = useColors();
  const [assetSymbol, setAssetSymbol] = useState<(typeof ASSETS)[number]>("BTC/USDT");
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("1h");
  const signals = trpc.signal.list.useQuery({ limit: 30 });
  const chart = trpc.market.chart.useQuery({ assetSymbol, timeframe, limit: 180 });
  return (
    <ScreenContainer className="px-4" edges={["top", "left", "right"]}>
      <FlatList
        data={signals.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => <SignalCard signal={item} />}
        ListHeaderComponent={<View style={styles.header}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>IMMUTABLE HISTORY</Text><Text style={[styles.title, { color: colors.foreground }]}>Price & signal evidence</Text><Text style={[styles.subtitle, { color: colors.muted }]}>Historical closed candles, indicator overlays, and signal markers are stored with their calculation context.</Text>
          <Segmented items={ASSETS} selected={assetSymbol} onSelect={setAssetSymbol} colors={colors} />
          <Segmented items={TIMEFRAMES} selected={timeframe} onSelect={setTimeframe} colors={colors} />
          {chart.isLoading ? <ActivityIndicator color={colors.primary} /> : chart.data?.candles.length ? <PriceHistoryChart candles={chart.data.candles} signals={chart.data.signals} /> : <Empty title="No candle history yet" detail="Run the configured closed-candle cycle to backfill chart history for this pair and timeframe." colors={colors} />}
          {chart.data?.scenarios.length ? <View style={styles.outlooks}><Text style={[styles.outlookTitle, { color: colors.foreground }]}>Conditional research outlook</Text><Text style={[styles.outlookIntro, { color: colors.muted }]}>These are evidence conditions and observed-volatility bands, not price targets or personalized recommendations.</Text>{chart.data.scenarios.map((scenario) => <View key={scenario.id} style={[styles.scenario, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.scenarioTitle, { color: colors.foreground }]}>{scenario.label}</Text><Text style={[styles.scenarioCopy, { color: colors.muted }]}>{scenario.condition}</Text><Text style={[styles.scenarioMeta, { color: colors.warning }]}>Invalidation: {scenario.invalidation}</Text><Text style={[styles.scenarioMeta, { color: colors.muted }]}>Observed band: {scenario.observedVolatilityBand.lower.toLocaleString()}–{scenario.observedVolatilityBand.upper.toLocaleString()}</Text></View>)}</View> : null}
          <Text style={[styles.historyHeading, { color: colors.foreground }]}>Signal snapshots</Text>
        </View>}
        ListEmptyComponent={signals.isLoading ? <ActivityIndicator color={colors.primary} /> : <Empty title="No snapshots recorded" detail="The Freqtrade runner has not yet submitted a closed-candle result." colors={colors} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </ScreenContainer>
  );
}

function Segmented<T extends string>({ items, selected, onSelect, colors }: { items: readonly T[]; selected: T; onSelect: (value: T) => void; colors: ReturnType<typeof useColors> }) { return <View style={styles.segments}>{items.map((item) => <Pressable key={item} onPress={() => onSelect(item)} style={({ pressed }) => [styles.segment, { borderColor: selected === item ? colors.primary : colors.border, backgroundColor: selected === item ? `${colors.primary}16` : colors.surface }, pressed && styles.pressed]}><Text style={[styles.segmentText, { color: selected === item ? colors.primary : colors.muted }]}>{item}</Text></Pressable>)}</View>; }
function Empty({ title, detail, colors }: { title: string; detail: string; colors: ReturnType<typeof useColors> }) { return <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.emptyCopy, { color: colors.muted }]}>{detail}</Text></View>; }
const styles = StyleSheet.create({ content: { paddingTop: 16, paddingBottom: 28 }, header: { gap: 12, marginBottom: 18 }, eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 1.1 }, title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6 }, subtitle: { fontSize: 14, lineHeight: 21 }, segments: { flexDirection: "row", gap: 7 }, segment: { minHeight: 34, flex: 1, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }, segmentText: { fontSize: 11, fontWeight: "800" }, pressed: { opacity: 0.72 }, outlooks: { gap: 8 }, outlookTitle: { fontSize: 18, fontWeight: "800", marginTop: 4 }, outlookIntro: { fontSize: 12, lineHeight: 18 }, scenario: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 5 }, scenarioTitle: { fontSize: 14, fontWeight: "800" }, scenarioCopy: { fontSize: 12, lineHeight: 18 }, scenarioMeta: { fontSize: 11, lineHeight: 16, fontWeight: "600" }, historyHeading: { fontSize: 18, fontWeight: "800", marginTop: 4 }, separator: { height: 12 }, empty: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 }, emptyTitle: { fontSize: 16, fontWeight: "700" }, emptyCopy: { fontSize: 13, lineHeight: 19 } });
