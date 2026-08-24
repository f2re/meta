# F2RE Stack: один архив для всей системы

`F2RE Stack` объединяет Project Control и все управляемые приложения в один переносимый offline archive. Target выбирается явно: **Astra Linux 1.7** или **Astra Linux 1.8**, amd64.

## Самый простой сценарий

На Linux-машине с интернетом и авторизованным GitHub CLI:

```bash
git clone https://github.com/f2re/meta.git
cd meta
git pull --ff-only
git rev-parse HEAD
cd project-control
gh auth login

./scripts/f2re-stack.sh prepare --astra 1.7
# или
./scripts/f2re-stack.sh prepare --astra 1.8
```

`prepare` работает в режиме `auto`:

1. фиксирует exact SHA текущего локального checkout `meta`;
2. читает `config/managed-projects.json`;
3. ищет Project Control meta artifact **именно выбранной Astra** и artifacts закреплённых commit SHA подпроектов;
4. проверяет source commit, adapter, native bundle format, wrapper SHA-256 и SHA/size payload;
5. если конкретного CI artifact нет, пересобирает только этот компонент;
6. проверяет, что `meta-release.json.target.version` совпадает с `--astra`;
7. формирует один переносимый архив.

Скрипт не переключает локальный checkout на более новый `main` автоматически. Поэтому SHA в строке
`meta: поиск ... для <SHA>` является источником истины для конкретной сборки. Если нужен актуальный `main`, перед запуском выполните `git pull --ff-only`.

Результат:

```text
dist/f2re-stack-<version>-astra-1.7-amd64.tar.gz
# или
dist/f2re-stack-<version>-astra-1.8-amd64.tar.gz
```

Простое переименование bundle 1.8 в 1.7 не работает: `stack_tool.py` проверяет target metadata и отклоняет несовпадение.

## Развёртывание

```bash
sha256sum -c f2re-stack-*.tar.gz.sha256
tar -xzf f2re-stack-*.tar.gz
cd f2re-stack-*
sudo ./deploy-stack.sh
```

Это последовательно:

1. проверяет общий `SHA256SUMS` и identity вложенных release;
2. устанавливает/обновляет Project Control;
3. ждёт `/api/ping`;
4. получает локальный access token из `/etc/project-control/project-control.env`;
5. загружает `docomator` чанками через штатный Project Control API и ждёт отдельную apply-job;
6. требует точную активную версию и зелёный health;
7. аналогично обновляет `planer-solving`;
8. для первой установки `kafedra-planner` готовит непересекающийся co-location profile;
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

## Режимы получения артефактов

Только скачать проверенные CI artifacts:

```bash
./scripts/f2re-stack.sh download --astra 1.7
./scripts/f2re-stack.sh pack --astra 1.7
```

Или одной командой без fallback build:

```bash
./scripts/f2re-stack.sh prepare --astra 1.7 --source download
```

Если exact-SHA artifact отсутствует, `download` завершается ошибкой и не подменяет его более новым release.

Принудительная пересборка:

```bash
./scripts/f2re-stack.sh prepare --astra 1.8 --source build
```

Поддерживаемые варианты:

```bash
./scripts/f2re-stack.sh prepare --astra 1.7 --source auto
./scripts/f2re-stack.sh prepare --astra 1.8 --source auto
./scripts/f2re-stack.sh prepare --astra 1.7 --source download
./scripts/f2re-stack.sh prepare --astra 1.8 --source download
./scripts/f2re-stack.sh prepare --astra 1.7 --source build
./scripts/f2re-stack.sh prepare --astra 1.8 --source build
```

## Builders

- `meta`: `scripts/build-meta-bundle.sh` с `TARGET_ASTRA_VERSION`;
- `docomator`: `scripts/project-control/build-bundle.sh`;
- `planer-solving`: `offline/build_project_control_bundle.sh`;
- `kafedra-planner`: native full air-gap archive через его штатный builder, wrapper — через `project-control-package.py` с pinned SHA.

Для `meta`/`docomator` автоматически загружается официальный standalone Node.js и проверяется по `SHASUMS256.txt`, если `NODE_RUNTIME_DIR` не задан. Путь runtime передаётся builder-ам через отдельное состояние скрипта, поэтому диагностический вывод `sha256sum` не может быть ошибочно принят за путь Node.js. Системный `node` на build-host не требуется.

Для полной локальной сборки `kafedra-planner` нужен Docker.

## Требования к online build/download машине

Для обычного `prepare`:

- Linux x86-64;
- `git`, `python3`, `tar`, `gzip`, `sha256sum`;
- `gh` с `gh auth login` для загрузки CI artifacts.

Если exact artifact отсутствует и включён `auto`, fallback build может дополнительно потребовать:

- `curl` и `xz` — автозагрузка standalone Node.js;
- `python3-venv` — локальная сборка `planer-solving`;
- Docker — локальная full offline сборка `kafedra-planner`.

Если эти зависимости ставить нельзя, используйте `--source download`: тогда отсутствие exact-SHA artifact будет явной ошибкой вместо попытки локальной сборки.

## Диагностика типовых проблем

Если вывод содержит старый SHA `meta`, обновите локальный репозиторий:

```bash
cd /path/to/meta
git status --short
git pull --ff-only
git rev-parse HEAD
```

Если на старой версии скрипта после успешной загрузки Node.js появлялась ошибка
`Для проверки compatibility manifest нужен Node.js`, обновите `meta`: в Project Control 0.5.2 исправлено смешивание диагностического stdout `sha256sum` с путём runtime.

Для сохранения временного каталога и детального разбора fallback build:

```bash
./scripts/f2re-stack.sh prepare --astra 1.7 --keep-work
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

`stack-release.json` фиксирует target Astra, версии и SHA компонентов. Один архив является воспроизводимым deployment set, а не набором случайных «последних» файлов.

## Полезные варианты deploy

```bash
# Только проверить
sudo ./deploy-stack.sh --dry-run

# Project Control уже установлен — только приложения
sudo ./deploy-stack.sh --skip-meta

# Только один проект
sudo ./deploy-stack.sh --skip-meta --project docomator

# Другой локальный URL контроллера
sudo ./deploy-stack.sh --url http://127.0.0.1:19090
```

## Почему deploy идёт через Project Control API

Stack не запускает native installers подпроектов напрямую. Он передаёт тот же `*.f2re.zip`, что UI, сохраняя:

- chunked upload и отдельную apply-job;
- статический adapter allowlist;
- проверку wrapper/payload;
- Ed25519 policy;
- staging;
- native verify entrypoint;
- штатный backup/migration/rollback;
- проверку версии, systemd и HTTP health;
- единую историю операций.
