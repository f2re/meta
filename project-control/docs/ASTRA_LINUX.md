# Astra Linux: сборка и развёртывание F2RE Meta

## Целевой профиль

Штатный meta-bundle Project Control выпускается для **Astra Linux Special Edition 1.8**. Основной CI artifact — `amd64`; builder также умеет сформировать `arm64`, если передан соответствующий автономный Linux Node.js runtime.

Целевая система должна иметь systemd, `python3`, стандартные GNU/core utilities и команды управления системными пользователями. Node.js поставляется внутри bundle и не требуется от target-системы.

## Что такое meta-bundle

`f2re-meta-<version>-astra-1.8-amd64.tar.gz` содержит всё для установки самого Project Control без сети:

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

Приложения `docomator`, `planer-solving`, `kafedra-planner` намеренно не вкладываются внутрь. Их версии обновляются независимо через собственные CI-артефакты `*-project-control.f2re.zip`.

## Сборка

```bash
cd project-control
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 \
TARGET_ASTRA_VERSION=1.8 \
OUT_DIR=$PWD/dist \
  ./scripts/build-meta-bundle.sh
```

Builder сначала проверяет `managed-projects.json`, затем создаёт low-level controller archive, его manifest SHA-256, метаданные meta-release и второй уровень checksum. TAR.GZ создаётся детерминированно по именам, uid/gid и gzip timestamp.

## Перенос и установка в закрытом контуре

Перенесите два файла:

```text
f2re-meta-<version>-astra-1.8-amd64.tar.gz
f2re-meta-<version>-astra-1.8-amd64.tar.gz.sha256
```

На Astra Linux:

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

Ожидаемый ping:

```json
{"ok":true,"version":"<version>"}
```

## Что проверяет CI

GitHub Actions использует официальный Astra Linux 1.8 UBI image из `registry.astralinux.ru`. В нём распаковывается тот же meta-bundle artifact, выполняются `verify.sh` и штатный installer, создаются системный пользователь/каталоги/config, запускаются bundled Node executor и web service и проверяются Unix socket и `/api/ping`.

Контейнерный UBI не загружается с systemd как PID 1, поэтому только orchestration-вызовы `systemctl` заменяются CI shim. Это не подменяет installer, filesystem layout, пользователей, конфигурацию, bundled runtime или приложение. На настоящей Astra Linux установщик использует штатный systemd.

## Обновление Project Control

Новый meta-bundle устанавливается той же командой `sudo ./install.sh`. Постоянная конфигурация и data directory сохраняются; новый release кладётся рядом с предыдущим и `current` переключается атомарно. При неуспешном запуске installer возвращает предыдущий release.
