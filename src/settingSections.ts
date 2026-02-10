// Timeline Note Launcher - Settings Section Builders
// settings.ts から抽出された各設定セクションのUI構築ロジック
import { Setting, Platform } from 'obsidian';
import type TimelineNoteLauncherPlugin from './main';
import { SelectionMode, SrsReviewUnlockMode, PreviewMode, ColorTheme, ViewMode, ImageSizeMode, UITheme, DEFAULT_QUOTE_NOTE_TEMPLATE, DEFAULT_QUICK_NOTE_TEMPLATE } from './types';

/**
 * 設定セクション構築のコンテキスト
 */
export interface SettingSectionContext {
	containerEl: HTMLElement;
	plugin: TimelineNoteLauncherPlugin;
	debouncedSaveAndRefresh: () => void;
	redisplay: () => void;
}

/**
 * 対象ノート設定セクション
 */
export function buildTargetNotesSection(ctx: SettingSectionContext): void {
	new Setting(ctx.containerEl).setName('Target notes').setHeading();

	new Setting(ctx.containerEl)
		.setName('Target folders')
		.setDesc('Comma-separated folder paths (empty = all folders)')
		.addText(text => text
			.setPlaceholder('Folder1, folder2/subfolder')
			.setValue(ctx.plugin.data.settings.targetFolders.join(', '))
			.onChange((value) => {
				ctx.plugin.data.settings.targetFolders = value
					.split(',')
					.map(s => s.trim())
					.filter(s => s.length > 0);
				ctx.debouncedSaveAndRefresh();
			}));

	new Setting(ctx.containerEl)
		.setName('Exclude folders')
		.setDesc('Comma-separated folder paths to exclude from timeline')
		.addText(text => text
			.setPlaceholder('Templates, archive')
			.setValue(ctx.plugin.data.settings.excludeFolders.join(', '))
			.onChange((value) => {
				ctx.plugin.data.settings.excludeFolders = value
					.split(',')
					.map(s => s.trim())
					.filter(s => s.length > 0);
				ctx.debouncedSaveAndRefresh();
			}));

	new Setting(ctx.containerEl)
		.setName('Target tags')
		.setDesc('Comma-separated tags (empty = all tags)')
		.addText(text => text
			.setPlaceholder('#tag1, #tag2')
			.setValue(ctx.plugin.data.settings.targetTags.join(', '))
			.onChange((value) => {
				ctx.plugin.data.settings.targetTags = value
					.split(',')
					.map(s => s.trim())
					.filter(s => s.length > 0);
				ctx.debouncedSaveAndRefresh();
			}));
}

/**
 * 選択モードセクション（SRS設定を含む）
 */
export function buildSelectionModeSection(ctx: SettingSectionContext): void {
	new Setting(ctx.containerEl).setName('Selection mode').setHeading();

	new Setting(ctx.containerEl)
		.setName('Selection mode')
		.setDesc('How to select and order notes')
		.addDropdown(dropdown => dropdown
			.addOption('random', 'Random')
			.addOption('age-priority', 'Age priority (older = higher)')
			.addOption('srs', 'Spaced repetition (SRS)')
			.setValue(ctx.plugin.data.settings.selectionMode)
			.onChange(async (value) => {
				ctx.plugin.data.settings.selectionMode = value as SelectionMode;
				await ctx.plugin.syncAndSave();
				// 設定画面を再描画してSRS設定を表示/非表示
				ctx.redisplay();
			}));

	// SRS設定（SRSモード時のみ表示）
	if (ctx.plugin.data.settings.selectionMode === 'srs') {
		buildSrsSettings(ctx);
	}
}

/**
 * SRS設定サブセクション
 */
