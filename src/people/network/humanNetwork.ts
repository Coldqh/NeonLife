import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { KnownNpc } from "../demoNpc";
import type { LocationState } from "../../world/state/types";
import type {
  HumanNetworkAdvanceResult,
  HumanNetworkNotice,
  HumanNetworkState,
  PersonMemory,
  PersonProblem,
  PersonProblemType,
  PersonRole,
  PersonScheduleBlock,
  PersonState
} from "./types";

const FIRST_NAMES = ["SENA", "TAVI", "RHEA", "ORIN", "KORA", "JUNO", "ELI", "VARA", "NEM", "CASS", "LYS", "DARA"] as const;
const LAST_NAMES = ["ORREL", "HALDEN", "MIREN", "ROTH", "SAYE", "KELL", "VOSS", "CALDER", "NOLL", "KORREN", "MORR", "TAREN"] as const;

interface PersonTemplate {
  role: PersonRole;
  roleLabel: string;
  homeType: LocationState["type"];
  workType: LocationState["type"];
  problem: PersonProblemType;
  facts: string[];
}

const TEMPLATES: PersonTemplate[] = [
  { role: "dispatcher", roleLabel: "MESHLINE DISPATCHER", homeType: "housing", workType: "transport", problem: "work-conflict", facts: ["ведёт ночные рейсы", "знает большинство курьеров района"] },
  { role: "courier", roleLabel: "FREELANCE COURIER", homeType: "housing", workType: "transport", problem: "medical-debt", facts: ["берёт тяжёлые заказы", "недавно повредил груз"] },
  { role: "vendor", roleLabel: "NIGHT MARKET VENDOR", homeType: "housing", workType: "market", problem: "missing-supply", facts: ["торгует пищевыми картриджами", "часто работает до рассвета"] },
  { role: "housing-manager", roleLabel: "HAB-STACK MANAGER", homeType: "housing", workType: "housing", problem: "rent", facts: ["контролирует доступ в жилой блок", "знает долги жильцов"] },
  { role: "clinic-assistant", roleLabel: "CMU CLINIC ASSISTANT", homeType: "housing", workType: "clinic", problem: "family-care", facts: ["работает в приёмном блоке", "ухаживает за родственником"] },
  { role: "transit-guard", roleLabel: "TRANSIT SECURITY", homeType: "housing", workType: "transport", problem: "job-risk", facts: ["проверяет грузовые пропуска", "боится потерять лицензию"] },
  { role: "cook", roleLabel: "NIGHT KITCHEN OWNER", homeType: "housing", workType: "food", problem: "missing-supply", facts: ["держит ночную кухню", "покупает продукты у рынка"] },
  { role: "technician", roleLabel: "SERVICE TECHNICIAN", homeType: "housing", workType: "workshop", problem: "exhaustion", facts: ["ремонтирует сервоприводы", "часто берёт двойные смены"] },
  { role: "office-clerk", roleLabel: "CORPORATE RECORDS CLERK", homeType: "housing", workType: "office", problem: "work-conflict", facts: ["работает с внутренними заявками", "ездит через нижний район"] },
  { role: "neighbor", roleLabel: "LOCAL RESIDENT", homeType: "housing", workType: "market", problem: "unsafe-housing", facts: ["живёт в том же блоке", "ищет более безопасное жильё"] },
  { role: "loader", roleLabel: "FREIGHT LOADER", homeType: "housing", workType: "workshop", problem: "job-risk", facts: ["разгружает ночные поставки", "зависит от сменных контрактов"] },
  { role: "independent", roleLabel: "INDEPENDENT RUNNER", homeType: "housing", workType: "market", problem: "rent", facts: ["работает без постоянной регистрации", "берёт мелкие поручения"] }
];

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function findLocation(locations: LocationState[], type: LocationState["type"], fallback: LocationState): LocationState {
  return locations.find((location) => location.type === type) ?? fallback;
}

function problemFor(type: PersonProblemType, severity: number): PersonProblem {
  const definitions: Record<PersonProblemType, Omit<PersonProblem, "type" | "severity" | "progress">> = {
    rent: { title: "Просроченная аренда", detail: "Нужно закрыть платёж до следующей проверки блока." },
    "medical-debt": { title: "Долг клинике", detail: "Медицинская сеть удерживает часть дохода." },
    "family-care": { title: "Уход за близким", detail: "Свободное время постоянно уходит на помощь семье." },
    "job-risk": { title: "Риск увольнения", detail: "Следующая ошибка может закончить контракт." },
    "missing-supply": { title: "Сорванная поставка", detail: "Работа зависит от груза, который не пришёл вовремя." },
    "work-conflict": { title: "Конфликт на работе", detail: "Начальство и смена перекладывают ответственность друг на друга." },
    exhaustion: { title: "Переутомление", detail: "Человек держится на стимуляторах и коротком сне." },
    "unsafe-housing": { title: "Небезопасное жильё", detail: "Замки и питание блока регулярно выходят из строя." }
  };
  return { type, ...definitions[type], severity, progress: 0 };
}

