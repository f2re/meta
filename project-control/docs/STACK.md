# F2RE Stack: один архив для всей системы

`F2RE Stack` объединяет Project Control и все управляемые приложения в один переносимый offline archive. Target выбирается явно: **Astra Linux 1.7** или **Astra Linux 1.8**, amd64.

## Самый простой сценарий

На обычной Linux-машине с интернетом:

```bash
git clone https://github.com/f2re/meta.git
cd meta
git pull --ff-only
git rev-parse HEAD

./project-control/scripts/f2re-stack.sh prepare --astra 1.7
# или
./project-control/scripts/f2re-stack.sh prepare --astra 1.8
```

Это основной режим. `prepare` по умолчанию **сам локально собирает весь комплект из исходников**:

1. фиксирует exact SHA текущего checkout `meta`;
2. читает exact SHA `docomator`, `planer-solving`, `kafedra-planner` из `config/managed-projects.json`;
3. клонирует каждый проект ровно на закреплённый commit;
4. автоматически загружает standalone Node.js 24.19.0 и проверяет его по официальному `SHASUMS256.txt`;
5. локально собирает Project Control meta-bundle;
6. локально собирает `docomator`;
7. локально собирает `planer-solving`;
8. локально собирает `kafedra-planner` штатным runtime-offline builder;
9. проверяет identity, source commit, adapter, native format и SHA каждого wrapper/payload;
10. формирует один `f2re-stack-*-astra-<1.7|1.8>-amd64.tar.gz`.

**Docker в этом пути не используется и не требуется.** `gh` также не нужен для обычного локального `prepare`.

Скрипт не переключает локальный checkout `meta` на более новый `main` автоматически. Если нужен актуальный `main`, перед сборкой выполните `git pull --ff-only`.

Результат:

```text
project-control/dist/f2re-stack-<version>-astra-1.7-amd64.tar.gz
# или
project-control/dist/f2re-stack-<version>-astra-1.8-amd64.tar.gz
```

Простое переименование bundle 1.8 в 1.7 не работает: `stack_tool.py` проверяет target metadata и отклоняет несовпадение.

## Что именно собирается локально

- `meta`: `project-control/scripts/build-meta-bundle.sh`;
- `docomator`: его штатный `scripts/project-control/build-bundle.sh`;
- `planer-solving`: его штатный `offline/build_project_control_bundle.sh`;
- `kafedra-planner`: его штатный `scripts/offline/build-bundle.sh` в runtime-offline профиле, затем wrapper `*.f2re.zip`.

Для Kafedra локальный runtime-offline пакет содержит приложение и закреплённый автономный Node.js. Календарь, задачи, данные, миграции, API и worker не зависят от Docker. OCR, Poppler и LibreOffice являются дополнительными возможностями: runtime-only установка использует их, если они уже есть на целевой ОС, и сообщает degraded-состояние, если их нет.

Полный Kafedra `full-airgap` package с замкнутым набором `.deb` остаётся отдельным target-specific вариантом. Его можно взять как проверенный exact-SHA CI artifact через `--source auto`/`download` либо собрать штатным full builder Kafedra непосредственно на подходящей Debian/Astra-системе. Это не является требованием обычной сборки F2RE Stack.

## Развёртывание

```bash
sha256sum -c f2re-stack-*.tar.gz.sha256
tar -xzf f2re-stack-*.tar.gz
cd f2re-stack-*
sudo ./deploy-stack.sh
```

Развёртывание последовательно:

1. проверяет общий `SHA256SUMS` и identity вложенных release;
2. устанавливает/обновляет Project Control;
3. ждёт `/api/ping`;
4. получает локальный access token;
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

## Режимы источников

### Локальная сборка — по умолчанию

Эквивалентные команды:

```bash
./project-control/scripts/f2re-stack.sh prepare --astra 1.7
./project-control/scripts/f2re-stack.sh prepare --astra 1.7 --source build
```

### Сначала CI artifacts, затем локальный fallback

```bash
cd project-control
gh auth login
./scripts/f2re-stack.sh prepare --astra 1.7 --source auto
```

`auto` принимает только artifact того же exact SHA. Если его нет, конкретный компонент собирается локально.

### Только скачать, ничего не собирать

```bash
cd project-control
gh auth login
./scripts/f2re-stack.sh prepare --astra 1.7 --source download
```

Если exact-SHA artifact отсутствует, команда завершается ошибкой и не подменяет его более новым release.

## Требования к build-машине

Для обычного локального `prepare`:

- Linux x86-64;
- `git`, `python3`, `tar`, `gzip`, `sha256sum`;
- `curl`, `xz` для проверенной автозагрузки standalone Node.js;
- `python3-venv` для сборки `planer-solving`;
- доступ в интернет к GitHub, PyPI/npm и nodejs.org на этапе online-сборки.

**Docker не требуется. GitHub CLI не требуется. Системный Node.js не требуется.**

Для `--source auto`/`download` дополнительно нужен `gh` и выполненный `gh auth login`.

## Почему Node.js 24.19.0

Stack использует 24.19.0 как общий build runtime: он удовлетворяет `docomator` (`node >=24.18.0`) и одновременно совпадает с закреплённым offline runtime Kafedra. Поэтому нормальная сборка не должна выдавать `EBADENGINE` для pinned `docomator`.

Можно явно передать собственный standalone runtime:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24.19.0-linux-x64 \
  ./project-control/scripts/f2re-stack.sh prepare --astra 1.7
```

## Диагностика

Проверить, из какого commit собирается `meta`:

```bash
git status --short
git pull --ff-only
git rev-parse HEAD
```

Сохранить временные checkout и build-каталоги:

```bash
./project-control/scripts/f2re-stack.sh prepare --astra 1.7 --keep-work
```

В корректном локальном запуске должны последовательно появиться строки примерно такого вида:

```text
==> meta: локальная сборка Astra 1.7 meta-bundle
==> docomator: локальная сборка ...
==> planer-solving: локальная сборка ...
==> kafedra-planner: локальная runtime-offline сборка ... (без Docker)
Все входные bundle проверены: ...
Готов единый переносимый F2RE Stack ...
```

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

`stack-release.json` фиксирует target Astra, версии, native format и SHA компонентов. Один архив является воспроизводимым deployment set, а не набором случайных «последних» файлов.

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