function buildSrsSettings(ctx: SettingSectionContext): void {
	new Setting(ctx.containerEl).setName('SRS').setHeading();

	new Setting(ctx.containerEl)
		.setName('New cards per day')
		.setDesc('Maximum number of new cards to show per day')
		.addSlider(slider => slider
			.setLimits(1, 100, 1)
			.setValue(ctx.plugin.data.settings.newCardsPerDay)
			.setDynamicTooltip()
			.onChange(async (value) => {
				ctx.plugin.data.settings.newCardsPerDay = value;
				await ctx.plugin.syncAndSave();
			}));

	new Setting(ctx.containerEl)
		.setName('Review cards per day')
		.setDesc('Maximum number of review cards to show per day')
		.addSlider(slider => slider
			.setLimits(10, 500, 10)
			.setValue(ctx.plugin.data.settings.reviewCardsPerDay)
			.setDynamicTooltip()
			.onChange(async (value) => {
				ctx.plugin.data.settings.reviewCardsPerDay = value;
				await ctx.plugin.syncAndSave();
			}));

	new Setting(ctx.containerEl)
		.setName('Show review cards when')
		.setDesc('When to show review cards in the timeline')
		.addDropdown(dropdown => dropdown
			.addOption('daily-quota', 'Daily new quota is done')
			.addOption('new-zero', 'No new cards remain')
			.setValue(ctx.plugin.data.settings.srsReviewUnlockMode ?? 'daily-quota')
			.onChange(async (value) => {
				ctx.plugin.data.settings.srsReviewUnlockMode = value as SrsReviewUnlockMode;
				await ctx.plugin.syncAndSave();
				ctx.plugin.refreshAllViews();
			}));

	new Setting(ctx.containerEl)
		.setName('Initial interval')
		.setDesc('Days until first review after answering correctly')
		.addSlider(slider => slider
			.setLimits(1, 7, 1)
			.setValue(ctx.plugin.data.settings.initialInterval)
			.setDynamicTooltip()
			.onChange(async (value) => {
				ctx.plugin.data.settings.initialInterval = value;
				await ctx.plugin.syncAndSave();
			}));

	new Setting(ctx.containerEl)
		.setName('Easy bonus')
		.setDesc('Multiplier for easy ratings (1.0 - 2.0)')
		.addSlider(slider => slider
			.setLimits(1.0, 2.0, 0.1)
			.setValue(ctx.plugin.data.settings.easyBonus)
			.setDynamicTooltip()
			.onChange(async (value) => {
				ctx.plugin.data.settings.easyBonus = value;
				await ctx.plugin.syncAndSave();
			}));

	new Setting(ctx.containerEl)
		.setName('Show random future cards')
		.setDesc('Randomly include some cards with long intervals to prevent them from being buried')
		.addToggle(toggle => toggle
			.setValue(ctx.plugin.data.settings.srsShowRandomFutureCards)
			.onChange(async (value) => {
				ctx.plugin.data.settings.srsShowRandomFutureCards = value;
				await ctx.plugin.syncAndSave();
				ctx.redisplay();
			}));

	if (ctx.plugin.data.settings.srsShowRandomFutureCards) {
		new Setting(ctx.containerEl)
			.setName('Random future cards percentage')
			.setDesc('Percentage of max cards to show as random future cards (1-30%)')
			.addSlider(slider => slider
				.setLimits(1, 30, 1)
				.setValue(ctx.plugin.data.settings.srsRandomFutureCardsPct)
				.setDynamicTooltip()
				.onChange(async (value) => {
					ctx.plugin.data.settings.srsRandomFutureCardsPct = value;
					await ctx.plugin.syncAndSave();
				}));
	}
}

/**
 * 表示設定セクション
 */
