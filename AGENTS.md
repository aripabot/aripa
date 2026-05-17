Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun run test` to run the Vitest test suite
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use Vitest for tests. Run the suite with `bun run test`.

- Place test files under the top-level `tests/` directory, not inside `src/`.
- Mirror the `src/` directory structure inside `tests/` when organizing tests.
- Do not colocate new `*.test.ts` files with source files in `src/`.

```ts#index.test.ts
import { test, expect } from "vitest";

test("hello world", () => {
  expect(1).toBe(1);
});
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Project Context

Aripa is an agentic Discord moderation bot built on Bun, TypeScript, Discord.js v14, the Vercel AI SDK, Vitest, and SQLite via `bun:sqlite`. The production entry point is `src/index.ts`; the repository-root `index.ts` only imports it.

At startup, `src/index.ts`:

- Loads every action from `src/actions/**` with `loadActions()`.
- Loads runtime config from `config.json` or `CONFIG_PATH`, with defaults from `src/config/runtime-config.ts`.
- Creates one Discord.js client with guild, DM, message, reaction, and message-content intents.
- Starts the mute scheduler.
- Handles each message first as an agent mention, then as a normal prefixed action if the agent ignored it.

Important environment/config values:

- `TOKEN` is required to run the bot.
- `PREFIX` defaults to `-`.
- `DATABASE_PATH` defaults to `aripa.sqlite`.
- `CONFIG_PATH` defaults to `config.json`.
- `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY` are consumed according to selected model providers.
- `bun run onboard` writes runtime config through the onboarding flow.

## Code Layout

- `src/actions/` contains user-visible bot actions grouped by domain: `admin`, `general`, `moderation`, and `utilities`.
- `src/bot/` contains the shared action interface, action loader, message router, action context, and agent confirmation flow.
- `src/agent/` contains AI model resolution, prompt loading, mention handling, rate limiting, and AI SDK tools.
- `src/agent/prompts/` contains the system prompt pieces and style prompts loaded at runtime.
- `src/commands/` contains tokenization, route matching, argument resolvers, and command overrides.
- `src/config/` contains runtime JSON config parsing, onboarding write helpers, logging, and persistent guild config storage.
- `src/moderation/` contains shared moderation helpers, mod-log delivery, active mute persistence, mute scheduling, and result utilities.
- `tests/` mirrors `src/` and should remain the home for all new test files.

Use the `@/` import alias for source imports. Include `.ts` extensions on local TypeScript imports, matching the existing style.

## Action System

Actions implement the `Action` interface from `src/bot/action.ts` and usually export a default object that `satisfies Action`.

Action files are auto-loaded from `src/actions/**` by `src/bot/action-loader.ts`. The loader skips `.d.ts`, `.test.*`, and files whose basename starts with `_`. Action names and aliases are case-insensitive, and duplicates are skipped with a log warning.

Normal prefixed commands and agent-triggered actions both go through `handleMessage()` in `src/bot/message-router.ts`. Keep behavior in the router or shared action helpers when it must apply to both paths.

Action conventions:

- Set `requiredUserPermissions` for privileged actions. Agent calls to actions with required permissions require reaction confirmation before execution.
- Use `resolveRequiredUserPermissions` when required permissions depend on arguments.
- Use `context.reply()` for normal replies. In agent mode it records structured `action_reply` JSON for the AI tool result instead of sending directly.
- Use `safeReply()` or `safeReplyWithOptions()` when replying outside `context.reply()`, so `allowedMentions` stays locked down.
- Check `context.message.inGuild()` and `context.message.guildId` before guild-only behavior.
- For embeds in actions, return plain text through `context.reply()` when `context.isAgent` is true so the agent receives useful textual output.

## Agent Runtime

The bot responds as an AI agent when a non-bot guild message mentions the bot user. `handleAgentMention()` builds a recent-message prompt, loads prompt pieces from `src/agent/prompts/`, creates AI SDK tools, and replies with generated text.

Agent tools:

- `run_action` reuses the shared action router in agent mode. It normalizes missing prefixes and returns structured action results.
- `request_context` fetches recent channel history. `xl` returns a summary plus the latest raw messages.
- `search_web` is only included when web search is enabled in config and uses the configured Google web model.

When changing agent behavior, keep the split between prompt files, runtime orchestration, and individual tools. Tests commonly inject `generateAgentText`, prompt loaders, stores, and fake Discord objects instead of calling real providers or Discord.

## Commands And Parsing

Command parsing is intentionally shared and tested:

- `command-tokenizer.ts` handles prefixes, whitespace, single/double quotes, escaping, raw token spans, and raw argument tails.
- `command-resolvers.ts` resolves Discord snowflakes, mentions, durations, counts, reasons, and common flags.
- `command-grammar.ts` supports multi-token command route matching and alias precedence.

Prefer these helpers over ad hoc parsing inside actions. If an action needs a trailing free-form reason, preserve raw user text when possible with existing raw-tail helpers.

## Moderation And Persistence

SQLite state is stored through small synchronous stores using `bun:sqlite`:

- `GuildConfigStore` persists mod-log settings, ban message, mute mode/role, and guild tags.
- `ActiveMuteStore` persists role mutes that need future expiry.

Both stores create/migrate their own tables and expose `reset*ForTests()` helpers for singleton cleanup. In tests, prefer `new GuildConfigStore(":memory:")` or `new ActiveMuteStore(":memory:")`.

Moderation actions should use helpers from `src/moderation/moderation-helpers.ts` for:

- User/member resolution.
- Role hierarchy and bot capability checks.
- Audit-log reason formatting and truncation.
- DM delivery and moderation log embeds.
- `--dry-run` support where existing moderation actions support it.

`MuteScheduler` processes expiring role mutes, retries failures, and reports automatic unmute failures to mod logs when configured.

## Logging And Safety

Use the shared `log` from `src/config/logger.ts` or `context.log`. Prefer structured metadata with guild, channel, message, user, and action IDs. The logger already redacts common token fields.

Avoid accidental mentions in bot output. Existing reply helpers set `allowedMentions` to empty arrays; keep that behavior for new send paths unless there is a deliberate, reviewed reason to mention users or roles.

## Testing Expectations

Use Vitest and Bun:

- Full suite: `bun run test`
- Watch mode: `bun run test:watch`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Format: `bun run format`

After each agent run, run both `bun run lint` and `bun run format` before handing work back unless the user explicitly asks not to modify formatting.

Tests should stay under `tests/`, mirroring `src/`. Prefer dependency injection and fake Discord objects over network calls or real Discord clients. Existing tests often assert exact reply strings and structured agent tool results, so update tests alongside user-facing behavior changes.
