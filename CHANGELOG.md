# Changelog

Все заметные изменения F2RE Meta / Project Control фиксируются в этом файле.

Формат основан на Keep a Changelog, версии проекта следуют Semantic Versioning (`MAJOR.MINOR.PATCH`).

## [0.5.7] - 2026-08-24

### Added

- `f2re-stack.sh` получил постоянный cache root: `$XDG_CACHE_HOME/f2re-stack` либо `~/.cache/f2re-stack`, с переопределением через `F2RE_STACK_CACHE_DIR`/`--cache-dir`.
- Между запусками сохраняются проверенный standalone Node.js, npm cache, pip cache и runtime cache Kafedra; `--no-cache` оставляет возможность полностью чистого одноразового build.
- Повторный запуск локально перепроверяет cached Node archive по официальному `SHASUMS256.txt`, а повреждённый cache entry удаляет вместо молчаливого использования.

### Changed

- Node.js больше не скачивается заново при каждом `prepare`: после первой проверенной загрузки используется version/architecture-specific cache entry.
- Docomator и Kafedra используют общий npm cache сборщика, `planer-solving` — постоянный pip download/wheel cache. Сам Python по-прежнему не загружается: выбирается уже установленный Python 3.11+.
- `KAFEDRA_RUNTIME_CACHE_DIR` перенесён из удаляемого временного `WORK_DIR` в постоянный cache root, поэтому штатный offline-builder может переиспользовать runtime между сборками.
- Project Control version: `0.5.6` → `0.5.7`.

## [0.5.6] - 2026-08-24

### Fixed

- Исправлена причина сборки устаревших приложений: обычный `f2re-stack.sh prepare` больше не воспринимает `verifiedCommit` из `config/managed-projects.json` как вечную версию проекта. Перед сборкой он разрешает текущий HEAD `defaultBranch` каждого управляемого репозитория и фиксирует полученные SHA в снимке конкретного stack build.
- Актуальный снимок `managed-projects.resolved.json` теперь используется одновременно для клонирования исходников, проверки wrapper `sourceCommit`, meta-bundle и встроенного Project Control controller bundle. Нельзя собрать приложения из новых SHA, оставив контроллер со старой матрицей.
- Статическая compatibility matrix обновлена до проверенных `main`: `docomator` `c0269c38...` (0.6.5), `planer-solving` `15e6b943...` (2.27.0), `kafedra-planner` `3fb241dd...` (VERSION пока остаётся 0.1.0-rc.9).

### Added

- `--refs latest|pinned`: `latest` является режимом по умолчанию для обычной one-shot сборки, `pinned` сохраняет строгую воспроизводимость зафиксированной compatibility matrix.
- Перед тяжёлой сборкой CLI выводит разрешённый commit каждого проекта; после checkout выводит фактические `VERSION` и commit, чтобы оператор сразу видел, что именно собирается.
- CI строит полный stack с `--refs latest` и проверяет, что `sourceCommit` каждого созданного `.f2re.zip` совпадает со снимком разрешённых main SHA.

### Changed

- Project Control version: `0.5.5` → `0.5.6`.

## [0.5.5] - 2026-08-24

### Fixed

- Executor теперь стартует в группе `project-control`: Unix socket сразу создаётся как `root:project-control` с доступом для группы, а затем закрепляется с правами `0660`, поэтому web-служба не получает `EACCES` в стартовом окне до позднего `chgrp`.
- Доступ к UI и API переведён на четырёхзначный PIN. При обновлении прежний длинный ключ автоматически заменяется новым PIN и записывается в `/root/project-control-access.txt`.

## [0.5.4] - 2026-08-24

### Changed

