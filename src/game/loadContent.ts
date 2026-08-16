import { loadClassCatalog } from "../content/classes";
import { loadCreatureCatalog } from "../content/creatures";
import { loadItemCatalog } from "../content/items";
import { loadNpcCatalog } from "../content/npcs";
import { loadProfessionCatalog } from "../content/professions";
import { loadQuestCatalog } from "../content/quests";
import { loadSkillCatalog } from "../content/skills";
import { SweepingStrikeFx } from "../render/SweepingStrikeFx";

/** Preload YAML catalogs and combat FX before the world mounts. */
export async function loadGameContent(): Promise<void> {
  await loadItemCatalog();
  await loadProfessionCatalog();
  await loadQuestCatalog();
  await loadSkillCatalog();
  await loadCreatureCatalog();
  await loadClassCatalog();
  await loadNpcCatalog();
  await SweepingStrikeFx.preload();
}
