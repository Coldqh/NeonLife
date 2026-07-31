import type { GameSession } from "../../world/state/types";
import { FOOD_CATALOG, getFoodProduct } from "../../data/products/foodCatalog";
import { canPrepare, getCarriedMassGrams, getFoodFreshness, type FoodStack } from "../../gameplay/food/foodSystem";
import { getActiveCourierOrder } from "../../gameplay/jobs/courier/courierSystem";
import { activeObligations } from "../../gameplay/pressure/pressureSystem";
import { getBusinessAtLocation, localPrice } from "../../gameplay/economy/localEconomy";
import { isLocationOpen } from "../../gameplay/travel/travelSystem";
import {
  currentPhysicalLocation,
  getPlayerHomeBuilding,
  getPlayerHomeUnit,
  isCourierDispatchLocation,
  isPlayerInsideHome,
  isPlayerInsideLocation
} from "../../gameplay/life/playerPresence";
import type { LocalLifeAction } from "../actions/localLifeActions";
import { formatGameShortDateTime, formatGameTime } from "../../core/time/gameTime";

function stacksByProduct(stacks: FoodStack[], timestamp: number): Array<{ productId: string; quantity: number; freshness: string }> {
  const grouped = new Map<string, { quantity: number; freshness: string }>();
  for (const stack of stacks) {
    const current = grouped.get(stack.productId);
    const freshness = getFoodFreshness(stack, timestamp);
    grouped.set(stack.productId, {
      quantity: (current?.quantity ?? 0) + stack.quantity,
      freshness: current?.freshness === "spoiled" || freshness === "spoiled" ? "spoiled" : current?.freshness === "expiring" || freshness === "expiring" ? "expiring" : "fresh"
    });
  }
  return [...grouped.entries()].map(([productId, value]) => ({ productId, ...value }));
}

function freshnessLabel(value: string): string {
  if (value === "spoiled") return "испорчено";
  if (value === "expiring") return "срок заканчивается";
  return "свежее";
}

function orderStage(status: string): string {
  if (status === "accepted") return "Нужно забрать груз";
  if (status === "in-transit") return "Груз на руках";
  return status;
}

