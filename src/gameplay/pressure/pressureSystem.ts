import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { HousingState } from "../housing/housingSystem";
import type { LocationState } from "../../world/state/types";
import type { PersonState } from "../../people/network/types";
import type {
  DayMetrics,
  DaySummary,
  NpcRequestState,
  NpcRequestType,
  ObligationState,
  PressureAdvanceResult,
  PressureNotice,
  PressureState
} from "./types";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function dayIndex(weekStartedAt: number, timestamp: number): number {
  return Math.max(1, Math.floor((timestamp - weekStartedAt) / DAY) + 1);
}

function freshMetrics(weekStartedAt: number, timestamp: number): DayMetrics {
  return {
    dayIndex: dayIndex(weekStartedAt, timestamp),
    startedAt: timestamp,
    earned: 0,
    spent: 0,
    deliveries: 0,
    requestsCompleted: 0,
    requestsMissed: 0,
    relationChanges: 0,
    worldEvents: 0
  };
}

function personByRole(people: PersonState[], role: PersonState["role"]): PersonState | undefined {
  return people.find((person) => person.role === role);
}

function createObligation(
  seed: string,
  scope: string,
  type: ObligationState["type"],
  creditorName: string,
  amount: number,
  dueAt: number,
  consequence: string,
  creditorPersonId?: string
): ObligationState {
  return {
    id: createStableEntityId("obligation", `${seed}:${scope}`),
    code: `OBL-${scope.toUpperCase()}`,
    type,
    creditorName,
    creditorPersonId,
    amount,
    dueAt,
    status: "active",
    consequence,
    extensionCount: 0,
    lastNoticeStage: 0,
    paidAt: null
  };
}

function requestDefinition(type: NpcRequestType, person: PersonState): Pick<NpcRequestState, "title" | "detail" | "durationMinutes" | "upfrontCost" | "reward"> {
  if (type === "medicine") {
    return {
      title: "Забрать восстановительный пакет",
      detail: `${person.name} не успевает получить медицинский рацион до закрытия выдачи.`,
      durationMinutes: 24,
      upfrontCost: 38,
      reward: 20
    };
  }
  if (type === "supply") {
    return {
      title: "Помочь с сорванной поставкой",
      detail: `${person.name} ждёт короткую поставку, без которой остановится рабочая точка.`,
      durationMinutes: 42,
      upfrontCost: 0,
      reward: 76
    };
  }
  if (type === "loan") {
    return {
      title: "Одолжить деньги до смены",
      detail: `${person.name} просит закрыть срочный платёж и обещает вернуть позже.`,
      durationMinutes: 6,
      upfrontCost: 90,
      reward: 0
    };
  }
  if (type === "cover-shift") {
    return {
      title: "Подменить короткое окно смены",
      detail: `${person.name} должен отлучиться, но не может бросить рабочую точку.`,
      durationMinutes: 58,
      upfrontCost: 0,
      reward: 84
    };
  }
  return {
    title: "Перенести тяжёлый модуль",
    detail: `${person.name} не справляется с грузом в одиночку.`,
    durationMinutes: 36,
    upfrontCost: 0,
    reward: 52
  };
}

function requestTypeFor(person: PersonState): NpcRequestType {
  switch (person.problem.type) {
    case "medical-debt":
    case "family-care":
      return "medicine";
    case "missing-supply":
      return "supply";
    case "rent":
    case "unsafe-housing":
      return "loan";
    case "work-conflict":
    case "job-risk":
      return "cover-shift";
    default:
      return "move-load";
  }
}

function createRequest(seed: string, timestamp: number, cycle: number, person: PersonState, index: number): NpcRequestState {
  const type = requestTypeFor(person);
  const definition = requestDefinition(type, person);
  const urgencyHours = person.problem.severity >= 70 ? 5 : person.problem.severity >= 55 ? 8 : 12;
  return {
    id: createStableEntityId("request", `${seed}:${cycle}:${person.id}:${index}`),
    code: `REQ-${cycle.toString().padStart(2, "0")}${index + 1}`,
    personId: person.id,
    type,
    ...definition,
    targetLocationId: person.currentLocationId,
    createdAt: timestamp,
    dueAt: timestamp + urgencyHours * HOUR,
    status: "open",
    acceptedAt: null,
    completedAt: null
  };
}

