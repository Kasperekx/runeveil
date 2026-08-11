import { Game } from "./game/Game";
import {
  rememberLastCharacter,
  resumeLastCharacter,
} from "./auth/lastCharacter";
import { AuthScreen } from "./ui/AuthScreen";
import { CharacterSelectScreen } from "./ui/CharacterSelectScreen";

const bootStatus = document.getElementById("boot-status");

async function bootstrap(): Promise<void> {
  const session = await AuthScreen.authenticate();
  // Account cookie survives refresh; resume the last entered character so F5
  // returns to the world instead of the character hall.
  const access =
    resumeLastCharacter(session) ??
    (await CharacterSelectScreen.select(session));
  rememberLastCharacter(access.account.id, access.characterId);
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
