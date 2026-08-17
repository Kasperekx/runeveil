import { CHARACTER_PANEL_CLOSE_MS } from "../../config/constants";
import type { NpcDialogueOption, NpcShopOffer } from "../../content/npcs";
import { makeDraggable, clearDragPosition } from "../makeDraggable";

type DialogueOptionKind =
  | "talk"
  | "trade"
  | "repair"
  | "quest"
  | "close"
  | "back"
  | "learn";

const OPTION_BADGES: Partial<Record<DialogueOptionKind, string>> = {
  trade: "Handel",
  repair: "Usługa",
  quest: "Zadanie",
  learn: "Nauka",
};

export interface NpcDialogueView {
  name: string;
  title: string;
  /** Public-relative sprite path (no leading slash), as stored in the catalog. */
  portrait: string;
  greeting: string;
  dialogue: NpcDialogueOption[];
  /** Map instance id — required for trade / repair hand-off. */
  npcInstanceId: string;
  shop: NpcShopOffer[];
  gold: number;
  /** When true, repair option may open the merchant repair tab. */
  canRepair?: boolean;
  questActions?: DialogueQuestAction[];
}

export interface DialogueQuestAction {
  label: string;
  onClick: () => void;
}

export interface DialogueServiceHandlers {
  onTrade: (view: NpcDialogueView) => void;
  onRepair: (view: NpcDialogueView) => void;
  onLearnProfession: (view: NpcDialogueView, professionId: string) => void;
}

/**
 * NPC gossip frame — portrait, text, choice buttons.
 * Trade and repair hand off to MerchantWindow via service handlers.
 */
export class DialogueWindow {
  private opened = false;
  private closeTimer: number | null = null;
  private view: NpcDialogueView | null = null;
  private serviceHandlers: DialogueServiceHandlers | null = null;
  private readonly optionsEl: HTMLElement;

  private constructor(
    private readonly root: HTMLElement,
    private readonly portraitEl: HTMLImageElement,
    private readonly eyebrowEl: HTMLElement,
    private readonly titleEl: HTMLElement,
    private readonly greetingEl: HTMLElement,
    optionsEl: HTMLElement,
  ) {
    this.optionsEl = optionsEl;
  }

  static create(
    host: HTMLElement = document.getElementById("ui-root")!,
  ): DialogueWindow {
    const root = document.createElement("aside");
    root.id = "dialogue-window";
    root.className = "dialogue-window panel";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Rozmowa");
    root.innerHTML = `
      <div class="panel__frame">
        <span class="panel__corner panel__corner--tl" aria-hidden="true"></span>
        <span class="panel__corner panel__corner--br" aria-hidden="true"></span>
        <header class="panel__header" data-header>
          <div class="panel__brand">
            <span class="panel__sigil" aria-hidden="true"><span>⚔</span></span>
            <div>
              <span class="panel__eyebrow" data-eyebrow>Rozmowa</span>
              <h2 class="panel__title" data-title>NPC</h2>
            </div>
          </div>
          <div class="panel__rule" aria-hidden="true"><span>◆</span></div>
          <button type="button" class="panel__close" data-close aria-label="Zamknij">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div class="panel__body">
          <div class="dialogue-window__layout">
            <div class="dialogue-window__portrait-well" aria-hidden="true">
              <img class="dialogue-window__portrait" data-portrait src="" alt="" draggable="false" />
            </div>
            <div class="dialogue-window__copy">
              <p class="dialogue-window__greeting" data-greeting></p>
              <div class="dialogue-window__options" data-options role="list"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    host.appendChild(root);

    const win = new DialogueWindow(
      root,
      root.querySelector("[data-portrait]")!,
      root.querySelector("[data-eyebrow]")!,
      root.querySelector("[data-title]")!,
      root.querySelector("[data-greeting]")!,
      root.querySelector("[data-options]")!,
    );

    root.querySelector("[data-close]")!.addEventListener("click", () => {
      win.close();
    });
    makeDraggable(root, root.querySelector("[data-header]") as HTMLElement);
    return win;
  }

  bindServices(handlers: DialogueServiceHandlers): void {
    this.serviceHandlers = handlers;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(view: NpcDialogueView): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    this.view = view;
    this.portraitEl.src = `/${view.portrait}`;
    this.eyebrowEl.textContent = view.title || "Rozmowa";
    this.titleEl.textContent = view.name;
    this.greetingEl.textContent = view.greeting;
    this.renderRootOptions();

    this.opened = true;
    this.root.hidden = false;
    clearDragPosition(this.root);
    void this.root.offsetWidth;
    this.root.classList.add("is-open");
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.view = null;
    this.root.classList.remove("is-open");
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      if (!this.opened) this.root.hidden = true;
    }, CHARACTER_PANEL_CLOSE_MS);
  }

  private renderRootOptions(): void {
    this.optionsEl.replaceChildren();
    if (!this.view) return;

    for (const action of this.view.questActions ?? []) {
      this.optionsEl.appendChild(
        this.buildOptionButton(
          action.label,
          () => {
            action.onClick();
            this.close();
          },
          "quest",
        ),
      );
    }

    for (const option of this.view.dialogue) {
      const kind =
        option.action === "trade" ||
        option.action === "repair" ||
        option.action === "close"
          ? option.action
          : option.action === "learnProfession"
            ? "learn"
            : "talk";
      this.optionsEl.appendChild(
        this.buildOptionButton(
          option.label,
          () => {
            this.chooseOption(option);
          },
          kind,
        ),
      );
    }
  }

  private renderBackOption(): void {
    this.optionsEl.replaceChildren();
    this.optionsEl.appendChild(
      this.buildOptionButton(
        "Wróć",
        () => {
          if (!this.view) return;
          this.greetingEl.textContent = this.view.greeting;
          this.renderRootOptions();
        },
        "back",
      ),
    );
  }

  private chooseOption(option: NpcDialogueOption): void {
    if (!this.view) return;

    if (option.action === "close") {
      this.close();
      return;
    }

    if (option.text) {
      this.greetingEl.textContent = option.text;
      this.renderBackOption();
      if (!option.action) return;
    }

    if (option.action === "trade") {
      const view = this.view;
      this.close();
      this.serviceHandlers?.onTrade(view);
      return;
    }
    if (option.action === "repair") {
      const view = this.view;
      this.close();
      this.serviceHandlers?.onRepair(view);
      return;
    }
    if (option.action === "learnProfession" && option.profession) {
      const professionId = option.profession;
      this.serviceHandlers?.onLearnProfession(this.view, professionId);
      this.view.dialogue = this.view.dialogue.filter(
        (row) =>
          !(
            row.action === "learnProfession" &&
            row.profession === professionId
          ),
      );
      this.renderRootOptions();
    }
  }

  private buildOptionButton(
    label: string,
    onClick: () => void,
    kind: DialogueOptionKind = "talk",
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `dialogue-window__option dialogue-window__option--${kind}`;
    button.setAttribute("role", "listitem");
    const badge = OPTION_BADGES[kind];
    if (badge) {
      button.innerHTML = `<span class="dialogue-window__option-label">${escapeHtml(label)}</span><span class="dialogue-window__option-badge">${badge}</span>`;
    } else {
      button.textContent = label;
    }
    button.addEventListener("click", onClick);
    return button;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