function activeRequestCount(requests: NpcRequestState[]): number {
  return requests.filter((request) => request.status === "open" || request.status === "accepted").length;
}

function generateRequests(state: PressureState, timestamp: number, seed: string, people: PersonState[]): PressureState {
  if (activeRequestCount(state.requests) >= 3 || !people.length) return state;
  const cycle = state.requestCycle + 1;
  const rng = new SeededRandom(`${seed}:pressure-requests:${cycle}`);
  const candidates = [...people]
    .filter((person) => person.problem.severity >= 38)
    .sort((left, right) => right.problem.severity - left.problem.severity);
  const chosen: PersonState[] = [];
  while (chosen.length < Math.min(3 - activeRequestCount(state.requests), candidates.length)) {
    const person = rng.pick(candidates);
    if (!chosen.some((item) => item.id === person.id)) chosen.push(person);
  }
  return {
    ...state,
    requestCycle: cycle,
    requests: [
      ...state.requests,
      ...chosen.map((person, index) => createRequest(seed, timestamp, cycle, person, index))
    ].slice(-18)
  };
}

export function createPressureState(
  seed: string,
  timestamp: number,
  housing: HousingState,
  people: PersonState[],
  locations: LocationState[]
): PressureState {
  const manager = personByRole(people, "housing-manager");
  const guard = personByRole(people, "transit-guard");
  const clinic = personByRole(people, "clinic-assistant");
  const initial: PressureState = {
    weekStartedAt: timestamp,
    weekEndsAt: timestamp + 7 * DAY,
    obligations: [
      createObligation(seed, "rent", "rent", "HAB-STACK MANAGEMENT", housing.rentPerWeek, housing.paidUntil, "Ограничение доступа, затем потеря капсулы.", manager?.id),
      createObligation(seed, "transit", "transit", "NORTHLINE TRANSIT", 84, timestamp + 2 * DAY, "Блокировка льготного проездного и рост стоимости поездок.", guard?.id),
      createObligation(seed, "medical", "medical", "CIVIC MEDICAL UNION", 210, timestamp + 4 * DAY, "Приостановка базовой медицинской защиты.", clinic?.id)
    ],
    requests: [],
    housingStatus: "active",
    currentDay: freshMetrics(timestamp, timestamp),
    summaries: [],
    requestCycle: 0,
    lastProcessedAt: timestamp
  };
  const seeded = generateRequests(initial, timestamp, seed, people);
  return {
    ...seeded,
    requests: seeded.requests.map((request) => {
      const person = people.find((item) => item.id === request.personId);
      return { ...request, targetLocationId: person?.currentLocationId ?? locations[0]?.id ?? request.targetLocationId };
    })
  };
}

export interface PressureMetricDelta {
  balanceDelta?: number;
  deliveries?: number;
  requestsCompleted?: number;
  relationChanges?: number;
  worldEvents?: number;
}

export function trackPressureMetrics(state: PressureState, delta: PressureMetricDelta): PressureState {
  const balance = delta.balanceDelta ?? 0;
  return {
    ...state,
    currentDay: {
      ...state.currentDay,
      earned: state.currentDay.earned + Math.max(0, balance),
      spent: state.currentDay.spent + Math.max(0, -balance),
      deliveries: state.currentDay.deliveries + (delta.deliveries ?? 0),
      requestsCompleted: state.currentDay.requestsCompleted + (delta.requestsCompleted ?? 0),
      relationChanges: state.currentDay.relationChanges + (delta.relationChanges ?? 0),
      worldEvents: state.currentDay.worldEvents + (delta.worldEvents ?? 0)
    }
  };
}