export function buildDisplaySection(ctx: SettingSectionContext): void {
	new Setting(ctx.containerEl).setName('Display').setHeading();

	new Setting(ctx.containerEl)
		.setName('View mode')
		.setDesc('List view or grid view for cards')
		.addDropdown(dropdown => dropdown
			.addOption('list', 'List')
			.addOption('grid', 'Grid')
			.setValue(ctx.plugin.data.settings.viewMode)
			.onChange(async (value) => {
				ctx.plugin.data.settings.viewMode = value as ViewMode;
				await ctx.plugin.syncAndSave();
				ctx.plugin.refreshAllViews();
				ctx.redisplay();
			}));

	// グリッドモード時のみ列数設定を表示
	if (ctx.plugin.data.settings.viewMode === 'grid') {
		new Setting(ctx.containerEl)
			.setName('Grid columns')
			.setDesc('Number of columns in grid view (2-4)')
			.addSlider(slider => slider
				.setLimits(2, 4, 1)
				.setValue(ctx.plugin.data.settings.gridColumns)
				.setDynamicTooltip()
				.onChange(async (value) => {
					ctx.plugin.data.settings.gridColumns = value;
					await ctx.plugin.syncAndSave();
					ctx.plugin.refreshAllViews();
				}));
	}

	new Setting(ctx.containerEl)
		.setName('Media size')
		.setDesc('Maximum height for images')
		.addDropdown(dropdown => dropdown
			.addOption('small', 'Small')
			.addOption('medium', 'Medium')
			.addOption('large', 'Large')
			.addOption('full', 'Full')
			.setValue(ctx.plugin.data.settings.imageSizeMode)
			.onChange(async (value) => {
				ctx.plugin.data.settings.imageSizeMode = value as ImageSizeMode;
				await ctx.plugin.syncAndSave();
				ctx.plugin.refreshAllViews();
			}));

	new Setting(ctx.containerEl)
		.setName('Preview mode')
		.setDesc('How much of the note to show in preview')
		.addDropdown(dropdown => dropdown
			.addOption('lines', 'Fixed lines')
			.addOption('half', 'Half of note')
			.addOption('full', 'Full note')
			.setValue(ctx.plugin.data.settings.previewMode)
			.onChange(async (value) => {
				ctx.plugin.data.settings.previewMode = value as PreviewMode;
				await ctx.plugin.syncAndSave();
				// 設定画面を再描画してpreviewLinesを表示/非表示
				ctx.redisplay();
			}));

	// previewMode が 'lines' の時のみ行数設定を表示
	if (ctx.plugin.data.settings.previewMode === 'lines') {
		new Setting(ctx.containerEl)
			.setName('Preview lines')
			.setDesc('Number of lines to show in card preview')
			.addSlider(slider => slider
				.setLimits(1, 10, 1)
				.setValue(ctx.plugin.data.settings.previewLines)
				.setDynamicTooltip()
				.onChange(async (value) => {
					ctx.plugin.data.settings.previewLines = value;
					await ctx.plugin.syncAndSave();
				}));
	}

	new Setting(ctx.containerEl)
		.setName('Color theme')
		.setDesc('Accent color for timeline cards')
		.addDropdown(dropdown => dropdown
			.addOption('default', '耳 default')
			.addOption('blue', '鳩 blue')
			.addOption('cyan', 'ｩｵ cyan')
			.addOption('green', '泙 green')
			.addOption('yellow', '泯 yellow')
			.addOption('orange', '泛 orange')
			.addOption('red', '閥 red')
			.addOption('pink', 'ｩｷ pink')
			.addOption('purple', '泪 purple')
			.setValue(ctx.plugin.data.settings.colorTheme)
			.onChange(async (value) => {
				ctx.plugin.data.settings.colorTheme = value as ColorTheme;
				await ctx.plugin.syncAndSave();
				ctx.plugin.refreshAllViews();
			}));

	new Setting(ctx.containerEl)
		.setName('UI theme')
		.setDesc('Change the overall look and layout')
		.addDropdown(dropdown => dropdown
			.addOption('classic', 'Classic')
			.addOption('twitter', 'Twitter-like')
			.setValue(ctx.plugin.data.settings.uiTheme)
			.onChange(async (value) => {
				ctx.plugin.data.settings.uiTheme = value as UITheme;
				await ctx.plugin.syncAndSave();
				ctx.plugin.refreshAllViews();
			}));

	new Setting(ctx.containerEl)
		.setName('Show metadata')
		.setDesc('Display last reviewed date, review count, and tags')
		.addToggle(toggle => toggle
			.setValue(ctx.plugin.data.settings.showMeta)
			.onChange(async (value) => {
				ctx.plugin.data.settings.showMeta = value;
				await ctx.plugin.syncAndSave();
			}));

	new Setting(ctx.containerEl)
		.setName('Show properties')
		.setDesc('Display frontmatter properties on cards')
		.addDropdown(dropdown => dropdown
			.addOption('off', 'Off')
			.addOption('all', 'All')
			.addOption('custom', 'Custom keys')
			.setValue(ctx.plugin.data.settings.showProperties)
			.onChange(async (value) => {
				ctx.plugin.data.settings.showProperties = value as 'off' | 'all' | 'custom';
				await ctx.plugin.syncAndSave();
				ctx.plugin.refreshAllViews();
				ctx.redisplay();
			}));

	if (ctx.plugin.data.settings.showProperties === 'custom') {
		new Setting(ctx.containerEl)
			.setName('Property keys')
			.setDesc('Comma-separated frontmatter keys to display')
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- placeholder は frontmatter キー名のため
				.setPlaceholder('status, category, author')
				.setValue(ctx.plugin.data.settings.propertiesKeys)
				.onChange((value) => {
					ctx.plugin.data.settings.propertiesKeys = value;
					ctx.debouncedSaveAndRefresh();
				}));
	}

	new Setting(ctx.containerEl)
		.setName('Show difficulty buttons')
		.setDesc('Display again/hard/good/easy buttons on cards')
		.addToggle(toggle => toggle
			.setValue(ctx.plugin.data.settings.showDifficultyButtons)
			.onChange(async (value) => {
				ctx.plugin.data.settings.showDifficultyButtons = value;
				await ctx.plugin.syncAndSave();
			}));

	// Desktop専用設定
	if (!Platform.isMobile) {
		new Setting(ctx.containerEl)
			.setName('Enable split view')
			.setDesc('Open notes in split pane (desktop only)')
			.addToggle(toggle => toggle
				.setValue(ctx.plugin.data.settings.enableSplitView)
				.onChange(async (value) => {
					ctx.plugin.data.settings.enableSplitView = value;
					await ctx.plugin.syncAndSave();
				}));

		new Setting(ctx.containerEl)
			.setName('Mobile view on desktop')
			.setDesc('Use mobile-style layout with larger touch targets (desktop only)')
			.addToggle(toggle => toggle
				.setValue(ctx.plugin.data.settings.mobileViewOnDesktop)
				.onChange(async (value) => {
					ctx.plugin.data.settings.mobileViewOnDesktop = value;
					await ctx.plugin.syncAndSave();
					// タイムラインビューを更新して連動
					ctx.plugin.refreshAllViews();
				}));
	}
}

