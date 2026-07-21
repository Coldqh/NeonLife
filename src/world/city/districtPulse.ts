import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { WorldEvent } from "../../core/events/types";
import { DEMO_WORLD_SEED } from "./demoWorld";

const PULSE_MINUTES = 30;
const PULSE_MS = PULSE_MINUTES * 60_000;
const POWER_PARTIAL_RESTORE_AT = Date.UTC(2089, 9, 18, 1, 30);
const POWER_FULL_RESTORE_AT = Date.UTC(2089, 9, 18, 2, 30);

export type PowerGridStatus = "offline" | "unstable" | "stable";

export interface DistrictPulseState {
  security: number;
  policePresence: number;
  gangPressure: number;
  transitDelayMinutes: number;
  marketActivity: number;
  powerGrid: PowerGridStatus;
  lastProcessedBucket: number;
  pulseCount: number;
}

export interface DistrictPulseResult {
  state: DistrictPulseState;
  events: WorldEvent[];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function bucketFor(timestamp: number): number {
  return Math.floor(timestamp / PULSE_MS);
}

function eventId(bucket: number, type: string): string {
  return createStableEntityId("event", `${DEMO_WORLD_SEED}:sector04:${bucket}:${type}`);
}

function eventAt(bucket: number, type: string, title: string, detail: string, importance: 1 | 2 | 3 = 2): WorldEvent {
  return {
    id: eventId(bucket, type),
    timestamp: bucket * PULSE_MS,
    category: "local",
    title,
    detail,
    importance
  };
}

export function createInitialDistrictPulse(timestamp: number): DistrictPulseState {
  return {
    security: 34,
    policePresence: 48,
    gangPressure: 57,
    transitDelayMinutes: 12,
    marketActivity: 46,
    powerGrid: "offline",
    lastProcessedBucket: bucketFor(timestamp),
    pulseCount: 0
  };
}

function processBucket(current: DistrictPulseState, bucket: number): DistrictPulseResult {
  const rng = new SeededRandom(`${DEMO_WORLD_SEED}:sector04:pulse:${bucket}`);
  const pulseTimestamp = bucket * PULSE_MS;
  const previous = current;
  const after0130 = pulseTimestamp >= POWER_PARTIAL_RESTORE_AT;
  const after0230 = pulseTimestamp >= POWER_FULL_RESTORE_AT;

  const policePresence = clamp(previous.policePresence + rng.integer(-3, 7));
  const gangPressure = clamp(previous.gangPressure + rng.integer(-5, 6));
  const securityDrift = Math.round((policePresence - gangPressure) / 18) + rng.integer(-2, 2);
  const security = clamp(previous.security + securityDrift);
  const marketActivity = clamp(previous.marketActivity + rng.integer(-5, 3));
  const transitDelayMinutes = Math.max(0, Math.min(45, previous.transitDelayMinutes + rng.integer(-2, 6)));

  let powerGrid: PowerGridStatus = previous.powerGrid;
  if (previous.powerGrid === "offline" && after0130) powerGrid = "unstable";
  if (previous.powerGrid === "unstable" && after0230) powerGrid = "stable";

  const state: DistrictPulseState = {
    security,
    policePresence,
    gangPressure,
    transitDelayMinutes: powerGrid === "stable" ? Math.max(0, transitDelayMinutes - 8) : transitDelayMinutes,
    marketActivity,
    powerGrid,
    lastProcessedBucket: bucket,
    pulseCount: previous.pulseCount + 1
  };

  const events: WorldEvent[] = [];

  if (previous.powerGrid === "offline" && powerGrid === "unstable") {
    events.push(eventAt(
      bucket,
      "power-partial",
      "Аварийная линия LC-04 частично запущена.",
      "Свет появился на главной улице. Дворы и часть жилых блоков остаются без питания.",
      3
    ));
  } else if (previous.powerGrid === "unstable" && powerGrid === "stable") {
    events.push(eventAt(
      bucket,
      "power-stable",
      "Энергоснабжение Sector 04 восстановлено.",
      "Транспортные узлы возвращаются к штатному графику. Частные блоки ещё проверяют сеть.",
      2
    ));
  } else if (previous.policePresence < 65 && policePresence >= 65) {
    events.push(eventAt(
      bucket,
      "police-surge",
      "Полиция расширила проверку документов у станции.",
      `Присутствие патрулей выросло до ${policePresence}%. Проход через центральный выход замедлен.`,
      3
    ));
  } else if (previous.gangPressure < 65 && gangPressure >= 65) {
    events.push(eventAt(
      bucket,
      "gang-surge",
      "Наблюдатели Iron Veil заняли два прохода к рынку.",
      `Давление банды выросло до ${gangPressure}%. Независимые продавцы закрывают дальние ряды.`,
      3
    ));
  } else if (previous.transitDelayMinutes < 20 && state.transitDelayMinutes >= 20) {
    events.push(eventAt(
      bucket,
      "transit-delay",
      "Задержка транспорта превысила двадцать минут.",
      "Линия LC-04 перегружена после отключения питания. На платформе растёт очередь.",
      2
    ));
  } else if (previous.marketActivity >= 35 && marketActivity < 35) {
    events.push(eventAt(
      bucket,
      "market-closing",
      "Часть ночного рынка закрылась раньше срока.",
      "Продавцы убирают товар из-за патрулей, слабого освещения и низкого потока покупателей.",
      2
    ));
  } else if (security <= 25 && previous.security > 25) {
    events.push(eventAt(
      bucket,
      "security-critical",
      "Безопасность Sector 04 упала до критического уровня.",
      "Сервис городской сети рекомендует избегать дворов и неосвещённых переходов.",
      3
    ));
  } else if (rng.chance(0.34)) {
    if (powerGrid === "offline") {
      events.push(eventAt(
        bucket,
        "repair-team",
        "Ремонтная группа добралась до распределительного узла.",
        "Техники перекрыли один проход. Восстановление линии продолжается.",
        1
      ));
    } else if (policePresence > gangPressure) {
      events.push(eventAt(
        bucket,
        "patrol-shift",
        "Патруль сместился к транспортному терминалу.",
        `Полицейское присутствие: ${policePresence}%. У рынка стало свободнее.`,
        1
      ));
    } else {
      events.push(eventAt(
        bucket,
        "street-pressure",
        "Уличная активность сместилась к старым жилым блокам.",
        `Давление банды: ${gangPressure}%. Центральная улица пока остаётся проходимой.`,
        1
      ));
    }
  }

  return { state, events };
}

export function advanceDistrictPulse(
  current: DistrictPulseState,
  nextTimestamp: number
): DistrictPulseResult {
  const targetBucket = bucketFor(nextTimestamp);
  if (targetBucket <= current.lastProcessedBucket) return { state: current, events: [] };

  let state = current;
  const events: WorldEvent[] = [];
  const cappedTarget = Math.min(targetBucket, current.lastProcessedBucket + 96);

  for (let bucket = current.lastProcessedBucket + 1; bucket <= cappedTarget; bucket += 1) {
    const result = processBucket(state, bucket);
    state = result.state;
    events.push(...result.events);
  }

  if (cappedTarget < targetBucket) {
    state = { ...state, lastProcessedBucket: targetBucket };
  }

  return { state, events };
}

export function districtSecurityLabel(value: number): string {
  if (value < 25) return "CRITICAL";
  if (value < 45) return "LOW";
  if (value < 65) return "GUARDED";
  return "HIGH";
}

export function powerGridLabel(status: PowerGridStatus): string {
  if (status === "offline") return "OFFLINE";
  if (status === "unstable") return "UNSTABLE";
  return "STABLE";
}
