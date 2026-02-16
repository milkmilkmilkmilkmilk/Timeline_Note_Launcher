# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Timeline Note Launcher is an Obsidian community plugin that provides a Twitter-like timeline view for reviewing notes. It features multiple selection modes (Random, Age Priority, SRS with SM-2 algorithm), multi-file type support (Markdown, images, PDF, audio, video), and keyboard-driven navigation.

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Development mode with file watching (watches src/ only)
npm run build        # Production build (tsc type-check + esbuild minified)
npm run lint         # Run ESLint with obsidianmd plugin rules
```

CI runs `npm run build` and `npm run lint` on Node 20.x and 22.x (`.github/workflows/lint.yml`). No automated test suite exists; testing is manual in Obsidian.

**Before committing**: Always run `npm run lint` to catch unused imports, type mismatches, and ESLint rule violations early.

### Running builds in Claude Code environment

Claude Code's Git Bash environment may not have Node.js in PATH by default. Use the provided wrapper scripts:

```bash
./build.sh              # Run production build (auto-detects Node.js)
./npm.sh <command>      # Run any npm command (e.g., ./npm.sh run dev, ./npm.sh run lint)
```

These scripts automatically add Node.js to PATH if installed in the default Windows location (`C:\Program Files\nodejs`).

### Development Workflow Tools

**Git Hooks:**
- Pre-commit hook (`.claude/hooks/pre-commit`): Runs `npm run lint` before commits
  - Install: `cp .claude/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`
  - Bypass: `git commit --no-verify` (use sparingly)

**Claude Skills (shortcuts for common workflows):**
- `/lint-fix` - Run ESLint with `--fix` to auto-correct common issues
- `/build-validate` - Full CI validation locally (build + lint, matches .github/workflows/lint.yml)
- `/check-types` - Fast TypeScript type-check only (no build output)

## Architecture

### Core Files

```
src/
├── main.ts            # Plugin entry point, lifecycle, command registration, caching layer
├── types.ts           # All interfaces, types, defaults, and PluginData schema
├── timelineView.ts    # Main UI view (ItemView subclass), orchestrates rendering
├── dataLayer.ts       # File enumeration, card creation, SRS calculations, statistics
├── selectionEngine.ts # Card selection/sorting algorithms (random, age-priority, srs)
├── srsEngine.ts       # SM-2 spaced repetition algorithm implementation
├── settings.ts        # Settings tab UI with statistics dashboard
├── settingSections.ts # Modular settings section builders (extracted from settings.ts)
├── statistics.ts      # Review statistics and history logic (extracted from dataLayer.ts)
├── noteAnnotation.ts  # Note annotation logic (extracted from dataLayer.ts)
├── timelineViewUtils.ts # Utility functions (extracted from timelineView.ts)
└── dataMerge.ts       # Conflict resolution for concurrent data.json saves
```

### Modular Rendering Components

Rendering logic has been extracted from `timelineView.ts` into specialized modules:

- `cardRenderer.ts`: Card DOM generation, action buttons, context menus
- `embedRenderers.ts`: Excalidraw, Canvas, PDF embeds (deferred activation via iframe with `navpanes=0`)
- `contentPreview.ts`: Markdown preview rendering with line limits
- `notebookParser.ts`: Jupyter notebook (.ipynb) parsing and rendering

### UI Modules

- `filterBar.ts`: Search, file type, tag, date filters with preset save/load
- `keyboardNav.ts`: Keyboard shortcut handling (j/k navigation, rating hotkeys)
- `pullToRefresh.ts`: Mobile pull-to-refresh gesture
- `commentModal.ts`, `quoteNoteModal.ts`, `linkNoteModal.ts`: Note annotation modals
- `quickNoteModal.ts`: Compose and create new notes from the timeline
- `textInputModal.ts`: Generic text input modal base class

### Data Flow (Two-Phase Card Pipeline)

Selection operates on lightweight candidates to avoid unnecessary file I/O:

1. `enumerateTargetNotes()` filters vault files by folder/tag/exclude settings → `TFile[]`
2. `createCandidateCard()` builds lightweight cards (sync, no file reads) → `CandidateCard[]`
3. `selectCards()` applies selection mode algorithm with `maxCards` limit → `SelectionResult`
4. `createTimelineCard()` fetches full content for selected cards only (async) → `TimelineCard[]`
5. `TimelineView` orchestrates rendering, delegates to `cardRenderer.ts`
6. `cardRenderer` creates DOM, queues embeds (PDF/Excalidraw/Canvas) for deferred activation
7. `activatePendingEmbeds()` from `embedRenderers.ts` activates visible embeds post-DOM-insertion
8. Rating buttons trigger `rateCard()` → `updateReviewLogWithSRS()` (from `srsEngine.ts`) → save

### Rendering Optimizations

- **Differential rendering**: Skips DOM rebuild if card paths are unchanged (stat-only updates)
- **Chunk processing**: 5 cards per chunk with `Promise.all()` for parallel creation
- **DOM batching**: DocumentFragment before appendChild
- **Deferred embeds**: PDF/Excalidraw/Canvas embeds are created as placeholders, activated only when DOM-connected
- **Caching layers** (see `main.ts`):
  - Backlink index: 300s TTL (5 minutes)
  - Target files: 300s TTL (5 minutes)
  - Timeline cards: 300s TTL (5 minutes)

### Plugin Data Structure

Persisted in `data.json` (see `PluginData` interface in `types.ts`):
- `settings`: User preferences (selection mode, SRS params, display options, `excludeFolders`, `maxCards`, `imageSizeMode`)
- `reviewLogs`: Per-note SRS state (interval, easeFactor, nextReviewAt)
- `dailyStats`: Today's review counts
- `reviewHistory`: 30-day activity for heatmap
- `commentDrafts`/`quoteNoteDrafts`: Unsaved modal content

**Concurrent save handling**: `dataMerge.ts` provides pure functions to merge conflicting plugin data when multiple Obsidian instances modify `data.json` simultaneously. The merge strategy is last-write-wins for `lastReviewedAt` timestamps, union for collections.

### CSS Architecture

`styles.css` uses modifier classes applied to `.timeline-container`:
- Theme: `.timeline-theme-{color}` (blue, green, purple, etc.)
- Mobile: `.timeline-mobile`
- Media size: `.timeline-image-{small|medium|large|full}` - affects both image thumbnails and PDF embeds

## Key Development Notes

- External packages (`obsidian`, `electron`, CodeMirror) are provided by Obsidian at runtime and marked as externals in esbuild config
- Use `this.register*` methods for cleanup-safe event listeners
- Add commands with stable IDs (don't rename after release)
- `Platform.isMobile` for mobile-specific behavior; `mobileViewOnDesktop` setting enables mobile layout on desktop for testing
- TypeScript strict mode: `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess` all enabled
- When adding new settings: update `PluginSettings` interface, `DEFAULT_SETTINGS`, and settings UI in `settings.ts`
- PDF files: Rendered via iframe in `embedRenderers.ts` with `navpanes=0` to hide thumbnail sidebar
- Source comments are in Japanese; maintain this convention
- This is a TypeScript-only codebase; do not create JavaScript files
- ESLint uses flat config (`eslint.config.mts`) with `eslint-plugin-obsidianmd` and `@eslint-community/eslint-plugin-eslint-comments`
- Key ESLint rules:
  - `obsidianmd/ui/sentence-case`: Enforces sentence case in UI text (ignores 'SRS')
  - `@eslint-community/eslint-comments/require-description`: Disable comments must include reason
  - Format: `// eslint-disable-next-line rule-name -- reason`
- Modal patterns: all modals accept a `plugin` reference (typed as `import type` from `main`), store drafts in plugin data, and support keyboard shortcuts (Ctrl+Enter to confirm)
- Link generation uses `app.fileManager.generateMarkdownLink()` to respect the user's wikilink vs markdown link preference
- **Modular architecture**: When adding features, prefer creating new focused modules over expanding existing files. For example, rendering logic was extracted from `timelineView.ts` into `cardRenderer.ts`, `embedRenderers.ts`; settings UI into `settingSections.ts`; data logic into `statistics.ts`, `noteAnnotation.ts`
- **Claude Code interaction guidelines**:
  - On removal/deletion requests: Take direct action without over-clarification (user intent is clear)
  - CLAUDE.md updates: Make incremental additions; avoid full-file rewrites unless restructuring is genuinely needed
  - Web research: Limit to 2-3 sources before reporting findings; don't over-research established patterns
  - Available skills: Use `/lint-fix`, `/build-validate`, `/check-types` for common workflows (see "Development Workflow Tools" section)
