import { CHARACTER_PANEL_CLOSE_MS } from "../../config/constants";
import { makeDraggable } from "../makeDraggable";
import { UI_SCALE_MAX, UI_SCALE_MIN, type Settings } from "./settings";

interface SettingsPanelActions {
  accountEmail: string;
  onCharacterSelect: () => Promise<void>;
}

/** Display options window. Mirrors the character panel's chrome. */
export class SettingsPanel {
  private open = false;
  private closeTimer: number | null = null;

  private constructor(private readonly root: HTMLElement) {}

  static create(
    settings: Settings,
    actions: SettingsPanelActions,
    host: HTMLElement = document.getElementById("ui-root")!,
  ): SettingsPanel {
    const root = document.createElement("aside");
    root.id = "settings-panel";
    root.className = "settings-panel";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("aria-label", "Ustawienia");
    root.innerHTML = `
      <div class="settings-panel__frame">
        <header class="settings-panel__header" data-header>
          <span class="settings-panel__sigil" aria-hidden="true">⚙</span>
          <h2 class="settings-panel__title">Ustawienia</h2>
          <button type="button" class="settings-panel__close" data-close aria-label="Zamknij">×</button>
        </header>
        <div class="settings-panel__body">
          <h3 class="settings-panel__section">Interfejs</h3>

          <label class="settings-panel__row" for="setting-ui-scale">
            <span class="settings-panel__label">Skala interfejsu</span>
            <input
              class="settings-panel__slider"
              id="setting-ui-scale"
              data-ui-scale
              type="range"
              min="${UI_SCALE_MIN}"
              max="${UI_SCALE_MAX}"
              step="0.05"
            />
            <output class="settings-panel__value" data-ui-scale-out></output>
          </label>

          <label class="settings-panel__row" for="setting-damage-numbers">
            <span class="settings-panel__label">Liczby obrażeń</span>
            <input
              class="settings-panel__check"
              id="setting-damage-numbers"
              data-damage-numbers
              type="checkbox"
            />
          </label>

          <p class="settings-panel__note">
            Ustawienia dotyczą tej przeglądarki i nie wędrują za postacią.
          </p>

          <h3 class="settings-panel__section settings-panel__section--account">Konto</h3>
          <div class="settings-panel__account">
            <span class="settings-panel__account-email"></span>
            <button type="button" class="settings-panel__logout" data-logout>Wybór postaci</button>
          </div>
        </div>
      </div>
    `;
    host.appendChild(root);

    const panel = new SettingsPanel(root);

    const scale = root.querySelector<HTMLInputElement>("[data-ui-scale]")!;
    const scaleOut = root.querySelector<HTMLOutputElement>(
      "[data-ui-scale-out]",
    )!;
    const damage = root.querySelector<HTMLInputElement>(
      "[data-damage-numbers]",
    )!;
    root.querySelector<HTMLElement>(
      ".settings-panel__account-email",
    )!.textContent = actions.accountEmail;
    const logout = root.querySelector<HTMLButtonElement>("[data-logout]")!;

    const sync = (): void => {
      const { uiScale, showDamageNumbers } = settings.current;
      scale.value = String(uiScale);
      scaleOut.textContent = `${Math.round(uiScale * 100)}%`;
      damage.checked = showDamageNumbers;
    };
    sync();
    settings.onChange(sync);

    scale.addEventListener("input", () => {
      settings.set({ uiScale: Number(scale.value) });
    });
    damage.addEventListener("change", () => {
      settings.set({ showDamageNumbers: damage.checked });
    });
    logout.addEventListener("click", () => {
      if (!window.confirm("Zapisać postać i wrócić do ekranu wyboru?")) return;
      logout.disabled = true;
      logout.textContent = "Zapisywanie…";
      void actions.onCharacterSelect().catch(() => {
        logout.disabled = false;
        logout.textContent = "Wybór postaci";
      });
    });

    root.querySelector("[data-close]")!.addEventListener("click", () => {
      panel.close();
    });

    makeDraggable(root, root.querySelector("[data-header]") as HTMLElement);
    return panel;
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openPanel();
  }

  openPanel(): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    this.open = true;
    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    void this.root.offsetWidth;
    this.root.classList.add("is-open");
  }

  close(): void {
    if (!this.open && !this.root.classList.contains("is-open")) return;

    this.open = false;
    this.root.setAttribute("aria-hidden", "true");
    this.root.classList.remove("is-open");

    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      if (!this.open) this.root.hidden = true;
    }, CHARACTER_PANEL_CLOSE_MS);
  }
}
