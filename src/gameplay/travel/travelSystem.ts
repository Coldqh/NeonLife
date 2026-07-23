import type { GameSession, LocationState } from "../../world/state/types";
import { estimateMobilityTravel } from "../../simulation/mobility/mobilitySystem";
import type { MobilityTravelEstimate } from "../../simulation/mobility/types";

export interface TravelOption {
  location: LocationState;
  durationMinutes: number;
  cost: number;
  districtName: string;
  sameDistrict: boolean;
  mode: MobilityTravelEstimate["mode"];
  routeCode: string;
  distanceKm: number;
  congestionPercent: number;
  transitCrowdingPercent: number;
}

export function getTravelOptions(session: GameSession): TravelOption[] {
  const current = session.world.locations.find((location) => location.id === session.life.currentLocationId);
  const currentDistrictId = current?.districtId ?? session.world.activeDistrictId;
  return session.world.locations
    .filter((location) => location.id !== current?.id)
    .map((location) => {
      const sameDistrict = location.districtId === currentDistrictId;
      const district = session.world.districts.find((item) => item.id === location.districtId);
      const estimate = current ? estimateMobilityTravel(session.mobility, session.metropolitan, current.id, location.id) : null;
      const baseDuration = estimate?.durationMinutes ?? (sameDistrict ? 14 : 34);
      const delay = estimate ? 0 : sameDistrict ? Math.ceil(session.district.transitDelayMinutes / 2) : session.district.transitDelayMinutes;
      const transitDebt = session.pressure.obligations.find((obligation) => obligation.type === "transit" && obligation.status === "overdue");
      const surcharge = transitDebt && (estimate?.mode === "bus" || estimate?.mode === "metro") ? (sameDistrict ? 3 : 7) : 0;
      return {
        location,
        durationMinutes: baseDuration + delay,
        cost: (estimate?.cost ?? (sameDistrict ? 4 : 12)) + surcharge,
        districtName: district?.name ?? "UNKNOWN DISTRICT",
        sameDistrict,
        mode: estimate?.mode ?? "bus",
        routeCode: estimate?.routeCode ?? "CITY BUS",
        distanceKm: Math.round((estimate?.distanceM ?? 0) / 100) / 10,
        congestionPercent: estimate?.congestionPercent ?? session.district.transitDelayMinutes,
        transitCrowdingPercent: estimate?.transitCrowdingPercent ?? 0
      };
    })
    .sort((left, right) => left.durationMinutes - right.durationMinutes);
}

export function isLocationOpen(location: LocationState, timestamp: number): boolean {
  if (!location.open) return false;
  const hour = new Date(timestamp).getUTCHours();
  const openHour = location.openHour ?? 0;
  const closeHour = location.closeHour ?? 24;
  if (openHour === closeHour) return true;
  if (openHour < closeHour) return hour >= openHour && hour < closeHour;
  return hour >= openHour || hour < closeHour;
}
