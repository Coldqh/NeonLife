# NEON LIFE 0.39.3 patch

Патч **Functional Venues** устанавливается поверх `0.39.2`.

Заведения получили реальные ассортимент, цены, запасы, персонал, очереди, выручку, расходы и физический цикл обслуживания внутри конкретного помещения. На карте появился поиск по названию, категории и статусу работы.

Изменения перечислены в `PATCH_0.39.3.md`. Архив содержит только новые и изменённые файлы.

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
