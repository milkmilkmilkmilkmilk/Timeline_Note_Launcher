// Timeline Note Launcher - Settings Tab
import { App, Modal, PluginSettingTab, Setting } from 'obsidian';
import type TimelineNoteLauncherPlugin from './main';
import { calculateStatistics, ReviewStatistics } from './dataLayer';
import { buildTargetNotesSection, buildSelectionModeSection, buildDisplaySection, buildYamlIntegrationSection, buildTemplateSection, buildBehaviorSection, buildSearchIndexSection } from './settingSections';
import type { SettingSectionContext } from './settingSections';

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

		const ctx: SettingSectionContext = {
			containerEl,
			plugin: this.plugin,
			debouncedSaveAndRefresh: this.debouncedSaveAndRefresh,
			redisplay: () => this.display(),
		};

		buildTargetNotesSection(ctx);
		buildSelectionModeSection(ctx);
		buildDisplaySection(ctx);
		buildYamlIntegrationSection(ctx);
		buildTemplateSection(ctx);
		buildBehaviorSection(ctx);
		buildSearchIndexSection(ctx);

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
			streakEl.createSpan({ cls: 'timeline-streak-icon', text: '🔥' });
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
			{ key: 'markdown', icon: '📝', label: 'Markdown' },
			{ key: 'text', icon: '📄', label: 'Text' },
			{ key: 'image', icon: 'IMG', label: 'Image' },
			{ key: 'pdf', icon: '📕', label: 'PDF' },
			{ key: 'audio', icon: '🎵', label: 'Audio' },
			{ key: 'video', icon: '🎬', label: 'Video' },
			{ key: 'excalidraw', icon: '🎨', label: 'Excalidraw' },
			{ key: 'canvas', icon: '🔲', label: 'Canvas' },
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
