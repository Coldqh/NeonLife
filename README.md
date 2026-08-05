# NEON LIFE 0.49.0 patch

Патч **Runtime Recovery** устанавливается поверх `0.48.0`.

Он убирает квадратичные проходы в каноническом инвентаре, ускоряет создание мира и полный городской тик, переводит сохранения на gzip-снимки в IndexedDB и прекращает повторную миграцию уже актуальных слотов.

Изменения перечислены в `PATCH_0.49.0.md`.

## Установка

```powershell
powershell -ExecutionPolicy Bypass -File .\APPLY_PATCH.ps1 -ProjectRoot C:\NeonLife -RunChecks
```

Либо применить git-патч:

```powershell
cd C:\NeonLife
git apply "$env:USERPROFILE\Downloads\NeonLife-0.49.0.patch"
npm install
npm test
npm run build
```
