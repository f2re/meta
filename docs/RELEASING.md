# Выпуск версий F2RE Meta

Проект использует Semantic Versioning: `MAJOR.MINOR.PATCH`.

- `MAJOR` — несовместимое изменение Project Control API, adapter contract или deployment format.
- `MINOR` — новая совместимая функция, новая поддерживаемая платформа, новый release asset.
- `PATCH` — совместимое исправление без изменения эксплуатационного контракта.

Единственный источник версии — `project-control/VERSION`. CI требует полного совпадения с:

- `project-control/package.json`;
- `project-control/config/project-control.env.example`.

## Поддерживаемые release targets

| Target | Architecture | CI image | Release status |
|---|---|---|---|
| Astra Linux Special Edition 1.7 | amd64 | `registry.astralinux.ru/library/astra/ubi17:1.7.5` | build + deployment smoke |
| Astra Linux Special Edition 1.8 | amd64 | `registry.astralinux.ru/library/astra/ubi18-python311:latest` | build + deployment smoke |

UBI smoke проверяет реальную установку bundled runtime, запуск Project Control, UI/API, executor IPC, discovery и chunk upload. Systemd в UBI не является PID 1, поэтому только orchestration `systemctl` заменяется CI shim; приложение, runtime, filesystem layout, users/groups, Unix socket и HTTP выполняются реально.

## Что публикуется

Каждый GitHub Release `vX.Y.Z` содержит:

- `project-control-X.Y.Z-linux-x64.tar.gz` + SHA-256;
- `install-project-control.sh`;
- `f2re-meta-X.Y.Z-astra-1.7-amd64.tar.gz` + SHA-256;
- `f2re-meta-X.Y.Z-astra-1.8-amd64.tar.gz` + SHA-256;
- versionless aliases `f2re-meta-astra-1.7-amd64.tar.gz` и `f2re-meta-astra-1.8-amd64.tar.gz` для `releases/latest/download/...`;
- versionless `project-control-linux-x64.tar.gz`;
- `f2re-meta-X.Y.Z-all-astra-amd64.zip` — единый набор обеих Astra-сборок и portable controller;
- `release-manifest.json` — версия, source commit, targets, размер и SHA-256 assets;
- `SHA256SUMS`.

GitHub автоматически добавляет Source code (`zip`/`tar.gz`).

## Порядок выпуска

1. Обновить код и тесты.
2. Выбрать SemVer и изменить одновременно:
   - `project-control/VERSION`;
   - `project-control/package.json`;
   - `project-control/config/project-control.env.example`.
3. Добавить секцию `[X.Y.Z]` в `CHANGELOG.md`.
4. Открыть PR и дождаться `Project Control CI`:
   - contract/tests;
   - Astra 1.7 build + deployment smoke;
   - Astra 1.8 build + deployment smoke.
5. Слить PR в `main`.
6. Если `VERSION` новый, workflow `Release` автоматически собирает assets и создаёт `vX.Y.Z`.
7. Проверить GitHub Release и `SHA256SUMS`.

Ручной запуск `Release` через `workflow_dispatch` разрешён для повторной проверки. Если release уже существует, workflow не перезаписывает его assets.

## Политика неизменяемости

Опубликованный `vX.Y.Z` не должен изменяться. Для любого исправления создаётся новая версия. Workflow намеренно завершает публикацию без перезаписи, если release с таким тегом уже существует.

Если тег `vX.Y.Z` существует, но указывает не на текущий release commit, публикация завершается ошибкой.

## Локальная проверка target bundle

Astra 1.7:

```bash
cd project-control
TARGET_ASTRA_VERSION=1.7 NODE_RUNTIME_DIR=/path/to/node-runtime ./scripts/build-meta-bundle.sh
```

Astra 1.8:

```bash
TARGET_ASTRA_VERSION=1.8 NODE_RUNTIME_DIR=/path/to/node-runtime ./scripts/build-meta-bundle.sh
```

F2RE Stack:

```bash
./scripts/f2re-stack.sh prepare --astra 1.7
./scripts/f2re-stack.sh prepare --astra 1.8
```

`stack_tool.py` проверяет, что target metadata meta-bundle совпадает с запрошенной версией Astra. Переименование чужого bundle не считается сборкой и отклоняется.
