# F2RE Managed Service / Project Control v1

## Цель

Стандарт задаёт общий внешний deployment-контракт для автономных приложений, не заставляя `docomator`, `planer-solving` и `kafedra-planner` использовать один внутренний installer. Native installer остаётся источником истины по миграциям, данным, backup, health и rollback.

## Стабильные идентификаторы

| projectId | adapter | Установка | Обязательные службы | Health |
|---|---|---|---|---|
| `docomator` | `docomator-v1` | native `install.sh` / `update.sh` | `docomator-api`, `docomator-worker` | `/readyz` |
| `planer-solving` | `planer-solving-v1` | native `install_or_update.sh --yes` | `planner-solving` | `/api/health` |
| `kafedra-planner` | `kafedra-planner-v1` | native `install.sh` | `kafedra-planner-api`, `kafedra-planner-worker` | `/api/system/health` |

Эти команды не читаются из загруженного файла. Они находятся в статическом allowlist контроллера. Именно `adapter` является версией исполняемого контракта: если меняются обязательные entrypoints, расположение `current`, service names или способ применения bundle, приложение получает новый adapter ID.

## Формат `*.f2re.zip`

ZIP содержит ровно:

```text
f2re-service.json
f2re-service.sig       # необязательно, обязательно при REQUIRE_SIGNATURE=true
payload/<native archive>
```

Пример `f2re-service.json`:

```json
{
  "schema": "f2re-managed-service/v1",
  "controllerApi": 1,
  "projectId": "kafedra-planner",
  "displayName": "Кафедра Planner",
  "adapter": "kafedra-planner-v1",
  "version": "0.1.0-rc.9",
  "sourceCommit": "<git sha>",
  "builtAt": "2026-08-24T12:00:00Z",
  "nativeBundleFormat": "kafedra-runtime-offline-v1",
  "signing": null,
  "payload": {
    "path": "payload/kafedra-planner-0.1.0-rc.9-linux-x64.tar.gz",
    "sha256": "<64 hex>",
    "size": 123456789
  }
}
```

Manifest не содержит `command`, shell-фрагментов, systemd unit names, install paths или других исполняемых значений.

`nativeBundleFormat` — identity native release, но не источник исполняемых команд. Исполнение задаётся `adapter`. Один adapter может явно разрешать несколько совместимых native formats через `config/managed-projects.json`; неизвестный формат отклоняется stack/release tooling.

## Откуда берётся Project Control package

Поддерживаются два проверяемых пути, оба привязаны к exact source commit:

1. **CI artifact** — native bundle создаётся штатным builder приложения после успешного CI, затем оборачивается в `*.f2re.zip`.
2. **Локальный F2RE Stack build** — `f2re-stack.sh` клонирует тот же закреплённый commit, запускает штатный builder приложения на build-машине и создаёт wrapper тем же Project Control package tool.

Ручное перепаковывание произвольного TAR.GZ по-прежнему не является поддерживаемым процессом. Оператор запускает единый builder, а не конструирует manifest вручную.

Для каждого package проверяются:

1. `schema=f2re-managed-service/v1` и `controllerApi=1`;
2. точные `projectId`, `adapter`, `version` и `sourceCommit`;
3. `nativeBundleFormat` из явного allowlist;
4. SHA-256 и размер payload;
5. отсутствие посторонних файлов в wrapper;
6. штатные entrypoints native archive согласно adapter;
7. итоговая версия, systemd state и HTTP health после применения.

## Текущая матрица release identity

| projectId | adapter | Разрешённые nativeBundleFormat | Обязательный install contract |
|---|---|---|---|
| `docomator` | `docomator-v1` | `docomator-offline-v2` | `install.sh` / `update.sh` |
| `planer-solving` | `planer-solving-v1` | `planner-solving-offline-v3` | `install_or_update.sh --yes` |
| `kafedra-planner` | `kafedra-planner-v1` | `kafedra-full-airgap-v2`, `kafedra-runtime-offline-v1` | `install.sh` |

### Kafedra full-airgap

`kafedra-full-airgap-v2` — target-specific выпуск с дополнительным OS package layer и managed Python. Он удобен, когда документные утилиты должны поставляться вместе с приложением.

### Kafedra runtime-offline

