import { CHARACTER_PANEL_CLOSE_MS } from "../config/constants";
import type { Inventory } from "../inventory/Inventory";
import { getItem } from "../items/catalog";
import {
  getProfession,
  listProfessions,
  professionXpForLevel,
  type ProfessionGatherNode,
  type ProfessionRecipe,
} from "../professions/catalog";
import type { ProfessionSnapshot } from "../network/GameNetwork";
import { makeDraggable } from "./makeDraggable";

type CraftHandler = (recipeId: string, quantity: number) => void;

interface CraftQueue {
  recipeId: string;
  recipeName: string;
  icon: string;
  craftTimeMs: number;
  total: number;
  completed: number;
  awaitingResult: boolean;
}

const CRAFT_RESULT_TIMEOUT_MS = 3500;
const CRAFT_STEP_PAUSE_MS = 140;
const CRAFT_COMPLETE_HOLD_MS = 700;
const MAX_CRAFT_QUEUE = 99;

/** Trade-profession journal with rank progress and server-backed crafting. */
export class ProfessionsPanel {
  private open = false;
  private closeTimer: number | null = null;
  private selectedProfessionId = "cooking";
  private selectedRecipeId: string | null = null;
  private professions: ProfessionSnapshot[] = [];
  private craftingAvailable = false;
  private readonly craftQuantities = new Map<string, number>();
  private craftQueue: CraftQueue | null = null;
  private craftAnimationFrame: number | null = null;
  private craftTimer: number | null = null;
  private readonly craftProgressEl: HTMLElement;
  private readonly craftIconEl: HTMLImageElement;
  private readonly craftNameEl: HTMLElement;
  private readonly craftStepEl: HTMLElement;
  private readonly craftFillEl: HTMLElement;
  private readonly craftTimeEl: HTMLElement;

  private constructor(
    private readonly root: HTMLElement,
    private readonly listEl: HTMLElement,
    private readonly detailEl: HTMLElement,
    private readonly progressEl: HTMLElement,
    private readonly rankEl: HTMLElement,
    private readonly inventory: Inventory,
    private readonly onCraft: CraftHandler,
  ) {
    this.craftProgressEl = root.querySelector("[data-craft-progress]")!;
    this.craftIconEl = root.querySelector("[data-craft-icon]")!;
    this.craftNameEl = root.querySelector("[data-craft-name]")!;
    this.craftStepEl = root.querySelector("[data-craft-step]")!;
    this.craftFillEl = root.querySelector("[data-craft-fill]")!;
    this.craftTimeEl = root.querySelector("[data-craft-time]")!;
    inventory.onChange(() => this.render());
  }

