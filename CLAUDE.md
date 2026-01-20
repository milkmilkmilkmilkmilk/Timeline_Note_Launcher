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

## Architecture

```
src/
├── main.ts           # Plugin entry point (TimelineNoteLauncherPlugin class)
├── types.ts          # All TypeScript interfaces, types, and defaults
├── timelineView.ts   # Main UI view (ItemView subclass)
├── dataLayer.ts      # Data operations, file handling, SRS algorithm
├── selectionEngine.ts # Card selection/sorting algorithms
├── settings.ts       # Settings tab UI with statistics dashboard
├── commentModal.ts   # Modal for adding comments to notes
└── quoteNoteModal.ts # Modal for creating quote notes
```

### Key Components

- **TimelineNoteLauncherPlugin** (`main.ts`): Plugin lifecycle, data persistence via `loadData()`/`saveData()`, command registration, and coordinates view refreshes
- **TimelineView** (`timelineView.ts`): Custom ItemView rendering timeline cards with list/grid modes, filter bar, keyboard navigation (j/k/1-4/r/b/c/q), difficulty rating buttons, and tracks `previousActiveLeaf` to open notes in the correct tab group
- **SelectionEngine** (`selectionEngine.ts`): Implements three selection modes with configurable `maxCards` limit:
  - `random`: Fisher-Yates shuffle
  - `age-priority`: Weighted random favoring older/unreviewed notes
  - `srs`: SM-2 spaced repetition with daily limits
- **DataLayer** (`dataLayer.ts`): File enumeration with folder include/exclude filters, card creation, preview text extraction (preserves line breaks), SRS calculations, statistics aggregation

### Data Flow

1. `enumerateTargetNotes()` filters vault files by folder/tag/exclude settings
2. `createTimelineCard()` generates card objects with preview, links, SRS state
3. `selectCards()` applies selection mode algorithm with `maxCards` limit
4. `TimelineView.render()` creates DOM elements with size mode classes
5. Rating buttons trigger `rateCard()` → `updateReviewLogWithSRS()` → save

### Plugin Data Structure

Persisted in `data.json`:
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

- External packages (`obsidian`, `electron`, CodeMirror) are provided by Obsidian at runtime
- Use `this.register*` methods for cleanup-safe event listeners
- Add commands with stable IDs (don't rename after release)
- `Platform.isMobile` for mobile-specific behavior
- TypeScript strict mode enabled
- When adding new settings: update `PluginSettings` interface, `DEFAULT_SETTINGS`, and settings UI in `settings.ts`
- PDF files are displayed using `<embed>` elements with `pointer-events: none` to allow card clicks
