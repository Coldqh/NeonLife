export interface GameClockState {
  timestamp: number;
  paused: boolean;
}

export const INITIAL_GAME_TIMESTAMP = Date.UTC(2089, 9, 17, 22, 41);

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
];

export function advanceGameTime(timestamp: number, minutes: number): number {
  return timestamp + minutes * 60_000;
}

export function formatGameDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatGameTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export function formatGameDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${formatGameDate(timestamp)} · ${formatGameTime(timestamp)} · ${WEEKDAYS[date.getUTCDay()]}`;
}

const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"
];

/** Formats in the fictional game clock, never in the device timezone. */
export function formatGameShortDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")} · ${formatGameTime(timestamp)}`;
}

/** Formats a compact month/day label in the fictional game clock. */
export function formatGameMonthDayTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} · ${formatGameTime(timestamp)}`;
}

export function formatGameDateLong(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "дата неизвестна";
  const date = new Date(timestamp);
  return `${date.getUTCDate()} ${MONTHS_RU[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function getDayNumber(timestamp: number): number {
  const elapsed = timestamp - INITIAL_GAME_TIMESTAMP;
  return Math.max(1, Math.floor(elapsed / 86_400_000) + 1);
}
