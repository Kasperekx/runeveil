import { CHARACTER_PANEL_CLOSE_MS } from "../config/constants";
import type { QuestSnapshot } from "../network/GameNetwork";
import {
  getQuest,
  hasQuest,
  listQuests,
  type QuestDefinition,
} from "../quests/catalog";
import { makeDraggable } from "./makeDraggable";

const TRACKER_COLLAPSED_KEY = "mmo.questTrackerCollapsed";

/** Quest journal plus a small, optional tracked-objective HUD. */
export class QuestLog {
  private open = false;
  private closeTimer: number | null = null;
  private quests: QuestSnapshot[] = [];
  private selectedQuestId: string | null = null;
  private readonly trackedQuestIds = new Set<string>();
  private knownTrackableQuestIds = new Set<string>();
  private trackerCollapsed = loadTrackerCollapsed();
  private actions: {
    onAccept?: (questId: string) => void;
    onClaim?: (questId: string) => void;
  } = {};
  private readonly listEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly trackerRoot: HTMLElement;

  private constructor(
    private readonly root: HTMLElement,
    host: HTMLElement,
  ) {
    this.listEl = root.querySelector("[data-quest-list]")!;
    this.detailEl = root.querySelector("[data-quest-detail]")!;

    this.trackerRoot = document.createElement("section");
    this.trackerRoot.id = "quest-tracker";
    this.trackerRoot.className = "quest-tracker";
    this.trackerRoot.setAttribute("aria-live", "polite");
    this.trackerRoot.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest("[data-tracker-toggle]")) return;
      this.trackerCollapsed = !this.trackerCollapsed;
      saveTrackerCollapsed(this.trackerCollapsed);
      this.renderTracker();
    });
    host.appendChild(this.trackerRoot);
  }

  static create(
    host: HTMLElement = document.getElementById("ui-root")!,
  ): QuestLog {
    const root = document.createElement("aside");
    root.id = "quest-log";
    root.className = "quest-log";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("aria-label", "Dziennik zadań");
    root.innerHTML = `
      <div class="quest-log__frame">
        <header class="quest-log__header" data-header>
          <span class="quest-log__sigil" aria-hidden="true">✦</span>
          <h2>Dziennik zadań</h2>
          <button type="button" class="quest-log__close" data-close aria-label="Zamknij">×</button>
        </header>
        <div class="quest-log__body">
          <section class="quest-log__list-wrap">
            <div class="quest-log__heading"><span>Aktywne zadania</span><b data-quest-count>0</b></div>
            <div class="quest-log__list" data-quest-list></div>
          </section>
          <section class="quest-log__detail" data-quest-detail aria-live="polite"></section>
        </div>
      </div>
    `;
    host.appendChild(root);

    const log = new QuestLog(root, host);
    root
      .querySelector("[data-close]")!
      .addEventListener("click", () => log.close());
    makeDraggable(root, root.querySelector("[data-header]") as HTMLElement);
    log.render();
    return log;
  }

  get isOpen(): boolean {
    return this.open;
  }

  bindActions(actions: {
    onAccept?: (questId: string) => void;
    onClaim?: (questId: string) => void;
  }): void {
    this.actions = actions;
  }

  setQuests(quests: QuestSnapshot[]): void {
    this.quests = quests.filter((quest) => hasQuest(quest.questId));
    const trackable = this.quests.filter(
      (quest) => quest.status === "active" || quest.status === "ready_to_claim",
    );
    const nextTrackableIds = new Set(trackable.map((quest) => quest.questId));
    for (const questId of nextTrackableIds) {
      if (!this.knownTrackableQuestIds.has(questId)) {
        this.trackedQuestIds.add(questId);
      }
    }
    for (const questId of this.trackedQuestIds) {
      if (!nextTrackableIds.has(questId)) this.trackedQuestIds.delete(questId);
    }
    this.knownTrackableQuestIds = nextTrackableIds;
    const views = this.questViews();
    if (
      !this.selectedQuestId ||
      !views.some((q) => q.questId === this.selectedQuestId)
    ) {
      this.selectedQuestId = trackable[0]?.questId ?? views[0]?.questId ?? null;
    }
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
    this.open = false;
    this.root.classList.remove("is-open");
    this.root.setAttribute("aria-hidden", "true");
    this.closeTimer = window.setTimeout(() => {
      this.root.hidden = true;
      this.closeTimer = null;
    }, CHARACTER_PANEL_CLOSE_MS);
  }

  private render(): void {
    const views = this.questViews();
    const activeCount = views.filter(
      (quest) => quest.status === "active",
    ).length;
    this.root.querySelector("[data-quest-count]")!.textContent =
      String(activeCount);

    const sorted = [...views].sort(
      (left, right) =>
        questStatusRank(left.status) - questStatusRank(right.status) ||
        left.questId.localeCompare(right.questId),
    );
    this.listEl.replaceChildren(...sorted.map((state) => this.questRow(state)));

    const selected = views.find(
      (quest) => quest.questId === this.selectedQuestId,
    );
    if (selected) this.renderDetail(selected);
    else {
      this.detailEl.innerHTML = `<p class="quest-log__empty">Nie masz jeszcze żadnych zadań. Wyrusz na szlak, aby znaleźć pierwsze tropy.</p>`;
    }
    this.renderTracker();
  }

  private questRow(state: QuestSnapshot): HTMLButtonElement {
    const quest = getQuest(state.questId);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quest-log__row";
    if (state.status === "completed") button.classList.add("is-completed");
    if (state.status === "ready_to_claim") button.classList.add("is-ready");
    if (state.status === "available") button.classList.add("is-available");
    if (state.questId === this.selectedQuestId)
      button.classList.add("is-active");
    const progress = progressFor(state, quest);
    const mark =
      state.status === "completed"
        ? "✓"
        : state.status === "ready_to_claim"
          ? "!"
          : state.status === "available"
            ? "+"
            : "◆";
    button.innerHTML = `<span class="quest-log__row-mark" aria-hidden="true">${mark}</span><span><strong>${escapeHtml(quest.name)}</strong><small>${escapeHtml(quest.category)} · ${questStatusLabel(state.status)} · ${progress.current}/${progress.total}</small></span>`;
    button.addEventListener("click", () => {
      this.selectedQuestId = state.questId;
      this.render();
    });
    return button;
  }

  private renderDetail(state: QuestSnapshot): void {
    const quest = getQuest(state.questId);
    const progress = progressFor(state, quest);
    const complete = state.status === "completed";
    const ready = state.status === "ready_to_claim";
    const available = state.status === "available";
    const tracked = this.trackedQuestIds.has(state.questId);
    const percentage = Math.round((progress.current / progress.total) * 100);

    this.detailEl.innerHTML = `
      <p class="quest-log__eyebrow">${escapeHtml(quest.category)} · ${questStatusLabel(state.status)}</p>
      <h3>${escapeHtml(quest.name)}</h3>
      <p class="quest-log__giver">Zleceniodawca: <b>${escapeHtml(quest.giver)}</b></p>
      <p class="quest-log__description">${escapeHtml(quest.description)}</p>
      <section class="quest-log__objective ${complete || ready ? "is-complete" : ""}">
        <div><span>${escapeHtml(quest.objective.label)}</span><b>${progress.current}/${progress.total}</b></div>
        <div class="quest-log__progress"><span style="width:${percentage}%"></span></div>
      </section>
      <section class="quest-log__rewards"><h4>Nagrody</h4><span>◈ ${quest.rewards.gold} złota</span><span>✦ ${quest.rewards.experience} PD</span></section>
      ${
        complete
          ? `<p class="quest-log__complete">Nagrody zostały odebrane.</p>`
          : ready
            ? `<p class="quest-log__turn-in">${escapeHtml(quest.turnIn.label)}</p><button type="button" class="quest-log__track quest-log__claim" data-claim>Odbierz nagrodę</button>`
            : available
              ? `<p class="quest-log__turn-in">Porozmawiaj ze zleceniodawcą: ${escapeHtml(quest.giver)}.</p><button type="button" class="quest-log__track" data-accept>Przyjmij zadanie</button>`
              : `<button type="button" class="quest-log__track" data-track>${tracked ? "Przestań śledzić" : "Śledź zadanie"}</button>`
      }
    `;
    this.detailEl
      .querySelector<HTMLButtonElement>("[data-track]")
      ?.addEventListener("click", () => {
        if (tracked) this.trackedQuestIds.delete(state.questId);
        else this.trackedQuestIds.add(state.questId);
        this.render();
      });
    this.detailEl
      .querySelector<HTMLButtonElement>("[data-accept]")
      ?.addEventListener("click", () => this.actions.onAccept?.(state.questId));
    this.detailEl
      .querySelector<HTMLButtonElement>("[data-claim]")
      ?.addEventListener("click", () => this.actions.onClaim?.(state.questId));
  }

  private questViews(): QuestSnapshot[] {
    const completed = new Set(
      this.quests
        .filter((quest) => quest.status === "completed")
        .map((quest) => quest.questId),
    );
    const accepted = new Set(this.quests.map((quest) => quest.questId));
    const available = listQuests()
      .filter(
        (quest) =>
          !quest.autoStart &&
          !accepted.has(quest.id) &&
          (!quest.prerequisite || completed.has(quest.prerequisite)),
      )
      .map<QuestSnapshot>((quest) => ({
        questId: quest.id,
        status: "available",
        progress: 0,
      }));
    return [...this.quests, ...available];
  }

  private renderTracker(): void {
    const tracked = this.quests.filter(
      (quest) =>
        this.trackedQuestIds.has(quest.questId) &&
        (quest.status === "active" || quest.status === "ready_to_claim"),
    );
    this.trackerRoot.classList.toggle("is-collapsed", this.trackerCollapsed);
    this.trackerRoot.innerHTML = `
      <header class="quest-tracker__header">
        <span aria-hidden="true">✦</span>
        <p>Zadania</p>
        <b>${tracked.length}</b>
        <button type="button" data-tracker-toggle aria-label="${this.trackerCollapsed ? "Rozwiń tracker zadań" : "Zwiń tracker zadań"}" aria-expanded="${!this.trackerCollapsed}">${this.trackerCollapsed ? "+" : "−"}</button>
      </header>
      <div class="quest-tracker__body">
        ${tracked.length > 0 ? tracked.map((state) => trackerQuestHtml(state)).join("") : `<p class="quest-tracker__empty">Brak śledzonych zadań</p>`}
      </div>
    `;
  }
}

