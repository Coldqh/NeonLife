import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";

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

const FIRST_NAMES = ["ELIAN", "NOA", "SOREN", "TALA", "IREN", "MAREN"] as const;
const LAST_NAMES = ["VOSS", "ARDEN", "SEVRIN", "RAHL", "KORR", "VALEK"] as const;

export function createInitialPlayer(seed: string, district: string, sector: string): PlayerState {
  const rng = new SeededRandom(`${seed}:player`);
  const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  return {
    id: createStableEntityId("person", `${seed}:player`),
    name,
    age: rng.integer(19, 24),
    origin: `${district} / MUNICIPAL HOUSING FILE`,
    occupation: "UNEMPLOYED",
    district,
    sector,
    balance: rng.integer(1450, 2050),
    housingDaysLeft: 7,
    condition: {
      health: rng.integer(82, 92),
      fatigue: rng.integer(50, 64),
      stress: rng.integer(35, 49),
      hunger: rng.integer(28, 40)
    }
  };
}

export const initialPlayer = createInitialPlayer("NEON-LIFE-DEFAULT", "UNDERLINE", "BLOCK 07");
