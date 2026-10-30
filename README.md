# 42 AI Studio

Сайт для создания видео с помощью ИИ. Пользователь ставит задачу, агент-видеограф
собирает Remotion-композицию, озвучивает, рендерит и отдаёт готовый ролик.

## Запуск с нуля

```bash
cp .env.example .env        # значения-заглушки, секретов в образце нет
docker compose up -d        # Postgres и хранилище, бакеты studio-dev и studio-test
npm install
npm run db:migrate          # применяет миграции к базе из DATABASE_URL
npm run dev
```

Проверить, что всё поднялось:

```bash
curl -i http://localhost:3000/api/health     # {"status":"ok","checks":{"database":"ok","storage":"ok"}}
curl -i http://localhost:3000/eve/v1/health  # {"ok":true,...}
```

`GET /api/health` отвечает `503`, если недоступна база или хранилище; тексты
ошибок при этом уходят только в журнал сервера.

### Как вручную увидеть отказ хранилища

```bash
S3_ENDPOINT=http://localhost:1 npm run dev
curl -i http://localhost:3000/api/health
# {"status":"error","checks":{"database":"ok","storage":"error"}}
```

## Команды

| Команда | Что делает |
| --- | --- |
| `npm run dev` | разработка (`next dev`) |
| `npm run build` | сборка: `eve build` и `next build` |
| `npm start` | production-запуск (сначала нужен `npm run build`) |
| `npm run db:generate` | создать миграцию из изменений схемы |
| `npm run db:migrate` | применить миграции к базе из `DATABASE_URL` |
| `npm run test:http` | HTTP-тесты запущенного приложения |

`npm run build` секретов не требует: проверка переменных окружения
пропускается на фазе сборки. При `npm start` сначала выполняйте
`npm run build` — он делает `eve build`, и eve при этом слушает порт `4274`
(`EVE_NEXT_PRODUCTION_PORT`).

## Тесты

```bash
docker compose up -d
npm run test:http
```

Тесты запускают настоящее приложение и ходят в него по HTTP: глобальная
подготовка создаёт базу `*_test`, бакет, применяет миграции и поднимает
основной экземпляр `next dev` на `TEST_APP_PORT`, отдельные тесты поднимают
свои экземпляры через `startApp()`. Работать тесты могут только с базой,
имя которой оканчивается на `_test`.

Два `next dev` на один проект не мешают друг другу: каждый экземпляр получает
свой `NEXT_DIST_DIR` (`.next-test-<порт>`), поэтому блокировка `.next/dev/lock`
не конфликтует. При этом `withEve()` держит один dev-сервер eve на корень
проекта (состояние в `.eve/`) — второй экземпляр делит процесс eve с первым,
изоляции окружения eve нет. Тестам, которым нужно другое окружение eve,
понадобится остановить основной экземпляр и вынести их в отдельные файлы.

## Документация

- [eve](https://eve.dev/docs) — агент и его инструменты.
- [Remotion](https://www.remotion.dev/docs) — сборка и рендер видео.
- Структура проекта, команды и соглашения — в [`AGENTS.md`](AGENTS.md).
