import { Assets, Sprite, type Application, type Container } from "pixi.js";
import type { Environment } from "../render/Environment";
import type { Camera } from "../game/Camera";
import { screenToWorld } from "../game/screenToWorld";
import type { KeyboardInput } from "../input/KeyboardInput";
import { getItem, hasItem } from "../content/items";
import type { Inventory } from "../inventory/Inventory";
import type { MapWorldInteraction } from "../maps/types";
import type { NetworkPlayerSnapshot } from "../network/GameNetwork";
import { getProfessionGatherNode } from "../content/professions";
import type { GameToast } from "../ui/hud/GameToast";

const TOO_FAR_MESSAGE = "Podejdź bliżej do żyły, aby kopać.";
const NO_PICKAXE_MESSAGE = "Potrzebujesz kilofa, aby wydobywać rudę.";
const DEPLETED_MESSAGE = "Ta żyła jest już wyczerpana.";
const BUSY_MESSAGE = "Już wydobywasz rudę…";
const INTERRUPTED_MESSAGE = "Przerwano wydobywanie.";
const MOVE_CANCEL_DISTANCE = 8;

type MiningInteractionSpot = Extract<MapWorldInteraction, { kind: "mining" }>;

type ChannelState = {
  spot: MiningInteractionSpot;
  startedAt: number;
  gatherTimeMs: number;
  originX: number;
  originY: number;
  icon: Sprite;
  elapsed: number;
};

/**
 * WoW-style ore gathering: stand near a vein, click / press E, channel with a
 * floating pickaxe icon + cast bar, then ask the server to award the ore.
 */
export class MiningInteraction {
  private readonly prompt: HTMLElement;
  private readonly castBar: HTMLElement;
  private readonly castBarFill: HTMLElement;
  private readonly castBarLabel: HTMLElement;
  private readonly castBarTime: HTMLElement;
  private readonly castBarIcon: HTMLImageElement;
  private nearestInRange: MiningInteractionSpot | null = null;
  private channel: ChannelState | null = null;
  private depleted = new Set<string>();
  private started = false;
  private pickaxeTexturePromise: Promise<void> | null = null;

  constructor(
    private readonly app: Application,
    private readonly camera: Camera,
    private readonly world: Container,
    private environment: Environment,
    private readonly input: KeyboardInput,
    private readonly inventory: Inventory,
    private readonly getEquipment: () => NetworkPlayerSnapshot["equipment"],
    private readonly getPlayerPosition: () => { x: number; y: number },
    private readonly toast: GameToast,
    private readonly startMine: (nodeKey: string, nodeId: string) => void,
    private readonly completeMine: (nodeKey: string, nodeId: string) => void,
    private readonly isBlocked: () => boolean = () => false,
  ) {
    const uiRoot = document.getElementById("ui-root") ?? document.body;

    this.prompt = document.createElement("div");
    this.prompt.className = "interact-prompt";
    this.prompt.hidden = true;
    this.prompt.setAttribute("role", "status");
    this.prompt.setAttribute("aria-live", "polite");
    uiRoot.append(this.prompt);

    this.castBar = document.createElement("div");
    this.castBar.className = "mining-cast-bar";
    this.castBar.hidden = true;
    this.castBar.setAttribute("role", "status");
    this.castBar.setAttribute("aria-live", "polite");
    this.castBar.innerHTML = `
      <div class="mining-cast-bar__head">
        <img alt="" width="28" height="28" />
        <strong></strong>
        <span></span>
      </div>
      <div class="mining-cast-bar__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Postęp wydobywania">
        <span></span>
      </div>
    `;
    this.castBarIcon = this.castBar.querySelector("img")!;
    this.castBarLabel = this.castBar.querySelector("strong")!;
    this.castBarTime = this.castBar.querySelector(
      ".mining-cast-bar__head span",
    )!;
    this.castBarFill = this.castBar.querySelector(
      ".mining-cast-bar__track > span",
    )!;
    uiRoot.append(this.castBar);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.app.canvas.addEventListener("pointerdown", this.onPointerDown, true);
    this.input.onKeyDownPress(this.onKeyDown);
    this.app.ticker.add(this.update);
  }

  setEnvironment(environment: Environment): void {
    this.cancelChannel(false);
    this.environment = environment;
    this.nearestInRange = null;
    this.renderPrompt(null);
    for (const key of this.depleted) {
      this.environment.setPropDepleted(key, true);
    }
  }

