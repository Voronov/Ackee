# Алерти

Мінімальний набір правил Prometheus, щоб про проблему після релізу команда дізнавалась з чату, а не з графіка (ACKEE-111). Правила: `deploy/prometheus/alerts.yml`, тести до них: `deploy/prometheus/alerts.test.yml`. Prometheus надсилає спрацювання в Alertmanager (`deploy/alertmanager/alertmanager.yml`), той – у Telegram.

## Правила і пороги

| Алерт                   | Вираз (скорочено)                                                                                     | Поріг                | Чому такий поріг                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `AckeeLiveDown`         | `up{job="ackee-live"} == 0`                                                                           | 2 хв                 | Це 4 пропущені збори поспіль (раз на 30 с): перезапуск після деплою (~30 с) не будить, справжнє падіння видно за кілька хвилин.       |
| `AckeeDevDown`          | `up{job="ackee-dev"} == 0`                                                                            | 2 хв                 | Те саме для dev окремо, з `severity: warning`: dev перезапускається з кожним злиттям, і його падіння не означає, що лежить live.      |
| `AckeeHttpErrors`       | частка `status=~"5.."` у `ackee_http_request_duration_seconds_count` без `route="/metrics"` за `[5m]` | > 5 % і ≥ 10 запитів | 5 % – це вже кожен двадцятий запит, а не поодинока помилка; менше 10 запитів за 5 хв замало, щоб частка щось означала (1 з 2 = 50 %). |
| `AckeeIngestQueueStuck` | `ackee_ingest_queue_oldest_age_seconds`                                                               | > 5 хв               | Воркер забирає події за секунди; подія, що чекає 5 хв, означає, що воркер стоїть, а звіти вже відстають.                              |
| `AckeeRollupsStale`     | `time() - ackee_rollups_last_success_timestamp_seconds`, де значення > 0                              | > 1 год              | Згортки будуються раз на 10 хв, тож година – це 6 невдалих запусків поспіль, а не один збій; звіти тоді повільнішають.                |

Чому так, а не інакше:

- **Стенд не відповідає** – це `up`, тобто Prometheus не зміг зібрати `/metrics`: контейнер зник, завис або не приймає токен. Одне правило на стенд, щоб у чаті було видно, який саме.
- **Запити до `/metrics` не рахуються** у частці 5xx. Prometheus сам робить 10 таких запитів за 5 хвилин, усі з 200, і вони розбавляли б помилки на тихому стенді.
- **Вік найстарішої події** – метрика з ACKEE-18. Без черги (`ACKEE_INGEST_QUEUE` порожня, як на live зараз) вона завжди 0, правило мовчить.
- **Згортки.** Метрики про них не було, тому додано одну: `ackee_rollups_last_success_timestamp_seconds` (`src/utils/rollupJob.js`, `src/utils/metrics.js`). Це час, коли запуск згорток востаннє завершився без помилки. На старті процесу вона дорівнює часу старту, тож після перезапуску алерт чекає годину. Процес без фонових задач (роль `api` чи `ingest`, ACKEE-19) показує 0, і правило його пропускає. Пропущений запуск через недоступну чергу успіхом не вважається. Live отримає цю метрику лише з наступним релізом, до того правило на live мовчить.

