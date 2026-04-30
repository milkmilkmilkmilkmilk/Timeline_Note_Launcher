// Timeline Note Launcher - Main Plugin
import { Menu, Notice, Plugin, TFile } from 'obsidian';
import { PluginData, DEFAULT_DATA, DifficultyRating, TimelineCard, getTodayString, QuoteNoteDraft, RatingUndoSnapshot, FilterPreset } from './types';
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
import { mergePluginData, reconstructFullData } from './dataMerge';
import { SearchIndex } from './searchIndex';
import { extractSearchableText } from './contentExtractor';
import { SimilarNotesModal } from './similarNotesModal';
import { CommentModal } from './commentModal';
import { QuoteNoteModal } from './quoteNoteModal';

export default class TimelineNoteLauncherPlugin extends Plugin {
	data: PluginData;
	private autoRefreshInterval: number | null = null;
	private backlinkIndexCache: { index: BacklinkIndex; timestamp: number } | null = null;
	private static readonly BACKLINK_CACHE_TTL = 300_000;
	private targetFilesCache: { files: TFile[]; settingsKey: string; timestamp: number } | null = null;
	private static readonly TARGET_FILES_CACHE_TTL = 300_000; // 30秒→5分に延長してキャッシュヒット率を向上
	private timelineCardsCache: { cards: TimelineCard[]; newCount: number; dueCount: number; timestamp: number } | null = null;
	private static readonly TIMELINE_CACHE_TTL = 300_000;
	private lastReloadFromDiskAt: number = 0;
	private static readonly RELOAD_FROM_DISK_DEBOUNCE_MS = 1_500;
	private static readonly CREATE_CARD_CONCURRENCY = 32; // 16→32に増やして並列処理を高速化
	private saveQueueDepth: number = 0;
	private reloadAfterQueueScheduled: boolean = false;
	// 評価取り消し用スナップショット（セッション限り）
	private ratingUndoMap: Map<string, RatingUndoSnapshot> = new Map();
	// 保存キュー（直列化用）
	private saveQueue: Promise<void> = Promise.resolve();
	// 内容ベース検索索引（BM25）
	searchIndex: SearchIndex = new SearchIndex();
	private searchIndexRebuilding: boolean = false;

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

		this.addCommand({
			id: 'rebuild-search-index',
			name: 'Rebuild search index',
			callback: () => {
				void this.rebuildSearchIndex();
			},
		});

		this.addCommand({
			id: 'find-similar-notes',
			name: 'Find similar notes (based on current note content)',
			callback: () => {
				void this.openFindSimilarModal();
			},
		});