- `f2re-stack.sh prepare` теперь по умолчанию выполняет полноценную локальную сборку (`--source build`) `meta`, `docomator`, `planer-solving` и `kafedra-planner`, а не пытается сначала найти CI artifacts.
- Общий standalone Node.js runtime поднят до `24.19.0`: он удовлетворяет `docomator >=24.18.0` и совпадает с закреплённым offline runtime Kafedra.
- Локальная сборка Kafedra переведена с контейнера на штатный `scripts/offline/build-bundle.sh`; Docker больше не является зависимостью F2RE Stack.
- `--source auto` сохраняет прежний exact-SHA artifact-first режим, `--source download` — режим без локальной сборки.
- Project Control version: `0.5.3` → `0.5.4`.

### Added

- Для Kafedra явно разрешены два native format: опубликованный `kafedra-full-airgap-v2` и локально собираемый `kafedra-runtime-offline-v1`.
- `stack_tool.py` проверяет native format по явному allowlist, а неизвестный формат отклоняет.
- CI реально собирает полный F2RE Stack для Astra 1.7 локально без Docker и проверяет wrapper-пакеты всех трёх приложений.
- Регрессионные тесты фиксируют default local-build, отсутствие Docker-вызовов и поддержку runtime-only Kafedra package.

### Notes

- Runtime-only Kafedra содержит приложение и автономный Node.js; календарь, задачи, API, worker и миграции работают из комплекта. OCR/Poppler/LibreOffice остаются дополнительными возможностями целевой ОС. Full-airgap Kafedra с `.deb`-слоем остаётся отдельным target-specific CI/download вариантом.

## [0.5.3] - 2026-08-24

### Fixed

- `deploy-stack.sh --url` теперь последовательно учитывает nginx/path prefix не только при загрузке package, но и при `/api/ping`, проверке версии/health после каждого проекта и итоговом `/api/projects`.
- Добавлена ранняя валидация Project Control URL для stack deploy; query/fragment не принимаются как неоднозначная конфигурация.

### Added

- Регрессионный тест, запрещающий возврат к hardcoded `/api/ping` и `/api/projects` в prefix-aware stack deployment.

### Changed

- Project Control version: `0.5.2` → `0.5.3`.

## [0.5.2] - 2026-08-24

### Fixed

- Исправлен fallback build `f2re-stack.sh prepare`: вывод `sha256sum` больше не может попасть в значение пути автономного Node.js runtime и вызвать ложную ошибку `Для проверки compatibility manifest нужен Node.js`.
- Автозагруженный Node.js перед сборкой теперь проходит явную проверку пути и `bin/node`, а выбранный runtime выводится в диагностике.
- `dialog-polyfill.js` корректно отдаётся через nginx/path prefix, поэтому compatibility layer работает не только напрямую на `:9090`.
- CLI-развёртывание приложения переведено на тот же chunked upload + asynchronous job API, что и web UI; большие `.f2re.zip` больше не зависят от одного длинного HTTP request.
- `apply-package.py` учитывает path prefix в `--url`.

### Added

- Регрессионные тесты контракта Node runtime для F2RE Stack.
- Тест proxy-prefix маршрутизации `dialog-polyfill.js`.
- End-to-end Python-тест chunked upload клиента через URL prefix.

### Changed

- Project Control version: `0.5.1` → `0.5.2`.
- Документация F2RE Stack уточняет exact-SHA поведение, обновление локального checkout и зависимости fallback build.

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
- `release-manifest.json` и единый `SHA256SUMS` для машинной проверки всего релиза.
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

[0.5.7]: https://github.com/f2re/meta/releases/tag/v0.5.7
[0.5.6]: https://github.com/f2re/meta/releases/tag/v0.5.6
[0.5.5]: https://github.com/f2re/meta/releases/tag/v0.5.5
[0.5.4]: https://github.com/f2re/meta/releases/tag/v0.5.4
[0.5.3]: https://github.com/f2re/meta/releases/tag/v0.5.3
[0.5.2]: https://github.com/f2re/meta/releases/tag/v0.5.2
[0.5.1]: https://github.com/f2re/meta/releases/tag/v0.5.1
[0.5.0]: https://github.com/f2re/meta/releases/tag/v0.5.0
