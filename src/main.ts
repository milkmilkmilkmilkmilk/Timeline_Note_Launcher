// Timeline Note Launcher - Main Plugin
import { Plugin } from 'obsidian';
import { PluginData, DEFAULT_DATA, DifficultyRating, TimelineCard, getTodayString, QuoteNoteDraft, RatingUndoSnapshot } from './types';
import { TimelineView, TIMELINE_VIEW_TYPE } from './timelineView';
import { TimelineSettingTab } from './settings';
import {
	enumerateTargetNotes,
	createCandidateCard,
	createTimelineCard,
	updateReviewLog,
	updateReviewLogWithSRS,
	cleanupOldLogs,
	recordReviewToHistory,
	cleanupOldHistory,
	getFileType,
	buildBacklinkIndex,
	BacklinkIndex,
} from './dataLayer';
import { selectCards } from './selectionEngine';

export default class TimelineNoteLauncherPlugin extends Plugin {
	data: PluginData;
	private autoRefreshInterval: number | null = null;
	private backlinkIndexCache: { index: BacklinkIndex; timestamp: number } | null = null;
	private static readonly BACKLINK_CACHE_TTL = 10_000;
	// 評価取り消し用スナップショット（セッション限り）
	private ratingUndoMap: Map<string, RatingUndoSnapshot> = new Map();

	async onload(): Promise<void> {
		// データ読み込み
		await this.loadPluginData();

		// View登録（ファクトリ関数で）
		this.registerView(
			TIMELINE_VIEW_TYPE,
			(leaf) => new TimelineView(leaf, this)
		);

		// リボンアイコン
		this.addRibbonIcon('rocket', 'Open timeline', () => {
			void this.activateView();
		});

		// コマンド登録
		this.addCommand({
			id: 'open-timeline',
			name: 'Open timeline',
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: 'refresh-timeline',
			name: 'Refresh timeline',
			callback: () => {
				this.refreshAllViews();
			},
		});

		// 設定タブ
		this.addSettingTab(new TimelineSettingTab(this.app, this));

		// 重い処理は layoutReady 後に遅延
		this.app.workspace.onLayoutReady(() => {
			// 自動更新の設定
			this.setupAutoRefresh();

			// 古いログのクリーンアップ
			this.data.reviewLogs = cleanupOldLogs(
				this.data.reviewLogs,
				this.data.settings.logRetentionDays
			);

			// 古い履歴のクリーンアップ（30日）
			this.data.reviewHistory = cleanupOldHistory(this.data.reviewHistory, 30);

			// 日次統計のリセット確認
			this.checkDailyStatsReset();

			void this.saveData(this.data);
		});
	}

	onunload(): void {
		// 自動更新を停止
		if (this.autoRefreshInterval !== null) {
			window.clearInterval(this.autoRefreshInterval);
		}
	}

	/**
	 * プラグインデータを読み込み
	 */
	private async loadPluginData(): Promise<void> {
		const loaded = await this.loadData() as Partial<PluginData> | null;
		this.data = Object.assign({}, DEFAULT_DATA, loaded);

		// 設定のマージ（新しいキーがあれば追加）
		this.data.settings = Object.assign(
			{},
			DEFAULT_DATA.settings,
			loaded?.settings
		);

		// 日次統計の初期化
		if (!this.data.dailyStats) {
			this.data.dailyStats = { ...DEFAULT_DATA.dailyStats };
		}

		// コメントドラフトの初期化
		if (!this.data.commentDrafts) {
			this.data.commentDrafts = {};
		}

		// 引用ノートドラフトの初期化
		if (!this.data.quoteNoteDrafts) {
			this.data.quoteNoteDrafts = {};
		}

		// レビュー履歴の初期化
		if (!this.data.reviewHistory) {
			this.data.reviewHistory = {};
		}
	}

	/**
	 * 日次統計のリセット確認
	 */
	private checkDailyStatsReset(): void {
		const today = getTodayString();
		if (this.data.dailyStats.date !== today) {
			this.data.dailyStats = {
				date: today,
				newReviewed: 0,
				reviewedCount: 0,
			};
		}
	}

	/**
	 * Viewをアクティブ化
	 */
	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(TIMELINE_VIEW_TYPE)[0];

