# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian vault used for plugin development. The actual plugin code is located at `.obsidian/plugins/obsidian-sample-plugin/`.

- **Target**: Obsidian Community Plugin (TypeScript → bundled JavaScript)
- **Entry point**: `src/main.ts` compiled to `main.js`
- **Release artifacts**: `main.js`, `manifest.json`, optional `styles.css`

## Commands

All commands run from `.obsidian/plugins/obsidian-sample-plugin/`:

```bash
npm install          # Install dependencies
npm run dev          # Watch mode - compiles on file changes in src/
npm run build        # Production build with type checking
npm run lint         # Run ESLint
```

## Architecture

```
.obsidian/plugins/obsidian-sample-plugin/
├── src/
│   ├── main.ts      # Plugin entry point, lifecycle (onload/onunload), commands
│   └── settings.ts  # Settings interface, defaults, and settings tab UI
├── esbuild.config.mjs  # Build configuration (watches src/ directory)
├── manifest.json    # Plugin metadata (id, version, minAppVersion)
└── main.js          # Generated output (do not edit)
```

## Key Patterns

- **Plugin lifecycle**: Extend `Plugin` class, implement `onload()` and `onunload()`
- **Settings persistence**: Use `this.loadData()` / `this.saveData()`
- **Safe cleanup**: Use `this.registerEvent()`, `this.registerDomEvent()`, `this.registerInterval()` for automatic cleanup on unload
- **Commands**: Add via `this.addCommand()` with stable IDs (never rename after release)

## External Dependencies

These packages are provided by Obsidian at runtime and should NOT be bundled:
- `obsidian`, `electron`
- `@codemirror/*` packages
- `@lezer/*` packages
- Node.js builtins

## Testing

1. Build with `npm run build` or `npm run dev`
2. Reload Obsidian (Ctrl/Cmd + R)
3. Enable plugin in **Settings → Community plugins**

## Manifest Rules

- Never change `id` after release
- Keep `minAppVersion` accurate when using newer APIs
- Use SemVer for `version` (x.y.z)
