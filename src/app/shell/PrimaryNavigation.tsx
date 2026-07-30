import { Icon } from "../../ui/components/Icons";
import type { GameScreen } from "../shared/types";

const items: Array<{ id: GameScreen; label: string; icon: "people" | "city" | "work" | "network" }> = [
  { id: "profile", label: "Профиль", icon: "people" },
  { id: "map", label: "Карта", icon: "city" },
  { id: "work", label: "Работа", icon: "work" },
  { id: "nearby", label: "Рядом", icon: "network" }
];

export function PrimaryNavigation({ screen, onChange }: { screen: GameScreen; onChange: (screen: GameScreen) => void }) {
  return (
    <nav className="primary-nav" aria-label="Главная навигация">
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={screen === item.id ? "is-active" : ""}
          aria-current={screen === item.id ? "page" : undefined}
          onClick={() => onChange(item.id)}
        >
          <i><Icon name={item.icon} size={22} /></i>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
