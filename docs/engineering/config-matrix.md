# Матриця конфігурацій local / dev / live

Змінні середовища трьох стендів поряд із [Options.md](../Options.md). Таблицю між позначками пише
`scripts/config-matrix.js`, колонку «Why» – людина; при оновленні скрипт її зберігає.

Значення секретів скрипт не виводить: для імен із `PASS`, `SECRET`, `TOKEN`, `KEY`, `USER`, `AUTH`,
`CLIENT_ID` лише «set / not set» і чи збігається значення з іншим стендом. URI з логіном і довгі
рядки, схожі на ключ, теж ховаються, хоч би як звалась змінна.

## Як оновити

Лише читання з сервера, `.env` не відкривається. Оточення контейнерів іде у скрипт напряму:

```sh
node scripts/config-matrix.js --write docs/engineering/config-matrix.md local=contributing \
  dev=<(ssh hosting2 'docker inspect ackee-dev --format "{{json .Config.Env}}"') \
  live=<(ssh hosting2 'docker inspect ackee-live --format "{{json .Config.Env}}"')
```

`local` – це `.env` із [CONTRIBUTING.md](../../CONTRIBUTING.md) разом із `NODE_ENV=development`
від `npm run dev`. Без `--write` таблиця виводиться в термінал.

Статуси: `same` – однаково всюди; `differs (dev = live)` – різниться, але названі стенди між собою
збігаються; `unknown` – змінної немає в Options.md; `set nowhere` – описана, але не задана ніде.

## Матриця

<!-- config-matrix:start -->

| Variable                           | local                             | dev                                | live                               | Status                 | Why                                                                                                     |
| ---------------------------------- | --------------------------------- | ---------------------------------- | ---------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `ACKEE_ALLOW_ORIGIN`               | not set                           | `https://dev.ackee2.varlex.app`    | `https://ackee2.varlex.app`        | differs                | Кожен стенд дозволяє свою адресу                                                                        |
| `ACKEE_ALLOW_SIGNUP`               | not set                           | `true`                             | not set                            | differs (local = live) | Реєстрацію відкрито лише на dev, щоб її пробувати; live закрита, доки не вирішено                       |
| `ACKEE_AUTO_ORIGIN`                | not set                           | `true`                             | `true`                             | differs (dev = live)   | CORS для доменів зі списку потрібен лише стендам із реальними сайтами                                   |
| `ACKEE_BUILD`                      | not set                           | `sha-db9e71a`                      | `4.0.0-rc.1`                       | unknown                | Пише CI в образ (`ARG ACKEE_BUILD` у Dockerfile). **Дефект:** немає в Options.md                        |
| `ACKEE_DEMO`                       | not set                           | not set                            | not set                            | set nowhere            | Демо-режим ніде не потрібен                                                                             |
| `ACKEE_GA4_SYNC_SCHEDULE`          | not set                           | `*/10 * * * *`                     | `*/10 * * * *`                     | differs (dev = live)   | Кожні 10 хв на стендах, щоб бачити синхронізацію GA4; локально типове                                   |
| `ACKEE_GEO`                        | not set                           | not set                            | not set                            | set nowhere            | **Дефект:** країни (ACKEE-20) є в релізі, але не ввімкнені на жодному стенді                            |
| `ACKEE_GEO_DATABASE`               | not set                           | not set                            | not set                            | set nowhere            | Вистачає вбудованої бази                                                                                |
| `ACKEE_GOOGLE_CLIENT_ID`           | not set                           | set                                | set, same as dev                   | differs (dev = live)   | Один OAuth-клієнт на обидва стенди, його redirect URI перелічують обидві адреси                         |
| `ACKEE_GOOGLE_CLIENT_SECRET`       | not set                           | set                                | set, same as dev                   | differs (dev = live)   | Той самий OAuth-клієнт, що й `ACKEE_GOOGLE_CLIENT_ID`                                                   |
| `ACKEE_INGEST_CONSUMER`            | not set                           | `ackee-dev`                        | not set                            | differs (local = live) | Потрібен лише там, де є черга                                                                           |
| `ACKEE_INGEST_QUEUE`               | not set                           | `redis://redis:6379`               | not set                            | differs (local = live) | Черга (ADR-006) поки лише на dev, через `ACKEE_DEV_INGEST_QUEUE` у `.env`; у сервісі live змінної немає |
| `ACKEE_LIVE_CONNECTIONS`           | not set                           | not set                            | not set                            | set nowhere            | Вистачає типового значення                                                                              |
| `ACKEE_LIVE_WORKSPACE_CONNECTIONS` | not set                           | not set                            | not set                            | set nowhere            | Вистачає типового значення                                                                              |
| `ACKEE_METRICS_TOKEN`              | not set                           | set                                | set                                | differs                | Свій токен Prometheus на стенд                                                                          |
| `ACKEE_MONGODB`                    | `mongodb://localhost:27017/ackee` | `mongodb://mongo:27017/ackee_dev`  | `mongodb://mongo:27017/ackee_live` | differs                | Одна MongoDB, своя база на стенд                                                                        |
| `ACKEE_PASSWORD`                   | not set                           | set                                | set, same as dev                   | differs (dev = live)   | **Дефект:** той самий пароль, що й на dev                                                               |
| `ACKEE_PORT`                       | not set                           | not set                            | not set                            | set nowhere            | Типовий 3000                                                                                            |
| `ACKEE_REDIS`                      | not set                           | not set                            | not set                            | set nowhere            | Один процес на стенд, спільна сіль не потрібна                                                          |
| `ACKEE_ROLE`                       | not set                           | not set                            | not set                            | set nowhere            | Один процес робить усе                                                                                  |
| `ACKEE_SECRET_KEY`                 | not set                           | set                                | set                                | differs                | Свій ключ на стенд (ACKEE-21)                                                                           |
| `ACKEE_SMTP_FROM`                  | `ackee@localhost`                 | `Ackee Dev <dev.ackee@varlex.app>` | `Ackee <ackee@varlex.app>`         | differs                | Своя скринька на стенд, щоб пошту з dev було видно одразу; локально Mailpit                             |
| `ACKEE_SMTP_HOST`                  | `localhost`                       | `my.mailbux.com`                   | `my.mailbux.com`                   | differs (dev = live)   | Mailbux на стендах, Mailpit локально                                                                    |
| `ACKEE_SMTP_PASSWORD`              | not set                           | set                                | set                                | differs                | Своя скринька на стенд                                                                                  |
| `ACKEE_SMTP_PORT`                  | `1025`                            | `465`                              | `465`                              | differs (dev = live)   | 465 – TLS у Mailbux, 1025 – Mailpit                                                                     |
| `ACKEE_SMTP_USER`                  | not set                           | set                                | set                                | differs                | Своя скринька на стенд                                                                                  |
| `ACKEE_TRACKER`                    | not set                           | not set                            | not set                            | set nowhere            | Вистачає `/tracker.js`                                                                                  |
| `ACKEE_TRUST_PROXY`                | not set                           | `1`                                | `1`                                | differs (dev = live)   | Один реверс-проксі (Caddy) перед стендом (ACKEE-94); локально проксі немає                              |
| `ACKEE_TTL`                        | not set                           | not set                            | not set                            | set nowhere            | Вистачає типового значення                                                                              |
| `ACKEE_UPDATE_RECORD_LIMIT`        | not set                           | not set                            | not set                            | set nowhere            | Вистачає типового значення                                                                              |
| `ACKEE_URL`                        | `http://localhost:3000`           | `https://dev.ackee2.varlex.app`    | `https://ackee2.varlex.app`        | differs                | Своя адреса на стенд                                                                                    |
| `ACKEE_USERNAME`                   | not set                           | set                                | set, same as dev                   | differs (dev = live)   | **Дефект:** той самий логін, що й на dev                                                                |
| `MONGODB_URI`                      | not set                           | not set                            | not set                            | set nowhere            | Замість нього `ACKEE_MONGODB`                                                                           |
| `NODE_ENV`                         | `development`                     | not set                            | not set                            | differs (dev = live)   | Локально `npm run dev`; на стендах не задано, тобто не development                                      |
| `PORT`                             | not set                           | not set                            | not set                            | set nowhere            | Типовий 3000                                                                                            |

