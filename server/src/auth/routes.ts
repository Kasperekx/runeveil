import { timingSafeEqual } from "node:crypto";
import { parseCookie, stringifySetCookie } from "cookie";
import type { Express, Request } from "express";
import { rateLimit } from "express-rate-limit";
import { authStore } from "./authStore.js";
import { isCharacterOnline } from "../world/onlineCharacters.js";

const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-mmo_session" : "mmo_session";
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:8080";
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const MIN_CHARACTER_NAME_LENGTH = 3;
const MAX_CHARACTER_NAME_LENGTH = 18;
const RESERVED_CHARACTER_NAMES = new Set([
  "admin",
  "administrator",
  "moderator",
  "gamemaster",
  "game master",
  "system",
  "runeveil",
]);

function sessionCookie(token: string, expires: Date): string {
  return stringifySetCookie({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

function clearSessionCookie(): string {
  return stringifySetCookie({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

function tokenFrom(req: Request): string | null {
  const value = parseCookie(req.headers.cookie ?? "")[SESSION_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function emailValid(email: string): boolean {
  if (email.length < 3 || email.length > MAX_EMAIL_LENGTH) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email);
}

function credentials(req: Request): { email: string; password: string } | null {
  const body = req.body as { email?: unknown; password?: unknown } | undefined;
  if (typeof body?.email !== "string" || typeof body.password !== "string")
    return null;
  return { email: body.email.trim(), password: body.password };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function characterName(req: Request): string | null {
  const raw = (req.body as { name?: unknown } | undefined)?.name;
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const length = [...name].length;
  if (
    length < MIN_CHARACTER_NAME_LENGTH ||
    length > MAX_CHARACTER_NAME_LENGTH ||
    !/^\p{L}[\p{L}' -]*\p{L}$/u.test(name) ||
    /(?:[' -]){2}/u.test(name) ||
    RESERVED_CHARACTER_NAMES.has(name.toLocaleLowerCase("pl-PL"))
  ) {
    return null;
  }
  return name;
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const left = Buffer.from(origin);
  const right = Buffer.from(CLIENT_ORIGIN);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function registerAuthRoutes(app: Express): void {
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  app.use("/api/auth", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api/auth", (req, res, next) => {
    if (req.method === "GET" || sameOrigin(req)) return next();
    res.status(403).json({ error: "INVALID_ORIGIN" });
  });
  app.use("/api/characters", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api/characters", (req, res, next) => {
    if (req.method === "GET" || sameOrigin(req)) return next();
    res.status(403).json({ error: "INVALID_ORIGIN" });
  });

  app.get("/api/auth/session", async (req, res, next) => {
    try {
      const token = tokenFrom(req);
      const view = token ? await authStore.session(token) : null;
      res.json(
        view ? { authenticated: true, ...view } : { authenticated: false },
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/register", authLimiter, async (req, res, next) => {
    const data = credentials(req);
    if (!data || !emailValid(data.email)) {
      res.status(400).json({ error: "INVALID_EMAIL" });
      return;
    }
    if (
      data.password.length < MIN_PASSWORD_LENGTH ||
      data.password.length > MAX_PASSWORD_LENGTH
    ) {
      res.status(400).json({ error: "INVALID_PASSWORD_LENGTH" });
      return;
    }
    try {
      const result = await authStore.register(data.email, data.password);
      res.setHeader(
        "Set-Cookie",
        sessionCookie(result.sessionToken, result.sessionExpiresAt),
      );
      res.status(201).json({ authenticated: true, ...result.view });
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "EMAIL_TAKEN" });
        return;
      }
      next(error);
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res, next) => {
    const data = credentials(req);
    if (!data || !emailValid(data.email)) {
      res.status(401).json({ error: "INVALID_CREDENTIALS" });
      return;
    }
    try {
      const result = await authStore.login(data.email, data.password);
      if (!result) {
        res.status(401).json({ error: "INVALID_CREDENTIALS" });
        return;
      }
      res.setHeader(
        "Set-Cookie",
        sessionCookie(result.sessionToken, result.sessionExpiresAt),
      );
      res.json({ authenticated: true, ...result.view });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", async (req, res, next) => {
    try {
      const token = tokenFrom(req);
      if (token) await authStore.logout(token);
      res.setHeader("Set-Cookie", clearSessionCookie());
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/characters", async (req, res, next) => {
    const token = tokenFrom(req);
    const name = characterName(req);
    const classId = (req.body as { classId?: unknown } | undefined)?.classId;
    if (!token) {
      res.status(401).json({ error: "UNAUTHORIZED" });
      return;
    }
    if (!name) {
      res.status(400).json({ error: "INVALID_CHARACTER_NAME" });
      return;
    }
    if (typeof classId !== "string") {
      res.status(400).json({ error: "INVALID_CLASS" });
      return;
    }
    try {
      const character = await authStore.createCharacter(token, name, classId);
      if (character === undefined) {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      if (!character) {
        res.status(400).json({ error: "CHARACTER_LIMIT_OR_INVALID_CLASS" });
        return;
      }
      res.status(201).json({ character });
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "CHARACTER_NAME_TAKEN" });
        return;
      }
      next(error);
    }
  });

  app.delete("/api/characters/:characterId", async (req, res, next) => {
    const token = tokenFrom(req);
    const characterId = req.params.characterId;
    const confirmationName = (
      req.body as { confirmationName?: unknown } | undefined
    )?.confirmationName;
    if (!token) {
      res.status(401).json({ error: "UNAUTHORIZED" });
      return;
    }
    if (
      typeof characterId !== "string" ||
      typeof confirmationName !== "string"
    ) {
      res.status(400).json({ error: "INVALID_DELETE_CONFIRMATION" });
      return;
    }
    if (isCharacterOnline(characterId)) {
      res.status(409).json({ error: "CHARACTER_ONLINE" });
      return;
    }
    try {
      const result = await authStore.deleteCharacter(
        token,
        characterId,
        confirmationName,
      );
      if (result === "unauthorized") {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      if (result === "forbidden") {
        res.status(404).json({ error: "CHARACTER_NOT_FOUND" });
        return;
      }
      if (result === "name_mismatch") {
        res.status(400).json({ error: "INVALID_DELETE_CONFIRMATION" });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/game-ticket", async (req, res, next) => {
    try {
      const token = tokenFrom(req);
      const characterId = (req.body as { characterId?: unknown } | undefined)
        ?.characterId;
      if (!token || typeof characterId !== "string") {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      const ticket = await authStore.createGameTicket(token, characterId);
      if (!ticket) {
        res.status(403).json({ error: "CHARACTER_FORBIDDEN" });
        return;
      }
      res.json({ ticket, characterId, expiresInMs: 60_000 });
    } catch (error) {
      next(error);
    }
  });
}