export function LocalActionsPanel({
  session,
  onAction,
  onRouteTo
}: {
  session: GameSession;
  onAction: (action: LocalLifeAction) => void;
  onRouteTo: (locationId: string) => void;
}) {
  const position = session.localScene.playerPosition;
  const location = currentPhysicalLocation(session);
  const insideLocation = Boolean(location && isPlayerInsideLocation(session, location.id));
  const homeBuilding = getPlayerHomeBuilding(session);
  const homeUnit = getPlayerHomeUnit(session);
  const insideHome = isPlayerInsideHome(session);
  const inHomeBuilding = position.state === "inside" && position.buildingId === homeBuilding?.id;
  const carried = stacksByProduct(session.life.food.carried, session.timestamp);
  const stored = stacksByProduct(session.life.food.storage, session.timestamp);
  const carriedMass = getCarriedMassGrams(session.life.food);
  const shopStock = location && insideLocation ? session.life.food.shopStocks[location.id] : undefined;
  const business = location ? getBusinessAtLocation(session.economy, location.id) : undefined;
  const activeOrder = getActiveCourierOrder(session.jobs.courier);
  const dispatch = session.world.locations.find((item) => isCourierDispatchLocation(item));
  const atDispatch = Boolean(dispatch && isPlayerInsideLocation(session, dispatch.id));
  const obligations = activeObligations(session.pressure);
  const clinic = location?.type === "clinic" && insideLocation
    ? session.health.facilities.find((item) => item.locationId === location.id)
    : undefined;

  return (
    <div className="local-actions">
      <section className="local-action-card local-action-card--status">
        <header><div><span>Физическое состояние</span><h2>{insideHome ? "Своя капсула" : location?.name ?? "Улица"}</h2></div><strong>{position.state}</strong></header>
        <p>{insideHome ? `Помещение ${homeUnit?.unitNumber ?? "—"}. Доступны шкаф, кровать и терминал.` : inHomeBuilding ? `Коридор ${homeBuilding?.addressCode ?? "жилого блока"}.` : position.state === "outside" ? "Действия зависят от того, куда ты реально дошёл и вошёл." : "Сначала заверши текущее перемещение."}</p>
        <div className="local-action-buttons">
          {inHomeBuilding && !insideHome ? <button type="button" onClick={() => onAction({ kind: "enter-home-unit" })}>Войти в свою капсулу</button> : null}
          {insideHome ? <button type="button" onClick={() => onAction({ kind: "leave-home-unit" })}>Выйти в коридор</button> : null}
          {!inHomeBuilding && homeBuilding ? <button type="button" onClick={() => onRouteTo(session.life.housing.locationId)}>Маршрут домой</button> : null}
          {position.state === "outside" ? <button type="button" className="danger" onClick={() => onAction({ kind: "sleep-outside", hours: 6 })}>Спать на улице · 6 ч.</button> : null}
        </div>
      </section>

      {insideHome ? (
        <section className="local-action-card">
          <header><div><span>Жильё</span><h2>Капсула и терминал</h2></div><strong>{session.player.housingDaysLeft} дн.</strong></header>
          <div className="local-action-buttons">
            <button type="button" onClick={() => onAction({ kind: "sleep-home", hours: 8 })}>Спать · 8 ч.</button>
            <button type="button" onClick={() => onAction({ kind: "sleep-home", hours: 4 })}>Короткий сон · 4 ч.</button>
            <button type="button" disabled={!session.life.food.carried.length} onClick={() => onAction({ kind: "store-food" })}>Убрать продукты в шкаф</button>
            <button type="button" onClick={() => onAction({ kind: "discard-spoiled" })}>Выбросить испорченное</button>
          </div>
          <div className="local-action-list">
            {obligations.map((obligation) => (
              <article key={obligation.id}><div><strong>{obligation.creditorName}</strong><span>{obligation.code} · срок {formatGameShortDateTime(obligation.dueAt)}</span></div><button type="button" disabled={session.player.balance < obligation.amount} onClick={() => onAction({ kind: "pay-obligation", obligationId: obligation.id })}>Оплатить ₵ {obligation.amount}</button></article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="local-action-card">
        <header><div><span>Переносимый груз</span><h2>Еда и расходники</h2></div><strong>{(carriedMass / 1000).toFixed(1)} / {(session.life.food.carryingCapacityGrams / 1000).toFixed(1)} кг</strong></header>
        {carried.length ? <div className="local-action-list">{carried.map((item) => {
          const product = getFoodProduct(item.productId);
          const ready = canPrepare(product.requirement, session.life.food.appliances, insideHome);
          return <article key={item.productId}><div><strong>{product.name} ×{item.quantity}</strong><span>{freshnessLabel(item.freshness)} · {product.massGrams} г · голод −{product.hungerRelief}</span></div><button type="button" disabled={!ready || item.freshness === "spoiled"} onClick={() => onAction({ kind: "eat-food", productId: product.id })}>{ready ? "Съесть" : "Нужен дом"}</button></article>;
        })}</div> : <p className="local-action-empty">В сумке нет еды.</p>}
        {insideHome && stored.length ? <><h3>Пищевой шкаф</h3><div className="local-action-list">{stored.map((item) => {
          const product = getFoodProduct(item.productId);
          const ready = canPrepare(product.requirement, session.life.food.appliances, true);
          return <article key={item.productId}><div><strong>{product.name} ×{item.quantity}</strong><span>{freshnessLabel(item.freshness)} · {product.requirement}</span></div><button type="button" disabled={!ready || item.freshness === "spoiled"} onClick={() => onAction({ kind: "eat-food", productId: product.id })}>Приготовить</button></article>;
        })}</div></> : null}
      </section>

      {shopStock && location ? (
        <section className="local-action-card">
          <header><div><span>Торговая точка</span><h2>{location.name}</h2></div><strong>{isLocationOpen(location, session.timestamp) ? "открыто" : "закрыто"}</strong></header>
          <div className="local-action-list">{FOOD_CATALOG.filter((product) => (shopStock[product.id] ?? 0) > 0).map((product) => {
            const price = localPrice(product.price, business);
            const fits = carriedMass + product.massGrams <= session.life.food.carryingCapacityGrams;
            return <article key={product.id}><div><strong>{product.name}</strong><span>₵ {price} · остаток {shopStock[product.id]} · {product.massGrams} г</span></div><button type="button" disabled={!fits || session.player.balance < price || !isLocationOpen(location, session.timestamp)} onClick={() => onAction({ kind: "buy-food", productId: product.id })}>Купить</button></article>;
          })}</div>
        </section>
      ) : null}

      <section className="local-action-card">
        <header><div><span>Работа</span><h2>Курьер MESHLINE</h2></div><strong>{session.jobs.courier.rating}%</strong></header>
        {!activeOrder ? atDispatch ? (
          <div className="local-action-list">{session.jobs.courier.orders.filter((order) => order.status === "available").slice(0, 4).map((order) => (
            <article key={order.id}><div><strong>{order.code} · ₵ {order.payout}</strong><span>{order.cargoName} · {order.weightKg} кг · риск {order.risk}</span></div><button type="button" onClick={() => onAction({ kind: "accept-courier", orderId: order.id })}>Принять</button></article>
          ))}</div>
        ) : <div className="local-action-buttons"><button type="button" disabled={!dispatch} onClick={() => dispatch && onRouteTo(dispatch.id)}>Ехать в диспетчерскую</button></div> : (
          <div className="courier-active">
            <strong>{activeOrder.code} · {orderStage(activeOrder.status)}</strong>
            <span>{activeOrder.cargoName} · срок {formatGameTime(activeOrder.deadlineAt)}</span>
            {session.jobs.courier.carriedCargo ? <p>Груз: {session.jobs.courier.carriedCargo.weightKg} кг · состояние {session.jobs.courier.carriedCargo.condition}%</p> : null}
            <div className="local-action-buttons">
              {activeOrder.status === "accepted" ? <><button type="button" onClick={() => onRouteTo(activeOrder.pickupLocationId)}>Маршрут к грузу</button><button type="button" disabled={!isPlayerInsideLocation(session, activeOrder.pickupLocationId)} onClick={() => onAction({ kind: "pickup-courier" })}>Забрать груз</button></> : null}
              {activeOrder.status === "in-transit" ? <><button type="button" onClick={() => onRouteTo(activeOrder.dropoffLocationId)}>Маршрут к клиенту</button><button type="button" disabled={!isPlayerInsideLocation(session, activeOrder.dropoffLocationId)} onClick={() => onAction({ kind: "deliver-courier" })}>Передать груз</button></> : null}
            </div>
          </div>
        )}
      </section>

      {clinic && location ? (
        <section className="local-action-card">
          <header><div><span>Медицина</span><h2>{location.name}</h2></div><strong>{clinic.status}</strong></header>
          <p>Очередь {clinic.queueLength} · запас {clinic.medicalStock} · сервис {clinic.serviceLevel}%.</p>
          <div className="local-action-buttons"><button type="button" disabled={session.player.balance < 45 || clinic.medicalStock < 1} onClick={() => onAction({ kind: "clinic-care", care: "checkup" })}>Осмотр · ₵ 45</button><button type="button" disabled={session.player.balance < 120 || clinic.medicalStock < 4} onClick={() => onAction({ kind: "clinic-care", care: "stabilize" })}>Стабилизация · ₵ 120</button></div>
        </section>
      ) : null}
    </div>
  );
}
