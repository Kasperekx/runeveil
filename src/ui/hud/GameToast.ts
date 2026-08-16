const HOLD_MS = 2200;

/**
 * Short centre-bottom status line (inventory full, etc.).
 * Reuses one DOM node; rapid repeats just reset the timer.
 */
export class GameToast {
  private hideTimer: number | null = null;

  private constructor(private readonly root: HTMLElement) {}

  static create(
    host: HTMLElement = document.getElementById("ui-root")!,
  ): GameToast {
    const root = document.createElement("div");
    root.className = "game-toast";
    root.hidden = true;
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    host.appendChild(root);
    return new GameToast(root);
  }

  show(message: string): void {
    this.root.textContent = message;

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
