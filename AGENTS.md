# 42 AI Studio

Сайт для создания видео с помощью ИИ. Пользователь ставит задачу, агент-видеограф собирает Remotion-композицию, озвучивает, рендерит и отдаёт готовый ролик. Интерфейс и видео поддерживают русский язык.

Решения первой версии записаны в спецификации — GitHub Issue `42-Z/42-ai-studio#1`; тикеты — её подзадачи.

## Архитектура

Один root-агент eve и Next.js-приложение в одном корневом пакете. Next.js смонтирован с агентом через `withEve()` из `eve/next`.

```text
42-ai-studio/
├── package.json
├── package-lock.json
├── next.config.ts
├── tsconfig.json
├── app/                    # Next.js App Router
├── components/             # shadcn/ui лежит в components/ui
├── components.json         # конфигурация shadcn
├── lib/
├── public/
├── agent/                  # единственный root-агент
│   ├── agent.ts
│   ├── instructions.md
│   ├── channels/
│   ├── tools/
│   ├── skills/
│   ├── subagents/
│   └── lib/
├── evals/
├── .agents/skills/
└── AGENTS.md
```

- `agent/` — единственный агент; не создавать `agents/`, пока не появится второй отдельно адресуемый агент.
- Браузерный код держать вне `agent/`.
- Фронтенд и агент живут в одном корневом пакете.
- Не выносить фронтенд в отдельный пакет `web/` или `apps/web/`.
- Не делать ручной прокси `/eve`, если `withEve()` уже смонтировал агент.

## Стек

- Node.js 24.x
- npm — один `package-lock.json` и один `node_modules`
- Next.js 16.4.3
- React 19
- TypeScript 5
- eve 0.83.0
- Tailwind CSS
- shadcn/ui на Base UI (`--base base`) — основа интерфейса
- Реестры shadcn для готовых секций и анимаций: `@watermelon` (Watermelon UI) и `@react-bits` (React Bits)
- Remotion — видео в песочнице

## Команды

```sh
npm run dev        # next dev; withEve поднимает eve
npm run build      # eve build && next build
npm start          # next start
npm run typecheck  # tsc --noEmit
npm run db:generate  # создать миграцию из изменений схемы (drizzle-kit generate)
npm run db:migrate   # применить миграции к базе из DATABASE_URL
npm run test:http    # HTTP-тесты запущенного приложения (нужен docker compose up -d)
```

Нативные команды eve: `eve dev`, `eve build`, `eve start`, `eve info`, `eve eval`, `eve deploy`.

## shadcn/ui

Весь фронтенд делается только через shadcn и его реестры (`@shadcn`, `@watermelon`, `@react-bits`): компоненты ставит и обновляет CLI shadcn, вручную их не копировать. Собственные стили и голый HTML/CSS вместо компонента не писать. Основа — Base UI (`--base base`), не Radix.

```sh
npx shadcn@latest init -b base               # первичная настройка, создаёт components.json
npx shadcn@latest add button card            # добавить компоненты
npx shadcn@latest add button --dry-run       # предпросмотр без записи файлов
npx shadcn@latest add button --diff          # diff с локальной версией
npx shadcn@latest add button --view          # содержимое файлов компонента
npx shadcn@latest add @watermelon/<имя>      # элемент из реестра Watermelon UI (так же @react-bits/<имя> для React Bits)
npx shadcn@latest search @watermelon @react-bits -q "hero"   # поиск сразу по нескольким реестрам
npx shadcn@latest apply <пресет>             # применить пресет к проекту
npx shadcn@latest apply <пресет> --only theme   # только тема (или --only font — только шрифт)
npx shadcn@latest preset decode <код>        # расшифровать код пресета (--json)
npx shadcn@latest preset resolve             # пресет текущего проекта (псевдоним: preset info)
npx shadcn@latest preset url <код>           # ссылка на создание пресета
npx shadcn@latest preset open <код>          # открыть пресет в браузере
npx shadcn@latest view button card           # посмотреть элементы реестра до установки
npx shadcn@latest search @shadcn -q "form"   # искать в реестрах (псевдоним: list)
npx shadcn@latest docs button                # документация и API компонента (--json)
npx shadcn@latest info --json                # сведения о проекте
npx shadcn@latest migrate icons              # миграции: cn, icons, base-color, radix, rtl
npx shadcn@latest eject                      # встроить shadcn/tailwind.css, необратимо
npx shadcn@latest build                      # собрать registry.json в public/r, нужно только для своего реестра
npx shadcn@latest mcp init --client claude   # подключить MCP-сервер shadcn
```

