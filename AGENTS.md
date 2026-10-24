# 42 AI Studio

Сайт для создания видео с помощью ИИ. Пользователь ставит задачу, агент-видеограф собирает Remotion-композицию, озвучивает, рендерит и отдаёт готовый ролик. Интерфейс и видео поддерживают русский язык.

## Архитектура

Один root-агент eve и Next.js-приложение в одном корневом пакете. Next.js смонтирован с агентом через `withEve()` из `eve/next`.

```text
42-ai-studio/
├── package.json
├── package-lock.json
├── next.config.ts
├── tsconfig.json
├── app/                    # Next.js App Router
├── components/
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
- Base UI — примитивы без стилей

## Команды

```sh
npm run dev        # next dev; withEve поднимает eve
npm run build      # eve build && next build
npm start          # next start
npm run typecheck  # tsc --noEmit
```

Нативные команды eve: `eve dev`, `eve build`, `eve start`, `eve info`, `eve eval`, `eve deploy`.

## Интеграция

`withEve()` в `next.config.ts` монтирует агент в Next.js. Браузер работает same-origin; `useEveAgent()` не должен получать `host`, пока фронтенд и агент не разнесены осознанно.

## Фронтенд

- `useEveAgent()` из `eve/react` в клиентских компонентах.
- Маршруты: `/`, `/s`, `/s/[sessionId]`.
- `/s/[sessionId]` восстанавливает durable-сессию через `initialSession` и `resume: true`.
- После создания сессии обновлять URL, не размонтируя активный стрим.
- Рендерить текст, reasoning, инструменты, файлы и HITL.
- Подпись инструмента брать из `part.toolMetadata?.eve?.label`.
- Видео — `<video controls>`, изображения — `<img>`, остальные файлы — ссылка на скачивание.
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

- `agent/agent.ts` задаёт модель и reasoning; пользователь их не выбирает.
- Инструкции, инструменты, навыки и субагенты живут в `agent/`.
- Daytona — authored-провайдер песочницы; своя песочница у агента и сессии.
- Файлы пользователя — напрямую в S3 по presigned URL; тип файла не ограничен.
- S3 — любой S3-совместимый провайдер, Node-совместимый клиент.
- Postgres — внешний; схема и миграции в репозитории; Node-совместимый клиент.
- Видео — Remotion в песочнице; Chromium и ffmpeg в образе.
- Озвучка — Edge TTS; MP3/WebM и word boundaries для субтитров.
- Готовое видео — в S3; фронтенд получает ссылку на просмотр и скачивание.

## Правила разработки

- Перед изменениями читать `node_modules/eve/docs/README.md` и нужные страницы.
- Использовать нативные команды eve.
- Не патчить `node_modules/eve` и не добавлять обходы вместо чтения документации.
- Браузерный код держать вне `agent/`.
- Авторизацию проверять только на сервере.
- Не добавлять npm-скрипты, которые просто переименовывают нативную команду eve.

## Проверка

Достаточно самой узкой проверки, которая подтверждает изменённое поведение:

- `npm run typecheck`
- `npm run dev` — страница и `/eve/v1/health` через прокси Next.js
- `eve info`
- `eve build`
- `next build`
- `next start`

## Документация

- eve — https://eve.dev/docs
- Daytona — https://www.daytona.io/docs/
- Next.js — https://nextjs.org/docs
- Base UI — https://base-ui.com

## Навыки агента

### Трекер задач

Задачи и спецификации живут в GitHub Issues репозитория `42-Z/42-ai-studio`; использовать `gh` CLI. См. `docs/agents/issue-tracker.md`.

### Метки triage

Пять стандартных ролей: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. См. `docs/agents/triage-labels.md`.

### Доменные документы

Один контекст: `GLOSSARY.md` в корне и `docs/adr/`. См. `docs/agents/domain.md`.
