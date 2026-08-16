import type { Client } from "colyseus";
import type { WorldHost } from "../WorldHost.js";

const CHAT_MAX_LEN = 120;
const CHAT_RATE_LIMIT = 5;
const CHAT_RATE_WINDOW_MS = 10_000;
const CHAT_DUPLICATE_MS = 1_500;

type ChatSayPayload = { text?: string };

type ChatMessageEvent = {
  playerId: string;
  name: string;
  text: string;
  mapId: string;
};

export class ChatSystem {
  private readonly chatSentAt = new Map<string, number[]>();
  private readonly chatLast = new Map<string, { text: string; at: number }>();

  constructor(private readonly host: WorldHost) {}

  clearSession(sessionId: string): void {
    this.chatSentAt.delete(sessionId);
    this.chatLast.delete(sessionId);
  }

  handleSay(client: Client, data: ChatSayPayload): void {
    const player = this.host.livingPlayer(client);
    if (!player) return;

    const text = sanitizeChatText(
      typeof data?.text === "string" ? data.text : "",
    );
    if (!text) {
      client.send("notice", { kind: "chat_invalid" });
      return;
    }

    const now = Date.now();
    if (!this.allowChatMessage(client.sessionId, text, now)) {
      client.send("notice", { kind: "chat_rate_limited" });
      return;
    }

    const event: ChatMessageEvent = {
      playerId: player.playerId,
      name: player.name || "Wędrowiec",
      text,
      mapId: player.mapId,
    };
    for (const other of this.host.clients) {
      const peer = this.host.state.players.get(other.sessionId);
      if (!peer || peer.mapId !== player.mapId) continue;
      other.send("chat", event);
    }
  }

  private allowChatMessage(
    sessionId: string,
    text: string,
    now: number,
  ): boolean {
    const last = this.chatLast.get(sessionId);
    if (last && last.text === text && now - last.at < CHAT_DUPLICATE_MS) {
      return false;
    }

    const windowStart = now - CHAT_RATE_WINDOW_MS;
    const recent = (this.chatSentAt.get(sessionId) ?? []).filter(
      (t) => t >= windowStart,
    );
    if (recent.length >= CHAT_RATE_LIMIT) return false;

    recent.push(now);
    this.chatSentAt.set(sessionId, recent);
    this.chatLast.set(sessionId, { text, at: now });
    return true;
  }
}

function sanitizeChatText(raw: string): string {
  return (
    raw
      // Control chars are stripped so chat cannot inject terminal / log sequences.
      // eslint-disable-next-line no-control-regex -- intentional sanitizer
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, CHAT_MAX_LEN)
  );
}