Not in Options.md: `ACKEE_BUILD`.

Documented but set nowhere: `ACKEE_DEMO`, `ACKEE_GEO`, `ACKEE_GEO_DATABASE`, `ACKEE_LIVE_CONNECTIONS`, `ACKEE_LIVE_WORKSPACE_CONNECTIONS`, `ACKEE_PORT`, `ACKEE_REDIS`, `ACKEE_ROLE`, `ACKEE_TRACKER`, `ACKEE_TTL`, `ACKEE_UPDATE_RECORD_LIMIT`, `MONGODB_URI`, `PORT`.

Set by the image, not compared: `NODE_VERSION`, `PATH`, `YARN_VERSION`.

<!-- config-matrix:end -->

## Знахідки 18.11.2026

Перевірка 18.11.2026, dev – `sha-db9e71a`, live – `4.0.0-rc.1`.

- `ACKEE_USERNAME` і `ACKEE_PASSWORD` спільні для dev і live: у `deploy/docker-compose.yml` обидва
  сервіси беруть `${ACKEE_USERNAME}` і `${ACKEE_PASSWORD}`. Пароль dev відкриває live. Виправлено
  18.11 (ACKEE-128): live бере пароль з `ACKEE_LIVE_PASSWORD`.
- `ACKEE_GEO` не задано ніде, тож країни відвідувачів (ACKEE-20) на стендах не збираються. Виправлено
  18.11 (ACKEE-126): на live `ACKEE_GEO=country`.
- `ACKEE_BUILD` задає образ, читає `src/utils/config.js`, але в Options.md його немає.
- Черга подій лише на dev. Це рішення, а не дрейф (`ci-cd.md`), але live чергу не перевіряє.
- `ACKEE_TRUST_PROXY` і `ACKEE_GA4_SYNC_SCHEDULE` на dev і live тепер однакові.
