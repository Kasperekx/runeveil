import { Game } from "./game/Game";
import { AuthScreen } from "./ui/AuthScreen";
import { CharacterSelectScreen } from "./ui/CharacterSelectScreen";

const bootStatus = document.getElementById("boot-status");

async function bootstrap(): Promise<void> {
  const session = await AuthScreen.authenticate();
  const access = await CharacterSelectScreen.select(session);
  await new Game().start(access);
}

bootstrap().catch((err: unknown) => {
  console.error("[boot] failed", err);
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Nieznany błąd startu";
  if (bootStatus) {
    bootStatus.textContent = `Błąd: ${message}`;
    bootStatus.style.color = "#e8a090";
  }
});