`kafedra-runtime-offline-v1` создаётся штатным `scripts/offline/build-bundle.sh` без Docker и содержит исходники приложения, manifest/checksums и автономный Node.js runtime. Тот же `install.sh` выполняет preflight целевой системы. Основные функции Kafedra (API, worker, календарь, задачи, данные, миграции) не требуют Office/OCR toolchain. `unzip`, Poppler, Tesseract и LibreOffice являются дополнительными возможностями и при отсутствии отражаются как degraded capabilities.

## Docomator initial install

Штатный Project Control release `docomator-offline-v2` является `generic`-профилем: preview и LLM отключены, а target-specific `.deb` layer в архив не входит. Поэтому initial-install команда `docomator-v1` — `install.sh --bundle-root .` **без** `--install-os-packages`.

Target-specific установки с дополнительным OS package layer должны выпускаться отдельным явно проверенным release profile.

## Подпись

Опциональная Ed25519-подпись защищает весь wrapper: подписываются точные UTF-8 bytes `f2re-service.json`, внутри которого находится SHA-256 payload. `f2re-service.sig` — Base64 detached signature. В signed manifest поле `signing` равно `{"algorithm":"ed25519","keyId":"..."}`.

Private release key хранится только на build-машине. На target переносится public key и кладётся в `/etc/project-control/trusted-keys/<keyId>.pem`. Для общего/недоверенного LAN рекомендуется `PROJECT_CONTROL_REQUIRE_SIGNATURE=true`.

## Транзакция обновления

1. Web API потоково сохраняет upload в `/var/lib/project-control/incoming` и считает SHA-256.
2. Root executor повторно считает SHA-256 и убеждается, что файл находится строго в managed incoming.
3. Безопасно читается wrapper manifest; проверяются schema, projectId, adapter, version и payload metadata.
4. При включённой политике проверяется Ed25519-подпись доверенным ключом.
5. Payload извлекается только после проверок; его SHA-256/size сравниваются с manifest.
6. Native archive распаковывается с запретом absolute/`..` paths, symlink, device/FIFO и дубликатов, с лимитами entries/expanded size.
7. Если adapter имеет отдельный verify entrypoint, он запускается до installer.
8. Запускается только статически allowlisted native installer.
9. Native installer выполняет собственный backup/migration/atomic switch/rollback.
10. Project Control повторно читает активный `VERSION`, systemd state и HTTP health. Успех фиксируется только если активная версия совпала с manifest и health зелёный.
11. История операции записывается в `/var/lib/project-control/history.json`.

## Уже установленные сервисы

Project Control не требует, чтобы приложение изначально было установлено через него. Активная версия определяется по штатному `current/VERSION`, а здоровье — по фактическому systemd и HTTP health endpoint.

Если для проекта ещё нет успешной записи в `history.json`, контроллер показывает обнаруженную установку по runtime evidence. После первого управляемого обновления приоритет получает точная запись Project Control с `fromVersion`, `toVersion`, SHA-256 package и временем завершения.

## Совместная установка и порты

Project Control читает реальный API-порт из постоянного `/etc/...env`. Рекомендуемый co-location профиль:

```text
planer-solving API       8001
docomator API            8080
docomator LLM            8081
kafedra-planner API      8090
kafedra-planner LLM      8091
project-control          9090
```

Project Control не переписывает постоянную конфигурацию приложения во время обычного обновления. F2RE Stack для новой Kafedra подготавливает первичный непересекающийся профиль, а существующую конфигурацию сохраняет.

## LLM-варианты

Project Control обновляет приложение через native bundle внутри wrapper. Если на target уже используется managed llama.cpp, native installer приложения отвечает за сохранение соответствующего runtime/config при обновлении. Новая GGUF-модель или новая версия llama.cpp являются отдельным крупным deployment asset и поставляются явно.

## Совместимость и versioning

`controllerApi=1` — контракт между wrapper и контроллером. Новые необязательные поля можно добавлять без смены API. Изменение смысла обязательных полей или root adapter требует нового `controllerApi`/adapter ID.

Native bundle format принадлежит конкретному приложению. Если executable contract остаётся совместимым, новый format может быть добавлен в явный allowlist `nativeBundleFormats`; release/stack CI обязан доказать его совместимость.
