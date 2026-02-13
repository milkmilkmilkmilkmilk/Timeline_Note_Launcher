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

## Architecture

```
src/
├── main.ts            # Plugin entry point, lifecycle, command registration
├── types.ts           # All interfaces, types, defaults, and PluginData schema
├── timelineView.ts    # Main UI view (ItemView subclass)
├── dataLayer.ts       # File enumeration, card creation, SRS calculations, statistics
├── selectionEngine.ts # Card selection/sorting algorithms (random, age-priority, srs)
├── settings.ts        # Settings tab UI with statistics dashboard
├── commentModal.ts    # Modal for adding timestamped comments to notes
├── quoteNoteModal.ts  # Modal for creating quote notes with template substitution
└── linkNoteModal.ts   # Modal for adding links from one note to others
```

### Data Flow (Two-Phase Card Pipeline)

Selection operates on lightweight candidates to avoid unnecessary file I/O:

1. `enumerateTargetNotes()` filters vault files by folder/tag/exclude settings → `TFile[]`
2. `createCandidateCard()` builds lightweight cards (sync, no file reads) → `CandidateCard[]`
3. `selectCards()` applies selection mode algorithm with `maxCards` limit → `SelectionResult`
4. `createTimelineCard()` fetches full content for selected cards only (async) → `TimelineCard[]`
5. `TimelineView` renders DOM with chunk-based rendering (5 cards per batch via DocumentFragment)
6. Rating buttons trigger `rateCard()` → `updateReviewLogWithSRS()` → save

### Rendering Optimizations

- **Differential rendering**: Skips DOM rebuild if card paths are unchanged (stat-only updates)
- **Chunk processing**: 5 cards per chunk with `Promise.all()` for parallel creation
- **DOM batching**: DocumentFragment before appendChild
- **Caching**: Backlink index (10s TTL), bookmarked paths (5s TTL)

### Plugin Data Structure

Persisted in `data.json` (see `PluginData` interface in `types.ts`):
- `settings`: User preferences (selection mode, SRS params, display options, `excludeFolders`, `maxCards`, `imageSizeMode`)
- `reviewLogs`: Per-note SRS state (interval, easeFactor, nextReviewAt)
- `dailyStats`: Today's review counts
- `reviewHistory`: 30-day activity for heatmap
- `commentDrafts`/`quoteNoteDrafts`: Unsaved modal content

### CSS Architecture

`styles.css` uses modifier classes applied to `.timeline-container`:
- Theme: `.timeline-theme-{color}` (blue, green, purple, etc.)
- Mobile: `.timeline-mobile`
- Media size: `.timeline-image-{small|medium|large|full}` - affects both image thumbnails and PDF embeds

## Key Development Notes

- PDF files are displayed using interactive `<embed>` elements with an "Open" button overlay
- Modal patterns: all modals accept a `plugin` reference (typed as `import type` from `main`), store drafts in plugin data, and support keyboard shortcuts (Ctrl+Enter to confirm)
- Link generation uses `app.fileManager.generateMarkdownLink()` to respect the user's wikilink vs markdown link preference
- `mobileViewOnDesktop` setting enables mobile layout on desktop for testing

TypeScript・Obsidian API・コーディングスタイル・ESLintの詳細ルールは `.claude/rules/typescript-obsidian.md` を参照。
Gitワークフローのルールは `.claude/rules/git-workflow.md` を参照。

## Custom Commands

プロジェクト固有のClaude Codeコマンド（`.claude/commands/`）:

- `/review` — staged changesのコードレビュー（型安全性、リソースリーク、モバイル互換性など）
- `/obsidian-setting <設定の説明>` — 新しい設定項目を3ファイル整合的に追加
- `/pre-release` — リリース前のlint・build・バージョン整合性チェック
- `/debug-view <問題の説明>` — TimelineViewのデータフロー追跡によるデバッグ
