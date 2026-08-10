import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { runMigrations } from "./database.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { authStore } from "./auth/authStore.js";
import { WorldRoom } from "./rooms/WorldRoom.js";

const PORT = Number(process.env.PORT ?? 2567);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:8080";

async function main(): Promise<void> {
  await runMigrations();
  await authStore.cleanupExpired();
  const authCleanupTimer = setInterval(
    () => {
      void authStore.cleanupExpired().catch((error) => {
        console.error("[auth] failed to clean expired credentials", error);
      });
    },
    60 * 60 * 1000,
  );
  authCleanupTimer.unref();
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(
    cors({
      origin: CLIENT_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    }),
  );
  app.use(express.json({ limit: "16kb" }));
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  registerAuthRoutes(app);

  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      void next;
      if (
        typeof error === "object" &&
        error !== null &&
        "type" in error &&
        error.type === "entity.parse.failed"
      ) {
        res.status(400).json({ error: "INVALID_JSON" });
        return;
      }
      console.error("[http] unhandled request error", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "INTERNAL_ERROR" });
      }
    },
  );

  const httpServer = createServer(app);

  const gameServer = new Server({
    transport: new WebSocketTransport({
      server: httpServer,
    }),
  });

  gameServer.define("world", WorldRoom);

  await gameServer.listen(PORT);
  console.log(`[mmo-server] Colyseus listening on ws://localhost:${PORT}`);
}

main().catch((err) => {
  console.error("[mmo-server] failed to start", err);
  process.exit(1);
});