		if (!leaf) {
			// メインのノート表示エリアに新しいタブとして開く
			const newLeaf = workspace.getLeaf('tab');
			if (newLeaf) {
				await newLeaf.setViewState({
					type: TIMELINE_VIEW_TYPE,
					active: true,
				});
				leaf = newLeaf;
			}
		}

		if (leaf) {
			void workspace.revealLeaf(leaf);
		}
	}

	/**
	 * タイムラインカードを取得（2フェーズパイプライン）
	 */
	async getTimelineCards(): Promise<{ cards: TimelineCard[]; newCount: number; dueCount: number }> {
		const targetFiles = enumerateTargetNotes(this.app, this.data.settings);

		// Phase 1: 軽量候補生成（ファイルI/Oなし・同期）
		const candidates = targetFiles.map(file =>
			createCandidateCard(this.app, file, this.data.reviewLogs[file.path], this.data.settings)
		);

		this.checkDailyStatsReset();

		const result = selectCards(
			candidates,
			this.data.settings.selectionMode,
			this.data.settings,
			this.data.dailyStats.newReviewed,
			this.data.dailyStats.reviewedCount
		);

		// Phase 2: 選択されたカードのみフルカード生成（ファイルI/Oあり）
		const fileMap = new Map(targetFiles.map(f => [f.path, f]));
		const backlinkIndex = this.getBacklinkIndex();

		const cards = await Promise.all(
			result.selectedPaths.map(path =>
				createTimelineCard(
					this.app,
					fileMap.get(path)!,
					this.data.reviewLogs[path],
					this.data.settings,
					backlinkIndex
				)
			)
		);

		return { cards, newCount: result.newCount, dueCount: result.dueCount };
	}

	/**
	 * バックリンクインデックスを取得（TTLキャッシュ付き）
	 */
	private getBacklinkIndex(): BacklinkIndex {
		const now = Date.now();
		if (this.backlinkIndexCache && now - this.backlinkIndexCache.timestamp < TimelineNoteLauncherPlugin.BACKLINK_CACHE_TTL) {
			return this.backlinkIndexCache.index;
		}
		const index = buildBacklinkIndex(this.app);
		this.backlinkIndexCache = { index, timestamp: now };
		return index;
	}

	/**
	 * ノートを既読としてマーク（通常レビュー）
	 */
	async markAsReviewed(path: string): Promise<void> {
		const wasNew = !this.data.reviewLogs[path] || this.data.reviewLogs[path]?.reviewCount === 0;
		this.data.reviewLogs = updateReviewLog(this.data.reviewLogs, path);

		// ファイルタイプを取得
		const extension = path.split('.').pop() || 'md';
		const fileType = getFileType(extension);

		// 日次統計を更新
		this.checkDailyStatsReset();
		if (wasNew) {
			this.data.dailyStats.newReviewed++;
		}
		this.data.dailyStats.reviewedCount++;

		// レビュー履歴を更新
		this.data.reviewHistory = recordReviewToHistory(
			this.data.reviewHistory,
			fileType,
			wasNew
		);

		await this.saveData(this.data);
	}

	/**
	 * カードを評価（SRSレビュー）
	 */
	async rateCard(path: string, rating: DifficultyRating): Promise<void> {
		const wasNew = !this.data.reviewLogs[path] || this.data.reviewLogs[path]?.reviewCount === 0;

		// ファイルタイプを取得
		const extension = path.split('.').pop() || 'md';
		const fileType = getFileType(extension);

		// 評価前のスナップショットを保存（Undo用）
		const previousLog = this.data.reviewLogs[path]
			? { ...this.data.reviewLogs[path] }
			: undefined;
		this.ratingUndoMap.set(path, { previousLog, wasNew, fileType });

		this.data.reviewLogs = updateReviewLogWithSRS(
			this.data.reviewLogs,
			path,
			rating,
			this.data.settings
		);

		// 日次統計を更新
		this.checkDailyStatsReset();
		if (wasNew) {
			this.data.dailyStats.newReviewed++;
		}
		this.data.dailyStats.reviewedCount++;

		// レビュー履歴を更新
		this.data.reviewHistory = recordReviewToHistory(
			this.data.reviewHistory,
			fileType,
			wasNew
		);

		await this.saveData(this.data);
	}

	/**
	 * 評価を取り消し（Undo）
	 */
	async undoRating(path: string): Promise<boolean> {
		const snapshot = this.ratingUndoMap.get(path);
		if (!snapshot) return false;

		// スナップショットを消費（1回限り）
		this.ratingUndoMap.delete(path);

		// reviewLogs を復元
		if (snapshot.previousLog) {
			this.data.reviewLogs[path] = snapshot.previousLog;
		} else {
			delete this.data.reviewLogs[path];
		}

		// 日次統計をデクリメント
		this.checkDailyStatsReset();
		this.data.dailyStats.reviewedCount = Math.max(0, this.data.dailyStats.reviewedCount - 1);
		if (snapshot.wasNew) {
			this.data.dailyStats.newReviewed = Math.max(0, this.data.dailyStats.newReviewed - 1);
		}

		// レビュー履歴をデクリメント
		const today = getTodayString();
		const todayHistory = this.data.reviewHistory[today];
		if (todayHistory) {
			todayHistory.reviewedCount = Math.max(0, todayHistory.reviewedCount - 1);
			if (snapshot.wasNew) {
				todayHistory.newReviewed = Math.max(0, todayHistory.newReviewed - 1);
			}
			todayHistory.fileTypes[snapshot.fileType] = Math.max(0, todayHistory.fileTypes[snapshot.fileType] - 1);
		}

		await this.saveData(this.data);
		return true;
	}

	/**
	 * 指定パスにUndo可能な評価があるか
	 */
	hasUndoForCard(path: string): boolean {
		return this.ratingUndoMap.has(path);
	}

	/**
	 * すべてのTimelineViewを更新
	 */
	refreshAllViews(): void {
		this.backlinkIndexCache = null;
		this.ratingUndoMap.clear();
		const leaves = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof TimelineView) {
				void view.refresh();
			}
		}
	}

	/**
	 * 自動更新を設定
	 */
	private setupAutoRefresh(): void {
		// 既存のインターバルをクリア
		if (this.autoRefreshInterval !== null) {
			window.clearInterval(this.autoRefreshInterval);
			this.autoRefreshInterval = null;
		}

		const minutes = this.data.settings.autoRefreshMinutes;
		if (minutes > 0) {
			this.autoRefreshInterval = window.setInterval(
				() => this.refreshAllViews(),
				minutes * 60 * 1000
			);
			// Obsidianのクリーンアップに登録
			this.registerInterval(this.autoRefreshInterval);
		}
	}

	/**
	 * コメントドラフトを取得
	 */
	getCommentDraft(path: string): string {
		return this.data.commentDrafts[path] ?? '';
	}

	/**
	 * コメントドラフトを保存
	 */
	async saveCommentDraft(path: string, draft: string): Promise<void> {
		if (draft.trim()) {
			this.data.commentDrafts[path] = draft;
		} else {
			delete this.data.commentDrafts[path];
		}
		await this.saveData(this.data);
	}

	/**
	 * コメントドラフトを削除
	 */
	async deleteCommentDraft(path: string): Promise<void> {
		delete this.data.commentDrafts[path];
		await this.saveData(this.data);
	}

	/**
	 * ノートにドラフトがあるか確認
	 */
	hasCommentDraft(path: string): boolean {
		return !!this.data.commentDrafts[path]?.trim();
	}

	/**
	 * 引用ノートドラフトを取得
	 */
	getQuoteNoteDraft(path: string): QuoteNoteDraft | null {
		return this.data.quoteNoteDrafts[path] ?? null;
	}

	/**
	 * 引用ノートドラフトを保存
	 */
	async saveQuoteNoteDraft(path: string, draft: QuoteNoteDraft): Promise<void> {
		const hasContent = draft.selectedTexts.some(t => t.trim()) || draft.title.trim() || draft.comment.trim();
		if (hasContent) {
			this.data.quoteNoteDrafts[path] = draft;
		} else {
			delete this.data.quoteNoteDrafts[path];
		}
		await this.saveData(this.data);
	}

	/**
	 * 引用ノートドラフトを削除
	 */
	async deleteQuoteNoteDraft(path: string): Promise<void> {
		delete this.data.quoteNoteDrafts[path];
		await this.saveData(this.data);
	}

	/**
	 * 引用ノートドラフトがあるか確認
	 */
	hasQuoteNoteDraft(path: string): boolean {
		const draft = this.data.quoteNoteDrafts[path];
		if (!draft) return false;
		const hasSelectedTexts = draft.selectedTexts?.some(t => t.trim()) ?? false;
		return !!(hasSelectedTexts || draft.title.trim() || draft.comment.trim());
	}
}
