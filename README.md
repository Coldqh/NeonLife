# NEON LIFE 0.44.0 patch

Патч **Unified Business Economy** устанавливается поверх `0.43.0`.

Это headless-патч логики мира. Он создаёт единую городскую экономику компаний и заведений: постоянный реестр, помещения, аренду, лицензии, конкуренцию, продажи конкретных SKU, расходы, банкротства и поглощения. Новых экранов, карт и игровых кнопок нет.

Изменения перечислены в `PATCH_0.44.0.md`. Архив содержит только новые и изменённые файлы.

## Установка

Распакуй архив поверх корня проекта либо запусти:

```powershell
powershell -ExecutionPolicy Bypass -File .\APPLY_PATCH.ps1 -ProjectRoot C:\NeonLife -RunChecks
```

```powershell
cd C:\NeonLife
npm install
npm run typecheck
npm run test:business
npm run test:world-core
npm run test:inventory
npm run test:integrity
npm run build
npm run dev
```
