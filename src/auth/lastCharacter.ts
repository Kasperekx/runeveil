import type { AuthCharacter, AuthSession, GameAccess } from "./types";

const STORAGE_PREFIX = "runeveil.lastCharacter.";

function storageKey(accountId: string): string {
  return `${STORAGE_PREFIX}${accountId}`;
}

/** Remember which character entered the world (survives F5). */
export function rememberLastCharacter(
  accountId: string,
  characterId: string,
): void {
  try {
    localStorage.setItem(storageKey(accountId), characterId);
  } catch {
    // Private mode / blocked storage — resume is best-effort.
  }
}

/** Forget the resume target (character hall / logout). */
export function clearLastCharacter(accountId: string): void {
  try {
    localStorage.removeItem(storageKey(accountId));
  } catch {
    // ignore
  }
}

/** Build GameAccess from the last entered character when it still exists. */
export function resumeLastCharacter(session: AuthSession): GameAccess | null {
  let characterId: string | null = null;
  try {
    characterId = localStorage.getItem(storageKey(session.account.id));
  } catch {
    return null;
  }
  if (!characterId) return null;
  const character = session.characters.find(
    (entry: AuthCharacter) => entry.id === characterId,
  );
  if (!character) {
    clearLastCharacter(session.account.id);
    return null;
  }
  return {
    account: session.account,
    characterId: character.id,
    characterName: character.name,
    classId: character.classId,
  };
}
