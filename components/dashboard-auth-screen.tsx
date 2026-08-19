import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

export function DashboardAuthScreen({ bootstrapRequired, onSignIn, onBootstrap }: { bootstrapRequired: boolean; onSignIn: (username: string, password: string) => Promise<void>; onBootstrap: (username: string, password: string, bootstrapToken: string) => Promise<void> }) {
  const colors = useColors();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    if (username.trim().length < 3 || password.length < 12) {
      setError("Use a username of at least 3 characters and a password of at least 12 characters.");
      return;
    }
    if (bootstrapRequired && bootstrapToken.length < 16) {
      setError("Enter the one-time bootstrap key configured on the server.");
      return;
    }
    setSubmitting(true);
    try {
      if (bootstrapRequired) await onBootstrap(username, password, bootstrapToken);
      else await onSignIn(username, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to authenticate.");
    } finally {
      setSubmitting(false);
    }
  };
  return <View style={[styles.page, { backgroundColor: colors.background }]}><View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.brand, { color: colors.primary }]}>CRYPTO SIGNAL</Text><Text style={[styles.title, { color: colors.foreground }]}>{bootstrapRequired ? "Create the first dashboard owner" : "Sign in to research"}</Text><Text style={[styles.copy, { color: colors.muted }]}>{bootstrapRequired ? "Use the server-held bootstrap key once to create an administrator username and password. Bootstrap becomes unavailable immediately after this account is created." : "The browser dashboard is read-only. Telegram remains the control surface for watchlists, alerts, and rule configuration."}</Text><View style={styles.fields}><Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" colors={colors} /><Field label="Password" value={password} onChangeText={setPassword} secureTextEntry colors={colors} />{bootstrapRequired ? <Field label="One-time bootstrap key" value={bootstrapToken} onChangeText={setBootstrapToken} secureTextEntry colors={colors} /> : null}</View>{error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}<Pressable onPress={submit} disabled={submitting} style={({ pressed }) => [styles.button, { backgroundColor: colors.primary }, pressed && styles.pressed, submitting && styles.disabled]}>{submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{bootstrapRequired ? "Create secured owner account" : "Sign in"}</Text>}</Pressable><Text style={[styles.note, { color: colors.muted }]}>No exchange credentials or trading actions are available in this dashboard.</Text></View></View>;
}

function Field({ label, colors, ...props }: { label: string; colors: ReturnType<typeof useColors>; value: string; onChangeText: (value: string) => void; secureTextEntry?: boolean; autoCapitalize?: "none" | "sentences" | "words" | "characters" }) { return <View style={styles.field}><Text style={[styles.label, { color: colors.foreground }]}>{label}</Text><TextInput {...props} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} placeholderTextColor={colors.muted} accessibilityLabel={label} /></View>; }
const styles = StyleSheet.create({ page: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, card: { width: "100%", maxWidth: 440, borderWidth: 1, borderRadius: 18, padding: 24, gap: 14 }, brand: { fontSize: 12, fontWeight: "900", letterSpacing: 1.4 }, title: { fontSize: 27, fontWeight: "800", letterSpacing: -0.5 }, copy: { fontSize: 14, lineHeight: 21 }, fields: { gap: 12 }, field: { gap: 6 }, label: { fontSize: 12, fontWeight: "800" }, input: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 }, error: { fontSize: 13, lineHeight: 19 }, button: { minHeight: 48, borderRadius: 11, alignItems: "center", justifyContent: "center" }, buttonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" }, note: { fontSize: 11, lineHeight: 17, textAlign: "center" }, pressed: { opacity: 0.78 }, disabled: { opacity: 0.58 } });
