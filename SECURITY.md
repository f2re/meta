# Security Policy

## Поддерживаемые версии

Security fixes выпускаются для последней опубликованной minor-линии Project Control. Рекомендуется использовать последний GitHub Release.

## Что считать уязвимостью

Особенно важны сообщения о:

- обходе Project Control access token;
- выполнении shell-команд из загруженного `.f2re.zip` вне статического adapter allowlist;
- path traversal / archive extraction escape;
- обходе SHA-256 или Ed25519 verification;
- privilege escalation между web service и root executor;
- подмене release/update package;
- чтении секретов/файлов за пределами требуемых `/opt`, `/etc`, `/var/lib`, systemd/nginx discovery областей.

## Сообщение

Не публикуйте рабочий exploit, секреты или приватные данные в публичном issue. Используйте GitHub Security Advisories / private vulnerability reporting, если эта функция включена для репозитория. Если private reporting недоступен, создайте минимальное публичное issue без exploit-деталей с просьбой открыть приватный канал.

В сообщении укажите версию (`Project Control X.Y.Z`), Astra Linux 1.7/1.8, способ установки и минимальные шаги воспроизведения без чувствительных данных.

## Проверка релиза

Перед установкой всегда проверяйте `SHA256SUMS` или `.sha256` рядом с release asset. Published release assets считаются immutable: исправление выпускается новой SemVer-версией, а не заменой существующего файла.
