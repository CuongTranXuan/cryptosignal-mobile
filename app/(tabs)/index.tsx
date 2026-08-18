import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";

import { PriceHistoryChart } from "@/components/price-history-chart";
import { ScreenContainer } from "@/components/screen-container";
import { SignalCard } from "@/components/signal-card";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

const ASSETS = ["BTC/USDT", "ETH/USDT", "BNB/USDT"] as const;
const TIMEFRAMES = ["1h", "4h"] as const;

export default function WebDashboard() {
  const colors = useColors();
  const [assetSymbol, setAssetSymbol] = useState<(typeof ASSETS)[number]>("BTC/USDT");
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("1h");
  const status = trpc.bot.status.useQuery();
  const latest = trpc.signal.latest.useQuery();
  const chart = trpc.market.chart.useQuery({ assetSymbol, timeframe, limit: 180 });
  const telegramUrl = status.data?.telegramBotUrl;
  const openTelegram = async () => telegramUrl && Linking.openURL(telegramUrl);

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.shell}>
          <View style={[styles.topbar, { borderColor: colors.border }]}>
            <View><Text style={[styles.brand, { color: colors.primary }]}>CRYPTO SIGNAL</Text><Text style={[styles.brandSub, { color: colors.muted }]}>Research dashboard</Text></View>
            <View style={styles.topbarRight}><Text style={[styles.readOnly, { color: colors.success }]}>READ-ONLY WEB</Text><Pressable disabled={!telegramUrl} onPress={openTelegram} style={({ pressed }) => [styles.telegramLink, { borderColor: colors.primary }, pressed && styles.pressed, !telegramUrl && styles.disabled]}><Text style={[styles.telegramLinkText, { color: colors.primary }]}>{telegramUrl ? "Open Telegram controls" : "Telegram unavailable"}</Text></Pressable></View>
          </View>

          <View style={styles.hero}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>CLOSED-CANDLE MARKET RESEARCH</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>A simple browser view. Telegram remains the bot surface.</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>Inspect persisted OHLCV evidence, indicator context, and historical signals here. Manage watchlists, thresholds, alert delivery, and pause state through the Telegram bot.</Text>
          </View>

          {status.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {status.data ? <View style={[styles.status, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={[styles.statusDot, { backgroundColor: status.data.isPaused ? colors.warning : colors.success }]} /><View style={styles.statusMain}><Text style={[styles.statusTitle, { color: colors.foreground }]}>{status.data.isPaused ? "Alert delivery paused" : "Monitoring completed candles"}</Text><Text style={[styles.statusCopy, { color: colors.muted }]}>{status.data.watchlist.join(" · ")} · {status.data.telegramMode.replaceAll("_", " ")}</Text></View><Text style={[styles.noExecution, { color: colors.primary }]}>NO EXECUTION</Text></View> : null}

          <View style={styles.grid}>
            <View style={styles.primaryColumn}>
              <Panel title="Historical price & signal evidence" subtitle="Tap or drag across a closed candle to inspect it." colors={colors}>
                <Segmented items={ASSETS} selected={assetSymbol} onSelect={setAssetSymbol} colors={colors} />
                <Segmented items={TIMEFRAMES} selected={timeframe} onSelect={setTimeframe} colors={colors} />
                {chart.isLoading ? <ActivityIndicator color={colors.primary} /> : chart.data?.candles.length ? <PriceHistoryChart candles={chart.data.candles} signals={chart.data.signals} /> : <Empty title="No chart history" detail="Run the configured closed-candle cycle to populate this pair and timeframe." colors={colors} />}
              </Panel>
              {chart.data?.scenarios.length ? <Panel title="Conditional research outlook" subtitle="Conditions, evidence, and invalidation—not price targets or personal recommendations." colors={colors}><View style={styles.scenarios}>{chart.data.scenarios.map((scenario) => <View key={scenario.id} style={[styles.scenario, { borderColor: colors.border }]}><Text style={[styles.scenarioTitle, { color: colors.foreground }]}>{scenario.label}</Text><Text style={[styles.scenarioCopy, { color: colors.muted }]}>{scenario.condition}</Text><Text style={[styles.invalidation, { color: colors.warning }]}>Invalidation: {scenario.invalidation}</Text><Text style={[styles.scenarioMeta, { color: colors.muted }]}>Observed volatility band: {scenario.observedVolatilityBand.lower.toLocaleString()}–{scenario.observedVolatilityBand.upper.toLocaleString()}</Text></View>)}</View></Panel> : null}
            </View>
            <View style={styles.sideColumn}>
              <Panel title="Latest persisted signal" subtitle="Saved before a Telegram delivery attempt." colors={colors}>{latest.data ? <SignalCard signal={latest.data} /> : <Empty title="No signal snapshot" detail="The engine has not submitted a completed-candle result yet." colors={colors} />}</Panel>
              <Panel title="Telegram bot surface" subtitle="Use Telegram for every operational change." colors={colors}><View style={styles.commandList}>{["/status — service and delivery state", "/watchlist — view or change tracked pairs", "/threshold and /cooldown — tune alert policy", "/methodology — select evidence families", "/pause or /resume — control alert delivery"].map((command) => <Text key={command} style={[styles.command, { color: colors.muted }]}>{command}</Text>)}</View><Pressable disabled={!telegramUrl} onPress={openTelegram} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, pressed && styles.pressed, !telegramUrl && styles.disabled]}><Text style={styles.primaryButtonText}>Manage in Telegram</Text></Pressable></Panel>
              <View style={[styles.disclosure, { borderColor: colors.border }]}><Text style={[styles.disclosureTitle, { color: colors.foreground }]}>Research boundary</Text><Text style={[styles.disclosureCopy, { color: colors.muted }]}>The dashboard displays historical rule evidence and conditional scenarios. It does not place orders, hold exchange credentials, provide a target price, or issue a personalized recommendation.</Text></View>
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function Panel({ title, subtitle, children, colors }: { title: string; subtitle: string; children: React.ReactNode; colors: ReturnType<typeof useColors> }) { return <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.panelSubtitle, { color: colors.muted }]}>{subtitle}</Text></View>{children}</View>; }
function Segmented<T extends string>({ items, selected, onSelect, colors }: { items: readonly T[]; selected: T; onSelect: (value: T) => void; colors: ReturnType<typeof useColors> }) { return <View style={styles.segments}>{items.map((item) => <Pressable key={item} onPress={() => onSelect(item)} style={({ pressed }) => [styles.segment, { borderColor: selected === item ? colors.primary : colors.border, backgroundColor: selected === item ? `${colors.primary}14` : colors.background }, pressed && styles.pressed]}><Text style={[styles.segmentText, { color: selected === item ? colors.primary : colors.muted }]}>{item}</Text></Pressable>)}</View>; }
function Empty({ title, detail, colors }: { title: string; detail: string; colors: ReturnType<typeof useColors> }) { return <View style={[styles.empty, { backgroundColor: colors.background, borderColor: colors.border }]}><Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.emptyCopy, { color: colors.muted }]}>{detail}</Text></View>; }
const styles = StyleSheet.create({ page: { padding: 20, paddingBottom: 48 }, shell: { width: "100%", maxWidth: 1180, alignSelf: "center", gap: 24 }, topbar: { minHeight: 64, paddingBottom: 16, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }, brand: { fontSize: 14, fontWeight: "900", letterSpacing: 1.6 }, brandSub: { fontSize: 12, marginTop: 3 }, topbarRight: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }, readOnly: { fontSize: 10, fontWeight: "900", letterSpacing: 0.9 }, telegramLink: { minHeight: 36, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, justifyContent: "center" }, telegramLinkText: { fontSize: 12, fontWeight: "800" }, hero: { gap: 8, maxWidth: 780 }, eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 1.2 }, title: { fontSize: 38, lineHeight: 45, fontWeight: "800", letterSpacing: -1.1 }, subtitle: { fontSize: 16, lineHeight: 24 }, status: { borderWidth: 1, borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }, statusDot: { width: 10, height: 10, borderRadius: 5 }, statusMain: { flexGrow: 1, minWidth: 190 }, statusTitle: { fontSize: 15, fontWeight: "800" }, statusCopy: { fontSize: 12, marginTop: 3 }, noExecution: { fontSize: 10, fontWeight: "900", letterSpacing: 0.8 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 18, alignItems: "flex-start" }, primaryColumn: { flexGrow: 4, flexBasis: 600, gap: 18 }, sideColumn: { flexGrow: 2, flexBasis: 310, gap: 18 }, panel: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 }, panelHeader: { gap: 4 }, panelTitle: { fontSize: 19, fontWeight: "800" }, panelSubtitle: { fontSize: 12, lineHeight: 18 }, segments: { flexDirection: "row", gap: 7 }, segment: { minHeight: 34, flex: 1, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }, segmentText: { fontSize: 11, fontWeight: "800" }, scenarios: { gap: 8 }, scenario: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 5 }, scenarioTitle: { fontSize: 14, fontWeight: "800" }, scenarioCopy: { fontSize: 12, lineHeight: 18 }, invalidation: { fontSize: 11, lineHeight: 16, fontWeight: "700" }, scenarioMeta: { fontSize: 11, lineHeight: 16 }, commandList: { gap: 9 }, command: { fontSize: 12, lineHeight: 18 }, primaryButton: { minHeight: 46, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 }, primaryButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" }, disclosure: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 5 }, disclosureTitle: { fontSize: 13, fontWeight: "800" }, disclosureCopy: { fontSize: 12, lineHeight: 18 }, empty: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 5 }, emptyTitle: { fontSize: 14, fontWeight: "800" }, emptyCopy: { fontSize: 12, lineHeight: 18 }, pressed: { opacity: 0.76 }, disabled: { opacity: 0.5 } });
