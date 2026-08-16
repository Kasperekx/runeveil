import {
  type ChatChannel,
  type ChatFilter,
  type ChatLine,
  CHAT_FILTERS,
} from "./chatTypes";
import { formatTimestamp as formatTime } from "./chatLogFormat";

const MAX_LINES = 250;
const STORAGE_FILTER = "mmo.chat.filter";
const STORAGE_COLLAPSED = "mmo.chat.collapsed";

function loadFilter(): ChatFilter {
  try {
    const raw = localStorage.getItem(STORAGE_FILTER);
    if (
      raw === "all" ||
      raw === "chat" ||
      raw === "combat" ||
      raw === "loot" ||
      raw === "system"
    ) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return "all";
}

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_COLLAPSED) === "1";
  } catch {
    return false;
  }
}

/**
 * WoW-style chat + combat / loot / system log.
 *
 * Plain text only. Enter focuses / sends; Escape blurs.
 * Filters and collapse persist in localStorage.
 */
export class GameChat {
  private lineSeq = 0;
  private readonly lines: ChatLine[] = [];
  private filter: ChatFilter = loadFilter();
  private collapsed = loadCollapsed();
  private stickToBottom = true;
  private focused = false;
  private onSend: ((text: string) => void) | null = null;
  private readonly listEl: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private readonly tabsEl: HTMLElement;

  private constructor(
    private readonly root: HTMLElement,
    private readonly onFocusChange: ((focused: boolean) => void) | null,
  ) {
    this.listEl = root.querySelector("[data-chat-list]")!;
    this.inputEl = root.querySelector("[data-chat-input]")!;
    this.tabsEl = root.querySelector("[data-chat-tabs]")!;

    this.bindUi();
    this.renderTabs();
    this.applyCollapsed();
    this.renderLines();
  }

  static create(
    host: HTMLElement = document.getElementById("ui-root")!,
    options: {
      onFocusChange?: (focused: boolean) => void;
    } = {},
  ): GameChat {
    const root = document.createElement("section");
    root.id = "game-chat";
    root.className = "game-chat";
    root.setAttribute("aria-label", "Czat i dziennik zdarzeń");
    root.innerHTML = `
      <div class="game-chat__frame" data-chat-frame>
        <header class="game-chat__header">
          <nav class="game-chat__tabs" data-chat-tabs role="tablist" aria-label="Filtry czatu"></nav>
          <button type="button" class="game-chat__collapse" data-chat-collapse aria-label="Zwiń czat" title="Zwiń">−</button>
        </header>
        <div class="game-chat__body" data-chat-body>
          <div class="game-chat__list" data-chat-list role="log" aria-relevant="additions"></div>
          <form class="game-chat__form" data-chat-form autocomplete="off">
            <label class="visually-hidden" for="game-chat-input">Wiadomość</label>
            <input
              id="game-chat-input"
              class="game-chat__input"
              data-chat-input
              type="text"
              maxlength="120"
              spellcheck="true"
              autocomplete="off"
              placeholder="Napisz wiadomość…"
            />
          </form>
        </div>
      </div>
    `;
    host.appendChild(root);
    return new GameChat(root, options.onFocusChange ?? null);
  }

  get isFocused(): boolean {
    return this.focused;
  }

  bindSend(handler: (text: string) => void): void {
    this.onSend = handler;
  }

  /** Focus the input (e.g. micro-menu Social). */
  focusInput(): void {
    if (this.collapsed) {
      this.collapsed = false;
      this.persistCollapsed();
      this.applyCollapsed();
    }
    this.inputEl.focus();
  }

  blurInput(): void {
    this.inputEl.blur();
  }

  append(channel: ChatChannel, text: string, at = Date.now()): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    this.lines.push({
      id: ++this.lineSeq,
      channel,
      text: trimmed,
      at,
    });
    while (this.lines.length > MAX_LINES) this.lines.shift();

