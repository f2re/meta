# Changelog

Все заметные изменения F2RE Meta / Project Control фиксируются в этом файле.

Формат основан на Keep a Changelog, версии проекта следуют Semantic Versioning (`MAJOR.MINOR.PATCH`).

## [0.5.1] - 2026-08-24

### Fixed

- Исправлен фатальный сбой интерфейса `keyDialog.showModal is not a function`: перед `app.js` загружается локальный compatibility layer для браузеров/окружений без полного `HTMLDialogElement` API.
- Fallback поддерживает открытие и закрытие окна ключа, Escape и блокировку фоновой прокрутки, не вмешиваясь в нативный `<dialog>` там, где он поддерживается.
- Убран лишний `404` при загрузке страницы за счёт встроенной favicon, чтобы консоль не маскировала реальные ошибки API/UI.

### Added

- Контрактные Node.js-тесты для native/fallback dialog flow и порядка загрузки frontend-скриптов.

### Changed

- Project Control version: `0.5.0` → `0.5.1`.

## [0.5.0] - 2026-08-24

### Added

- Полноценный GitHub Release pipeline с тегами `vX.Y.Z`.
- Проверяемые release assets для Astra Linux Special Edition 1.7 и 1.8, amd64.
- Матрица CI с deployment smoke в официальных Astra Linux UBI обеих веток.
- Стабильные latest-download aliases для Astra 1.7/1.8 и portable controller.
- `release-manifest.json` и единый `SHA256SUMS` для машинной проверки релиза.
- Параметр `--astra 1.7|1.8` для F2RE Stack и строгая проверка target metadata.
- Документированный release process, policy совместимости и публичная таблица загрузок.

### Changed

- Project Control version: `0.4.0` → `0.5.0`.
- `build-meta-bundle.sh` теперь поддерживает Astra Linux 1.7.x и 1.8.x.
- GitHub Actions artifacts разделены по целевой версии Astra Linux.
- README переработан как продуктовая страница проекта: badges, downloads, архитектура, release flow и support matrix.

### Security

- Release workflow не перезаписывает уже опубликованный SemVer release.
- Версия одновременно проверяется в `VERSION`, `package.json` и `project-control.env.example`.
- Каждый бинарный asset получает SHA-256; состав релиза фиксируется в machine-readable manifest.

## 0.4.0 - 2026-08-24

### Added

- Runtime discovery `/opt`, systemd, LISTEN-портов и nginx-конфигурации.
- Prefix-relative web UI для работы за nginx location prefix.
- Chunked upload и asynchronous update jobs для больших `.f2re.zip`.
- Диагностика executor/UI вместо пустого интерфейса.

### Fixed

- Загрузка frontend assets/API за reverse proxy.
- Обновления, обрывавшиеся из-за `client_max_body_size` и `proxy_read_timeout`.

## 0.3.0 - 2026-08-24

### Added

- F2RE Stack: единый one-shot download/build/pack/deploy контур.
- Exact-SHA compatibility manifest для `docomator`, `planer-solving`, `kafedra-planner`.
- Astra Linux meta-bundle и deployment smoke.

[0.5.1]: https://github.com/f2re/meta/releases/tag/v0.5.1
[0.5.0]: https://github.com/f2re/meta/releases/tag/v0.5.0
