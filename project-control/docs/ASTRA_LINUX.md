# Astra Linux: сборка и развёртывание F2RE Meta

## Поддерживаемые профили

Стабильные meta-bundle Project Control выпускаются для:

| ОС | Архитектура | Release asset | CI deployment smoke |
|---|---|---|---|
| Astra Linux Special Edition 1.7 | amd64 | `f2re-meta-<version>-astra-1.7-amd64.tar.gz` | официальный `astra/ubi17:1.7.5` |
| Astra Linux Special Edition 1.8 | amd64 | `f2re-meta-<version>-astra-1.8-amd64.tar.gz` | официальный `astra/ubi18-python311:latest` |

Целевая система должна иметь systemd, `python3`, стандартные GNU/core utilities и команды управления системными пользователями. Node.js поставляется внутри bundle и не требуется от target-системы.

Builder также умеет сформировать `arm64`, если передан соответствующий автономный Linux Node.js runtime, но публичная release matrix `0.5.x` проверяет и публикует `amd64`.

## Stable download

Astra 1.7:

```bash
curl -fLO https://github.com/f2re/meta/releases/latest/download/f2re-meta-astra-1.7-amd64.tar.gz
curl -fLO https://github.com/f2re/meta/releases/latest/download/f2re-meta-astra-1.7-amd64.tar.gz.sha256
sha256sum -c f2re-meta-astra-1.7-amd64.tar.gz.sha256
```

Astra 1.8:

```bash
curl -fLO https://github.com/f2re/meta/releases/latest/download/f2re-meta-astra-1.8-amd64.tar.gz
curl -fLO https://github.com/f2re/meta/releases/latest/download/f2re-meta-astra-1.8-amd64.tar.gz.sha256
sha256sum -c f2re-meta-astra-1.8-amd64.tar.gz.sha256
```

Общий inventory release: `https://github.com/f2re/meta/releases/latest/download/release-manifest.json` и `SHA256SUMS`.

## Что такое meta-bundle

`f2re-meta-<version>-astra-<1.7|1.8>-amd64.tar.gz` содержит всё для установки самого Project Control без сети:

```text
f2re-meta-.../
├── README-INSTALL.txt
├── SHA256SUMS
├── install.sh
├── verify.sh
├── meta-release.json
├── managed-projects.json
├── install-project-control.sh
├── project-control-<version>-linux-x64.tar.gz
└── project-control-<version>-linux-x64.tar.gz.sha256
```

Приложения `docomator`, `planer-solving`, `kafedra-planner` имеют независимые update packages `*-project-control.f2re.zip`; one-shot объединение выполняет F2RE Stack.

## Сборка

Astra 1.7:

```bash
cd project-control
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 \
TARGET_ASTRA_VERSION=1.7 \
OUT_DIR=$PWD/dist \
  ./scripts/build-meta-bundle.sh
```

Astra 1.8:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 \
TARGET_ASTRA_VERSION=1.8 \
OUT_DIR=$PWD/dist \
  ./scripts/build-meta-bundle.sh
```

Builder отклоняет target, отличный от `1.7.x` или `1.8.x`. `meta-release.json` фиксирует фактическую целевую ОС; встроенный `verify.sh` проверяет metadata и checksums.

## Перенос и установка в закрытом контуре

```bash
sha256sum -c f2re-meta-*.tar.gz.sha256
tar -xzf f2re-meta-*.tar.gz
cd f2re-meta-*
./verify.sh
sudo ./install.sh
```

Installer:

- проверяет SHA-256 всего вложенного controller bundle;
- создаёт системную группу/пользователя `project-control`;
- устанавливает versioned release в `/opt/project-control/releases` и атомарно переключает `/opt/project-control/current`;
- создаёт постоянную конфигурацию `/etc/project-control/project-control.env`;
- сохраняет данные в `/var/lib/project-control`;
- устанавливает и запускает `project-control-executor.service` и `project-control.service`;
- откатывает `current` на предыдущий release, если новый web service не отвечает на `/api/ping`.

## Проверка после установки

```bash
sudo systemctl --no-pager --full status \
  project-control-executor.service project-control.service

curl -fsS http://127.0.0.1:9090/api/ping
sudo cat /root/project-control-access.txt
```

Ping 0.5.x дополнительно сообщает доступность discovery, chunk upload и async jobs.

## Что проверяет CI

GitHub Actions строит один release candidate и отдельно прогоняет platform job для Astra 1.7 и 1.8. В официальном UBI:

1. проверяется внешний SHA-256;
2. распаковывается тот же meta-bundle;
3. сверяется `meta-release.json.target.version`;
4. выполняется `verify.sh`;
5. выполняется штатный installer;
6. создаются пользователи/каталоги/config;
7. запускаются bundled Node executor и web service;
8. проверяются Unix socket, `/api/ping`, UI/API за URL prefix, runtime discovery и chunk upload session.

Контейнерный UBI не загружается с systemd как PID 1, поэтому только orchestration-вызовы `systemctl` заменяются CI shim. Это не подменяет installer, filesystem layout, пользователей, конфигурацию, bundled runtime или приложение. На настоящей Astra Linux установщик использует штатный systemd.

## Обновление Project Control

Новый meta-bundle устанавливается той же командой `sudo ./install.sh`. Постоянная конфигурация и data directory сохраняются; новый release кладётся рядом с предыдущим и `current` переключается атомарно. При неуспешном запуске installer возвращает предыдущий release.

## Версионирование

Stable release имеет тег `vX.Y.Z`. Порядок выпуска и policy неизменяемых assets: [`../../docs/RELEASING.md`](../../docs/RELEASING.md).