export function advancePressureState(
  state: PressureState,
  timestamp: number,
  seed: string,
  people: PersonState[]
): PressureAdvanceResult {
  if (timestamp <= state.lastProcessedAt) return { state, notices: [], evicted: false };
  const notices: PressureNotice[] = [];
  let housingStatus = state.housingStatus;
  let evicted = false;

  const obligations: ObligationState[] = state.obligations.map((obligation): ObligationState => {
    if (obligation.status === "paid" || obligation.status === "defaulted") return obligation;
    const overdueHours = Math.floor((timestamp - obligation.dueAt) / HOUR);
    if (overdueHours < 0) {
      const hoursLeft = Math.ceil((obligation.dueAt - timestamp) / HOUR);
      const stage = hoursLeft <= 12 ? 2 : hoursLeft <= 36 ? 1 : 0;
      if (stage > obligation.lastNoticeStage) {
        notices.push({
          category: "finance",
          title: `${obligation.code}: срок платежа приближается.`,
          detail: `${obligation.creditorName} · ₵ ${obligation.amount} · осталось ${hoursLeft} ч.`,
          importance: stage === 2 ? 2 : 1,
          personId: obligation.creditorPersonId
        });
      }
      return { ...obligation, lastNoticeStage: Math.max(obligation.lastNoticeStage, stage) };
    }

    if (obligation.type === "rent") {
      const stage = overdueHours >= 48 ? 4 : overdueHours >= 24 ? 3 : 2;
      if (stage > obligation.lastNoticeStage) {
        if (stage === 2) {
          notices.push({
            category: "finance",
            title: "Аренда просрочена.",
            detail: `HAB-STACK требует ₵ ${obligation.amount}. Отсрочка ещё возможна.`,
            importance: 3,
            personId: obligation.creditorPersonId
          });
        } else if (stage === 3) {
          housingStatus = "restricted";
          notices.push({
            category: "personal",
            title: "Доступ к сервисам капсулы ограничен.",
            detail: "Пищевой шкаф и удалённая доставка заблокированы до оплаты аренды.",
            importance: 3,
            personId: obligation.creditorPersonId
          });
        } else {
          housingStatus = "evicted";
          evicted = true;
          notices.push({
            category: "personal",
            title: "Жилой модуль изъят.",
            detail: "Доступ к капсуле закрыт. Вещи перемещены в платное хранение.",
            importance: 3,
            personId: obligation.creditorPersonId,
            memorySummary: "Игрок не оплатил аренду и потерял доступ к жилому модулю.",
            trustDelta: -4,
            irritationDelta: 10
          });
        }
      }
      return {
        ...obligation,
        status: stage >= 4 ? "defaulted" : "overdue",
        lastNoticeStage: Math.max(obligation.lastNoticeStage, stage)
      };
    }

    const stage = overdueHours >= 24 ? 3 : 2;
    if (stage > obligation.lastNoticeStage) {
      notices.push({
        category: "finance",
        title: `${obligation.code}: платёж просрочен.`,
        detail: `${obligation.creditorName} применил штраф. ${obligation.consequence}`,
        importance: stage === 3 ? 3 : 2,
        personId: obligation.creditorPersonId
      });
    }
    return {
      ...obligation,
      amount: stage >= 3 && obligation.lastNoticeStage < 3 ? Math.ceil(obligation.amount * 1.12) : obligation.amount,
      status: "overdue",
      lastNoticeStage: Math.max(obligation.lastNoticeStage, stage)
    };
  });

  let currentDay = state.currentDay;
  const requests = state.requests.map((request) => {
    if ((request.status !== "open" && request.status !== "accepted") || request.dueAt > timestamp) return request;
    const person = people.find((item) => item.id === request.personId);
    notices.push({
      category: "contact",
      title: `${person?.name ?? "Контакт"}: просьба осталась без ответа.`,
      detail: `${request.title} · срок ${request.code} истёк.`,
      importance: person && person.problem.severity >= 70 ? 3 : 2,
      personId: request.personId,
      memorySummary: `Игрок не выполнил просьбу ${request.code}: ${request.title}.`,
      trustDelta: -4,
      respectDelta: -2,
      irritationDelta: 7
    });
    currentDay = { ...currentDay, requestsMissed: currentDay.requestsMissed + 1, relationChanges: currentDay.relationChanges + 1 };
    return { ...request, status: "missed" as const };
  });

  const withGenerated = generateRequests(
    {
      ...state,
      obligations,
      requests,
      housingStatus,
      currentDay,
      lastProcessedAt: timestamp
    },
    timestamp,
    seed,
    people
  );

  return { state: withGenerated, notices, evicted };
}

