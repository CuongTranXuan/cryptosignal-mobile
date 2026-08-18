import { Tabs } from "expo-router";

export default function WebDashboardLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: "none" } }}>
      <Tabs.Screen name="index" options={{ title: "CryptoSignal Dashboard" }} />
      <Tabs.Screen name="signals" options={{ href: null }} />
      <Tabs.Screen name="configuration" options={{ href: null }} />
      <Tabs.Screen name="health" options={{ href: null }} />
    </Tabs>
  );
}