Відомі межі: якщо впаде сам Prometheus чи Alertmanager, ніхто не дізнається (немає зовнішнього «dead man's switch»). Падіння сервера цілком теж мовчить. Це наступний крок, якщо знадобиться.

## Перевірка локально

Версії ті самі, що в `deploy/docker-compose.yml`. З кореня репозиторію:

```sh
docker run --rm -v "$PWD/deploy/prometheus:/w" -w /w --entrypoint promtool prom/prometheus:v3.5.0 check rules alerts.yml
docker run --rm -v "$PWD/deploy/prometheus:/w" -w /w --entrypoint promtool prom/prometheus:v3.5.0 test rules alerts.test.yml
```

Кожне правило має тест, що воно спрацьовує і що не спрацьовує раніше порогу. Конфіг Alertmanager має заглушку `TELEGRAM_CHAT_ID`, тому перевіряється копія з будь-яким числом:

```sh
sed 's/TELEGRAM_CHAT_ID/-100123/' deploy/alertmanager/alertmanager.yml > /tmp/am.yml
docker run --rm -v /tmp/am.yml:/am.yml --entrypoint amtool prom/alertmanager:v0.29.0 check-config /am.yml
```

## Встановлення на сервері

Треба вирішити: **який чат** (група команди в Telegram чи окремий канал) і **хто створює бота** (його токен дає право писати від імені бота, тож він лише в `.env`).

1. Створити бота в `@BotFather` (`/newbot`), отримати токен. Додати бота в чат команди (у канал – адміністратором з правом публікувати).
2. Дізнатися id чату: написати в чат будь-що і відкрити `https://api.telegram.org/bot<токен>/getUpdates`, взяти `chat.id` (у групи й каналу він від'ємний, `-100…`). Посилання з токеном нікуди не вставляти.
3. На сервері додати в `/opt/ackee/.env`:

   ```sh
   ALERTMANAGER_TELEGRAM_BOT_TOKEN=<токен>
   ALERTMANAGER_TELEGRAM_CHAT_ID=<id чату>
   ```

4. Після злиття в `develop` деплой dev сам привезе новий `docker-compose.yml`. Файли Prometheus і Alertmanager копіюються вручну, з `develop`:

   ```sh
   scp deploy/prometheus/prometheus.yml deploy/prometheus/alerts.yml hosting2:/opt/ackee/prometheus/
   scp -r deploy/alertmanager hosting2:/opt/ackee/
   ```

5. Токен у файл, як токени `/metrics` у `prometheus/secrets`. Контейнер працює як `nobody` (65534), тому група 65534 і без читання для інших:

   ```sh
   cd /opt/ackee
   sudo install -d -m 755 alertmanager/secrets
   grep '^ALERTMANAGER_TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2- | sudo tee alertmanager/secrets/telegram_bot_token > /dev/null
   sudo chown 0:65534 alertmanager/secrets/telegram_bot_token && sudo chmod 640 alertmanager/secrets/telegram_bot_token
   ```

6. Перевірити й запустити:

   ```sh
   docker compose config -q
   docker compose up -d alertmanager
   docker compose restart prometheus   # перечитати prometheus.yml і alerts.yml
   docker exec ackee-prometheus promtool check config /etc/prometheus/prometheus.yml
   docker exec ackee-alertmanager amtool check-config /tmp/alertmanager.yml
   docker exec ackee-prometheus wget -qO- http://localhost:9090/api/v1/alertmanagers
   ```

   Останній рядок має показати `http://alertmanager:9093/api/v2/alerts` у `activeAlertmanagers`. Якщо `ALERTMANAGER_TELEGRAM_CHAT_ID` порожня, контейнер `ackee-alertmanager` виходить і перезапускається: `docker logs ackee-alertmanager`.

## Перевірка штучним збоєм на dev

Найпростіший збій, що не чіпає дані: зупинити `ackee-dev` на 3 хвилини.

1. Записати час. `docker stop ackee-dev`.
2. Через ~1 хв алерт `AckeeDevDown` у стані `pending`: `docker exec ackee-prometheus wget -qO- http://localhost:9090/api/v1/alerts`.
3. Через 2–3 хв після зупинки він `firing`, а в чаті з'являється повідомлення від бота (`for: 2m` + до 30 с збору + `group_wait: 30s`).
4. `docker start ackee-dev`. За кілька хвилин у чаті повідомлення `RESOLVED` (`send_resolved: true`).
5. Якщо повідомлення немає: `docker logs ackee-alertmanager | grep -i notify`. `Unauthorized (401)` – неправильний токен, `chat not found` – неправильний id або бота немає в чаті.

Записати в журнал час зупинки, час повідомлення в чаті й час `RESOLVED`. Live для перевірки не зупиняємо.
