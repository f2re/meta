# Матрица совместимости F2RE Project Control

Источник истины для runtime — `src/adapters.mjs`; машинно-читаемая зафиксированная матрица — `config/managed-projects.json`. Скрипт `scripts/verify-compatibility.mjs` делает расхождение между ними ошибкой CI.

## Поддерживаемые приложения

| projectId | Репозиторий | Adapter | Native format | Required services | Health |
|---|---|---|---|---|---|
| `docomator` | `f2re/docomator` | `docomator-v1` | `docomator-offline-v2` | `docomator-api`, `docomator-worker` | `/readyz` |
| `planer-solving` | `f2re/planer-solving` | `planer-solving-v1` | `planner-solving-offline-v3` | `planner-solving` | `/api/health` |
| `kafedra-planner` | `f2re/kafedra-planner` | `kafedra-planner-v1` | `kafedra-full-airgap-v2` | `kafedra-planner-api`, `kafedra-planner-worker` | `/api/system/health` |

Точный `verifiedCommit` и точное имя GitHub Actions artifact для каждого проекта хранятся в `config/managed-projects.json`. Это полный 40-символьный SHA проверенного `main`, на котором подтверждён Project Control release contract.

## Что означает «совместим»

Совместимость считается подтверждённой, когда одновременно выполняются условия:

1. native offline bundle приложения проходит собственный CI и installation/self-test;
2. Project Control wrapper имеет `schema=f2re-managed-service/v1`, `controllerApi=1`, правильные `projectId`, `adapter`, `version`, `sourceCommit` и `nativeBundleFormat`;
3. SHA-256/size payload в manifest совпадают с native archive;
4. native archive содержит обязательные verify/install/update entrypoints;
5. runtime adapter Project Control содержит те же paths/services/health contract, что и `managed-projects.json`;
6. готовый `*.f2re.zip` выпускается CI приложения, а не собирается оператором вручную.

## Docomator initial install

Штатный Project Control release `docomator-offline-v2` является `generic`-профилем: preview и LLM отключены, а target-specific `.deb` layer в архив не входит. Поэтому initial-install команда `docomator-v1` — `install.sh --bundle-root .` **без** `--install-os-packages`.

Предыдущая принудительная передача `--install-os-packages` противоречила фактически публикуемому generic bundle: native installer корректно отклонял пустой `payload/os-packages` с ошибкой «В комплекте нет пакетов .deb». Удаление этого невозможного флага является исправлением существующего `docomator-v1` release contract, а не новым форматом bundle. Target-specific установки с дополнительным OS package layer должны выпускаться отдельным явно проверенным release profile.

## Изменение контракта

Если меняются обязательные entrypoints, `currentPath`, `versionFile`, systemd service names или поддерживаемый способ применения native release, требуется новый adapter ID (`*-v2`, …) и обновление Project Control. Изменение внутреннего состава native archive без изменения исполняемого контракта может сохранить adapter ID, но `nativeBundleFormat` должен отражать новую release identity.
