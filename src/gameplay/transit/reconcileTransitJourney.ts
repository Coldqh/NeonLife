import type { SpatialPositionState } from "../../simulation/localScene/types";
import type { GameSession } from "../../world/state/types";

function outsidePosition(position: SpatialPositionState, session: GameSession): SpatialPositionState {
  const { buildingId: _buildingId, unitId: _unitId, roomId: _roomId, floor: _floor, vehicleId: _vehicleId, transitRouteId: _transitRouteId, ...base } = position;
  return {
    ...base,
    locationId: base.locationId ?? session.life.currentLocationId,
    state: "outside",
    updatedAt: session.timestamp
  };
}

function cancelJourney(session: GameSession): GameSession {
  const position = outsidePosition(session.transit.player.position ?? session.localScene.playerPosition, session);
  return {
    ...session,
    currentActivity: "На улице",
    localScene: { ...session.localScene, playerPosition: position },
    transit: {
      ...session.transit,
      player: { ...session.transit.player, journey: undefined, position },
      cabin: undefined
    }
  };
}

export function reconcileLoadedTransitJourney(session: GameSession): GameSession {
  const journey = session.transit.player.journey;
  if (!journey) return session;

  const destinationExists = session.world.locations.some((location) => location.id === journey.destinationLocationId);
  const segment = journey.segments[journey.activeSegmentIndex];
  const route = segment ? session.transit.routes.find((item) => item.id === segment.routeId) : undefined;
  const stopIdsValid = Boolean(segment)
    && segment.stopIds.length >= 2
    && segment.stopIds.every((stopId) => session.transit.stops.some((stop) => stop.id === stopId));
  const offsetValid = Boolean(segment)
    && journey.currentStopOffset >= 0
    && journey.currentStopOffset < segment.stopIds.length;
  const currentStopValid = session.transit.stops.some((stop) => stop.id === journey.currentStopId);
  const phaseValid = ["walking", "waiting", "onboard", "arrived"].includes(journey.phase);

  if (!destinationExists || !segment || !route || !stopIdsValid || !offsetValid || !currentStopValid || !phaseValid) {
    return cancelJourney(session);
  }

  // An unboarded route from an older UI patch must not trap the player in a modal on every boot.
  if ((journey.phase === "walking" || journey.phase === "waiting") && journey.farePaid <= 0 && !journey.vehicleId) {
    return cancelJourney(session);
  }

  if (journey.phase === "onboard") {
    const vehicleExists = Boolean(journey.vehicleId && session.transit.vehicles.some((vehicle) => vehicle.id === journey.vehicleId));
    const cabinMatches = Boolean(session.transit.cabin && session.transit.cabin.vehicleId === journey.vehicleId);
    if (!vehicleExists || !cabinMatches) {
      const stop = session.transit.stops.find((item) => item.id === journey.currentStopId);
      const position: SpatialPositionState = stop ? {
        sectorId: stop.sectorId,
        xM: stop.xM,
        yM: stop.yM,
        state: "outside",
        updatedAt: session.timestamp
      } : outsidePosition(session.localScene.playerPosition, session);
      return {
        ...session,
        localScene: { ...session.localScene, playerPosition: position },
        transit: {
          ...session.transit,
          player: {
            ...session.transit.player,
            journey: {
              ...journey,
              phase: "waiting",
              vehicleId: undefined,
              seatId: undefined,
              waitingMinutesTotal: 0,
              waitingMinutesRemaining: 0
            },
            position
          },
          cabin: undefined
        }
      };
    }
  }

  return session;
}
