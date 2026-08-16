const STORAGE_KEY = "mmo.settings";

export interface GameSettings {
  /** HUD zoom factor; 1 = author size. */
  uiScale: number;
  /** Floating combat text on hits. */
  showDamageNumbers: boolean;
}

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.4;

const DEFAULTS: GameSettings = {
  uiScale: 1,
  showDamageNumbers: true,
};

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULTS.uiScale;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
}

/**
 * Player-facing display options, persisted locally.
 *
 * Kept out of the server schema on purpose: these describe this browser, not
 * the character, so they should not follow the account to another machine.
 */
export class Settings {
  private values: GameSettings = { ...DEFAULTS };
  private readonly listeners = new Set<(values: GameSettings) => void>();

  constructor(private readonly host: HTMLElement) {
    this.load();
    this.applyToDom();
  }

  get current(): Readonly<GameSettings> {
    return this.values;
  }

  set(patch: Partial<GameSettings>): void {
    const next: GameSettings = { ...this.values, ...patch };
    next.uiScale = clampScale(next.uiScale);

    if (
      next.uiScale === this.values.uiScale &&
      next.showDamageNumbers === this.values.showDamageNumbers
    ) {
      return;
    }

    this.values = next;
    this.applyToDom();
    this.save();
    for (const listener of this.listeners) listener(this.values);
  }

  onChange(listener: (values: GameSettings) => void): void {
    this.listeners.add(listener);
  }

  private applyToDom(): void {
    // The stylesheet turns this into a scale transform *and* a compensating
    // size, so the scaled layer still measures exactly one viewport. Scaling
    // without that compensation pushes bottom/right-anchored HUD off screen.
    this.host.style.setProperty("--ui-scale", String(this.values.uiScale));
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<GameSettings>;
      this.values = {
        uiScale: clampScale(Number(parsed.uiScale ?? DEFAULTS.uiScale)),
        showDamageNumbers:
          typeof parsed.showDamageNumbers === "boolean"
            ? parsed.showDamageNumbers
            : DEFAULTS.showDamageNumbers,
      };
    } catch {
      this.values = { ...DEFAULTS };
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      // Non-fatal: settings just won't survive a reload.
    }
  }
}
