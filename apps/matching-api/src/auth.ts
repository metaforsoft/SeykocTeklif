import crypto from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import { matchPool } from "@smp/db";

const scryptAsync = promisify(crypto.scrypt);
const SESSION_COOKIE = "smp_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: "admin" | "user";
  isActive: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser | null;
  }
}

function readCookie(headerValue: string | undefined, key: string): string | null {
  if (!headerValue) return null;
  const parts = headerValue.split(";").map((item) => item.trim());
  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) continue;
    const cookieKey = part.slice(0, eqIndex).trim();
    if (cookieKey !== key) continue;
    return decodeURIComponent(part.slice(eqIndex + 1));
  }
  return null;
}

function buildPasswordHash(rawPassword: string, salt?: Buffer): Promise<string> {
  const derivedSalt = salt ?? crypto.randomBytes(16);
  return scryptAsync(rawPassword, derivedSalt, 64).then((derived) => {
    const hash = Buffer.from(derived as ArrayBuffer);
    return `scrypt$16384$8$1$${derivedSalt.toString("hex")}$${hash.toString("hex")}`;
  });
}

export async function hashPassword(rawPassword: string): Promise<string> {
  return buildPasswordHash(rawPassword);
}

export async function verifyPassword(rawPassword: string, storedHash: string): Promise<boolean> {
  const [algorithm, , , , saltHex, hashHex] = String(storedHash || "").split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = Buffer.from(await scryptAsync(rawPassword, salt, expected.length) as ArrayBuffer);
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

export async function getUserBySessionToken(token: string | null): Promise<AuthUser | null> {
  if (!token) return null;
  const res = await matchPool.query<{
    id: string;
    username: string;
    full_name: string;
    role: "admin" | "user";
    is_active: boolean;
  }>(
    `SELECT u.id::text, u.username, u.full_name, u.role, u.is_active
     FROM app_sessions s
     JOIN app_users u ON u.id = s.user_id
     WHERE s.session_token = $1
       AND s.expires_at > NOW()
       AND u.is_active = TRUE
     LIMIT 1`,
    [token]
  );

  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  return {
    id: Number(row.id),
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active
  };
}

export async function resolveRequestUser(request: FastifyRequest): Promise<AuthUser | null> {
  if (request.authUser !== undefined) {
    return request.authUser;
  }
  const token = readCookie(request.headers.cookie, SESSION_COOKIE);
  const user = await getUserBySessionToken(token);
  request.authUser = user;
  return user;
}

export async function createSession(reply: FastifyReply, userId: number): Promise<string> {
  const sessionToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await matchPool.query(
    `INSERT INTO app_sessions(session_token, user_id, expires_at)
     VALUES($1, $2, NOW() + INTERVAL '12 hours')`,
    [sessionToken, userId]
  );
  reply.header("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  return sessionToken;
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = readCookie(request.headers.cookie, SESSION_COOKIE);
  if (token) {
    await matchPool.query("DELETE FROM app_sessions WHERE session_token = $1", [token]);
  }
  reply.header("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  request.authUser = null;
}

export async function authenticateCredentials(username: string, password: string): Promise<AuthUser | null> {
  const res = await matchPool.query<{
    id: string;
    username: string;
    full_name: string;
    role: "admin" | "user";
    is_active: boolean;
    password_hash: string;
  }>(
    `SELECT id::text, username, full_name, role, is_active, password_hash
     FROM app_users
     WHERE username = $1
     LIMIT 1`,
    [username]
  );

  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  if (!row.is_active) return null;
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return null;
  return {
    id: Number(row.id),
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active
  };
}

export async function ensureDefaultAdminUser(): Promise<void> {
  const username = "admin";
  const fullName = "Sistem Yonetici";
  const defaultPasswordHash = await hashPassword("admin");
  const existing = await matchPool.query<{ id: string }>(
    "SELECT id::text FROM app_users WHERE username = $1 LIMIT 1",
    [username]
  );

  if ((existing.rowCount ?? 0) === 0) {
    await matchPool.query(
      `INSERT INTO app_users(username, password_hash, full_name, role, is_active)
       VALUES($1,$2,$3,'admin',TRUE)`,
      [username, defaultPasswordHash, fullName]
    );
    return;
  }

  await matchPool.query(
    `UPDATE app_users
     SET password_hash = $2,
         full_name = $3,
         role = 'admin',
         is_active = TRUE,
         updated_at = NOW()
     WHERE username = $1`,
    [username, defaultPasswordHash, fullName]
  );
}

export function isPublicPath(url: string): boolean {
  return (
    url === "/login" ||
    url.startsWith("/portal/") ||
    url === "/health" ||
    url === "/auth/login" ||
    url === "/favicon.ico"
  );
}

export function shouldRedirectToLogin(request: FastifyRequest): boolean {
  const accept = String(request.headers.accept || "");
  return request.method === "GET" && accept.includes("text/html");
}
