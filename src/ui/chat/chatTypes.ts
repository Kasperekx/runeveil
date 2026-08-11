/** Chat / combat / loot / system log channels (WoW-style filters). */
export type ChatChannel = "chat" | "combat" | "loot" | "system";

export type ChatFilter = "all" | ChatChannel;

export interface ChatLine {
  id: number;
  channel: ChatChannel;
  /** Plain text only — never HTML. */
  text: string;
  at: number;
}

export const CHAT_FILTERS: ReadonlyArray<{ id: ChatFilter; label: string }> = [
  { id: "all", label: "Wszystkie" },
  { id: "chat", label: "Czat" },
  { id: "combat", label: "Walka" },
  { id: "loot", label: "Łupy" },
  { id: "system", label: "System" },
];
