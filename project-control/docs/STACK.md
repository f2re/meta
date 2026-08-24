# F2RE Stack: один архив для всей системы

`F2RE Stack` объединяет Project Control и все управляемые приложения в один переносимый offline archive. Target выбирается явно: **Astra Linux 1.7** или **Astra Linux 1.8**, amd64.

## Самый простой сценарий

На обычной Linux-машине с интернетом:

```bash
git clone https://github.com/f2re/meta.git
cd meta
git pull --ff-only

./project-control/scripts/f2re-stack.sh prepare --astra 1.7
# или
./project-control/scripts/f2re-stack.sh prepare --astra 1.8
```

Это основной режим: `prepare` эквивалентен `--source build --refs latest`.

### Как выбираются версии приложений

До начала тяжёлой сборки скрипт читает `repository` и `defaultBranch` из `config/managed-projects.json`, затем для каждого проекта выполняет разрешение текущего HEAD ветки через `git ls-remote`. Полученные полные SHA фиксируются в отдельном снимке:

```text
project-control/dist/stack-inputs-1.7/managed-projects.resolved.json
```

Дальнейшая сборка использует **только этот снимок**. Если remote `main` изменится посреди длительной сборки, текущий stack всё равно останется внутренне согласованным и будет соответствовать SHA, разрешённым в начале запуска.

Ожидаемый старт вывода:

```text
==> Проекты: определяем актуальные HEAD defaultBranch
    docomator          main @ <40-char SHA>
    planer-solving     main @ <40-char SHA>
    kafedra-planner    main @ <40-char SHA>
==> Node.js 24.19.0: загрузка автономного runtime
...
==> docomator: локальная сборка <SHA>
    docomator: версия <VERSION>, commit <SHA>
```

То есть строка `версия ...` берётся из реально checkout-нутого проекта, а не из устаревшего списка в `meta`.

## Что означает `verifiedCommit`

`config/managed-projects.json` остаётся compatibility/release snapshot. Его `verifiedCommit` нужен для:

- воспроизводимости проверенного deployment set;
- release/CI artifact identity;
- диагностики и истории совместимости.

Он **не является указателем «последняя версия»** для обычного `prepare`. Для текущих версий используется `--refs latest`.

Если нужна именно сохранённая матрица:

```bash
./project-control/scripts/f2re-stack.sh prepare --astra 1.7 --refs pinned
```

В `pinned` режиме каждый проект клонируется на `verifiedCommit` из `config/managed-projects.json`.

## Что делает обычный prepare

1. фиксирует exact SHA текущего checkout `meta`;
2. разрешает текущие HEAD `defaultBranch` всех управляемых проектов;
3. сохраняет `managed-projects.resolved.json`;
4. автоматически загружает standalone Node.js 24.19.0 и проверяет официальный SHA-256;
5. собирает Project Control meta-bundle с **тем же resolved snapshot**;
6. собирает `docomator` из разрешённого SHA;
7. собирает `planer-solving` из разрешённого SHA;
8. собирает `kafedra-planner` из разрешённого SHA штатным runtime-offline builder;
9. проверяет wrapper `sourceCommit`, native format, payload SHA/size и identity;
10. формирует один `f2re-stack-*-astra-<1.7|1.8>-amd64.tar.gz`.

Resolved snapshot встраивается не только в stack metadata, но и в `managed-projects.json` внутри локально собранных meta/controller bundle. Поэтому Project Control после установки видит ту же матрицу SHA, из которой были собраны приложения.

**Docker в этом пути не используется и не требуется. `gh` также не нужен. Системный Node.js не нужен.**

## Что именно собирается локально

- `meta`: `project-control/scripts/build-meta-bundle.sh`;
- `docomator`: `scripts/project-control/build-bundle.sh`;
- `planer-solving`: `offline/build_project_control_bundle.sh`;
- `kafedra-planner`: `scripts/offline/build-bundle.sh` в runtime-offline профиле, затем Project Control wrapper.

Для `planer-solving` нужен Python 3.11+ с `venv`. Скрипт самостоятельно выбирает подходящий интерпретатор; при необходимости задайте:

```bash
F2RE_PYTHON_BIN=/usr/bin/python3.12 \
  ./project-control/scripts/f2re-stack.sh prepare --astra 1.7
```

Kafedra runtime-only содержит приложение и закреплённый автономный Node.js. Календарь, задачи, данные, миграции, API и worker работают из комплекта. OCR, Poppler и LibreOffice являются дополнительными возможностями целевой ОС. Полный `kafedra-full-airgap-v2` с `.deb`-слоем остаётся отдельным target-specific CI/download вариантом.

## Режимы источников

### Актуальный main + локальная сборка — по умолчанию

```bash
./project-control/scripts/f2re-stack.sh prepare --astra 1.7
# то же самое явно:
./project-control/scripts/f2re-stack.sh prepare --astra 1.7 --source build --refs latest
```

### Актуальный main: artifact-first, затем local fallback

```bash
cd project-control
gh auth login
./scripts/f2re-stack.sh prepare --astra 1.7 --source auto --refs latest
```

