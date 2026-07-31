# NEON LIFE 0.46.0 patch

Патч **Player Loop & Runtime Split** устанавливается поверх `0.45.0`.

Он отделяет короткие физические действия игрока от полного пересчёта города, добавляет экран **«Жизнь»**, объяснимые отказы команд, единое игровое время, выполнимые курьерские контракты и менее агрессивное автосохранение. Дополнительно исправлены миграции трудовых контрактов, непрерывность названий улиц, применение уличных дельт из кеша и выход из транспорта.

Изменения перечислены в `PATCH_0.46.0.md`. Патч-архив содержит только новые и изменённые файлы.

## Установка

```powershell
powershell -ExecutionPolicy Bypass -File .\APPLY_PATCH.ps1 -ProjectRoot C:\NeonLife -RunChecks
```

Либо применить git-патч:

```powershell
cd C:\NeonLife
git apply "$env:USERPROFILE\Downloads\NeonLife-0.46.0.patch"
npm install
npm test
npm run build
```
