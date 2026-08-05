import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type {
  EquipmentDefinition,
  EquipmentSlot,
  PlayerLoopAction,
  PlayerLoopActionInput,
  PlayerLoopActionResult,
  PlayerLoopHistoryEntry,
  PlayerLoopState,
  PlayerSkill,
  SimpleJobDefinition,
  TrainingDefinition
} from "./types";

const MAX_HISTORY = 80;
const FIGHT_COOLDOWN_MS = 45 * 60_000;

export const PLAYER_JOBS: readonly SimpleJobDefinition[] = [
  { id: "store-clerk", title: "Продавец ночного магазина", description: "Одна восьмичасовая смена за кассой.", skill: "service", minimumSkill: 0, basePay: 145, durationMinutes: 480, fatigue: 18, stress: 6, risk: 3 },
  { id: "warehouse-loader", title: "Грузчик логистического узла", description: "Разгрузка контейнеров и сортировка ящиков.", skill: "strength", minimumSkill: 12, basePay: 175, durationMinutes: 480, fatigue: 24, stress: 5, risk: 7 },
  { id: "clinic-orderly", title: "Санитар клиники", description: "Грязная работа в перегруженном медблоке.", skill: "medical", minimumSkill: 18, basePay: 205, durationMinutes: 480, fatigue: 19, stress: 11, risk: 5 },
  { id: "workshop-helper", title: "Помощник механика", description: "Диагностика, детали и простой ремонт.", skill: "technical", minimumSkill: 20, basePay: 225, durationMinutes: 480, fatigue: 20, stress: 7, risk: 6 },
  { id: "meshline-runner", title: "Курьер MESHLINE", description: "Все доставки свёрнуты в одну смену с дорожным риском.", skill: "streetwise", minimumSkill: 22, basePay: 250, durationMinutes: 420, fatigue: 22, stress: 12, risk: 14 }
] as const;

export const TRAINING_ACTIONS: readonly TrainingDefinition[] = [
  { id: "gym-strength", title: "Силовая тренировка", description: "Базовая силовая работа в обычном спортзале.", skill: "strength", cost: 25, durationMinutes: 90, fatigue: 15, injuryRisk: 3, gainMin: 2, gainMax: 4, venueCategories: ["gym"] },
  { id: "gym-endurance", title: "Кардио и ОФП", description: "Дорожка, интервалы и общая физическая подготовка.", skill: "endurance", cost: 20, durationMinutes: 75, fatigue: 13, injuryRisk: 2, gainMin: 2, gainMax: 4, venueCategories: ["gym"] },
  { id: "boxing-training", title: "Тренировка по боксу", description: "Лапы, мешок и короткий спарринг в боксёрском зале.", skill: "boxing", cost: 35, durationMinutes: 120, fatigue: 17, injuryRisk: 5, gainMin: 2, gainMax: 5, venueCategories: ["boxing-gym"] },
  { id: "shooting-range", title: "Стрельбище", description: "Стойка, контроль и точность на лицензированном тире.", skill: "shooting", cost: 65, durationMinutes: 90, fatigue: 7, injuryRisk: 1, gainMin: 2, gainMax: 4, venueCategories: ["shooting-range"] }
] as const;

export const EQUIPMENT_CATALOG: readonly EquipmentDefinition[] = [
  { id: "street-clothes", name: "Уличная одежда", description: "Базовый комплект одежды.", slot: "outfit", price: 0, attack: 0, defense: 1, accuracy: 0, intimidation: 0 },
  { id: "reinforced-jacket", name: "Армированная куртка", description: "Защитные пластины под тканью.", slot: "armor", price: 210, attack: 0, defense: 8, accuracy: -1, intimidation: 2 },
  { id: "security-plate-vest", name: "Пластинчатый бронежилет", description: "Тяжёлая списанная броня охраны.", slot: "armor", price: 460, attack: 0, defense: 16, accuracy: -3, intimidation: 5, requiredSkill: "strength", minimumSkill: 24 },
  { id: "brass-knuckles", name: "Кастет", description: "Оружие для тесной драки.", slot: "weapon", price: 180, attack: 7, defense: 0, accuracy: 1, intimidation: 4, weaponClass: "melee" },
  { id: "combat-knife", name: "Боевой нож", description: "Высокий урон и тяжёлые последствия применения.", slot: "weapon", price: 460, attack: 13, defense: 1, accuracy: 2, intimidation: 8, weaponClass: "melee", requiredSkill: "streetwise", minimumSkill: 20 },
  { id: "cheap-pistol", name: "Дешёвый пистолет", description: "Ненадёжный короткоствольный ствол.", slot: "weapon", price: 1450, attack: 24, defense: 0, accuracy: 5, intimidation: 14, weaponClass: "firearm", requiredSkill: "shooting", minimumSkill: 24 },
  { id: "meshline-navlink-n4", name: "MESHLINE NAVLINK N4", description: "Коммуникационный нейроимплант с ускоренной обработкой маршрутов.", slot: "implant", price: 1150, attack: 3, defense: 2, accuracy: 6, intimidation: 0, requiredSkill: "technical", minimumSkill: 18 }
] as const;

