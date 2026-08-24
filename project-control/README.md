# F2RE Project Control

Project Control — локальный сервис единого мониторинга, перезапуска и офлайн-обновления приложений F2RE на Astra Linux/Debian. Целевой эксплуатационный профиль — **Astra Linux Special Edition 1.8, amd64**.

Поддерживаются три явно allowlisted проекта: `docomator`, `planer-solving`, `kafedra-planner`. Их репозитории, проверенные commit SHA, CI artifacts, adapter ID, native formats, пути, службы и health endpoints зафиксированы в `config/managed-projects.json` и проверяются CI против `src/adapters.mjs`.

## Вся система одним архивом

Рекомендуемый путь — **F2RE Stack**. На машине с интернетом:

```bash
git clone https://github.com/f2re/meta.git
cd meta/project-control
gh auth login
./scripts/f2re-stack.sh prepare
```

Скрипт сам скачивает проверенные GitHub Actions artifacts точных закреплённых SHA. Если отдельного artifact ещё нет, в режиме `auto` пересобирается только недостающий компонент его штатным builder. На выходе два переносимых файла:

```text
f2re-stack-<version>-astra-1.8-amd64.tar.gz
f2re-stack-<version>-astra-1.8-amd64.tar.gz.sha256
```

На Astra Linux:

```bash
sha256sum -c f2re-stack-*.tar.gz.sha256
tar -xzf f2re-stack-*.tar.gz
cd f2re-stack-*
sudo ./deploy-stack.sh
```

`deploy-stack.sh` проверяет весь набор, устанавливает/обновляет Project Control, а затем через его штатный API последовательно накатывает `docomator`, `planer-solving` и `kafedra-planner`. После каждого проекта обязательны совпадение активной версии и зелёный systemd/HTTP health-check. Подробно: `docs/STACK.md`.

## Операторский сценарий через UI

One-shot stack не отменяет обычный режим:

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

## Отдельные артефакты

Low-level controller bundle:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 ./scripts/build-offline-bundle.sh
```

Astra meta-bundle только для Project Control:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 TARGET_ASTRA_VERSION=1.8 ./scripts/build-meta-bundle.sh
```

Полная принудительная пересборка всех четырёх компонентов и stack:

```bash
./scripts/f2re-stack.sh prepare --source build
```

Только скачать CI artifacts без fallback-сборки:

```bash
./scripts/f2re-stack.sh prepare --source download
```

## Установка отдельного meta-bundle

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

`npm run check` выполняет Node/Python тесты, syntax checks, проверку stack pack/dry-run и сверку compatibility manifest с runtime adapter allowlist. GitHub Actions дополнительно собирает Project Control/meta-bundle и запускает deployment smoke в официальном Astra Linux 1.8 UBI userspace.

Подробности: `docs/STACK.md`, `docs/ASTRA_LINUX.md`, `docs/COMPATIBILITY.md`, `docs/STANDARD.md`.
