// Timeline Note Launcher - Settings Tab
import { App, PluginSettingTab, Setting, Platform } from 'obsidian';
import type TimelineNoteLauncherPlugin from './main';
import { SelectionMode, PreviewMode, ColorTheme, ViewMode, DEFAULT_QUOTE_NOTE_TEMPLATE } from './types';
import { calculateStatistics, ReviewStatistics } from './dataLayer';

export class TimelineSettingTab extends PluginSettingTab {
	plugin: TimelineNoteLauncherPlugin;

	constructor(app: App, plugin: TimelineNoteLauncherPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Timeline Note Launcher Settings' });

		// === 対象ノート設定 ===
		containerEl.createEl('h3', { text: 'Target Notes' });

		new Setting(containerEl)
			.setName('Target folders')
			.setDesc('Comma-separated folder paths (empty = all folders)')
			.addText(text => text
				.setPlaceholder('folder1, folder2/subfolder')
				.setValue(this.plugin.data.settings.targetFolders.join(', '))
				.onChange(async (value) => {
					this.plugin.data.settings.targetFolders = value
						.split(',')
						.map(s => s.trim())
						.filter(s => s.length > 0);
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Target tags')
			.setDesc('Comma-separated tags (empty = all tags)')
			.addText(text => text
				.setPlaceholder('#tag1, #tag2')
				.setValue(this.plugin.data.settings.targetTags.join(', '))
				.onChange(async (value) => {
					this.plugin.data.settings.targetTags = value
						.split(',')
						.map(s => s.trim())
						.filter(s => s.length > 0);
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Search query')
			.setDesc('Additional search filter (Obsidian search syntax)')
			.addText(text => text
				.setPlaceholder('path:notes OR tag:#important')
				.setValue(this.plugin.data.settings.searchQuery)
				.onChange(async (value) => {
					this.plugin.data.settings.searchQuery = value;
					await this.plugin.saveData(this.plugin.data);
				}));

		// === 選択モード ===
		containerEl.createEl('h3', { text: 'Selection Mode' });

		new Setting(containerEl)
			.setName('Selection mode')
			.setDesc('How to select and order notes')
			.addDropdown(dropdown => dropdown
				.addOption('random', 'Random')
				.addOption('age-priority', 'Age Priority (older = higher)')
				.addOption('srs', 'SRS (Spaced Repetition)')
				.setValue(this.plugin.data.settings.selectionMode)
				.onChange(async (value) => {
					this.plugin.data.settings.selectionMode = value as SelectionMode;
					await this.plugin.saveData(this.plugin.data);
					// 設定画面を再描画してSRS設定を表示/非表示
					this.display();
				}));

		// === SRS設定（SRSモード時のみ表示） ===
		if (this.plugin.data.settings.selectionMode === 'srs') {
			containerEl.createEl('h3', { text: 'SRS Settings' });

			new Setting(containerEl)
				.setName('New cards per day')
				.setDesc('Maximum number of new cards to show per day')
				.addSlider(slider => slider
					.setLimits(1, 100, 1)
					.setValue(this.plugin.data.settings.newCardsPerDay)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.data.settings.newCardsPerDay = value;
						await this.plugin.saveData(this.plugin.data);
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
						await this.plugin.saveData(this.plugin.data);
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
						await this.plugin.saveData(this.plugin.data);
					}));

			new Setting(containerEl)
				.setName('Easy bonus')
				.setDesc('Multiplier for Easy ratings (1.0 - 2.0)')
				.addSlider(slider => slider
					.setLimits(1.0, 2.0, 0.1)
					.setValue(this.plugin.data.settings.easyBonus)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.data.settings.easyBonus = value;
						await this.plugin.saveData(this.plugin.data);
					}));
		}

		// === 表示設定 ===
		containerEl.createEl('h3', { text: 'Display' });

		new Setting(containerEl)
			.setName('View mode')
			.setDesc('List view or grid view for cards')
			.addDropdown(dropdown => dropdown
				.addOption('list', 'List')
				.addOption('grid', 'Grid')
				.setValue(this.plugin.data.settings.viewMode)
				.onChange(async (value) => {
					this.plugin.data.settings.viewMode = value as ViewMode;
					await this.plugin.saveData(this.plugin.data);
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
						await this.plugin.saveData(this.plugin.data);
						this.plugin.refreshAllViews();
					}));
		}

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
					await this.plugin.saveData(this.plugin.data);
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
						await this.plugin.saveData(this.plugin.data);
					}));
		}

		new Setting(containerEl)
			.setName('Color theme')
			.setDesc('Accent color for timeline cards')
			.addDropdown(dropdown => dropdown
				.addOption('default', '🎨 Default')
				.addOption('blue', '🔵 Blue')
				.addOption('cyan', '🩵 Cyan')
				.addOption('green', '🟢 Green')
				.addOption('yellow', '🟡 Yellow')
				.addOption('orange', '🟠 Orange')
				.addOption('red', '🔴 Red')
				.addOption('pink', '🩷 Pink')
				.addOption('purple', '🟣 Purple')
				.setValue(this.plugin.data.settings.colorTheme)
				.onChange(async (value) => {
					this.plugin.data.settings.colorTheme = value as ColorTheme;
					await this.plugin.saveData(this.plugin.data);
					this.plugin.refreshAllViews();
				}));

		new Setting(containerEl)
			.setName('Show metadata')
			.setDesc('Display last reviewed date, review count, and tags')
			.addToggle(toggle => toggle
				.setValue(this.plugin.data.settings.showMeta)
				.onChange(async (value) => {
					this.plugin.data.settings.showMeta = value;
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Show difficulty buttons')
			.setDesc('Display Again/Hard/Good/Easy buttons on cards')
			.addToggle(toggle => toggle
				.setValue(this.plugin.data.settings.showDifficultyButtons)
				.onChange(async (value) => {
					this.plugin.data.settings.showDifficultyButtons = value;
					await this.plugin.saveData(this.plugin.data);
				}));

		// Desktop専用設定
		if (!Platform.isMobile) {
			new Setting(containerEl)
				.setName('Enable split view')
				.setDesc('Open notes in split pane (Desktop only)')
				.addToggle(toggle => toggle
					.setValue(this.plugin.data.settings.enableSplitView)
					.onChange(async (value) => {
						this.plugin.data.settings.enableSplitView = value;
						await this.plugin.saveData(this.plugin.data);
					}));

			new Setting(containerEl)
				.setName('Mobile view on desktop')
				.setDesc('Use mobile-style layout with larger touch targets (Desktop only)')
				.addToggle(toggle => toggle
					.setValue(this.plugin.data.settings.mobileViewOnDesktop)
					.onChange(async (value) => {
						this.plugin.data.settings.mobileViewOnDesktop = value;
						await this.plugin.saveData(this.plugin.data);
						// タイムラインビューを更新して連動
						this.plugin.refreshAllViews();
					}));
		}

		// === YAML連携 ===
		containerEl.createEl('h3', { text: 'YAML Integration' });

		new Setting(containerEl)
			.setName('Difficulty YAML key')
			.setDesc('Read difficulty from this frontmatter key (leave empty to ignore)')
			.addText(text => text
				.setPlaceholder('difficulty')
				.setValue(this.plugin.data.settings.yamlDifficultyKey)
				.onChange(async (value) => {
					this.plugin.data.settings.yamlDifficultyKey = value.trim();
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Priority YAML key')
			.setDesc('Read priority from this frontmatter key (higher = shown first)')
			.addText(text => text
				.setPlaceholder('priority')
				.setValue(this.plugin.data.settings.yamlPriorityKey)
				.onChange(async (value) => {
					this.plugin.data.settings.yamlPriorityKey = value.trim();
					await this.plugin.saveData(this.plugin.data);
				}));

		// === 引用ノート設定 ===
		containerEl.createEl('h3', { text: 'Quote Note' });

		new Setting(containerEl)
			.setName('Quote note template')
			.setDesc('Template for new quote notes. Variables: {{uid}}, {{title}}, {{date}}, {{originalNote}}, {{quotedText}}, {{comment}}')
			.addTextArea(textArea => textArea
				.setPlaceholder(DEFAULT_QUOTE_NOTE_TEMPLATE)
				.setValue(this.plugin.data.settings.quoteNoteTemplate)
				.onChange(async (value) => {
					this.plugin.data.settings.quoteNoteTemplate = value || DEFAULT_QUOTE_NOTE_TEMPLATE;
					await this.plugin.saveData(this.plugin.data);
				}));

		// テンプレートリセットボタン
		new Setting(containerEl)
			.setName('Reset template')
			.setDesc('Reset quote note template to default')
			.addButton(button => button
				.setButtonText('Reset')
				.onClick(async () => {
					this.plugin.data.settings.quoteNoteTemplate = DEFAULT_QUOTE_NOTE_TEMPLATE;
					await this.plugin.saveData(this.plugin.data);
					this.display();
				}));

		// === 動作設定 ===
		containerEl.createEl('h3', { text: 'Behavior' });

		new Setting(containerEl)
			.setName('Auto refresh interval')
			.setDesc('Minutes between auto refresh (0 = manual only)')
			.addSlider(slider => slider
				.setLimits(0, 60, 5)
				.setValue(this.plugin.data.settings.autoRefreshMinutes)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.data.settings.autoRefreshMinutes = value;
					await this.plugin.saveData(this.plugin.data);
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
					await this.plugin.saveData(this.plugin.data);
				}));

		// === 統計 ===
		containerEl.createEl('h3', { text: 'Statistics' });

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
				.onClick(async () => {
					if (confirm('Are you sure you want to reset all review data?')) {
						this.plugin.data.reviewLogs = {};
						this.plugin.data.dailyStats = {
							date: '',
							newReviewed: 0,
							reviewedCount: 0,
						};
						this.plugin.data.reviewHistory = {};
						await this.plugin.saveData(this.plugin.data);
						this.display();
					}
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
			streakEl.innerHTML = `<span class="timeline-streak-icon">🔥</span> <span class="timeline-streak-count">${stats.currentStreak}</span> day streak!`;
		}

		// ヒートマップ
		const heatmapSection = dashboard.createDiv({ cls: 'timeline-stats-heatmap-section' });
		heatmapSection.createEl('div', { cls: 'timeline-stats-section-title', text: 'Activity (Last 30 days)' });
		this.renderHeatmap(heatmapSection, stats.heatmapData);

		// ファイルタイプ別統計
		const typeSection = dashboard.createDiv({ cls: 'timeline-stats-types-section' });
		typeSection.createEl('div', { cls: 'timeline-stats-section-title', text: 'By File Type (30 days)' });
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

		// 最大値を取得（0の場合は1にして除算エラーを防ぐ）
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
			{ key: 'markdown', icon: '📝', label: 'Markdown' },
			{ key: 'image', icon: '🖼️', label: 'Image' },
			{ key: 'pdf', icon: '📄', label: 'PDF' },
			{ key: 'audio', icon: '🎵', label: 'Audio' },
			{ key: 'video', icon: '🎬', label: 'Video' },
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
