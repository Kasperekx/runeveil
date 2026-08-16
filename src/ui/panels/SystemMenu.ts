interface SystemMenuActions {
  onSettings: () => void;
  onCharacterSelect: () => Promise<void>;
}

/** Full-screen MMO system menu opened with Escape. */
export class SystemMenu {
  private open = false;
  private confirmingExit = false;
  private busy = false;
  private previousFocus: HTMLElement | null = null;

  private constructor(
    private readonly root: HTMLElement,
    private readonly actions: SystemMenuActions,
  ) {
    this.bindEvents();
  }

  static create(
    actions: SystemMenuActions,
    host: HTMLElement = document.getElementById("app")!,
  ): SystemMenu {
    const root = document.createElement("aside");
    root.className = "system-menu";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("aria-label", "Menu gry");
    root.innerHTML = `
      <div class="system-menu__shade" data-resume aria-hidden="true"></div>
      <section class="system-menu__panel" role="dialog" aria-modal="true" aria-labelledby="system-menu-title">
        <div class="system-menu__ornament" aria-hidden="true"><span>ᚱ</span></div>
        <p class="system-menu__eyebrow">RUNEVEIL</p>
        <h2 id="system-menu-title">Menu gry</h2>
        <div class="system-menu__rule" aria-hidden="true"><span>◆</span></div>
        <div class="system-menu__main" data-menu-main>
          <button type="button" class="system-menu__action system-menu__action--primary" data-resume>
            <span class="system-menu__action-icon" aria-hidden="true">▶</span>
            <span><strong>Wróć do gry</strong><small>Kontynuuj podróż</small></span>
            <kbd>ESC</kbd>
          </button>
          <button type="button" class="system-menu__action" data-settings>
            <span class="system-menu__action-icon" aria-hidden="true">⚙</span>
            <span><strong>Ustawienia</strong><small>Interfejs i rozgrywka</small></span>
          </button>
          <button type="button" class="system-menu__action system-menu__action--danger" data-character-select>
            <span class="system-menu__action-icon" aria-hidden="true">↪</span>
            <span><strong>Wybór postaci</strong><small>Zapisz bohatera i opuść świat</small></span>
          </button>
        </div>
        <div class="system-menu__confirm" data-menu-confirm hidden>
          <span class="system-menu__confirm-rune" aria-hidden="true">ᛉ</span>
          <h3>Opuścić świat?</h3>
          <p>Postać zostanie bezpiecznie zapisana. Pozostaniesz zalogowany na ekranie wyboru postaci.</p>
          <div>
            <button type="button" data-cancel-exit>Wróć</button>
            <button type="button" data-confirm-exit>Wybór postaci</button>
          </div>
        </div>
        <p class="system-menu__realm"><span></span> Eden · połączenie aktywne</p>
      </section>`;
    host.append(root);
    return new SystemMenu(root, actions);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openMenu();
  }

  openMenu(): void {
    if (this.open) return;
    this.previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    this.open = true;
    this.confirmingExit = false;
    this.syncConfirmation();
    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    void this.root.offsetWidth;
    this.root.classList.add("system-menu--open");
    this.root.querySelector<HTMLButtonElement>("button[data-resume]")?.focus();
  }

  close(): void {
    if (!this.open || this.busy) return;
    if (this.confirmingExit) {
      this.confirmingExit = false;
      this.syncConfirmation();
      return;
    }
    this.open = false;
    this.root.classList.remove("system-menu--open");
    this.root.setAttribute("aria-hidden", "true");
    window.setTimeout(() => {
      if (!this.open) this.root.hidden = true;
    }, 220);
    this.previousFocus?.focus();
    this.previousFocus = null;
  }

  private bindEvents(): void {
    for (const button of this.root.querySelectorAll<HTMLElement>(
      "[data-resume]",
    )) {
      button.addEventListener("click", () => this.close());
    }
    this.required("[data-settings]", HTMLButtonElement).addEventListener(
      "click",
      () => {
        this.close();
        this.actions.onSettings();
      },
    );
    this.required(
      "[data-character-select]",
      HTMLButtonElement,
    ).addEventListener("click", () => {
      this.confirmingExit = true;
      this.syncConfirmation();
    });
    this.required("[data-cancel-exit]", HTMLButtonElement).addEventListener(
      "click",
      () => {
        this.confirmingExit = false;
        this.syncConfirmation();
      },
    );
    this.required("[data-confirm-exit]", HTMLButtonElement).addEventListener(
      "click",
      () => void this.exitToCharacterSelect(),
    );
    this.root.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        this.root.querySelectorAll<HTMLButtonElement>(
          "button:not([disabled]):not([hidden])",
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  private syncConfirmation(): void {
    const main = this.required("[data-menu-main]", HTMLElement);
    const confirm = this.required("[data-menu-confirm]", HTMLElement);
    main.hidden = this.confirmingExit;
    confirm.hidden = !this.confirmingExit;
    const focusTarget = this.confirmingExit
      ? this.root.querySelector<HTMLButtonElement>("[data-cancel-exit]")
      : this.root.querySelector<HTMLButtonElement>("button[data-resume]");
    window.setTimeout(() => focusTarget?.focus(), 0);
  }

  private async exitToCharacterSelect(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const button = this.required("[data-confirm-exit]", HTMLButtonElement);
    button.disabled = true;
    button.textContent = "Zapisywanie…";
    try {
      await this.actions.onCharacterSelect();
    } catch {
      this.busy = false;
      button.disabled = false;
      button.textContent = "Wybór postaci";
    }
  }

  private required<T extends Element>(
    selector: string,
    constructor?: { new (): T },
  ): T {
    const element = this.root.querySelector(selector);
    if (!element || (constructor && !(element instanceof constructor))) {
      throw new Error(`Brakuje elementu menu: ${selector}`);
    }
    return element as T;
  }
}
