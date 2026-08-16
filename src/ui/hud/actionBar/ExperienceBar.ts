export interface ActionBarProgress {
  level: number;
  experience: number;
  experienceToLevel: number;
}

/** Level badge, notched track and readout under the hotbar. */
export class ExperienceBar {
  private constructor(
    readonly element: HTMLElement,
    private readonly levelEl: HTMLElement,
    private readonly fillEl: HTMLElement,
    private readonly labelEl: HTMLElement,
  ) {}

  static create(): ExperienceBar {
    const root = document.createElement("div");
    root.className = "action-bar__xp";
    root.innerHTML = `
      <span class="action-bar__xp-level" data-level>1</span>
      <span class="action-bar__xp-track">
        <span class="action-bar__xp-fill" data-fill></span>
      </span>
      <span class="action-bar__xp-label" data-label></span>
    `;

    return new ExperienceBar(
      root,
      root.querySelector("[data-level]")!,
      root.querySelector("[data-fill]")!,
      root.querySelector("[data-label]")!,
    );
  }

  setProgress({
    level,
    experience,
    experienceToLevel,
  }: ActionBarProgress): void {
    this.levelEl.textContent = String(level);
    this.levelEl.setAttribute("aria-label", `Poziom ${level}`);

    if (experienceToLevel <= 0) {
      this.fillEl.style.width = "100%";
      this.labelEl.textContent = "MAKS.";
      return;
    }

    const ratio = Math.max(0, Math.min(1, experience / experienceToLevel));
    this.fillEl.style.width = `${ratio * 100}%`;
    this.labelEl.textContent = `${experience} / ${experienceToLevel} PD`;
  }
}
