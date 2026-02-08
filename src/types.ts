// Timeline Note Launcher - Type Definitions

/** 選択モード */
export type SelectionMode = 'random' | 'age-priority' | 'srs';

/** SRSレビュー表示の条件 */
export type SrsReviewUnlockMode = 'daily-quota' | 'new-zero';

/** プレビュー表示モード */
export type PreviewMode = 'lines' | 'half' | 'full';

/** 表示モード */
export type ViewMode = 'list' | 'grid';

/** カラーテーマ */
export type ColorTheme = 'default' | 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'red' | 'cyan' | 'yellow';

/** UIテーマ */
export type UITheme = 'classic' | 'twitter';

/** 難易度評価 */
export type DifficultyRating = 'again' | 'hard' | 'good' | 'easy';

/** 画像サイズモード */
export type ImageSizeMode = 'small' | 'medium' | 'large' | 'full';

/** ファイルタイプ */
export type FileType = 'markdown' | 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'office' | 'ipynb' | 'other';

/** ノートごとのレビューログ（data.json に保存） */
export interface NoteReviewLog {
	lastReviewedAt: number | null;  // Unix timestamp
	reviewCount: number;
	// SRS用フィールド
	nextReviewAt: number | null;    // 次回レビュー予定日（Unix timestamp）
	difficulty: number;              // 難易度係数（1.3〜2.5、デフォルト2.5）
	interval: number;                // 現在の間隔（日数）
	easeFactor: number;
	lastSelectedAt?: number;         // 最後にタイムラインに表示された日時（公平ランダム用）
}

/** 評価取り消し用のスナップショット（セッション限り、永続化しない） */
export interface RatingUndoSnapshot {
	previousLog: NoteReviewLog | undefined;  // 評価前のログ（undefined=未レビュー）
	wasNew: boolean;                          // 新規カードだったか
	fileType: FileType;                       // ファイルタイプ（翌年デクリメント用）
}

/** 全ノートのレビューログ */
export interface ReviewLogs {
	[notePath: string]: NoteReviewLog;
}

/** プラグイン設定 */
export interface PluginSettings {
	// 対象ノート
	targetFolders: string[];
	excludeFolders: string[];
	targetTags: string[];

	// 選択モード
	selectionMode: SelectionMode;

	// 表示設定
	viewMode: ViewMode;        // リスト or グリッド
	gridColumns: number;       // グリッドの列数（2-4）
	previewMode: PreviewMode;  // 'lines' | 'half' | 'full'
	previewLines: number;      // previewMode が 'lines' の時のみ使用
	colorTheme: ColorTheme;    // カラーテーマ
	uiTheme: UITheme;          // UIテーマ
	showMeta: boolean;
	enableSplitView: boolean;  // Desktop only
	showDifficultyButtons: boolean;  // 難易度ボタンを表示
	mobileViewOnDesktop: boolean;  // PCでモバイル表示を使用
	imageSizeMode: ImageSizeMode;  // 画像サイズモード

	// 動作設定
	maxCards: number;            // タイムラインに表示する最大カード数
	autoRefreshMinutes: number;  // 0 = 手動のみ
	logRetentionDays: number;
	enableInfiniteScroll: boolean;     // 無限スクロールを有効化
	infiniteScrollBatchSize: number;   // 一度にロードするカード数

	// SRS設定
	newCardsPerDay: number;          // 1日あたりの新規カード数
	reviewCardsPerDay: number;       // 1日あたりのレビューカード数
	srsReviewUnlockMode: SrsReviewUnlockMode;  // レビューカードを表示する条件
	initialInterval: number;         // 初回正解時の間隔（日）
	easyBonus: number;               // Easyボーナス係数
	srsShowRandomFutureCards: boolean;  // 間隔が長いカードをランダムに表示
	srsRandomFutureCardsPct: number;    // ランダム表示するカードの割合（%）

	// YAML連携設定
	yamlDifficultyKey: string;       // 難易度を読み取るYAMLキー（空なら無効）
	yamlPriorityKey: string;         // 優先度を読み取るYAMLキー（空なら無効）
	yamlDateField: string;           // ノート作成日を読み取るYAMLキー（空なら無効）

	// 引用ノート設定
	quoteNoteTemplate: string;    // 引用ノート用テンプレート

	// クイックノート設定
	quickNoteFolder: string;      // クイックノートの保存先フォルダ
	quickNoteTemplate: string;    // クイックノート用テンプレート
}

/** コメントドラフト */
export interface CommentDrafts {
	[notePath: string]: string;
}

/** 引用ノートドラフト */
export interface QuoteNoteDraft {
	selectedTexts: string[];  // 複数の引用テキスト
	title: string;
	comment: string;
}

/** 引用ノートドラフト一覧 */
export interface QuoteNoteDrafts {
	[sourcePath: string]: QuoteNoteDraft;
}

/** フィルタープリセット */
export interface FilterPreset {
	id: string;                    // 一意のID
	name: string;                  // プリセット名
	searchQuery: string;           // 検索クエリ
	fileTypeFilters: string[];     // 有効なファイルタイプ
	selectedTags: string[];        // 選択されたタグ
	dateFilterStart: string;       // 開始日（YYYY-MM-DD、空なら無制限）
	dateFilterEnd: string;         // 終了日（YYYY-MM-DD、空なら無制限）
}

/** 日ごとのレビュー履歴 */
export interface DailyReviewHistory {
	[date: string]: {  // YYYY-MM-DD
		newReviewed: number;
		reviewedCount: number;
		fileTypes: {
			markdown: number;
			text: number;
			image: number;
			pdf: number;
			audio: number;
			video: number;
			office: number;
			ipynb: number;
			other: number;
		};
	};
}

