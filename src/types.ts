// Timeline Note Launcher - Type Definitions

/** 選択モーチE*/
export type SelectionMode = 'random' | 'age-priority' | 'srs';

/** SRSレビュー表示の子要檁E*/
export type SrsReviewUnlockMode = 'daily-quota' | 'new-zero';

/** プレビュー表示モーチE*/
export type PreviewMode = 'lines' | 'half' | 'full';

/** 表示モーチE*/
export type ViewMode = 'list' | 'grid';

/** カラーチE�EチE*/
export type ColorTheme = 'default' | 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'red' | 'cyan' | 'yellow';

/** UIチE�EチE*/
export type UITheme = 'classic' | 'twitter';

/** 難易度評価 */
export type DifficultyRating = 'again' | 'hard' | 'good' | 'easy';

/** 画像サイズモーチE*/
export type ImageSizeMode = 'small' | 'medium' | 'large' | 'full';

/** ファイルタイチE*/
export type FileType = 'markdown' | 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'office' | 'ipynb' | 'other';

/** ノ�Eトごとのレビューログ�E�Eata.json に保存！E*/
export interface NoteReviewLog {
	lastReviewedAt: number | null;  // Unix timestamp
	reviewCount: number;
	// SRS用フィールチE
	nextReviewAt: number | null;    // 次回レビュー予定日�E�Enix timestamp�E�E
	difficulty: number;              // 難易度係数�E�E.3、E.5、デフォルチE.5�E�E
	interval: number;                // 現在の間隔�E�日数�E�E
	easeFactor: number;              // 易しさ係数�E�EM-2アルゴリズム用�E�E
}

/** 評価取り消し用のスナップショチE���E�セチE��ョン限り、永続化しなぁE��E*/
export interface RatingUndoSnapshot {
	previousLog: NoteReviewLog | undefined;  // 評価前�Eログ�E�Endefined=未レビュー�E�E
	wasNew: boolean;                          // 新規カードだったか
	fileType: FileType;                       // ファイルタイプ（履歴チE��リメント用�E�E
}

/** 全ノ�Eト�Eレビューログ */
export interface ReviewLogs {
	[notePath: string]: NoteReviewLog;
}

/** プラグイン設宁E*/
export interface PluginSettings {
	// 対象ノ�EチE
	targetFolders: string[];
	excludeFolders: string[];
	targetTags: string[];

	// 選択モーチE
	selectionMode: SelectionMode;

	// 表示設宁E
	viewMode: ViewMode;        // リスチEor グリチE��
	gridColumns: number;       // グリチE��の列数�E�E-4�E�E
	previewMode: PreviewMode;  // 'lines' | 'half' | 'full'
	previewLines: number;      // previewMode ぁE'lines' の時�Eみ使用
	colorTheme: ColorTheme;    // カラーチE�EチE
	uiTheme: UITheme;          // UIチE�EチE
	showMeta: boolean;
	enableSplitView: boolean;  // Desktop only
	showDifficultyButtons: boolean;  // 難易度ボタンを表示
	mobileViewOnDesktop: boolean;  // PCでモバイル表示を使用
	imageSizeMode: ImageSizeMode;  // 画像サイズモーチE

	// 動作設宁E
	maxCards: number;            // タイムラインに表示する最大カード数
	autoRefreshMinutes: number;  // 0 = 手動のみ
	logRetentionDays: number;
	enableInfiniteScroll: boolean;     // 無限スクロールを有効匁E
	infiniteScrollBatchSize: number;   // 一度にロードするカード数

	// SRS設宁E
	newCardsPerDay: number;          // 1日あたり�E新規カード数
	reviewCardsPerDay: number;       // 1日あたり�Eレビューカード数
	srsReviewUnlockMode: SrsReviewUnlockMode;  // レビューカードを表示する子要檁E
	initialInterval: number;         // 初回正解時�E間隔�E�日�E�E
	easyBonus: number;               // Easyボ�Eナス係数

	// YAML連携設宁E
	yamlDifficultyKey: string;       // 難易度を読み取るYAMLキー�E�空なら無視！E
	yamlPriorityKey: string;         // 優先度を読み取るYAMLキー�E�空なら無視！E