  static create(
    inventory: Inventory,
    onCraft: CraftHandler,
    host: HTMLElement = document.getElementById("ui-root")!,
  ): ProfessionsPanel {
    const root = document.createElement("aside");
    root.id = "professions-panel";
    root.className = "professions-panel";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("aria-label", "Profesje");
    root.innerHTML = `
      <div class="professions-panel__frame">
        <header class="professions-panel__header" data-header>
          <svg class="professions-panel__sigil" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m4 4 5-2 4 4-4 4-4-4z" />
            <path d="m10 10 2.8 2.8-7.2 7.2-2.8-2.8z" />
            <path d="M15.5 15.5h4.8l-1.6 1.8 1.6 1.8h-7.1z" />
          </svg>
          <h2 class="professions-panel__title">Profesje</h2>
          <button type="button" class="professions-panel__close" data-close aria-label="Zamknij">×</button>
        </header>
        <div class="professions-panel__body">
          <nav class="professions-panel__master" aria-label="Lista profesji">
            <h3 class="professions-panel__section-title">Zawody</h3>
            <div class="professions-panel__profession-list" data-profession-list></div>
            <div class="professions-panel__station">
              <span aria-hidden="true">⌖</span>
              <p><strong>Stanowisko</strong>Przepisy wykonasz przy palenisku obok kuźni.</p>
            </div>
          </nav>
          <section class="professions-panel__workspace">
            <header class="professions-panel__hero">
              <span class="professions-panel__hero-icon" data-active-icon aria-hidden="true">♨</span>
              <div class="professions-panel__hero-copy">
                <p class="professions-panel__eyebrow">Aktywna profesja</p>
                <h3 data-active-name>Gotowanie</h3>
                <p data-active-description></p>
              </div>
              <div class="professions-panel__rank">
                <strong data-rank>Ranga 1</strong>
                <span data-xp-label>0 / 30 PD</span>
                <div class="professions-panel__xp"><span data-progress></span></div>
              </div>
            </header>
            <div class="professions-panel__recipes-wrap">
              <section class="professions-panel__recipe-list-wrap">
                <h3 class="professions-panel__section-title">Przepisy</h3>
                <div class="professions-panel__recipes" data-list></div>
              </section>
              <section class="professions-panel__detail" data-detail aria-live="polite"></section>
            </div>
            <div class="professions-panel__craft-progress" data-craft-progress hidden role="progressbar" aria-label="Postęp przygotowywania" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <img data-craft-icon alt="" />
              <div class="professions-panel__craft-progress-body">
                <div class="professions-panel__craft-progress-copy">
                  <strong data-craft-name>Przygotowywanie</strong>
                  <span data-craft-step></span>
                </div>
                <div class="professions-panel__craft-progress-track">
                  <span data-craft-fill></span>
                  <em data-craft-time></em>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
    host.appendChild(root);
    const panel = new ProfessionsPanel(
      root,
      root.querySelector("[data-list]")!,
      root.querySelector("[data-detail]")!,
      root.querySelector("[data-progress]")!,
      root.querySelector("[data-rank]")!,
      inventory,
      onCraft,
    );
    root
      .querySelector("[data-close]")!
      .addEventListener("click", () => panel.close());
    makeDraggable(root, root.querySelector("[data-header]") as HTMLElement);
    panel.render();
    return panel;
  }

  get isOpen(): boolean {
    return this.open;
  }

  get isCrafting(): boolean {
    return this.craftQueue !== null;
  }

  setCraftingAvailable(available: boolean): void {
    if (this.craftingAvailable === available) return;
    this.craftingAvailable = available;
    this.render();
  }

  setProfessions(professions: ProfessionSnapshot[]): void {
    this.professions = professions;
    this.render();
  }

  /** Advances a queued craft only after the authoritative server accepts it. */
  handleCrafted(recipeId: string, quantity: number): void {
    const queue = this.craftQueue;
    if (!queue || !queue.awaitingResult || queue.recipeId !== recipeId) return;

    this.clearCraftTimer();
    queue.awaitingResult = false;
    queue.completed = Math.min(
      queue.total,
      queue.completed + Math.max(1, Math.floor(quantity)),
    );

    if (queue.completed >= queue.total) {
      this.finishCraftQueue();
      return;
    }

    this.craftTimer = window.setTimeout(
      () => this.runCraftStep(),
      CRAFT_STEP_PAUSE_MS,
    );
  }

  /** Stops the visual queue when the server rejects a crafting request. */
  cancelCraft(): void {
    if (!this.craftQueue) return;
    this.clearCraftTimers();
    this.craftQueue = null;
    this.root.classList.remove("is-crafting");
    this.craftProgressEl.hidden = true;
    this.render();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openPanel();
  }

  openPanel(): void {
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.closeTimer = null;
    this.open = true;
    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    void this.root.offsetWidth;
    this.root.classList.add("is-open");
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.cancelCraft();
    this.open = false;
    this.root.classList.remove("is-open");
    this.root.setAttribute("aria-hidden", "true");
    this.closeTimer = window.setTimeout(() => {
      this.root.hidden = true;
      this.closeTimer = null;
    }, CHARACTER_PANEL_CLOSE_MS);
  }

  private state(professionId: string): ProfessionSnapshot {
    return (
      this.professions.find((entry) => entry.professionId === professionId) ?? {
        professionId,
        level: 1,
        experience: 0,
        experienceToLevel: 0,
      }
    );
  }

  private render(): void {
    const definitions = listProfessions();
    if (
      !definitions.some(
        (profession) => profession.id === this.selectedProfessionId,
      )
    ) {
      this.selectedProfessionId = definitions[0]?.id ?? "cooking";
    }
    const profession = getProfession(this.selectedProfessionId);
    const state = this.state(profession.id);
    const needed =
      state.experienceToLevel || professionXpForLevel(profession, state.level);
    const pct = needed ? Math.min(100, (state.experience / needed) * 100) : 100;
    this.rankEl.textContent =
      state.level >= profession.maxLevel
        ? "Mistrz profesji"
        : `Ranga ${state.level}`;
    this.progressEl.style.width = `${pct}%`;
    this.progressEl.title = needed
      ? `${state.experience} / ${needed} PD`
      : "Maksymalny poziom";
    this.root.querySelector("[data-active-icon]")!.textContent =
      profession.icon;
    this.root.querySelector("[data-active-name]")!.textContent =
      profession.name;
    this.root.querySelector("[data-active-description]")!.textContent =
      profession.description;
    this.root.querySelector("[data-xp-label]")!.textContent = needed
      ? `${state.experience} / ${needed} PD do rangi ${state.level + 1}`
      : `${profession.maxLevel} / ${profession.maxLevel} · maksimum`;

    const professionList = this.root.querySelector<HTMLElement>(
      "[data-profession-list]",
    )!;
    professionList.replaceChildren(
      ...definitions.map((definition) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "professions-panel__profession";
        if (definition.id === profession.id) button.classList.add("is-active");
        button.innerHTML = `<span class="professions-panel__profession-icon" aria-hidden="true">${definition.icon}</span><span>${escapeHtml(definition.name)}</span>`;
        button.addEventListener("click", () => {
          this.selectedProfessionId = definition.id;
          this.selectedRecipeId = null;
          this.render();
        });
        return button;
      }),
    );

    if (
      !this.selectedRecipeId ||
      (!profession.recipes.some(
        (recipe) => recipe.id === this.selectedRecipeId,
      ) &&
        !profession.nodes.some((node) => node.id === this.selectedRecipeId))
    ) {
      this.selectedRecipeId =
        profession.recipes[0]?.id ?? profession.nodes[0]?.id ?? null;
    }

    if (profession.recipes.length === 0 && profession.nodes.length > 0) {
      this.listEl.replaceChildren(
        ...profession.nodes.map((node) => this.nodeRow(node, state.level)),
      );
      const selectedNode =
        profession.nodes.find((node) => node.id === this.selectedRecipeId) ??
        profession.nodes[0]!;
      this.selectedRecipeId = selectedNode.id;
      this.renderNodeDetail(selectedNode, state.level, profession.name);
      return;
    }

    this.listEl.replaceChildren(
      ...profession.recipes.map((recipe) =>
        this.recipeRow(recipe, state.level),
      ),
    );
    const selected = profession.recipes.find(
      (recipe) => recipe.id === this.selectedRecipeId,
    );
    if (selected) this.renderDetail(selected, state.level);
    else this.detailEl.textContent = "Brak znanych przepisów.";
  }

  private nodeRow(node: ProfessionGatherNode, level: number): HTMLElement {
    const output = getItem(node.output.itemId);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "professions-panel__recipe";
    const locked = level < node.level;
    if (locked) row.classList.add("is-locked");
    if (node.id === this.selectedRecipeId) row.classList.add("is-active");
    const tone = recipeTone(level, node.level);
    row.dataset.tone = tone;
    const qty =
      node.output.quantityMin === node.output.quantityMax
        ? `${node.output.quantityMin}`
        : `${node.output.quantityMin}–${node.output.quantityMax}`;
    row.innerHTML = `<img src="/${output.icon}" alt="" /><span><strong>${escapeHtml(node.name)}</strong><small><i aria-hidden="true"></i>Poziom ${node.level} <b>+${node.xp} PD</b> · ×${qty}</small></span>`;
    row.addEventListener("click", () => {
      this.selectedRecipeId = node.id;
      this.render();
    });
    return row;
  }

  private renderNodeDetail(
    node: ProfessionGatherNode,
    level: number,
    professionName: string,
  ): void {
    const output = getItem(node.output.itemId);
    const missingLevel = level < node.level;
    const qty =
      node.output.quantityMin === node.output.quantityMax
        ? `×${node.output.quantityMin}`
        : `×${node.output.quantityMin}–${node.output.quantityMax}`;
    this.detailEl.innerHTML = `
      <div class="professions-panel__detail-head"><p class="professions-panel__eyebrow">Węzeł wydobycia</p><h3>${escapeHtml(node.name)}</h3><p>${escapeHtml(node.description || "Szukaj tej żyły w świecie i użyj kilofa.")}</p></div>
      <div class="professions-panel__output"><span>Łup</span><b>${escapeHtml(output.name)} ${qty}</b><em>+${node.xp} PD</em></div>
      <h4>Wymagania</h4>
      <ul><li>Kilof w ekwipunku lub dłoni</li><li>Podejdź do żyły i naciśnij <b>E</b> albo kliknij skałę</li></ul>
      ${missingLevel ? `<p class="professions-panel__locked">Wymaga ${node.level}. poziomu ${escapeHtml(professionName)}.</p>` : `<p class="professions-panel__locked">Wydobywanie odbywa się w świecie — nie z tego okna.</p>`}
    `;
  }

  private recipeRow(recipe: ProfessionRecipe, level: number): HTMLElement {
    const output = getItem(recipe.output.itemId);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "professions-panel__recipe";
    const locked = level < recipe.level;
    if (locked) row.classList.add("is-locked");
    if (recipe.id === this.selectedRecipeId) row.classList.add("is-active");
    const tone = recipeTone(level, recipe.level);
    row.dataset.tone = tone;
    row.innerHTML = `<img src="/${output.icon}" alt="" /><span><strong>${escapeHtml(recipe.name)}</strong><small><i aria-hidden="true"></i>Poziom ${recipe.level} <b>+${recipe.xp} PD</b></small></span>`;
    row.addEventListener("click", () => {
      this.selectedRecipeId = recipe.id;
      this.render();
    });
    return row;
  }

  private renderDetail(recipe: ProfessionRecipe, level: number): void {
    const output = getItem(recipe.output.itemId);
    const missingLevel = level < recipe.level;
    const ingredients = recipe.ingredients
      .map((ingredient, index) => {
        const item = getItem(ingredient.itemId);
        const count = this.count(ingredient.itemId);
        const ready = count >= ingredient.quantity;
        return `<li class="${ready ? "" : "is-missing"}" data-ingredient="${index}"><img src="/${item.icon}" alt="" />${escapeHtml(item.name)} <b>${count}/${ingredient.quantity}</b></li>`;
      })
      .join("");
    const maxCraftable = Math.min(
      MAX_CRAFT_QUEUE,
      ...recipe.ingredients.map((ingredient) =>
        Math.floor(this.count(ingredient.itemId) / ingredient.quantity),
      ),
    );
    const quantity = Math.min(
      Math.max(1, this.craftQuantities.get(recipe.id) ?? 1),
      Math.max(1, maxCraftable),
    );
    this.craftQuantities.set(recipe.id, quantity);
    const canCraft =
      !this.craftQueue &&
      this.craftingAvailable &&
      !missingLevel &&
      maxCraftable > 0;
    this.detailEl.innerHTML = `
      <div class="professions-panel__detail-head"><p class="professions-panel__eyebrow">Wybrany przepis</p><h3>${escapeHtml(recipe.name)}</h3><p>${escapeHtml(recipe.description)}</p></div>
      <div class="professions-panel__output"><span>Rezultat</span><b>${escapeHtml(output.name)} ×${recipe.output.quantity}</b><em>+${recipe.xp} PD</em></div>
      <h4>Składniki</h4><ul>${ingredients}</ul>
      ${missingLevel ? `<p class="professions-panel__locked">Wymaga ${recipe.level}. poziomu Gotowania.</p>` : ""}
      <div class="professions-panel__craft-actions">
        <div class="professions-panel__quantity" aria-label="Liczba posiłków">
          <button type="button" data-quantity-step="-1" aria-label="Zmniejsz ilość" ${maxCraftable > 0 && !this.craftQueue ? "" : "disabled"}>−</button>
          <label><span>Ilość</span><input type="number" data-quantity min="1" max="${Math.max(1, maxCraftable)}" value="${quantity}" inputmode="numeric" ${maxCraftable > 0 && !this.craftQueue ? "" : "disabled"} /></label>
          <button type="button" data-quantity-step="1" aria-label="Zwiększ ilość" ${maxCraftable > 0 && !this.craftQueue ? "" : "disabled"}>+</button>
          <button type="button" class="professions-panel__quantity-max" data-quantity-max ${maxCraftable > 0 && !this.craftQueue ? "" : "disabled"}>Maks.</button>
        </div>
        <button type="button" class="professions-panel__craft-submit" data-craft ${canCraft ? "" : "disabled"}>${quantity === 1 ? "Przygotuj" : `Przygotuj ×${quantity}`}</button>
      </div>
    `;
    const input =
      this.detailEl.querySelector<HTMLInputElement>("[data-quantity]")!;
    const craftButton =
      this.detailEl.querySelector<HTMLButtonElement>("[data-craft]")!;
    const syncQuantity = (requested: number): void => {
      const next = Math.min(
        Math.max(1, Math.floor(Number.isFinite(requested) ? requested : 1)),
        Math.max(1, maxCraftable),
      );
      this.craftQuantities.set(recipe.id, next);
      input.value = String(next);
      craftButton.textContent = next === 1 ? "Przygotuj" : `Przygotuj ×${next}`;
      recipe.ingredients.forEach((ingredient, index) => {
        const row = this.detailEl.querySelector<HTMLElement>(
          `[data-ingredient="${index}"]`,
        );
        if (!row) return;
        const owned = this.count(ingredient.itemId);
        const required = ingredient.quantity * next;
        row.classList.toggle("is-missing", owned < required);
        row.querySelector("b")!.textContent = `${owned}/${required}`;
      });
    };

    input.addEventListener("input", () => syncQuantity(input.valueAsNumber));
    this.detailEl
      .querySelectorAll<HTMLButtonElement>("[data-quantity-step]")
      .forEach((button) => {
        button.addEventListener("click", () =>
          syncQuantity(
            Number(input.value) + Number(button.dataset.quantityStep),
          ),
        );
      });
    this.detailEl
      .querySelector<HTMLButtonElement>("[data-quantity-max]")!
      .addEventListener("click", () => syncQuantity(maxCraftable));
    craftButton.addEventListener("click", () =>
      this.startCraft(recipe, Number(input.value)),
    );
    syncQuantity(quantity);
  }

  private startCraft(recipe: ProfessionRecipe, quantity: number): void {
    if (this.craftQueue || !this.craftingAvailable) return;

    this.craftQueue = {
      recipeId: recipe.id,
      recipeName: recipe.name,
      icon: getItem(recipe.output.itemId).icon,
      craftTimeMs: recipe.craftTimeMs,
      total: Math.max(1, Math.floor(quantity)),
      completed: 0,
      awaitingResult: false,
    };
    this.root.classList.add("is-crafting");
    this.craftProgressEl.hidden = false;
    this.craftIconEl.src = `/${this.craftQueue.icon}`;
    this.render();
    this.runCraftStep();
  }

  private runCraftStep(): void {
    const queue = this.craftQueue;
    if (!queue) return;

    this.clearCraftTimer();
    queue.awaitingResult = false;
    this.craftProgressEl.classList.remove("is-complete");
    this.craftNameEl.textContent = queue.recipeName;
    this.craftStepEl.textContent =
      queue.total > 1
        ? `${queue.completed + 1} z ${queue.total}`
        : "Przygotowywanie";
    this.setCraftProgress(0, queue.craftTimeMs);

    const startedAt = performance.now();
    const animate = (now: number): void => {
      if (this.craftQueue !== queue) return;
      if (!this.craftingAvailable) {
        this.cancelCraft();
        return;
      }
      const elapsed = Math.max(0, now - startedAt);
      const progress = Math.min(1, elapsed / queue.craftTimeMs);
      this.setCraftProgress(progress, Math.max(0, queue.craftTimeMs - elapsed));

      if (progress < 1) {
        this.craftAnimationFrame = window.requestAnimationFrame(animate);
        return;
      }

      this.craftAnimationFrame = null;
      queue.awaitingResult = true;
      this.craftStepEl.textContent = "Finalizowanie…";
      this.onCraft(queue.recipeId, 1);
      this.craftTimer = window.setTimeout(
        () => this.cancelCraft(),
        CRAFT_RESULT_TIMEOUT_MS,
      );
    };

    this.craftAnimationFrame = window.requestAnimationFrame(animate);
  }

  private finishCraftQueue(): void {
    const queue = this.craftQueue;
    if (!queue) return;

    this.clearCraftTimers();
    this.craftProgressEl.classList.add("is-complete");
    this.craftNameEl.textContent = `${queue.recipeName} — gotowe`;
    this.craftStepEl.textContent =
      queue.total > 1 ? `Wykonano ${queue.total}` : "Ukończono";
    this.setCraftProgress(1, 0);
    this.craftTimer = window.setTimeout(() => {
      this.craftTimer = null;
      this.craftQueue = null;
      this.root.classList.remove("is-crafting");
      this.craftProgressEl.classList.remove("is-complete");
      this.craftProgressEl.hidden = true;
      this.render();
    }, CRAFT_COMPLETE_HOLD_MS);
  }

  private setCraftProgress(progress: number, remainingMs: number): void {
    const percentage = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    this.craftFillEl.style.width = `${percentage}%`;
    this.craftTimeEl.textContent = `${(remainingMs / 1000).toFixed(1)} s`;
    this.craftProgressEl.setAttribute("aria-valuenow", String(percentage));
  }

  private clearCraftTimer(): void {
    if (this.craftTimer !== null) window.clearTimeout(this.craftTimer);
    this.craftTimer = null;
  }

  private clearCraftTimers(): void {
    this.clearCraftTimer();
    if (this.craftAnimationFrame !== null) {
      window.cancelAnimationFrame(this.craftAnimationFrame);
      this.craftAnimationFrame = null;
    }
  }

  private count(itemId: string): number {
    return this.inventory
      .getSlots()
      .reduce(
        (total, slot) => total + (slot.itemId === itemId ? slot.quantity : 0),
        0,
      );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Familiar MMO recipe coloring: locked → red, current → orange, easy → green/grey. */
function recipeTone(level: number, requiredLevel: number): string {
  if (level < requiredLevel) return "locked";
  if (level < requiredLevel + 5) return "current";
  if (level < requiredLevel + 15) return "easy";
  return "trivial";
}
