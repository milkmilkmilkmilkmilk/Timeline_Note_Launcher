// Timeline Note Launcher - Settings Tab
import { App, Modal, PluginSettingTab, Setting, Platform } from 'obsidian';
import type TimelineNoteLauncherPlugin from './main';
import { SelectionMode, SrsReviewUnlockMode, PreviewMode, ColorTheme, ViewMode, ImageSizeMode, UITheme, DEFAULT_QUOTE_NOTE_TEMPLATE, DEFAULT_QUICK_NOTE_TEMPLATE } from './types';
import { calculateStatistics, ReviewStatistics } from './dataLayer';

/**
 * デバウンス関数
 */
function debounce<T extends (...args: Parameters<T>) => void>(
	func: T,
	wait: number
): (...args: Parameters<T>) => void {
	let timeout: ReturnType<typeof setTimeout> | null = null;
	return (...args: Parameters<T>) => {
		if (timeout !== null) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(() => func(...args), wait);
	};
}

/**
 * 確認ダイアログ用モーダル
 */
class ConfirmModal extends Modal {
	private message: string;
	private onConfirm: () => void | Promise<void>;

	constructor(app: App, message: string, onConfirm: () => void | Promise<void>) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('p', { text: this.message });

		new Setting(contentEl)
			.addButton(button => button
				.setButtonText('Cancel')
				.onClick(() => { this.close(); }))
			.addButton(button => button
				.setButtonText('Confirm')
				.setWarning()
				.onClick(() => {
					void this.onConfirm();
					this.close();
				}));

