# F2RE Project Control

Локальный сервис единого мониторинга, перезапуска и offline-обновления `docomator`, `planer-solving` и `kafedra-planner` на Astra Linux/Debian.

Основной сценарий: открыть одну локальную страницу, увидеть фактически активные версии и состояние systemd/health-check, выбрать проект и перетащить подготовленный `*.f2re.zip`. Контроллер проверяет identity package, SHA-256, соответствие allowlisted adapter, распаковывает native bundle в изолированный staging и вызывает штатный installer конкретного проекта. Миграции, backup и rollback не дублируются: за них отвечает существующая транзакция проекта.

## Граница привилегий

`project-control.service` работает от непривилегированного пользователя `project-control`. Root-операции вынесены в `project-control-executor.service` и доступны только через локальный Unix socket. Bundle никогда не передаёт контроллеру произвольную команду: для каждого `projectId` команда установки и список systemd-служб зашиты в статический allowlist `src/adapters.mjs`.

Ключ веб-доступа является административным секретом: его владелец может инициировать root-обновление управляемых приложений. При первой установке ключ генерируется в `/root/project-control-access.txt`.

Для среды, где release package должны быть аутентифицированы криптографически, включите `PROJECT_CONTROL_REQUIRE_SIGNATURE=true` и разместите доверенные Ed25519 public keys в `/etc/project-control/trusted-keys/<keyId>.pem`. Формат и подпись описаны в `docs/STANDARD.md`.

## Offline bundle Project Control

На подключённой Linux build-машине с автономным Node.js runtime:

```bash
NODE_RUNTIME_DIR=/srv/runtime/node-v24-linux-x64 \
  ./scripts/build-offline-bundle.sh
```

На целевую Astra переносятся три файла из `dist/`:

```text
project-control-0.1.0-linux-x64.tar.gz
project-control-0.1.0-linux-x64.tar.gz.sha256
install-project-control.sh
```

Установка/обновление самого контроллера:

```bash
sudo ./install-project-control.sh
cat /root/project-control-access.txt
```

По умолчанию UI слушает `0.0.0.0:9090`. Порт/адрес и режим проверки подписей задаются в `/etc/project-control/project-control.env`.

## Project packages

Каждый управляемый проект продолжает выпускать свой native offline archive. Дополнительно build pipeline создаёт ZIP-обёртку `*-project-control.f2re.zip`, в которой identity manifest связывает `projectId`, версию и SHA-256 native payload. Именно этот ZIP перетаскивается в UI.

Подробности: `docs/STANDARD.md`.
