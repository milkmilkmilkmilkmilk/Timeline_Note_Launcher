# Timeline Note Launcher

[日本語](README_ja.md) | [中文](README_zh.md)

A Twitter-like timeline view for randomly reviewing your notes in Obsidian. Displays note cards in a vertical list with tap-to-open navigation.

## Features

- **Timeline View**: Twitter-style vertical feed of your notes as cards
- **Multiple Selection Modes**:
  - Random: Pure random selection
  - Age Priority: Older notes appear more frequently
  - SRS (Spaced Repetition System): Uses SM-2 algorithm for optimal review intervals
- **SRS Support**: Rate cards with Again/Hard/Good/Easy buttons, automatically schedules next review
- **Quote Note**: Create new notes with quoted text from the current note
- **Comment Feature**: Add timestamped callout comments directly to notes
- **Filter Bar**: Search by text, filter by file type and tags
- **Grid/List View Toggle**: Switch between card layouts
- **Multi-file Support**: Markdown, Images, PDF, Audio, Video
- **Statistics Dashboard**: Activity heatmap and review statistics
- **Keyboard Shortcuts**: Navigate efficiently with hotkeys
- **Color Themes**: Multiple theme options

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
| Target Tags | Filter notes by tags |
| Selection Mode | Random / Age Priority / SRS |
| Preview Lines | Number of preview lines per card |
| Auto Refresh | Interval for automatic timeline refresh |
| New Cards per Day | Maximum new cards in SRS mode |
| Daily Review Limit | Maximum reviews per day in SRS mode |
| Initial Interval | First review interval in days |
| Easy Bonus | Multiplier for Easy rating |
| Theme | Color theme for the timeline view |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `ArrowDown` | Next card |
| `k` / `ArrowUp` | Previous card |
| `Enter` / `o` | Open selected note |
| `r` | Refresh timeline |
| `g` | Toggle grid/list view |
| `1-4` | Rate card (SRS mode) |

## Requirements

- Obsidian v0.15.0 or later

## Known Limitations

- PDF preview is not available on mobile
- Large vaults may experience slower initial load times

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

usumi

## Support

If you encounter issues or have feature requests, please open an issue on the [GitHub repository](https://github.com/usumi/timeline-note-launcher).
