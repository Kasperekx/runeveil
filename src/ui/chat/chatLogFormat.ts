import { getCreatureName } from "../../content/creatures";
import { getItem, hasItem } from "../../content/items";
import type { ChatChannel } from "./chatTypes";

export function itemDisplayName(itemId: string): string {
  if (!itemId) return "przedmiot";
  if (hasItem(itemId)) return getItem(itemId).name;
  return itemId;
}

export function creatureDisplayName(kind: string | undefined | null): string {
  if (!kind) return "Stwór";
  return getCreatureName(kind);
}

export function formatChatSay(name: string, text: string): string {
  return `[Say] ${name}: ${text}`;
}

export function formatCombatDealt(
  amount: number,
  creatureKind?: string | null,
  killed?: boolean,
): { channel: ChatChannel; text: string } {
  const target = creatureDisplayName(creatureKind);
  if (killed) {
    return {
      channel: "combat",
      text: `Zabiłeś: ${target} (−${amount} obrażeń).`,
    };
  }
  return {
    channel: "combat",
    text: `Zadajesz ${amount} pkt. obrażeń (${target}).`,
  };
}

export function formatCombatTaken(
  amount: number,
  creatureKind?: string | null,
): { channel: ChatChannel; text: string } {
  const source = creatureDisplayName(creatureKind);
  return {
    channel: "combat",
    text: `${source} zadaje Ci ${amount} pkt. obrażeń.`,
  };
}

export function formatCombatHeal(amount: number): {
  channel: ChatChannel;
  text: string;
} {
  return {
    channel: "combat",
    text: `Odzyskujesz ${amount} pkt. zdrowia.`,
  };
}

export function formatXpGain(
  amount: number,
  creatureKind?: string | null,
): { channel: ChatChannel; text: string } {
  const from = creatureKind ? ` (${creatureDisplayName(creatureKind)})` : "";
  return {
    channel: "system",
    text: `Otrzymujesz ${amount} PD${from}.`,
  };
}

export function formatLevelUp(level: number): {
  channel: ChatChannel;
  text: string;
} {
  return {
    channel: "system",
    text: `Awansujesz na poziom ${level}!`,
  };
}

export function formatLootDropped(
  creatureKind: string,
  items: Array<{ itemId: string; quantity: number }>,
): { channel: ChatChannel; text: string } | null {
  const parts = items
    .filter((i) => i.itemId && i.quantity > 0)
    .map((i) => {
      const name = itemDisplayName(i.itemId);
      return i.quantity > 1 ? `${name} ×${i.quantity}` : name;
    });
  if (parts.length === 0) return null;

  return {
    channel: "loot",
    text: `${creatureDisplayName(creatureKind)} upuszcza: ${parts.join(", ")}.`,
  };
}

export function formatSystem(text: string): {
  channel: ChatChannel;
  text: string;
} {
  return { channel: "system", text };
}

export function formatTimestamp(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