- Перед созданием любого элемента интерфейса смотреть `docs`, `search` и `view` по `@shadcn`, `@watermelon` и `@react-bits`. Если подходящего нет, собирать новый компонент из компонентов shadcn и примитивов Base UI, а не из голого HTML.
- Файлы в `components/ui` принадлежат проекту. Перед `add --overwrite` смотреть `add <имя> --diff`.
- Тему и шрифты менять пресетом (`apply`), а не правкой токенов по одному.
- `@watermelon` и `@react-bits` встроены в CLI (каталог shadcn); остальные реестры подключать через `@namespace` в `components.json`.

## Интеграция

`withEve()` в `next.config.ts` монтирует агент в Next.js. Браузер работает same-origin; `useEveAgent()` не должен получать `host`, пока фронтенд и агент не разнесены осознанно.

## Фронтенд

- `useEveAgent()` из `eve/react` в клиентских компонентах.
- Маршруты: `/`, `/s`, `/s/[sessionId]`.
- `/s/[sessionId]` восстанавливает durable-сессию через `initialSession` и `resume: true`.
- После создания сессии обновлять URL, не размонтируя активный стрим.
- Рендерить текст, reasoning, инструменты, файлы и HITL. Reasoning свёрнут в строку «Размышление», полный текст по клику.
- У каждого вида вызова своя стилизованная карточка: правка файла показывает diff, команды — терминал, озвучка — текст и плеер. Сырые названия и аргументы инструментов не показывать. Для остальных вызовов подпись брать из `part.toolMetadata?.eve?.label`.
- Агент встраивает файлы в ответ Markdown-ссылкой на путь в песочнице. Ссылку без схемы приложение распознаёт как файл песочницы; сервер копирует файл в S3 при завершении сообщения, поэтому старые сообщения работают без песочницы.
- Видео и аудио — плеер (`<video controls>`, `<audio controls>`), изображения — `<img>`, остальные файлы — ссылка на скачивание; нативные элементы допустимы только как содержимое компонентов.
- Две полноценные раскладки, для компьютера и для телефона; светлая и тёмная темы.
- Весь интерфейс собирается только из компонентов shadcn/ui и его реестров (`@watermelon`, `@react-bits`, другие из каталога shadcn). Собственные CSS-стили и голый HTML вместо компонента не писать; компоненты компонуются утилитами Tailwind и токенами темы. Для чата навыки `ai-elements` и `streamdown` из `.agents/skills/`.
- Ожидающие вопросы и подтверждения — через `openConversationInputs(agent.data)` и `agent.respond()`.

## Авторизация

- Eve channel закрыт по умолчанию; для production-браузера нужен `agent/channels/eve.ts` с AuthFn.
- Telegram Login по OIDC: Authorization Code Flow + PKCE, `state`, `nonce`.
- `id_token` проверять на сервере по JWKS: `iss`, `aud`, `exp`.
- Сессия — HttpOnly, Secure, SameSite=Lax cookie.
- Next.js принимает callback и ставит cookie; eve channel проверяет ту же сессию.
- `localDev()` — только локально; `placeholderAuth()` не должен пускать production.
- COOP должен разрешать попапы Telegram.
- Не доверять callback без серверной проверки.
- Секреты хранить только в `.env*`; в клиентский бандл они не попадают.

## Агент