	// 引用ノ�Eト設宁E
	quoteNoteTemplate: string;    // 引用ノ�Eト用チE��プレーチE

	// クイチE��ノ�Eト設宁E
	quickNoteFolder: string;      // クイチE��ノ�Eト�E保存�Eフォルダ
	quickNoteTemplate: string;    // クイチE��ノ�Eト用チE��プレーチE
}

/** コメントドラフト */
export interface CommentDrafts {
	[notePath: string]: string;
}

/** 引用ノ�Eトドラフト */
export interface QuoteNoteDraft {
	selectedTexts: string[];  // 褁E��の引用チE��スチE
	title: string;
	comment: string;
}

/** 引用ノ�Eトドラフト一覧 */
export interface QuoteNoteDrafts {
	[sourcePath: string]: QuoteNoteDraft;
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
	// 日次統訁E
	dailyStats: {
		date: string;  // YYYY-MM-DD
		newReviewed: number;
		reviewedCount: number;
	};
	// 日次レビュー履歴�E�過去30日刁E��E
	reviewHistory: DailyReviewHistory;
	// コメントドラフト
	commentDrafts: CommentDrafts;
	// 引用ノ�Eトドラフト
	quoteNoteDrafts: QuoteNoteDrafts;
}

/** リンク惁E�� */
export interface LinkedNote {
	path: string;
	title: string;
}

/** タイムラインに表示するカード情報 */
export interface TimelineCard {
	path: string;
	title: string;
	preview: string;
	fileType: FileType;             // ファイルタイチE
	extension: string;              // 拡張孁E
	firstImagePath: string | null;  // 最初�E画像�Eパス�E�画像ファイルの場合�E自身�E�E
	outgoingLinks: LinkedNote[];    // こ�Eノ�Eトから�Eリンク
	backlinks: LinkedNote[];        // こ�Eノ�Eトへのリンク
	lastReviewedAt: number | null;
	reviewCount: number;
	pinned: boolean;
	tags: string[];
	// SRS用
	nextReviewAt: number | null;
	difficulty: number;
	interval: number;
	isNew: boolean;           // 未レビューのカーチE
	isDue: boolean;           // レビュー期限到来
	// YAML連携
	yamlDifficulty: number | null;
	yamlPriority: number | null;
}

/** 選択フェーズ用の軽量カード（ファイルI/Oなし！E*/
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
}

/** チE��ォルト�Eレビューログ */
export const DEFAULT_REVIEW_LOG: NoteReviewLog = {
	lastReviewedAt: null,
	reviewCount: 0,
	nextReviewAt: null,
	difficulty: 2.5,
	interval: 0,
	easeFactor: 2.5,
};

/** チE��ォルトクイチE��ノ�EトテンプレーチE*/
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

/** チE��ォルト引用ノ�EトテンプレーチE*/
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

/** ブックマ�EクアイチE���E�Ebsidian 冁E�� API�E�E*/
export interface BookmarkItem {
	type: string;
	path?: string;
	title?: string;
}

/** ブックマ�Eクプラグインインスタンス�E�Ebsidian 冁E�� API�E�E*/
export interface BookmarkPluginInstance {
	items: BookmarkItem[];
	addItem(item: BookmarkItem): void;
	removeItem(item: BookmarkItem): void;
}

/** ブックマ�Eク冁E��プラグイン�E�Ebsidian 冁E�� API�E�E*/
export interface BookmarkInternalPlugin {
	enabled: boolean;
	instance: BookmarkPluginInstance | null;
}

/** チE��ォルト設宁E*/
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
	// SRS設宁E
	newCardsPerDay: 20,
	reviewCardsPerDay: 100,
	srsReviewUnlockMode: 'daily-quota',
	initialInterval: 1,
	easyBonus: 1.3,
	// YAML連携
	yamlDifficultyKey: '',
	yamlPriorityKey: '',
	// 引用ノ�EチE
	quoteNoteTemplate: DEFAULT_QUOTE_NOTE_TEMPLATE,
	// クイチE��ノ�EチE
	quickNoteFolder: '',
	quickNoteTemplate: DEFAULT_QUICK_NOTE_TEMPLATE,
};

/** チE��ォルトデータ */
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
};

/** 今日の日付文字�Eを取征E*/
export function getTodayString(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}




