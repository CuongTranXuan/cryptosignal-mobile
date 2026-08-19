import type { Express, Request } from "express";
import { parse as parseCookie } from "cookie";

export const DEMO_USERNAME = "user";
export const DEMO_PASSWORD = "password";

const SESSION_COOKIE = "cryptosignal_dashboard_session";

export type DashboardUser = { id: number; username: string; role: "user" | "admin" };

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function isDemoCredentialPair(username: string, password: string) {
  return normalizeUsername(username) === DEMO_USERNAME && password === DEMO_PASSWORD;
}

export async function resolveDashboardUser(req: Request): Promise<DashboardUser | null> {
  const token = parseCookie(req.headers.cookie ?? "")[SESSION_COOKIE];
  return token === DEMO_USERNAME ? { id: 0, username: DEMO_USERNAME, role: "admin" } : null;
}

export function registerDashboardAuthRoutes(app: Express) {
  app.get("/api/dashboard-auth/status", (_req, res) => {
    res.json({ authenticated: false, bootstrapRequired: false, user: null, demo: { username: DEMO_USERNAME, password: DEMO_PASSWORD } });
  });

  app.post("/api/dashboard-auth/login", (req, res) => {
    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!isDemoCredentialPair(username, password)) return res.status(401).json({ error: `Use ${DEMO_USERNAME} / ${DEMO_PASSWORD}.` });
    res.cookie(SESSION_COOKIE, DEMO_USERNAME, { httpOnly: true, sameSite: "lax", secure: req.secure, path: "/" });
    return res.json({ authenticated: true, user: { username: DEMO_USERNAME, role: "admin" } });
  });

  app.post("/api/dashboard-auth/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return res.json({ authenticated: false });
  });
}
