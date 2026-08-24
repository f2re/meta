# Вклад в F2RE Meta

## Перед изменением

Project Control управляет системными службами и офлайн-обновлениями, поэтому изменения release/install/update/discovery логики рассматриваются как эксплуатационно значимые.

Перед PR:

```bash
cd project-control
npm run check
```

Для shell/Python изменений дополнительно:

```bash
find deploy scripts -type f -name '*.sh' -print0 | xargs -0 -n1 bash -n
python3 -m py_compile src/package_tool.py scripts/*.py
```

## Pull request

PR должен:

- описывать пользовательский сценарий и ожидаемое поведение;
- содержать тест на исправленный defect или новый contract;
- не ослаблять SHA-256, path traversal, adapter allowlist и privilege boundary;
- сохранять offline-first эксплуатацию;
- при изменении deployment contract обновлять документацию и compatibility manifest.

## Версионирование

Версии следуют SemVer. Изменение версии выполняется одновременно в:

- `project-control/VERSION`;
- `project-control/package.json`;
- `project-control/config/project-control.env.example`;
- `CHANGELOG.md`.

Полный процесс: [`docs/RELEASING.md`](docs/RELEASING.md).

## Astra Linux

PR, влияющий на runtime/bundle/installer, считается готовым только после зелёной матрицы Astra Linux 1.7 и 1.8.
