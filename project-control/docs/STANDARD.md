# F2RE Managed Service / Project Control v1

## Цель

Стандарт задаёт общий внешний deployment-контракт для автономных приложений, не заставляя `docomator`, `planer-solving` и `kafedra-planner` использовать один внутренний installer. Native installer остаётся источником истины по миграциям, данным, backup, health и rollback.

## Стабильные идентификаторы

| projectId | adapter | Установка | Обязательные службы | Health |
|---|---|---|---|---|
| `docomator` | `docomator-v1` | native `install.sh` / `update.sh` | `docomator-api`, `docomator-worker` | `/readyz` |
| `planer-solving` | `planer-solving-v1` | native `install_or_update.sh --yes` | `planner-solving` | `/api/health` |
| `kafedra-planner` | `kafedra-planner-v1` | native `install.sh` | `kafedra-planner-api`, `kafedra-planner-worker` | `/api/system/health` |

Эти команды не читаются из загруженного файла. Они находятся в статическом allowlist контроллера. Именно `adapter` является версией исполняемого контракта между приложением и Project Control: если меняются обязательные entrypoints, расположение `current`, service names или способ применения bundle, приложение получает новый adapter ID.

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
  "nativeBundleFormat": "kafedra-full-airgap-v2",
  "signing": null,
  "payload": {
    "path": "payload/kafedra-planner-0.1.0-rc.8-astra-1.7-amd64.tar.gz",
    "sha256": "<64 hex>",
    "size": 123456789
  }
}
```

Manifest не содержит `command`, shell-фрагментов, systemd unit names, install paths или других исполняемых значений.

`nativeBundleFormat` является диагностической идентичностью native release и обязательно проверяется release-CI самого приложения. Project Control не использует это поле как источник команд: совместимость исполнения задаётся `adapter`. Это позволяет приложению развивать внутренний archive format без обязательного одновременного обновления контроллера, пока его allowlisted entrypoints и эксплуатационный контракт adapter остаются совместимыми.

## Обязательный release-CI приложений

Project Control package является штатным update-артефактом, а не ручной дополнительной упаковкой. Для каждого управляемого приложения действует один и тот же порядок:

1. основной CI приложения полностью проверяет commit `main`, включая штатный native offline install/update contract;
2. release workflow запускается только после успешного основного CI и делает checkout точного проверенного SHA;
3. native bundle создаётся штатным builder приложения; Project Control не подменяет его содержимое и installer;
4. поверх native archive создаётся `*.f2re.zip`;
5. release workflow отдельно проверяет wrapper SHA-256, `schema`, `controllerApi`, `projectId`, `adapter`, `version`, `sourceCommit`, `nativeBundleFormat`, payload SHA-256/size и обязательные native entrypoints;
6. этот же workflow выполняется в `pull_request` как release-contract gate, но публикует installable artifact только для успешно проверенного `main`;
7. на `main` публикуются `*-project-control.f2re.zip` и соответствующий `.sha256`.

Таким образом, оператор не должен вручную перепаковывать TAR.GZ перед загрузкой в Project Control: готовый ZIP берётся из installable GitHub Actions artifact конкретного commit.

Текущая матрица release identity:

| projectId | adapter | nativeBundleFormat | Обязательные native entrypoints |
|---|---|---|---|
| `docomator` | `docomator-v1` | `docomator-offline-v2` | `VERSION`, `verify-bundle.sh`, `update.sh`, `install.sh` |
| `planer-solving` | `planer-solving-v1` | `planner-solving-offline-v3` | `VERSION`, `verify_bundle.sh`, `install_or_update.sh` |
| `kafedra-planner` | `kafedra-planner-v1` | `kafedra-full-airgap-v2` | `install.sh`, `application/VERSION`, `deployment.json` |

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

## Уже установленные сервисы и время обновления

Project Control не требует, чтобы приложение изначально было установлено через него. Активная версия всегда определяется по штатному `current/VERSION`, а здоровье — по фактическому systemd и HTTP health endpoint.

Если для проекта ещё нет успешной записи в `history.json`, контроллер создаёт read-time запись обнаруженной установки: версия берётся из `VERSION`, а время — из `mtime` атомарно переключённого `/opt/<service>/current`. После первого управляемого обновления приоритет получает точная запись Project Control с `fromVersion`, `toVersion`, SHA-256 package и временем завершения.

## Совместная установка и порты

Project Control читает реальный API-порт из постоянного `/etc/...env`; hard-coded health URL для приложения не используется. Это важно при размещении нескольких приложений на одном Astra-хосте: native defaults `docomator` и `kafedra-planner` сейчас оба используют API-порт `8080`, а их локальные LLM defaults также могут пересекаться.

Project Control v1 принципиально не переписывает постоянную конфигурацию приложения во время обновления. Для co-location порты должны быть разведены один раз штатной конфигурацией до совместного запуска, после чего все следующие offline-обновления сохраняют эти значения. Рекомендуемый профиль одного хоста:

```text
planer-solving API       8001
docomator API            8080
docomator LLM            8081
kafedra-planner API      8090
kafedra-planner LLM      8091
project-control          9090
```

Это эксплуатационный профиль, а не изменение native defaults существующих приложений; он не ломает уже развёрнутые системы.

## LLM-варианты

Project Control обновляет приложение через тот native bundle, который находится внутри wrapper. Для `kafedra-planner` стандартный Project Control release содержит full air-gap application bundle без GGUF. Если на target уже используется managed llama.cpp, штатный `kafedra-planner` installer при таком обновлении переносит существующий `runtime/llama` в новый versioned release и сохраняет постоянную LLM-конфигурацию; обновление приложения поэтому не отключает установленный LLM-контур.

Новые GGUF-модели или новая версия llama.cpp являются отдельным крупным deployment asset и должны поставляться явно LLM release bundle. Тестовый fake-LLM из CI никогда не публикуется как installable Project Control artifact.

## Совместимость и versioning

`controllerApi=1` — контракт между wrapper и контроллером. Новые необязательные поля можно добавлять без смены API. Изменение смысла обязательных полей или root adapter требует нового `controllerApi`/adapter ID.

Native bundle format и его внутренняя версия принадлежат конкретному приложению и не заменяются этим стандартом. Release-CI обязан проверять, что заявленный `nativeBundleFormat` соответствует реально построенному native release конкретного приложения.
