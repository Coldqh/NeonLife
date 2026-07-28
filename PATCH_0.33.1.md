# NEON LIFE v0.33.1 — World Integrity Recovery

## Исправлено

- игрок больше не застревает внутри здания или машины: выходы подключены к интерфейсу Nearby;
- свободная ходьба не сохраняет старую именованную локацию и не позволяет покупать, спать, сдавать груз или выполнять просьбы из другой точки;
- голод и усталость больше не зависят от размера шага времени;
- карта рассчитывает открытие объектов по текущему игровому часу;
- после оплаты аренды создаётся новый недельный счёт;
- старое отдельное предупреждение аренды удаляется из очереди событий;
- личные займы списываются с канонических средств резидента/домохозяйства и возвращаются туда же;
- денежные проводки игрока могут указывать реального контрагента вместо абстрактного clearing.

## Проверки

- TypeScript typecheck;
- production build оставлен обязательным шагом CI после чистого `npm ci`;
- UI architecture/recovery suite;
- local movement verification;
- executable world integrity test: building/vehicle exit, time-step invariance, exact street position, recurring rent, loan conservation.

Локально в Linux production build не запускался до конца, потому что исходный архив содержал Windows-only optional binaries Rollup/esbuild. TypeScript и все поведенческие проверки прошли; GitHub Actions теперь ставит зависимости с нуля и запускает `npm test` перед build.