  isAt(worldX: number, worldY: number): boolean {
    return this.environment.findInteraction("mining", worldX, worldY) !== null;
  }

  isMining(): boolean {
    return this.channel !== null;
  }

  applyDepletedState(
    nodes: Array<{ nodeKey: string; respawnAt: number }>,
  ): void {
    const now = Date.now();
    this.depleted.clear();
    for (const node of nodes) {
      if (node.respawnAt > now) this.depleted.add(node.nodeKey);
    }
    for (const interaction of this.environment.interactions) {
      if (interaction.kind !== "mining") continue;
      this.environment.setPropDepleted(
        interaction.nodeKey,
        this.depleted.has(interaction.nodeKey),
      );
    }
  }

  setNodeDepleted(nodeKey: string, depleted: boolean): void {
    if (depleted) this.depleted.add(nodeKey);
    else this.depleted.delete(nodeKey);
    this.environment.setPropDepleted(nodeKey, depleted);
    if (depleted && this.channel && this.channel.spot.nodeKey === nodeKey) {
      this.cancelChannel(true);
    }
  }

  private onKeyDown = (code: string, event: KeyboardEvent): boolean => {
    if (code !== "KeyE" || this.isBlocked()) return false;
    const target = this.nearestInRange;
    if (!target) return false;
    event.preventDefault();
    void this.tryMine(target);
    return true;
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.isBlocked()) return;
    const world = screenToWorld(
      this.app,
      this.camera,
      event.clientX,
      event.clientY,
    );
    const interaction = this.environment.findInteraction(
      "mining",
      world.x,
      world.y,
    );
    if (!interaction || interaction.kind !== "mining") return;

