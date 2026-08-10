import { AuthApi, AuthApiError } from "../auth/AuthApi";
import type { AuthCharacter, AuthSession, GameAccess } from "../auth/types";
import {
  getClass,
  listClasses,
  loadClassCatalog,
  type ClassDefinition,
} from "../classes/catalog";

const MAX_CHARACTERS = 4;
const MAX_NAME_LENGTH = 18;
const NAME_SUGGESTIONS = [
  "Aldren",
  "Brannor",
  "Caelwyn",
  "Darian",
  "Eryndor",
  "Faelan",
  "Garrick",
  "Hadrian",
  "Isolde",
  "Kaelen",
  "Lysandra",
  "Maelis",
  "Nerys",
  "Orwyn",
  "Rhiannon",
  "Serilda",
  "Theron",
  "Vaelor",
  "Ysara",
  "Zorian",
] as const;

const CREATE_ERROR_COPY: Record<string, string> = {
  INVALID_CHARACTER_NAME:
    "Nazwa musi mieć 3–18 liter. Możesz użyć spacji, apostrofu lub łącznika.",
  CHARACTER_NAME_TAKEN: "Ta nazwa jest już zapisana w kronikach.",
  INVALID_CLASS: "Wybrana klasa nie jest dostępna.",
  CHARACTER_LIMIT_OR_INVALID_CLASS: "Wszystkie miejsca na postacie są zajęte.",
  NETWORK_ERROR: "Nie można połączyć się z serwerem.",
  CHARACTER_ONLINE:
    "Ta postać jest nadal połączona ze światem. Odczekaj chwilę i spróbuj ponownie.",
  INVALID_DELETE_CONFIRMATION: "Wpisana nazwa nie jest prawidłowa.",
};

type ScreenMode = "selection" | "creation";

export class CharacterSelectScreen {
  private readonly api = new AuthApi();
  private readonly root: HTMLElement;
  private readonly roster: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly details: HTMLElement;
  private readonly accountLabel: HTMLElement;
  private characters: AuthCharacter[];
  private selectedCharacterId: string | null = null;
  private selectedClassId = "warrior";
  private mode: ScreenMode = "selection";
  private draftName = "";
  private animationTimer: number | null = null;
  private resolveSelection: ((access: GameAccess) => void) | null = null;

  private constructor(private readonly session: AuthSession) {
    const app = document.getElementById("app");
    const boot = document.getElementById("boot-screen");
    if (!app || !boot) throw new Error("Brakuje kontenera interfejsu gry.");
    boot.hidden = true;
    this.characters = session.characters.filter(
      (character) => character.customized,
    );

    this.root = document.createElement("section");
    this.root.className = "character-select";
    this.root.setAttribute("aria-label", "Wybór postaci");
    this.root.innerHTML = `
      <div class="character-select__backdrop" aria-hidden="true"></div>
      <div class="character-select__veil" aria-hidden="true"></div>
      <div class="character-select__grain" aria-hidden="true"></div>
      <header class="character-select__topbar">
        <p class="character-select__brand">Runeveil</p>
        <div class="character-select__account">
          <span class="character-select__account-email"></span>
          <button type="button" data-logout>Wyloguj</button>
        </div>
      </header>
      <main class="character-select__layout">
        <aside class="character-roster" aria-label="Twoje postacie">
          <header class="character-roster__header">
            <h1>Postacie</h1>
            <span data-roster-count></span>
          </header>
          <div class="character-roster__list" data-roster></div>
        </aside>
        <section class="character-stage" data-stage aria-live="polite"></section>
        <aside class="character-details" data-details></aside>
      </main>`;
    app.append(this.root);

    this.roster = this.required("[data-roster]");
    this.stage = this.required("[data-stage]");
    this.details = this.required("[data-details]");
    this.accountLabel = this.required(".character-select__account-email");
    this.accountLabel.textContent = session.account.email;
    this.bindGlobalEvents();
  }

  static async select(session: AuthSession): Promise<GameAccess> {
    await loadClassCatalog();
    const screen = new CharacterSelectScreen(session);
    return screen.run();
  }

