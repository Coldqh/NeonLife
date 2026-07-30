# NEON LIFE 0.42.0 patch

Патч **World Core Consolidation** устанавливается поверх `0.41.0`.

Это логический патч без новых экранов. Он вводит каноническое ядро мира для бизнеса, денег, занятости и времени, а старые системы переводит в режим совместимых проекций.

Изменения перечислены в `PATCH_0.42.0.md`. Архив содержит только новые и изменённые файлы.

## Установка

Распакуй архив поверх корня проекта либо запусти:

```powershell
powershell -ExecutionPolicy Bypass -File .\APPLY_PATCH.ps1 -ProjectRoot C:\NeonLife -RunChecks
```

```powershell
cd C:\NeonLife
npm install
npm run typecheck
npm run test:world-core
npm run test:integrity
npm run build
npm run dev
```
