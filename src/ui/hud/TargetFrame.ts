import { CHARACTER_PANEL_CLOSE_MS } from "../../config/constants";
import { getCreature, hasCreature } from "../../content/creatures";
import { formatHp, hpRatio, hpTier } from "./vitals";

export interface TargetVitals {
  id: string;
  kind: string;
  name: string;
  hp: number;
  maxHp: number;
}

/**
 * Top-of-screen target frame: portrait, name and HP for the selected creature.
 *
 * Mirror of PlayerHud — same brass plate and squared portrait, flipped so the
 * portrait sits on the right. The two read as opposing halves of one pair.
 */
export class TargetFrame {
  private lastKey = "";
  private lastRatio = 1;
  private lastKind = "";
  private shown = false;
  private hideTimer: number | null = null;

  private constructor(
    private readonly root: HTMLElement,
    private readonly nameEl: HTMLElement,
    private readonly fillEl: HTMLElement,
    private readonly ghostEl: HTMLElement,
    private readonly textEl: HTMLElement,
    private readonly percentEl: HTMLElement,
    private readonly portraitEl: HTMLImageElement,
  ) {}

  static create(
    host: HTMLElement = document.getElementById("ui-root")!,
  ): TargetFrame {
    const root = document.createElement("div");
    root.id = "target-frame";
    root.className = "target-frame";
    root.hidden = true;
    root.setAttribute("role", "status");
    root.setAttribute("aria-label", "Cel");
    root.innerHTML = `
      <div class="target-frame__info">
        <div class="target-frame__name" data-name></div>
        <div class="target-frame__bar" aria-hidden="true">
          <div class="target-frame__ghost" data-ghost></div>
          <div class="target-frame__fill" data-fill></div>
          <div class="target-frame__hp" data-hp></div>
        </div>
      </div>
      <div class="target-frame__portrait-ring" aria-hidden="true">
        <div class="target-frame__portrait">
          <img
            class="target-frame__avatar"
            data-portrait
            src=""
            alt=""
            draggable="false"
          />
        </div>
        <span class="target-frame__percent" data-percent aria-hidden="true"></span>
      </div>
    `;
    host.appendChild(root);

    return new TargetFrame(
      root,
      root.querySelector("[data-name]")!,
      root.querySelector("[data-fill]")!,
      root.querySelector("[data-ghost]")!,
      root.querySelector("[data-hp]")!,
      root.querySelector("[data-percent]")!,
      root.querySelector("[data-portrait]")!,
    );
  }

  setTarget(vitals: TargetVitals | null): void {
    if (!vitals) {
      this.hide();
      return;
    }

    const key = `${vitals.id}:${vitals.hp}:${vitals.maxHp}`;
    if (key === this.lastKey) return;
    const switchedTarget = !this.lastKey.startsWith(`${vitals.id}:`);
    this.lastKey = key;

    this.show();
    this.nameEl.textContent = vitals.name;
    this.setPortrait(vitals.kind);

    const ratio = hpRatio(vitals.hp, vitals.maxHp);
    this.fillEl.style.width = `${ratio * 100}%`;
    this.fillEl.dataset.tier = hpTier(ratio);
    this.textEl.textContent = formatHp(vitals.hp, vitals.maxHp);
    this.percentEl.textContent = `${Math.round(ratio * 100)}%`;

    // A fresh target starts full — no trail from the previous creature's bar.
    if (switchedTarget || ratio > this.lastRatio) {
      this.ghostEl.style.transition = "none";
      this.ghostEl.style.width = `${ratio * 100}%`;
      void this.ghostEl.offsetWidth;
      this.ghostEl.style.transition = "";
    } else {
      this.ghostEl.style.width = `${ratio * 100}%`;
    }

    this.lastRatio = ratio;
  }

  /** Idle-down sprite doubles as the portrait; creatures have no icon art. */
  private setPortrait(kind: string): void {
    if (kind === this.lastKind) return;
    this.lastKind = kind;

    if (!hasCreature(kind)) {
      this.portraitEl.removeAttribute("src");
      return;
    }
    // Catalog paths are public-relative ("assets/…"), same as item icons.
    this.portraitEl.src = `/${getCreature(kind).sprites.idleDown}`;
  }

  private show(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.shown) return;

    this.shown = true;
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add("is-shown");
  }

  private hide(): void {
    if (!this.shown) return;

    this.shown = false;
    this.lastKey = "";
    this.lastKind = "";
    this.lastRatio = 1;
    this.root.classList.remove("is-shown");

    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      if (!this.shown) this.root.hidden = true;
    }, CHARACTER_PANEL_CLOSE_MS);
  }
}
