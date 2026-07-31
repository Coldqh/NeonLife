# NEON LIFE 0.45.0 patch

Патч **Simulation Pipeline Recovery** устанавливается поверх `0.44.0`.

Он чинит полуночный каскад симуляции: Kernel больше не выполняет квадратичное копирование тысяч счетов, ежедневные продажи и зарплаты не создают отдельный счёт на каждый бизнес, а бизнес-касса и физический склад проводятся согласованно с ledger. Новых экранов и игровых кнопок нет.

Изменения перечислены в `PATCH_0.45.0.md`. Патч-архив содержит только новые и изменённые файлы.

## Установка

Распакуй патч поверх корня проекта либо запусти:

```powershell
powershell -ExecutionPolicy Bypass -File .\APPLY_PATCH.ps1 -ProjectRoot C:\NeonLife -RunChecks
```

```powershell
cd C:\NeonLife
npm install
npm run typecheck
npm run test:integrity
npm run test:business
npm run test:world-core
npm run test:inventory
npm run build
npm run dev
```
