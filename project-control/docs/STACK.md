# F2RE Stack: один архив для всей системы

`F2RE Stack` объединяет Project Control и все управляемые приложения в один переносимый offline archive для Astra Linux 1.8 amd64.

## Самый простой сценарий

На Linux-машине с интернетом и авторизованным GitHub CLI:

```bash
git clone https://github.com/f2re/meta.git
cd meta/project-control
gh auth login
./scripts/f2re-stack.sh prepare
```

`prepare` работает в режиме `auto`:

1. читает `config/managed-projects.json`;
2. для `meta`, `docomator`, `planer-solving` и `kafedra-planner` ищет GitHub Actions artifact **точно закреплённого commit SHA**;
3. проверяет source commit, adapter, native bundle format, wrapper SHA-256 и SHA/size native payload;
4. если конкретного CI artifact ещё нет, только этот компонент пересобирается локально штатным builder соответствующего проекта;
5. всё упаковывается в один архив.

Результат:

```text
dist/f2re-stack-0.3.0-astra-1.8-amd64.tar.gz
dist/f2re-stack-0.3.0-astra-1.8-amd64.tar.gz.sha256
```

Перенесите только эти два файла в закрытый контур.

На Astra Linux:

```bash
sha256sum -c f2re-stack-*.tar.gz.sha256
tar -xzf f2re-stack-*.tar.gz
cd f2re-stack-*
sudo ./deploy-stack.sh
```

Это последовательно:

1. проверит общий `SHA256SUMS` и identity всех вложенных release;
2. установит/обновит Project Control;
3. дождётся `/api/ping`;
4. возьмёт локальный access token из `/etc/project-control/project-control.env`;
5. потоково загрузит `docomator` через штатный `/api/projects/docomator/update`;
6. дождётся точной активной версии и зелёного health;
7. аналогично обновит `planer-solving`;
8. аналогично обновит `kafedra-planner`;
9. выведет итоговое состояние всех трёх сервисов.

При ошибке выполнение останавливается. Rollback конкретного приложения остаётся ответственностью его native installer, как и при обычном обновлении через UI Project Control.

## Режимы получения артефактов

Только скачать уже проверенные CI release:

```bash
./scripts/f2re-stack.sh download
./scripts/f2re-stack.sh pack
```

Если точного artifact закреплённого SHA нет, `download` завершится ошибкой и ничего не подменит более новым release.

Принудительно пересобрать всё из исходников закреплённых commit:

```bash
./scripts/f2re-stack.sh build
./scripts/f2re-stack.sh pack
```

Или одной командой:

```bash
./scripts/f2re-stack.sh prepare --source build
```

Локальная пересборка использует штатные builders:

- `meta`: `scripts/build-meta-bundle.sh`;
- `docomator`: `scripts/project-control/build-bundle.sh`;
- `planer-solving`: `offline/build_project_control_bundle.sh`;
- `kafedra-planner`: `scripts/offline/build-project-control-bundle.sh` внутри Debian 12 container.

Для `meta`/`docomator` автоматически скачивается официальный standalone Node.js `24.15.0` и проверяется по `SHASUMS256.txt`, если `NODE_RUNTIME_DIR` не задан. Для полной локальной сборки `kafedra-planner` нужен Docker.

## Требования к online build/download машине

Для обычного `prepare` достаточно:

- Linux x86-64;
- `git`, `python3`, `tar`, `gzip`, `sha256sum`;
- `gh` с выполненным `gh auth login` для скачивания Actions artifacts.

Если какого-то artifact нет и потребуется fallback build, дополнительно могут понадобиться `curl`, `xz`, `python3-venv` и Docker. Чтобы запретить fallback и только скачивать проверенные CI artifacts, используйте:

```bash
./scripts/f2re-stack.sh prepare --source download
```

## Что лежит внутри общего stack

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

`stack-release.json` фиксирует версии и SHA всех четырёх компонентов. Поэтому один перенесённый архив является воспроизводимым deployment set, а не набором случайных «последних» файлов.

## Полезные варианты deploy

Только проверить, ничего не меняя:

```bash
sudo ./deploy-stack.sh --dry-run
```

Project Control уже установлен, обновить только приложения:

```bash
sudo ./deploy-stack.sh --skip-meta
```

Обновить один проект из stack:

```bash
sudo ./deploy-stack.sh --skip-meta --project docomator
```

Использовать Project Control на другом локальном URL:

```bash
sudo ./deploy-stack.sh --url http://127.0.0.1:19090
```

## Почему deploy идёт через Project Control API

Общий installer намеренно не запускает native `install.sh` подпроектов напрямую. Он передаёт тот же `*.f2re.zip`, который оператор загрузил бы в UI. Поэтому сохраняются:

- статический allowlist adapter;
- проверка wrapper и payload;
- политика Ed25519-подписей;
- staging;
- native verify entrypoint;
- штатный backup/migration/rollback проекта;
- проверка активной версии, systemd и HTTP health;
- единая история операций Project Control.
