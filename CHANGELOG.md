# Changelog

All notable changes to this project will be documented in this file.

## [0.0.3] - 2026-01-19

### Changed

- Updated configuration descriptions to English
- Switched default commit message language to English (`commitGenerater.language`: `en`)

## [0.0.2] - 2025-01-19

### Changed

- **Improved prompt template**: Enhanced prompt with detailed Conventional Commits guidelines
  - Added comprehensive type descriptions (feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert)
  - Added scope guidelines with common examples
  - Added description rules (imperative mood, 50 char limit)
  - Added body and footer guidelines
  - Improved diff formatting with code blocks

### Added

- **Lock file exclusion**: Automatically filter out lock files from diff analysis
  - Supports 60+ lock file patterns across multiple languages (JavaScript, Python, Rust, Go, Ruby, PHP, etc.)
  - Excludes common build directories (node_modules, dist, build, vendor, etc.)
  - Prevents large lock files from consuming context window

## [0.0.1] - 2025-01-18

### Added

- Initial release
- AI-powered commit message generation using OpenAI-compatible APIs
- Support for Conventional Commits format
- Multi-language support (English and Chinese)
- Setup wizard for first-time configuration
- Model selection from API provider
- Support for new repositories without commit history
