# Трекер задач: GitHub

Задачи и спецификации этого репозитория живут в GitHub Issues. Для всех операций использовать `gh` CLI.

## Соглашения

- **Создать задачу**: `gh issue create --title "..." --body "..."`. Для многострочного тела использовать heredoc.
- **Прочитать задачу**: `gh issue view <number> --json number,title,body,labels,comments`.
- **Список задач**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` с нужными фильтрами `--label` и `--state`.
- **Сделать задачу подзадачей родительской**: `gh issue create --parent <parent> ...` или `gh issue edit <parent> --add-sub-issue <child>` позже (`gh` 2.94+). Для старого `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, как в разделе **Блокировки**). Если подзадачи недоступны, добавить `Part of #<parent>` в начало тела дочерней задачи.
- **Комментировать задачу**: `gh issue comment <number> --body "..."`
- **Добавить / снять метки**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Закрыть**: `gh issue close <number> --comment "..."`

Репозиторий определяется из `git remote -v`; `gh` делает это автоматически внутри клона.

## PR как поверхность triage

**PRs as a request surface: no.** _(PR как поверхность запросов: нет. Поставить `yes`, если этот репозиторий рассматривает внешние PR как запросы на фичи; `/triage` читает этот флаг.)_

Если флаг `yes`, PR проходят те же метки и состояния, что и задачи, через команды `gh pr`:

- **Прочитать PR**: `gh pr view <number> --comments` и `gh pr diff <number>` для диффа.
- **Список внешних PR для triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Комментировать / поставить метку / закрыть**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

В GitHub у задач и PR общее пространство номеров, поэтому голый `#42` может быть и тем и другим: проверить через `gh pr view 42` и при неудаче через `gh issue view 42`.

## Когда скилл говорит «опубликовать в трекере»

Создать GitHub issue.

## Когда скилл говорит «получить нужную задачу»

Прочитать её, как в разделе **Прочитать задачу** выше.

## Операции wayfinder

Используются `/wayfinder`. **Карта** — это одна issue с **дочерними** issue как тикетами.

- **Карта**: одна issue с меткой `wayfinder:map`, содержащая тело Notes / Decisions-so-far / Fog. `gh issue create --label wayfinder:map`.
- **Дочерний тикет**: issue, привязанная к карте как GitHub sub-issue (см. **Сделать задачу подзадачей родительской**). Где sub-issues недоступны, добавить дочернюю задачу в task list в теле карты и указать `Part of #<map>` в начале тела дочерней задачи. Метки: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). После взятия тикет назначается на ведущего разработчика.
- **Блокировки**: **нативные зависимости GitHub issues**, каноническое, видимое в UI представление. Добавить ребро через `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, где `<blocker-db-id>` — числовой **database id** блокера (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _не_ `#number` и не `node_id`). GitHub показывает `issue_dependencies_summary.blocked_by` (только открытые блокеры, живой гейт). Где зависимости недоступны, добавить строку `Blocked by: #<n>, #<n>` в начало тела дочерней задачи. Тикет разблокирован, когда все блокеры закрыты.
- **Frontier query**: получить открытые дочерние задачи карты (`gh issue list --state open`, в рамках sub-issues / task list карты), отбросить те, у кого есть открытый блокер (`issue_dependencies_summary.blocked_by > 0` или открытая issue в строке `Blocked by`) или assignee; первый в порядке карты побеждает.
- **Взять**: `gh issue edit <n> --add-assignee @me`, первая запись сессии.
- **Завершить**: `gh issue comment <n> --body "<answer>"`, затем `gh issue close <n>`, затем добавить указатель контекста (gist + ссылка) в Decisions-so-far карты.