function scheduleFor(homeId: string, workId: string, shift: "day" | "night"): PersonScheduleBlock[] {
  if (shift === "night") {
    return [
      { startHour: 0, endHour: 6, activity: "work", locationId: workId },
      { startHour: 6, endHour: 7, activity: "commute", locationId: homeId },
      { startHour: 7, endHour: 15, activity: "rest", locationId: homeId },
      { startHour: 15, endHour: 18, activity: "errand", locationId: workId },
      { startHour: 18, endHour: 24, activity: "work", locationId: workId }
    ];
  }
  return [
    { startHour: 0, endHour: 7, activity: "rest", locationId: homeId },
    { startHour: 7, endHour: 8, activity: "commute", locationId: workId },
    { startHour: 8, endHour: 17, activity: "work", locationId: workId },
    { startHour: 17, endHour: 19, activity: "errand", locationId: workId },
    { startHour: 19, endHour: 24, activity: "home", locationId: homeId }
  ];
}

function locationAt(person: PersonState, timestamp: number): string {
  const hour = new Date(timestamp).getUTCHours();
  return person.schedule.find((block) => hour >= block.startHour && hour < block.endHour)?.locationId ?? person.homeLocationId;
}

function statusFor(person: PersonState, locations: LocationState[], timestamp: number): string {
  const location = locations.find((item) => item.id === person.currentLocationId);
  const hour = new Date(timestamp).getUTCHours();
  const block = person.schedule.find((item) => hour >= item.startHour && hour < item.endHour);
  if (block?.activity === "work") return `На смене · ${location?.name ?? "рабочий узел"}`;
  if (block?.activity === "rest") return `Отдыхает · ${location?.name ?? "жилой блок"}`;
  if (block?.activity === "errand") return `Занят делами · ${location?.name ?? "район"}`;
  return `На месте · ${location?.name ?? "район"}`;
}

export function createHumanNetwork(seed: string, timestamp: number, locations: LocationState[]): HumanNetworkState {
  const rng = new SeededRandom(`${seed}:human-network`);
  const fallback = locations[0];
  if (!fallback) return { people: [], lastUpdatedAt: timestamp, cycle: Math.floor(timestamp / (6 * 60 * 60_000)), selectedPersonId: null };

  const usedNames = new Set<string>();
  const people = TEMPLATES.map((template, index): PersonState => {
    let name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    while (usedNames.has(name)) name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    usedNames.add(name);
    const home = findLocation(locations, template.homeType, fallback);
    const work = findLocation(locations, template.workType, fallback);
    const id = createStableEntityId("person", `${seed}:network:${index}:${name}`);
    const shift = ["dispatcher", "vendor", "cook", "courier", "independent"].includes(template.role) ? "night" : "day";
    const schedule = scheduleFor(home.id, work.id, shift);
    const person: PersonState = {
      id,
      profileCode: `HN-${rng.integer(1000, 9999)}-${index.toString().padStart(2, "0")}`,
      name,
      age: rng.integer(21, 49),
      role: template.role,
      roleLabel: template.roleLabel,
      homeLocationId: home.id,
      workLocationId: work.id,
      currentLocationId: home.id,
      status: "",
      money: rng.integer(80, 860),
      fatigue: rng.integer(18, 64),
      stress: rng.integer(22, 69),
      trustToPlayer: rng.integer(8, 31),
      respectToPlayer: rng.integer(5, 28),
      irritationToPlayer: rng.integer(0, 12),
      debtToPlayer: 0,
      playerDebt: 0,
      knownFacts: template.facts,
      problem: problemFor(template.problem, rng.integer(35, 72)),
      schedule,
      relations: [],
      memories: [],
      lastAdvancedAt: timestamp
    };
    person.currentLocationId = locationAt(person, timestamp);
    person.status = statusFor(person, locations, timestamp);
    return person;
  });

  for (let index = 0; index < people.length; index += 1) {
    const next = people[(index + 1) % people.length];
    const previous = people[(index + people.length - 1) % people.length];
    people[index] = {
      ...people[index],
      relations: [
        { personId: next.id, kind: index % 3 === 0 ? "family" : "coworker", strength: rng.integer(42, 82) },
        { personId: previous.id, kind: index % 4 === 0 ? "rival" : "friend", strength: rng.integer(28, 71) }
      ]
    };
  }

  const primary = people.find((person) => person.role === "neighbor") ?? people[0];
  return { people, lastUpdatedAt: timestamp, cycle: Math.floor(timestamp / (6 * 60 * 60_000)), selectedPersonId: primary?.id ?? null };
}

function addMemory(person: PersonState, seed: string, timestamp: number, summary: string, importance: number, emotionalValue: number): PersonState {
  const memory: PersonMemory = {
    id: createStableEntityId("memory", `${seed}:${person.id}:${timestamp}:${summary}:${person.memories.length}`),
    timestamp,
    type: "player-action",
    summary,
    importance: clamp(importance),
    emotionalValue: Math.max(-100, Math.min(100, emotionalValue)),
    confidence: 100
  };
  return { ...person, memories: [memory, ...person.memories].slice(0, 24) };
}

