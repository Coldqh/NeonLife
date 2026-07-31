# NEON LIFE 0.48.0 patch

Патч **Physical Inventory** устанавливается поверх `0.47.0`.

`ProductInventory` становится источником истины не только для бизнеса и заведений, но и для предметов игрока, домашних запасов, кладовых домохозяйств и производственных складов. Старые поля остаются совместимыми представлениями, но больше не могут создать товар обратно.

Изменения перечислены в `PATCH_0.48.0.md`. Патч-архив содержит только новые и изменённые файлы.

## Установка

```powershell
powershell -ExecutionPolicy Bypass -File .\APPLY_PATCH.ps1 -ProjectRoot C:\NeonLife -RunChecks
```

Либо применить git-патч:

```powershell
cd C:\NeonLife
git apply "$env:USERPROFILE\Downloads\NeonLife-0.48.0.patch"
npm install
npm test
npm run build
```
