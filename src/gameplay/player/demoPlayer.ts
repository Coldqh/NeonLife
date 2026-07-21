export interface PlayerCondition {
  health: number;
  fatigue: number;
  stress: number;
  hunger: number;
}

export interface PlayerState {
  id: string;
  name: string;
  age: number;
  origin: string;
  occupation: string;
  district: string;
  sector: string;
  balance: number;
  housingDaysLeft: number;
  condition: PlayerCondition;
}

export const initialPlayer: PlayerState = {
  id: "person-kain-vale",
  name: "KAIN VALE",
  age: 19,
  origin: "LOWER CITY / STATE WARD 11",
  occupation: "UNEMPLOYED",
  district: "LOWER CITY",
  sector: "SECTOR 04",
  balance: 1842,
  housingDaysLeft: 7,
  condition: {
    health: 87,
    fatigue: 61,
    stress: 43,
    hunger: 36
  }
};
