# Runtime discovery и диагностика Project Control

Project Control 0.4.0 не считает статический deployment-контракт достаточным доказательством того, что приложение установлено и работает. Интерфейс выполняет фактическое сканирование хоста и показывает, из каких источников получен каждый признак.

## Что сканируется

При открытии интерфейса и по кнопке «Пересканировать сервер» проверяются четыре источника:

1. `/opt` — каталоги приложений, `current` symlink, реальные target-пути и файлы `VERSION`, `app/VERSION`, `application/VERSION`;
2. systemd — известные unit-файлы, `LoadState`, `ActiveState`, `SubState`, `UnitFileState`, PID, `FragmentPath`, `ExecStart` и `WorkingDirectory`;
3. TCP LISTEN — `ss -ltnp`, с fallback на `ss -ltn`; фиксируются адрес, порт и, когда позволяют права ядра, PID/имя процесса;
4. nginx — конфигурация под `/etc/nginx`, включая `server_name`, `listen`, `location`, `proxy_pass` и `client_max_body_size`.

Для каждого allowlisted проекта эти признаки сопоставляются с его adapter. Дополнительно Project Control напрямую запрашивает штатный HTTP health endpoint на обнаруженном/настроенном порту. Поэтому старая установка может отображаться как работающая даже до того, как её layout полностью приведён к новому `/opt/<project>/current` контракту.

## Что видно в карточке

Карточка проекта показывает:

- фактическую или наблюдаемую версию;
- реальный путь установки / target `current`;
- настроенный порт и наличие TCP LISTEN;
- найденные nginx proxy routes;
- состояние systemd-служб;
- источники обнаружения: `/opt`, systemd, TCP LISTEN, nginx;
- HTTP health;
- предупреждения о несовпадающем пути, неслушающем порте, proxy на мёртвый upstream, конфликте портов и последней ошибке update.

В верхнем блоке можно развернуть полный список найденных портов, nginx-маршрутов и каталогов `/opt`.

## Работа через nginx prefix

Frontend больше не использует абсолютные `/app.js`, `/styles.css` и `/api/...`. API base вычисляется из URL реально загруженного `app.js`.

Поэтому поддерживаются, например, оба варианта:

```nginx
location /project-control/ {
    proxy_pass http://127.0.0.1:9090/;
}
```

и прямой доступ:

```text
http://server:9090/
```

Запрос `/project-control` без завершающего `/` перенаправляется на `/project-control/`. JS/CSS/HTML отдаются с `Cache-Control: no-store`, чтобы после offline update браузер не использовал старый frontend с новым API.

## Почему обновление больше не зависит от nginx body/timeouts

Большие `*.f2re.zip` не передаются одним HTTP request.

Браузер:

1. создаёт upload session;
2. делит файл на блоки по 512 КиБ;
3. последовательно загружает блоки;
4. после точного совпадения размера просит запустить apply;
5. получает `jobId` практически сразу;
6. опрашивает `/api/jobs/<jobId>` до успеха или ошибки.

Это устраняет две типовые причины неработающего обновления за reverse proxy:

- `client_max_body_size 1m` — отдельный блок меньше лимита;
- `proxy_read_timeout 60s` — native installer не удерживает один HTTP request несколько минут.

Raw endpoint `/api/projects/<id>/update` сохранён для локального CLI и one-shot stack, но browser UI использует chunked + async job flow.

## Если privileged executor не работает

`/api/projects` сначала выполняет host discovery. Если Unix socket root-executor недоступен, интерфейс всё равно возвращает результаты `/opt` / systemd / ports / nginx / health и явно показывает ошибку executor.

В этом режиме диагностика доступна, а update/restart ожидаемо заблокированы до восстановления `project-control-executor.service`.

Проверка на хосте:

```bash
sudo systemctl --no-pager -l status project-control-executor.service project-control.service
sudo journalctl -u project-control-executor.service -u project-control.service -n 200 --no-pager
sudo ss -ltnp
curl -fsS http://127.0.0.1:9090/api/ping
```
