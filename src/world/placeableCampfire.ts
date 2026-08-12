import { load } from "js-yaml";
import placeableCampfireYaml from "../data/placeableCampfire.yaml?raw";
import type { MapPropType } from "../maps/types";

export interface PlaceableCampfireDefinition {
  id: string;
  /** Prop definition used like a map `propTypes` entry. */
  prop: MapPropType;
  placeRange: number;
  cookingActivationRadius: number;
  /** First idle frame — ghost preview + UI icon. */
  ghostTexture: string;
}

interface PlaceableCampfireYaml {
  id: string;
  anchorX: number;
  anchorY: number;
  scale?: number;
  filter?: "nearest" | "linear";
  collisionRadius: number;
  placeRange: number;
  cookingActivationRadius: number;
  interaction: {
    kind: "cooking";
    radius: number;
    offsetX?: number;
    offsetY?: number;
  };
  idleAnimation: {
    fps: number;
    frames: string[];
  };
  light: {
    color: number;
    radius: number;
    intensity: number;
    flicker?: boolean;
    offsetX?: number;
    offsetY?: number;
  };
}

function parseDefinition(): PlaceableCampfireDefinition {
  const raw = load(placeableCampfireYaml) as PlaceableCampfireYaml;
  if (!raw?.id || !raw.idleAnimation?.frames?.length) {
    throw new Error("Invalid placeableCampfire.yaml");
  }
  if (raw.anchorX !== 0.5 || raw.anchorY !== 0.5) {
    throw new Error("placeableCampfire anchors must be 0.5 / 0.5");
  }

  const frames = raw.idleAnimation.frames;
  return {
    id: raw.id,
    placeRange: raw.placeRange,
    cookingActivationRadius: raw.cookingActivationRadius,
    ghostTexture: frames[0]!,
    prop: {
      texture: frames[0]!,
      idleAnimation: {
        frames,
        fps: raw.idleAnimation.fps,
      },
      anchorX: raw.anchorX,
      anchorY: raw.anchorY,
      scale: raw.scale ?? 1,
      filter: raw.filter ?? "nearest",
      collisionRadius: raw.collisionRadius,
      interaction: {
        kind: "cooking",
        radius: raw.interaction.radius,
        offsetX: raw.interaction.offsetX,
        offsetY: raw.interaction.offsetY,
      },
      light: { ...raw.light },
    },
  };
}

/** Single placeable campfire catalog entry (client). */
export const PLACEABLE_CAMPFIRE = parseDefinition();