- Модель и reasoning читаются из окружения в `agent/agent.ts` на старте сессии (динамическое определение, обычная строка с `process.env` запечётся при сборке); пользователь их не выбирает.
- Инструкции, инструменты, навыки и субагенты живут в `agent/`.
- Навыки в `agent/skills/` ставить из официальных источников (https://www.remotion.dev/docs/ai/skills, https://skills.sh) командой `npx skills add`, а не копировать из локальных каталогов.
- Daytona — authored-провайдер песочницы; своя песочница у агента и сессии.
- Файлы пользователя — напрямую в S3 по presigned URL; тип файла не ограничен.
- S3 — любой S3-совместимый провайдер, Node-совместимый клиент.
- Postgres — внешний; схема и миграции в репозитории; Node-совместимый клиент.
- Видео — Remotion в песочнице. Образ минимальный: Node, Remotion и Chromium; остальное агент ставит сам из PyPI и npm.
- Озвучка — серверный инструмент на Edge TTS (MP3/WebM и word boundaries для субтитров); при отказе агент сам ставит Piper.
- Поиск в вебе и скачивание видео — серверные инструменты, а не песочница.
- Готовое видео — в S3; ссылка на просмотр и скачивание временная, создаётся заново при открытии страницы, доступ только владельцу.
- Песочница по умолчанию 2 vCPU и 4 ГБ: на 2 ГБ рендер Remotion падает по памяти. Ресурсы Daytona задаются только при создании из образа, не из готового снапшота; в CLI `--memory` в гигабайтах.
- Число потоков (ONNX Runtime у Piper, параллельность рендера) равно числу vCPU песочницы: по умолчанию ONNX Runtime берёт потоки по числу ядер хоста и работает в 10–15 раз медленнее (замер).
- На тарифах Tier 1 и 2 песочница ходит только по белому списку (PyPI, npm, GitHub, Hugging Face).

## Правила разработки

- Перед изменениями читать `node_modules/eve/docs/README.md` и нужные страницы.
- Использовать нативные команды eve.
- Не патчить `node_modules/eve` и не добавлять обходы вместо чтения документации.
- Браузерный код держать вне `agent/`.
- Авторизацию проверять только на сервере.
- Не добавлять npm-скрипты, которые просто переименовывают нативную команду eve.
- Параметры инфраструктуры (URL базы и S3, адреса провайдеров, имя модели, пути к бинарникам) читать из окружения и перечислять в образце переменных; провайдеров в коде не зашивать.
- Переменные окружения проекта читает только модуль конфигурации `lib/config.ts` (`process.env` в другом коде не трогать, кроме `NODE_ENV`, `PORT`, `EVE_*`; тестовая обвязка лишь передаёт окружение дочернему процессу). Любой тикет, вводящий переменную, добавляет её в схему этого модуля, в `.env.example` и, если без неё сервер перестанет стартовать в тестах, в `.env.test`.
- Весь фронтенд делать только через shadcn и его реестры (раздел shadcn/ui), сначала изучив `docs` и `search`; собственных стилей и голого HTML/CSS не писать.
- Одноразовые Python-скрипты запускать через `uv run`.

## База данных

Postgres, Drizzle ORM + drizzle-kit, драйвер `postgres` (postgres.js). Схема — в коде (`lib/db/schema.ts`), миграции — SQL-файлы в репозитории (`drizzle/`); их создаёт `npm run db:generate`, применяет `npm run db:migrate`.

Соглашения по схеме:

- таблицы — во множественном числе в `snake_case`;
- первичные ключи — uuid;
- время — `timestamptz`;
- у каждой таблицы с данными пользователя есть внешний ключ на `users(id)` или на будущую `app_sessions(id)` с `ON DELETE CASCADE`.

## Хранилище S3

Любой S3-совместимый провайдер, клиент — `lib/s3.ts`, настраивается переменными `S3_*`. Формат ключей объектов:

```text
u/<user_id>/s/<app_session_id>/<вид>/<uuid>/<имя файла>
```

`вид` — `uploads`, `tool-media`, `message-files`, `preview`. Удаление сессии или пользователя — это удаление по префиксу.

## HTTP-тесты

Команда `npm run test:http` (конфигурация `vitest.http.config.ts`, файлы — `tests/http/**/*.test.ts`) запускает настоящее приложение и ходит в него по HTTP. Глобальная подготовка (`tests/http/global-setup.ts`) создаёт базу `*_test`, бакет, применяет миграции и поднимает основной экземпляр; вспомогательные средства — в `tests/http/support/`.

| Средство | Поведение |
| --- | --- |
| `startApp(options?)` | `options`: `env` (переопределения окружения; `undefined` удаляет переменную), `port`, `expectExit` (ждать завершения процесса вместо готовности), `readyTimeoutMs` (предел ожидания готовности или завершения, по умолчанию 240000), `logFile` (дописывать вывод в файл — это делает глобальная подготовка). Запускает `next dev` с окружением `.env.test` плюс `env`, свободным портом и своим `NEXT_DIST_DIR`; ждёт ответа `GET /api/health` (`200` у здорового приложения, `503` тоже означает, что сервер поднялся — для тестов деградации). Если ожидание не удалось, останавливает процесс и выбрасывает ошибку. Возвращает `AppHandle` |
| `AppHandle` | `url`, `port`, `stop()`, `output()` (накопленный вывод процесса: проверять, что секретов там нет), `exited` (промис кода завершения) |
| `inject('appUrl')` | адрес основного экземпляра, запущенного глобальной подготовкой (механизм `provide`/`inject` у Vitest) |
| `fetchApp(path, init?)` | `fetch` к основному экземпляру; `path` относителен `appUrl`; редиректы не выполняются (`redirect: "manual"`) |
| `appOutput()` | весь вывод (stdout и stderr) основного экземпляра за время тестов, включая строки eve с префиксом `[eve:dev]`, которые `withEve()` перепечатывает в вывод родителя; глобальная подготовка пишет его в файл `.tmp/http-test-app.log` (каталог `.tmp/` в `.gitignore`), помощник читает файл. Нужен, чтобы тесты проверяли отсутствие секретов в журнале |
| `db()` | клиент Drizzle к тестовой базе (клиент приложения, один пул на процесс воркера; после файла закрывается) |
| `resetDatabase()` | `TRUNCATE … CASCADE` всех таблиц схемы `public`, кроме служебных таблиц drizzle; вызывается автоматически перед каждым тестовым файлом (`setupFiles`) |
| `createUser(overrides?)` | вставляет строку `users` (по умолчанию уникальные `telegram_id` и `name`, оба флага false) и возвращает её |
| `s3()` | клиент тестового бакета для проверок: `getBytes(key)`, `exists(key)`, `listKeys(prefix)`, `put(key, bytes, contentType)`, `deletePrefix(prefix)`; бакет очищается тем же вызовом перед каждым файлом |

Тесты идут последовательно (`fileParallelism: false`): `resetDatabase()` перед каждым файлом несовместим с параллельными файлами. Таймаут хука глобальной подготовки — 240 с (холодный старт `next dev` вместе с eve), таймаут обычного теста — 30 с.

## Порты

| Порт | Назначение |
| --- | --- |
| 3100 | основной экземпляр приложения в HTTP-тестах (`TEST_APP_PORT`) |
| 3100–3199 | дополнительные экземпляры приложения (`TEST_APP_PORT`…`TEST_APP_PORT+99`) |
| 55432 | Postgres из `compose.yaml` |
| 59000 | хранилище S3 из `compose.yaml` |
| 59100–59299 | заглушки внешних сервисов в HTTP-тестах |

## Проверка

Достаточно самой узкой проверки, которая подтверждает изменённое поведение:

- `npm run typecheck`
- `npm run dev` — страница и `/eve/v1/health` через прокси Next.js
- `eve info`
- `eve build`
- `next build`
- `next start`

Тесты — финальная проверка, а не способ отладки: сначала выяснить причину, затем один прогон. Два шва: HTTP-поверхность запущенного приложения (маршруты eve и приложения, модель подменена `mockModel`, инструменты заглушены, настоящие тестовые Postgres и S3) и отрисовка беседы по записанному состоянию сообщений.

## Документация

- eve — https://eve.dev/docs
- Daytona — https://www.daytona.io/docs/
- Next.js — https://nextjs.org/docs
- Base UI — https://base-ui.com
- shadcn/ui — https://ui.shadcn.com/docs (в проекте: `npx shadcn@latest docs <компонент>`)
- Watermelon UI — https://ui.watermelon.sh (реестр `@watermelon`)
- React Bits — https://reactbits.dev (реестр `@react-bits`)
- Remotion — https://www.remotion.dev/docs, навыки — https://www.remotion.dev/docs/ai/skills
- Каталог навыков — https://skills.sh

## Навыки агента

### Трекер задач

Задачи и спецификации живут в GitHub Issues репозитория `42-Z/42-ai-studio`; использовать `gh` CLI. См. `docs/agents/issue-tracker.md`.

### Метки triage

Пять стандартных ролей: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. См. `docs/agents/triage-labels.md`.

### Доменные документы

Один контекст: `GLOSSARY.md` в корне и `docs/adr/`. См. `docs/agents/domain.md`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
