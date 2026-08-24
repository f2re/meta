# F2RE Meta

[![Project Control CI](https://github.com/f2re/meta/actions/workflows/project-control.yml/badge.svg)](https://github.com/f2re/meta/actions/workflows/project-control.yml)

**F2RE Meta / Project Control** — локальный центр контроля версий, состояния, перезапуска и офлайн-обновления приложений F2RE на Astra Linux. Рабочая реализация находится в [`project-control/`](project-control/).

Сервис рассчитан на закрытый контур: сам Project Control устанавливается одним meta-bundle, а обновления приложений передаются отдельными проверенными `*.f2re.zip` без доступа целевого сервера к GitHub.

## Поддерживаемые проекты

| Проект | Репозиторий | Adapter | Native release |
|---|---|---|---|
| Оформлятор | [`f2re/docomator`](https://github.com/f2re/docomator) | `docomator-v1` | `docomator-offline-v2` |
| Борис по парам | [`f2re/planer-solving`](https://github.com/f2re/planer-solving) | `planer-solving-v1` | `planner-solving-offline-v3` |
| Кафедра Planner | [`f2re/kafedra-planner`](https://github.com/f2re/kafedra-planner) | `kafedra-planner-v1` | `kafedra-full-airgap-v2` |

Полные проверенные commit SHA и эксплуатационный контракт хранятся не только в документации, но и в [`project-control/config/managed-projects.json`](project-control/config/managed-projects.json). CI сверяет этот файл со статическим runtime-allowlist.

## Astra Linux: один архив для Project Control

CI выпускает:

```text
f2re-meta-<version>-astra-1.8-amd64.tar.gz
f2re-meta-<version>-astra-1.8-amd64.tar.gz.sha256
```

Установка на Astra Linux 1.8:

```bash
sha256sum -c f2re-meta-*.tar.gz.sha256
tar -xzf f2re-meta-*.tar.gz
cd f2re-meta-*
./verify.sh
sudo ./install.sh
sudo cat /root/project-control-access.txt
```

После установки:

```bash
systemctl status project-control-executor.service project-control.service
curl -fsS http://127.0.0.1:9090/api/ping
```

Интерфейс по умолчанию: `http://<IP-сервера>:9090/`.

## Как проходит обновление приложения

```mermaid
flowchart LR
    A[CI приложения] --> B[Native offline bundle]
    B --> C[Project Control .f2re.zip]
    C --> D[Перенос в закрытый контур]
    D --> E[Project Control]
    E --> F[Проверка identity / SHA-256 / подписи]
    F --> G[Allowlisted native installer]
    G --> H[systemd + health-check]
    H --> I[Новая активная версия]
```

Project Control не исполняет команды из загруженного ZIP. Команды установки, systemd-службы, пути `current` и health endpoint зашиты в контроллер и версионируются через adapter ID.

## Документация

- [`project-control/README.md`](project-control/README.md) — эксплуатация Project Control.
- [`project-control/docs/ASTRA_LINUX.md`](project-control/docs/ASTRA_LINUX.md) — сборка, установка и проверка meta-bundle на Astra Linux.
- [`project-control/docs/COMPATIBILITY.md`](project-control/docs/COMPATIBILITY.md) — зафиксированная матрица совместимости.
- [`project-control/docs/STANDARD.md`](project-control/docs/STANDARD.md) — формат `*.f2re.zip`, безопасность и deployment-контракт.

## Старый прототип

Первоначальный эксперимент 2020 года по маршрутизации метеорологических пакетов сохранён только для истории в [`legacy/2020-meteo-router/`](legacy/2020-meteo-router/). Он не является частью Project Control и не входит в meta-bundle.
