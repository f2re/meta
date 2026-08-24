# F2RE Project Control

Project Control — локальный сервис единого мониторинга, диагностики, перезапуска и офлайн-обновления приложений F2RE на Astra Linux/Debian. Стабильные targets: **Astra Linux Special Edition 1.7 и 1.8, amd64**.

Поддерживаются три явно allowlisted проекта: `docomator`, `planer-solving`, `kafedra-planner`. Repository, adapter ID, допустимые native formats, штатные пути, службы и health endpoints зафиксированы в `config/managed-projects.json` и проверяются CI. Поле `verifiedCommit` остаётся воспроизводимым compatibility snapshot; обычная one-shot сборка больше не считает этот SHA «последней версией» проекта.

## Скачать

Стабильные сборки публикуются в GitHub Releases:

- Astra 1.7: `f2re-meta-astra-1.7-amd64.tar.gz`;
- Astra 1.8: `f2re-meta-astra-1.8-amd64.tar.gz`;
- portable controller: `project-control-linux-x64.tar.gz`;
- `SHA256SUMS` и `release-manifest.json` для проверки всего релиза.

Latest release: <https://github.com/f2re/meta/releases/latest>

## Что показывает интерфейс 0.5.6

UI выполняет фактический runtime discovery:

- сканирует `/opt`, `current` и варианты `VERSION`;
- читает состояние systemd и реальные unit paths/ExecStart;
- сканирует TCP LISTEN через `ss`;
- читает `/etc/nginx` и извлекает `server_name`, `location`, `proxy_pass`, `client_max_body_size`;
- сопоставляет признаки с allowlisted проектами;
- делает независимый HTTP health-check на фактически настроенном порту;
- показывает путь, версию, порт, nginx route, службы, источники определения и предупреждения.

Кнопка **«Пересканировать сервер»** принудительно сбрасывает discovery cache. Если privileged executor неисправен, discovery и UI остаются доступны, а update/restart блокируются до восстановления executor.

Frontend работает напрямую на `:9090` и за nginx path prefix. Browser update использует блоки по 512 КиБ и отдельную apply-job; тот же chunked/job-контур используется `deploy-stack.sh`.

## Установка стабильного meta-bundle

Astra Linux 1.7:

```bash
curl -fLO https://github.com/f2re/meta/releases/latest/download/f2re-meta-astra-1.7-amd64.tar.gz
curl -fLO https://github.com/f2re/meta/releases/latest/download/f2re-meta-astra-1.7-amd64.tar.gz.sha256
sha256sum -c f2re-meta-astra-1.7-amd64.tar.gz.sha256
tar -xzf f2re-meta-astra-1.7-amd64.tar.gz
cd f2re-meta-*-astra-1.7-amd64
./verify.sh
sudo ./install.sh
```

Для Astra Linux 1.8 замените `1.7` на `1.8`.

После установки:

```bash
curl -fsS http://127.0.0.1:9090/api/ping
sudo cat /root/project-control-access.txt
```

## F2RE Stack — актуальные версии одной командой

Обычный сценарий полностью локальный и **перед каждой сборкой разрешает текущий HEAD `main` каждого управляемого проекта**:

```bash
git clone https://github.com/f2re/meta.git
cd meta
git pull --ff-only

./project-control/scripts/f2re-stack.sh prepare --astra 1.7
# или
./project-control/scripts/f2re-stack.sh prepare --astra 1.8
```

По умолчанию это `--source build --refs latest`. Сначала скрипт выполняет `git ls-remote` для `defaultBranch` каждого проекта, фиксирует полученные SHA в `stack-inputs-<astra>/managed-projects.resolved.json`, а уже затем строит весь комплект. Поэтому новая версия в `docomator/main`, `planer-solving/main` или `kafedra-planner/main` попадает в следующий обычный stack без ручного редактирования `verifiedCommit` в `meta`.

Перед тяжёлой сборкой выводятся разрешённые SHA. Сразу после checkout каждого проекта выводятся фактические `VERSION` и commit:

```text
==> Проекты: определяем актуальные HEAD defaultBranch
    docomator          main @ <resolved SHA>
    planer-solving     main @ <resolved SHA>
    kafedra-planner    main @ <resolved SHA>
...
==> docomator: локальная сборка <resolved SHA>
    docomator: версия <VERSION из main>, commit <resolved SHA>
```

Снимок разрешённых SHA используется единообразно: для clone, wrapper `sourceCommit`, проверки stack, `meta/managed-projects.json` и `config/managed-projects.json` внутри собираемого Project Control. Поэтому контроллер и приложения не могут незаметно разъехаться по версиям.

`prepare` последовательно собирает:

1. актуальный snapshot управляемых `main`;
2. Project Control meta-bundle с этим snapshot;
3. `docomator`;
4. `planer-solving`;
5. `kafedra-planner`;
6. единый переносимый F2RE Stack.

