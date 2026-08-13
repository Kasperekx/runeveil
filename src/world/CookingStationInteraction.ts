import type { Application } from "pixi.js";
import type { Environment } from "../environment/Environment";
import type { Camera } from "../game/Camera";
import { screenToWorld } from "../game/screenToWorld";
import type { MapWorldInteraction } from "../maps/types";
import type { GameToast } from "../ui/GameToast";
import type { CraftStationKind, ProfessionsPanel } from "../ui/ProfessionsPanel";

const TOO_FAR_MESSAGE = "Podejdź bliżej do stanowiska, aby wytwarzać.";
const CRAFT_INTERRUPTED_MESSAGE =
  "Przerwano wytwarzanie — oddaliłeś się od stanowiska.";

/**
 * Native-canvas interaction for cooking / forge props. The prop's hit radius
 * controls the pointer target; both client and server validate activation.
 */
export class CookingStationInteraction {
  private playerWasInRange: boolean | null = null;
  private nearbyKindsKey = "";

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
    this.nearbyKindsKey = "";
    this.updatePlayerRange();
  }

  /** Used by other world interactions to keep the pointer cursor consistent. */
  isAt(worldX: number, worldY: number): boolean {
    return this.environment.findInteraction("cooking", worldX, worldY) !== null;
  }

  isPlayerInRange(): boolean {
    return this.nearbyStationKinds().length > 0;
  }

  private nearbyStationKinds(): CraftStationKind[] {
    const player = this.getPlayerPosition();
    const kinds = new Set<CraftStationKind>();
    for (const interaction of this.environment.interactions) {
      if (interaction.kind !== "cooking") continue;
      if (
        Math.hypot(interaction.x - player.x, interaction.y - player.y) >
        interaction.activationRadius
      ) {
        continue;
      }
      kinds.add(interaction.stationKind === "forge" ? "forge" : "cooking");
    }
    return [...kinds];
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

    const kinds = this.nearbyStationKinds();
    this.playerWasInRange = kinds.length > 0;
    this.nearbyKindsKey = kinds.slice().sort().join(",");
    this.professions.setCraftingStations(kinds);
    this.professions.openPanel();
  };

  private readonly updatePlayerRange = (): void => {
    const kinds = this.nearbyStationKinds();
    const inRange = kinds.length > 0;
    const kindsKey = kinds.slice().sort().join(",");
    if (inRange === this.playerWasInRange && kindsKey === this.nearbyKindsKey) {
      return;
    }

    this.playerWasInRange = inRange;
    this.nearbyKindsKey = kindsKey;
    if (!inRange && this.professions.isCrafting) {
      this.professions.cancelCraft();
      this.toast.show(CRAFT_INTERRUPTED_MESSAGE);
    }
    this.professions.setCraftingStations(kinds);
  };

  private withinActivationRange(interaction: MapWorldInteraction): boolean {
    const player = this.getPlayerPosition();
    return (
      Math.hypot(interaction.x - player.x, interaction.y - player.y) <=
      interaction.activationRadius
    );
  }
}
