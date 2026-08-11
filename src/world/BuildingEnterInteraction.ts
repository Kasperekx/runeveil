import { Graphics, type Application, type Container } from "pixi.js";
import type { Environment } from "../environment/Environment";
import type { Camera } from "../game/Camera";
import { screenToWorld } from "../game/screenToWorld";
import type { KeyboardInput } from "../input/KeyboardInput";
import type { MapWorldInteraction } from "../maps/types";
import type { GameToast } from "../ui/GameToast";

const TOO_FAR_MESSAGE = "Podejdź bliżej drzwi, aby wejść.";
const BUSY_MESSAGE = "Przechodzisz do innego miejsca…";

type EnterInteraction = Extract<MapWorldInteraction, { kind: "enter" }>;

/**
 * Door hotspots on enterable buildings: soft ground spill, nearby prompt,
 * click / E to change map.
 */
export class BuildingEnterInteraction {
  private readonly prompt: HTMLElement;
  private readonly markers = new Map<
    EnterInteraction,
    { graphics: Graphics; phase: number }
  >();
  private nearestInRange: EnterInteraction | null = null;
  private transitioning = false;
  private started = false;

  constructor(
    private readonly app: Application,
    private readonly camera: Camera,
    private readonly world: Container,
    private environment: Environment,
    private readonly input: KeyboardInput,
    private readonly getPlayerPosition: () => { x: number; y: number },
    private readonly toast: GameToast,
    private readonly onEnterMap: (mapId: string) => void | Promise<void>,
    private readonly isBlocked: () => boolean = () => false,
  ) {
    this.prompt = document.createElement("div");
    this.prompt.className = "interact-prompt";
    this.prompt.hidden = true;
    this.prompt.setAttribute("role", "status");
    this.prompt.setAttribute("aria-live", "polite");
    (document.getElementById("ui-root") ?? document.body).append(this.prompt);
    this.rebuildMarkers();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.app.canvas.addEventListener("pointerdown", this.onPointerDown, true);
    this.input.onKeyDownPress(this.onKeyDown);
    this.app.ticker.add(this.update);
  }

  /** Rebind after Environment is rebuilt for a new map. */
  setEnvironment(environment: Environment): void {
    this.clearMarkers();
    this.environment = environment;
    this.rebuildMarkers();
    this.nearestInRange = null;
    this.renderPrompt(null);
    this.transitioning = false;
  }

  isAt(worldX: number, worldY: number): boolean {
    return this.environment.findInteraction("enter", worldX, worldY) !== null;
  }

  private rebuildMarkers(): void {
    for (const interaction of this.environment.interactions) {
      if (interaction.kind !== "enter") continue;
      const graphics = new Graphics();
      graphics.zIndex = Math.round(interaction.y) - 1;
      graphics.roundPixels = true;
      graphics.eventMode = "none";
      this.world.addChild(graphics);
      this.markers.set(interaction, {
        graphics,
        phase: Math.random() * Math.PI,
      });
    }
  }

  private clearMarkers(): void {
    for (const marker of this.markers.values()) {
      marker.graphics.destroy();
    }
    this.markers.clear();
  }

  private onKeyDown = (code: string, event: KeyboardEvent): boolean => {
    if (code !== "KeyE" || this.isBlocked() || this.transitioning) return false;
    const target = this.nearestInRange;
    if (!target) return false;
    event.preventDefault();
    void this.tryEnter(target);
    return true;
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.isBlocked() || this.transitioning) return;
    const world = screenToWorld(
      this.app,
      this.camera,
      event.clientX,
      event.clientY,
    );
    const interaction = this.environment.findInteraction(
      "enter",
      world.x,
      world.y,
    );
    if (!interaction || interaction.kind !== "enter") return;

    event.stopImmediatePropagation();

    if (!this.withinActivationRange(interaction)) {
      this.toast.show(TOO_FAR_MESSAGE);
      return;
    }

    void this.tryEnter(interaction);
  };

  private async tryEnter(interaction: EnterInteraction): Promise<void> {
    const mapId = interaction.targetMapId?.trim();
    if (!mapId) {
      this.toast.show("To przejście nie prowadzi jeszcze nigdzie.");
      return;
    }
    if (this.transitioning) {
      this.toast.show(BUSY_MESSAGE);
      return;
    }

    this.transitioning = true;
    this.renderPrompt(null);
    try {
      await this.onEnterMap(mapId);
    } catch (error) {
      console.error("[map] failed to enter", mapId, error);
      this.toast.show("Nie udało się przejść.");
      this.transitioning = false;
    }
  }

  private readonly update = (): void => {
    const player = this.getPlayerPosition();
    let nearest: EnterInteraction | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const interaction of this.environment.interactions) {
      if (interaction.kind !== "enter") continue;
      const distance = Math.hypot(
        interaction.x - player.x,
        interaction.y - player.y,
      );
      if (
        distance <= interaction.activationRadius &&
        distance < nearestDistance
      ) {
        nearest = interaction;
        nearestDistance = distance;
      }
    }

    this.nearestInRange =
      this.isBlocked() || this.transitioning ? null : nearest;
    this.renderPrompt(this.nearestInRange);

    const dt = Math.min(this.app.ticker.deltaMS, 50) / 1000;
    for (const [interaction, marker] of this.markers) {
      marker.phase += dt;
      const active = interaction === this.nearestInRange;
      drawDoorMarker(marker.graphics, interaction, marker.phase, active);
    }
  };

  private renderPrompt(interaction: EnterInteraction | null): void {
    if (!interaction) {
      this.prompt.hidden = true;
      this.prompt.classList.remove("is-visible");
      return;
    }

    this.prompt.innerHTML = `
      <kbd>E</kbd>
      <span>Wejdź · ${escapeHtml(interaction.label)}</span>`;
    this.prompt.hidden = false;
    this.prompt.classList.add("is-visible");
  }

  private withinActivationRange(interaction: EnterInteraction): boolean {
    const player = this.getPlayerPosition();
    return (
      Math.hypot(interaction.x - player.x, interaction.y - player.y) <=
      interaction.activationRadius
    );
  }
}

function drawDoorMarker(
  graphics: Graphics,
  interaction: EnterInteraction,
  phase: number,
  active: boolean,
): void {
  graphics.clear();
  graphics.position.set(interaction.x, interaction.y);

  const breathe = 0.92 + Math.sin(phase * 1.6) * 0.08;
  const strength = active ? 1 : 0.5;

  graphics.ellipse(0, 1, 22 * breathe, 9 * breathe);
  graphics.fill({ color: 0x6e5428, alpha: 0.14 * strength });

  graphics.ellipse(0, 0, 14 * breathe, 5.5 * breathe);
  graphics.fill({ color: 0xb8954a, alpha: 0.18 * strength });

  graphics.ellipse(0, -1, 7, 2.8);
  graphics.fill({
    color: 0xe6c878,
    alpha: (active ? 0.26 : 0.12) * breathe,
  });
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