/** data.json の構造 */
export interface PluginData {
	settings: PluginSettings;
	reviewLogs: ReviewLogs;
	engineVersion: number;
	// 日次統計
	dailyStats: {
		date: string;  // YYYY-MM-DD
		newReviewed: number;
		reviewedCount: number;
	};
	// 日次レビュー履歴（過去30日分）
	reviewHistory: DailyReviewHistory;
	// コメントドラフト
	commentDrafts: CommentDrafts;
	// 引用ノートドラフト
	quoteNoteDrafts: QuoteNoteDrafts;
	// フィルタープリセット
	filterPresets: FilterPreset[];
}

/** リンク情報 */
export interface LinkedNote {
	path: string;
	title: string;
}

/** タイムラインに表示するカード情報 */
export interface TimelineCard {
	path: string;
	title: string;
	preview: string;
	fileType: FileType;             // ファイルタイプ
	extension: string;              // 拡張子
	firstImagePath: string | null;  // 最初の画像のパス（画像ファイルの場合は自身）
	outgoingLinks: LinkedNote[];    // このノートからのリンク
	backlinks: LinkedNote[];        // このノートへのリンク
	lastReviewedAt: number | null;
	reviewCount: number;
	pinned: boolean;
	tags: string[];
	// SRS用
	nextReviewAt: number | null;
	difficulty: number;
	interval: number;
	isNew: boolean;           // 未レビューのカード
	isDue: boolean;           // レビュー期限到来
	// YAML連携
	yamlDifficulty: number | null;
	yamlPriority: number | null;
	// 作成日（フィルタリング用）
	createdAt: number | null;
}

/** 選択フェーズ用の軽量カード（ファイルI/Oなし） */
export interface CandidateCard {
	path: string;
	fileType: FileType;
	extension: string;
	lastReviewedAt: number | null;
	reviewCount: number;
	nextReviewAt: number | null;
	isNew: boolean;
	isDue: boolean;
	pinned: boolean;
	yamlPriority: number | null;
	createdAt: number | null;        // ノート作成日（YAMLまたはファイルctime）
	lastSelectedAt: number | null;   // 最後にタイムラインに表示された日時
}

/** デフォルトのレビューログ */
export const DEFAULT_REVIEW_LOG: NoteReviewLog = {
	lastReviewedAt: null,
	reviewCount: 0,
	nextReviewAt: null,
	difficulty: 2.5,
	interval: 0,
	easeFactor: 2.5,
};

/** デフォルトクイックノートテンプレート */
export const DEFAULT_QUICK_NOTE_TEMPLATE = `---
uid: {{uid}}
title: {{title}}
aliases:
tags:
publish: false
created: {{date}}
updated: {{date}}
---

{{content}}
`;

/** デフォルト引用ノートテンプレート */
export const DEFAULT_QUOTE_NOTE_TEMPLATE = `---
uid: {{uid}}
title: {{title}}
aliases:
tags:
publish: false
created: {{date}}
updated: {{date}}
reference: [[{{originalNote}}]]
---

> [!quote] [[{{originalNote}}]]より
{{quotedText}}

{{comment}}
`;

/** ブックマークアイテム（Obsidian 内部 API） */
export interface BookmarkItem {
	type: string;
	path?: string;
	title?: string;
}

/** ブックマークプラグインインスタンス（Obsidian 内部 API） */
export interface BookmarkPluginInstance {
	items: BookmarkItem[];
	addItem(item: BookmarkItem): void;
	removeItem(item: BookmarkItem): void;
}

/** ブックマーク内部プラグイン（Obsidian 内部 API） */
export interface BookmarkInternalPlugin {
	enabled: boolean;
	instance: BookmarkPluginInstance | null;
}

/** デフォルト設定 */
export const DEFAULT_SETTINGS: PluginSettings = {
	targetFolders: [],
	excludeFolders: [],
	targetTags: [],
	selectionMode: 'random',
	viewMode: 'list',
	gridColumns: 3,
	previewMode: 'half',
	previewLines: 3,
	colorTheme: 'default',
	uiTheme: 'classic',
	showMeta: true,
	enableSplitView: false,
	showDifficultyButtons: true,
	mobileViewOnDesktop: false,
	imageSizeMode: 'medium',
	maxCards: 50,
	autoRefreshMinutes: 0,
	logRetentionDays: 90,
	enableInfiniteScroll: false,
	infiniteScrollBatchSize: 20,
	// SRS設定
	newCardsPerDay: 20,
	reviewCardsPerDay: 100,
	srsReviewUnlockMode: 'daily-quota',
	initialInterval: 1,
	easyBonus: 1.3,
	srsShowRandomFutureCards: false,
	srsRandomFutureCardsPct: 10,
	// YAML連携
	yamlDifficultyKey: '',
	yamlPriorityKey: '',
	yamlDateField: '',
	// 引用ノート
	quoteNoteTemplate: DEFAULT_QUOTE_NOTE_TEMPLATE,
	// クイックノート
	quickNoteFolder: '',
	quickNoteTemplate: DEFAULT_QUICK_NOTE_TEMPLATE,
};

/** デフォルトデータ */
export const DEFAULT_DATA: PluginData = {
	settings: DEFAULT_SETTINGS,
	reviewLogs: {},
	engineVersion: 2,
	dailyStats: {
		date: '',
		newReviewed: 0,
		reviewedCount: 0,
	},
	reviewHistory: {},
	commentDrafts: {},
	quoteNoteDrafts: {},
	filterPresets: [],
};

/** 本日の日付文字列を取得 */
export function getTodayString(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
