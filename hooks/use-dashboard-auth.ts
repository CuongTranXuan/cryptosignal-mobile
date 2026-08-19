import { useCallback, useState } from "react";

const DEMO_USERNAME = "user";
const DEMO_PASSWORD = "password";

export type DashboardAuthState = {
  loading: boolean;
  authenticated: boolean;
  bootstrapRequired: boolean;
  user: { username: string; role: "user" | "admin" } | null;
};

const DEMO_USER = { username: DEMO_USERNAME, role: "admin" as const };

export function useDashboardAuth() {
  const [state, setState] = useState<DashboardAuthState>({ loading: false, authenticated: false, bootstrapRequired: false, user: null });

  const refresh = useCallback(async () => undefined, []);
  const signIn = useCallback(async (username: string, password: string) => {
    if (username.trim().toLowerCase() !== DEMO_USERNAME || password !== DEMO_PASSWORD) throw new Error(`Use the demo credentials: ${DEMO_USERNAME} / ${DEMO_PASSWORD}.`);
    setState({ loading: false, authenticated: true, bootstrapRequired: false, user: DEMO_USER });
  }, []);
  const signOut = useCallback(async () => {
    setState({ loading: false, authenticated: false, bootstrapRequired: false, user: null });
  }, []);

  return { ...state, refresh, signIn, signOut };
}
