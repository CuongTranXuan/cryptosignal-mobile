import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";

export function DashboardAuthScreen({ onSignIn }: { onSignIn: (username: string, password: string) => Promise<void> }) {
  const colors = useColors();
  const { locale, setLocale, t } = useI18n();
  const [username, setUsername] = useState("user");
  const [password, setPassword] = useState("password");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onSignIn(username, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("unableToSignIn"));
    } finally {
      setSubmitting(false);
    }
  };
  return <View style={[styles.page, { backgroundColor: colors.background }]}><View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.languageRow}><Text style={[styles.brand, { color: colors.primary }]}>CRYPTO SIGNAL</Text><View style={styles.languageChoices}><Pressable accessibilityRole="button" accessibilityLabel={t("languageEnglish")} onPress={() => setLocale("en")} style={({ pressed }) => [styles.languageChoice, { borderColor: locale === "en" ? colors.primary : colors.border, backgroundColor: locale === "en" ? `${colors.primary}14` : colors.background }, pressed && styles.pressed]}><Text style={[styles.languageChoiceText, { color: locale === "en" ? colors.primary : colors.muted }]}>EN</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={t("languageVietnamese")} onPress={() => setLocale("vi")} style={({ pressed }) => [styles.languageChoice, { borderColor: locale === "vi" ? colors.primary : colors.border, backgroundColor: locale === "vi" ? `${colors.primary}14` : colors.background }, pressed && styles.pressed]}><Text style={[styles.languageChoiceText, { color: locale === "vi" ? colors.primary : colors.muted }]}>VI</Text></Pressable></View></View><Text style={[styles.title, { color: colors.foreground }]}>{t("demoResearchAccess")}</Text><Text style={[styles.copy, { color: colors.muted }]}>{t("loginDescription")}</Text><View style={styles.fields}><Field label={t("username")} value={username} onChangeText={setUsername} autoCapitalize="none" colors={colors} /><Field label={t("password")} value={password} onChangeText={setPassword} secureTextEntry colors={colors} /></View>{error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}<Pressable onPress={submit} disabled={submitting} style={({ pressed }) => [styles.button, { backgroundColor: colors.primary }, pressed && styles.pressed, submitting && styles.disabled]}>{submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{t("openDemoDashboard")}</Text>}</Pressable><Text style={[styles.note, { color: colors.muted }]}>{t("demoCredentials")}</Text></View></View>;
}

function Field({ label, colors, ...props }: { label: string; colors: ReturnType<typeof useColors>; value: string; onChangeText: (value: string) => void; secureTextEntry?: boolean; autoCapitalize?: "none" | "sentences" | "words" | "characters" }) { return <View style={styles.field}><Text style={[styles.label, { color: colors.foreground }]}>{label}</Text><TextInput {...props} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} placeholderTextColor={colors.muted} accessibilityLabel={label} /></View>; }
const styles = StyleSheet.create({ page: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, card: { width: "100%", maxWidth: 440, borderWidth: 1, borderRadius: 18, padding: 24, gap: 14 }, languageRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, languageChoices: { flexDirection: "row", gap: 6 }, languageChoice: { minHeight: 28, minWidth: 34, borderWidth: 1, borderRadius: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }, languageChoiceText: { fontSize: 10, fontWeight: "900" }, brand: { fontSize: 12, fontWeight: "900", letterSpacing: 1.4 }, title: { fontSize: 27, fontWeight: "800", letterSpacing: -0.5 }, copy: { fontSize: 14, lineHeight: 21 }, fields: { gap: 12 }, field: { gap: 6 }, label: { fontSize: 12, fontWeight: "800" }, input: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 }, error: { fontSize: 13, lineHeight: 19 }, button: { minHeight: 48, borderRadius: 11, alignItems: "center", justifyContent: "center" }, buttonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" }, note: { fontSize: 11, lineHeight: 17, textAlign: "center" }, pressed: { opacity: 0.78 }, disabled: { opacity: 0.58 } });
