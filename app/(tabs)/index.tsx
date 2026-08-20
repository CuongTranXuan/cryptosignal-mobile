import { useEffect, useState } from "react";
import { ActivityIndicator, LayoutChangeEvent, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { DashboardAuthScreen } from "@/components/dashboard-auth-screen";
import { OperationalAuditPanel } from "@/components/operational-audit-panel";
import { PriceHistoryChart } from "@/components/price-history-chart";
import { ScreenContainer } from "@/components/screen-container";
import { SignalCard } from "@/components/signal-card";
import { useDashboardAuth } from "@/hooks/use-dashboard-auth";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

const ASSETS = ["BTC/USDT", "ETH/USDT", "BNB/USDT"] as const;
const TIMEFRAMES = ["30m", "1h", "4h"] as const;
const RULE_FAMILIES = [
  { id: "TREND", label: "Trend" },
  { id: "MOMENTUM", label: "Momentum" },
  { id: "VOLUME", label: "Volume" },
  { id: "CANDLE_PATTERN", label: "Candle patterns" },
  { id: "WYCKOFF", label: "Wyckoff" },
  { id: "SMC", label: "SMC" },
  { id: "ELLIOTT_EXPERIMENTAL", label: "Elliott (experimental)" },
] as const;
type ControlNotice = { tone: "success" | "error"; text: string } | null;

export default function WebDashboard() {
  const auth = useDashboardAuth();
  const colors = useColors();
  if (auth.loading) return <ScreenContainer edges={["top", "bottom", "left", "right"]} className="items-center justify-center"><ActivityIndicator color={colors.primary} /></ScreenContainer>;
  if (!auth.authenticated) return <DashboardAuthScreen onSignIn={auth.signIn} />;
  return <AuthenticatedDashboard username={auth.user?.username ?? "user"} onSignOut={auth.signOut} />;
}

function AuthenticatedDashboard({ username, onSignOut }: { username: string; onSignOut: () => Promise<void> }) {
  const colors = useColors();
  const [assetSymbol, setAssetSymbol] = useState<(typeof ASSETS)[number]>("BTC/USDT");
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("1h");
  const [cooldownDraft, setCooldownDraft] = useState("60");
  const [controlNotice, setControlNotice] = useState<ControlNotice>(null);
  const status = trpc.bot.status.useQuery(undefined, { refetchInterval: 30_000, refetchIntervalInBackground: true });
  const configuration = trpc.bot.config.useQuery();
  const latest = trpc.signal.latest.useQuery();
  const chart = trpc.market.chart.useQuery({ assetSymbol, timeframe, limit: 180 });
  const refreshSharedState = async () => {
    await Promise.all([configuration.refetch(), status.refetch()]);
  };
  const confirmControl = async (text: string) => {
    await refreshSharedState();
    setControlNotice({ tone: "success", text });
  };
  const reportControlError = (error: unknown) => {
    const message = typeof error === "object" && error && "message" in error && typeof error.message === "string" ? error.message : "The shared configuration could not be saved. Try again.";
    setControlNotice({ tone: "error", text: message });
  };
  const pauseMutation = trpc.bot.controls.setPaused.useMutation({ onSuccess: () => confirmControl("Signal processing state updated. Telegram will share it when integration is enabled."), onError: reportControlError });
  const watchlistMutation = trpc.bot.controls.setWatchlist.useMutation({ onSuccess: () => confirmControl("Watchlist updated for the next closed-candle cycle."), onError: reportControlError });
  const timeframesMutation = trpc.bot.controls.setTimeframes.useMutation({ onSuccess: () => confirmControl("Timeframe selection saved for the web app and optional Telegram integration."), onError: reportControlError });
  const thresholdMutation = trpc.bot.controls.setThreshold.useMutation({ onSuccess: () => confirmControl("Alert threshold updated."), onError: reportControlError });
  const cooldownMutation = trpc.bot.controls.setCooldown.useMutation({ onSuccess: () => confirmControl("Alert cooldown updated."), onError: reportControlError });
  const rulesMutation = trpc.bot.controls.setRuleFamilies.useMutation({ onSuccess: () => confirmControl("Research rule families updated."), onError: reportControlError });
  const config = configuration.data;
  const configuredCooldownMinutes = config?.cooldownMinutes;
  const isSaving = pauseMutation.isPending || watchlistMutation.isPending || timeframesMutation.isPending || thresholdMutation.isPending || cooldownMutation.isPending || rulesMutation.isPending;

  useEffect(() => {
    if (configuredCooldownMinutes !== undefined) setCooldownDraft(String(configuredCooldownMinutes));
  }, [configuredCooldownMinutes]);

  const telegramUrl = status.data?.telegramBotUrl;
  const openTelegram = async () => telegramUrl && Linking.openURL(telegramUrl);
  const toggleConfigValue = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  const saveCooldown = () => {
    const cooldownMinutes = Number(cooldownDraft);
    if (Number.isInteger(cooldownMinutes) && cooldownMinutes >= 1 && cooldownMinutes <= 1440) {
      cooldownMutation.mutate({ cooldownMinutes });
      return;
    }
    setControlNotice({ tone: "error", text: "Cooldown must be a whole number from 1 to 1,440 minutes." });
  };

  return <ScreenContainer edges={["top", "left", "right", "bottom"]}><ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}><View style={styles.shell}>
    <View style={[styles.topbar, { borderColor: colors.border }]}>
      <View><Text style={[styles.brand, { color: colors.primary }]}>CRYPTO SIGNAL</Text><Text style={[styles.brandSub, { color: colors.muted }]}>Signed in as {username}</Text></View>
      <View style={styles.topbarRight}>
        <Text style={[styles.controlTag, { color: colors.success }]}>WEB CONTROL</Text>
        <Pressable onPress={() => void onSignOut()} style={({ pressed }) => [styles.signOut, { borderColor: colors.border }, pressed && styles.pressed]}><Text style={[styles.signOutText, { color: colors.muted }]}>Sign out</Text></Pressable>
        <Pressable disabled={!telegramUrl} onPress={openTelegram} style={({ pressed }) => [styles.telegramLink, { borderColor: colors.primary }, pressed && styles.pressed, !telegramUrl && styles.disabled]}><Text style={[styles.telegramLinkText, { color: colors.primary }]}>{telegramUrl ? "Open Telegram" : "Telegram unavailable"}</Text></Pressable>
      </View>
    </View>
    <View style={styles.hero}><Text style={[styles.eyebrow, { color: colors.primary }]}>CLOSED-CANDLE MARKET RESEARCH</Text><Text style={[styles.title, { color: colors.foreground }]}>Signals, conditional outlooks, and web-native operational controls.</Text><Text style={[styles.subtitle, { color: colors.muted }]}>The dashboard is ready to test independently. Telegram is an optional integration that adopts the same versioned configuration when enabled. Every alert and scenario remains signals-only research based on completed OHLCV candles.</Text></View>
    {status.isLoading || configuration.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
    {status.data ? <View style={[styles.status, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={[styles.statusDot, { backgroundColor: status.data.isPaused ? colors.warning : colors.success }]} /><View style={styles.statusMain}><Text style={[styles.statusTitle, { color: colors.foreground }]}>{status.data.isPaused ? "Signal processing paused" : "Monitoring completed candles"}</Text><Text style={[styles.statusCopy, { color: colors.muted }]}>{status.data.watchlist.join(" · ")} · {status.data.timeframes.join(" · ")} · runner {status.data.runnerHealth.state.toLowerCase()}</Text></View><Text style={[styles.noExecution, { color: colors.primary }]}>NO EXECUTION</Text></View> : null}
    <View style={styles.grid}>
      <View style={styles.primaryColumn}>
        <Panel title="Historical price & signal evidence" subtitle="Pan, zoom, use the crosshair, and inspect completed candles and persisted annotations." colors={colors}>
          <Segmented items={ASSETS} selected={assetSymbol} onSelect={setAssetSymbol} colors={colors} />
          <Segmented items={TIMEFRAMES} selected={timeframe} onSelect={setTimeframe} colors={colors} />
          {chart.isLoading ? <ActivityIndicator color={colors.primary} /> : chart.data?.candles.length ? <PriceHistoryChart candles={chart.data.candles} signals={chart.data.signals} /> : <Empty title="No chart history" detail="Run the configured closed-candle cycle to populate this pair and timeframe." colors={colors} />}
        </Panel>
        {chart.data?.scenarios.length ? <Panel title="Conditional research outlook" subtitle="Conditions, evidence, and invalidation—not price targets or personal recommendations." colors={colors}><View style={styles.scenarios}>{chart.data.scenarios.map((scenario) => <View key={scenario.id} style={[styles.scenario, { borderColor: colors.border }]}><Text style={[styles.scenarioTitle, { color: colors.foreground }]}>{scenario.label}</Text><Text style={[styles.scenarioCopy, { color: colors.muted }]}>{scenario.condition}</Text><Text style={[styles.invalidation, { color: colors.warning }]}>Invalidation: {scenario.invalidation}</Text><Text style={[styles.scenarioMeta, { color: colors.muted }]}>Observed volatility band: {scenario.observedVolatilityBand.lower.toLocaleString()}–{scenario.observedVolatilityBand.upper.toLocaleString()}</Text></View>)}</View></Panel> : null}
      </View>
      <View style={styles.sideColumn}>
        <Panel title="Signal controls" subtitle="Changes here affect the web research workflow and the next configured closed-candle cycle. Telegram shares them only when enabled." colors={colors}>
          {config ? <>
            <View style={[styles.syncBanner, { backgroundColor: colors.background, borderColor: colors.border }]}><View><Text style={[styles.syncTitle, { color: colors.foreground }]}>Config v{config.configVersion}</Text><Text style={[styles.syncCopy, { color: colors.muted }]}>Last change: {config.lastChangedBy.toLowerCase()} · Telegram {status.data?.telegramPoller.state.toLowerCase() ?? "unknown"}</Text></View><View style={styles.syncActions}><Text style={[styles.syncState, { color: config.isPaused ? colors.warning : colors.success }]}>{config.isPaused ? "PAUSED" : "ACTIVE"}</Text><Pressable onPress={() => void refreshSharedState()} style={({ pressed }) => [styles.refreshButton, { borderColor: colors.border }, pressed && styles.pressed]}><Text style={[styles.refreshText, { color: colors.muted }]}>Refresh</Text></Pressable></View></View>
            {controlNotice ? <View style={[styles.controlNotice, { backgroundColor: controlNotice.tone === "success" ? `${colors.success}14` : `${colors.error}14`, borderColor: controlNotice.tone === "success" ? colors.success : colors.error }]}><Text style={[styles.controlNoticeText, { color: controlNotice.tone === "success" ? colors.success : colors.error }]}>{controlNotice.text}</Text><Pressable accessibilityLabel="Dismiss control message" onPress={() => setControlNotice(null)}><Text style={[styles.dismissText, { color: controlNotice.tone === "success" ? colors.success : colors.error }]}>Dismiss</Text></Pressable></View> : null}
            <Pressable disabled={isSaving} onPress={() => pauseMutation.mutate({ isPaused: !config.isPaused })} style={({ pressed }) => [styles.pauseButton, { backgroundColor: config.isPaused ? colors.success : colors.warning }, pressed && styles.pressed, isSaving && styles.disabled]}><Text style={styles.pauseButtonText}>{config.isPaused ? "Resume signal processing" : "Pause signal processing"}</Text></Pressable>
            <ControlGroup label="Watchlist" help="At least one market remains selected."><ToggleGrid items={ASSETS} values={config.watchlist} onToggle={(value) => { const next = toggleConfigValue(config.watchlist, value); if (next.length) watchlistMutation.mutate({ watchlist: next as (typeof ASSETS)[number][] }); }} colors={colors} disabled={isSaving} /></ControlGroup>
            <ControlGroup label="Timeframes" help="30m, 1h, and 4h use closed candles only."><ToggleGrid items={TIMEFRAMES} values={config.timeframes} onToggle={(value) => { const next = toggleConfigValue(config.timeframes, value); if (next.length) timeframesMutation.mutate({ timeframes: next as (typeof TIMEFRAMES)[number][] }); }} colors={colors} disabled={isSaving} /></ControlGroup>
            <ControlGroup label={`Alert threshold · ${Math.round(config.alertThreshold * 100)}%`} help="Minimum normalized evidence score before an enabled delivery integration is attempted."><ThresholdRail value={config.alertThreshold} onChange={(alertThreshold) => thresholdMutation.mutate({ alertThreshold })} colors={colors} disabled={isSaving} /></ControlGroup>
            <ControlGroup label="Alert cooldown" help="Minutes before the same signal state can be alerted again."><View style={styles.cooldownRow}><TextInput value={cooldownDraft} onChangeText={setCooldownDraft} onSubmitEditing={saveCooldown} keyboardType="number-pad" accessibilityLabel="Alert cooldown in minutes" style={[styles.cooldownInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]} /><Text style={[styles.cooldownUnit, { color: colors.muted }]}>min</Text><Pressable disabled={isSaving} onPress={saveCooldown} style={({ pressed }) => [styles.saveButton, { backgroundColor: colors.primary }, pressed && styles.pressed, isSaving && styles.disabled]}><Text style={styles.saveButtonText}>Save</Text></Pressable></View></ControlGroup>
            <ControlGroup label="Rule families" help="Enables explainable research evidence families; experimental proxies are clearly labeled."><ToggleGrid items={RULE_FAMILIES.map((family) => family.id)} labels={Object.fromEntries(RULE_FAMILIES.map((family) => [family.id, family.label]))} values={config.ruleFamilies} onToggle={(value) => rulesMutation.mutate({ ruleFamilies: toggleConfigValue(config.ruleFamilies, value) as (typeof RULE_FAMILIES)[number]["id"][] })} colors={colors} disabled={isSaving} /></ControlGroup>
            {isSaving ? <Text style={[styles.savingText, { color: colors.muted }]}>Saving shared configuration…</Text> : null}
          </> : <Empty title="Controls unavailable" detail="Configuration could not be loaded. Retry after the API is available." colors={colors} />}
        </Panel>
        <Panel title="Latest persisted signal" subtitle="Saved as web research evidence before any optional delivery integration." colors={colors}>{latest.data ? <SignalCard signal={latest.data} /> : <Empty title="No signal snapshot" detail="The engine has not submitted a completed-candle result yet." colors={colors} />}</Panel>
        <OperationalAuditPanel runnerHealth={status.data?.runnerHealth ?? null} />
        <Panel title="Optional Telegram integration" subtitle="The web app is fully testable without Telegram. Enable the integration later to share this configuration and deliver eligible alerts." colors={colors}><View style={styles.commandList}>{["Shared configuration — watchlist, timeframes, policies, pause/resume", "Optional commands — /watchlist, /timeframes, /threshold, /cooldown", "Delivery remains signals-only and never executes orders"].map((command) => <Text key={command} style={[styles.command, { color: colors.muted }]}>{command}</Text>)}</View><Pressable disabled={!telegramUrl} onPress={openTelegram} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, pressed && styles.pressed, !telegramUrl && styles.disabled]}><Text style={styles.primaryButtonText}>{telegramUrl ? "Open Telegram integration" : "Telegram integration not configured"}</Text></Pressable></Panel>
        <View style={[styles.disclosure, { borderColor: colors.border }]}><Text style={[styles.disclosureTitle, { color: colors.foreground }]}>Research boundary</Text><Text style={[styles.disclosureCopy, { color: colors.muted }]}>The dashboard displays historical rule evidence and conditional scenarios. It does not place orders, hold exchange credentials, provide a target price, or issue a personalized recommendation.</Text></View>
      </View>
    </View>
  </View></ScrollView></ScreenContainer>;
}

function Panel({ title, subtitle, children, colors }: { title: string; subtitle: string; children: React.ReactNode; colors: ReturnType<typeof useColors> }) { return <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.panelSubtitle, { color: colors.muted }]}>{subtitle}</Text></View>{children}</View>; }
function ControlGroup({ label, help, children }: { label: string; help: string; children: React.ReactNode }) { const colors = useColors(); return <View style={styles.controlGroup}><Text style={[styles.controlLabel, { color: colors.foreground }]}>{label}</Text><Text style={[styles.controlHelp, { color: colors.muted }]}>{help}</Text>{children}</View>; }
function Segmented<T extends string>({ items, selected, onSelect, colors }: { items: readonly T[]; selected: T; onSelect: (value: T) => void; colors: ReturnType<typeof useColors> }) { return <View style={styles.segments}>{items.map((item) => <Pressable key={item} onPress={() => onSelect(item)} style={({ pressed }) => [styles.segment, { borderColor: selected === item ? colors.primary : colors.border, backgroundColor: selected === item ? `${colors.primary}14` : colors.background }, pressed && styles.pressed]}><Text style={[styles.segmentText, { color: selected === item ? colors.primary : colors.muted }]}>{item}</Text></Pressable>)}</View>; }
function ToggleGrid({ items, labels, values, onToggle, colors, disabled }: { items: readonly string[]; labels?: Record<string, string>; values: string[]; onToggle: (value: string) => void; colors: ReturnType<typeof useColors>; disabled: boolean }) { return <View style={styles.toggleGrid}>{items.map((item) => { const active = values.includes(item); return <Pressable disabled={disabled} key={item} onPress={() => onToggle(item)} style={({ pressed }) => [styles.choice, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? `${colors.primary}14` : colors.background }, pressed && styles.pressed, disabled && styles.disabled]}><View style={[styles.choiceDot, { borderColor: active ? colors.primary : colors.muted, backgroundColor: active ? colors.primary : "transparent" }]}>{active ? <Text style={styles.choiceTick}>✓</Text> : null}</View><Text style={[styles.choiceText, { color: active ? colors.foreground : colors.muted }]}>{labels?.[item] ?? item}</Text></Pressable>; })}</View>; }
function ThresholdRail({ value, onChange, colors, disabled }: { value: number; onChange: (value: number) => void; colors: ReturnType<typeof useColors>; disabled: boolean }) { const [width, setWidth] = useState(1); const update = (event: { nativeEvent: { locationX: number } }) => { if (!disabled) onChange(Math.round(Math.max(0, Math.min(1, event.nativeEvent.locationX / width)) * 100) / 100); }; return <View onLayout={(event: LayoutChangeEvent) => setWidth(Math.max(1, event.nativeEvent.layout.width))}><Pressable accessibilityRole="adjustable" accessibilityLabel="Alert threshold" accessibilityValue={{ min: 0, max: 1, now: value }} disabled={disabled} onPress={update} style={({ pressed }) => [styles.thresholdTrack, { backgroundColor: colors.border }, pressed && styles.pressed, disabled && styles.disabled]}><View style={[styles.thresholdFill, { width: `${value * 100}%`, backgroundColor: colors.primary }]} /><View style={[styles.thresholdThumb, { left: `${value * 100}%`, backgroundColor: colors.primary, borderColor: colors.surface }]} /></Pressable><View style={styles.thresholdScale}><Text style={[styles.scaleText, { color: colors.muted }]}>0%</Text><Text style={[styles.scaleText, { color: colors.muted }]}>50%</Text><Text style={[styles.scaleText, { color: colors.muted }]}>100%</Text></View></View>; }
function Empty({ title, detail, colors }: { title: string; detail: string; colors: ReturnType<typeof useColors> }) { return <View style={[styles.empty, { backgroundColor: colors.background, borderColor: colors.border }]}><Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.emptyCopy, { color: colors.muted }]}>{detail}</Text></View>; }

