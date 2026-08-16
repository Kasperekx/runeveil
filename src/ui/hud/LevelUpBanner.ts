/** How long the banner stays before fading out. */
const HOLD_MS = 2600;

export interface LevelUpInfo {
  level: number;
  from: number;
  maxHp: number;
  attackPower: number;
  attrPointsGained?: number;
  unspentAttrPoints?: number;
}

/**
 * Centre-screen announcement on level-up.
 *
 * A single kill can cover several levels, so the copy reports the span rather
 * than assuming one step at a time.
 */
export class LevelUpBanner {
  private hideTimer: number | null = null;

  private constructor(
    private readonly root: HTMLElement,
    private readonly levelEl: HTMLElement,
    private readonly detailEl: HTMLElement,
  ) {}

  static create(
    host: HTMLElement = document.getElementById("ui-root")!,
  ): LevelUpBanner {
    const root = document.createElement("div");
    root.className = "level-up";
    root.hidden = true;
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.innerHTML = `
      <div class="level-up__burst" aria-hidden="true"></div>
      <div class="level-up__plate">
        <div class="level-up__title">Awans</div>
        <div class="level-up__level" data-level></div>
        <div class="level-up__rule" aria-hidden="true"></div>
        <div class="level-up__detail" data-detail></div>
      </div>
    `;
    host.appendChild(root);

    return new LevelUpBanner(
      root,
      root.querySelector("[data-level]")!,
      root.querySelector("[data-detail]")!,
    );
  }

  show({
    level,
    from,
    maxHp,
    attackPower,
    attrPointsGained = 0,
    unspentAttrPoints = 0,
  }: LevelUpInfo): void {
    const gained = Math.max(1, level - from);
    const points =
      attrPointsGained > 0
        ? ` · +${attrPointsGained} pkt atrybutów${
            unspentAttrPoints > attrPointsGained
              ? ` (${unspentAttrPoints} wolnych)`
              : ""
          }`
        : "";

    this.levelEl.textContent = `Poziom ${level}`;
    this.detailEl.textContent =
      gained > 1
        ? `+${gained} poziomy · Życie ${maxHp} · Atak ${attackPower}${points}`
        : `Życie ${maxHp} · Atak ${attackPower}${points}`;

    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);

    this.root.hidden = false;
    this.root.classList.remove("is-showing");
    void this.root.offsetWidth;
    this.root.classList.add("is-showing");

    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      this.root.classList.remove("is-showing");
      this.root.hidden = true;
    }, HOLD_MS);
  }
}
