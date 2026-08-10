import { formatHp, hpRatio, hpTier } from "./vitals";

export interface PlayerVitals {
  hp: number;
  maxHp: number;
}

const DEFAULT_NAME = "Wędrowiec";
const DEFAULT_PORTRAIT = "/assets/ui/player-portrait.png";

/**
 * WoW-style player unit frame (top-left): portrait, level, name and HP.
 *
 * The bar is drawn as two stacked fills — the live one, and a "ghost" that
 * lags behind after a hit so the player can see how much was just taken off.
 */
export class PlayerHud {
  private lastKey = "";
  private lastRatio = 1;
  private lastLevel: number | null = null;

  private constructor(
    private readonly fillEl: HTMLElement,
    private readonly ghostEl: HTMLElement,
    private readonly textEl: HTMLElement,
    private readonly nameEl: HTMLElement,
    private readonly levelEl: HTMLElement,
    private readonly avatarEl: HTMLImageElement,
  ) {}

  static create(
    host: HTMLElement = document.getElementById("ui-root")!,
    name = DEFAULT_NAME,
  ): PlayerHud {
    const root = document.createElement("div");
    root.id = "player-hud";
    root.className = "player-hud";
    root.setAttribute("role", "status");
    root.setAttribute("aria-label", "Stan postaci");
    root.innerHTML = `
      <div class="player-hud__portrait-ring">
        <div class="player-hud__portrait">
          <img class="player-hud__avatar" data-avatar src="${DEFAULT_PORTRAIT}" alt="" draggable="false" />
        </div>
        <span class="player-hud__level" data-level aria-hidden="true">1</span>
      </div>
      <div class="player-hud__info">
        <div class="player-hud__name" data-name></div>
        <div class="player-hud__bar" aria-hidden="true">
          <div class="player-hud__ghost" data-ghost></div>
          <div class="player-hud__fill" data-fill></div>
          <div class="player-hud__hp" data-hp></div>
        </div>
      </div>
    `;
    host.appendChild(root);

    const hud = new PlayerHud(
      root.querySelector("[data-fill]")!,
      root.querySelector("[data-ghost]")!,
      root.querySelector("[data-hp]")!,
      root.querySelector("[data-name]")!,
      root.querySelector("[data-level]")!,
      root.querySelector("[data-avatar]")!,
    );
    // Set through the DOM rather than interpolated above: player names are
    // server data and must not reach innerHTML.
    hud.setName(name);
    return hud;
  }

  setName(name: string): void {
    this.nameEl.textContent = name;
  }

  setLevel(level: number): void {
    const previous = this.lastLevel;
    this.lastLevel = level;
    this.levelEl.textContent = String(level);

    // Only celebrate a real gain, never the first sync from the server.
    if (previous === null || level <= previous) return;
    this.levelEl.classList.remove("player-hud__level--gained");
    void this.levelEl.offsetWidth;
    this.levelEl.classList.add("player-hud__level--gained");
  }

  /** Class portrait from the catalog, so the frame matches the sheet. */
  setPortrait(src: string): void {
    const next = src.startsWith("/") ? src : `/${src}`;
    if (this.avatarEl.getAttribute("src") === next) return;
    this.avatarEl.src = next;
  }

  setVitals({ hp, maxHp }: PlayerVitals): void {
    const key = `${hp}:${maxHp}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const ratio = hpRatio(hp, maxHp);
    this.fillEl.style.width = `${ratio * 100}%`;
    this.fillEl.dataset.tier = hpTier(ratio);
    this.textEl.textContent = formatHp(hp, maxHp);

    if (ratio < this.lastRatio) {
      // Damage: leave the ghost where it was and let CSS drain it after a beat.
      this.ghostEl.style.width = `${ratio * 100}%`;
    } else {
      // Healing (or a maxHp change on level-up) should not leave a trail.
      this.ghostEl.style.transition = "none";
      this.ghostEl.style.width = `${ratio * 100}%`;
      void this.ghostEl.offsetWidth;
      this.ghostEl.style.transition = "";
    }

    this.lastRatio = ratio;
  }
}
