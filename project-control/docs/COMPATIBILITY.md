# Матрица совместимости F2RE Project Control

Источник истины для исполняемого runtime-контракта — `src/adapters.mjs`; машинно-читаемая compatibility matrix — `config/managed-projects.json`. Скрипт `scripts/verify-compatibility.mjs` делает расхождение adapter/service/path/health-контракта ошибкой CI.

## Поддерживаемые приложения

| projectId | Репозиторий | Adapter | Native format | Required services | Health |
|---|---|---|---|---|---|
| `docomator` | `f2re/docomator` | `docomator-v1` | `docomator-offline-v2` | `docomator-api`, `docomator-worker` | `/readyz` |
| `planer-solving` | `f2re/planer-solving` | `planer-solving-v1` | `planner-solving-offline-v3` | `planner-solving` | `/api/health` |
| `kafedra-planner` | `f2re/kafedra-planner` | `kafedra-planner-v1` | `kafedra-full-airgap-v2` или `kafedra-runtime-offline-v1` | `kafedra-planner-api`, `kafedra-planner-worker` | `/api/system/health` |

## `verifiedCommit` и «последняя версия» — не одно и то же

`verifiedCommit` в `config/managed-projects.json` — полный SHA сохранённого compatibility/release snapshot. Он нужен для воспроизводимого `--refs pinned`, exact-SHA artifacts и аудита, но не должен превращаться в вечный указатель на «актуальную версию».

Обычный:

```bash
./project-control/scripts/f2re-stack.sh prepare --astra 1.7
```

работает в `--refs latest`: перед сборкой разрешает текущий HEAD `defaultBranch` каждого репозитория через Git, записывает эти SHA в `managed-projects.resolved.json` и строит приложения из этого frozen snapshot.

В результате существует два явных режима:

- `latest` — взять текущие HEAD управляемых `main`, затем заморозить их на время конкретной сборки;
- `pinned` — воспроизвести сохранённые `verifiedCommit` из compatibility matrix.

Resolved snapshot проходит ту же структурную проверку против `src/adapters.mjs`, что и статический manifest, и встраивается в локально построенные meta/controller bundle. Это исключает ситуацию, когда приложения уже собраны из новых SHA, а установленный Project Control продолжает считать разрешёнными старые SHA.

## Что означает «совместим»

Совместимость считается подтверждённой, когда одновременно выполняются условия:

1. native offline bundle приложения создан штатным builder приложения и проходит его собственную проверку целостности;
2. Project Control wrapper имеет `schema=f2re-managed-service/v1`, `controllerApi=1`, правильные `projectId`, `adapter`, `version`, `sourceCommit` и один из явно разрешённых `nativeBundleFormat`;
3. SHA-256/size payload в manifest совпадают с native archive;
4. native archive содержит entrypoints, требуемые allowlisted adapter Project Control;
5. runtime adapter Project Control содержит те же paths/services/health contract, что и выбранный managed-project snapshot;
6. wrapper либо получен из exact-SHA CI artifact, либо воспроизводимо собран `f2re-stack.sh` из разрешённого commit штатным builder проекта;
7. wrapper `sourceCommit` обязан совпасть с SHA в snapshot конкретного stack;
8. неизвестный native format отклоняется до упаковки stack.

## Kafedra Planner: два профиля одного adapter

`kafedra-planner-v1` использует один и тот же `install.sh` и runtime/service contract для двух допустимых release identities:

- `kafedra-full-airgap-v2` — target-specific полный комплект с managed Python и OS package layer;
- `kafedra-runtime-offline-v1` — переносимый runtime-only комплект приложения + автономный Node.js, который `f2re-stack.sh prepare` собирает на обычной Linux build-машине без Docker.

Runtime-only профиль не ослабляет identity проверки: wrapper фиксирует exact `sourceCommit`, payload SHA-256/size и adapter. Календарь, задачи, API, worker, миграции и хранение данных не требуют OCR/Office toolchain. `unzip`, Poppler, Tesseract и LibreOffice являются дополнительными возможностями целевой ОС и при отсутствии переводят соответствующие документные функции в degraded-состояние, а не блокируют ядро.

## Docomator initial install

Штатный Project Control release `docomator-offline-v2` является `generic`-профилем: preview и LLM отключены, а target-specific `.deb` layer в архив не входит. Поэтому initial-install команда `docomator-v1` — `install.sh --bundle-root .` **без** `--install-os-packages`.

Предыдущая принудительная передача `--install-os-packages` противоречила фактически публикуемому generic bundle: native installer корректно отклонял пустой `payload/os-packages` с ошибкой «В комплекте нет пакетов .deb». Target-specific установки с дополнительным OS package layer должны выпускаться отдельным явно проверенным release profile.

## Изменение контракта

Если меняются обязательные entrypoints, `currentPath`, `versionFile`, systemd service names или поддерживаемый способ применения native release, требуется новый adapter ID (`*-v2`, …) и обновление Project Control. Если executable contract остаётся тем же, один adapter может явно разрешить несколько native release formats через `nativeBundleFormats`; список является allowlist и проверяется CI/stack tooling.
