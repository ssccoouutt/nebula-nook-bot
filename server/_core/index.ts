import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { configureKoyebWebhookOnStartup, getTelegramBotIdentity, telegramWebhookConfigure, telegramWebhookHandler, telegramWebhookHealth } from "../telegram";
import { initializeDrivePersistence, drivePersistenceStatus } from "../googleDrivePersistence";
import { createContext } from "./context";
import { recordTelegramFailure } from "../telegram";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

let fatalShutdownStarted = false;

function installProcessRecovery() {
  const exitAfterLogging = (scope: string, error: unknown) => {
    recordTelegramFailure(scope, error, { process: process.pid, nodeEnv: process.env.NODE_ENV, action: "exit_for_platform_restart" });
    if (fatalShutdownStarted) return;
    fatalShutdownStarted = true;
    // Give stdout/stderr a brief opportunity to flush; Koyeb restarts the
    // container after the non-zero exit and the structured error remains in logs.
    setTimeout(() => process.exit(1), 100);
  };
  process.on("uncaughtException", (error) => exitAfterLogging("uncaught_exception", error));
  process.on("unhandledRejection", (reason) => exitAfterLogging("unhandled_rejection", reason));
}

async function startServer() {
  await initializeDrivePersistence();
  console.log(`[Drive] Persistence status: ${JSON.stringify(drivePersistenceStatus())}`);
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  app.get("/api/telegram/webhook/health", telegramWebhookHealth);
  app.post("/api/telegram/webhook/configure", telegramWebhookConfigure);
  app.post("/api/telegram/webhook", telegramWebhookHandler);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    void configureKoyebWebhookOnStartup()
      .then(async info => {
        if (!info) return;
        console.log(`[Telegram] Koyeb webhook configured: ${info.url}`);
        try {
          const bot = await getTelegramBotIdentity();
          console.log(`[Telegram] Active bot identity: @${bot.username ?? "unknown"} (${bot.id})`);
          if (info.last_error_message) console.error(`[Telegram] Webhook delivery error: ${info.last_error_message}`);
        } catch (error) {
          console.error("[Telegram] Bot identity check failed", error);
        }
      })
      .catch(error => console.error("[Telegram] Koyeb webhook configuration failed", error));
  });
}

installProcessRecovery();
startServer().catch((error) => {
  recordTelegramFailure("startup_failure", error, { process: process.pid, nodeEnv: process.env.NODE_ENV, action: "exit_for_platform_restart" });
  process.exitCode = 1;
});
