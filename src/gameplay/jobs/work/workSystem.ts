import { createStableEntityId } from "../../../core/ids/entityId";
import { SeededRandom } from "../../../core/random/seededRandom";
import type { VenueState } from "../../../simulation/urban/types";
import type { VenueLedgerEntryState, VenueOperationState, VenueOperationsState } from "../../../simulation/venues/types";
import type {
  PlayerWorkApplicationState,
  PlayerWorkContractState,
  PlayerWorkDebtResult,
  PlayerWorkFinishResult,
  PlayerWorkInput,
  PlayerWorkInterviewInput,
  PlayerWorkRole,
  PlayerWorkShiftState,
  PlayerWorkSkill,
  PlayerWorkSkillsState,
  PlayerWorkState,
  PlayerWorkTaskKind,
  PlayerWorkTaskResult,
  PlayerWorkTaskState,
  PlayerWorkVacancyState
} from "./types";

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const MAX_HISTORY_SHIFTS = 80;
const MAX_TASKS = 360;
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];
const INTERVIEW_RETRY_MS = 3 * DAY_MS;

interface RoleTemplate {
  role: PlayerWorkRole;
  title: string;
  skill: PlayerWorkSkill;
  baseMinimumSkill: number;
  baseWage: number;
}

const COURIER_ROLE: RoleTemplate = { role: "courier", title: "Курьер MESHLINE", skill: "service", baseMinimumSkill: 16, baseWage: 0 };

const ROLE_BY_CATEGORY: Partial<Record<VenueState["category"], RoleTemplate>> = {
  convenience: { role: "cashier", title: "Кассир торговой точки", skill: "service", baseMinimumSkill: 16, baseWage: 11 },
  market: { role: "cashier", title: "Кассир рынка", skill: "service", baseMinimumSkill: 18, baseWage: 12 },
  food: { role: "cafe-crew", title: "Сотрудник кафе", skill: "cooking", baseMinimumSkill: 17, baseWage: 12 },
  bar: { role: "cafe-crew", title: "Сотрудник ночной смены", skill: "cooking", baseMinimumSkill: 20, baseWage: 14 },
  clinic: { role: "clinic-aide", title: "Санитар клиники", skill: "medical", baseMinimumSkill: 24, baseWage: 17 },
  pharmacy: { role: "clinic-aide", title: "Помощник медпоста", skill: "medical", baseMinimumSkill: 21, baseWage: 15 },
  repair: { role: "mechanic", title: "Механик мастерской", skill: "technical", baseMinimumSkill: 23, baseWage: 18 }
};

