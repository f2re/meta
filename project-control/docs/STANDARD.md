# F2RE Managed Service / Project Control v1

## Цель

Стандарт задаёт общий внешний deployment-контракт для автономных приложений, не заставляя `docomator`, `planer-solving` и `kafedra-planner` использовать один внутренний installer. Native installer остаётся источником истины по миграциям, данным, backup, health и rollback.

## Стабильные идентификаторы

| projectId | adapter | Установка | Обязательные службы | Health |
|---|---|---|---|---|
| `docomator` | `docomator-v1` | native `install.sh` / `update.sh` | `docomator-api`, `docomator-worker` | `/readyz` |
| `planer-solving` | `planer-solving-v1` | native `install_or_update.sh --yes` | `planner-solving` | `/api/health` |
| `kafedra-planner` | `kafedra-planner-v1` | native `install.sh` | `kafedra-planner-api`, `kafedra-planner-worker` | `/api/system/health` |

Эти команды не читаются из загруженного файла. Они находятся в статическом allowlist контроллера.

## Формат `*.f2re.zip`

ZIP содержит ровно:

```text
f2re-service.json
f2re-service.sig       # необязательно, обязательно при REQUIRE_SIGNATURE=true
payload/<native archive>
```

`f2re-service.json`:

```json
{
  "schema": "f2re-managed-service/v1",
  "controllerApi": 1,
  "projectId": "kafedra-planner",
  "displayName": "Кафедра Planner",
  "adapter": "kafedra-planner-v1",
  "version": "0.1.0-rc.8",
  "sourceCommit": "<git sha>",
  "builtAt": "2026-08-21T12:00:00Z",
  "nativeBundleFormat": "kafedra-full-offline-v2",
  "signing": null,
  "payload": {
    "path": "payload/kafedra-planner-0.1.0-rc.8-astra-1.7-amd64.tar.gz",
    "sha256": "<64 hex>",
    "size": 123456789
  }
}
```

Manifest не содержит `command`, shell-фрагментов, systemd unit names, install paths или других исполняемых значений.

## Подпись

Опциональная Ed25519-подпись защищает не только identity, но и весь native bundle: подписываются точные UTF-8 bytes `f2re-service.json`, внутри которого находится SHA-256 payload. `f2re-service.sig` — Base64 detached signature. В signed manifest поле `signing` равно `{"algorithm":"ed25519","keyId":"..."}`.

Private release key хранится только на build-машине. На target переносится public key и кладётся в `/etc/project-control/trusted-keys/<keyId>.pem`. Для общего/недоверенного LAN рекомендуется `PROJECT_CONTROL_REQUIRE_SIGNATURE=true`.

## Транзакция обновления

1. Web API потоково сохраняет upload в `/var/lib/project-control/incoming` и считает SHA-256.
2. Root executor повторно считает SHA-256 и убеждается, что файл находится строго в managed incoming.
3. Безопасно читается wrapper manifest; проверяются `schema`, `projectId`, `adapter`, version и payload metadata.
4. При включённой политике проверяется Ed25519-подпись доверенным ключом.
5. Payload извлекается только после проверок; его SHA-256/size сравниваются с manifest.
6. Native archive распаковывается вручную с запретом absolute/`..` paths, symlink, device/FIFO и дубликатов, с лимитами entries/expanded size.
7. Если native bundle имеет отдельный verify entrypoint, он запускается до installer.
8. Запускается только статически allowlisted native installer.
9. Native installer выполняет собственный backup/migration/atomic switch/rollback.
10. Project Control повторно читает активный `VERSION`, systemd state и HTTP health. Успех фиксируется только если активная версия совпала с manifest и health зелёный.
11. История операции с временем, from/to version, SHA-256 и log path записывается в `/var/lib/project-control/history.json`.

## Совместимость и versioning

`controllerApi=1` — контракт между wrapper и контроллером. Новые необязательные поля можно добавлять без смены API. Изменение смысла обязательных полей или root adapter требует нового `controllerApi`/adapter ID.

Native bundle format и его внутренняя версия принадлежат конкретному приложению и не заменяются этим стандартом.
