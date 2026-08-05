import { getProduct } from "../../data/products/productCatalog";
import { getCarriedMassGrams } from "../../gameplay/food/foodSystem";
import { currentPhysicalLocation, isPlayerInsideHome, isPlayerInsideLocation } from "../../gameplay/life/playerPresence";
import { boxingRankLabel, getEquipment, skillLabel, TRAINING_ACTIONS } from "../../gameplay/playerLoop/playerLoopSystem";
import type { GameSession } from "../../world/state/types";
import { venueCategoryLabel, venueIsOpen } from "./mapUi";
import type { LocalLifeAction } from "../actions/localLifeActions";

function venueStatusLabel(status: GameSession["urban"]["venueOperations"]["operations"][number]["status"] | undefined): string {
  if (status === "insolvent") return "БАНКРОТ";
  if (status === "seized") return "ОПЕЧАТАНО";
  if (status === "renovation") return "РЕМОНТ";
  if (status === "vacant") return "ПУСТУЕТ";
  if (status === "closed") return "ЗАКРЫТО";
  return "ЗАКРЫТО";
}

export function BuildingServicePanel({
  session,
  onAction,
  onClose
}: {
  session: GameSession;
  onAction: (action: LocalLifeAction) => void;
  onClose: () => void;
}) {
  const location = currentPhysicalLocation(session);
  const insideLocation = Boolean(location && isPlayerInsideLocation(session, location.id));
  const carriedMass = getCarriedMassGrams(session.life.food);
  const insideHome = isPlayerInsideHome(session);
  const venue = session.urban.venues.find((item) => item.unitId === session.localScene.playerPosition.unitId);
  const venueOperation = venue ? session.urban.venueOperations.operations.find((item) => item.venueId === venue.id) : undefined;
  const venueOpen = Boolean(venue && venueOperation?.status === "operating" && venueIsOpen(venue, session.timestamp));
  const venueQueueReady = venueOperation?.queue.playerState === "ready" || (venueOperation?.queue.estimatedWaitMinutes ?? 0) <= 0;
  const venueBuilding = venue ? session.urban.buildings.find((building) => building.id === venue.buildingId) : undefined;
  const ownedVehicleIds = new Set([session.vehicles.player.currentVehicleId, ...session.vehicles.player.ownedVehicleIds].filter((id): id is string => Boolean(id)));
  const serviceVehicleId = venueBuilding ? session.vehicles.vehicles.find((vehicle) => {
    if (!ownedVehicleIds.has(vehicle.id) || vehicle.position.sectorId !== venueBuilding.sectorId) return false;
    if (vehicle.position.buildingId === venueBuilding.id) return true;
    const dx = Math.max(venueBuilding.bounds.xM - vehicle.position.xM, 0, vehicle.position.xM - (venueBuilding.bounds.xM + venueBuilding.bounds.widthM));
    const dy = Math.max(venueBuilding.bounds.yM - vehicle.position.yM, 0, vehicle.position.yM - (venueBuilding.bounds.yM + venueBuilding.bounds.heightM));
    return Math.hypot(dx, dy) <= 45;
  })?.id : undefined;
  const pendingSupplies = venue ? session.urban.venueOperations.supplyOrders.filter((order) => order.venueId === venue.id && (order.status === "ordered" || order.status === "in-transit")) : [];
  const trainingActions = venue ? TRAINING_ACTIONS.filter((training) => training.venueCategories.includes(venue.category as "gym" | "boxing-gym" | "shooting-range")) : [];

  return (
    <aside className="building-service-panel" data-no-swipe>
      <header>
        <div><span>ТОЧКА ВЗАИМОДЕЙСТВИЯ</span><h2>{insideHome ? "Личная капсула" : venue?.name ?? location?.name ?? "Сервис здания"}</h2></div>
        <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
      </header>

      {venue ? <div className="building-service-panel__status"><strong className={venueOpen ? "status-good" : "status-bad"}>{venueOpen ? "ОТКРЫТО" : venueStatusLabel(venueOperation?.status)}</strong><span>{venue.code} · {venueCategoryLabel(venue.category)}</span></div> : null}

      {venue && venueOperation ? (
        <section className="venue-service">
          <header className="venue-service__summary">
            <div><span>ОЧЕРЕДЬ</span><strong>{venueOperation.queue.waitingCount} чел. · ~{venueOperation.queue.estimatedWaitMinutes} мин.</strong></div>
            <div><span>ПЕРСОНАЛ</span><strong>{venueOperation.staffPresent} на смене</strong></div>
            <div><span>КАССА</span><strong>₵ {Math.round(venueOperation.cash)}</strong></div>
            <div><span>ПОСТАВКИ</span><strong>{pendingSupplies.length ? `${pendingSupplies.length} в пути` : "нет заказов"}</strong></div>
          </header>
          {venueOperation.status === "insolvent" ? <p className="building-service-empty">Бизнес неплатёжеспособен. Касса закрыта, новые заказы и обслуживание остановлены.</p> : !venueOpen ? <p className="building-service-empty">Заведение сейчас не обслуживает посетителей.</p> : !venueQueueReady ? (
            <div className="venue-queue-card">
              <p>Перед заказом нужно дождаться кассы. Текущее ожидание: около {venueOperation.queue.estimatedWaitMinutes} мин.</p>
              <button type="button" onClick={() => onAction({ kind: "join-venue-queue", venueId: venue.id })}>Встать в очередь</button>
            </div>
          ) : (
            <div className="venue-offer-list">
              {venueOperation.offers.filter((offer) => offer.active).map((offer) => {
                const product = offer.productId ? getProduct(offer.productId) : null;
                const equipment = getEquipment(offer.productId);
                const carriedProduct = product && (product.category === "food" || product.category === "drink" || product.category === "medicine");
                const fits = !carriedProduct || carriedMass + product.massGrams <= session.life.food.carryingCapacityGrams;
                const vehicleRequired = offer.kind === "vehicle-service" && !serviceVehicleId;
                const equipmentOwned = Boolean(equipment && session.playerLoop.ownedEquipmentIds.includes(equipment.id));
                const equipmentRequirementMet = !equipment?.requiredSkill || session.playerLoop.skills[equipment.requiredSkill] >= (equipment.minimumSkill ?? 0);
                return (
                  <article key={offer.id}>
                    <div><strong>{offer.name}</strong><span>{offer.description}</span><small>₵ {offer.currentPrice} · остаток {offer.stock} · {offer.durationMinutes} мин.</small></div>
                    <div className="venue-offer-actions">
                      <button type="button" disabled={!venueOpen || offer.stock <= 0 || session.player.balance < offer.currentPrice || !fits || vehicleRequired || equipmentOwned || !equipmentRequirementMet} onClick={() => onAction({ kind: "buy-venue-offer", venueId: venue.id, offerId: offer.id })}>{equipmentOwned ? "Уже куплено" : !equipmentRequirementMet ? `Нужен ${equipment?.requiredSkill ? skillLabel(equipment.requiredSkill) : "навык"} ${equipment?.minimumSkill ?? 0}` : vehicleRequired ? "Нет машины рядом" : offer.stock <= 0 ? "Нет в наличии" : "Купить"}</button>
                      <button type="button" className="crime-action" disabled={!venueOpen || offer.stock <= 0 || !fits || session.playerCrime.custody?.status === "detained"} onClick={() => onAction({ kind: "shoplift-venue-offer", venueId: venue.id, offerId: offer.id })}>Украсть</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {trainingActions.length && venueOpen ? (
            <section className="venue-training-actions">
              <header><span>ТРЕНИРОВКИ</span><strong>{venue.name}</strong></header>
              {trainingActions.map((training) => <article key={training.id}><div><strong>{training.title}</strong><span>{training.description}</span><small>{skillLabel(training.skill)} {session.playerLoop.skills[training.skill]} · ₵ {training.cost} · {training.durationMinutes} мин.</small></div><button type="button" disabled={!venueQueueReady || session.player.balance < training.cost} onClick={() => onAction({ kind: "train", trainingId: training.id, venueId: venue.id })}>Тренироваться</button></article>)}
            </section>
          ) : null}
          {venue?.category === "boxing-gym" && venueOpen ? (
            <section className="venue-boxing-actions">
              <div><span>БОКСЁРСКАЯ КАРЬЕРА</span><strong>{boxingRankLabel(session.playerLoop.boxingRank)}</strong><small>Рейтинг {session.playerLoop.boxingRating} · {session.playerLoop.boxingWins}-{session.playerLoop.boxingLosses}</small></div>
              <button type="button" disabled={!venueQueueReady || session.player.condition.health < 45 || session.player.condition.fatigue > 78} onClick={() => onAction({ kind: "boxing-fight", venueId: venue.id })}>Провести бой</button>
            </section>
          ) : null}
          {venueOperation.queue.playerState === "waiting" ? <button type="button" className="venue-service__leave" onClick={() => onAction({ kind: "leave-venue-queue", venueId: venue.id })}>Покинуть очередь</button> : null}
          <div className="venue-crime-actions">
            <span>Незаконные действия оставляют свидетелей, камеры и физические улики.</span>
            <button type="button" className="crime-action crime-action--danger" disabled={!venueOpen || venueOperation.cash < 60 || session.playerCrime.custody?.status === "detained"} onClick={() => onAction({ kind: "rob-venue-register", venueId: venue.id })}>Ограбить кассу</button>
          </div>
        </section>
      ) : null}


      {insideHome ? (
        <section>
          <h3>КАПСУЛА</h3>
          <div className="building-service-actions">
            <button type="button" onClick={() => onAction({ kind: "sleep-home", hours: 8 })}>Спать · 8 ч.</button>
            <button type="button" disabled={!session.life.food.carried.length} onClick={() => onAction({ kind: "store-food" })}>Убрать продукты</button>
            <button type="button" onClick={() => onAction({ kind: "discard-spoiled" })}>Выбросить испорченное</button>
          </div>
        </section>
      ) : null}

      {!venue && !insideHome ? <p className="building-service-empty">В этой зоне пока нет доступного сервиса.</p> : null}
    </aside>
  );
}
