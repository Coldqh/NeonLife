# NEON LIFE 0.39.4 patch

Патч **Venue Integrity** устанавливается поверх `0.39.3`.

Он закрепляет заведения как постоянные сущности города, синхронизирует банкротство, проводит операционные деньги через ledger, заменяет автоматический ресток поставками, исправляет длительные временные интервалы и делает маркер игрока зелёным.

Изменения перечислены в `PATCH_0.39.4.md`. Архив содержит только новые и изменённые файлы.

## Установка

Распакуй архив поверх корня проекта либо запусти:

```powershell
powershell -ExecutionPolicy Bypass -File .\APPLY_PATCH.ps1 -ProjectRoot C:\NeonLife -RunChecks
```

`-RunChecks` выполняет только установку зависимостей, TypeScript и production build. Полный `npm test` намеренно не запускается.

```powershell
cd C:\NeonLife
npm install
npm run typecheck
npm run build
npm run dev
```