		// Ctrl+Enter で確認
		this.scope.register(['Mod'], 'Enter', () => {
			void this.onConfirm();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class TimelineSettingTab extends PluginSettingTab {
	plugin: TimelineNoteLauncherPlugin;
	private debouncedSave: () => void;
	private debouncedSaveAndRefresh: () => void;

	constructor(app: App, plugin: TimelineNoteLauncherPlugin) {
		super(app, plugin);
		this.plugin = plugin;

		// デバウンスされた保存関数（500ms遅延）
		this.debouncedSave = debounce(async () => {
			await this.plugin.syncAndSave();
		}, 500);

		// デバウンスされた保存・リフレッシュ関数（500ms遅延）
		this.debouncedSaveAndRefresh = debounce(async () => {
			await this.plugin.syncAndSave();
			this.plugin.refreshAllViews();
		}, 500);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// eslint-disable-next-line obsidianmd/settings-tab/no-problematic-settings-headings -- プラグイン名をそのまま見出しに使用
		new Setting(containerEl).setName('Timeline note launcher').setHeading();

		// === 対象ノート設定 ===
		new Setting(containerEl).setName('Target notes').setHeading();

		new Setting(containerEl)
			.setName('Target folders')
			.setDesc('Comma-separated folder paths (empty = all folders)')
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- placeholder はユーザー入力例のため
				.setPlaceholder('folder1, folder2/subfolder')
				.setValue(this.plugin.data.settings.targetFolders.join(', '))
				.onChange((value) => {
					this.plugin.data.settings.targetFolders = value
						.split(',')
						.map(s => s.trim())
						.filter(s => s.length > 0);
					this.debouncedSaveAndRefresh();
				}));

		new Setting(containerEl)
			.setName('Exclude folders')
			.setDesc('Comma-separated folder paths to exclude from timeline')
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- placeholder はユーザー入力例のため
				.setPlaceholder('templates, archive')
				.setValue(this.plugin.data.settings.excludeFolders.join(', '))
				.onChange((value) => {
					this.plugin.data.settings.excludeFolders = value
						.split(',')
						.map(s => s.trim())
						.filter(s => s.length > 0);
					this.debouncedSaveAndRefresh();
				}));

		new Setting(containerEl)
			.setName('Target tags')
			.setDesc('Comma-separated tags (empty = all tags)')
			.addText(text => text
				.setPlaceholder('#tag1, #tag2')
				.setValue(this.plugin.data.settings.targetTags.join(', '))
				.onChange((value) => {
					this.plugin.data.settings.targetTags = value
						.split(',')
						.map(s => s.trim())
						.filter(s => s.length > 0);
					this.debouncedSaveAndRefresh();
				}));

		// === 選択モード ===
		new Setting(containerEl).setName('Selection mode').setHeading();

		new Setting(containerEl)
			.setName('Selection mode')
			.setDesc('How to select and order notes')
			.addDropdown(dropdown => dropdown
				.addOption('random', 'Random')
				.addOption('age-priority', 'Age priority (older = higher)')
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- SRS は略語のため
				.addOption('srs', 'SRS (spaced repetition)')
				.setValue(this.plugin.data.settings.selectionMode)
				.onChange(async (value) => {
					this.plugin.data.settings.selectionMode = value as SelectionMode;
					await this.plugin.syncAndSave();
					// 設定画面を再描画してSRS設定を表示/非表示
					this.display();
				}));

		// === SRS設定（SRSモード時のみ表示） ===
		if (this.plugin.data.settings.selectionMode === 'srs') {
			new Setting(containerEl).setName('SRS').setHeading();

			new Setting(containerEl)
				.setName('New cards per day')
				.setDesc('Maximum number of new cards to show per day')
				.addSlider(slider => slider
					.setLimits(1, 100, 1)
					.setValue(this.plugin.data.settings.newCardsPerDay)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.data.settings.newCardsPerDay = value;
						await this.plugin.syncAndSave();
					}));

			new Setting(containerEl)
				.setName('Review cards per day')
				.setDesc('Maximum number of review cards to show per day')
				.addSlider(slider => slider
					.setLimits(10, 500, 10)
					.setValue(this.plugin.data.settings.reviewCardsPerDay)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.data.settings.reviewCardsPerDay = value;
						await this.plugin.syncAndSave();
					}));

			new Setting(containerEl)
				.setName('Show review cards when')
				.setDesc('When to show review cards in the timeline')
				.addDropdown(dropdown => dropdown
					.addOption('daily-quota', 'Daily new quota is done')
					.addOption('new-zero', 'No new cards remain')
					.setValue(this.plugin.data.settings.srsReviewUnlockMode ?? 'daily-quota')
					.onChange(async (value) => {
						this.plugin.data.settings.srsReviewUnlockMode = value as SrsReviewUnlockMode;
						await this.plugin.syncAndSave();
						this.plugin.refreshAllViews();
					}));

			new Setting(containerEl)
				.setName('Initial interval')
				.setDesc('Days until first review after answering correctly')
				.addSlider(slider => slider
					.setLimits(1, 7, 1)
					.setValue(this.plugin.data.settings.initialInterval)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.data.settings.initialInterval = value;
						await this.plugin.syncAndSave();
					}));

			new Setting(containerEl)
				.setName('Easy bonus')
				.setDesc('Multiplier for easy ratings (1.0 - 2.0)')
				.addSlider(slider => slider
					.setLimits(1.0, 2.0, 0.1)
					.setValue(this.plugin.data.settings.easyBonus)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.data.settings.easyBonus = value;
						await this.plugin.syncAndSave();
					}));

			new Setting(containerEl)
				.setName('Show random future cards')
				.setDesc('Randomly include some cards with long intervals to prevent them from being buried')
				.addToggle(toggle => toggle
					.setValue(this.plugin.data.settings.srsShowRandomFutureCards)
					.onChange(async (value) => {
						this.plugin.data.settings.srsShowRandomFutureCards = value;
						await this.plugin.syncAndSave();
						this.display();
					}));

			if (this.plugin.data.settings.srsShowRandomFutureCards) {
				new Setting(containerEl)
					.setName('Random future cards percentage')
					.setDesc('Percentage of max cards to show as random future cards (1-30%)')
					.addSlider(slider => slider
						.setLimits(1, 30, 1)
						.setValue(this.plugin.data.settings.srsRandomFutureCardsPct)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.data.settings.srsRandomFutureCardsPct = value;
							await this.plugin.syncAndSave();
						}));
			}
		}

		// === 表示設定 ===
		new Setting(containerEl).setName('Display').setHeading();

		new Setting(containerEl)
			.setName('View mode')
			.setDesc('List view or grid view for cards')
			.addDropdown(dropdown => dropdown
				.addOption('list', 'List')
				.addOption('grid', 'Grid')
				.setValue(this.plugin.data.settings.viewMode)
				.onChange(async (value) => {
					this.plugin.data.settings.viewMode = value as ViewMode;
					await this.plugin.syncAndSave();
					this.plugin.refreshAllViews();
					this.display();
				}));

		// グリッドモード時のみ列数設定を表示
		if (this.plugin.data.settings.viewMode === 'grid') {
			new Setting(containerEl)
				.setName('Grid columns')
				.setDesc('Number of columns in grid view (2-4)')
				.addSlider(slider => slider
					.setLimits(2, 4, 1)
					.setValue(this.plugin.data.settings.gridColumns)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.data.settings.gridColumns = value;
						await this.plugin.syncAndSave();
						this.plugin.refreshAllViews();
					}));
		}

		new Setting(containerEl)
			.setName('Media size')
			.setDesc('Maximum height for images')
			.addDropdown(dropdown => dropdown
				.addOption('small', 'Small')
				.addOption('medium', 'Medium')
				.addOption('large', 'Large')
				.addOption('full', 'Full')
				.setValue(this.plugin.data.settings.imageSizeMode)
				.onChange(async (value) => {
					this.plugin.data.settings.imageSizeMode = value as ImageSizeMode;
					await this.plugin.syncAndSave();
					this.plugin.refreshAllViews();
				}));

		new Setting(containerEl)
			.setName('Preview mode')
			.setDesc('How much of the note to show in preview')
			.addDropdown(dropdown => dropdown
				.addOption('lines', 'Fixed lines')
				.addOption('half', 'Half of note')
				.addOption('full', 'Full note')
				.setValue(this.plugin.data.settings.previewMode)
				.onChange(async (value) => {
					this.plugin.data.settings.previewMode = value as PreviewMode;
					await this.plugin.syncAndSave();
					// 設定画面を再描画してpreviewLinesを表示/非表示
					this.display();
				}));

		// previewMode が 'lines' の時のみ行数設定を表示
		if (this.plugin.data.settings.previewMode === 'lines') {
			new Setting(containerEl)
				.setName('Preview lines')
				.setDesc('Number of lines to show in card preview')
				.addSlider(slider => slider
					.setLimits(1, 10, 1)
					.setValue(this.plugin.data.settings.previewLines)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.data.settings.previewLines = value;
						await this.plugin.syncAndSave();
					}));
		}

		new Setting(containerEl)
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
				.setValue(this.plugin.data.settings.colorTheme)
				.onChange(async (value) => {
					this.plugin.data.settings.colorTheme = value as ColorTheme;
					await this.plugin.syncAndSave();
					this.plugin.refreshAllViews();
				}));

		new Setting(containerEl)
			.setName('UI theme')
			.setDesc('Change the overall look and layout')
			.addDropdown(dropdown => dropdown
				.addOption('classic', 'Classic')
				.addOption('twitter', 'Twitter-like')
				.setValue(this.plugin.data.settings.uiTheme)
				.onChange(async (value) => {
					this.plugin.data.settings.uiTheme = value as UITheme;
					await this.plugin.syncAndSave();
					this.plugin.refreshAllViews();
				}));

		new Setting(containerEl)
			.setName('Show metadata')
			.setDesc('Display last reviewed date, review count, and tags')
			.addToggle(toggle => toggle
				.setValue(this.plugin.data.settings.showMeta)
				.onChange(async (value) => {
					this.plugin.data.settings.showMeta = value;
					await this.plugin.syncAndSave();
				}));

		new Setting(containerEl)
			.setName('Show difficulty buttons')
			.setDesc('Display again/hard/good/easy buttons on cards')
			.addToggle(toggle => toggle
				.setValue(this.plugin.data.settings.showDifficultyButtons)
				.onChange(async (value) => {
					this.plugin.data.settings.showDifficultyButtons = value;
					await this.plugin.syncAndSave();
				}));

		// Desktop専用設定
		if (!Platform.isMobile) {
			new Setting(containerEl)
				.setName('Enable split view')
				.setDesc('Open notes in split pane (desktop only)')
				.addToggle(toggle => toggle
					.setValue(this.plugin.data.settings.enableSplitView)
					.onChange(async (value) => {
						this.plugin.data.settings.enableSplitView = value;
						await this.plugin.syncAndSave();
					}));

			new Setting(containerEl)
				.setName('Mobile view on desktop')
				.setDesc('Use mobile-style layout with larger touch targets (desktop only)')
				.addToggle(toggle => toggle
					.setValue(this.plugin.data.settings.mobileViewOnDesktop)
					.onChange(async (value) => {
						this.plugin.data.settings.mobileViewOnDesktop = value;
						await this.plugin.syncAndSave();
						// タイムラインビューを更新して連動
						this.plugin.refreshAllViews();
					}));
		}

		// === YAML連携 ===
		new Setting(containerEl).setName('YAML integration').setHeading();

		new Setting(containerEl)
			.setName('Difficulty YAML key')
			.setDesc('Read difficulty from this frontmatter key (leave empty to ignore)')
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- placeholder は frontmatter キー名のため
				.setPlaceholder('difficulty')
				.setValue(this.plugin.data.settings.yamlDifficultyKey)
				.onChange(async (value) => {
					this.plugin.data.settings.yamlDifficultyKey = value.trim();
					await this.plugin.syncAndSave();
				}));

		new Setting(containerEl)
			.setName('Priority YAML key')
			.setDesc('Read priority from this frontmatter key (higher = shown first)')
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- placeholder は frontmatter キー名のため
				.setPlaceholder('priority')
				.setValue(this.plugin.data.settings.yamlPriorityKey)
				.onChange(async (value) => {
					this.plugin.data.settings.yamlPriorityKey = value.trim();
					await this.plugin.syncAndSave();
				}));

		new Setting(containerEl)
			.setName('Date YAML key')
			.setDesc('Read note creation date from this frontmatter key for age-priority mode (e.g., created, date)')
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- placeholder is frontmatter key name
				.setPlaceholder('created')
				.setValue(this.plugin.data.settings.yamlDateField)
				.onChange(async (value) => {
					this.plugin.data.settings.yamlDateField = value.trim();
					await this.plugin.syncAndSave();
				}));

		// === 引用ノート設定 ===
		new Setting(containerEl).setName('Quote note').setHeading();

		new Setting(containerEl)
			.setName('Quote note template')
			.setDesc('Template for new quote notes. Variables: {{uid}}, {{title}}, {{date}}, {{originalNote}}, {{quotedText}}, {{comment}}')
			.addTextArea(textArea => textArea
				.setPlaceholder(DEFAULT_QUOTE_NOTE_TEMPLATE)
				.setValue(this.plugin.data.settings.quoteNoteTemplate)
				.onChange(async (value) => {
					this.plugin.data.settings.quoteNoteTemplate = value || DEFAULT_QUOTE_NOTE_TEMPLATE;
					await this.plugin.syncAndSave();
				}));

		// テンプレートリセットボタン
		new Setting(containerEl)
			.setName('Reset template')
			.setDesc('Reset quote note template to default')
			.addButton(button => button
				.setButtonText('Reset')
				.onClick(async () => {
					this.plugin.data.settings.quoteNoteTemplate = DEFAULT_QUOTE_NOTE_TEMPLATE;
					await this.plugin.syncAndSave();
					this.display();
				}));

		// === クイックノート設定 ===
		new Setting(containerEl).setName('Quick note (compose box)').setHeading();

		new Setting(containerEl)
			.setName('Quick note folder')
			.setDesc('Folder to save quick notes (empty = vault root)')
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- placeholder はフォルダパス例のため
				.setPlaceholder('notes/quick')
				.setValue(this.plugin.data.settings.quickNoteFolder)
				.onChange(async (value) => {
					this.plugin.data.settings.quickNoteFolder = value.trim();
					await this.plugin.syncAndSave();
				}));

		new Setting(containerEl)
			.setName('Quick note template')
			.setDesc('Template for quick notes. Variables: {{uid}}, {{title}}, {{date}}, {{content}}')
			.addTextArea(textArea => textArea
				.setPlaceholder(DEFAULT_QUICK_NOTE_TEMPLATE)
				.setValue(this.plugin.data.settings.quickNoteTemplate)
				.onChange(async (value) => {
					this.plugin.data.settings.quickNoteTemplate = value || DEFAULT_QUICK_NOTE_TEMPLATE;
					await this.plugin.syncAndSave();
				}));

		new Setting(containerEl)
			.setName('Reset quick note template')
			.setDesc('Reset quick note template to default')
			.addButton(button => button
				.setButtonText('Reset')
				.onClick(async () => {
					this.plugin.data.settings.quickNoteTemplate = DEFAULT_QUICK_NOTE_TEMPLATE;
					await this.plugin.syncAndSave();
					this.display();
				}));

		// === 動作設定 ===
		new Setting(containerEl).setName('Behavior').setHeading();

		new Setting(containerEl)
			.setName('Max cards')
			.setDesc('Maximum number of cards to display in timeline (1-500)')
			.addText(text => text
				.setPlaceholder('50')
				.setValue(String(this.plugin.data.settings.maxCards))
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					if (!isNaN(num) && num >= 1 && num <= 500) {
						this.plugin.data.settings.maxCards = num;
						await this.plugin.syncAndSave();
					}
				}));

		new Setting(containerEl)
			.setName('Enable infinite scroll')
			.setDesc('Load more cards as you scroll down instead of showing all at once')
			.addToggle(toggle => toggle
				.setValue(this.plugin.data.settings.enableInfiniteScroll)
				.onChange(async (value) => {
					this.plugin.data.settings.enableInfiniteScroll = value;
					await this.plugin.syncAndSave();
					this.plugin.refreshAllViews();
					this.display();
				}));

		if (this.plugin.data.settings.enableInfiniteScroll) {
			new Setting(containerEl)
				.setName('Batch size')
				.setDesc('Number of cards to load at once when scrolling (10-100)')
				.addSlider(slider => slider
					.setLimits(10, 100, 5)
					.setValue(this.plugin.data.settings.infiniteScrollBatchSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.data.settings.infiniteScrollBatchSize = value;
						await this.plugin.syncAndSave();
					}));
		}

		new Setting(containerEl)
			.setName('Auto refresh interval')
			.setDesc('Minutes between auto refresh (0 = manual only)')
			.addSlider(slider => slider
				.setLimits(0, 60, 5)
				.setValue(this.plugin.data.settings.autoRefreshMinutes)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.data.settings.autoRefreshMinutes = value;
					await this.plugin.syncAndSave();
				}));

		new Setting(containerEl)
			.setName('Log retention days')
			.setDesc('How long to keep review logs')
			.addSlider(slider => slider
				.setLimits(7, 365, 1)
				.setValue(this.plugin.data.settings.logRetentionDays)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.data.settings.logRetentionDays = value;
					await this.plugin.syncAndSave();
				}));

		// === 統計 ===
		new Setting(containerEl).setName('Statistics').setHeading();

		// 統計を計算
		const stats = calculateStatistics(
			this.plugin.data.reviewLogs,
			this.plugin.data.reviewHistory || {}
		);

		this.renderStatisticsDashboard(containerEl, stats);

		// リセットボタン
		new Setting(containerEl)
			.setName('Reset all review data')
			.setDesc('Clear all review logs and statistics. This cannot be undone!')
			.addButton(button => button
				.setButtonText('Reset')
				.setWarning()
				.onClick(() => {
					new ConfirmModal(
						this.app,
						'Are you sure you want to reset all review data?',
						async () => {
							this.plugin.data.reviewLogs = {};
							this.plugin.data.dailyStats = {
								date: '',
								newReviewed: 0,
								reviewedCount: 0,
							};
							this.plugin.data.reviewHistory = {};
							await this.plugin.syncAndSave();
							this.display();
						}
					).open();
				}));
	}

	/**
	 * 統計ダッシュボードを描画
	 */
	private renderStatisticsDashboard(containerEl: HTMLElement, stats: ReviewStatistics): void {
		const dashboard = containerEl.createDiv({ cls: 'timeline-stats-dashboard' });

		// サマリーカード
		const summaryRow = dashboard.createDiv({ cls: 'timeline-stats-summary' });

		this.createStatCard(summaryRow, 'Today', `${stats.todayReviews}`, 'reviews');
		this.createStatCard(summaryRow, 'This Week', `${stats.weekReviews}`, 'reviews');
		this.createStatCard(summaryRow, 'This Month', `${stats.monthReviews}`, 'reviews');

		// ストリーク表示
		if (stats.currentStreak > 0) {
			const streakEl = dashboard.createDiv({ cls: 'timeline-stats-streak' });
			streakEl.createSpan({ cls: 'timeline-streak-icon', text: '櫨' });
			streakEl.createSpan({ cls: 'timeline-streak-count', text: `${stats.currentStreak}` });
			streakEl.createSpan({ text: ' day streak!' });
		}

		// ヒートマップ
		const heatmapSection = dashboard.createDiv({ cls: 'timeline-stats-heatmap-section' });
		heatmapSection.createEl('div', { cls: 'timeline-stats-section-title', text: 'Activity (last 30 days)' });
		this.renderHeatmap(heatmapSection, stats.heatmapData);

		// ファイルタイプ別統計
		const typeSection = dashboard.createDiv({ cls: 'timeline-stats-types-section' });
		typeSection.createEl('div', { cls: 'timeline-stats-section-title', text: 'By file type (30 days)' });
		this.renderFileTypeBreakdown(typeSection, stats.fileTypeBreakdown);

		// 詳細統計
		const detailSection = dashboard.createDiv({ cls: 'timeline-stats-detail-section' });
		detailSection.createEl('div', { cls: 'timeline-stats-section-title', text: 'Overall' });
		const detailGrid = detailSection.createDiv({ cls: 'timeline-stats-detail-grid' });

		this.createDetailRow(detailGrid, 'Total notes tracked', `${stats.totalNotes}`);
		this.createDetailRow(detailGrid, 'Notes reviewed', `${stats.reviewedNotes}`);
		this.createDetailRow(detailGrid, 'Total reviews (all time)', `${stats.totalReviews}`);

		if (this.plugin.data.settings.selectionMode === 'srs') {
			this.createDetailRow(detailGrid, 'Due today', `${stats.dueToday}`);
			const remaining = Math.max(0, this.plugin.data.settings.newCardsPerDay - stats.todayNewReviews);
			this.createDetailRow(detailGrid, 'New remaining', `${remaining}`);
		}
	}

	/**
	 * 統計カードを作成
	 */
	private createStatCard(container: HTMLElement, label: string, value: string, unit: string): void {
		const card = container.createDiv({ cls: 'timeline-stat-card' });
		card.createDiv({ cls: 'timeline-stat-card-value', text: value });
		card.createDiv({ cls: 'timeline-stat-card-label', text: label });
		card.createDiv({ cls: 'timeline-stat-card-unit', text: unit });
	}

	/**
	 * ヒートマップを描画
	 */
	private renderHeatmap(container: HTMLElement, data: { date: string; count: number }[]): void {
		const heatmap = container.createDiv({ cls: 'timeline-heatmap' });

		// 最大値を取得（0の場合は1にして除算エラーを避ける）
		const maxCount = Math.max(...data.map(d => d.count), 1);

		for (const { date, count } of data) {
			const cell = heatmap.createDiv({ cls: 'timeline-heatmap-cell' });

			// 強度レベル（0-4）
			let level = 0;
			if (count > 0) {
				const ratio = count / maxCount;
				if (ratio <= 0.25) level = 1;
				else if (ratio <= 0.5) level = 2;
				else if (ratio <= 0.75) level = 3;
				else level = 4;
			}
			cell.addClass(`timeline-heatmap-level-${level}`);

			// ツールチップ
			const dateObj = new Date(date);
			const dayStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
			cell.setAttribute('aria-label', `${dayStr}: ${count} reviews`);
			cell.setAttribute('title', `${dayStr}: ${count} reviews`);
		}
	}

	/**
	 * ファイルタイプ別統計を描画
	 */
	private renderFileTypeBreakdown(container: HTMLElement, breakdown: Record<string, number>): void {
		const grid = container.createDiv({ cls: 'timeline-stats-type-grid' });

		const types: { key: string; icon: string; label: string }[] = [
			{ key: 'markdown', icon: '統', label: 'Markdown' },
			{ key: 'text', icon: '塔', label: 'Text' },
			{ key: 'image', icon: 'IMG', label: 'Image' },
			{ key: 'pdf', icon: '塘', label: 'PDF' },
			{ key: 'audio', icon: '七', label: 'Audio' },
			{ key: 'video', icon: '汐', label: 'Video' },
		];

		for (const { key, icon, label } of types) {
			const count = breakdown[key] || 0;
			if (count > 0) {
				const item = grid.createDiv({ cls: 'timeline-stats-type-item' });
				item.createSpan({ cls: 'timeline-stats-type-icon', text: icon });
				item.createSpan({ cls: 'timeline-stats-type-label', text: label });
				item.createSpan({ cls: 'timeline-stats-type-count', text: `${count}` });
			}
		}
	}

	/**
	 * 詳細行を作成
	 */
	private createDetailRow(container: HTMLElement, label: string, value: string): void {
		const row = container.createDiv({ cls: 'timeline-stats-detail-row' });
		row.createSpan({ cls: 'timeline-stats-detail-label', text: label });
		row.createSpan({ cls: 'timeline-stats-detail-value', text: value });
	}
}
