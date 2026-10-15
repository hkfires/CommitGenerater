# Commit Generater

AI-powered Git commit message generator for VS Code. Uses OpenAI-compatible APIs to automatically generate professional commit messages following Conventional Commits format.

## Features

- **One-Click Generation**: Click the button in Source Control panel to generate commit messages instantly
- **Conventional Commits**: Automatically follows `<type>(<scope>): <description>` format
- **OpenAI Compatible**: Works with OpenAI, Azure OpenAI, and any OpenAI-compatible API
- **Multi-language**: Supports English and Chinese commit messages; `auto` mode follows the language of your recent commits
- **Project Guidelines**: Automatically reads `AGENTS.md` from the repository root and follows its commit conventions
- **Model Selection**: Fetch models from `{apiBaseUrl}/models` and pick one, or type any model name manually
- **Reasoning Effort**: Configure `reasoning_effort` for reasoning models
- **Quick Settings**: Configure the extension from the bottom-right status bar

## Usage

1. Make changes to your code
2. Open the Source Control panel (`Ctrl+Shift+G`)
3. Click the chat bubble icon in the title bar
4. The generated commit message will be filled in automatically

## Configuration

All settings are user-level only. Run `Commit Generater: Setup Wizard` for guided setup, or configure manually:

| Setting | Description | Default |
|---------|-------------|---------|
| `commitGenerater.apiBaseUrl` | OpenAI-compatible API base URL | `https://api.openai.com/v1` |
| `commitGenerater.apiKey` | Your API key | - |
| `commitGenerater.model` | Model name (pick from `/models` or type manually) | `gpt-5` |
| `commitGenerater.reasoningEffort` | `default` / `none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max` | `default` |
| `commitGenerater.language` | Commit language: `auto` (follow commit history), `en`, or `zh` | `auto` |
| `commitGenerater.includeAgentsMd` | Include `AGENTS.md` from the repository root in the prompt | `true` |
| `commitGenerater.maxDiffLength` | Maximum diff length sent to AI | `131072` |

## Commands

- `Commit Generater: Generate Commit Message` - Generate commit message from current changes
- `Commit Generater: Select AI Model` - Fetch available models and select one, or type a model name manually
- `Commit Generater: Select Reasoning Effort` - Choose the reasoning effort
- `Commit Generater: Settings` - Quick settings menu (also available from the status bar item)
- `Commit Generater: Setup Wizard` - Guided configuration setup

## Requirements

- VS Code 1.85.0 or higher
- Git extension enabled
- OpenAI-compatible API access

## License

MIT
