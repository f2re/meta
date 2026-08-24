# F2RE Project Control

Project Control — локальный сервис единого мониторинга, диагностики, перезапуска и офлайн-обновления приложений F2RE на Astra Linux/Debian. Стабильные release targets: **Astra Linux Special Edition 1.7 и 1.8, amd64**.

Поддерживаются три явно allowlisted проекта: `docomator`, `planer-solving`, `kafedra-planner`. Их репозитории, проверенные commit SHA, CI artifacts, adapter ID, native formats, штатные пути, службы и health endpoints зафиксированы в `config/managed-projects.json` и проверяются CI против `src/adapters.mjs`.

## Скачать

Стабильные сборки публикуются в GitHub Releases:

- Astra 1.7: `f2re-meta-astra-1.7-amd64.tar.gz`;
- Astra 1.8: `f2re-meta-astra-1.8-amd64.tar.gz`;
- portable controller: `project-control-linux-x64.tar.gz`;
- `SHA256SUMS` и `release-manifest.json` для проверки всего релиза.

Latest release: <https://github.com/f2re/meta/releases/latest>

## Что показывает интерфейс 0.5.3

UI выполняет фактический runtime discovery:

- сканирует `/opt`, `current` и варианты `VERSION`;
- читает состояние systemd и реальные unit paths/ExecStart;
- сканирует TCP LISTEN через `ss`;
- читает `/etc/nginx` и извлекает `server_name`, `location`, `proxy_pass`, `client_max_body_size`;
- сопоставляет эти признаки с allowlisted проектами;
- делает независимый HTTP health-check на фактически настроенном порту;
- показывает обнаруженный путь, версию, порт, nginx route, службы, источники определения и предупреждения.

Кнопка **«Пересканировать сервер»** принудительно сбрасывает короткий discovery cache. Если privileged executor неисправен, host discovery и UI остаются доступными и показывают ошибку executor; update/restart при этом недоступны до восстановления executor.

Frontend работает как напрямую на `:9090`, так и за nginx path prefix. HTML/JS/CSS отдаются `no-store`, API base вычисляется от URL реально загруженного `app.js`, а compatibility layer окна ключа также корректно загружается через prefix.

Browser update использует блоки по 512 КиБ и отдельную apply-job: это не зависит от типового nginx `client_max_body_size 1m` и не держит один HTTP request на всё время native installer. Тот же chunked/job-контур используется `deploy-stack.sh`. Подробности: `docs/RUNTIME_DISCOVERY.md`.

## Установка стабильного meta-bundle

Для Astra 1.7:

```bash
curl -fLO https://github.com/f2re/meta/releases/latest/download/f2re-meta-astra-1.7-amd64.tar.gz
curl -fLO https://github.com/f2re/meta/releases/latest/download/f2re-meta-astra-1.7-amd64.tar.gz.sha256
sha256sum -c f2re-meta-astra-1.7-amd64.tar.gz.sha256
tar -xzf f2re-meta-astra-1.7-amd64.tar.gz
cd f2re-meta-*-astra-1.7-amd64
./verify.sh
sudo ./install.sh
```

Для Astra 1.8 замените `1.7` на `1.8`.

После установки:

```bash
curl -fsS http://127.0.0.1:9090/api/ping
sudo cat /root/project-control-access.txt
```

## F2RE Stack

На build-машине с интернетом:

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

`prepare` намеренно работает с **exact SHA текущего локального checkout**. Если в строке `meta: поиск ... для <SHA>` отображается старый commit, обновите checkout через `git pull --ff-only`; скрипт не переключает исходники на более новый `main` скрытно.

В режиме `auto` сначала скачиваются CI artifacts exact-SHA. Если конкретного artifact ещё нет, выполняется локальный fallback build. Системный Node.js для этого не нужен: официальный standalone Node.js скачивается автоматически, проверяется по `SHASUMS256.txt` и затем явно передаётся builder-ам. Для отдельных fallback builder-ов дополнительно могут потребоваться `curl`, `xz`, `python3-venv` и Docker.

`stack_tool.py` проверяет target metadata: bundle 1.8 нельзя использовать как 1.7 простым переименованием. После подготовки stack переносится в закрытый контур и запускается `sudo ./deploy-stack.sh`.

Если Project Control доступен через reverse proxy prefix, `deploy-stack.sh` использует тот же prefix для ping, chunk upload, job polling и проверки итогового состояния:

```bash
sudo ./deploy-stack.sh --url https://server.example/project-control/
```

Если нужно строго только скачать проверенные CI artifacts и не разрешать fallback build:

```bash
./scripts/f2re-stack.sh prepare --astra 1.7 --source download
```

## Операторский сценарий через UI

1. Установить Project Control из release meta-bundle либо F2RE Stack.
2. Открыть `http://<IP>:9090/` или nginx URL и ввести ключ доступа.
3. Нажать «Пересканировать сервер» и проверить найденные `/opt`, порты, systemd и nginx routes.
4. Получить готовый `*-project-control.f2re.zip` нужного приложения.
5. Перетащить ZIP на карточку проекта.
6. UI передаст ZIP маленькими блоками, сервер проверит identity/SHA-256/adapter/подпись и запустит штатный allowlisted installer отдельной job.
7. Операция считается успешной только после совпадения активной версии и успешных systemd/HTTP health-check.

Уже существующие установки обнаруживаются по фактическим признакам даже до первого управляемого обновления. После обновлений Project Control ведёт собственную историю операций.

## Граница привилегий

`project-control.service` работает от непривилегированного пользователя `project-control`. Root-операции вынесены в `project-control-executor.service` и доступны только через локальный Unix socket. Загруженный bundle не может задавать shell-команду или systemd unit: executable contract находится только в `src/adapters.mjs`.

Ключ веб-доступа является административным секретом и при первой установке сохраняется в `/root/project-control-access.txt`.

Для обязательной криптографической аутентификации release package установите `PROJECT_CONTROL_REQUIRE_SIGNATURE=true` и доверенные Ed25519 public keys в `/etc/project-control/trusted-keys/<keyId>.pem`.

## Локальная сборка

Portable controller:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 ./scripts/build-offline-bundle.sh
```

Astra 1.7:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 \
TARGET_ASTRA_VERSION=1.7 \
  ./scripts/build-meta-bundle.sh
```

Astra 1.8:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 \
TARGET_ASTRA_VERSION=1.8 \
  ./scripts/build-meta-bundle.sh
```

## CI и релизы

`npm run check` выполняет syntax-check backend/frontend, discovery/nginx/proxy-prefix unit tests, dialog compatibility tests, Python-тесты chunked deployment client, stack pack/dry-run и compatibility checks.

`Project Control CI` затем независимо собирает и устанавливает release candidate в:

- официальный Astra Linux 1.7 UBI;
- официальный Astra Linux 1.8 UBI.

Workflow `Release` выпускает `vX.Y.Z` только после успешной сборки/смоука обеих платформ и публикует SHA-256 + machine-readable release manifest. Полный порядок: `../docs/RELEASING.md`.

Подробности: `docs/RUNTIME_DISCOVERY.md`, `docs/STACK.md`, `docs/ASTRA_LINUX.md`, `docs/COMPATIBILITY.md`, `docs/STANDARD.md`.
