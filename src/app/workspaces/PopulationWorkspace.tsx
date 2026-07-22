import { useState } from "react";
import { getFoodProduct } from "../../data/products/foodCatalog";
import type { HouseholdStatus } from "../../simulation/population/types";
import type { GameSession } from "../../world/state/types";

type PopulationTab = "districts" | "households" | "housing" | "flow";

function statusRank(status: HouseholdStatus): number {
  if (status === "displaced") return 4;
  if (status === "arrears") return 3;
  if (status === "strained") return 2;
  return 1;
}

function districtName(session: GameSession, districtId: string): string {
  return session.world.districts.find((district) => district.id === districtId)?.name ?? "UNKNOWN DISTRICT";
}

function locationName(session: GameSession, locationId: string | null): string {
  if (!locationId) return "NO FIXED ADDRESS";
  return session.world.locations.find((location) => location.id === locationId)?.name ?? "UNKNOWN HOUSING";
}

function pantryLabel(session: GameSession, householdId: string): string {
  const household = session.population.households.find((item) => item.id === householdId);
  if (!household?.pantry.length) return "EMPTY";
  return household.pantry
    .slice(0, 3)
    .map((item) => `${getFoodProduct(item.productId).code} ×${item.units}`)
    .join(" · ");
}

export function PopulationWorkspace({ session }: { session: GameSession }) {
  const [tab, setTab] = useState<PopulationTab>("districts");
  const state = session.population;
  const atRisk = state.households
    .filter((household) => household.status !== "stable")
    .slice()
    .sort((left, right) => statusRank(right.status) - statusRank(left.status) || right.debt - left.debt)
    .slice(0, 24);
  const unemployed = state.employments.filter((employment) => employment.status === "unemployed").length;
  const absent = state.employments.filter((employment) => employment.status === "absent").length;
  const activeLinks = state.residents.filter((resident) => resident.activePersonId).length;
  const availableBeds = state.housing.reduce((sum, housing) => sum + Math.max(0, housing.capacity - housing.occupied), 0);

  return (
    <div className="population-workspace">
      <section className="population-summary">
        <div><span>RESIDENTS</span><strong>{state.residents.length}</strong><small>{activeLinks} active NPC</small></div>
        <div><span>HOUSEHOLDS</span><strong>{state.households.length}</strong><small>{atRisk.length} under pressure</small></div>
        <div><span>EMPLOYMENT</span><strong>{state.employments.length - unemployed}</strong><small>{unemployed} unemployed · {absent} absent</small></div>
        <div><span>HOUSING</span><strong>{availableBeds} BEDS</strong><small>{state.totals.moves} total moves</small></div>
      </section>

      <nav className="population-tabs" aria-label="Population systems">
        <button type="button" className={tab === "districts" ? "is-active" : ""} onClick={() => setTab("districts")}>РАЙОНЫ</button>
        <button type="button" className={tab === "households" ? "is-active" : ""} onClick={() => setTab("households")}>ДОМОХОЗЯЙСТВА</button>
        <button type="button" className={tab === "housing" ? "is-active" : ""} onClick={() => setTab("housing")}>ЖИЛЬЁ</button>
        <button type="button" className={tab === "flow" ? "is-active" : ""} onClick={() => setTab("flow")}>ПОТОКИ</button>
      </nav>

      {tab === "districts" ? (
        <section className="population-districts">
          {state.cohorts.map((cohort) => {
            const employmentBase = Math.max(1, cohort.employed + cohort.unemployed);
            const employmentRate = Math.round(cohort.employed / employmentBase * 100);
            const foodSecurity = Math.round(cohort.foodSecureHouseholds / Math.max(1, cohort.households) * 100);
            return (
              <article className="population-district" key={cohort.districtId}>
                <header>
                  <div><span>DISTRICT COHORT</span><strong>{districtName(session, cohort.districtId)}</strong><small>{cohort.sampleSize} stable records represent {cohort.representedPopulation.toLocaleString("ru-RU")} residents</small></div>
                  <em>{employmentRate}% EMPLOYED</em>
                </header>
                <div className="population-district__metrics">
                  <div><span>UNEMPLOYED</span><strong>{cohort.unemployed.toLocaleString("ru-RU")}</strong></div>
                  <div><span>ILL / DISABLED</span><strong>{cohort.ill.toLocaleString("ru-RU")}</strong></div>
                  <div><span>UNHOUSED</span><strong>{cohort.unhoused.toLocaleString("ru-RU")}</strong></div>
                  <div><span>FOOD SECURE</span><strong>{foodSecurity}%</strong></div>
                </div>
                <footer><span>{cohort.households} households</span><span>{cohort.householdsInArrears} in arrears</span><span>AVG RENT ₵ {cohort.averageRent}</span></footer>
              </article>
            );
          })}
        </section>
      ) : null}

      {tab === "households" ? (
        <section className="population-households">
          <header><div><span>HOUSEHOLD ECONOMY</span><strong>{atRisk.length ? "UNSTABLE HOMES" : "NO CRITICAL HOUSEHOLDS"}</strong></div><small>Money, concrete food, rent and work are settled every day.</small></header>
          <div className="population-household-list">
            {atRisk.map((household) => (
              <article className={`population-household population-household--${household.status}`} key={household.id}>
                <div><span>{household.kind.toUpperCase()} · {districtName(session, household.districtId)}</span><strong>{locationName(session, household.homeLocationId)}</strong><small>{household.memberIds.length} residents · {pantryLabel(session, household.id)}</small></div>
                <div><span>{household.spendingMode.toUpperCase()}</span><strong>₵ {household.dailyIncome} / DAY</strong><small>spent ₵ {household.dailyExpenses}</small></div>
                <div><span>BALANCE</span><strong>₵ {household.balance}</strong><small>debt ₵ {household.debt} · moves {household.moveCount}</small></div>
                <em>{household.status.toUpperCase()}</em>
              </article>
            ))}
            {!atRisk.length ? <div className="empty-terminal">Домохозяйства пока удерживают жильё, питание и платежи.</div> : null}
          </div>
        </section>
      ) : null}

      {tab === "housing" ? (
        <section className="population-housing-list">
          {state.housing.map((housing) => {
            const location = session.world.locations.find((item) => item.id === housing.locationId);
            const occupancy = Math.round(housing.occupied / Math.max(1, housing.capacity) * 100);
            return (
              <article className={`population-housing population-housing--${housing.status}`} key={housing.id}>
                <header><div><span>{districtName(session, housing.districtId)}</span><strong>{location?.name ?? "HOUSING"}</strong></div><em>{housing.status.toUpperCase()}</em></header>
                <div><span>OCCUPANCY</span><strong>{housing.occupied}/{housing.capacity}</strong><small>{occupancy}% · {Math.max(0, housing.capacity - housing.occupied)} free</small></div>
                <div><span>RENT / BED</span><strong>₵ {housing.baseRentPerBedWeek}</strong><small>collected today ₵ {housing.rentCollectedToday}</small></div>
                <div><span>CONDITION</span><strong>{housing.condition}%</strong><small>maintenance ₵ {housing.maintenanceFund}</small></div>
                <div><span>ARREARS</span><strong>{housing.arrearsHouseholds}</strong><small>households</small></div>
              </article>
            );
          })}
        </section>
      ) : null}

      {tab === "flow" ? (
        <section className="population-flow">
          <div><span>WAGES PAID</span><strong>₵ {state.totals.wagesPaid.toLocaleString("ru-RU")}</strong><small>unpaid ₵ {state.totals.unpaidWages.toLocaleString("ru-RU")}</small></div>
          <div><span>RENT</span><strong>₵ {state.totals.rentPaid.toLocaleString("ru-RU")}</strong><small>maintenance ₵ {state.totals.maintenanceSpent.toLocaleString("ru-RU")}</small></div>
          <div><span>FOOD SALES</span><strong>₵ {state.totals.foodSales.toLocaleString("ru-RU")}</strong><small>concrete products removed from shops</small></div>
          <div><span>SERVICES</span><strong>₵ {(state.totals.medicalSales + state.totals.transportSales + state.totals.discretionarySales).toLocaleString("ru-RU")}</strong><small>medical, transit and leisure</small></div>
          <div><span>DEBT REPAID</span><strong>₵ {state.totals.debtRepaid.toLocaleString("ru-RU")}</strong><small>{state.simulatedDays} settled days</small></div>
          <div><span>MOVES</span><strong>{state.totals.moves}</strong><small>between physical housing nodes</small></div>
        </section>
      ) : null}
    </div>
  );
}
