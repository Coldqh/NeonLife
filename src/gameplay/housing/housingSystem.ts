export interface HousingState {
  locationId: string;
  type: "capsule" | "room" | "apartment";
  rentPerWeek: number;
  paidUntil: number;
  sleepQuality: number;
  noise: number;
  security: number;
  storageCapacity: number;
}

export function createInitialHousing(locationId: string, timestamp: number): HousingState {
  return {
    locationId,
    type: "capsule",
    rentPerWeek: 420,
    paidUntil: timestamp + 7 * 24 * 60 * 60_000,
    sleepQuality: 46,
    noise: 68,
    security: 34,
    storageCapacity: 18
  };
}

export function getHousingDaysLeft(housing: HousingState, timestamp: number): number {
  return Math.max(0, Math.ceil((housing.paidUntil - timestamp) / (24 * 60 * 60_000)));
}

export function calculateSleepRecovery(housing: HousingState, hours: number): { fatigueDelta: number; stressDelta: number; healthDelta: number } {
  const qualityFactor = 0.62 + housing.sleepQuality / 170;
  const noisePenalty = housing.noise / 24;
  return {
    fatigueDelta: -Math.round(hours * 10 * qualityFactor),
    stressDelta: -Math.max(2, Math.round(hours * 1.8 - noisePenalty)),
    healthDelta: hours >= 7 ? 2 : hours >= 5 ? 1 : 0
  };
}
