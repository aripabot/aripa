<h1 align="center">Aripa</h1>

<p align = "center">A powerful, open-source agentic Discord bot designed to help you securely and efficiently manage your community.</p>

---

<p align="center">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green.svg" />
  <img alt="Bun" src="https://img.shields.io/badge/powered%20by-Bun-blueviolet?logo=bun" />
  <img alt="Discord.js" src="https://img.shields.io/badge/discord.js-14.x-blue?logo=discord" />
  <img alt="Agent Friendly" src="https://img.shields.io/badge/agent-friendly-ff69b4.svg" />
</p>

---

## Links

- Marketing site: [aripa.app](https://aripa.app)
- Documentation: [docs.aripa.app](https://docs.aripa.app)

## Install

1. Go to the [latest release](https://github.com/aripabot/aripa/releases/latest).
2. Download the latest version and extract it.
3. Install dependencies:

```bash
bun install
```

4. Create or update your config:

```bash
bun run onboard
```

5. Start Aripa with your Discord bot token:

```bash
TOKEN="your-discord-bot-token" bun run start
```

For development with automatic reloads:

```bash
TOKEN="your-discord-bot-token" bun run dev
```

## Configuration

`bun run onboard` opens the setup wizard for `config.json`. It configures the bot name, style prompt, allowlisted Discord servers, AI model providers, web search, and agent rate limits.

Common environment variables:

- `TOKEN`: required Discord bot token.
- `PREFIX`: text action prefix, defaults to `-`.
- `DATABASE_PATH`: SQLite database path, defaults to `aripa.sqlite`.
- `CONFIG_PATH`: config file path, defaults to `config.json`.
- `OPENAI_API_KEY`: used for OpenAI models.
- `OPENROUTER_API_KEY`: used for OpenRouter models.
- `AI_GATEWAY_API_KEY`: used for Vercel AI Gateway models.
- `GOOGLE_GENERATIVE_AI_API_KEY`: used for Gemini web-search features.

## AI Cost Note

Aripa can call AI model providers when agents, summaries, or web-search features are enabled. Those requests may cost the developer or operator running the bot, depending on the provider, model, and API key used.
