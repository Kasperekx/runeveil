import { CHARACTER_PANEL_CLOSE_MS, DRAG_SKILL_MIME } from "../config/constants";
import { getClassName } from "../classes/catalog";
import {
  listSkillsForClass,
  skillDamageRange,
  type SkillConfig,
  type SkillId,
} from "../skills/catalog";
import { makeDraggable } from "./makeDraggable";

export interface SkillsPanelStats {
  classId: string;
  strength: number;
  weaponDamageMin: number;
  weaponDamageMax: number;
}

/**
 * Warrior (and future class) spellbook — brass frame matching character chrome.
 * Drag a skill onto the action bar to bind it.
 */
export class SkillsPanel {
  private open = false;
  private closeTimer: number | null = null;
  private stats: SkillsPanelStats = {
    classId: "warrior",
    strength: 0,
    weaponDamageMin: 0,
    weaponDamageMax: 0,
  };
  private selectedId: SkillId | null = null;

  private constructor(
    private readonly root: HTMLElement,
    private readonly listEl: HTMLElement,
    private readonly detailEl: HTMLElement,
    private readonly classEl: HTMLElement,
  ) {}

  static create(
    host: HTMLElement = document.getElementById("ui-root")!,
  ): SkillsPanel {
    const root = document.createElement("aside");
    root.id = "skills-panel";
    root.className = "skills-panel";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("aria-label", "Umiejętności");
    root.innerHTML = `
      <div class="skills-panel__frame">
        <div class="skills-panel__ornament skills-panel__ornament--tl" aria-hidden="true"></div>
        <div class="skills-panel__ornament skills-panel__ornament--tr" aria-hidden="true"></div>
        <div class="skills-panel__ornament skills-panel__ornament--bl" aria-hidden="true"></div>
        <div class="skills-panel__ornament skills-panel__ornament--br" aria-hidden="true"></div>
        <header class="skills-panel__header" data-header>
          <span class="skills-panel__sigil" aria-hidden="true">ᚱ</span>
          <h2 class="skills-panel__title">Umiejętności</h2>
          <button type="button" class="skills-panel__close" data-close aria-label="Zamknij">×</button>
        </header>
        <div class="skills-panel__body">
          <div class="skills-panel__list-wrap">
            <h3 class="skills-panel__section-title">Księga</h3>
            <p class="skills-panel__class" data-class></p>
            <div class="skills-panel__list" data-list role="listbox" aria-label="Lista umiejętności"></div>
          </div>
          <div class="skills-panel__detail-wrap">
            <h3 class="skills-panel__section-title">Szczegóły</h3>
            <div class="skills-panel__detail" data-detail>
              <p class="skills-panel__empty">Wybierz umiejętność.</p>
            </div>
          </div>
        </div>
        <p class="skills-panel__hint">Przeciągnij umiejętność na pasek akcji, aby ją przypisać.</p>
      </div>
    `;
    host.appendChild(root);

    const panel = new SkillsPanel(
      root,
      root.querySelector("[data-list]")!,
      root.querySelector("[data-detail]")!,
      root.querySelector("[data-class]")!,
    );

    root.querySelector("[data-close]")!.addEventListener("click", () => {
      panel.close();
    });
    makeDraggable(root, root.querySelector("[data-header]") as HTMLElement);
    panel.render();
    return panel;
  }

  get isOpen(): boolean {
    return this.open;
  }

  setStats(stats: SkillsPanelStats): void {
    this.stats = stats;
    this.render();
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
    const skills = listSkillsForClass(this.stats.classId);
    this.classEl.textContent = getClassName(this.stats.classId);

    if (
      this.selectedId &&
      !skills.some((skill) => skill.id === this.selectedId)
    ) {
      this.selectedId = null;
    }
    if (!this.selectedId && skills[0]) {
      this.selectedId = skills[0].id;
    }

    this.listEl.replaceChildren();
    if (skills.length === 0) {
      const empty = document.createElement("p");
      empty.className = "skills-panel__list-empty";
      empty.textContent = "Brak umiejętności dla tej klasy.";
      this.listEl.appendChild(empty);
      this.detailEl.innerHTML = `<p class="skills-panel__empty">Ta klasa nie zna jeszcze żadnych sztuk walki.</p>`;
      return;
    }

    for (const skill of skills) {
      this.listEl.appendChild(this.buildRow(skill));
    }

    const selected =
      skills.find((skill) => skill.id === this.selectedId) ?? skills[0];
    this.renderDetail(selected);
  }

  private buildRow(skill: SkillConfig): HTMLElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "skills-panel__row";
    row.setAttribute("role", "option");
    row.draggable = true;
    if (skill.id === this.selectedId) {
      row.classList.add("skills-panel__row--active");
      row.setAttribute("aria-selected", "true");
    } else {
      row.setAttribute("aria-selected", "false");
    }

    row.innerHTML = `
      <span class="skills-panel__row-icon-wrap">
        <img class="skills-panel__row-icon" src="/${skill.icon}" alt="" draggable="false" />
      </span>
      <span class="skills-panel__row-text">
        <span class="skills-panel__row-name">${escapeHtml(skill.name)}</span>
        <span class="skills-panel__row-meta">Ranga ${skill.rank} · ${escapeHtml(skill.schoolLabel)}</span>
      </span>
    `;

    row.addEventListener("click", () => {
      this.selectedId = skill.id;
      this.render();
    });

    row.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(DRAG_SKILL_MIME, skill.id);
      event.dataTransfer.setData("text/plain", skill.id);
      row.classList.add("skills-panel__row--dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("skills-panel__row--dragging");
    });

    return row;
  }

  private renderDetail(skill: SkillConfig): void {
    const range = skillDamageRange(
      skill,
      this.stats.strength,
      this.stats.weaponDamageMin,
      this.stats.weaponDamageMax,
    );
    const weaponLabel =
      this.stats.weaponDamageMin === this.stats.weaponDamageMax
        ? `+${this.stats.weaponDamageMin}`
        : `${this.stats.weaponDamageMin}–${this.stats.weaponDamageMax}`;

    this.detailEl.innerHTML = `
      <div class="skills-panel__detail-hero">
        <img class="skills-panel__detail-icon" src="/${skill.icon}" alt="" />
        <div>
          <h3 class="skills-panel__detail-name">${escapeHtml(skill.name)}</h3>
          <p class="skills-panel__detail-tags">
            <span>${escapeHtml(skill.schoolLabel)}</span>
            <span>Ranga ${skill.rank}</span>
            <span>${(skill.cooldownMs / 1000).toFixed(0)} s odnowienia</span>
            ${skill.requiresTarget ? "<span>Wymaga celu</span>" : ""}
          </p>
        </div>
      </div>
      <p class="skills-panel__detail-desc">${escapeHtml(skill.description)}</p>


      <p class="skills-panel__power">
        Szacowane obrażenia:
        <strong>${range.min}–${range.max}</strong>
        <span class="skills-panel__power-sub">
          (Siła ${this.stats.strength} · Broń ${weaponLabel})
        </span>
      </p>
    `;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