/**
 * YAML連携セクション
 */
export function buildYamlIntegrationSection(ctx: SettingSectionContext): void {
	new Setting(ctx.containerEl).setName('YAML integration').setHeading();

	new Setting(ctx.containerEl)
		.setName('Difficulty YAML key')
		.setDesc('Read difficulty from this frontmatter key (leave empty to ignore)')
		.addText(text => text
			.setPlaceholder('Difficulty')
			.setValue(ctx.plugin.data.settings.yamlDifficultyKey)
			.onChange(async (value) => {
				ctx.plugin.data.settings.yamlDifficultyKey = value.trim();
				await ctx.plugin.syncAndSave();
			}));

	new Setting(ctx.containerEl)
		.setName('Priority YAML key')
		.setDesc('Read priority from this frontmatter key (higher = shown first)')
		.addText(text => text
			.setPlaceholder('Priority')
			.setValue(ctx.plugin.data.settings.yamlPriorityKey)
			.onChange(async (value) => {
				ctx.plugin.data.settings.yamlPriorityKey = value.trim();
				await ctx.plugin.syncAndSave();
			}));

	new Setting(ctx.containerEl)
		.setName('Date YAML key')
		.setDesc('Read note creation date from this frontmatter key for age-priority mode (e.g., created, date)')
		.addText(text => text
			.setPlaceholder('Created')
			.setValue(ctx.plugin.data.settings.yamlDateField)
			.onChange(async (value) => {
				ctx.plugin.data.settings.yamlDateField = value.trim();
				await ctx.plugin.syncAndSave();
			}));
}

/**
 * テンプレート設定セクション（引用ノート + クイックノート）
 */