export function acceptNpcRequest(state: PressureState, requestId: string, timestamp: number): PressureState {
  return {
    ...state,
    requests: state.requests.map((request) => request.id === requestId && request.status === "open" && request.dueAt > timestamp
      ? { ...request, status: "accepted", acceptedAt: timestamp }
      : request)
  };
}

export function declineNpcRequest(state: PressureState, requestId: string): PressureState {
  return {
    ...state,
    requests: state.requests.map((request) => request.id === requestId && (request.status === "open" || request.status === "accepted")
      ? { ...request, status: "declined" }
      : request)
  };
}

export interface RequestCompletionResult {
  state: PressureState;
  request: NpcRequestState;
  balanceDelta: number;
}

export function completeNpcRequest(
  state: PressureState,
  requestId: string,
  timestamp: number,
  currentLocationId: string,
  balance: number
): RequestCompletionResult | null {
  const request = state.requests.find((item) => item.id === requestId);
  if (!request || request.status !== "accepted" || request.dueAt < timestamp || request.targetLocationId !== currentLocationId || balance < request.upfrontCost) return null;
  const completed = { ...request, status: "completed" as const, completedAt: timestamp };
  const balanceDelta = request.reward - request.upfrontCost;
  return {
    request: completed,
    balanceDelta,
    state: {
      ...state,
      requests: state.requests.map((item) => item.id === request.id ? completed : item)
    }
  };
}

export interface ObligationPaymentResult {
  state: PressureState;
  obligation: ObligationState;
}

export function payObligation(state: PressureState, obligationId: string, timestamp: number, balance: number): ObligationPaymentResult | null {
  const obligation = state.obligations.find((item) => item.id === obligationId);
  if (!obligation || obligation.status === "paid" || balance < obligation.amount) return null;
  const paid = { ...obligation, status: "paid" as const, paidAt: timestamp };
  const next: PressureState = {
    ...state,
    housingStatus: obligation.type === "rent" ? "active" : state.housingStatus,
    obligations: state.obligations.map((item) => item.id === obligation.id ? paid : item)
  };
  return { state: next, obligation: paid };
}

export function extendRentObligation(state: PressureState, timestamp: number): PressureState | null {
  const rent = state.obligations.find((item) => item.type === "rent" && (item.status === "active" || item.status === "overdue"));
  if (!rent || rent.extensionCount >= 1 || timestamp > rent.dueAt + 24 * HOUR) return null;
  return {
    ...state,
    obligations: state.obligations.map((item) => item.id === rent.id
      ? { ...item, dueAt: item.dueAt + DAY, extensionCount: item.extensionCount + 1, status: "active", lastNoticeStage: 0 }
      : item)
  };
}

export function closePressureDay(state: PressureState, timestamp: number, sleepMinutes: number, balanceAfter: number, seed: string): PressureState {
  const metrics = state.currentDay;
  const summary: DaySummary = {
    id: createStableEntityId("day-summary", `${seed}:${metrics.dayIndex}:${timestamp}`),
    dayIndex: metrics.dayIndex,
    startedAt: metrics.startedAt,
    closedAt: timestamp,
    earned: metrics.earned,
    spent: metrics.spent,
    sleepMinutes,
    deliveries: metrics.deliveries,
    requestsCompleted: metrics.requestsCompleted,
    requestsMissed: metrics.requestsMissed,
    relationChanges: metrics.relationChanges,
    worldEvents: metrics.worldEvents,
    balanceAfter
  };
  return {
    ...state,
    summaries: [summary, ...state.summaries].slice(0, 14),
    currentDay: freshMetrics(state.weekStartedAt, timestamp)
  };
}

export function activeObligations(state: PressureState): ObligationState[] {
  return state.obligations
    .filter((item) => item.status === "active" || item.status === "overdue" || item.status === "defaulted")
    .sort((left, right) => left.dueAt - right.dueAt);
}

export function activeRequests(state: PressureState): NpcRequestState[] {
  return state.requests
    .filter((item) => item.status === "open" || item.status === "accepted")
    .sort((left, right) => left.dueAt - right.dueAt);
}

export function committedAmount(state: PressureState): number {
  return activeObligations(state).reduce((sum, obligation) => sum + obligation.amount, 0);
}
