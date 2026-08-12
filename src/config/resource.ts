/** Client-side class combat resource helpers (mirrors server resourceConfig). */

export type ResourceKind = "none" | "rage" | "mana" | "energy";

export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  none: "",
  rage: "Wściekłość",
  mana: "Mana",
  energy: "Energia",
};

export function parseResourceKind(raw: string | undefined | null): ResourceKind {
  if (raw === "rage" || raw === "mana" || raw === "energy") return raw;
  return "none";
}
