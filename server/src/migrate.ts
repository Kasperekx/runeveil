import { closeDatabase, runMigrations } from "./database.js";

runMigrations()
  .then(closeDatabase)
  .catch(async (error: unknown) => {
    console.error("[database] migration failed", error);
    await closeDatabase();
    process.exitCode = 1;
  });