const BOXING_RANKS = ["Новичок", "Любитель", "Городской уровень", "Региональный уровень", "Профессионал", "Претендент", "Чемпион"] as const;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function initialSkill(rng: SeededRandom, min: number, max: number): number {
  return rng.integer(min, max);
}

export function createPlayerLoopState(seed: string, timestamp: number): PlayerLoopState {
  const rng = new SeededRandom(`${seed}:player-loop`);
  return {
    version: 1,
    skills: {
      service: initialSkill(rng, 12, 20),
      technical: initialSkill(rng, 8, 16),
      medical: initialSkill(rng, 7, 14),
      strength: initialSkill(rng, 16, 25),
      endurance: initialSkill(rng, 18, 27),
      boxing: initialSkill(rng, 10, 20),
      shooting: initialSkill(rng, 5, 12),
      streetwise: initialSkill(rng, 11, 19)
    },
    activeJobId: null,
    shiftsWorked: 0,
    totalEarned: 0,
    ownedEquipmentIds: ["street-clothes"],
    equipped: { outfit: "street-clothes" },
    streetFightWins: 0,
    streetFightLosses: 0,
    boxingWins: 0,
    boxingLosses: 0,
    boxingRating: 0,
    boxingRank: 0,
    lastFightAt: null,
    history: [{
      id: createStableEntityId("player-loop-history", `${seed}:${timestamp}:start`),
      timestamp,
      category: "work",
      title: "Новая жизнь",
      detail: "Работы нет. Базовые навыки определены.",
      moneyDelta: 0
    }]
  };
}

function legacyNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizePlayerLoopState(value: unknown, seed: string, timestamp: number, legacyJobs?: unknown): PlayerLoopState {
  const base = createPlayerLoopState(seed, timestamp);
  if (value && typeof value === "object") {
    const raw = value as Partial<PlayerLoopState>;
    const rawSkills = raw.skills && typeof raw.skills === "object" ? raw.skills : {};
    const normalizedSkill = (skill: PlayerSkill): number => {
      const candidate = (rawSkills as Partial<Record<PlayerSkill, unknown>>)[skill];
      return typeof candidate === "number" && Number.isFinite(candidate) ? clamp(candidate) : base.skills[skill];
    };
    const skills: PlayerLoopState["skills"] = {
      service: normalizedSkill("service"),
      technical: normalizedSkill("technical"),
      medical: normalizedSkill("medical"),
      strength: normalizedSkill("strength"),
      endurance: normalizedSkill("endurance"),
      boxing: normalizedSkill("boxing"),
      shooting: normalizedSkill("shooting"),
      streetwise: normalizedSkill("streetwise")
    };
    const equipmentAliases: Record<string, string> = { "riot-vest": "security-plate-vest", "reflex-booster": "meshline-navlink-n4" };
    const ownedEquipmentIds = Array.isArray(raw.ownedEquipmentIds)
      ? [...new Set(["street-clothes", ...raw.ownedEquipmentIds
          .filter((id): id is string => typeof id === "string")
          .map((id) => equipmentAliases[id] ?? id)
          .filter((id) => EQUIPMENT_CATALOG.some((item) => item.id === id))])]
      : base.ownedEquipmentIds;
    const rawEquipped = raw.equipped && typeof raw.equipped === "object" ? raw.equipped : {};
    const equipped: PlayerLoopState["equipped"] = { outfit: "street-clothes" };
    for (const slot of ["armor", "weapon", "implant"] as const) {
      const itemId = (rawEquipped as Partial<Record<EquipmentSlot, unknown>>)[slot];
      const normalizedItemId = typeof itemId === "string" ? (equipmentAliases[itemId] ?? itemId) : undefined;
      const item = getEquipment(normalizedItemId);
      if (item && item.slot === slot && ownedEquipmentIds.includes(item.id)) equipped[slot] = item.id;
    }
    const historyEntries = Array.isArray(raw.history)
      ? raw.history.filter((entry): entry is PlayerLoopHistoryEntry => Boolean(entry && typeof entry === "object" && typeof (entry as PlayerLoopHistoryEntry).id === "string")).slice(-MAX_HISTORY)
      : base.history;
    return {
      ...base,
      version: 1,
      skills,
      activeJobId: typeof raw.activeJobId === "string" && PLAYER_JOBS.some((job) => job.id === raw.activeJobId) ? raw.activeJobId : null,
      shiftsWorked: Math.max(0, Math.round(legacyNumber(raw.shiftsWorked))),
      totalEarned: Math.max(0, Math.round(legacyNumber(raw.totalEarned))),
      ownedEquipmentIds,
      equipped,
      streetFightWins: Math.max(0, Math.round(legacyNumber(raw.streetFightWins))),
      streetFightLosses: Math.max(0, Math.round(legacyNumber(raw.streetFightLosses))),
      boxingWins: Math.max(0, Math.round(legacyNumber(raw.boxingWins))),
      boxingLosses: Math.max(0, Math.round(legacyNumber(raw.boxingLosses))),
      boxingRating: Math.max(0, Math.round(legacyNumber(raw.boxingRating))),
      boxingRank: Math.max(0, Math.min(BOXING_RANKS.length - 1, Math.round(legacyNumber(raw.boxingRank)))),
      lastFightAt: typeof raw.lastFightAt === "number" && Number.isFinite(raw.lastFightAt) ? raw.lastFightAt : null,
      history: historyEntries.length ? historyEntries : base.history
    };
  }

  const jobs = legacyJobs && typeof legacyJobs === "object" ? legacyJobs as Record<string, unknown> : undefined;
  const work = jobs?.work && typeof jobs.work === "object" ? jobs.work as Record<string, unknown> : undefined;
  const skills = work?.skills && typeof work.skills === "object" ? work.skills as Record<string, unknown> : undefined;
  const contracts = Array.isArray(work?.contracts) ? work.contracts as Array<Record<string, unknown>> : [];
  const activeContractId = typeof work?.activeContractId === "string" ? work.activeContractId : null;
  const contract = contracts.find((item) => item.id === activeContractId);
  const role = typeof contract?.role === "string" ? contract.role : "";
  const jobMap: Record<string, string> = {
    cashier: "store-clerk",
    "cafe-crew": "store-clerk",
    "clinic-aide": "clinic-orderly",
    mechanic: "workshop-helper",
    courier: "meshline-runner"
  };
  const courier = jobs?.courier && typeof jobs.courier === "object" ? jobs.courier as Record<string, unknown> : undefined;
  return {
    ...base,
    skills: {
      ...base.skills,
      service: clamp(legacyNumber(skills?.service) || base.skills.service),
      technical: clamp(legacyNumber(skills?.technical) || base.skills.technical),
      medical: clamp(legacyNumber(skills?.medical) || base.skills.medical),
      streetwise: clamp(Math.max(base.skills.streetwise, Math.round(legacyNumber(courier?.rating) / 4)))
    },
    activeJobId: jobMap[role] ?? null,
    shiftsWorked: contracts.reduce((sum, item) => sum + legacyNumber(item.completedShifts), 0) + legacyNumber(courier?.completedDeliveries),
    totalEarned: legacyNumber(work?.totalEarned) + legacyNumber(courier?.totalEarnings),
    history: [{
      id: createStableEntityId("player-loop-history", `${seed}:${timestamp}:legacy-import`),
      timestamp,
      category: "work",
      title: "Старые рабочие системы удалены",
      detail: "Доход и базовые навыки перенесены в однокнопочный цикл.",
      moneyDelta: 0
    }]
  };
}

export function getPlayerJob(state: PlayerLoopState): SimpleJobDefinition | undefined {
  return PLAYER_JOBS.find((job) => job.id === state.activeJobId);
}

export function getEquipment(itemId: string | undefined): EquipmentDefinition | undefined {
  return itemId ? EQUIPMENT_CATALOG.find((item) => item.id === itemId) : undefined;
}

export function skillLabel(skill: PlayerSkill): string {
  const labels: Record<PlayerSkill, string> = {
    service: "Сервис",
    technical: "Техника",
    medical: "Медицина",
    strength: "Сила",
    endurance: "Выносливость",
    boxing: "Бокс",
    shooting: "Стрельба",
    streetwise: "Улица"
  };
  return labels[skill];
}

