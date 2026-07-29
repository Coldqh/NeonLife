import { useEffect, useRef, useState } from "react";
import { useVersionGuard } from "./providers/useVersionGuard";
import { useWorldSave } from "./providers/useWorldSave";
import { readLocal, writeLocal } from "../core/storage/localStore";
import { defaultUiSettings, type UiSettings } from "../ui/theme/settings";
import { VersionGate } from "../ui/components/VersionGate";
import { GameShell } from "./shell/GameShell";
import { ProfileScreen } from "./screens/ProfileScreen";
import { MapScreen } from "./screens/MapScreen";
import { NearbyScreen } from "./screens/NearbyScreen";
import { TransitJourneyScreen } from "./screens/TransitJourneyScreen";
import { LocalMovementScreen } from "./screens/LocalMovementScreen";
import { SettingsOverlay } from "./overlays/SettingsOverlay";
import type { GameScreen, NoticeState, NoticeTone } from "./shared/types";
import { getPerson, toKnownNpc } from "../people/network/humanNetwork";
import type { TransitPhoneActivity } from "../simulation/transit/types";
import type { LocalMovementTargetState } from "../simulation/localMovement/types";
import { applyLocalLifeAction } from "./actions/localLifeActions";
import { beginConversation, continueConversation, endConversation } from "../gameplay/social/socialCommands";
import {
  actOnStreetIncident,
  alightTransitVehicle,
  boardTransitVehicle,
  cancelLocalMovement,
  cancelTransitJourney,
  drivePhysicalVehicleToLocation,
  finishLocalMovement,
  enterBuildingUnit,
  enterInteriorRoom,
  enterLocalBuilding,
  enterPhysicalVehicle,
  leaveBuildingUnit,
  leaveInteriorRoom,
  leaveLocalBuilding,
  leavePhysicalVehicle,
  moveInsideBuilding,
  interactWithTransitPassenger,
  advanceLocalMovement,
  progressLife,
  reconcileLocalMovement,
  rideTransitToNextStop,
  skipTransitJourney,
  skipLocalMovement,
  startLocalMovement,
  standInTransit,
  takeTransitSeat,
  travelToLocation,
  waitTransitJourney,
  walkTransitJourney,
  usePhoneInTransit,
  yieldTransitSeat
} from "../gameplay/life/lifeSimulation";
const UI_SETTINGS_KEY = "neon-life/ui-settings/v1";
export default function App() {
  const [settings, setSettings] = useState<UiSettings>(() => readLocal(UI_SETTINGS_KEY, defaultUiSettings));
  const [screen, setScreen] = useState<GameScreen>("map");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [requestedLocationId, setRequestedLocationId] = useState<string | undefined>();
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const save = useWorldSave();
  const versionGuard = useVersionGuard();
  const { session, setSession } = save;
  useEffect(() => writeLocal(UI_SETTINGS_KEY, settings), [settings]);
  useEffect(() => {
    if (!session?.localMovement) return;
    setSession((current) => reconcileLocalMovement(current));
  }, [session?.localMovement?.id, session?.streets.topologyVersion, setSession]);
  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);
  function notify(text: string, tone: NoticeTone = "neutral"): void {
    setNotice({ text, tone });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2400);
  }

  function advance(minutes: number, source: string): void {
    setSession((current) => progressLife(current, minutes, { activity: source }));
  }

  function selectPerson(personId: string): void {
    setSession((current) => {
      const person = getPerson(current.people, personId);
      if (!person) return current;
      return {
        ...current,
        people: { ...current.people, selectedPersonId: personId },
        world: { ...current.world, primaryContactId: personId },
        primaryContact: toKnownNpc(person, current.world.locations, current.timestamp)
      };
    });
  }

  function routeToLocation(locationId: string): void {
    setRequestedLocationId(locationId);
    setScreen("map");
  }

  function walkTo(target: LocalMovementTargetState): void {
    if (!session || session.transit.player.journey || session.localMovement) return;
    const next = startLocalMovement(session, target);
    if (next === session) {
      notify("Пеший маршрут к этой точке недоступен", "warn");
      return;
    }
    setSession(next);
    setScreen("map");
  }

  function travel(locationId: string): void {
    if (!session || session.transit.player.journey || session.localMovement) return;
    if (session.localScene.playerPosition.state === "inside") {
      notify("Сначала выйди из здания", "warn");
      return;
    }
    const destination = session.world.locations.find((location) => location.id === locationId);
    const next = session.localScene.playerPosition.state === "vehicle" && session.vehicles.player.currentVehicleId
      ? drivePhysicalVehicleToLocation(session, locationId)
      : travelToLocation(session, locationId);
    if (next === session) {
      notify("Маршрут сейчас недоступен", "warn");
      return;
    }
    setSession(next);
    notify(next.transit.player.journey ? `Маршрут начат: ${destination?.name ?? "точка назначения"}` : `Перемещение: ${destination?.name ?? "точка назначения"}`, "good");
  }

  if (!session) {
    return (
      <div className="boot-screen">
        <strong>NEON LIFE</strong>
        <span>{save.status === "error" ? save.error ?? "Ошибка сохранения" : "Загрузка мира..."}</span>
        <VersionGate guard={versionGuard} />
      </div>
    );
  }

  const rootClass = [
    settings.reducedMotion ? "reduce-motion" : "",
    settings.compactMode ? "compact-mode" : "",
    settings.highContrast ? "high-contrast" : ""
  ].filter(Boolean).join(" ");

  const localMovementOverlay = session.localMovement ? (
    <LocalMovementScreen
      session={session}
      onAdvance={(minutes) => setSession((current) => advanceLocalMovement(current, minutes))}
      onSkip={() => setSession((current) => skipLocalMovement(current))}
      onCancel={() => setSession((current) => cancelLocalMovement(current))}
      onFinish={() => setSession((current) => finishLocalMovement(current))}
    />
  ) : null;

  const transitOverlay = session.transit.player.journey && !localMovementOverlay ? (
    <TransitJourneyScreen
      session={session}
      onWalk={(minutes) => setSession((current) => walkTransitJourney(current, minutes))}
      onWait={(minutes) => setSession((current) => waitTransitJourney(current, minutes))}
      onCancel={() => setSession((current) => cancelTransitJourney(current))}
      onBoard={() => setSession((current) => boardTransitVehicle(current))}
      onTakeSeat={(seatId) => setSession((current) => takeTransitSeat(current, seatId))}
      onStand={() => setSession((current) => standInTransit(current))}
      onYield={(passengerId) => setSession((current) => yieldTransitSeat(current, passengerId))}
      onAdvance={() => setSession((current) => rideTransitToNextStop(current))}
      onInteract={(passengerId) => setSession((current) => interactWithTransitPassenger(current, passengerId))}
      onPhone={(activity: TransitPhoneActivity) => setSession((current) => usePhoneInTransit(current, activity))}
      onAlight={() => setSession((current) => alightTransitVehicle(current))}
      onSkip={() => setSession((current) => skipTransitJourney(current))}
    />
  ) : null;

  const settingsOverlay = settingsOpen && !transitOverlay && !localMovementOverlay ? (
    <SettingsOverlay settings={settings} onSettings={setSettings} save={save} onClose={() => setSettingsOpen(false)} />
  ) : null;

  return (
    <div className={rootClass}>
      <GameShell
        session={session}
        screen={screen}
        onScreenChange={setScreen}
        onSettings={() => setSettingsOpen(true)}
        overlay={transitOverlay ?? localMovementOverlay ?? settingsOverlay}
        notice={notice ? <div className={`toast toast--${notice.tone}`} role="status">{notice.text}</div> : null}
      >
        {screen === "profile" ? <ProfileScreen session={session} /> : null}
        {screen === "map" ? (
          <MapScreen
            session={session} requestedLocationId={requestedLocationId}
            onRequestedLocationHandled={() => setRequestedLocationId(undefined)} onSettings={() => setSettingsOpen(true)}
            onTravel={travel} onWalk={walkTo}
            onEnterBuilding={(buildingId) => setSession((current) => enterLocalBuilding(current, buildingId))}
            onLeaveBuilding={() => setSession((current) => leaveLocalBuilding(current))}
            onMoveBuildingFloor={(floor, method) => setSession((current) => moveInsideBuilding(current, floor, method))}
            onEnterBuildingUnit={(unitId) => setSession((current) => enterBuildingUnit(current, unitId))} onLeaveBuildingUnit={() => setSession((current) => leaveBuildingUnit(current))}
            onEnterInteriorRoom={(roomId) => setSession((current) => enterInteriorRoom(current, roomId))} onLeaveInteriorRoom={() => setSession((current) => leaveInteriorRoom(current))}
            onLifeAction={(action) => setSession((current) => applyLocalLifeAction(current, action))}
            onEnterVehicle={(vehicleId) => setSession((current) => enterPhysicalVehicle(current, vehicleId))}
            onLeaveVehicle={() => setSession((current) => leavePhysicalVehicle(current))}
            onStreetIncidentAction={(incidentId, action) => setSession((current) => actOnStreetIncident(current, incidentId, action))}
          />
        ) : null}
        {screen === "nearby" ? (
          <NearbyScreen
            session={session}
            onSelectPerson={selectPerson}
            onWalkTo={walkTo}
            onEnterBuilding={(buildingId) => setSession((current) => enterLocalBuilding(current, buildingId))}
            onEnterVehicle={(vehicleId) => setSession((current) => enterPhysicalVehicle(current, vehicleId))}
            onLeaveBuilding={() => setSession((current) => leaveLocalBuilding(current))}
            onLeaveVehicle={() => setSession((current) => leavePhysicalVehicle(current))}
            onRouteTo={routeToLocation}
            onLifeAction={(action) => setSession((current) => applyLocalLifeAction(current, action))}
            onStartConversation={(personId) => setSession((current) => beginConversation(current, personId))} onConversationAction={(action) => setSession((current) => continueConversation(current, action))}
            onEndConversation={() => setSession((current) => endConversation(current))} onAdvance={advance} notify={notify}
          />
        ) : null}
      </GameShell>
      <VersionGate guard={versionGuard} />
    </div>
  );
}
