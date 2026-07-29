import { FOOD_CATALOG } from "../../data/products/foodCatalog";
import { getCarriedMassGrams } from "../../gameplay/food/foodSystem";
import { getActiveCourierOrder } from "../../gameplay/jobs/courier/courierSystem";
import { currentPhysicalLocation, isCourierDispatchLocation, isPlayerInsideHome, isPlayerInsideLocation } from "../../gameplay/life/playerPresence";
import { getBusinessAtLocation, localPrice } from "../../gameplay/economy/localEconomy";
import { isLocationOpen } from "../../gameplay/travel/travelSystem";
import type { GameSession } from "../../world/state/types";
import type { LocalLifeAction } from "../actions/localLifeActions";

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
  const business = location ? getBusinessAtLocation(session.economy, location.id) : undefined;
  const shopStock = location && insideLocation ? session.life.food.shopStocks[location.id] : undefined;
  const clinic = location?.type === "clinic" && insideLocation
    ? session.health.facilities.find((item) => item.locationId === location.id)
    : undefined;
  const atDispatch = Boolean(location && insideLocation && isCourierDispatchLocation(location));
  const activeOrder = getActiveCourierOrder(session.jobs.courier);
  const carriedMass = getCarriedMassGrams(session.life.food);
  const insideHome = isPlayerInsideHome(session);
  const open = location ? isLocationOpen(location, session.timestamp) : false;

  return (
    <aside className="building-service-panel" data-no-swipe>
      <header>
        <div><span>ТОЧКА ВЗАИМОДЕЙСТВИЯ</span><h2>{insideHome ? "Личная капсула" : location?.name ?? "Сервис здания"}</h2></div>
        <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
      </header>

      {location ? <div className="building-service-panel__status"><strong className={open ? "status-good" : "status-bad"}>{open ? "ОТКРЫТО" : "ЗАКРЫТО"}</strong><span>{location.code}</span></div> : null}

      {shopStock && location ? (
        <section>
          <h3>КАССА</h3>
          <div className="building-service-list">
            {FOOD_CATALOG.filter((product) => (shopStock[product.id] ?? 0) > 0).slice(0, 5).map((product) => {
              const price = localPrice(product.price, business);
              const fits = carriedMass + product.massGrams <= session.life.food.carryingCapacityGrams;
              return (
                <article key={product.id}>
                  <div><strong>{product.name}</strong><span>₵ {price} · остаток {shopStock[product.id]} · {product.massGrams} г</span></div>
                  <button type="button" disabled={!open || !fits || session.player.balance < price} onClick={() => onAction({ kind: "buy-food", productId: product.id })}>Купить</button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {clinic && location ? (
        <section>
          <h3>МЕДИЦИНСКИЙ ПОСТ</h3>
          <p>Очередь {clinic.queueLength} · запас {clinic.medicalStock} · сервис {clinic.serviceLevel}%.</p>
          <div className="building-service-actions">
            <button type="button" disabled={!open || session.player.balance < 45 || clinic.medicalStock < 1} onClick={() => onAction({ kind: "clinic-care", care: "checkup" })}>Осмотр · ₵ 45</button>
            <button type="button" disabled={!open || session.player.balance < 120 || clinic.medicalStock < 4} onClick={() => onAction({ kind: "clinic-care", care: "stabilize" })}>Стабилизация · ₵ 120</button>
          </div>
        </section>
      ) : null}

      {atDispatch ? (
        <section>
          <h3>ДИСПЕТЧЕРСКАЯ MESHLINE</h3>
          {!activeOrder ? (
            <div className="building-service-list">
              {session.jobs.courier.orders.filter((order) => order.status === "available").slice(0, 4).map((order) => (
                <article key={order.id}>
                  <div><strong>{order.code} · ₵ {order.payout}</strong><span>{order.cargoName} · {order.weightKg} кг · риск {order.risk}</span></div>
                  <button type="button" onClick={() => onAction({ kind: "accept-courier", orderId: order.id })}>Принять</button>
                </article>
              ))}
            </div>
          ) : <p>Активный заказ: {activeOrder.code} · {activeOrder.status}.</p>}
        </section>
      ) : null}

      {activeOrder && location && insideLocation && activeOrder.pickupLocationId === location.id && activeOrder.status === "accepted" ? (
        <section><h3>ЗОНА ВЫДАЧИ</h3><div className="building-service-actions"><button type="button" onClick={() => onAction({ kind: "pickup-courier" })}>Забрать груз {activeOrder.code}</button></div></section>
      ) : null}

      {activeOrder && location && insideLocation && activeOrder.dropoffLocationId === location.id && activeOrder.status === "in-transit" ? (
        <section><h3>ТОЧКА ПЕРЕДАЧИ</h3><div className="building-service-actions"><button type="button" onClick={() => onAction({ kind: "deliver-courier" })}>Передать груз {activeOrder.code}</button></div></section>
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

      {!shopStock && !clinic && !atDispatch && !insideHome && !(activeOrder && location && [activeOrder.pickupLocationId, activeOrder.dropoffLocationId].includes(location.id)) ? <p className="building-service-empty">В этой зоне пока нет доступного сервиса.</p> : null}
    </aside>
  );
}
