/** Server notice kinds → Polish HUD copy. */
export const NOTICE_COPY: Record<string, string> = {
  inventory_full: "Plecak jest pełny.",
  not_enough_gold: "Za mało złota.",
  out_of_stock: "Towar wyprzedany.",
  shop_unavailable: "Ten kupiec nie prowadzi teraz handlu.",
  shop_item_unavailable:
    "Ten przedmiot nie jest dostępny u kupca. Odśwież grę.",
  cannot_sell: "Kupiec tego nie kupi.",
  too_far: "Podejdź bliżej, by handlować.",
  already_full_hp: "Jesteś już w pełni sił.",
  item_on_cooldown: "Przedmiot się jeszcze odnawia.",
  food_buff_expired: "Efekt posiłku dobiegł końca.",
  food_buff_cancelled: "Anulowano efekt posiłku.",
  equip_level_too_low: "Twój poziom jest za niski, by założyć ten przedmiot.",
  cooking_station_required: "Podejdź do paleniska, aby gotować.",
  forge_station_required: "Podejdź do kuźni, aby wytopić sztabki.",
  campfire_too_far: "Podejdź bliżej, aby postawić palenisko.",
  campfire_blocked: "Nie możesz tu postawić paleniska.",
  profession_level_too_low:
    "Twój poziom profesji jest za niski dla tej czynności.",
  profession_not_learned:
    "Najpierw naucz się tej profesji u odpowiedniego trenera.",
  profession_already_learned: "Znasz już tę profesję.",
  cannot_learn_profession: "Ten NPC nie może Cię tego nauczyć.",
  profession_learned: "Nauczyłeś się nowej profesji.",
  missing_ingredients: "Brakuje składników do tego przepisu.",
  mining_pickaxe_required: "Potrzebujesz kilofa, aby wydobywać rudę.",
  mining_too_far: "Podejdź bliżej do żyły, aby kopać.",
  mining_node_depleted: "Ta żyła jest już wyczerpana.",
  mining_node_missing: "Nie znaleziono żyły rudy.",
  quest_giver_too_far: "Podejdź do zleceniodawcy, aby przyjąć to zadanie.",
  quest_prerequisite_missing: "Najpierw ukończ poprzednie zadanie.",
  quest_turn_in_too_far: "Podejdź do wskazanego miejsca, aby odebrać nagrodę.",
  no_target: "Nie masz wybranego celu.",
  out_of_range: "Cel jest poza zasięgiem.",
  respawn_too_soon: "Nie możesz jeszcze powrócić do schronienia.",
  repair_unavailable: "Ten NPC nie świadczy usług naprawy.",
  nothing_to_repair: "Twój ekwipunek nie wymaga naprawy.",
  not_enough_resource: "Za mało zasobu.",
  not_enough_rage: "Za mało wściekłości.",
  chat_rate_limited: "Piszesz zbyt szybko. Odczekaj chwilę.",
  chat_invalid: "Wiadomość jest pusta lub niedozwolona.",
};

export const CRAFT_REJECTION_NOTICES = new Set([
  "cooking_station_required",
  "forge_station_required",
  "profession_level_too_low",
  "profession_not_learned",
  "missing_ingredients",
  "inventory_full",
  "mining_pickaxe_required",
  "mining_too_far",
  "mining_node_depleted",
  "mining_node_missing",
]);

export function noticeText(
  kind: string,
  resourceKind?: string,
): string | undefined {
  if (kind === "not_enough_resource" && resourceKind === "rage") {
    return NOTICE_COPY.not_enough_rage;
  }
  return NOTICE_COPY[kind];
}
