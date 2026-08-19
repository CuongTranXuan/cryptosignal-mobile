import { pbkdf2, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { Express, Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import { z } from "zod";

import { countDashboardCredentials, createDashboardCredential, createDashboardSession, deleteDashboardSession, getDashboardCredential, getDashboardUserBySessionHash, recordAuditEvent, type DashboardUser } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";

const derive = promisify(pbkdf2);
const SESSION_COOKIE = "cryptosignal_dashboard_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 310_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "Use letters, numbers, dots, hyphens, or underscores."),
  password: z.string().min(12).max(256),
});
const bootstrapSchema = credentialsSchema.extend({ bootstrapToken: z.string().min(16).max(512) });

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export async function hashPassword(password: string, salt = randomBytes(16).toString("base64url")) {
  const derived = await derive(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST);
  return `pbkdf2$${DIGEST}$${PBKDF2_ITERATIONS}$${salt}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, digest, iterations, salt, expected] = stored.split("$");
  if (scheme !== "pbkdf2" || digest !== DIGEST || !iterations || !salt || !expected) return false;
  const derived = await derive(password, salt, Number(iterations), KEY_LENGTH, digest);
  const expectedBuffer = Buffer.from(expected, "base64url");
  const derivedBuffer = Buffer.from(derived);
  return expectedBuffer.length === derivedBuffer.length && timingSafeEqual(expectedBuffer, derivedBuffer);
}

export function hashSessionToken(token: string) {
  return Buffer.from(require("crypto").createHash("sha256").update(token).digest("hex"));
}

function sessionTokenHash(token: string) {
  return hashSessionToken(token).toString();
}

function requestSessionToken(req: Request) {
  return parseCookie(req.headers.cookie ?? "")[SESSION_COOKIE] ?? null;
}

function secureCookieOptions(req: Request) {
  const base = getSessionCookieOptions(req);
  return { ...base, sameSite: base.secure ? ("none" as const) : ("lax" as const) };
}

export function validateDashboardBootstrapToken(provided: string) {
  const expected = process.env.DASHBOARD_BOOTSTRAP_TOKEN;
  if (!expected) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

async function issueSession(res: Response, req: Request, credentialId: number) {
  const token = randomBytes(32).toString("base64url");
  await createDashboardSession(credentialId, sessionTokenHash(token), new Date(Date.now() + SESSION_TTL_MS));
  res.cookie(SESSION_COOKIE, token, { ...secureCookieOptions(req), maxAge: SESSION_TTL_MS });
}

export async function resolveDashboardUser(req: Request): Promise<DashboardUser | null> {
  const token = requestSessionToken(req);
  return token ? getDashboardUserBySessionHash(sessionTokenHash(token)) : null;
}

export function registerDashboardAuthRoutes(app: Express) {
  if (process.env.NODE_ENV !== "production") {
    app.post("/api/dashboard-auth/bootstrap/validate", (req, res) => {
      const token = typeof req.body?.bootstrapToken === "string" ? req.body.bootstrapToken : "";
      res.json({ valid: validateDashboardBootstrapToken(token) });
    });
  }

  app.get("/api/dashboard-auth/status", async (req, res) => {
    const [bootstrapCount, user] = await Promise.all([countDashboardCredentials(), resolveDashboardUser(req)]);
    res.json({ authenticated: Boolean(user), bootstrapRequired: bootstrapCount === 0, user: user ? { username: user.username, role: user.role } : null });
  });

  app.post("/api/dashboard-auth/bootstrap", async (req, res) => {
    const parsed = bootstrapSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid username, password, or bootstrap key." });
    if ((await countDashboardCredentials()) > 0) return res.status(409).json({ error: "Bootstrap is already complete. Use sign in." });
    if (!validateDashboardBootstrapToken(parsed.data.bootstrapToken)) return res.status(401).json({ error: "Invalid bootstrap key." });
    const username = normalizeUsername(parsed.data.username);
    const credentialId = await createDashboardCredential(username, await hashPassword(parsed.data.password), "admin");
    await recordAuditEvent("DASHBOARD_OWNER_BOOTSTRAPPED", "DASHBOARD", username, { credentialId });
    await issueSession(res, req, credentialId);
    return res.status(201).json({ authenticated: true, user: { username, role: "admin" } });
  });

  app.post("/api/dashboard-auth/login", async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid username or password." });
    const credential = await getDashboardCredential(normalizeUsername(parsed.data.username));
    if (!credential || !(await verifyPassword(parsed.data.password, credential.passwordHash))) return res.status(401).json({ error: "Invalid username or password." });
    await issueSession(res, req, credential.id);
    await recordAuditEvent("DASHBOARD_SIGNED_IN", "DASHBOARD", credential.username, { credentialId: credential.id });
    return res.json({ authenticated: true, user: { username: credential.username, role: credential.role } });
  });

  app.post("/api/dashboard-auth/logout", async (req, res) => {
    const token = requestSessionToken(req);
    if (token) await deleteDashboardSession(sessionTokenHash(token));
    res.clearCookie(SESSION_COOKIE, { ...secureCookieOptions(req), maxAge: -1 });
    return res.json({ authenticated: false });
  });
}
