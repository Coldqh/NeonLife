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
import { SettingsOverlay } from "./overlays/SettingsOverlay";
import type { GameScreen, NoticeState, NoticeTone } from "./shared/types";
import { getPerson, toKnownNpc } from "../people/network/humanNetwork";
import type { TransitPhoneActivity } from "../simulation/transit/types";
import {
  alightTransitVehicle,
  approachLocalBuilding,
  approachPhysicalVehicle,
  boardTransitVehicle,
  drivePhysicalVehicleToLocation,
  enterLocalBuilding,
  enterPhysicalVehicle,
  interactWithTransitPassenger,
  leaveLocalBuilding,
  leavePhysicalVehicle,
  progressLife,
  rideTransitToNextStop,
  skipTransitJourney,
  standInTransit,
  takeTransitSeat,
  travelToLocation,
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

  function travel(locationId: string): void {
    if (!session || session.transit.player.journey) return;
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

  const transitOverlay = session.transit.player.journey ? (
    <TransitJourneyScreen
      session={session}
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

  const settingsOverlay = settingsOpen && !transitOverlay ? (
    <SettingsOverlay settings={settings} onSettings={setSettings} save={save} onClose={() => setSettingsOpen(false)} />
  ) : null;

  return (
    <div className={rootClass}>
      <GameShell
        session={session}
        screen={screen}
        onScreenChange={setScreen}
        onSettings={() => setSettingsOpen(true)}
        overlay={transitOverlay ?? settingsOverlay}
        notice={notice ? <div className={`toast toast--${notice.tone}`} role="status">{notice.text}</div> : null}
      >
        {screen === "profile" ? (
          <ProfileScreen
            session={session}
            onLeaveBuilding={() => setSession((current) => leaveLocalBuilding(current))}
            onLeaveVehicle={() => setSession((current) => leavePhysicalVehicle(current))}
          />
        ) : null}
        {screen === "map" ? (
          <MapScreen
            session={session}
            requestedLocationId={requestedLocationId}
            onRequestedLocationHandled={() => setRequestedLocationId(undefined)}
            onTravel={travel}
          />
        ) : null}
        {screen === "nearby" ? (
          <NearbyScreen
            session={session}
            onSelectPerson={selectPerson}
            onApproachBuilding={(buildingId) => setSession((current) => approachLocalBuilding(current, buildingId))}
            onEnterBuilding={(buildingId) => setSession((current) => enterLocalBuilding(current, buildingId))}
            onApproachVehicle={(vehicleId) => setSession((current) => approachPhysicalVehicle(current, vehicleId))}
            onEnterVehicle={(vehicleId) => setSession((current) => enterPhysicalVehicle(current, vehicleId))}
            onRouteTo={routeToLocation}
            onAdvance={advance}
            notify={notify}
          />
        ) : null}
      </GameShell>
      <VersionGate guard={versionGuard} />
    </div>
  );
}