function trackerQuestHtml(state: QuestSnapshot): string {
  const quest = getQuest(state.questId);
  const progress = progressFor(state, quest);
  const ready = state.status === "ready_to_claim";
  return `
    <article class="quest-tracker__quest">
      <strong>${escapeHtml(quest.name)}</strong>
      <div class="quest-tracker__objective ${ready ? "is-complete" : ""}">
        <i aria-hidden="true"></i>
        <span>${escapeHtml(quest.objective.label)}</span>
        <b>${ready ? "✓" : `${progress.current} / ${progress.total}`}</b>
      </div>
      ${ready ? `<p class="quest-tracker__status"><span>Ukończono</span>${escapeHtml(quest.turnIn.label)}</p>` : ""}
    </article>
  `;
}

function loadTrackerCollapsed(): boolean {
  try {
    return window.localStorage.getItem(TRACKER_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveTrackerCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(TRACKER_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage can be unavailable in privacy modes; collapsing still works.
  }
}

function questStatusRank(status: QuestSnapshot["status"]): number {
  return { active: 0, ready_to_claim: 1, available: 2, completed: 3 }[status];
}

function questStatusLabel(status: QuestSnapshot["status"]): string {
  return {
    active: "w toku",
    ready_to_claim: "gotowe do oddania",
    available: "dostępne",
    completed: "ukończone",
  }[status];
}

function progressFor(
  state: QuestSnapshot,
  quest: QuestDefinition,
): { current: number; total: number } {
  const total = quest.objective.quantity;
  return { current: Math.min(total, Math.max(0, state.progress)), total };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
