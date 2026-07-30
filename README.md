# NEON LIFE 0.40.0 patch

Патч **Living Work** устанавливается поверх `0.39.4`.

Он добавляет реальную трудовую систему: вакансии конкретных заведений, физические собеседования, контракты, расписание, рабочие задачи, рост навыков, предупреждения и зарплату из кассы работодателя.

Изменения перечислены в `PATCH_0.40.0.md`. Архив содержит только новые и изменённые файлы.

## Установка

Распакуй архив поверх корня проекта либо запусти:

```powershell
powershell -ExecutionPolicy Bypass -File .\APPLY_PATCH.ps1 -ProjectRoot C:\NeonLife -RunChecks
```

```powershell
cd C:\NeonLife
npm install
npm run typecheck
npm run test:work-ui
npm run test:work
npm run build
npm run dev
```
