# NEON LIFE 0.39.0 patch

Патч **Living People** устанавливается поверх `0.38.0`.

Главное изменение — физические NPC получили отдельную социальную систему: характер, ограниченные знания, разговоры рядом с игроком, память о поступках, слухи и автономные изменения отношений.

Изменения перечислены в `PATCH_0.39.0.md`. Архив содержит только новые и изменённые файлы.

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
