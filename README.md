# Хроники Пепла

Онлайн-RPG в браузере: ИИ-мастер ведёт тёмно-фэнтезийное приключение на русском, игрок пишет что угодно, исход решают кубики.

## Быстрый старт

```bash
cp .env.example .env        # ключи можно не заполнять — будет фейковая модель
pnpm install
pnpm db:up && pnpm db:migrate
pnpm dev                    # http://localhost:3000
```

Нужны Node.js 22+, pnpm 10+ и Docker (для PostgreSQL и Redis).

## Структура

| Папка | Что внутри |
|---|---|
| `apps/web` | Next.js: интерфейс и API |
| `packages/engine` | Правила игры: кубики, персонаж, проверки, бой, карта |
| `packages/llm` | Модели: OpenRouter, промпты мастера, разбор ответа, цикл хода |
| `packages/db` | PostgreSQL + Drizzle: схема и миграции |
| `tools` | Проверка ключей API, слепое сравнение моделей |
| `docs` | Описание мира и визуального стиля |

Подробные правила разработки — в [CLAUDE.md](CLAUDE.md).

## Слепой тест рассказчиков

```bash
pnpm check:apis
pnpm arena:run -- anthropic/claude-sonnet-5.5 deepseek/deepseek-v4.1-flash google/gemini-3.8-flash
pnpm arena:ballot tools/arena/out/run-<дата>.json   # открыть получившийся .html в браузере
```

Точные id моделей смотри на openrouter.ai/models — `check:apis` подскажет похожие, если id неверный.