		this.addCommand({
			id: 'add-comment',
			name: 'Add comment to active note',
			callback: () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice('コメントを追加するノートがアクティブではありません。');
					return;
				}
				new CommentModal(this.app, this, file).open();
			},
		});

		this.addCommand({
			id: 'create-quote-note',
			name: 'Create quote note from active note',
			callback: () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice('引用ノートを作成するノートがアクティブではありません。');
					return;
				}
				new QuoteNoteModal(this.app, this, file).open();
			},
		});

		// 設定タブ
		this.addSettingTab(new TimelineSettingTab(this.app, this));

		// ファイル変更時のキャッシュ無効化戦略を最適化
		// create/delete/rename: 構造的変更なので targetFiles キャッシュのみクリア
		const invalidateStructuralCaches = (): void => {
			this.backlinkIndexCache = null;
			this.invalidateTargetFilesCache();
			// timelineCardsCache は TTL に任せる（即座にクリアしない）
		};
		// modify: バックリンクインデックスのみクリア（リンク変更検出のため）
		const invalidateContentCaches = (): void => {
			this.backlinkIndexCache = null;
			// targetFilesCache と timelineCardsCache は TTL に任せる
		};
		this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu, file) => {
			if (!(file instanceof TFile)) return;
			menu.addItem((item) => {
				item
					.setTitle('コメントを追加')
					.setIcon('message-square')
					.onClick(() => {
						new CommentModal(this.app, this, file).open();
					});
			});
			menu.addItem((item) => {
				item
					.setTitle('引用ノートを作成')
					.setIcon('quote')
					.onClick(() => {
						new QuoteNoteModal(this.app, this, file).open();
					});
			});
		}));

		this.registerEvent(this.app.vault.on('create', invalidateStructuralCaches));
		this.registerEvent(this.app.vault.on('delete', invalidateStructuralCaches));
		this.registerEvent(this.app.vault.on('rename', invalidateStructuralCaches));
		this.registerEvent(this.app.vault.on('modify', invalidateContentCaches));

		// 検索索引の差分更新（索引構築済みのときのみ）
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && this.searchIndex.hasDoc(file.path)) {
				void this.updateSearchIndexForFile(file);
			}
		}));
		this.registerEvent(this.app.vault.on('create', (file) => {
			if (file instanceof TFile && this.searchIndex.isBuilt()) {
				void this.updateSearchIndexForFile(file);
			}
		}));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (file instanceof TFile && this.searchIndex.hasDoc(file.path)) {
				this.searchIndex.removeDoc(file.path);
				this.data.searchIndexDocCount = this.searchIndex.getDocCount();
			}
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile && this.searchIndex.hasDoc(oldPath)) {
				this.searchIndex.renameDoc(oldPath, file.path);
			}
		}));

		// visibilitychange リスナー（アプリ復帰時にリモート変更を取り込む）
		this.registerDomEvent(document, 'visibilitychange', () => {
			if (document.visibilityState === 'visible') {
				void this.reloadFromDisk(true);
			}
		});

		// 重い処理は layoutReady 後に遅延
		this.app.workspace.onLayoutReady(() => {
			// 自動更新の設定
			this.setupAutoRefresh();

			let dataChanged = false;

			// 古いログのクリーンアップ
			const cleanedLogs = cleanupOldLogs(
				this.data.reviewLogs,
				this.data.settings.logRetentionDays
			);
			if (Object.keys(cleanedLogs).length !== Object.keys(this.data.reviewLogs).length) {
				this.data.reviewLogs = cleanedLogs;
				dataChanged = true;
			}

			// 古い履歴のクリーンアップ（30日）
			const cleanedHistory = cleanupOldHistory(this.data.reviewHistory, 30);
			if (Object.keys(cleanedHistory).length !== Object.keys(this.data.reviewHistory).length) {
				this.data.reviewHistory = cleanedHistory;
				dataChanged = true;
			}

			// 日次統計のリセット確認
			const previousDailyStatsDate = this.data.dailyStats.date;
			this.checkDailyStatsReset();
			if (this.data.dailyStats.date !== previousDailyStatsDate) {
				dataChanged = true;
			}

			if (dataChanged) {
				void this.syncAndSave();
			}
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
		const normalizedTwitterSettings = this.normalizeTwitterSettings();

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

		// フィルタープリセットの初期化
		if (!this.data.filterPresets) {
			this.data.filterPresets = [];
		}

		// いいね記録の初期化
		if (!this.data.likedNotes) {
			this.data.likedNotes = {};
		}

		// 検索索引関連フィールドの初期化
		if (this.data.searchIndex === undefined) {
			this.data.searchIndex = null;
		}
		if (this.data.searchIndexBuiltAt === undefined) {
			this.data.searchIndexBuiltAt = null;
		}
		if (this.data.searchIndexDocCount === undefined) {
			this.data.searchIndexDocCount = 0;
		}

		// シリアライズ済み索引から復元（未構築なら空のまま）
		this.searchIndex = SearchIndex.deserialize(this.data.searchIndex);

		// データ移行
		await this.migrateData(loaded?.engineVersion ?? 1);

		// 文字化けや不正値を補正した設定を永続化
		if (normalizedTwitterSettings) {
			await this.saveData(this.data);
		}
	}

	private normalizeTwitterSettings(): boolean {
		const settings = this.data.settings;
		let changed = false;

		const normalizeTextSetting = (value: unknown, fallback: string, maxLength: number): string => {
			if (typeof value !== 'string') {
				return fallback;
			}
			const trimmed = value.trim();
			if (trimmed.length === 0) {
				return fallback;
			}
			return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
		};

		const nextDisplayName = normalizeTextSetting(settings.twitterDisplayName, 'Timeline User', 64);
		if (settings.twitterDisplayName !== nextDisplayName) {
			settings.twitterDisplayName = nextDisplayName;
			changed = true;
		}

		const nextHandleBase = normalizeTextSetting(settings.twitterHandle, '@timeline_user', 64).replace(/\s+/g, '');
		const nextHandleCore = nextHandleBase.replace(/^@+/, '');
		const nextHandle = nextHandleCore.length > 0 ? `@${nextHandleCore}` : '@timeline_user';
		if (settings.twitterHandle !== nextHandle) {
			settings.twitterHandle = nextHandle;
			changed = true;
		}

		const nextAvatar = this.normalizeTwitterAvatarEmoji(settings.twitterAvatarEmoji);
		if (settings.twitterAvatarEmoji !== nextAvatar) {
			settings.twitterAvatarEmoji = nextAvatar;
			changed = true;
		}

		const allowedRailDensity = new Set(['six', 'full']);
		if (!allowedRailDensity.has(settings.twitterRailDensity)) {
			settings.twitterRailDensity = 'six';
			changed = true;
		}

		const allowedFeatherAction = new Set(['quick-note-modal', 'create-empty-note', 'command-palette']);
		if (!allowedFeatherAction.has(settings.twitterFeatherAction)) {
			settings.twitterFeatherAction = 'quick-note-modal';
			changed = true;
		}

		if (typeof settings.twitterShowSrsInActions !== 'boolean') {
			settings.twitterShowSrsInActions = true;
			changed = true;
		}

		return changed;
	}

	private normalizeTwitterAvatarEmoji(value: unknown): string {
		if (typeof value !== 'string') {
			return '\u{1F4DD}';
		}
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			return '\u{1F4DD}';
		}
		if (/\s/.test(trimmed)) {
			return '\u{1F4DD}';
		}
		const codePoints = Array.from(trimmed);
		if (codePoints.length > 8) {
			return '\u{1F4DD}';
		}
		const emojiLikePattern = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
		if (!emojiLikePattern.test(trimmed)) {
			return '\u{1F4DD}';
		}
		return trimmed;
	}

	/**
	 * データ移行処理
	 * 古いengineVersionから最新バージョンへ段階的に移行
	 */
	private async migrateData(fromVersion: number): Promise<void> {
		const currentVersion = DEFAULT_DATA.engineVersion;
		if (fromVersion >= currentVersion) return;

		let migrated = false;

		// v1 -> v2: easeFactor フィールドの追加
		if (fromVersion < 2) {
			for (const path of Object.keys(this.data.reviewLogs)) {
				const log = this.data.reviewLogs[path];
				if (log && log.easeFactor === undefined) {
					log.easeFactor = log.difficulty ?? 2.5;
				}
			}
			migrated = true;
		}

		// 将来の移行ロジックはここに追加:
		// if (fromVersion < 3) { ... }

		if (migrated) {
			this.data.engineVersion = currentVersion;
			await this.saveData(this.data);
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
		// キャッシュが有効ならすぐに返す（パフォーマンス最適化）
		const cached = this.getCachedTimelineCards();
		if (cached) {
			return cached;
		}

		// リフレッシュ時に最新データを取り込む
		await this.reloadFromDisk();

		const targetFiles = this.getTargetFiles();

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

		const cards = await this.mapWithConcurrency(
			result.selectedPaths,
			TimelineNoteLauncherPlugin.CREATE_CARD_CONCURRENCY,
			async (path) =>
				createTimelineCard(
					this.app,
					fileMap.get(path)!,
					this.data.reviewLogs[path],
					this.data.settings,
					backlinkIndex
				)
		);

		// 選択されたカードのlastSelectedAtを更新（公平ランダム用）
		const now = Date.now();
		for (const path of result.selectedPaths) {
			if (!this.data.reviewLogs[path]) {
				this.data.reviewLogs[path] = {
					lastReviewedAt: null,
					reviewCount: 0,
					nextReviewAt: null,
					difficulty: 2.5,
					interval: 0,
					easeFactor: 2.5,
					lastSelectedAt: now,
				};
			} else {
				this.data.reviewLogs[path].lastSelectedAt = now;
			}
		}
		// バックグラウンドで保存（UIをブロックしない）
		void this.syncAndSave();

		const timelineResult = { cards, newCount: result.newCount, dueCount: result.dueCount };
		this.timelineCardsCache = {
			...timelineResult,
			timestamp: Date.now(),
		};
		return timelineResult;
	}

	/**
	 * 最新の new / due 件数のみを軽量に再集計する
	 * カード本体キャッシュや createTimelineCard は使わない
	 */
	async getLatestNewDueCounts(): Promise<{ newCount: number; dueCount: number }> {
		await this.reloadFromDisk();

		const targetFiles = this.getTargetFiles();
		let newCount = 0;
		let dueCount = 0;

		for (const file of targetFiles) {
			const candidate = createCandidateCard(this.app, file, this.data.reviewLogs[file.path], this.data.settings);
			if (candidate.isNew) newCount++;
			if (candidate.isDue) dueCount++;
		}

		return { newCount, dueCount };
	}

	private getTargetFiles(): TFile[] {
		const settingsKey = this.buildTargetFilesCacheKey();
		const now = Date.now();
		if (
			this.targetFilesCache &&
			this.targetFilesCache.settingsKey === settingsKey &&
			now - this.targetFilesCache.timestamp < TimelineNoteLauncherPlugin.TARGET_FILES_CACHE_TTL
		) {
			return this.targetFilesCache.files;
		}

		const files = enumerateTargetNotes(this.app, this.data.settings);
		this.targetFilesCache = {
			files,
			settingsKey,
			timestamp: now,
		};
		return files;
	}

	private buildTargetFilesCacheKey(): string {
		const { targetFolders, excludeFolders, targetTags } = this.data.settings;
		return [
			[...targetFolders].sort().join('|'),
			[...excludeFolders].sort().join('|'),
			[...targetTags].sort().join('|'),
		].join('::');
	}

	private invalidateTargetFilesCache(): void {
		this.targetFilesCache = null;
	}

	private async mapWithConcurrency<T, R>(
		items: readonly T[],
		concurrency: number,
		mapper: (item: T) => Promise<R>
	): Promise<R[]> {
		if (items.length === 0) return [];

		const results = new Array<R>(items.length);
		let nextIndex = 0;
		const workerCount = Math.min(Math.max(concurrency, 1), items.length);

		const worker = async (): Promise<void> => {
			while (true) {
				const current = nextIndex;
				nextIndex++;
				if (current >= items.length) break;
				results[current] = await mapper(items[current]!);
			}
		};

		await Promise.all(Array.from({ length: workerCount }, () => worker()));
		return results;
	}

	/**
	 * 直近のタイムラインカードキャッシュを取得（短TTL）
	 */
	getCachedTimelineCards(): { cards: TimelineCard[]; newCount: number; dueCount: number } | null {
		if (!this.timelineCardsCache) return null;
		const age = Date.now() - this.timelineCardsCache.timestamp;
		if (age > TimelineNoteLauncherPlugin.TIMELINE_CACHE_TTL) return null;
		return {
			cards: this.timelineCardsCache.cards,
			newCount: this.timelineCardsCache.newCount,
			dueCount: this.timelineCardsCache.dueCount,
		};
	}

	/**
	 * タイムラインキャッシュを無効化
	 */
	invalidateTimelineCache(): void {
		this.timelineCardsCache = null;
	}

	private async enqueueSaveQueue(task: () => Promise<void>): Promise<void> {
		this.saveQueueDepth++;
		const runner = async (): Promise<void> => {
			try {
				await task();
			} finally {
				this.saveQueueDepth = Math.max(0, this.saveQueueDepth - 1);
			}
		};
		this.saveQueue = this.saveQueue.then(runner, runner);
		await this.saveQueue;
	}

	private scheduleReloadAfterQueue(): void {
		if (this.reloadAfterQueueScheduled) return;
		this.reloadAfterQueueScheduled = true;
		void this.saveQueue.then(async () => {
			this.reloadAfterQueueScheduled = false;
			await this.reloadFromDisk(true);
		});
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
		this.invalidateTimelineCache();

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

		await this.syncAndSave();
	}

	/**
	 * ピン留め状態を切り替える（frontmatter `pinned` を反転）
	 */
	async togglePin(path: string): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || !(file instanceof TFile)) return false;
		let nowPinned = false;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			nowPinned = fm.pinned !== true;
			if (nowPinned) {
				fm.pinned = true;
			} else {
				delete fm.pinned;
			}
		});
		this.invalidateTimelineCache();
		return nowPinned;
	}

	/**
	 * カードを評価（SRSレビュー）
	 */
	async rateCard(path: string, rating: DifficultyRating): Promise<void> {
		const wasNew = !this.data.reviewLogs[path] || this.data.reviewLogs[path]?.reviewCount === 0;
		this.invalidateTimelineCache();

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

		await this.syncAndSave();
	}

	/**
	 * 評価を取り消し（Undo）
	 */
	async undoRating(path: string): Promise<boolean> {
		const snapshot = this.ratingUndoMap.get(path);
		if (!snapshot) return false;
		this.invalidateTimelineCache();

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

		await this.syncAndSave();
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
		this.invalidateTargetFilesCache();
		this.invalidateTimelineCache();
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
		await this.syncAndSave();
	}

	/**
	 * コメントドラフトを削除
	 */
	async deleteCommentDraft(path: string): Promise<void> {
		delete this.data.commentDrafts[path];
		await this.syncAndSave();
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
		await this.syncAndSave();
	}

	/**
	 * 引用ノートドラフトを削除
	 */
	async deleteQuoteNoteDraft(path: string): Promise<void> {
		delete this.data.quoteNoteDrafts[path];
		await this.syncAndSave();
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

	/**
	 * フィルタープリセットを取得
	 */
	getFilterPresets(): FilterPreset[] {
		return this.data.filterPresets ?? [];
	}

	/**
	 * フィルタープリセットを保存
	 */
	async saveFilterPreset(preset: FilterPreset): Promise<void> {
		if (!this.data.filterPresets) {
			this.data.filterPresets = [];
		}
		const existingIndex = this.data.filterPresets.findIndex(p => p.id === preset.id);
		if (existingIndex >= 0) {
			this.data.filterPresets[existingIndex] = preset;
		} else {
			this.data.filterPresets.push(preset);
		}
		await this.syncAndSave();
	}

	/**
	 * フィルタープリセットを削除
	 */
	async deleteFilterPreset(id: string): Promise<void> {
		if (!this.data.filterPresets) return;
		this.data.filterPresets = this.data.filterPresets.filter(p => p.id !== id);
		await this.syncAndSave();
	}

	/**
	 * 検索索引を全ノートから再構築
	 */
	async rebuildSearchIndex(): Promise<void> {
		if (this.searchIndexRebuilding) {
			new Notice('索引構築中です。完了までお待ちください。');
			return;
		}
		this.searchIndexRebuilding = true;
		const startedAt = Date.now();
		new Notice('検索索引を構築中...');

		try {
			const files = enumerateTargetNotes(this.app, this.data.settings);
			const texts: Array<{ path: string; text: string }> = [];

			// 並列に本文抽出（concurrency 制限）
			const extracted = await this.mapWithConcurrency(
				files,
				TimelineNoteLauncherPlugin.CREATE_CARD_CONCURRENCY,
				async (file) => {
					const text = await extractSearchableText(this.app, file);
					return { path: file.path, text };
				}
			);
			for (const item of extracted) {
				if (item.text.trim().length > 0) {
					texts.push(item);
				}
			}

			this.searchIndex.build(texts);
			const docCount = this.searchIndex.getDocCount();
			this.data.searchIndex = this.searchIndex.serialize();
			this.data.searchIndexBuiltAt = Date.now();
			this.data.searchIndexDocCount = docCount;
			await this.syncAndSave();

			const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
			new Notice(`検索索引を構築しました (${docCount}件 / ${elapsed}秒)`);
		} catch (error) {
			console.error('Failed to rebuild search index:', error);
			new Notice('索引構築に失敗しました。');
		} finally {
			this.searchIndexRebuilding = false;
		}
	}

	/**
	 * 単一ファイルの索引を差分更新
	 */
	private async updateSearchIndexForFile(file: TFile): Promise<void> {
		try {
			const text = await extractSearchableText(this.app, file);
			if (text.trim().length === 0) {
				this.searchIndex.removeDoc(file.path);
			} else {
				this.searchIndex.updateDoc(file.path, text);
			}
			this.data.searchIndexDocCount = this.searchIndex.getDocCount();
			// 頻繁な更新での I/O を避けるため、シリアライズ保存は手動再構築時のみ
		} catch (error) {
			console.error('Failed to update search index for file:', file.path, error);
		}
	}

	/**
	 * 類似ノート検索モーダルを開く
	 */
	async openFindSimilarModal(): Promise<void> {
		if (!this.searchIndex.isBuilt()) {
			new Notice('検索索引が未構築です。設定から索引を構築してください。');
			return;
		}
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('対象となるノートがアクティブではありません。');
			return;
		}
		const queryText = await extractSearchableText(this.app, activeFile);
		if (queryText.trim().length === 0) {
			new Notice('対象ノートから検索テキストを抽出できませんでした。');
			return;
		}
		new SimilarNotesModal(this.app, this, activeFile, queryText).open();
	}

	/**
	 * ノートがいいね済みか判定
	 */
	isLiked(path: string): boolean {
		return this.data.likedNotes[path] !== undefined;
	}

	/**
	 * いいねをトグル（追加/解除）
	 * @returns トグル後の状態（true=いいね中）
	 */
	async toggleLike(path: string): Promise<boolean> {
		const liked = this.isLiked(path);
		if (liked) {
			delete this.data.likedNotes[path];
		} else {
			this.data.likedNotes[path] = Date.now();
		}
		await this.syncAndSave();
		return !liked;
	}

	/**
	 * ディスクから再読み込み→マージ→保存（同期セーフ）
	 * saveQueue で直列化して競合を防止
	 */
	async syncAndSave(): Promise<void> {
		await this.enqueueSaveQueue(async () => {
			try {
				const diskRaw = await this.loadData() as Partial<PluginData> | null;
				const remote = reconstructFullData(diskRaw);
				this.data = mergePluginData(this.data, remote);
			} catch {
				// loadData失敗時はローカルをそのまま保存
			}
			await this.saveData(this.data);
		});
	}

	/**
	 * ディスクからリロードしてマージ（保存なし・読み取り専用）
	 * アプリ復帰時やタイムラインリフレッシュ時に使用
	 */
	private async reloadFromDisk(force: boolean = false): Promise<void> {
		const now = Date.now();
		if (!force && now - this.lastReloadFromDiskAt < TimelineNoteLauncherPlugin.RELOAD_FROM_DISK_DEBOUNCE_MS) {
			return;
		}
		// saveキューが混雑している場合は表示をブロックしない
		if (!force && this.saveQueueDepth > 0) {
			this.scheduleReloadAfterQueue();
			return;
		}
		this.lastReloadFromDiskAt = Date.now();

		await this.enqueueSaveQueue(async () => {
			try {
				const diskRaw = await this.loadData() as Partial<PluginData> | null;
				const remote = reconstructFullData(diskRaw);
				this.data = mergePluginData(this.data, remote);
				this.lastReloadFromDiskAt = Date.now();
			} catch {
				// loadData失敗時はローカルをそのまま維持
			}
		});
	}
}
