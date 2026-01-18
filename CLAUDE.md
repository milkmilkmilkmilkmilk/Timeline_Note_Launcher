# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian community plugin called "Timeline Note Launcher". It's a TypeScript project that compiles to a bundled JavaScript file (`main.js`) loaded by Obsidian.

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development mode with file watching (watches src/ only)
npm run build        # Production build (runs tsc type-check, then esbuild)
npm run lint         # Run ESLint
```

## Architecture

- **Entry point**: `src/main.ts` → bundled to `main.js`
- **Bundler**: esbuild (configured in `esbuild.config.mjs`)
- **Source directory**: `src/`
- **Release artifacts**: `main.js`, `manifest.json`, `styles.css` (optional)

### Current Source Structure

- `src/main.ts` - Plugin class (`HelloWorldPlugin`), commands, modal UI, event registrations
- `src/settings.ts` - Settings interface (`MyPluginSettings`), defaults, and settings tab (`SampleSettingTab`)

## Key Development Notes

- The esbuild config marks `obsidian`, `electron`, and CodeMirror packages as external (provided by Obsidian at runtime)
- TypeScript strict mode options are enabled in `tsconfig.json`
- ESLint uses the `eslint-plugin-obsidianmd` plugin for Obsidian-specific rules
- Plugin ID in `manifest.json` must match the folder name for local development

## Obsidian Plugin Patterns

- Use `this.register*` methods for cleanup-safe event listeners and intervals
- Persist settings via `this.loadData()` / `this.saveData()`
- Add commands with stable IDs (don't rename after release)
- Keep `isDesktopOnly: false` in manifest unless using desktop-only APIs
