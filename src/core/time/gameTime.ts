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

export function getDayNumber(timestamp: number): number {
  const elapsed = timestamp - INITIAL_GAME_TIMESTAMP;
  return Math.max(1, Math.floor(elapsed / 86_400_000) + 1);
}