    if (this.matchesFilter(channel)) {
      this.appendDomLine(this.lines[this.lines.length - 1]!);
      this.scrollIfSticky();
    }
  }

  /** Global Enter / Esc when chat is not the key target. Returns true if consumed. */
  handleHotkey(code: string, event: KeyboardEvent): boolean {
    if (code === "Enter") {
      if (this.focused) return false;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return false;
      }
      event.preventDefault();
      this.focusInput();
      return true;
    }
    if (code === "Escape" && this.focused) {
      event.preventDefault();
      this.blurInput();
      return true;
    }
    return false;
  }

  private bindUi(): void {
    const form = this.root.querySelector("[data-chat-form]")!;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitInput();
    });

    this.inputEl.addEventListener("focus", () => {
      this.focused = true;
      this.root.classList.add("is-focused");
      this.onFocusChange?.(true);
    });
    this.inputEl.addEventListener("blur", () => {
      this.focused = false;
      this.root.classList.remove("is-focused");
      this.onFocusChange?.(false);
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.blurInput();
      }
    });

    this.listEl.addEventListener("scroll", () => {
      const gap =
        this.listEl.scrollHeight -
        this.listEl.scrollTop -
        this.listEl.clientHeight;
      this.stickToBottom = gap < 28;
    });

    this.root
      .querySelector("[data-chat-collapse]")!
      .addEventListener("click", () => {
        this.collapsed = !this.collapsed;
        this.persistCollapsed();
        this.applyCollapsed();
      });
  }

  private submitInput(): void {
    const raw = this.inputEl.value;
    const text = sanitizeOutgoing(raw);
    this.inputEl.value = "";
    if (!text) return;
    this.onSend?.(text);
  }

  private renderTabs(): void {
    this.tabsEl.replaceChildren();
    for (const tab of CHAT_FILTERS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "game-chat__tab";
      button.dataset.filter = tab.id;
      button.setAttribute("role", "tab");
      button.setAttribute(
        "aria-selected",
        tab.id === this.filter ? "true" : "false",
      );
      button.textContent = tab.label;
      if (tab.id === this.filter) button.classList.add("is-active");
      button.addEventListener("click", () => this.setFilter(tab.id));
      this.tabsEl.appendChild(button);
    }
  }

  private setFilter(filter: ChatFilter): void {
    if (this.filter === filter) return;
    this.filter = filter;
    try {
      localStorage.setItem(STORAGE_FILTER, filter);
    } catch {
      /* ignore */
    }
    this.renderTabs();
    this.renderLines();
  }

  private matchesFilter(channel: ChatChannel): boolean {
    return this.filter === "all" || this.filter === channel;
  }

  private renderLines(): void {
    this.listEl.replaceChildren();
    let visibleLines = 0;
    for (const line of this.lines) {
      if (!this.matchesFilter(line.channel)) continue;
      this.appendDomLine(line);
      visibleLines += 1;
    }
    if (visibleLines === 0) {
      const empty = document.createElement("p");
      empty.className = "game-chat__empty";
      empty.textContent = "Brak wiadomości na tym kanale.";
      this.listEl.appendChild(empty);
    }
    this.stickToBottom = true;
    this.scrollIfSticky();
  }

  private appendDomLine(line: ChatLine): void {
    this.listEl.querySelector(".game-chat__empty")?.remove();
    const row = document.createElement("div");
    row.className = `game-chat__line game-chat__line--${line.channel}`;
    row.dataset.channel = line.channel;

    const time = document.createElement("span");
    time.className = "game-chat__time";
    time.textContent = formatTime(line.at);

    const body = document.createElement("span");
    body.className = "game-chat__text";
    body.textContent = line.text;

    row.append(time, body);
    this.listEl.appendChild(row);
  }

  private scrollIfSticky(): void {
    if (!this.stickToBottom) return;
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  private applyCollapsed(): void {
    this.root.classList.toggle("is-collapsed", this.collapsed);
    const btn = this.root.querySelector(
      "[data-chat-collapse]",
    ) as HTMLButtonElement;
    btn.textContent = this.collapsed ? "+" : "−";
    btn.setAttribute(
      "aria-label",
      this.collapsed ? "Rozwiń czat" : "Zwiń czat",
    );
    btn.title = this.collapsed ? "Rozwiń" : "Zwiń";
  }

  private persistCollapsed(): void {
    try {
      localStorage.setItem(STORAGE_COLLAPSED, this.collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
}

/** Trim, collapse whitespace, strip controls; empty → "". */
export function sanitizeOutgoing(raw: string): string {
  const withoutControls = Array.from(raw, (character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? "" : character;
  }).join("");
  return withoutControls.replace(/\s+/g, " ").trim().slice(0, 120);
}

export type { ChatChannel, ChatFilter, ChatLine };
export { CHAT_FILTERS };
