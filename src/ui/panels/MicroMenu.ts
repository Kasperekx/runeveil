export interface MicroMenuEntry {
  id: string;
  label: string;
  /** Shown in the tooltip after the label, e.g. "C". */
  hotkey?: string;
  /** Inline SVG body drawn at 24x24; inherits currentColor. */
  icon: string;
  /** Omitted for features that do not exist yet. */
  onClick?: () => void;
}

/**
 * WoW-style micro menu: a row of small buttons that open HUD panels.
 *
 * Entries without an `onClick` render as disabled rather than being hidden, so
 * the bar keeps its shape as panels get built.
 */
export class MicroMenu {
  private constructor(private readonly root: HTMLElement) {}

  static create(
    entries: MicroMenuEntry[],
    host: HTMLElement = document.getElementById("ui-root")!,
  ): MicroMenu {
    const root = document.createElement("nav");
    root.id = "micro-menu";
    root.className = "micro-menu";
    root.setAttribute("aria-label", "Menu główne");
    host.appendChild(root);

    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "micro-menu__button";
      button.dataset.id = entry.id;

      const tip = entry.hotkey
        ? `${entry.label} (${entry.hotkey})`
        : entry.label;
      button.dataset.tip = entry.onClick ? tip : `${entry.label} — wkrótce`;
      button.setAttribute("aria-label", tip);

      button.innerHTML = `
        <svg class="micro-menu__icon" viewBox="0 0 24 24" aria-hidden="true">${entry.icon}</svg>
        ${keyCapHtml(entry.hotkey)}
      `;

      if (entry.onClick) {
        button.addEventListener("click", entry.onClick);
      } else {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }

      root.appendChild(button);
    }

    return new MicroMenu(root);
  }

  /** Lit state for the button whose panel is currently open. */
  setActive(id: string, active: boolean): void {
    this.root
      .querySelector(`[data-id="${id}"]`)
      ?.classList.toggle("micro-menu__button--active", active);
  }

  /** Numeric badge on a launcher (e.g. unspent attribute points). Hidden at 0. */
  setBadge(id: string, count: number): void {
    const button = this.root.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!button) return;

    const value = Math.max(0, Math.floor(count));
    let badge = button.querySelector<HTMLElement>(".micro-menu__badge");

    if (value <= 0) {
      badge?.remove();
      button.classList.remove("micro-menu__button--badge");
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.className = "micro-menu__badge";
      badge.setAttribute("aria-hidden", "true");
      button.appendChild(badge);
      button.classList.add("micro-menu__button--badge");
    }

    badge.textContent = value > 9 ? "9+" : String(value);
  }
}

/**
 * Single-character hotkeys get a cap on the button, the way the action bar
 * shows its digits. Longer ones (Enter) would not fit and stay in the tooltip.
 */
function keyCapHtml(hotkey: string | undefined): string {
  if (hotkey?.length !== 1) return "";
  return `<span class="micro-menu__key" aria-hidden="true">${hotkey}</span>`;
}

/** Simple line icons — no icon assets exist in the project yet. */
export const MICRO_ICONS = {
  character: `
    <circle cx="12" cy="7" r="3.4" />
    <path d="M5.5 20v-1.6c0-3 2.9-4.9 6.5-4.9s6.5 1.9 6.5 4.9V20" />
  `,
  bag: `
    <path d="M4.5 8.5h15l-1.2 11a1.6 1.6 0 0 1-1.6 1.4H7.3a1.6 1.6 0 0 1-1.6-1.4z" />
    <path d="M8.6 8.5V6.4A3.4 3.4 0 0 1 12 3a3.4 3.4 0 0 1 3.4 3.4v2.1" />
  `,
  skills: `
    <path d="M12 3.2 14.5 9l6.3.5-4.8 4.1 1.5 6.2L12 16.5 6.5 19.8 8 13.6 3.2 9.5 9.5 9z" />
  `,
  professions: `
    <path d="M7 3.5h10v5.2a5 5 0 0 1-10 0z" />
    <path d="M9.2 3.5V2M14.8 3.5V2M12 13.7v5.8M8.8 21h6.4" />
    <path d="M12 10.6c-1.7-1.4-2.5-2.8-2.1-4.4.4 1.1 1.2 1.6 2.1 2.2.9-.8 1.4-1.7 1.3-2.8 1.2 1.4 1.2 3.4.7 5" />
  `,
  quests: `
    <path d="M6 3.5h9.5L20 8v12.5H6z" />
    <path d="M15 3.5V8h5" />
    <path d="M9 12.5h8M9 16h6" />
  `,
  map: `
    <path d="M3.5 6.5 9 4.2l6 2.3 5.5-2.3v13.3L15 19.8l-6-2.3-5.5 2.3z" />
    <path d="M9 4.2v13.3M15 6.5v13.3" />
  `,
  social: `
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19.5v-1.2c0-2.4 2.5-3.9 5.5-3.9s5.5 1.5 5.5 3.9v1.2" />
    <path d="M16 5.6a3 3 0 0 1 0 5.8M17.5 14.8c2 .6 3.5 1.9 3.5 3.6v1.1" />
  `,
  settings: `
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5" />
  `,
} as const;