    event.stopImmediatePropagation();
    void this.tryMine(interaction);
  };

  private readonly update = (): void => {
    const player = this.getPlayerPosition();
    let nearest: MiningInteractionSpot | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const interaction of this.environment.interactions) {
      if (interaction.kind !== "mining") continue;
      if (this.depleted.has(interaction.nodeKey)) continue;
      const distance = Math.hypot(
        interaction.x - player.x,
        interaction.y - player.y,
      );
      if (
        distance > interaction.activationRadius ||
        distance >= nearestDistance
      )
        continue;
      nearest = interaction;
      nearestDistance = distance;
    }
    if (nearest?.nodeKey !== this.nearestInRange?.nodeKey) {
      this.nearestInRange = nearest;
      this.renderPrompt(nearest);
    }

    if (!this.channel) return;
    const moved = Math.hypot(
      player.x - this.channel.originX,
      player.y - this.channel.originY,
    );
    if (
      moved > MOVE_CANCEL_DISTANCE ||
      this.depleted.has(this.channel.spot.nodeKey) ||
      !this.withinActivationRange(this.channel.spot)
    ) {
      this.cancelChannel(true);
      return;
    }

    const delta = Math.min(this.app.ticker.deltaMS, 100) / 1000;
    this.channel.elapsed += delta;
    const icon = this.channel.icon;
    const bob = Math.sin(this.channel.elapsed * 10) * 3;
    const swing = Math.sin(this.channel.elapsed * 14) * 0.35;
    icon.position.set(this.channel.spot.x, this.channel.spot.y - 36 + bob);
    icon.rotation = swing;
    icon.scale.set(0.55 + Math.sin(this.channel.elapsed * 8) * 0.04);

    const elapsedMs = Date.now() - this.channel.startedAt;
    this.updateCastBar(elapsedMs, this.channel.gatherTimeMs);
    if (elapsedMs < this.channel.gatherTimeMs) return;

    const { spot } = this.channel;
    this.clearChannelVisual();
    this.channel = null;
    this.renderPrompt(this.nearestInRange);
    this.completeMine(spot.nodeKey, spot.nodeId);
  };

  private async tryMine(spot: MiningInteractionSpot): Promise<void> {
    if (this.isBlocked()) return;
    if (this.channel) {
      this.toast.show(BUSY_MESSAGE);
      return;
    }
    if (this.depleted.has(spot.nodeKey)) {
      this.toast.show(DEPLETED_MESSAGE);
      return;
    }
    if (!this.withinActivationRange(spot)) {
      this.toast.show(TOO_FAR_MESSAGE);
      return;
    }

    const node = getProfessionGatherNode(spot.nodeId);
    if (!node) return;
    if (!this.hasGatheringTool(node.requiredTool)) {
      this.toast.show(NO_PICKAXE_MESSAGE);
      return;
    }

    const player = this.getPlayerPosition();
    const icon = await this.createPickaxeIcon(spot.x, spot.y - 36);
    this.channel = {
      spot,
      startedAt: Date.now(),
      gatherTimeMs: node.gatherTimeMs,
      originX: player.x,
      originY: player.y,
      icon,
      elapsed: 0,
    };
    this.showCastBar(node.name);
    this.renderPrompt(null);
    this.startMine(spot.nodeKey, spot.nodeId);
  }

  private cancelChannel(showToast: boolean): void {
    if (!this.channel) return;
    this.clearChannelVisual();
    this.channel = null;
    this.renderPrompt(this.nearestInRange);
    if (showToast) this.toast.show(INTERRUPTED_MESSAGE);
  }

  private clearChannelVisual(): void {
    if (!this.channel) return;
    this.channel.icon.destroy();
    this.hideCastBar();
  }

  private showCastBar(label: string): void {
    const iconPath = hasItem("copper_pickaxe")
      ? `/${getItem("copper_pickaxe").icon}`
      : "/assets/items/copper-pickaxe.png";
    this.castBarIcon.src = iconPath;
    this.castBarLabel.textContent = label;
    this.updateCastBar(0, this.channel?.gatherTimeMs ?? 1);
    this.castBar.hidden = false;
  }

  private hideCastBar(): void {
    this.castBar.hidden = true;
    this.castBarFill.style.width = "0%";
    const track = this.castBar.querySelector(".mining-cast-bar__track");
    track?.setAttribute("aria-valuenow", "0");
  }

  private updateCastBar(elapsedMs: number, gatherTimeMs: number): void {
    const progress = Math.min(
      1,
      Math.max(0, elapsedMs / Math.max(1, gatherTimeMs)),
    );
    const pct = Math.round(progress * 100);
    this.castBarFill.style.width = `${pct}%`;
    const remainingSec = Math.max(0, (gatherTimeMs - elapsedMs) / 1000);
    this.castBarTime.textContent = `${remainingSec.toFixed(1)}s`;
    const track = this.castBar.querySelector(".mining-cast-bar__track");
    track?.setAttribute("aria-valuenow", String(pct));
  }

  private async createPickaxeIcon(x: number, y: number): Promise<Sprite> {
    const iconPath = hasItem("copper_pickaxe")
      ? `/${getItem("copper_pickaxe").icon}`
      : "/assets/items/copper-pickaxe.png";
    if (!this.pickaxeTexturePromise) {
      this.pickaxeTexturePromise = Assets.load(iconPath).then(() => undefined);
    }
    await this.pickaxeTexturePromise;
    const texture = Assets.get(iconPath);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.scale.set(0.55);
    sprite.position.set(x, y);
    sprite.zIndex = Math.round(y) + 40;
    sprite.roundPixels = true;
    sprite.eventMode = "none";
    this.world.addChild(sprite);
    return sprite;
  }

  private hasGatheringTool(requiredTool: string): boolean {
    for (const slot of this.getEquipment()) {
      if (!slot.itemId || !hasItem(slot.itemId)) continue;
      if (slot.maxDurability > 0 && slot.durability <= 0) continue;
      if (getItem(slot.itemId).gatheringTool === requiredTool) return true;
    }
    for (const slot of this.inventory.getSlots()) {
      if (!slot.itemId || !hasItem(slot.itemId)) continue;
      if (slot.maxDurability > 0 && slot.durability <= 0) continue;
      if (getItem(slot.itemId).gatheringTool === requiredTool) return true;
    }
    return false;
  }

  private withinActivationRange(interaction: MiningInteractionSpot): boolean {
    const player = this.getPlayerPosition();
    return (
      Math.hypot(interaction.x - player.x, interaction.y - player.y) <=
      interaction.activationRadius
    );
  }

  private renderPrompt(target: MiningInteractionSpot | null): void {
    if (!target || this.channel) {
      this.prompt.hidden = true;
      this.prompt.textContent = "";
      return;
    }
    const node = getProfessionGatherNode(target.nodeId);
    this.prompt.hidden = false;
    this.prompt.innerHTML = `<kbd>E</kbd> <span>${node?.name ?? "Wydobywaj"}</span>`;
  }
}
