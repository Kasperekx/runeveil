export interface DeathScreenDetails {
  lostExperience?: number;
  penaltyPercent: number;
  homeName: string;
  respawnDelayMs?: number;
}

/** Modal death state with a server-authoritative resurrection request. */
export class DeathScreen {
  private readonly titleEl: HTMLElement;
  private readonly lossEl: HTMLElement;
  private readonly homeEl: HTMLElement;
  private readonly button: HTMLButtonElement;
  private deadline = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  private constructor(
    private readonly root: HTMLElement,
    private readonly onRespawn: () => void,
  ) {
    this.titleEl = root.querySelector("[data-title]")!;
    this.lossEl = root.querySelector("[data-loss]")!;
    this.homeEl = root.querySelector("[data-home]")!;
    this.button = root.querySelector("[data-respawn]")!;
    this.button.addEventListener("click", () => {
      if (Date.now() < this.deadline) return;
      this.button.disabled = true;
      this.button.textContent = "PRZYWOŁYWANIE…";
      this.onRespawn();
    });
  }

  static create(
    onRespawn: () => void,
    host: HTMLElement = document.getElementById("ui-root")!,
  ): DeathScreen {
    const root = document.createElement("section");
    root.id = "death-screen";
    root.className = "death-screen";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "death-screen-title");
    root.innerHTML = `
      <div class="death-screen__vignette" aria-hidden="true"></div>
      <div class="death-screen__panel">
        <span class="death-screen__rune" aria-hidden="true">☠</span>
        <p class="death-screen__eyebrow">TWÓJ LOS DOBIEGŁ KOŃCA</p>
        <h2 id="death-screen-title" data-title>POLEGŁEŚ</h2>
        <div class="death-screen__rule" aria-hidden="true"><span>◆</span></div>
        <p class="death-screen__loss" data-loss></p>
        <p class="death-screen__home-label">MIEJSCE POWROTU</p>
        <strong class="death-screen__home" data-home></strong>
        <button class="death-screen__respawn" type="button" data-respawn></button>
        <p class="death-screen__hint">Powrócisz z pełnią zdrowia. Twój ekwipunek pozostaje przy Tobie.</p>
      </div>
    `;
    host.appendChild(root);
    return new DeathScreen(root, onRespawn);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(details: DeathScreenDetails): void {
    this.clearTimer();
    this.titleEl.textContent = "POLEGŁEŚ";
    this.homeEl.textContent = details.homeName;
    if (details.lostExperience === undefined) {
      this.lossEl.textContent =
        "Kara za śmierć została naliczona. Wskrześ się, aby powrócić do świata.";
    } else {
      const lost = Math.max(0, Math.floor(details.lostExperience));
      this.lossEl.textContent =
        lost > 0
          ? `Śmierć kosztowała Cię ${lost} PD (${details.penaltyPercent}% wymagań bieżącego poziomu).`
          : "Nie utraciłeś doświadczenia, ponieważ pasek tego poziomu był pusty.";
    }
    this.deadline = Date.now() + Math.max(0, details.respawnDelayMs ?? 0);
    this.root.hidden = false;
    this.root.classList.remove("death-screen--visible");
    void this.root.offsetWidth;
    this.root.classList.add("death-screen--visible");
    this.updateButton();
    this.timer = setInterval(() => this.updateButton(), 100);
  }

  hide(): void {
    this.clearTimer();
    this.root.classList.remove("death-screen--visible");
    this.root.hidden = true;
  }

  dispose(): void {
    this.clearTimer();
    this.root.remove();
  }

  private updateButton(): void {
    const remaining = Math.max(0, this.deadline - Date.now());
    if (remaining > 0) {
      this.button.disabled = true;
      this.button.textContent = `Wskrzeszenie za ${Math.ceil(remaining / 1000)}…`;
      return;
    }
    this.button.disabled = false;
    this.button.textContent = "POWRÓĆ DO SCHRONIENIA";
    this.clearTimer();
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
