/**
 * Persistent HUD chip while the player has free attribute points to spend.
 * Click opens the character panel (same as C).
 */
export class AttrPointsHint {
  private points = 0;

  private constructor(
    private readonly root: HTMLButtonElement,
    private readonly countEl: HTMLElement,
    private readonly onOpen: () => void,
  ) {
    root.addEventListener("click", () => this.onOpen());
  }

  static create(
    onOpen: () => void,
    host: HTMLElement = document.getElementById("ui-root")!,
  ): AttrPointsHint {
    const root = document.createElement("button");
    root.type = "button";
    root.id = "attr-points-hint";
    root.className = "attr-points-hint";
    root.hidden = true;
    root.setAttribute("aria-label", "Rozdaj punkty atrybutów");
    root.innerHTML = `
      <span class="attr-points-hint__gem" aria-hidden="true"></span>
      <span class="attr-points-hint__copy">
        <strong class="attr-points-hint__count" data-count>0</strong>
        <span class="attr-points-hint__label">pkt atrybutów</span>
      </span>
      <kbd class="attr-points-hint__key">C</kbd>
    `;
    host.appendChild(root);

    return new AttrPointsHint(
      root,
      root.querySelector("[data-count]")!,
      onOpen,
    );
  }

  setPoints(points: number): void {
    const next = Math.max(0, Math.floor(points));
    if (next === this.points) return;

    const grew = next > this.points;
    this.points = next;

    if (next <= 0) {
      this.root.hidden = true;
      this.root.classList.remove("is-visible", "is-pulse");
      return;
    }

    this.countEl.textContent = String(next);
    this.root.hidden = false;
    this.root.setAttribute(
      "aria-label",
      `Rozdaj ${next} ${polishPoints(next)} atrybutów (C)`,
    );
    this.root.classList.add("is-visible");

    if (grew) {
      this.root.classList.remove("is-pulse");
      void this.root.offsetWidth;
      this.root.classList.add("is-pulse");
    }
  }
}

function polishPoints(n: number): string {
  if (n === 1) return "punkt";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return "punkty";
  }
  return "punktów";
}
