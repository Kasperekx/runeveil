import {
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  type Application,
  type Texture,
} from "pixi.js";
import type { MapDocument } from "../maps/types";
import { getNpc, hasNpc } from "./catalog";

const NAME_Y = -55;
const QUEST_MARKER_Y = -71;

export type NpcQuestMarker = "available" | "turn_in" | null;

export interface NpcHit {
  id: string;
  npcId: string;
  x: number;
  y: number;
}

interface NpcInstance {
  id: string;
  npcId: string;
  x: number;
  y: number;
  root: Container;
  selection: Graphics;
  frames: Texture[];
  fps: number;
  elapsed: number;
  frameIndex: number;
  sprite: Sprite;
  questMarker: Text;
}

/**
 * Renders placed, static NPCs (idle-breathing sprite + click hit-test).
 *
 * Client-only and unauthoritative on purpose: dialogue has no server-side
 * state, so there is nothing here for Colyseus to own. Mirrors Environment's
 * prop rendering (Y-sorted, looping idle frames) but adds hit-testing and a
 * selection ring, which decorative props don't need.
 */
export class NpcSystem {
  private readonly instances: NpcInstance[] = [];
  private selectedId: string | null = null;

  private constructor(private readonly app: Application) {}

  static async create(
    app: Application,
    world: Container,
    map: MapDocument,
  ): Promise<NpcSystem> {
    const system = new NpcSystem(app);

    for (const placement of map.npcs ?? []) {
      if (!hasNpc(placement.npcId)) {
        console.warn(`[npcs] unknown npc id: ${placement.npcId}`);
        continue;
      }

      const def = getNpc(placement.npcId);
      const frames = await Promise.all(def.frames.map(loadNearestTexture));

      const root = new Container();
      root.position.set(placement.x, placement.y);
      root.zIndex = Math.round(placement.y);
      world.addChild(root);

      const selection = new Graphics();
      selection
        .ellipse(0, 2, 22, 10)
        .fill({ color: 0xb8954a, alpha: 0.22 })
        .ellipse(0, 2, 22, 10)
        .stroke({ width: 2, color: 0xe6c878, alpha: 0.95 });
      selection.visible = false;
      root.addChild(selection);

      const sprite = new Sprite(frames[0]);
      sprite.anchor.set(0.5, 0.92);
      sprite.roundPixels = true;
      root.addChild(sprite);

      const nameLabel = new Text({
        text: def.name,
        style: {
          fontFamily: "Cinzel, Georgia, serif",
          fontSize: 9,
          fontWeight: "500",
          fill: 0xd4b86a,
          stroke: { color: 0x1a140c, width: 1.5 },
          align: "center",
        },
      });
      nameLabel.anchor.set(0.5, 1);
      nameLabel.position.set(0, NAME_Y);
      nameLabel.alpha = 0.88;
      nameLabel.roundPixels = true;
      root.addChild(nameLabel);

      const questMarker = new Text({
        text: "?",
        style: {
          fontFamily: "Cinzel, Georgia, serif",
          fontSize: 21,
          fontWeight: "700",
          fill: 0xf4d467,
          stroke: { color: 0x201507, width: 3 },
          dropShadow: {
            color: 0x000000,
            alpha: 0.72,
            blur: 2,
            distance: 1,
          },
        },
      });
      questMarker.anchor.set(0.5, 1);
      questMarker.position.set(0, QUEST_MARKER_Y);
      questMarker.visible = false;
      questMarker.roundPixels = true;
      root.addChild(questMarker);

      system.instances.push({
        id: placement.id,
        npcId: placement.npcId,
        x: placement.x,
        y: placement.y,
        root,
        selection,
        frames,
        fps: def.animFps,
        elapsed: 0,
        frameIndex: 0,
        sprite,
        questMarker,
      });
    }

    return system;
  }

  start(): void {
    this.app.ticker.add(this.update);
  }

  /** Nearest NPC within maxDist of a click/target point, or null. */
  findNearest(worldX: number, worldY: number, maxDist: number): NpcHit | null {
    let best: NpcHit | null = null;
    let bestDist = maxDist;

    for (const instance of this.instances) {
      const dist = Math.hypot(instance.x - worldX, instance.y - worldY);
      if (dist > bestDist) continue;
      bestDist = dist;
      best = {
        id: instance.id,
        npcId: instance.npcId,
        x: instance.x,
        y: instance.y,
      };
    }

    return best;
  }

  /** Fixed position of a placed NPC by instance id — NPCs never move. */
  getPosition(id: string): { x: number; y: number } | null {
    const instance = this.instances.find((n) => n.id === id);
    return instance ? { x: instance.x, y: instance.y } : null;
  }

  setSelected(id: string | null): void {
    if (this.selectedId === id) return;

    if (this.selectedId) {
      const previous = this.instances.find((n) => n.id === this.selectedId);
      if (previous) previous.selection.visible = false;
    }

    this.selectedId = id;

    if (id) {
      const current = this.instances.find((n) => n.id === id);
      if (current) current.selection.visible = true;
    }
  }

  /** Displays classic MMO quest punctuation above every matching NPC instance. */
  setQuestMarker(npcId: string, marker: NpcQuestMarker): void {
    for (const instance of this.instances) {
      if (instance.npcId !== npcId) continue;
      instance.questMarker.visible = marker !== null;
      if (marker) {
        instance.questMarker.text = marker === "turn_in" ? "?" : "!";
        instance.questMarker.style.fill =
          marker === "turn_in" ? 0xf1bf4e : 0xf4d467;
      }
    }
  }

  private update = (): void => {
    if (this.instances.length === 0) return;
    const deltaSeconds = Math.min(this.app.ticker.deltaMS, 100) / 1000;

    for (const instance of this.instances) {
      if (instance.frames.length <= 1) continue;

      instance.elapsed += deltaSeconds;
      const frameDuration = 1 / instance.fps;
      while (instance.elapsed >= frameDuration) {
        instance.elapsed -= frameDuration;
        instance.frameIndex =
          (instance.frameIndex + 1) % instance.frames.length;
        instance.sprite.texture = instance.frames[instance.frameIndex]!;
      }
    }
  };
}

async function loadNearestTexture(url: string): Promise<Texture> {
  const texture = (await Assets.load(url)) as Texture;
  const source = texture.source;
  source.scaleMode = "nearest";
  if ("alphaMode" in source) {
    (source as { alphaMode: string }).alphaMode = "premultiplied-alpha";
  }
  return texture;
}