const TASKS_BY_ROLE: Record<PlayerWorkRole, Array<Omit<PlayerWorkTaskState, "id" | "shiftId" | "status" | "quality">>> = {
  cashier: [
    { kind: "serve-customer", label: "Обслужить покупателя", description: "Провести заказ через кассу и выдать товар.", skill: "service", durationMinutes: 18 },
    { kind: "check-shelves", label: "Проверить полки", description: "Сверить остатки и убрать просроченные позиции.", skill: "service", durationMinutes: 22 },
    { kind: "serve-customer", label: "Разобрать очередь", description: "Принять следующего клиента без ошибки в оплате.", skill: "service", durationMinutes: 20 },
    { kind: "reconcile-register", label: "Сверить кассу", description: "Проверить наличные и закрыть промежуточный отчёт.", skill: "service", durationMinutes: 25 },
    { kind: "serve-customer", label: "Закрыть поток", description: "Обслужить последнего клиента блока.", skill: "service", durationMinutes: 18 }
  ],
  "cafe-crew": [
    { kind: "take-order", label: "Принять заказ", description: "Зафиксировать заказ и передать его на кухню.", skill: "service", durationMinutes: 14 },
    { kind: "prepare-meal", label: "Приготовить блюдо", description: "Собрать заказ из доступных ингредиентов.", skill: "cooking", durationMinutes: 28 },
    { kind: "handoff-order", label: "Выдать заказ", description: "Проверить комплектность и передать клиенту.", skill: "service", durationMinutes: 12 },
    { kind: "prepare-meal", label: "Закрыть второй заказ", description: "Приготовить ещё одну позицию без потери качества.", skill: "cooking", durationMinutes: 30 },
    { kind: "handoff-order", label: "Разгрузить стойку", description: "Выдать готовый заказ и освободить очередь.", skill: "service", durationMinutes: 12 }
  ],
  "clinic-aide": [
    { kind: "register-patient", label: "Оформить пациента", description: "Проверить данные и занести пациента в очередь.", skill: "medical", durationMinutes: 18 },
    { kind: "carry-supplies", label: "Доставить расходники", description: "Принести медикаменты в рабочий кабинет.", skill: "medical", durationMinutes: 20 },
    { kind: "assist-care", label: "Помочь на процедуре", description: "Подготовить место и ассистировать специалисту.", skill: "medical", durationMinutes: 32 },
    { kind: "register-patient", label: "Разобрать приём", description: "Оформить следующего пациента без задержки.", skill: "medical", durationMinutes: 18 },
    { kind: "assist-care", label: "Закрыть медицинский случай", description: "Помочь завершить процедуру и убрать место.", skill: "medical", durationMinutes: 30 }
  ],
  mechanic: [
    { kind: "inspect-vehicle", label: "Осмотреть машину", description: "Провести первичную диагностику узлов.", skill: "technical", durationMinutes: 25 },
    { kind: "fetch-parts", label: "Получить детали", description: "Сверить заказ и принести комплект со склада.", skill: "technical", durationMinutes: 22 },
    { kind: "repair-vehicle", label: "Выполнить ремонт", description: "Устранить найденную неисправность.", skill: "technical", durationMinutes: 45 },
    { kind: "inspect-vehicle", label: "Проверить результат", description: "Провести контрольную диагностику.", skill: "technical", durationMinutes: 20 },
    { kind: "repair-vehicle", label: "Закрыть заказ", description: "Довести машину до выдачи клиенту.", skill: "technical", durationMinutes: 38 }
  ],
  courier: [
    { kind: "scan-manifest", label: "Проверить терминал", description: "Получить список доступных заказов и ограничения по грузу.", skill: "service", durationMinutes: 10 },
    { kind: "sort-cargo", label: "Сверить груз", description: "Проверить пломбу, массу и точку выдачи.", skill: "service", durationMinutes: 12 },
    { kind: "dispatch-run", label: "Закрыть маршрут", description: "Доставить заказ и подтвердить передачу клиенту.", skill: "service", durationMinutes: 30 }
  ]
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function dayIndex(timestamp: number): number {
  return Math.floor(timestamp / DAY_MS);
}

function startOfUtcDay(timestamp: number): number {
  return dayIndex(timestamp) * DAY_MS;
}

function nextWorkStart(timestamp: number, hour: number, workDays = DEFAULT_WORK_DAYS, includeToday = true): number {
  const baseDay = startOfUtcDay(timestamp);
  for (let offset = includeToday ? 0 : 1; offset <= 14; offset += 1) {
    const candidate = baseDay + offset * DAY_MS + hour * HOUR_MS;
    const weekday = new Date(candidate).getUTCDay();
    if (!workDays.includes(weekday)) continue;
    if (candidate >= timestamp - (includeToday ? 60 * 60_000 : 0)) return candidate;
  }
  return baseDay + 24 * HOUR_MS + hour * HOUR_MS;
}

function isCourierVenue(venue: VenueState): boolean {
  const search = `${venue.name} ${venue.code} ${venue.tags.join(" ")}`.toUpperCase();
  return venue.category === "office-service" && (search.includes("MESHLINE") || search.includes("DISPATCH") || search.includes("LOGISTICS"));
}

function roleTemplate(venue: VenueState): RoleTemplate | null {
  if (isCourierVenue(venue)) return COURIER_ROLE;
  return ROLE_BY_CATEGORY[venue.category] ?? null;
}

function initialSkills(seed: string): PlayerWorkSkillsState {
  const rng = new SeededRandom(`${seed}:player-work-skills:v1`);
  return {
    service: rng.integer(18, 29),
    cooking: rng.integer(15, 27),
    medical: rng.integer(12, 23),
    technical: rng.integer(16, 28)
  };
}

function vacancyFor(seed: string, timestamp: number, venue: VenueState, operation: VenueOperationState): PlayerWorkVacancyState | null {
  const template = roleTemplate(venue);
  if (!template || operation.status !== "operating") return null;
  const rng = new SeededRandom(`${seed}:player-work-vacancy:${venue.id}:v1`);
  const courier = template.role === "courier";
  const targetStaff = Math.max(1, Math.ceil(venue.demand / 34) + (operation.queue.waitingCount >= 5 ? 1 : 0));
  const staffingShortage = Math.max(0, targetStaff - operation.staffPresent);
  const operationalPressure = operation.queue.waitingCount + staffingShortage * 4;
  // A vacancy is a real staffing need, not decorative board filler.
  if (!courier && staffingShortage <= 0 && operationalPressure < 5) return null;
  const shiftStartHour = courier ? 0 : venue.category === "bar"
    ? Math.max(17, venue.openHour)
    : venue.openHour === 0 ? rng.pick([6, 8, 14, 16] as const) : Math.min(20, venue.openHour + rng.integer(0, 2));
  const minimumSkill = Math.round(clamp(template.baseMinimumSkill + venue.quality / 15 + venue.priceTier * 2 + rng.integer(-4, 4), 12, 48));
  const wagePerHour = courier ? 0 : Math.max(8, Math.round(template.baseWage + venue.priceTier * 2.2 + venue.quality / 22 + rng.integer(-1, 3)));
  return {
    id: createStableEntityId("player-work-vacancy", `${venue.id}:${template.role}`),
    venueId: venue.id,
    buildingId: venue.buildingId,
    unitId: venue.unitId,
    role: template.role,
    title: template.title,
    requiredSkill: template.skill,
    minimumSkill,
    wagePerHour,
    shiftStartHour,
    shiftDurationHours: courier ? 0 : 8,
    postedAt: timestamp,
    expiresAt: timestamp + 7 * DAY_MS,
    status: "open"
  };
}

function refreshVacancies(state: PlayerWorkState, input: PlayerWorkInput): PlayerWorkVacancyState[] {
  const operationById = new Map(input.venueOperations.operations.map((operation) => [operation.venueId, operation]));
  const previousById = new Map(state.vacancies.map((vacancy) => [vacancy.id, vacancy]));
  const contractVacancyIds = new Set(state.contracts.filter((contract) => contract.status === "active" || contract.status === "warning").map((contract) => contract.vacancyId));
  const generated = input.venues.flatMap((venue) => {
    const operation = operationById.get(venue.id);
    if (!operation) return [];
    const fresh = vacancyFor(input.seed, input.timestamp, venue, operation);
    if (!fresh) return [];
    const previous = previousById.get(fresh.id);
    if (contractVacancyIds.has(fresh.id)) return [{ ...fresh, status: "filled" as const }];
    if (previous?.status === "offered") return [{ ...fresh, ...previous, expiresAt: Math.max(previous.expiresAt, fresh.expiresAt) }];
    return [{ ...fresh, status: "open" as const }];
  });
  return generated
    .sort((left, right) => left.minimumSkill - right.minimumSkill || right.wagePerHour - left.wagePerHour)
    .slice(0, 160);
}

export function createPlayerWorkState(input: PlayerWorkInput): PlayerWorkState {
  const base: PlayerWorkState = {
    version: 1,
    vacancies: [],
    applications: [],
    contracts: [],
    shifts: [],
    tasks: [],
    skills: initialSkills(input.seed),
    totalEarned: 0,
    totalUnpaid: 0,
    lastVacancyRefreshDay: dayIndex(input.timestamp),
    lastUpdatedAt: input.timestamp
  };
  return { ...base, vacancies: refreshVacancies(base, input) };
}

export function normalizePlayerWorkState(value: unknown, input: PlayerWorkInput): PlayerWorkState {
  if (!value || typeof value !== "object") return createPlayerWorkState(input);
  const raw = value as Partial<PlayerWorkState>;
  const base = createPlayerWorkState(input);
  const normalized: PlayerWorkState = {
    ...base,
    ...raw,
    version: 1,
    vacancies: Array.isArray(raw.vacancies) ? raw.vacancies : base.vacancies,
    applications: Array.isArray(raw.applications) ? raw.applications : [],
    contracts: Array.isArray(raw.contracts) ? raw.contracts : [],
    shifts: Array.isArray(raw.shifts) ? raw.shifts.slice(-MAX_HISTORY_SHIFTS) : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks.slice(-MAX_TASKS) : [],
    skills: { ...base.skills, ...(raw.skills ?? {}) },
    totalEarned: raw.totalEarned ?? 0,
    totalUnpaid: raw.totalUnpaid ?? 0,
    lastVacancyRefreshDay: raw.lastVacancyRefreshDay ?? dayIndex(input.timestamp),
    lastUpdatedAt: raw.lastUpdatedAt ?? input.timestamp
  };
  return advancePlayerWorkState(normalized, input);
}

function markMissedShifts(state: PlayerWorkState, timestamp: number): PlayerWorkState {
  let contracts = state.contracts.map((contract) => ({ ...contract }));
  const shifts = [...state.shifts];
  let activeContractId = state.activeContractId;
  for (let index = 0; index < contracts.length; index += 1) {
    let contract = contracts[index];
    if (contract.status !== "active" && contract.status !== "warning") continue;
    if (contract.role === "courier") continue;
    const inProgress = state.shifts.some((shift) => shift.contractId === contract.id && shift.status === "in-progress");
    if (inProgress) continue;
    while (timestamp > contract.nextShiftAt + 3 * HOUR_MS && contract.warningCount < 3) {
      const missedId = createStableEntityId("player-work-shift", `${contract.id}:${contract.nextShiftAt}`);
      if (!shifts.some((shift) => shift.id === missedId)) {
        shifts.push({
          id: missedId,
          contractId: contract.id,
          venueId: contract.venueId,
          scheduledStartAt: contract.nextShiftAt,
          scheduledEndAt: contract.nextShiftAt + contract.shiftDurationHours * HOUR_MS,
          status: "missed",
          lateMinutes: Math.round((timestamp - contract.nextShiftAt) / 60_000),
          taskIds: [],
          completedTaskCount: 0,
          quality: 0,
          grossPay: 0,
          paidAmount: 0,
          unpaidAmount: 0
        });
      }
      const warningCount = contract.warningCount + 1;
      const dismissed = warningCount >= 3;
      contract = {
        ...contract,
        warningCount,
        status: dismissed ? "dismissed" : "warning",
        nextShiftAt: nextWorkStart(contract.nextShiftAt + DAY_MS, contract.shiftStartHour, contract.workDays, true),
        dismissedAt: dismissed ? timestamp : contract.dismissedAt,
        dismissalReason: dismissed ? "Три пропущенные смены" : contract.dismissalReason
      };
      if (dismissed) break;
    }
    contracts[index] = contract;
    if (contract.status === "dismissed" && activeContractId === contract.id) activeContractId = undefined;
  }
  return { ...state, contracts, shifts: shifts.slice(-MAX_HISTORY_SHIFTS), activeContractId };
}

export function advancePlayerWorkState(state: PlayerWorkState | undefined, input: PlayerWorkInput): PlayerWorkState {
  const current = state ?? createPlayerWorkState(input);
  if (input.timestamp < current.lastUpdatedAt) return current;
  let next = markMissedShifts(current, input.timestamp);
  if (dayIndex(input.timestamp) !== next.lastVacancyRefreshDay || !next.vacancies.length) {
    next = { ...next, vacancies: refreshVacancies(next, input), lastVacancyRefreshDay: dayIndex(input.timestamp) };
  }
  return { ...next, lastUpdatedAt: input.timestamp };
}

export function interviewPlayerForVacancy(state: PlayerWorkState, vacancyId: string, input: PlayerWorkInterviewInput): PlayerWorkState {
  const vacancy = state.vacancies.find((item) => item.id === vacancyId && item.status === "open");
  if (!vacancy || state.contracts.some((contract) => contract.status === "active" || contract.status === "warning")) return state;
  const existing = state.applications
    .filter((application) => application.vacancyId === vacancyId && application.status !== "withdrawn")
    .sort((left, right) => right.interviewedAt - left.interviewedAt)[0];
  if (existing?.status === "accepted") return state;
  if (existing?.status === "rejected" && input.timestamp < existing.interviewedAt + INTERVIEW_RETRY_MS) return state;
  const rng = new SeededRandom(`${input.seed}:player-work-interview:${vacancyId}:${dayIndex(input.timestamp)}`);
  const skill = state.skills[vacancy.requiredSkill];
  const condition = input.playerHealth * .12 - input.playerFatigue * .1 - input.playerStress * .08;
  const score = Math.round(skill + condition + rng.integer(4, 17));
  const accepted = score >= vacancy.minimumSkill - 4;
  const application: PlayerWorkApplicationState = {
    id: createStableEntityId("player-work-application", `${vacancy.id}:${input.timestamp}`),
    vacancyId: vacancy.id,
    venueId: vacancy.venueId,
    status: accepted ? "accepted" : "rejected",
    score,
    interviewedAt: input.timestamp,
    decisionText: accepted
      ? vacancy.role === "courier"
        ? "Диспетчер предлагает контракт курьера со свободным графиком и оплатой за заказ."
        : `Управляющий предлагает контракт: ₵ ${vacancy.wagePerHour}/ч.`
      : `Отказ: требуется ${vacancy.requiredSkill} ${vacancy.minimumSkill}, результат собеседования ${score}.`
  };
  const applications = state.applications.map((item) => item.id === existing?.id ? { ...item, status: "withdrawn" as const } : item);
  return {
    ...state,
    applications: [...applications, application].slice(-80),
    vacancies: state.vacancies.map((item) => item.id === vacancy.id ? { ...item, status: accepted ? "offered" : "open" } : item),
    lastUpdatedAt: input.timestamp
  };
}

export function signPlayerWorkContract(state: PlayerWorkState, vacancyId: string, timestamp: number): PlayerWorkState {
  const vacancy = state.vacancies.find((item) => item.id === vacancyId && item.status === "offered");
  const application = state.applications.find((item) => item.vacancyId === vacancyId && item.status === "accepted");
  if (!vacancy || !application || state.contracts.some((contract) => contract.status === "active" || contract.status === "warning")) return state;
  const contract: PlayerWorkContractState = {
    id: createStableEntityId("player-work-contract", `${vacancy.id}:${timestamp}`),
    vacancyId: vacancy.id,
    venueId: vacancy.venueId,
    role: vacancy.role,
    title: vacancy.title,
    status: "active",
    wagePerHour: vacancy.wagePerHour,
    shiftStartHour: vacancy.shiftStartHour,
    shiftDurationHours: vacancy.shiftDurationHours,
    workDays: vacancy.role === "courier" ? [] : [...DEFAULT_WORK_DAYS],
    startedAt: timestamp,
    nextShiftAt: vacancy.role === "courier" ? timestamp : nextWorkStart(timestamp, vacancy.shiftStartHour, DEFAULT_WORK_DAYS, true),
    completedShifts: 0,
    probationShifts: 3,
    warningCount: 0,
    unpaidWages: 0,
    rank: 1
  };
  return {
    ...state,
    contracts: [...state.contracts, contract],
    activeContractId: contract.id,
    vacancies: state.vacancies.map((item) => item.id === vacancy.id ? { ...item, status: "filled" } : item),
    lastUpdatedAt: timestamp
  };
}

function tasksForShift(seed: string, shift: PlayerWorkShiftState, role: PlayerWorkRole): PlayerWorkTaskState[] {
  return TASKS_BY_ROLE[role].map((template, index) => ({
    ...template,
    id: createStableEntityId("player-work-task", `${seed}:${shift.id}:${index}`),
    shiftId: shift.id,
    status: "pending" as const,
    quality: 0
  }));
}

export function startPlayerWorkShift(state: PlayerWorkState, contractId: string, timestamp: number): PlayerWorkState {
  const contract = state.contracts.find((item) => item.id === contractId && (item.status === "active" || item.status === "warning"));
  if (!contract || state.activeShiftId || contract.role === "courier") return state;
  if (timestamp < contract.nextShiftAt - HOUR_MS || timestamp > contract.nextShiftAt + 3 * HOUR_MS) return state;
  const lateMinutes = Math.max(0, Math.round((timestamp - contract.nextShiftAt) / 60_000));
  const warnings = lateMinutes >= 30 ? contract.warningCount + 1 : contract.warningCount;
  if (warnings >= 3) {
    return {
      ...state,
      activeContractId: state.activeContractId === contract.id ? undefined : state.activeContractId,
      contracts: state.contracts.map((item) => item.id === contract.id ? {
        ...item,
        warningCount: warnings,
        status: "dismissed" as const,
        dismissedAt: timestamp,
        dismissalReason: "Третье дисциплинарное нарушение"
      } : item),
      vacancies: state.vacancies.map((item) => item.id === contract.vacancyId ? {
        ...item,
        status: "open" as const,
        postedAt: timestamp,
        expiresAt: timestamp + 7 * DAY_MS
      } : item),
      lastUpdatedAt: timestamp
    };
  }
  const shift: PlayerWorkShiftState = {
    id: createStableEntityId("player-work-shift", `${contract.id}:${contract.nextShiftAt}`),
    contractId: contract.id,
    venueId: contract.venueId,
    scheduledStartAt: contract.nextShiftAt,
    scheduledEndAt: contract.nextShiftAt + contract.shiftDurationHours * HOUR_MS,
    status: "in-progress",
    startedAt: timestamp,
    lateMinutes,
    taskIds: [],
    completedTaskCount: 0,
    quality: 50,
    grossPay: 0,
    paidAmount: 0,
    unpaidAmount: 0
  };
  const tasks = tasksForShift(`${contract.id}:${contract.completedShifts}`, shift, contract.role);
  shift.taskIds = tasks.map((task) => task.id);
  return {
    ...state,
    activeShiftId: shift.id,
    shifts: [...state.shifts, shift].slice(-MAX_HISTORY_SHIFTS),
    tasks: [...state.tasks, ...tasks].slice(-MAX_TASKS),
    contracts: state.contracts.map((item) => item.id === contract.id ? { ...item, warningCount: warnings, status: warnings > 0 ? "warning" : item.status } : item),
    lastUpdatedAt: timestamp
  };
}

function taskCreatesSale(kind: PlayerWorkTaskKind): boolean {
  return kind === "serve-customer" || kind === "handoff-order" || kind === "assist-care" || kind === "repair-vehicle";
}

function accountId(venueId: string): string {
  return `venue-account:${venueId}`;
}

function applyTaskToVenueOperations(
  operationsState: VenueOperationsState,
  venue: VenueState,
  task: PlayerWorkTaskState,
  timestamp: number
): VenueOperationsState {
  const operation = operationsState.operations.find((item) => item.venueId === venue.id);
  if (!operation) return operationsState;
  const available = operation.offers.filter((offer) => offer.active && offer.stock > 0);
  const soldOffer = taskCreatesSale(task.kind) && available.length ? available[task.id.charCodeAt(task.id.length - 1) % available.length] : undefined;
  const salePrice = soldOffer?.currentPrice ?? 0;
  const operations = operationsState.operations.map((item) => item.venueId !== venue.id ? item : {
    ...item,
    cash: item.cash + salePrice,
    revenueToday: item.revenueToday + salePrice,
    lifetimeRevenue: item.lifetimeRevenue + salePrice,
    offers: soldOffer ? item.offers.map((offer) => offer.id === soldOffer.id ? { ...offer, stock: Math.max(0, offer.stock - 1) } : offer) : item.offers,
    queue: {
      ...item.queue,
      waitingCount: Math.max(0, item.queue.waitingCount - (taskCreatesSale(task.kind) ? 1 : 0)),
      estimatedWaitMinutes: Math.max(0, item.queue.estimatedWaitMinutes - (taskCreatesSale(task.kind) ? 3 : 1)),
      servedToday: item.queue.servedToday + (taskCreatesSale(task.kind) ? 1 : 0)
    }
  });
  let ledger = operationsState.ledger;
  if (soldOffer && salePrice > 0) {
    const entry: VenueLedgerEntryState = {
      id: createStableEntityId("venue-ledger", `${venue.id}:work-sale:${task.id}:${timestamp}`),
      idempotencyKey: `${venue.id}:work-sale:${task.id}`,
      timestamp: timestamp + 1,
      venueId: venue.id,
      kind: "sale",
      debitEntityId: `consumer-pool:${venue.districtId}`,
      creditEntityId: accountId(venue.id),
      amount: salePrice,
      description: `${venue.name}: продажа во время смены игрока`,
      postToKernel: true
    };
    ledger = [...ledger, entry].slice(-1_200);
  }
  return {
    ...operationsState,
    operations,
    ledger,
    totals: {
      ...operationsState.totals,
      waitingCustomers: operations.reduce((sum, item) => sum + item.queue.waitingCount, 0),
      sales: operations.reduce((sum, item) => sum + item.queue.servedToday, 0),
      revenue: operations.reduce((sum, item) => sum + item.lifetimeRevenue, 0),
      stockUnits: operations.reduce((sum, item) => sum + item.offers.reduce((offerSum, offer) => offerSum + offer.stock, 0), 0)
    }
  };
}

export function completePlayerWorkTask(
  state: PlayerWorkState,
  taskId: string,
  input: PlayerWorkInput
): PlayerWorkTaskResult | null {
  const shift = state.shifts.find((item) => item.id === state.activeShiftId && item.status === "in-progress");
  const task = state.tasks.find((item) => item.id === taskId && item.shiftId === shift?.id && item.status === "pending");
  const contract = state.contracts.find((item) => item.id === shift?.contractId);
  const venue = input.venues.find((item) => item.id === shift?.venueId)
    ?? input.venueOperations.registry.find((entry) => entry.venue.id === shift?.venueId)?.venue;
  if (!shift || !task || !contract || !venue) return null;
  const skillBefore = state.skills[task.skill];
  const rng = new SeededRandom(`${input.seed}:work-task:${task.id}:${input.timestamp}`);
  const quality = clamp(48 + skillBefore * .72 - Math.max(0, contract.warningCount * 2) + rng.integer(-8, 12));
  const alreadyPracticed = state.tasks.some((item) => item.shiftId === shift.id && item.status === "completed" && item.skill === task.skill);
  const skillGain = alreadyPracticed ? 0 : quality >= 85 ? 2 : 1;
  const tasks = state.tasks.map((item) => item.id === task.id ? { ...item, status: "completed" as const, quality, completedAt: input.timestamp + task.durationMinutes * 60_000 } : item);
  const completed = tasks.filter((item) => item.shiftId === shift.id && item.status === "completed");
  const averageQuality = Math.round(completed.reduce((sum, item) => sum + item.quality, 0) / Math.max(1, completed.length));
  const shifts = state.shifts.map((item) => item.id === shift.id ? { ...item, completedTaskCount: completed.length, quality: averageQuality } : item);
  const skills = { ...state.skills, [task.skill]: clamp(skillBefore + skillGain) };
  return {
    state: { ...state, tasks, shifts, skills, lastUpdatedAt: input.timestamp },
    venueOperations: applyTaskToVenueOperations(input.venueOperations, venue, task, input.timestamp),
    durationMinutes: task.durationMinutes,
    message: `${task.label}: выполнено · качество ${quality}%`
  };
}

export function finishPlayerWorkShift(state: PlayerWorkState, input: PlayerWorkInput): PlayerWorkFinishResult | null {
  const shift = state.shifts.find((item) => item.id === state.activeShiftId && item.status === "in-progress");
  const contract = state.contracts.find((item) => item.id === shift?.contractId);
  const venue = input.venues.find((item) => item.id === shift?.venueId)
    ?? input.venueOperations.registry.find((entry) => entry.venue.id === shift?.venueId)?.venue;
  const operation = input.venueOperations.operations.find((item) => item.venueId === shift?.venueId);
  if (!shift || !contract || !venue || !operation) return null;
  const shiftTasks = state.tasks.filter((task) => task.shiftId === shift.id);
  if (!shiftTasks.length || shiftTasks.some((task) => task.status !== "completed")) return null;
  const completionRatio = shiftTasks.filter((task) => task.status === "completed").length / shiftTasks.length;
  const qualityMultiplier = .75 + shift.quality / 200;
  const grossPay = Math.max(1, Math.round(contract.wagePerHour * contract.shiftDurationHours * completionRatio * qualityMultiplier));
  const pay = Math.max(0, Math.min(grossPay, Math.floor(operation.cash)));
  const unpaid = Math.max(0, grossPay - pay);
  const remainingMinutes = Math.max(0, Math.round((shift.scheduledEndAt - input.timestamp) / 60_000));
  const completedShifts = contract.completedShifts + 1;
  const promoted = completedShifts === contract.probationShifts;
  const nextContract: PlayerWorkContractState = {
    ...contract,
    status: contract.warningCount > 0 ? "warning" : "active",
    completedShifts,
    wagePerHour: promoted ? Math.round(contract.wagePerHour * 1.08) : contract.wagePerHour,
    rank: promoted ? contract.rank + 1 : contract.rank,
    unpaidWages: contract.unpaidWages + unpaid,
    lastShiftAt: input.timestamp,
    nextShiftAt: nextWorkStart(shift.scheduledStartAt + DAY_MS, contract.shiftStartHour, contract.workDays, true)
  };
  const endedAt = input.timestamp + remainingMinutes * 60_000;
  const shifts = state.shifts.map((item) => item.id === shift.id ? {
    ...item,
    status: "completed" as const,
    endedAt,
    grossPay,
    paidAmount: pay,
    unpaidAmount: unpaid
  } : item);
  const operations = input.venueOperations.operations.map((item) => item.venueId !== venue.id ? item : {
    ...item,
    cash: item.cash - pay,
    expensesToday: item.expensesToday + pay,
    lifetimeExpenses: item.lifetimeExpenses + pay
  });
  const wageLedger: VenueLedgerEntryState | null = pay > 0 ? {
    id: createStableEntityId("venue-ledger", `${venue.id}:player-wage:${shift.id}`),
    idempotencyKey: `${venue.id}:player-wage:${shift.id}`,
    timestamp: input.timestamp + 1,
    venueId: venue.id,
    kind: "payroll",
    debitEntityId: accountId(venue.id),
    creditEntityId: input.playerId ?? "player",
    amount: pay,
    description: `${venue.name}: зарплата игроку за смену`,
    postToKernel: false
  } : null;
  const venueOperations: VenueOperationsState = {
    ...input.venueOperations,
    operations,
    ledger: wageLedger ? [...input.venueOperations.ledger, wageLedger].slice(-1_200) : input.venueOperations.ledger,
    totals: {
      ...input.venueOperations.totals,
      expenses: operations.reduce((sum, item) => sum + item.lifetimeExpenses, 0)
    }
  };
  return {
    state: {
      ...state,
      activeShiftId: undefined,
      shifts,
      contracts: state.contracts.map((item) => item.id === contract.id ? nextContract : item),
      totalEarned: state.totalEarned + pay,
      totalUnpaid: state.totalUnpaid + unpaid,
      lastUpdatedAt: input.timestamp
    },
    venueOperations,
    pay,
    unpaid,
    remainingMinutes,
    message: unpaid > 0
      ? `Смена закрыта: выплачено ₵ ${pay}, долг работодателя ₵ ${unpaid}.`
      : `Смена закрыта: выплачено ₵ ${pay}${promoted ? " · испытательный срок пройден" : ""}.`
  };
}

export function resignPlayerWorkContract(state: PlayerWorkState, contractId: string, timestamp: number): PlayerWorkState {
  const contract = state.contracts.find((item) => item.id === contractId && (item.status === "active" || item.status === "warning"));
  if (!contract || state.activeShiftId) return state;
  return {
    ...state,
    activeContractId: state.activeContractId === contract.id ? undefined : state.activeContractId,
    contracts: state.contracts.map((item) => item.id === contract.id ? {
      ...item,
      status: "resigned" as const,
      resignedAt: timestamp
    } : item),
    vacancies: state.vacancies.map((item) => item.id === contract.vacancyId ? {
      ...item,
      status: "open" as const,
      postedAt: timestamp,
      expiresAt: timestamp + 7 * DAY_MS
    } : item),
    lastUpdatedAt: timestamp
  };
}

export function collectPlayerWorkDebt(
  state: PlayerWorkState,
  contractId: string,
  input: PlayerWorkInput
): PlayerWorkDebtResult | null {
  const contract = state.contracts.find((item) => item.id === contractId && item.unpaidWages > 0);
  const venue = input.venues.find((item) => item.id === contract?.venueId)
    ?? input.venueOperations.registry.find((entry) => entry.venue.id === contract?.venueId)?.venue;
  const operation = input.venueOperations.operations.find((item) => item.venueId === contract?.venueId);
  if (!contract || !venue || !operation) return null;
  const paid = Math.max(0, Math.min(contract.unpaidWages, Math.floor(operation.cash)));
  if (paid <= 0) return null;
  const remaining = contract.unpaidWages - paid;
  const operations = input.venueOperations.operations.map((item) => item.venueId !== venue.id ? item : {
    ...item,
    cash: item.cash - paid,
    expensesToday: item.expensesToday + paid,
    lifetimeExpenses: item.lifetimeExpenses + paid
  });
  const ledgerEntry: VenueLedgerEntryState = {
    id: createStableEntityId("venue-ledger", `${venue.id}:player-wage-debt:${contract.id}:${input.timestamp}`),
    idempotencyKey: `${venue.id}:player-wage-debt:${contract.id}:${input.timestamp}`,
    timestamp: input.timestamp + 1,
    venueId: venue.id,
    kind: "payroll",
    debitEntityId: accountId(venue.id),
    creditEntityId: input.playerId ?? "player",
    amount: paid,
    description: `${venue.name}: погашение долга по зарплате`,
    postToKernel: false
  };
  return {
    state: {
      ...state,
      contracts: state.contracts.map((item) => item.id === contract.id ? { ...item, unpaidWages: remaining } : item),
      totalEarned: state.totalEarned + paid,
      totalUnpaid: Math.max(0, state.totalUnpaid - paid),
      lastUpdatedAt: input.timestamp
    },
    venueOperations: {
      ...input.venueOperations,
      operations,
      ledger: [...input.venueOperations.ledger, ledgerEntry].slice(-1_200),
      totals: {
        ...input.venueOperations.totals,
        expenses: operations.reduce((sum, item) => sum + item.lifetimeExpenses, 0)
      }
    },
    paid,
    remaining
  };
}

export function waitMinutesUntilShift(state: PlayerWorkState, contractId: string, timestamp: number): number | null {
  const contract = state.contracts.find((item) => item.id === contractId && (item.status === "active" || item.status === "warning"));
  if (!contract) return null;
  if (contract.nextShiftAt <= timestamp) return 0;
  return Math.ceil((contract.nextShiftAt - timestamp) / 60_000);
}

export function roleLabel(role: PlayerWorkRole): string {
  if (role === "cashier") return "Кассир";
  if (role === "cafe-crew") return "Сотрудник кафе";
  if (role === "clinic-aide") return "Санитар клиники";
  if (role === "courier") return "Курьер";
  return "Механик";
}

export function skillLabel(skill: PlayerWorkSkill): string {
  if (skill === "service") return "Сервис";
  if (skill === "cooking") return "Готовка";
  if (skill === "medical") return "Медицина";
  return "Техника";
}
