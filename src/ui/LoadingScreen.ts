/**
 * Full-bleed boot overlay. Hides the connect/hydrate pop-in.
 * HTML lives in index.html (#boot-screen); this only drives copy + dismiss.
 */
export class LoadingScreen {
  private readonly root: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly brandEl: HTMLElement;
  private dismissed = false;

  private constructor(
    root: HTMLElement,
    statusEl: HTMLElement,
    brandEl: HTMLElement,
  ) {
    this.root = root;
    this.statusEl = statusEl;
    this.brandEl = brandEl;
  }

  static create(): LoadingScreen {
    const root = document.getElementById("boot-screen");
    const statusEl = document.getElementById("boot-status");
    const brandEl = document.getElementById("boot-brand");
    if (!root || !statusEl || !brandEl) {
      throw new Error("Missing #boot-screen markup");
    }
    return new LoadingScreen(root, statusEl, brandEl);
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  /** Soft brand pulse once loading is underway. */
  markProgress(): void {
    this.brandEl.classList.add("boot-screen__brand--lit");
  }

  async dismiss(): Promise<void> {
    if (this.dismissed) return;
    this.dismissed = true;
    this.root.classList.add("boot-screen--out");
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.root.removeEventListener("transitionend", done);
        this.root.hidden = true;
        this.root.setAttribute("aria-hidden", "true");
        resolve();
      };
      this.root.addEventListener("transitionend", done);
      window.setTimeout(done, 700);
    });
  }
}
