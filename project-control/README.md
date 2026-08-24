# F2RE Project Control

Project Control — локальный сервис единого мониторинга, перезапуска и офлайн-обновления приложений F2RE на Astra Linux/Debian. Целевой эксплуатационный профиль meta-bundle — **Astra Linux Special Edition 1.8, amd64**.

Поддерживаются три явно allowlisted проекта: `docomator`, `planer-solving`, `kafedra-planner`. Их репозитории, проверенные commit SHA, adapter ID, native formats, пути, службы и health endpoints зафиксированы в `config/managed-projects.json` и проверяются CI против `src/adapters.mjs`.

## Операторский сценарий

1. Установить Project Control из `f2re-meta-<version>-astra-1.8-amd64.tar.gz`.
2. Открыть `http://<IP>:9090/` и ввести ключ доступа, созданный при первой установке.
3. Получить готовый `*-project-control.f2re.zip` из успешного CI нужного приложения.
4. Перетащить ZIP на карточку проекта.
5. Контроллер проверит identity, SHA-256, adapter и, если включено, Ed25519-подпись; затем вызовет только штатный allowlisted installer приложения.
6. Операция считается успешной только после совпадения активной версии и успешных systemd/HTTP health-check.

Уже существующие установки подключаются без переустановки. Версия читается из штатного `/opt/<service>/current/VERSION`; после первого управляемого обновления Project Control ведёт собственную историю операций.

## Граница привилегий

`project-control.service` работает от непривилегированного пользователя `project-control`. Root-операции вынесены в `project-control-executor.service` и доступны только через локальный Unix socket. Загруженный bundle не может задавать shell-команду или systemd unit: executable contract находится только в `src/adapters.mjs`.

Ключ веб-доступа является административным секретом и при первой установке сохраняется в `/root/project-control-access.txt`.

Для обязательной криптографической аутентификации release package установите `PROJECT_CONTROL_REQUIRE_SIGNATURE=true` и доверенные Ed25519 public keys в `/etc/project-control/trusted-keys/<keyId>.pem`.

## Сборка low-level controller bundle

На Linux build-машине с автономным Node.js runtime:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 \
  ./scripts/build-offline-bundle.sh
```

Результат в `dist/`:

```text
project-control-<version>-linux-x64.tar.gz
project-control-<version>-linux-x64.tar.gz.sha256
install-project-control.sh
```

## Сборка Astra meta-bundle

Meta-bundle — рекомендуемый переносимый артефакт для Astra Linux:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 \
TARGET_ASTRA_VERSION=1.8 \
  ./scripts/build-meta-bundle.sh
```

Результат:

```text
f2re-meta-<version>-astra-1.8-amd64.tar.gz
f2re-meta-<version>-astra-1.8-amd64.tar.gz.sha256
```

Внутри находятся controller archive, installer, `managed-projects.json`, `meta-release.json`, `verify.sh`, `SHA256SUMS` и краткая инструкция. Сами три приложения в meta-bundle не встраиваются: их `*.f2re.zip` выпускаются их собственным CI.

## Установка на Astra Linux

```bash
sha256sum -c f2re-meta-*.tar.gz.sha256
tar -xzf f2re-meta-*.tar.gz
cd f2re-meta-*
./verify.sh
sudo ./install.sh
curl -fsS http://127.0.0.1:9090/api/ping
```

По умолчанию UI слушает `0.0.0.0:9090`. Настройки находятся в `/etc/project-control/project-control.env`; данные и история — в `/var/lib/project-control`.

## Проверки CI

`npm run check` выполняет Node/Python тесты, syntax checks и сверку compatibility manifest с runtime adapter allowlist. GitHub Actions дополнительно:

- собирает low-level offline controller bundle;
- собирает и полностью проверяет Astra meta-bundle;
- запускает deployment smoke в официальном Astra Linux 1.8 UBI userspace;
- проходит установку, создание пользователя/конфигурации, запуск executor + web service и проверяет `/api/ping`;
- публикует готовый `f2re-meta-astra-1.8-amd64` artifact.

В UBI-контейнере systemd не является PID 1, поэтому CI подменяет только вызовы `systemctl`; реальные unit-файлы и пути установки остаются теми же. Полная эксплуатационная установка использует штатный systemd Astra Linux.

Подробности: `docs/ASTRA_LINUX.md`, `docs/COMPATIBILITY.md`, `docs/STANDARD.md`.
