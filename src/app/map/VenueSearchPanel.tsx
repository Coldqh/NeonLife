import { useMemo, useState } from "react";
import type { VenueCategory, VenueState } from "../../simulation/urban/types";
import type { GameSession } from "../../world/state/types";
import { venueCategoryLabel, venueIsOpen } from "./mapUi";

const CATEGORY_OPTIONS: Array<{ value: "all" | VenueCategory; label: string }> = [
  { value: "all", label: "Все категории" },
  { value: "food", label: "Еда" },
  { value: "convenience", label: "Продукты" },
  { value: "market", label: "Рынки" },
  { value: "bar", label: "Бары" },
  { value: "clinic", label: "Клиники" },
  { value: "pharmacy", label: "Аптеки" },
  { value: "repair", label: "Ремонт" },
  { value: "cyberware", label: "Импланты" },
  { value: "clothing", label: "Одежда" },
  { value: "entertainment", label: "Развлечения" },
  { value: "hotel", label: "Ночлег" },
  { value: "office-service", label: "Услуги" }
];

function statusLabel(venue: VenueState, session: GameSession): string {
  if (venue.operatingStatus === "vacant") return "ПУСТУЕТ";
  if (venue.operatingStatus === "renovation") return "РЕМОНТ";
  if (venue.operatingStatus === "closed") return "ЗАКРЫТО";
  return venueIsOpen(venue, session.timestamp) ? "ОТКРЫТО" : "НЕ РАБОТАЕТ";
}

export function VenueSearchPanel({
  session,
  currentSectorId,
  onClose,
  onSelectVenue
}: {
  session: GameSession;
  currentSectorId: string;
  onClose: () => void;
  onSelectVenue: (venue: VenueState) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | VenueCategory>("all");
  const [openOnly, setOpenOnly] = useState(true);
  const player = session.localScene.playerPosition;

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    const buildingById = new Map(session.urban.buildings.map((building) => [building.id, building]));
    return session.urban.venues
      .filter((venue) => category === "all" || venue.category === category)
      .filter((venue) => !openOnly || venueIsOpen(venue, session.timestamp))
      .filter((venue) => !normalized || `${venue.name} ${venue.code} ${venue.tags.join(" ")} ${venueCategoryLabel(venue.category)}`.toLocaleLowerCase("ru-RU").includes(normalized))
      .map((venue) => {
        const building = buildingById.get(venue.buildingId);
        const distanceM = building ? Math.round(Math.hypot(
          building.bounds.xM + building.bounds.widthM / 2 - player.xM,
          building.bounds.yM + building.bounds.heightM / 2 - player.yM
        )) : Number.POSITIVE_INFINITY;
        return { venue, building, distanceM };
      })
      .sort((left, right) => Number(right.venue.sectorId === currentSectorId) - Number(left.venue.sectorId === currentSectorId)
        || left.distanceM - right.distanceM
        || right.venue.mapPriority - left.venue.mapPriority)
      .slice(0, 40);
  }, [category, currentSectorId, openOnly, player.xM, player.yM, query, session.timestamp, session.urban.buildings, session.urban.venues]);

  return (
    <aside className="venue-search" data-no-swipe>
      <header>
        <div><span>ГОРОДСКОЙ КАТАЛОГ</span><h2>Найти заведение</h2></div>
        <button type="button" onClick={onClose} aria-label="Закрыть поиск">×</button>
      </header>
      <div className="venue-search__controls">
        <label><span>Название или услуга</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="кафе, ремонт, клиника…" /></label>
        <label><span>Категория</span><select value={category} onChange={(event) => setCategory(event.target.value as "all" | VenueCategory)}>{CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="venue-search__toggle"><input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} /><span>Только открытые сейчас</span></label>
      </div>
      <div className="venue-search__summary"><span>Найдено: {results.length}</span><span>В секторе: {results.filter((item) => item.venue.sectorId === currentSectorId).length}</span></div>
      <div className="venue-search__results">
        {results.map(({ venue, building, distanceM }) => {
          const operation = session.urban.venueOperations.operations.find((item) => item.venueId === venue.id);
          const status = statusLabel(venue, session);
          return (
            <button type="button" key={venue.id} onClick={() => onSelectVenue(venue)}>
              <i className={`venue-search__icon venue-search__icon--${venue.category}`}>{venue.category === "food" ? "♨" : venue.category === "clinic" || venue.category === "pharmacy" ? "+" : venue.category === "repair" ? "⚒" : "▤"}</i>
              <span><strong>{venue.name}</strong><small>{venueCategoryLabel(venue.category)} · {building?.streetName ?? building?.addressCode ?? venue.unitNumber} · {venue.floor}F</small><em className={status === "ОТКРЫТО" ? "is-open" : ""}>{status} · очередь {operation?.queue.waitingCount ?? 0} · ₵{"₵".repeat(Math.max(0, venue.priceTier - 1))}</em></span>
              <b>{Number.isFinite(distanceM) ? distanceM < 1_000 ? `${distanceM} м` : `${(distanceM / 1_000).toFixed(1)} км` : "—"}</b>
            </button>
          );
        })}
        {!results.length ? <p>Подходящих заведений нет.</p> : null}
      </div>
    </aside>
  );
}