Для проектов сначала ищется artifact разрешённого SHA. Если его нет, этот компонент строится локально. Meta для dynamically resolved snapshot строится локально, чтобы его встроенная матрица совпала с приложениями.

### Воспроизводимый pinned set

```bash
./project-control/scripts/f2re-stack.sh prepare --astra 1.7 --refs pinned
```

### Только скачать сохранённые exact-SHA artifacts

```bash
cd project-control
gh auth login
./scripts/f2re-stack.sh prepare --astra 1.7 --source download --refs pinned
```

`--source download --refs latest` запрещён: готовый meta artifact уже содержит собственный compatibility snapshot и не может быть безопасно подменён dynamically resolved матрицей.

## Развёртывание

```bash
sha256sum -c f2re-stack-*.tar.gz.sha256
tar -xzf f2re-stack-*.tar.gz
cd f2re-stack-*
sudo ./deploy-stack.sh
```

Развёртывание:

1. проверяет общий `SHA256SUMS` и identity вложенных release;
2. устанавливает/обновляет Project Control;
3. ждёт `/api/ping`;
4. получает локальный access PIN;
5. загружает приложения чанками через Project Control API;
6. ждёт отдельные apply-job;
7. требует точную активную версию и зелёный health;
8. для первой установки Kafedra готовит непересекающийся co-location profile;
9. выводит итоговое состояние сервисов.

При ошибке выполнение останавливается. Rollback приложения остаётся ответственностью его native installer.

## Совместная установка на одном хосте

```text
planer-solving API       8001
docomator API            8080
docomator LLM            8081
kafedra-planner API      8090
kafedra-planner LLM      8091
project-control          9090
```

Если `/etc/kafedra-planner/kafedra-planner.env` уже существует, one-shot его не переписывает.

Порты новой Kafedra можно переопределить:

```bash
sudo F2RE_KAFEDRA_PORT=18090 F2RE_KAFEDRA_LLM_PORT=18091 ./deploy-stack.sh
```

## Требования к build-машине

Для обычного локального `prepare`:

- Linux x86-64;
- `git`, `python3`, `tar`, `gzip`, `sha256sum`;
- `curl`, `xz` для проверенной автозагрузки standalone Node.js;
- Python 3.11+ и `venv` для `planer-solving`;
- интернет к GitHub, PyPI/npm и nodejs.org на этапе online-сборки.

**Docker не требуется. GitHub CLI не требуется. Системный Node.js не требуется.**

Для `--source auto`/`download` дополнительно нужен `gh` и `gh auth login`.

## Почему Node.js 24.19.0

Stack использует 24.19.0 как общий build runtime: он удовлетворяет `docomator` (`node >=24.18.0`) и совпадает с offline runtime Kafedra.

Можно передать собственный runtime:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24.19.0-linux-x64 \
  ./project-control/scripts/f2re-stack.sh prepare --astra 1.7
```

## Диагностика версий

Чтобы увидеть версии **до завершения всей сборки**, достаточно первых строк `prepare`: сначала отображаются remote SHA, затем после каждого clone — `VERSION` и commit.

Сохранить временные checkout и build-каталоги:

```bash
./project-control/scripts/f2re-stack.sh prepare --astra 1.7 --keep-work
```

Проверить итоговый snapshot:

```bash
cat project-control/dist/stack-inputs-1.7/managed-projects.resolved.json
```

В итоговом `stack-release.json` также фиксируются версии, SHA и native format созданных packages.

## Состав stack

```text
f2re-stack-.../
├── SHA256SUMS
├── stack-release.json
├── verify.sh
├── deploy-stack.sh
├── apply-package.py
├── stack_tool.py
├── meta/
│   ├── f2re-meta-...tar.gz
│   └── f2re-meta-...tar.gz.sha256
└── projects/
    ├── docomator-...project-control.f2re.zip
    ├── docomator-...project-control.f2re.zip.sha256
    ├── planer-solving-...project-control.f2re.zip
    ├── planer-solving-...project-control.f2re.zip.sha256
    ├── kafedra-planner-...project-control.f2re.zip
    └── kafedra-planner-...project-control.f2re.zip.sha256
```

Один stack является frozen deployment set: «latest» определяется один раз в начале сборки, после чего все SHA фиксируются и не плавают до её окончания.

## Полезные варианты deploy

```bash
# Только проверить
sudo ./deploy-stack.sh --dry-run

# Project Control уже установлен — только приложения
sudo ./deploy-stack.sh --skip-meta

# Только один проект
sudo ./deploy-stack.sh --skip-meta --project docomator

# Project Control за nginx prefix
sudo ./deploy-stack.sh --url https://server.example/project-control/
```

## Почему deploy идёт через Project Control API

Stack не запускает native installers подпроектов напрямую. Он передаёт тот же `*.f2re.zip`, что UI, сохраняя:

- chunked upload и отдельную apply-job;
- статический adapter allowlist;
- проверку wrapper/payload и native format;
- Ed25519 policy;
- staging;
- штатный backup/migration/rollback;
- проверку версии, systemd и HTTP health;
- единую историю операций.
