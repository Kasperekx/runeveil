import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const mapId = process.argv[2] ?? "hunting_grounds";
if (!/^[a-z0-9_-]+$/i.test(mapId)) {
  throw new Error(`Nieprawidłowe id mapy: ${mapId}`);
}

const mapPath = resolve(`public/maps/${mapId}.tmj`);
await access(mapPath);

if (process.platform === "darwin") {
  await access("/Applications/Tiled.app").catch(() => {
    throw new Error(
      "Tiled nie jest zainstalowany. Uruchom: brew install --cask tiled",
    );
  });
}

const command = process.platform === "darwin" ? "open" : "tiled";
const args =
  process.platform === "darwin" ? ["-a", "Tiled", mapPath] : [mapPath];
const child = spawn(command, args, { stdio: "inherit" });
const exitCode = await new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolveExit(code));
});

if (exitCode !== 0) {
  throw new Error(
    "Nie udało się uruchomić Tiled. Zainstaluj go z https://www.mapeditor.org/.",
  );
}
