# NEON LIFE 0.39.1 patch

Патч **Map Visual Recovery** устанавливается поверх `0.39.0`.

Он заменяет текущую клеточную глобальную карту и перегруженную локальную карту: добавляет цельные границы районов, нормальную иерархию дорог и зданий, уровни детализации и физическую фильтрацию людей, машин, переходов и происшествий.

Изменения перечислены в `PATCH_0.39.1.md`. Архив содержит только новые и изменённые файлы.

## Установка

Распакуй архив поверх корня проекта либо запусти:

```powershell
powershell -ExecutionPolicy Bypass -File .\APPLY_PATCH.ps1 -ProjectRoot C:\NeonLife -RunChecks
```

Ручная проверка:

```powershell
cd C:\NeonLife
npm install
npm test
npm run build
npm run dev
```