  private run(): Promise<GameAccess> {
    const first = this.characters[0];
    if (first) {
      this.selectedCharacterId = first.id;
      this.selectedClassId = first.classId;
      this.mode = "selection";
    } else {
      this.mode = "creation";
      this.selectedClassId = listClasses()[0]?.id ?? "warrior";
    }
    this.render();
    return new Promise<GameAccess>((resolve) => {
      this.resolveSelection = resolve;
    });
  }

  private bindGlobalEvents(): void {
    this.required("[data-logout]", HTMLButtonElement).addEventListener(
      "click",
      () => void this.logout(),
    );
    this.root.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        this.root.querySelector("[data-delete-dialog]")
      ) {
        event.preventDefault();
        this.closeDeleteDialog();
        return;
      }
      if (event.key === "Escape" && this.mode === "creation") {
        const selected = this.selectedCharacter();
        if (selected) this.selectCharacter(selected.id);
      }
    });
  }

  private render(): void {
    this.renderRoster();
    if (this.mode === "creation") this.renderCreation();
    else this.renderSelection();
  }

  private renderRoster(): void {
    this.required("[data-roster-count]").textContent =
      `${this.characters.length} / ${MAX_CHARACTERS}`;
    this.roster.replaceChildren();

    for (let index = 0; index < MAX_CHARACTERS; index += 1) {
      const character = this.characters[index];
      const button = document.createElement("button");
      button.type = "button";
      if (character) {
        const cls = getClass(character.classId);
        button.className = "character-slot";
        button.classList.toggle(
          "character-slot--selected",
          this.mode === "selection" &&
            character.id === this.selectedCharacterId,
        );
        button.innerHTML = `
          <span class="character-slot__portrait">
            <img src="/${escapeHtml(cls.selection.preview)}" alt="" draggable="false" />
          </span>
          <span class="character-slot__copy">
            <strong>${escapeHtml(character.name)}</strong>
            <small>Poz. ${character.level} · ${escapeHtml(cls.name)}</small>
          </span>`;
        button.setAttribute(
          "aria-label",
          `${character.name}, poziom ${character.level}, ${cls.name}`,
        );
        button.addEventListener("click", () =>
          this.selectCharacter(character.id),
        );
        button.addEventListener("dblclick", () => this.enterWorld(character));
      } else {
        button.className = "character-slot character-slot--empty";
        button.innerHTML = `
          <span class="character-slot__empty-mark" aria-hidden="true">+</span>
          <span class="character-slot__copy"><strong>Nowa postać</strong><small>Wolne miejsce</small></span>`;
        button.disabled = this.characters.length >= MAX_CHARACTERS;
        button.addEventListener("click", () => this.beginCreation());
      }
      this.roster.append(button);
    }
  }

  private renderSelection(): void {
    const character = this.selectedCharacter();
    if (!character) {
      this.beginCreation();
      return;
    }
    const cls = getClass(character.classId);
    this.renderStage(cls, character.name, `Poziom ${character.level}`);
    this.details.innerHTML = `
      <h2>${escapeHtml(character.name)}</h2>
      <p class="character-details__epithet">${escapeHtml(cls.selection.epithet)}</p>
      ${classSummary(cls)}
      <dl class="character-details__facts">
        <div><dt>Poziom</dt><dd>${character.level}</dd></div>
        <div><dt>Klasa</dt><dd>${escapeHtml(cls.name)}</dd></div>
        <div><dt>Kraina</dt><dd>Eden</dd></div>
      </dl>
      <button class="character-details__primary" type="button" data-enter>Wejdź</button>
      <button class="character-details__delete" type="button" data-delete-character>
        Usuń postać
      </button>`;
    this.required("[data-enter]", HTMLButtonElement).addEventListener(
      "click",
      () => this.enterWorld(character),
    );
    this.required(
      "[data-delete-character]",
      HTMLButtonElement,
    ).addEventListener("click", () => this.openDeleteDialog(character));
  }

  private renderCreation(): void {
    const cls = getClass(this.selectedClassId);
    this.renderStage(cls, "Nowy bohater", cls.selection.epithet);
    const canCancel = this.characters.length > 0;
    this.details.innerHTML = `
      <h2>Nowa postać</h2>
      <p class="character-details__lead">Wybierz klasę i nadaj imię.</p>
      <form class="character-create" data-create-form novalidate>
        <fieldset class="character-create__classes">
          <legend>Klasa</legend>
          <div class="character-create__class-list" data-class-list></div>
        </fieldset>
        <div class="character-create__class-info" data-class-info></div>
        <label class="character-create__name">
          <span>Imię</span>
          <span class="character-create__name-control">
            <input type="text" name="name" minlength="3" maxlength="${MAX_NAME_LENGTH}" autocomplete="off" value="${escapeHtml(this.draftName)}" placeholder="Np. Aldren" required />
            <button type="button" data-random-name aria-label="Wylosuj nazwę">Losuj</button>
          </span>
          <small><span data-name-count>0</span> / ${MAX_NAME_LENGTH}</small>
        </label>
        <div class="character-create__error" data-create-error role="alert" aria-live="polite" hidden></div>
        <div class="character-create__actions">
          ${canCancel ? '<button class="character-create__back" type="button" data-cancel>Wróć</button>' : ""}
          <button class="character-details__primary" type="submit" data-create>Stwórz</button>
        </div>
      </form>`;

    this.renderClassCards();
    this.renderClassInfo();
    const form = this.required("[data-create-form]", HTMLFormElement);
    const input = this.required('input[name="name"]', HTMLInputElement);
    this.required("[data-name-count]").textContent = String(
      [...input.value].length,
    );
    input.addEventListener("input", () => {
      this.draftName = input.value;
      this.required("[data-name-count]").textContent = String(
        [...input.value].length,
      );
      this.hideCreateError();
    });
    this.required("[data-random-name]", HTMLButtonElement).addEventListener(
      "click",
      () => {
        const current = input.value;
        const choices = NAME_SUGGESTIONS.filter((name) => name !== current);
        input.value =
          choices[Math.floor(Math.random() * choices.length)] ?? "Aldren";
        input.dispatchEvent(new Event("input"));
        input.focus();
      },
    );
    this.root
      .querySelector<HTMLButtonElement>("[data-cancel]")
      ?.addEventListener("click", () => {
        const selected = this.selectedCharacter() ?? this.characters[0];
        if (selected) this.selectCharacter(selected.id);
      });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.createCharacter(input.value);
    });
    window.setTimeout(() => input.focus(), 0);
  }

  private renderClassCards(): void {
    const list = this.required("[data-class-list]");
    list.replaceChildren();
    for (const cls of listClasses()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "character-class-card";
      button.classList.toggle(
        "character-class-card--selected",
        cls.id === this.selectedClassId,
      );
      button.innerHTML = `
        <strong>${escapeHtml(cls.name)}</strong>
        <small>${escapeHtml(cls.selection.role)}</small>`;
      button.addEventListener("click", () => {
        const nameInput =
          this.root.querySelector<HTMLInputElement>('input[name="name"]');
        if (nameInput) this.draftName = nameInput.value;
        this.selectedClassId = cls.id;
        this.renderCreation();
      });
      list.append(button);
    }
  }

  private renderClassInfo(): void {
    const cls = getClass(this.selectedClassId);
    const target = this.required("[data-class-info]");
    target.innerHTML = `
      <div class="character-create__class-heading">
        <span>${escapeHtml(cls.selection.epithet)}</span>
        <span>Trudność ${difficultyPips(cls.selection.difficulty)}</span>
      </div>
      <p>${escapeHtml(cls.description)}</p>
      <ul>${cls.selection.strengths.map((strength) => `<li>${escapeHtml(strength)}</li>`).join("")}</ul>
      ${statBars(cls)}`;
  }

  private renderStage(
    cls: ClassDefinition,
    name: string,
    subtitle: string,
  ): void {
    this.stopAnimation();
    const frames = previewFrames(cls.id);
    this.stage.className = `character-stage character-stage--${cls.selection.accent}`;
    this.stage.innerHTML = `
      <div class="character-stage__figure">
        <img src="/${escapeHtml(frames[0] ?? cls.selection.preview)}" alt="Podgląd klasy ${escapeHtml(cls.name)}" data-character-preview draggable="false" />
      </div>
      <div class="character-stage__identity">
        <p>${escapeHtml(cls.name)}</p>
        <h2>${escapeHtml(name)}</h2>
        <span>${escapeHtml(subtitle)}</span>
      </div>`;

    if (frames.length > 1) {
      let frame = 0;
      const image = this.required("[data-character-preview]", HTMLImageElement);
      this.animationTimer = window.setInterval(() => {
        frame = (frame + 1) % frames.length;
        image.src = `/${frames[frame]}`;
      }, 260);
    }
  }

  private beginCreation(): void {
    if (this.characters.length >= MAX_CHARACTERS) return;
    this.mode = "creation";
    this.selectedClassId = listClasses()[0]?.id ?? "warrior";
    this.render();
  }

  private selectCharacter(characterId: string): void {
    const character = this.characters.find((entry) => entry.id === characterId);
    if (!character) return;
    this.mode = "selection";
    this.selectedCharacterId = character.id;
    this.selectedClassId = character.classId;
    this.render();
  }

  private selectedCharacter(): AuthCharacter | undefined {
    return this.characters.find(
      (character) => character.id === this.selectedCharacterId,
    );
  }

  private async createCharacter(rawName: string): Promise<void> {
    const name = rawName.normalize("NFKC").trim().replace(/\s+/gu, " ");
    const length = [...name].length;
    if (
      length < 3 ||
      length > MAX_NAME_LENGTH ||
      !/^\p{L}[\p{L}' -]*\p{L}$/u.test(name) ||
      /(?:[' -]){2}/u.test(name)
    ) {
      this.showCreateError(CREATE_ERROR_COPY.INVALID_CHARACTER_NAME);
      return;
    }

    const submit = this.required("[data-create]", HTMLButtonElement);
    submit.disabled = true;
    submit.textContent = "Tworzenie…";
    this.hideCreateError();
    try {
      const character = await this.api.createCharacter(
        name,
        this.selectedClassId,
      );
      this.characters = [
        ...this.characters.filter((entry) => entry.id !== character.id),
        character,
      ];
      this.selectedCharacterId = character.id;
      this.mode = "selection";
      this.render();
    } catch (error) {
      const code =
        error instanceof AuthApiError ? error.code : "REQUEST_FAILED";
      this.showCreateError(
        CREATE_ERROR_COPY[code] ?? "Nie udało się stworzyć postaci.",
      );
      submit.disabled = false;
      submit.textContent = "Stwórz";
    }
  }

  private enterWorld(character: AuthCharacter): void {
    const boot = document.getElementById("boot-screen");
    if (boot) {
      boot.hidden = false;
      boot.removeAttribute("aria-hidden");
      boot.classList.remove("boot-screen--out");
    }
    this.stopAnimation();
    this.root.remove();
    this.resolveSelection?.({
      account: this.session.account,
      characterId: character.id,
      characterName: character.name,
      classId: character.classId,
    });
  }

  private openDeleteDialog(character: AuthCharacter): void {
    this.closeDeleteDialog();
    const dialog = document.createElement("div");
    dialog.className = "character-delete";
    dialog.dataset.deleteDialog = "";
    dialog.innerHTML = `
      <div class="character-delete__shade" data-delete-cancel></div>
      <section class="character-delete__panel" role="dialog" aria-modal="true" aria-labelledby="character-delete-title">
        <h2 id="character-delete-title">Usunąć ${escapeHtml(character.name)}?</h2>
        <p class="character-delete__warning">
          Postać, ekwipunek i postęp znikną na zawsze.
        </p>
        <label class="character-delete__confirmation">
          <span>Wpisz <strong>${escapeHtml(character.name)}</strong>, aby potwierdzić</span>
          <input type="text" autocomplete="off" data-delete-name />
        </label>
        <div class="character-delete__error" data-delete-error role="alert" aria-live="polite" hidden></div>
        <div class="character-delete__actions">
          <button type="button" data-delete-cancel>Anuluj</button>
          <button type="button" data-delete-confirm disabled>Usuń</button>
        </div>
      </section>`;
    this.root.append(dialog);

    const input = this.required("[data-delete-name]", HTMLInputElement);
    const confirm = this.required("[data-delete-confirm]", HTMLButtonElement);
    const expected = normalizeComparableName(character.name);
    input.addEventListener("input", () => {
      confirm.disabled = normalizeComparableName(input.value) !== expected;
      const error = this.required("[data-delete-error]", HTMLElement);
      error.hidden = true;
      error.textContent = "";
    });
    for (const cancel of this.root.querySelectorAll<HTMLElement>(
      "[data-delete-cancel]",
    )) {
      cancel.addEventListener("click", () => this.closeDeleteDialog());
    }
    confirm.addEventListener(
      "click",
      () => void this.deleteCharacter(character, input.value),
    );
    window.setTimeout(() => input.focus(), 0);
  }

  private closeDeleteDialog(): void {
    this.root.querySelector("[data-delete-dialog]")?.remove();
  }

  private async deleteCharacter(
    character: AuthCharacter,
    confirmationName: string,
  ): Promise<void> {
    const button = this.required("[data-delete-confirm]", HTMLButtonElement);
    const input = this.required("[data-delete-name]", HTMLInputElement);
    button.disabled = true;
    input.disabled = true;
    button.textContent = "Usuwanie…";
    try {
      await this.api.deleteCharacter(character.id, confirmationName);
      this.characters = this.characters.filter(
        (entry) => entry.id !== character.id,
      );
      this.closeDeleteDialog();
      const next = this.characters[0];
      if (next) {
        this.selectedCharacterId = next.id;
        this.selectedClassId = next.classId;
        this.mode = "selection";
      } else {
        this.selectedCharacterId = null;
        this.mode = "creation";
        this.selectedClassId = listClasses()[0]?.id ?? "warrior";
      }
      this.render();
    } catch (error) {
      const code =
        error instanceof AuthApiError ? error.code : "REQUEST_FAILED";
      const target = this.required("[data-delete-error]", HTMLElement);
      target.textContent =
        CREATE_ERROR_COPY[code] ?? "Nie udało się usunąć postaci.";
      target.hidden = false;
      input.disabled = false;
      button.textContent = "Usuń";
      button.disabled =
        normalizeComparableName(input.value) !==
        normalizeComparableName(character.name);
    }
  }

  private async logout(): Promise<void> {
    const button = this.required("[data-logout]", HTMLButtonElement);
    button.disabled = true;
    button.textContent = "Wylogowywanie…";
    try {
      await this.api.logout();
      window.location.reload();
    } catch {
      button.disabled = false;
      button.textContent = "Wyloguj";
    }
  }

  private showCreateError(message: string): void {
    const error = this.required("[data-create-error]", HTMLElement);
    error.textContent = message;
    error.hidden = false;
  }

  private hideCreateError(): void {
    const error = this.root.querySelector<HTMLElement>("[data-create-error]");
    if (!error) return;
    error.hidden = true;
    error.textContent = "";
  }

  private stopAnimation(): void {
    if (this.animationTimer === null) return;
    window.clearInterval(this.animationTimer);
    this.animationTimer = null;
  }

  private required<T extends Element>(
    selector: string,
    constructor?: { new (): T },
  ): T {
    const element = this.root.querySelector(selector);
    if (!element || (constructor && !(element instanceof constructor))) {
      throw new Error(`Brakuje elementu interfejsu: ${selector}`);
    }
    return element as T;
  }
}

function classSummary(cls: ClassDefinition): string {
  return `
    <p class="character-details__class-line">
      <strong>${escapeHtml(cls.name)}</strong>
      <span>${escapeHtml(cls.selection.role)} · ${escapeHtml(cls.selection.armor)}</span>
    </p>
    <p class="character-details__description">${escapeHtml(cls.description)}</p>`;
}

function statBars(cls: ClassDefinition): string {
  const stats = [
    ["Siła", cls.base.strength],
    ["Zręczność", cls.base.agility],
    ["Wytrzymałość", cls.base.stamina],
  ] as const;
  return `<div class="character-class-stats">${stats
    .map(
      ([label, value]) => `
        <div><span>${label}</span><i><b style="width:${Math.min(100, value * 5)}%"></b></i><em>${value}</em></div>`,
    )
    .join("")}</div>`;
}

function difficultyPips(value: number): string {
  return `${value}/3`;
}

function previewFrames(classId: string): string[] {
  if (classId === "knight") {
    return ["assets/players/leather-knight/knight-idle-down.png"];
  }
  return [1, 2, 3, 4].map(
    (frame) =>
      `assets/players/human-warrior-v2/warrior-idle-down-${frame}.png?v=6`,
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;",
      })[char]!,
  );
}

function normalizeComparableName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("pl-PL");
}
