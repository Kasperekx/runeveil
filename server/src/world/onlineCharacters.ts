const onlineCharacterIds = new Set<string>();

export function markCharacterOnline(characterId: string): void {
  onlineCharacterIds.add(characterId);
}

export function markCharacterOffline(characterId: string): void {
  onlineCharacterIds.delete(characterId);
}

export function isCharacterOnline(characterId: string): boolean {
  return onlineCharacterIds.has(characterId);
}
