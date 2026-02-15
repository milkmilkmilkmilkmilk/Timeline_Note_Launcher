# Timeline Note Launcher

[日本語](README_ja.md) | [中文](README_zh.md)

A Twitter-like timeline view for randomly reviewing your notes in Obsidian. Displays note cards in a vertical list with tap-to-open navigation.

## Features

- **Timeline View**: Twitter-style vertical feed of your notes as cards
- **Multiple Selection Modes**:
  - Random: Pure random selection
  - Age Priority: Older notes appear more frequently
  - SRS (Spaced Repetition System): Uses SM-2 algorithm for optimal review intervals
- **SRS Support**: Rate cards with Again/Hard/Good/Easy buttons, automatically schedules next review. Undo button to revert ratings
- **Quote Note**: Create new notes with quoted text from the current note
- **Link Note**: Add links from one note to others
- **Comment Feature**: Add timestamped callout comments directly to notes
- **Quick Note**: Compose and create new notes directly from the timeline
- **Filter Bar**: Search by text, filter by file type, tags, and date range. Save and load filter presets
- **Grid/List View Toggle**: Switch between card layouts
- **Multi-file Support**: Markdown, Text, Images, PDF, Audio, Video, Excalidraw, Canvas, Jupyter Notebook, Office files
- **Bookmark Integration**: Toggle bookmarks on cards via the core Bookmarks plugin
- **YAML Integration**: Read difficulty, priority, and date from frontmatter properties
- **Statistics Dashboard**: Activity heatmap, review statistics, and file type breakdown
- **Keyboard Shortcuts**: Navigate efficiently with hotkeys
- **Color Themes**: Multiple accent colors and UI themes (Classic / Twitter-like)
- **Infinite Scroll**: Load more cards as you scroll
- **Pull to Refresh**: Swipe down to refresh on mobile
- **Split View**: Open notes in a split pane (desktop)
- **Frontmatter Properties**: Display selected frontmatter properties on cards

## Installation

### From Community Plugins (Recommended)

1. Open Obsidian Settings
2. Navigate to Community Plugins and disable Safe Mode
3. Click Browse and search for "Timeline Note Launcher"
4. Install and enable the plugin

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder `timeline-note-launcher` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the folder
4. Reload Obsidian and enable the plugin in Settings > Community Plugins

## Usage

### Opening the Timeline

- Click the rocket icon in the left ribbon
- Or use the command palette: "Timeline Note Launcher: Open Timeline"

### Reviewing Notes

1. Cards appear in the timeline based on your selected mode
2. Click a card to open the note
3. In SRS mode, rate your recall using the difficulty buttons:
   - **Again**: Review again in 10 minutes
   - **Hard**: Shorter interval
   - **Good**: Normal interval
   - **Easy**: Longer interval with bonus

### Creating Quote Notes

1. Open a card in the timeline
2. Select text you want to quote
3. Click "Add Quote" to collect selections
4. Click "Create Quote Note" to generate a new note with your quotes

### Adding Comments

1. Click the comment button on a card
2. Write your comment
3. The comment is appended as a timestamped callout in the original note

## Settings

| Setting | Description |
|---------|-------------|
| Target Folders | Folders to include in the timeline (empty = all) |
| Exclude Folders | Folders to exclude from the timeline |
| Target Tags | Filter notes by tags |
| Selection Mode | Random / Age Priority / SRS |
| View Mode | List or Grid layout |
| Media Size | Maximum height for images and embeds |
| Preview Mode | Fixed lines / Half / Full note preview |
| Color Theme | Accent color for the timeline |
| UI Theme | Classic or Twitter-like layout |
| Show Properties | Display frontmatter properties on cards |
| Max Cards | Maximum number of cards in the timeline |
| Infinite Scroll | Load more cards on scroll |
| Auto Refresh | Interval for automatic timeline refresh |
| YAML Keys | Read difficulty, priority, and date from frontmatter |
| Quick Note Folder | Folder to save quick notes |
| New Cards per Day | Maximum new cards in SRS mode |
| Review Cards per Day | Maximum reviews per day in SRS mode |
| Initial Interval | First review interval in days |
| Easy Bonus | Multiplier for Easy rating |

See the plugin settings tab for the full list of options.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `ArrowDown` | Next card |
| `k` / `ArrowUp` | Previous card |
| `Enter` / `o` | Open selected note |
| `1` - `4` | Rate card (Again/Hard/Good/Easy) |
| `u` | Undo last rating |
| `b` | Toggle bookmark |
| `c` | Open comment modal |
| `q` | Open quote note modal |
| `l` | Open link note modal |
| `r` | Refresh timeline |
| `Escape` | Clear focus |

## Requirements

- Obsidian v1.0.0 or later

## Known Limitations

- PDF preview is not available on mobile (the timeline shows a fallback card with an Open button)
- Large vaults may experience slower initial load times

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

usumi

## Support

If you encounter issues or have feature requests, please open an issue on the [GitHub repository](https://github.com/usumi/timeline-note-launcher).
