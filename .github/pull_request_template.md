## Что изменено

<!-- Кратко: пользовательская/эксплуатационная проблема и решение. -->

## Проверка

- [ ] `cd project-control && npm run check`
- [ ] Shell/Python syntax checks пройдены
- [ ] Добавлены или обновлены тесты контракта
- [ ] Offline-first поведение сохранено
- [ ] Обновлены README/docs/CHANGELOG при изменении поведения

## Release / deployment impact

- [ ] Изменение не требует SemVer bump
- [ ] PATCH — совместимое исправление
- [ ] MINOR — новая совместимая возможность / платформа
- [ ] MAJOR — несовместимый API/adapter/deployment contract

Если затронуты installer/runtime/bundle/release файлы, PR считается готовым только после зелёной Astra Linux 1.7 + 1.8 matrix.

## Безопасность

- [ ] Нет произвольных root-команд из входных bundle
- [ ] SHA-256 / archive path / adapter allowlist не ослаблены
- [ ] В PR/логах нет access token, паролей и других секретов
