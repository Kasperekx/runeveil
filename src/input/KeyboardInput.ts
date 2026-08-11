/**
 * Single source of keyboard state for the game.
 * UI and gameplay both read from here (SRP: input only).
 */
export type KeyCode = string;

/** True when the event target is a text field (chat, auth, …). */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export class KeyboardInput {
  private readonly pressed = new Set<KeyCode>();
  private readonly downHandlers = new Set<
    (code: KeyCode, event: KeyboardEvent) => boolean | void
  >();

  start(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("focus", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  stop(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("focus", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.pressed.clear();
    this.downHandlers.clear();
  }

  isDown(code: KeyCode): boolean {
    return this.pressed.has(code);
  }

  /** Drops all pressed keys (e.g. HTML5 drag swallows keyup). */
  clear(): void {
    this.pressed.clear();
  }

  /** Axis from arrows + WASD: -1 | 0 | 1 on each component. */
  getMovementAxis(): { x: number; y: number } {
    let x = 0;
    let y = 0;

    if (this.isDown("ArrowRight") || this.isDown("KeyD")) x += 1;
    if (this.isDown("ArrowLeft") || this.isDown("KeyA")) x -= 1;
    if (this.isDown("ArrowDown") || this.isDown("KeyS")) y += 1;
    if (this.isDown("ArrowUp") || this.isDown("KeyW")) y -= 1;

    return { x, y };
  }

  onKeyDownPress(
    handler: (code: KeyCode, event: KeyboardEvent) => boolean | void,
  ): void {
    this.downHandlers.add(handler);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    // While typing in chat / forms: never drive movement or panel hotkeys.
    if (isTextEntryTarget(event.target)) {
      return;
    }

    const { code } = event;

    if (
      code.startsWith("Arrow") ||
      code === "KeyW" ||
      code === "KeyA" ||
      code === "KeyS" ||
      code === "KeyD"
    ) {
      event.preventDefault();
    }

    const wasPressed = this.pressed.has(code);
    this.pressed.add(code);

    if (!wasPressed && !event.repeat) {
      for (const handler of this.downHandlers) {
        if (handler(code, event) === true) break;
      }
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private onBlur = (): void => {
    this.pressed.clear();
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) this.pressed.clear();
  };
};
