import type { Application } from "pixi.js";
import type { Environment } from "../environment/Environment";
import type { Camera } from "../game/Camera";
import { screenToWorld } from "../game/screenToWorld";
import type { MapWorldInteraction } from "../maps/types";
import type { GameToast } from "../ui/GameToast";
import type { ProfessionsPanel } from "../ui/ProfessionsPanel";

const TOO_FAR_MESSAGE = "Podejdź bliżej do paleniska, aby gotować.";
const CRAFT_INTERRUPTED_MESSAGE =
  "Przerwano przygotowywanie — oddaliłeś się od paleniska.";

/**
 * Native-canvas interaction for cooking props. The prop's hit radius controls
 * the pointer target; both client and server validate the activation distance.
 */
export class CookingStationInteraction {
  private playerWasInRange: boolean | null = null;

  constructor(
    private readonly app: Application,
    private readonly camera: Camera,
    private environment: Environment,
    private readonly professions: ProfessionsPanel,
    private readonly getPlayerPosition: () => { x: number; y: number },
    private readonly toast: GameToast,
  ) {}

  start(): void {
    this.app.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.updatePlayerRange();
    this.app.ticker.add(this.updatePlayerRange);
  }

  setEnvironment(environment: Environment): void {
    this.environment = environment;
    this.playerWasInRange = null;
    this.updatePlayerRange();
  }

  /** Used by other world interactions to keep the pointer cursor consistent. */
  isAt(worldX: number, worldY: number): boolean {
    return this.environment.findInteraction("cooking", worldX, worldY) !== null;
  }

  isPlayerInRange(): boolean {
    const player = this.getPlayerPosition();
    return this.environment.interactions.some(
      (interaction) =>
        interaction.kind === "cooking" &&
        Math.hypot(interaction.x - player.x, interaction.y - player.y) <=
          interaction.activationRadius,
    );
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const world = screenToWorld(
      this.app,
      this.camera,
      event.clientX,
      event.clientY,
    );
    const interaction = this.environment.findInteraction(
      "cooking",
      world.x,
      world.y,
    );
    if (!interaction) return;

    // Claim the click before combat treats the fire as empty ground.
    event.stopImmediatePropagation();

    if (!this.withinActivationRange(interaction)) {
      this.toast.show(TOO_FAR_MESSAGE);
      return;
    }

    this.playerWasInRange = true;
    this.professions.setCraftingAvailable(true);
    this.professions.openPanel();
  };

  private readonly updatePlayerRange = (): void => {
    const inRange = this.isPlayerInRange();
    if (inRange === this.playerWasInRange) return;

    this.playerWasInRange = inRange;
    if (!inRange && this.professions.isCrafting) {
      this.professions.cancelCraft();
      this.toast.show(CRAFT_INTERRUPTED_MESSAGE);
    }
    this.professions.setCraftingAvailable(inRange);
  };

  private withinActivationRange(interaction: MapWorldInteraction): boolean {
    const player = this.getPlayerPosition();
    return (
      Math.hypot(interaction.x - player.x, interaction.y - player.y) <=
      interaction.activationRadius
    );
  }
}