export function recordPlayerAction(
  state: HumanNetworkState,
  seed: string,
  personId: string,
  timestamp: number,
  summary: string,
  effects: { trust?: number; respect?: number; irritation?: number; debtToPlayer?: number; playerDebt?: number; importance?: number; emotionalValue?: number }
): HumanNetworkState {
  return {
    ...state,
    selectedPersonId: personId,
    people: state.people.map((person) => {
      if (person.id !== personId) return person;
      const updated = {
        ...person,
        trustToPlayer: clamp(person.trustToPlayer + (effects.trust ?? 0)),
        respectToPlayer: clamp(person.respectToPlayer + (effects.respect ?? 0)),
        irritationToPlayer: clamp(person.irritationToPlayer + (effects.irritation ?? 0)),
        debtToPlayer: Math.max(0, person.debtToPlayer + (effects.debtToPlayer ?? 0)),
        playerDebt: Math.max(0, person.playerDebt + (effects.playerDebt ?? 0))
      };
      return addMemory(updated, seed, timestamp, summary, effects.importance ?? 45, effects.emotionalValue ?? 0);
    })
  };
}

export function advanceHumanNetwork(
  state: HumanNetworkState,
  timestamp: number,
  seed: string,
  locations: LocationState[]
): HumanNetworkAdvanceResult {
  if (timestamp <= state.lastUpdatedAt) return { state, notices: [] };
  const cycleLength = 6 * 60 * 60_000;
  const targetCycle = Math.floor(timestamp / cycleLength);
  const notices: HumanNetworkNotice[] = [];
  let people = state.people.map((person) => {
    const moved = { ...person, currentLocationId: locationAt(person, timestamp), lastAdvancedAt: timestamp };
    return { ...moved, status: statusFor(moved, locations, timestamp) };
  });
  let cycle = Math.max(state.cycle, Math.floor(state.lastUpdatedAt / cycleLength));

  while (cycle < targetCycle && notices.length < 3) {
    cycle += 1;
    if (!people.length) break;
    const rng = new SeededRandom(`${seed}:human-network-cycle:${cycle}`);
    const index = rng.integer(0, people.length - 1);
    const person = people[index];
    const severityDelta = rng.integer(-2, 8);
    const moneyDelta = -rng.integer(3, 26);
    const nextSeverity = clamp(person.problem.severity + severityDelta);
    const nextProgress = clamp(person.problem.progress + rng.integer(1, 7));
    const nextPerson: PersonState = {
      ...person,
      money: Math.max(0, person.money + moneyDelta),
      fatigue: clamp(person.fatigue + rng.integer(-3, 8)),
      stress: clamp(person.stress + (severityDelta > 2 ? rng.integer(2, 7) : -1)),
      problem: { ...person.problem, severity: nextSeverity, progress: nextProgress }
    };
    people = people.map((item, itemIndex) => itemIndex === index ? nextPerson : item);
    const importance: 1 | 2 | 3 = nextSeverity >= 78 ? 3 : nextSeverity >= 58 ? 2 : 1;
    notices.push({
      personId: person.id,
      title: `${person.name}: ${person.problem.title.toLowerCase()}.`,
      detail: nextSeverity >= 78
        ? `${person.problem.detail} Ситуация стала критической.`
        : `${person.problem.detail} Давление изменилось до ${nextSeverity}%.`,
      importance
    });
  }

  return {
    state: { ...state, people, lastUpdatedAt: timestamp, cycle },
    notices
  };
}

export function getPerson(state: HumanNetworkState, personId: string | null | undefined): PersonState | null {
  if (!personId) return null;
  return state.people.find((person) => person.id === personId) ?? null;
}

export function peopleAtLocation(state: HumanNetworkState, locationId: string): PersonState[] {
  return state.people.filter((person) => person.currentLocationId === locationId);
}

export function toKnownNpc(person: PersonState, locations: LocationState[], timestamp: number): KnownNpc {
  const location = locations.find((item) => item.id === person.currentLocationId);
  const recent = person.memories[0];
  return {
    id: person.id,
    name: person.name,
    role: person.roleLabel,
    age: person.age,
    status: person.status,
    location: location?.name ?? "UNKNOWN NODE",
    condition: [
      `Усталость: ${person.fatigue >= 70 ? "высокая" : person.fatigue >= 45 ? "повышенная" : "умеренная"}`,
      `Стресс: ${person.stress >= 70 ? "высокий" : person.stress >= 45 ? "повышенный" : "умеренный"}`,
      `Проблема: ${person.problem.title}`
    ],
    relations: [
      { label: "Доверие", value: person.trustToPlayer },
      { label: "Уважение", value: person.respectToPlayer },
      { label: "Раздражение", value: person.irritationToPlayer }
    ],
    knownFacts: [...person.knownFacts, person.problem.detail].slice(0, 4),
    lastContact: recent ? new Date(recent.timestamp).toISOString().slice(5, 16).replace("T", " · ") : new Date(timestamp).toISOString().slice(5, 16).replace("T", " · "),
    profileCode: person.profileCode
  };
}