const styles = StyleSheet.create({ page: { padding: 20, paddingBottom: 48 }, shell: { width: "100%", maxWidth: 1180, alignSelf: "center", gap: 24 }, topbar: { minHeight: 64, paddingBottom: 16, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }, brand: { fontSize: 14, fontWeight: "900", letterSpacing: 1.6 }, brandSub: { fontSize: 12, marginTop: 3 }, topbarRight: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }, controlTag: { fontSize: 10, fontWeight: "900", letterSpacing: 0.9 }, signOut: { minHeight: 36, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, justifyContent: "center" }, signOutText: { fontSize: 12, fontWeight: "800" }, telegramLink: { minHeight: 36, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, justifyContent: "center" }, telegramLinkText: { fontSize: 12, fontWeight: "800" }, hero: { gap: 8, maxWidth: 800 }, eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 1.2 }, title: { fontSize: 38, lineHeight: 45, fontWeight: "800", letterSpacing: -1.1 }, subtitle: { fontSize: 16, lineHeight: 24 }, status: { borderWidth: 1, borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }, statusDot: { width: 10, height: 10, borderRadius: 5 }, statusMain: { flexGrow: 1, minWidth: 190 }, statusTitle: { fontSize: 15, fontWeight: "800" }, statusCopy: { fontSize: 12, marginTop: 3 }, noExecution: { fontSize: 10, fontWeight: "900", letterSpacing: 0.8 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 18, alignItems: "flex-start" }, primaryColumn: { flexGrow: 4, flexBasis: 600, gap: 18 }, sideColumn: { flexGrow: 2, flexBasis: 330, gap: 18 }, panel: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 }, panelHeader: { gap: 4 }, panelTitle: { fontSize: 19, fontWeight: "800" }, panelSubtitle: { fontSize: 12, lineHeight: 18 }, segments: { flexDirection: "row", gap: 7 }, segment: { minHeight: 34, flex: 1, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }, segmentText: { fontSize: 11, fontWeight: "800" }, scenarios: { gap: 8 }, scenario: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 5 }, scenarioTitle: { fontSize: 14, fontWeight: "800" }, scenarioCopy: { fontSize: 12, lineHeight: 18 }, invalidation: { fontSize: 11, lineHeight: 16, fontWeight: "700" }, scenarioMeta: { fontSize: 11, lineHeight: 16 }, syncBanner: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, syncActions: { alignItems: "flex-end", gap: 7 }, syncTitle: { fontSize: 14, fontWeight: "800" }, syncCopy: { fontSize: 11, marginTop: 3, textTransform: "capitalize" }, syncState: { fontSize: 10, fontWeight: "900", letterSpacing: 0.8 }, refreshButton: { minHeight: 24, borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, justifyContent: "center" }, refreshText: { fontSize: 10, fontWeight: "800" }, controlNotice: { borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, controlNoticeText: { fontSize: 11, fontWeight: "700", flex: 1, lineHeight: 16 }, dismissText: { fontSize: 10, fontWeight: "900" }, pauseButton: { minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, pauseButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" }, controlGroup: { gap: 6, paddingTop: 4 }, controlLabel: { fontSize: 13, fontWeight: "800" }, controlHelp: { fontSize: 11, lineHeight: 16 }, toggleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, choice: { minHeight: 36, flexGrow: 1, flexBasis: "44%", borderWidth: 1, borderRadius: 9, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 7 }, choiceDot: { width: 15, height: 15, borderWidth: 1, borderRadius: 8, alignItems: "center", justifyContent: "center" }, choiceTick: { fontSize: 10, color: "#FFFFFF", fontWeight: "900", lineHeight: 12 }, choiceText: { fontSize: 11, fontWeight: "700", flexShrink: 1 }, thresholdTrack: { height: 12, borderRadius: 6, marginTop: 5, justifyContent: "center" }, thresholdFill: { height: 12, borderRadius: 6 }, thresholdThumb: { position: "absolute", top: -5, marginLeft: -10, height: 22, width: 22, borderRadius: 11, borderWidth: 3 }, thresholdScale: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 }, scaleText: { fontSize: 10 }, cooldownRow: { flexDirection: "row", alignItems: "center", gap: 8 }, cooldownInput: { minWidth: 64, flexGrow: 1, height: 38, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, fontSize: 13, fontWeight: "700" }, cooldownUnit: { fontSize: 12 }, saveButton: { minHeight: 38, borderRadius: 9, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" }, saveButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" }, savingText: { fontSize: 11, fontStyle: "italic" }, commandList: { gap: 9 }, command: { fontSize: 12, lineHeight: 18 }, primaryButton: { minHeight: 46, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 }, primaryButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" }, disclosure: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 5 }, disclosureTitle: { fontSize: 13, fontWeight: "800" }, disclosureCopy: { fontSize: 12, lineHeight: 18 }, empty: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 5 }, emptyTitle: { fontSize: 14, fontWeight: "800" }, emptyCopy: { fontSize: 12, lineHeight: 18 }, pressed: { opacity: 0.76 }, disabled: { opacity: 0.5 } });
