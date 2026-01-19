# Commit Generater

AI-powered Git commit message generator for VS Code. Uses OpenAI-compatible APIs to automatically generate professional commit messages following Conventional Commits format.

## Features

- **One-Click Generation**: Click the button in Source Control panel to generate commit messages instantly
- **Conventional Commits**: Automatically follows `<type>(<scope>): <description>` format
- **OpenAI Compatible**: Works with OpenAI, Azure OpenAI, and any OpenAI-compatible API
- **Multi-language**: Supports English and Chinese commit messages
- **Model Selection**: Fetch and select models from your API provider

## Usage

1. Make changes to your code
2. Open the Source Control panel (`Ctrl+Shift+G`)
3. Click the chat bubble icon in the title bar
4. The generated commit message will be filled in automatically

## Configuration

Run `Commit Generater: Setup Wizard` command for guided setup, or configure manually:

| Setting | Description | Default |
|---------|-------------|---------|
| `commitGenerater.apiBaseUrl` | OpenAI-compatible API base URL | `https://api.openai.com/v1` |
| `commitGenerater.apiKey` | Your API key | - |
| `commitGenerater.model` | Model name | `gpt-5` |
| `commitGenerater.language` | Commit message language (`en` / `zh`) | `zh` |
| `commitGenerater.maxDiffLength` | Maximum diff length sent to AI | `65536` |

## Commands

- `Commit Generater: Generate Commit Message` - Generate commit message from current changes
- `Commit Generater: Select AI Model` - Fetch available models and select one
- `Commit Generater: Setup Wizard` - Guided configuration setup

## Requirements

- VS Code 1.85.0 or higher
- Git extension enabled
- OpenAI-compatible API access

## License

MIT