export function equipmentSlotLabel(slot: EquipmentSlot): string {
  return ({ outfit: "Одежда", armor: "Броня", weapon: "Оружие", implant: "Имплант" } as const)[slot];
}

export function boxingRankLabel(rank: number): string {
  return BOXING_RANKS[Math.max(0, Math.min(BOXING_RANKS.length - 1, rank))];
}

function history(state: PlayerLoopState, input: PlayerLoopActionInput, category: PlayerLoopHistoryEntry["category"], title: string, detail: string, moneyDelta: number): PlayerLoopState {
  const entry: PlayerLoopHistoryEntry = {
    id: createStableEntityId("player-loop-history", `${input.seed}:${input.timestamp}:${category}:${title}:${state.history.length}`),
    timestamp: input.timestamp,
    category,
    title,
    detail,
    moneyDelta
  };
  return { ...state, history: [...state.history, entry].slice(-MAX_HISTORY) };
}

function reject(state: PlayerLoopState, message: string): PlayerLoopActionResult {
  return { state, ok: false, message, title: "Действие недоступно", detail: message, elapsedMinutes: 0, balanceDelta: 0, healthDelta: 0, fatigueDelta: 0, stressDelta: 0, importance: 1 };
}

function result(state: PlayerLoopState, message: string, title: string, detail: string, elapsedMinutes: number, balanceDelta: number, healthDelta: number, fatigueDelta: number, stressDelta: number, importance: 1 | 2 | 3 = 1): PlayerLoopActionResult {
  return { state, ok: true, message, title, detail, elapsedMinutes, balanceDelta, healthDelta, fatigueDelta, stressDelta, importance };
}

function addSkill(state: PlayerLoopState, skill: PlayerSkill, gain: number): PlayerLoopState {
  return { ...state, skills: { ...state.skills, [skill]: clamp(state.skills[skill] + gain) } };
}

function equippedItems(state: PlayerLoopState): EquipmentDefinition[] {
  return Object.values(state.equipped).map((id) => getEquipment(id)).filter((item): item is EquipmentDefinition => Boolean(item));
}

export function equipmentCombatTotals(state: PlayerLoopState): { attack: number; defense: number; accuracy: number; intimidation: number; weaponClass: "unarmed" | "melee" | "firearm" } {
  const items = equippedItems(state);
  return {
    attack: items.reduce((sum, item) => sum + item.attack, 0),
    defense: items.reduce((sum, item) => sum + item.defense, 0),
    accuracy: items.reduce((sum, item) => sum + item.accuracy, 0),
    intimidation: items.reduce((sum, item) => sum + item.intimidation, 0),
    weaponClass: getEquipment(state.equipped.weapon)?.weaponClass ?? "unarmed"
  };
}

export function registerEquipmentPurchase(state: PlayerLoopState, itemId: string, input: PlayerLoopActionInput, price: number): PlayerLoopState | null {
  const item = getEquipment(itemId);
  if (!item || item.price <= 0 || state.ownedEquipmentIds.includes(item.id)) return null;
  if (item.requiredSkill && state.skills[item.requiredSkill] < (item.minimumSkill ?? 0)) return null;
  return history({ ...state, ownedEquipmentIds: [...state.ownedEquipmentIds, item.id] }, input, "equipment", `Куплено: ${item.name}`, item.description, -Math.abs(price));
}

export function resolveStreetFightAgainstActor(state: PlayerLoopState, input: PlayerLoopActionInput, opponent: { id: string; name: string; power: number }): PlayerLoopActionResult {
  if (input.health < 35 || input.fatigue > 86) return reject(state, "Состояние слишком плохое для драки");
  if (state.lastFightAt && input.timestamp - state.lastFightAt < FIGHT_COOLDOWN_MS) return reject(state, "После прошлой драки нужно восстановиться");
  const rng = new SeededRandom(`${input.seed}:street-fight:${opponent.id}:${Math.floor(input.timestamp / 60_000)}`);
  const gear = equipmentCombatTotals(state);
  const combatSkill = gear.weaponClass === "firearm" ? state.skills.shooting : gear.weaponClass === "unarmed" ? state.skills.boxing : state.skills.streetwise;
  const playerScore = state.skills.strength * .42 + state.skills.endurance * .24 + combatSkill * .5 + state.skills.streetwise * .18 + gear.attack + gear.defense * .45 + gear.accuracy * .6 + rng.integer(0, 18);
  const opponentScore = opponent.power + rng.integer(8, 26);
  const won = playerScore >= opponentScore;
  const damage = won ? rng.integer(1, Math.max(3, Math.round(opponent.power / 16))) : rng.integer(8, Math.max(13, Math.round(opponent.power / 3)));
  const streetGain = won ? rng.integer(2, 4) : 1;
  let next = addSkill({
    ...state,
    streetFightWins: state.streetFightWins + (won ? 1 : 0),
    streetFightLosses: state.streetFightLosses + (won ? 0 : 1),
    lastFightAt: input.timestamp + 6 * 60_000
  }, "streetwise", streetGain);
  const detail = `${won ? "Победа" : "Поражение"}. Улица +${streetGain}. Здоровье −${damage}.`;
  next = history(next, input, "fight", `Драка: ${opponent.name}`, detail, 0);
  return result(next, `${won ? "Победа" : "Поражение"}: ${opponent.name}`, `Драка: ${opponent.name}`, detail, 6, 0, -damage, won ? 8 : 14, won ? 5 : 11, won ? 2 : 3);
}

