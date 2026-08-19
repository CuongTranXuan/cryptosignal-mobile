import { useCallback, useEffect, useState } from "react";

import { getApiBaseUrl } from "@/constants/oauth";

export type DashboardAuthState = {
  loading: boolean;
  authenticated: boolean;
  bootstrapRequired: boolean;
  user: { username: string; role: "user" | "admin" } | null;
};

const EMPTY_STATE: DashboardAuthState = { loading: true, authenticated: false, bootstrapRequired: false, user: null };

async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Authentication request failed.");
  return payload;
}

export function useDashboardAuth() {
  const [state, setState] = useState<DashboardAuthState>(EMPTY_STATE);

  const refresh = useCallback(async () => {
    try {
      const response = await authRequest<Omit<DashboardAuthState, "loading">>("/api/dashboard-auth/status");
      setState({ ...response, loading: false });
    } catch {
      setState({ loading: false, authenticated: false, bootstrapRequired: false, user: null });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signIn = useCallback(async (username: string, password: string) => {
    await authRequest("/api/dashboard-auth/login", { username, password });
    await refresh();
  }, [refresh]);

  const bootstrap = useCallback(async (username: string, password: string, bootstrapToken: string) => {
    await authRequest("/api/dashboard-auth/bootstrap", { username, password, bootstrapToken });
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await authRequest("/api/dashboard-auth/logout", {});
    await refresh();
  }, [refresh]);

  return { ...state, refresh, signIn, bootstrap, signOut };
}
