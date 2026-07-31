import { Icon, type IconName } from "../../ui/components/Icons";
import type { GameScreen } from "../shared/types";

const items: Array<{ id: GameScreen; label: string; icon: IconName }> = [
  { id: "map", label: "Карта", icon: "city" },
  { id: "nearby", label: "Рядом", icon: "network" },
  { id: "life", label: "Жизнь", icon: "life" },
  { id: "work", label: "Работа", icon: "work" },
  { id: "profile", label: "Ещё", icon: "people" }
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
