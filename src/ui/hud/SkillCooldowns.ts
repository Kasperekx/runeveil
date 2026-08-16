import type { SkillId } from "../../content/skills";

/** Shared skill cooldown clock for the action bar. */
export class SkillCooldowns {
  private readonly until = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private timer: number | null = null;

  start(skillId: SkillId, durationMs: number): void {
    if (durationMs <= 0) return;
    this.until.set(skillId, Date.now() + durationMs);
    this.ensureTicker();
    this.notify();
  }

  remaining(skillId: SkillId): number {
    const end = this.until.get(skillId);
    if (end === undefined) return 0;
    const left = end - Date.now();
    if (left <= 0) {
      this.until.delete(skillId);
      return 0;
    }
    return left;
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private ensureTicker(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      let active = false;
      for (const [key, end] of this.until) {
        if (end <= Date.now()) this.until.delete(key);
        else active = true;
      }
      this.notify();
      if (!active && this.timer !== null) {
        window.clearInterval(this.timer);
        this.timer = null;
      }
    }, 100);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
