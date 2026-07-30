# NEON LIFE 0.43.0 patch

Патч **Product & Inventory Foundation** устанавливается поверх `0.42.0`.

Это headless-патч логики мира. Он вводит единый каталог физических товаров, партии, склады, сроки годности и строгий перенос товара между владельцами. Новых экранов, карт и игровых кнопок нет.

Изменения перечислены в `PATCH_0.43.0.md`. Архив содержит только новые и изменённые файлы.

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
npm run test:inventory
npm run test:integrity
npm run build
npm run dev
```