function actionRng(input: PlayerLoopActionInput, action: PlayerLoopAction): SeededRandom {
  return new SeededRandom(`${input.seed}:player-loop-action:${input.timestamp}:${JSON.stringify(action)}`);
}

export function resolvePlayerLoopAction(state: PlayerLoopState, action: PlayerLoopAction, input: PlayerLoopActionInput): PlayerLoopActionResult {
  const rng = actionRng(input, action);

  if (action.kind === "select-job") {
    const job = PLAYER_JOBS.find((item) => item.id === action.jobId);
    if (!job) return reject(state, "Работа не существует");
    if (state.skills[job.skill] < job.minimumSkill) return reject(state, `Нужен навык «${skillLabel(job.skill)}» ${job.minimumSkill}`);
    const next = history({ ...state, activeJobId: job.id }, input, "work", `Устройство: ${job.title}`, "Работа выбрана. Смена выполняется одной кнопкой.", 0);
    return result(next, `Работа выбрана: ${job.title}`, `Новая работа: ${job.title}`, job.description, 30, 0, 0, 1, 1);
  }

  if (action.kind === "leave-job") {
    const job = getPlayerJob(state);
    if (!job) return reject(state, "Активной работы нет");
    const next = history({ ...state, activeJobId: null }, input, "work", `Увольнение: ${job.title}`, "Рабочий цикл закрыт.", 0);
    return result(next, `Ты уволился: ${job.title}`, `Увольнение: ${job.title}`, "Активной работы больше нет.", 10, 0, 0, 0, -1);
  }

  if (action.kind === "work-shift") {
    const job = getPlayerJob(state);
    if (!job) return reject(state, "Сначала выбери работу");
    if (input.health < 20) return reject(state, "Состояние слишком тяжёлое для смены");
    if (input.fatigue > 92) return reject(state, "Ты слишком устал для смены");
    const skill = state.skills[job.skill];
    const pay = Math.max(20, Math.round(job.basePay * (0.88 + skill / 220) + rng.integer(-8, 16)));
    const gain = rng.integer(1, skill < 45 ? 3 : 2);
    const incident = rng.integer(1, 100) <= job.risk;
    const incidentHealth = incident ? -rng.integer(2, 8) : 0;
    const incidentStress = incident ? rng.integer(4, 9) : 0;
    const detail = incident
      ? `Получено ₵ ${pay}. ${skillLabel(job.skill)} +${gain}. На смене произошёл неприятный инцидент.`
      : `Получено ₵ ${pay}. ${skillLabel(job.skill)} +${gain}.`;
    let next = addSkill({ ...state, shiftsWorked: state.shiftsWorked + 1, totalEarned: state.totalEarned + pay }, job.skill, gain);
    next = history(next, input, "work", `Смена: ${job.title}`, detail, pay);
    return result(next, `Смена завершена · +₵ ${pay} · ${skillLabel(job.skill)} +${gain}`, `Смена: ${job.title}`, detail, job.durationMinutes, pay, incidentHealth, job.fatigue, job.stress + incidentStress, incident ? 2 : 1);
  }

  if (action.kind === "train") {
    const training = TRAINING_ACTIONS.find((item) => item.id === action.trainingId);
    if (!training) return reject(state, "Тренировка не существует");
    if (input.balance < training.cost) return reject(state, `Не хватает ₵ ${training.cost - input.balance}`);
    if (input.health < 28 || input.fatigue > 88) return reject(state, "Состояние не позволяет тренироваться");
    const gain = rng.integer(training.gainMin, training.gainMax);
    const injured = rng.integer(1, 100) <= training.injuryRisk + Math.max(0, Math.round((input.fatigue - 60) / 5));
    const healthDelta = injured ? -rng.integer(4, 12) : 0;
    const detail = `${skillLabel(training.skill)} +${gain}.${injured ? " Получена лёгкая травма." : ""}`;
    let next = addSkill(state, training.skill, gain);
    next = history(next, input, "training", training.title, detail, -training.cost);
    return result(next, `${training.title} · ${skillLabel(training.skill)} +${gain}`, training.title, detail, training.durationMinutes, -training.cost, healthDelta, training.fatigue, injured ? 5 : -1, injured ? 2 : 1);
  }

  if (action.kind === "equip-item") {
    const item = getEquipment(action.itemId);
    if (!item || !state.ownedEquipmentIds.includes(item.id)) return reject(state, "Предмет не принадлежит игроку");
    const next = history({ ...state, equipped: { ...state.equipped, [item.slot]: item.id } }, input, "equipment", `Экипировано: ${item.name}`, `${equipmentSlotLabel(item.slot)} обновлён.`, 0);
    return result(next, `Экипировано: ${item.name}`, `Экипировано: ${item.name}`, item.description, 0, 0, 0, 0, 0);
  }

  if (action.kind === "unequip-item") {
    if (!state.equipped[action.slot]) return reject(state, "Слот уже пуст");
    if (action.slot === "outfit") return reject(state, "Базовую одежду снять нельзя");
    const equipped = { ...state.equipped };
    delete equipped[action.slot];
    const next = history({ ...state, equipped }, input, "equipment", `Снято: ${equipmentSlotLabel(action.slot)}`, "Слот освобождён.", 0);
    return result(next, `Снято: ${equipmentSlotLabel(action.slot)}`, "Снаряжение снято", `${equipmentSlotLabel(action.slot)}: пусто.`, 0, 0, 0, 0, 0);
  }

  if (action.kind === "boxing-fight") {
    if (input.health < 45 || input.fatigue > 78) return reject(state, "К бою нужно подойти восстановленным");
    if (state.lastFightAt && input.timestamp - state.lastFightAt < FIGHT_COOLDOWN_MS) return reject(state, "После прошлой драки нужно восстановиться");
    const rank = Math.max(0, Math.min(6, state.boxingRank));
    const opponent = 24 + rank * 11 + Math.round(state.boxingRating / 12);
    const playerScore = state.skills.boxing * .62 + state.skills.endurance * .28 + state.skills.strength * .18 + rng.integer(0, 20);
    const opponentScore = opponent + rng.integer(0, 20);
    const won = playerScore >= opponentScore;
    const damage = won ? rng.integer(2, 8 + rank) : rng.integer(9, 20 + rank * 2);
    const ratingDelta = won ? rng.integer(12, 22) : -rng.integer(5, 12);
    const boxingGain = won ? rng.integer(2, 4) : rng.integer(1, 3);
    const purse = won ? 50 + rank * 85 : rank >= 2 ? 25 + rank * 20 : 0;
    const nextRating = Math.max(0, state.boxingRating + ratingDelta);
    const nextRank = won && nextRating >= (rank + 1) * 80 ? Math.min(6, rank + 1) : rank;
    let next = addSkill({
      ...state,
      boxingWins: state.boxingWins + (won ? 1 : 0),
      boxingLosses: state.boxingLosses + (won ? 0 : 1),
      boxingRating: nextRating,
      boxingRank: nextRank,
      lastFightAt: input.timestamp + 60 * 60_000
    }, "boxing", boxingGain);
    const promoted = nextRank > rank;
    const detail = `${won ? "Победа" : "Поражение"}. Бокс +${boxingGain}. Рейтинг ${ratingDelta >= 0 ? "+" : ""}${ratingDelta}. Здоровье −${damage}.${purse ? ` Гонорар ₵ ${purse}.` : ""}${promoted ? ` Новый ранг: ${boxingRankLabel(nextRank)}.` : ""}`;
    next = history(next, input, "boxing", `Боксёрский бой: ${boxingRankLabel(rank)}`, detail, purse);
    return result(next, `${won ? "Победа" : "Поражение"} в ринге`, `Боксёрский бой: ${boxingRankLabel(rank)}`, detail, 60, purse, -damage, 18, won ? 5 : 10, won ? 2 : 3);
  }

  return reject(state, "Неизвестное действие");
}
