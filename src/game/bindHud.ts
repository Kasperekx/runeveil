import type { Application } from "pixi.js";
import type { KeyboardInput } from "../input/KeyboardInput";
import type { ActionBar } from "../ui/hud/actionBar/ActionBar";
import { ActionBarHotkeys } from "../ui/hud/actionBar/ActionBarHotkeys";
import type { Minimap } from "../ui/hud/Minimap";
import { InventoryHotkeys } from "../ui/inventory/InventoryHotkeys";
import type { InventoryPanel } from "../ui/inventory/InventoryPanel";
import type { GameChat } from "../ui/chat/GameChat";
import { CharacterHotkeys } from "../ui/panels/CharacterHotkeys";
import type { CharacterPanel } from "../ui/panels/CharacterPanel";
import type { DialogueWindow } from "../ui/panels/DialogueWindow";
import type { LootWindow } from "../ui/panels/LootWindow";
import type { MerchantWindow } from "../ui/panels/MerchantWindow";
import { MICRO_ICONS, MicroMenu } from "../ui/panels/MicroMenu";
import { ProfessionsHotkeys } from "../ui/panels/ProfessionsHotkeys";
import type { ProfessionsPanel } from "../ui/panels/ProfessionsPanel";
import { QuestLogHotkeys } from "../ui/panels/QuestLogHotkeys";
import type { QuestLog } from "../ui/panels/QuestLog";
import type { Settings } from "../ui/panels/settings";
import { SettingsPanel } from "../ui/panels/SettingsPanel";
import { SkillsHotkeys } from "../ui/panels/SkillsHotkeys";
import type { SkillsPanel } from "../ui/panels/SkillsPanel";
import { SystemMenu } from "../ui/panels/SystemMenu";

export interface BoundGameHud {
  settingsPanel: SettingsPanel;
  systemMenu: SystemMenu;
  microMenu: MicroMenu;
  startHotkeys(): void;
}

/** Construct HUD chrome (hotkeys, system menu, micro menu) after panels exist. */
export function bindGameHud(opts: {
  app: Application;
  input: KeyboardInput;
  inventoryPanel: InventoryPanel;
  characterPanel: CharacterPanel;
  skillsPanel: SkillsPanel;
  professionsPanel: ProfessionsPanel;
  questLog: QuestLog;
  actionBar: ActionBar;
  gameChat: GameChat;
  dialogueWindow: DialogueWindow;
  merchantWindow: MerchantWindow;
  lootWindow: LootWindow;
  settings: Settings;
  minimap: Minimap;
  accountEmail: string;
  onCharacterSelect: () => Promise<void>;
  getCombatTargetId: () => string | null;
  getIsPlayerDead: () => boolean;
}): BoundGameHud {
  const inventoryHotkeys = new InventoryHotkeys(
    opts.inventoryPanel,
    opts.input,
  );
  const characterHotkeys = new CharacterHotkeys(
    opts.characterPanel,
    opts.input,
  );
  const skillsHotkeys = new SkillsHotkeys(opts.skillsPanel, opts.input);
  const professionsHotkeys = new ProfessionsHotkeys(
    opts.professionsPanel,
    opts.input,
  );
  const questLogHotkeys = new QuestLogHotkeys(opts.questLog, opts.input);
  const actionBarHotkeys = new ActionBarHotkeys(opts.actionBar, opts.input);

  const settingsPanel = SettingsPanel.create(opts.settings, {
    accountEmail: opts.accountEmail,
    onCharacterSelect: opts.onCharacterSelect,
  });
  const systemMenu = SystemMenu.create({
    onSettings: () => settingsPanel.openPanel(),
    onCharacterSelect: opts.onCharacterSelect,
  });

  opts.input.onKeyDownPress((code, event) => {
    if (opts.gameChat.handleHotkey(code, event)) {
      opts.input.clear();
      return true;
    }
    if (systemMenu.isOpen) {
      event.preventDefault();
      if (code === "Escape") systemMenu.close();
      opts.input.clear();
      return true;
    }
    if (code !== "Escape") return;

    if (settingsPanel.isOpen) {
      event.preventDefault();
      settingsPanel.close();
      return true;
    }

    const panelOpen =
      opts.inventoryPanel.isOpen ||
      opts.characterPanel.isOpen ||
      opts.skillsPanel.isOpen ||
      opts.professionsPanel.isOpen ||
      opts.questLog.isOpen ||
      opts.dialogueWindow.isOpen ||
      opts.merchantWindow.isOpen ||
      opts.lootWindow.isOpen;
    if (opts.getIsPlayerDead()) {
      event.preventDefault();
      return true;
    }
    if (panelOpen || opts.getCombatTargetId()) return;

    event.preventDefault();
    opts.input.clear();
    systemMenu.openMenu();
    return true;
  });

  const microMenu = MicroMenu.create([
    {
      id: "character",
      label: "Szczegóły postaci",
      hotkey: "C",
      icon: MICRO_ICONS.character,
      onClick: () => opts.characterPanel.toggle(),
    },
    {
      id: "inventory",
      label: "Ekwipunek",
      hotkey: "I",
      icon: MICRO_ICONS.bag,
      onClick: () => opts.inventoryPanel.toggle(),
    },
    {
      id: "skills",
      label: "Umiejętności",
      hotkey: "P",
      icon: MICRO_ICONS.skills,
      onClick: () => opts.skillsPanel.toggle(),
    },
    {
      id: "professions",
      label: "Profesje",
      hotkey: "L",
      icon: MICRO_ICONS.professions,
      onClick: () => opts.professionsPanel.toggle(),
    },
    {
      id: "quests",
      label: "Dziennik zadań",
      hotkey: "Q",
      icon: MICRO_ICONS.quests,
      onClick: () => opts.questLog.toggle(),
    },
    {
      id: "map",
      label: "Minimapa",
      icon: MICRO_ICONS.map,
      onClick: () => opts.minimap.toggle(),
    },
    {
      id: "social",
      label: "Czat",
      hotkey: "Enter",
      icon: MICRO_ICONS.social,
      onClick: () => opts.gameChat.focusInput(),
    },
    {
      id: "settings",
      label: "Ustawienia",
      icon: MICRO_ICONS.settings,
      onClick: () => settingsPanel.toggle(),
    },
  ]);

  opts.app.ticker.add(() => {
    microMenu.setActive("character", opts.characterPanel.isOpen);
    microMenu.setActive("inventory", opts.inventoryPanel.isOpen);
    microMenu.setActive("skills", opts.skillsPanel.isOpen);
    microMenu.setActive("professions", opts.professionsPanel.isOpen);
    microMenu.setActive("quests", opts.questLog.isOpen);
    microMenu.setActive("settings", settingsPanel.isOpen);
  });

  return {
    settingsPanel,
    systemMenu,
    microMenu,
    startHotkeys() {
      inventoryHotkeys.start();
      characterHotkeys.start();
      skillsHotkeys.start();
      professionsHotkeys.start();
      questLogHotkeys.start();
      actionBarHotkeys.start();
    },
  };
}