**Docker не используется и не требуется. `gh` не требуется. Системный Node.js не требуется.** Standalone Node.js 24.19.0 загружается автоматически и проверяется по официальному `SHASUMS256.txt`.

Для `planer-solving` нужен Python 3.11+ с модулем `venv`. Скрипт самостоятельно ищет `/usr/bin/python3`, `python3.13`, `python3.12`, `python3.11`, затем `python3`; нужный интерпретатор можно задать через `F2RE_PYTHON_BIN`.

Kafedra в локальном режиме собирается штатным `scripts/offline/build-bundle.sh` как runtime-offline package без Docker. Ядро приложения — календарь, задачи, данные, API, worker и миграции — работает из комплекта. OCR, Poppler и LibreOffice используются с целевой Astra, если установлены. Полный target-specific full-airgap пакет с `.deb`-слоем остаётся отдельным CI/download вариантом.

### Воспроизводимый pinned-режим

Если нужен не текущий `main`, а **ровно зафиксированная compatibility matrix**, используйте:

```bash
./project-control/scripts/f2re-stack.sh prepare --astra 1.7 --refs pinned
```

Тогда берутся `verifiedCommit` из `config/managed-projects.json`. Это режим для воспроизведения конкретного проверенного deployment set, а не способ получить последние версии.

### CI artifacts

Сначала искать artifact разрешённого SHA, а при его отсутствии строить локально:

```bash
cd project-control
gh auth login
./scripts/f2re-stack.sh prepare --astra 1.7 --source auto --refs latest
```

Строго скачать ранее зафиксированные artifacts без локальной сборки:

```bash
./scripts/f2re-stack.sh prepare --astra 1.7 --source download --refs pinned
```

`download + latest` намеренно запрещён: готовый meta artifact содержит собственный snapshot SHA, поэтому для динамического latest-набора meta должен быть собран вместе с разрешённой матрицей.

Полное описание: `docs/STACK.md`.

## Развёртывание F2RE Stack

```bash
sha256sum -c f2re-stack-*.tar.gz.sha256
tar -xzf f2re-stack-*.tar.gz
cd f2re-stack-*
sudo ./deploy-stack.sh
```

Если Project Control находится за reverse proxy prefix, тот же prefix используется для ping, chunk upload, job polling и итогового status:

```bash
sudo ./deploy-stack.sh --url https://server.example/project-control/
```

## Операторский сценарий через UI

1. Установить Project Control из meta-bundle либо F2RE Stack.
2. Открыть `http://<IP>:9090/` или nginx URL и ввести четырёхзначный PIN.
3. Нажать «Пересканировать сервер».
4. Перетащить готовый `*-project-control.f2re.zip` на карточку проекта.
5. UI передаст ZIP чанками, сервер проверит identity/SHA-256/adapter/подпись и запустит allowlisted installer отдельной job.
6. Операция считается успешной только после совпадения активной версии и systemd/HTTP health-check.

Уже существующие установки обнаруживаются по фактическим признакам даже до первого управляемого обновления. Project Control ведёт историю операций.

## Граница привилегий

`project-control.service` работает от непривилегированного пользователя `project-control`. Root-операции вынесены в `project-control-executor.service` и доступны только через локальный Unix socket. Загруженный bundle не может задавать произвольную shell-команду или systemd unit: executable contract находится в `src/adapters.mjs`.

PIN веб-доступа при первой установке сохраняется в `/root/project-control-access.txt`.

Для обязательной криптографической аутентификации release package установите `PROJECT_CONTROL_REQUIRE_SIGNATURE=true` и доверенные Ed25519 public keys в `/etc/project-control/trusted-keys/<keyId>.pem`.

## Отдельная локальная сборка контроллера

Portable controller:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 ./scripts/build-offline-bundle.sh
```

Astra 1.7 meta-bundle:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 \
TARGET_ASTRA_VERSION=1.7 \
  ./scripts/build-meta-bundle.sh
```

Для Astra 1.8 замените target на `1.8`.

## CI и релизы

`npm run check` выполняет syntax-check backend/frontend, discovery/nginx/proxy-prefix tests, dialog compatibility tests, Python-тесты chunked deployment client, stack pack/dry-run и compatibility checks.

Дополнительно CI реально запускает полный F2RE Stack с `--refs latest` без Docker, сверяет wrapper `sourceCommit` с разрешённым snapshot каждого проекта, затем независимо собирает и устанавливает meta release candidate в официальных Astra Linux 1.7 и 1.8 UBI.

Workflow `Release` публикует `vX.Y.Z` только после release checks и создаёт SHA-256 + machine-readable manifest.

Подробности: `docs/RUNTIME_DISCOVERY.md`, `docs/STACK.md`, `docs/ASTRA_LINUX.md`, `docs/COMPATIBILITY.md`, `docs/STANDARD.md`.