export function buildTemplateSection(ctx: SettingSectionContext): void {
	// 引用ノート設定
	new Setting(ctx.containerEl).setName('Quote note').setHeading();

	new Setting(ctx.containerEl)
		.setName('Quote note template')
		.setDesc('Template for new quote notes. Variables: {{uid}}, {{title}}, {{date}}, {{originalNote}}, {{quotedText}}, {{comment}}')
		.addTextArea(textArea => textArea
			.setPlaceholder(DEFAULT_QUOTE_NOTE_TEMPLATE)
			.setValue(ctx.plugin.data.settings.quoteNoteTemplate)
			.onChange(async (value) => {
				ctx.plugin.data.settings.quoteNoteTemplate = value || DEFAULT_QUOTE_NOTE_TEMPLATE;
				await ctx.plugin.syncAndSave();
			}));

	// テンプレートリセットボタン
	new Setting(ctx.containerEl)
		.setName('Reset template')
		.setDesc('Reset quote note template to default')
		.addButton(button => button
			.setButtonText('Reset')
			.onClick(async () => {
				ctx.plugin.data.settings.quoteNoteTemplate = DEFAULT_QUOTE_NOTE_TEMPLATE;
				await ctx.plugin.syncAndSave();
				ctx.redisplay();
			}));

	// クイックノート設定
	new Setting(ctx.containerEl).setName('Quick note (compose box)').setHeading();

	new Setting(ctx.containerEl)
		.setName('Quick note folder')
		.setDesc('Folder to save quick notes (empty = vault root)')
		.addText(text => text
			.setPlaceholder('Notes/quick')
			.setValue(ctx.plugin.data.settings.quickNoteFolder)
			.onChange(async (value) => {
				ctx.plugin.data.settings.quickNoteFolder = value.trim();
				await ctx.plugin.syncAndSave();
			}));

	new Setting(ctx.containerEl)
		.setName('Quick note template')
		.setDesc('Template for quick notes. Variables: {{uid}}, {{title}}, {{date}}, {{content}}')
		.addTextArea(textArea => textArea
			.setPlaceholder(DEFAULT_QUICK_NOTE_TEMPLATE)
			.setValue(ctx.plugin.data.settings.quickNoteTemplate)
			.onChange(async (value) => {
				ctx.plugin.data.settings.quickNoteTemplate = value || DEFAULT_QUICK_NOTE_TEMPLATE;
				await ctx.plugin.syncAndSave();
			}));

	new Setting(ctx.containerEl)
		.setName('Reset quick note template')
		.setDesc('Reset quick note template to default')
		.addButton(button => button
			.setButtonText('Reset')
			.onClick(async () => {
				ctx.plugin.data.settings.quickNoteTemplate = DEFAULT_QUICK_NOTE_TEMPLATE;
				await ctx.plugin.syncAndSave();
				ctx.redisplay();
			}));
}

/**
 * 動作設定セクション
 */
export function buildBehaviorSection(ctx: SettingSectionContext): void {
	new Setting(ctx.containerEl).setName('Behavior').setHeading();

	new Setting(ctx.containerEl)
		.setName('Max cards')
		.setDesc('Maximum number of cards to display in timeline (1-500)')
		.addText(text => text
			.setPlaceholder('50')
			.setValue(String(ctx.plugin.data.settings.maxCards))
			.onChange(async (value) => {
				const num = parseInt(value, 10);
				if (!isNaN(num) && num >= 1 && num <= 500) {
					ctx.plugin.data.settings.maxCards = num;
					await ctx.plugin.syncAndSave();
				}
			}));

	new Setting(ctx.containerEl)
		.setName('Enable infinite scroll')
		.setDesc('Load more cards as you scroll down instead of showing all at once')
		.addToggle(toggle => toggle
			.setValue(ctx.plugin.data.settings.enableInfiniteScroll)
			.onChange(async (value) => {
				ctx.plugin.data.settings.enableInfiniteScroll = value;
				await ctx.plugin.syncAndSave();
				ctx.plugin.refreshAllViews();
				ctx.redisplay();
			}));

	if (ctx.plugin.data.settings.enableInfiniteScroll) {
		new Setting(ctx.containerEl)
			.setName('Batch size')
			.setDesc('Number of cards to load at once when scrolling (10-100)')
			.addSlider(slider => slider
				.setLimits(10, 100, 5)
				.setValue(ctx.plugin.data.settings.infiniteScrollBatchSize)
				.setDynamicTooltip()
				.onChange(async (value) => {
					ctx.plugin.data.settings.infiniteScrollBatchSize = value;
					await ctx.plugin.syncAndSave();
				}));
	}

	new Setting(ctx.containerEl)
		.setName('Auto refresh interval')
		.setDesc('Minutes between auto refresh (0 = manual only)')
		.addSlider(slider => slider
			.setLimits(0, 60, 5)
			.setValue(ctx.plugin.data.settings.autoRefreshMinutes)
			.setDynamicTooltip()
			.onChange(async (value) => {
				ctx.plugin.data.settings.autoRefreshMinutes = value;
				await ctx.plugin.syncAndSave();
			}));

	new Setting(ctx.containerEl)
		.setName('Log retention days')
		.setDesc('How long to keep review logs')
		.addSlider(slider => slider
			.setLimits(7, 365, 1)
			.setValue(ctx.plugin.data.settings.logRetentionDays)
			.setDynamicTooltip()
			.onChange(async (value) => {
				ctx.plugin.data.settings.logRetentionDays = value;
				await ctx.plugin.syncAndSave();
			}));
}
