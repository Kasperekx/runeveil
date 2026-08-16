import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { SHARED_DATA_DIR } from "@mmo/shared/data/dir";

export interface SkillConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Empty = all classes. */
  classes: string[];
  rank: number;
  school: string;
  schoolLabel: string;
  requiresTarget: boolean;
  cooldownMs: number;
  range: number;
  coneDegrees: number;
  strengthScale: number;
  weaponScale: number;
  /** Combat resource spent on a successful cast (0 = free). */
  resourceCost: number;
  vfx: string;
}

interface SkillYamlEntry {
  name: string;
  description: string;
  icon: string;
  classes?: string[];
  rank?: number;
  school?: string;
  schoolLabel?: string;
  requiresTarget?: boolean;
  cooldownMs: number;
  range: number;
  coneDegrees: number;
  strengthScale: number;
  weaponScale: number;
  resourceCost?: number;
  vfx: string;
}

interface SkillsYamlFile {
  skills: Record<string, SkillYamlEntry>;
}

/** Shared with client: shared/data/skills.yaml (reload server after YAML edits). */
function loadYaml(): SkillsYamlFile {
  const path = join(SHARED_DATA_DIR, "skills.yaml");
  const parsed = load(readFileSync(path, "utf8")) as SkillsYamlFile;
  if (!parsed?.skills) {
    throw new Error(`Invalid skills.yaml at ${path}`);
  }
  return parsed;
}

function normalize(id: string, entry: SkillYamlEntry): SkillConfig {
  const classes = (entry.classes ?? [])
    .map((c) => String(c).trim())
    .filter(Boolean);
  return {
    id,
    name: entry.name,
    description: entry.description.trim(),
    icon: entry.icon,
    classes,
    rank: Math.max(1, Math.floor(entry.rank ?? 1)),
    school: entry.school ?? "physical",
    schoolLabel: entry.schoolLabel ?? "Fizyczna",
    requiresTarget: Boolean(entry.requiresTarget),
    cooldownMs: Math.max(0, Math.floor(entry.cooldownMs)),
    range: Math.max(0, entry.range),
    coneDegrees: Math.max(0, Math.min(360, entry.coneDegrees)),
    strengthScale: Math.max(0, entry.strengthScale),
    weaponScale: Math.max(0, entry.weaponScale),
    resourceCost: Math.max(0, Math.floor(entry.resourceCost ?? 0)),
    vfx: entry.vfx,
  };
}

const yaml = loadYaml();

export const SKILLS: Record<string, SkillConfig> = Object.fromEntries(
  Object.entries(yaml.skills).map(([id, entry]) => [id, normalize(id, entry)]),
);

export function getSkillConfig(skillId: string): SkillConfig | null {
  return SKILLS[skillId] ?? null;
}

export function skillUsableByClass(
  skill: SkillConfig,
  classId: string,
): boolean {
  if (skill.classes.length === 0) return true;
  return skill.classes.includes(classId);
}

export function skillDamageRange(
  skill: SkillConfig,
  strength: number,
  weaponMin: number,
  weaponMax: number,
): { min: number; max: number } {
  const min = Math.max(
    1,
    Math.round(strength * skill.strengthScale + weaponMin * skill.weaponScale),
  );
  const max = Math.max(
    min,
    Math.round(strength * skill.strengthScale + weaponMax * skill.weaponScale),
  );
  return { min, max };
}

export function skillPower(
  skill: SkillConfig,
  strength: number,
  weaponDamage: number,
): number {
  return Math.max(
    1,
    strength * skill.strengthScale + weaponDamage * skill.weaponScale,
  );
}
