# NEON LIFE 0.33.0 patch installer

Патч закреплён на конкретном GitHub-коммите и скачивает только изменённые и новые файлы.

Требования:

- установленная версия 0.32.1;
- PowerShell;
- доступ к `raw.githubusercontent.com` во время установки.

Запуск:

```powershell
powershell -ExecutionPolicy Bypass -File .\APPLY_PATCH.ps1 -ProjectRoot C:\NeonLife
```
