// Timeline Note Launcher - Type Definitions

/** 驕ｸ謚槭Δ繝ｼ繝・*/
export type SelectionMode = 'random' | 'age-priority' | 'srs';

/** SRS繝ｬ繝薙Η繝ｼ陦ｨ遉ｺ縺ｮ蟄占ｦ∵ｪ・*/
export type SrsReviewUnlockMode = 'daily-quota' | 'new-zero';

/** 繝励Ξ繝薙Η繝ｼ陦ｨ遉ｺ繝｢繝ｼ繝・*/
export type PreviewMode = 'lines' | 'half' | 'full';

/** 陦ｨ遉ｺ繝｢繝ｼ繝・*/
export type ViewMode = 'list' | 'grid';

/** 繧ｫ繝ｩ繝ｼ繝・・繝・*/
export type ColorTheme = 'default' | 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'red' | 'cyan' | 'yellow';

/** UI繝・・繝・*/
export type UITheme = 'classic' | 'twitter';

/** 髮｣譏灘ｺｦ隧穂ｾ｡ */
export type DifficultyRating = 'again' | 'hard' | 'good' | 'easy';

/** 逕ｻ蜒上し繧､繧ｺ繝｢繝ｼ繝・*/
export type ImageSizeMode = 'small' | 'medium' | 'large' | 'full';

/** 繝輔ぃ繧､繝ｫ繧ｿ繧､繝・*/
export type FileType = 'markdown' | 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'office' | 'ipynb' | 'other';

/** 繝弱・繝医＃縺ｨ縺ｮ繝ｬ繝薙Η繝ｼ繝ｭ繧ｰ・・ata.json 縺ｫ菫晏ｭ假ｼ・*/
export interface NoteReviewLog {
	lastReviewedAt: number | null;  // Unix timestamp
	reviewCount: number;
	// SRS逕ｨ繝輔ぅ繝ｼ繝ｫ繝・
	nextReviewAt: number | null;    // 谺｡蝗槭Ξ繝薙Η繝ｼ莠亥ｮ壽律・・nix timestamp・・
	difficulty: number;              // 髮｣譏灘ｺｦ菫よ焚・・.3縲・.5縲√ョ繝輔か繝ｫ繝・.5・・
	interval: number;                // 迴ｾ蝨ｨ縺ｮ髢馴囈・域律謨ｰ・・
	easeFactor: number;
	lastSelectedAt?: number;         // 最後にタイムラインに表示された日時（公平ランダム用）
}

/** 隧穂ｾ｡蜿悶ｊ豸医＠逕ｨ縺ｮ繧ｹ繝翫ャ繝励す繝ｧ繝・ヨ・医そ繝・す繝ｧ繝ｳ髯舌ｊ縲∵ｰｸ邯壼喧縺励↑縺・ｼ・*/
export interface RatingUndoSnapshot {
	previousLog: NoteReviewLog | undefined;  // 隧穂ｾ｡蜑阪・繝ｭ繧ｰ・・ndefined=譛ｪ繝ｬ繝薙Η繝ｼ・・
	wasNew: boolean;                          // 譁ｰ隕上き繝ｼ繝峨□縺｣縺溘°
	fileType: FileType;                       // 繝輔ぃ繧､繝ｫ繧ｿ繧､繝暦ｼ亥ｱ･豁ｴ繝・け繝ｪ繝｡繝ｳ繝育畑・・
}

/** 蜈ｨ繝弱・繝医・繝ｬ繝薙Η繝ｼ繝ｭ繧ｰ */
export interface ReviewLogs {
	[notePath: string]: NoteReviewLog;
}

/** 繝励Λ繧ｰ繧､繝ｳ險ｭ螳・*/
export interface PluginSettings {
	// 蟇ｾ雎｡繝弱・繝・
	targetFolders: string[];
	excludeFolders: string[];
	targetTags: string[];

	// 驕ｸ謚槭Δ繝ｼ繝・
	selectionMode: SelectionMode;

	// 陦ｨ遉ｺ險ｭ螳・
	viewMode: ViewMode;        // 繝ｪ繧ｹ繝・or 繧ｰ繝ｪ繝・ラ
	gridColumns: number;       // 繧ｰ繝ｪ繝・ラ縺ｮ蛻玲焚・・-4・・
	previewMode: PreviewMode;  // 'lines' | 'half' | 'full'
	previewLines: number;      // previewMode 縺・'lines' 縺ｮ譎ゅ・縺ｿ菴ｿ逕ｨ
	colorTheme: ColorTheme;    // 繧ｫ繝ｩ繝ｼ繝・・繝・
	uiTheme: UITheme;          // UI繝・・繝・
	showMeta: boolean;
	enableSplitView: boolean;  // Desktop only
	showDifficultyButtons: boolean;  // 髮｣譏灘ｺｦ繝懊ち繝ｳ繧定｡ｨ遉ｺ
	mobileViewOnDesktop: boolean;  // PC縺ｧ繝｢繝舌う繝ｫ陦ｨ遉ｺ繧剃ｽｿ逕ｨ
	imageSizeMode: ImageSizeMode;  // 逕ｻ蜒上し繧､繧ｺ繝｢繝ｼ繝・

	// 蜍穂ｽ懆ｨｭ螳・
	maxCards: number;            // 繧ｿ繧､繝繝ｩ繧､繝ｳ縺ｫ陦ｨ遉ｺ縺吶ｋ譛螟ｧ繧ｫ繝ｼ繝画焚
	autoRefreshMinutes: number;  // 0 = 謇句虚縺ｮ縺ｿ
	logRetentionDays: number;
	enableInfiniteScroll: boolean;     // 辟｡髯舌せ繧ｯ繝ｭ繝ｼ繝ｫ繧呈怏蜉ｹ蛹・
	infiniteScrollBatchSize: number;   // 荳蠎ｦ縺ｫ繝ｭ繝ｼ繝峨☆繧九き繝ｼ繝画焚

	// SRS險ｭ螳・
	newCardsPerDay: number;          // 1譌･縺ゅ◆繧翫・譁ｰ隕上き繝ｼ繝画焚
	reviewCardsPerDay: number;       // 1譌･縺ゅ◆繧翫・繝ｬ繝薙Η繝ｼ繧ｫ繝ｼ繝画焚
	srsReviewUnlockMode: SrsReviewUnlockMode;  // 繝ｬ繝薙Η繝ｼ繧ｫ繝ｼ繝峨ｒ陦ｨ遉ｺ縺吶ｋ蟄占ｦ∵ｪ・
	initialInterval: number;         // 蛻晏屓豁｣隗｣譎ゅ・髢馴囈・域律・・
	easyBonus: number;               // Easy繝懊・繝翫せ菫よ焚
	srsShowRandomFutureCards: boolean;  // 間隔が長いカードをランダムに表示
	srsRandomFutureCardsPct: number;    // ランダム表示するカードの割合（%）

	// YAML騾｣謳ｺ險ｭ螳・
	yamlDifficultyKey: string;       // 髮｣譏灘ｺｦ繧定ｪｭ縺ｿ蜿悶ｋYAML繧ｭ繝ｼ・育ｩｺ縺ｪ繧臥┌隕厄ｼ・
	yamlPriorityKey: string;         // 蜆ｪ蜈亥ｺｦ繧定ｪｭ縺ｿ蜿悶ｋYAML繧ｭ繝ｼ・育ｩｺ縺ｪ繧臥┌隕厄ｼ・
	yamlDateField: string;           // ノート作成日を読み取るYAMLキー（空なら無効）

	// 蠑慕畑繝弱・繝郁ｨｭ螳・
	quoteNoteTemplate: string;    // 蠑慕畑繝弱・繝育畑繝・Φ繝励Ξ繝ｼ繝・

	// 繧ｯ繧､繝・け繝弱・繝郁ｨｭ螳・
	quickNoteFolder: string;      // 繧ｯ繧､繝・け繝弱・繝医・菫晏ｭ伜・繝輔か繝ｫ繝
	quickNoteTemplate: string;    // 繧ｯ繧､繝・け繝弱・繝育畑繝・Φ繝励Ξ繝ｼ繝・
}

/** 繧ｳ繝｡繝ｳ繝医ラ繝ｩ繝輔ヨ */
export interface CommentDrafts {
	[notePath: string]: string;
}

/** 蠑慕畑繝弱・繝医ラ繝ｩ繝輔ヨ */
export interface QuoteNoteDraft {
	selectedTexts: string[];  // 隍・焚縺ｮ蠑慕畑繝・く繧ｹ繝・
	title: string;
	comment: string;
}

/** 蠑慕畑繝弱・繝医ラ繝ｩ繝輔ヨ荳隕ｧ */
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

/** 譌･縺斐→縺ｮ繝ｬ繝薙Η繝ｼ螻･豁ｴ */
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

/** data.json 縺ｮ讒矩 */
export interface PluginData {
	settings: PluginSettings;
	reviewLogs: ReviewLogs;
	engineVersion: number;
	// 譌･谺｡邨ｱ險・
	dailyStats: {
		date: string;  // YYYY-MM-DD
		newReviewed: number;
		reviewedCount: number;
	};
	// 譌･谺｡繝ｬ繝薙Η繝ｼ螻･豁ｴ・磯℃蜴ｻ30譌･蛻・ｼ・
	reviewHistory: DailyReviewHistory;
	// 繧ｳ繝｡繝ｳ繝医ラ繝ｩ繝輔ヨ
	commentDrafts: CommentDrafts;
	// 蠑慕畑繝弱・繝医ラ繝ｩ繝輔ヨ
	quoteNoteDrafts: QuoteNoteDrafts;
	// フィルタープリセット
	filterPresets: FilterPreset[];
}

/** 繝ｪ繝ｳ繧ｯ諠・ｱ */
export interface LinkedNote {
	path: string;
	title: string;
}

/** 繧ｿ繧､繝繝ｩ繧､繝ｳ縺ｫ陦ｨ遉ｺ縺吶ｋ繧ｫ繝ｼ繝画ュ蝣ｱ */
export interface TimelineCard {
	path: string;
	title: string;
	preview: string;
	fileType: FileType;             // 繝輔ぃ繧､繝ｫ繧ｿ繧､繝・
	extension: string;              // 諡｡蠑ｵ蟄・
	firstImagePath: string | null;  // 譛蛻昴・逕ｻ蜒上・繝代せ・育判蜒上ヵ繧｡繧､繝ｫ縺ｮ蝣ｴ蜷医・閾ｪ霄ｫ・・
	outgoingLinks: LinkedNote[];    // 縺薙・繝弱・繝医°繧峨・繝ｪ繝ｳ繧ｯ
	backlinks: LinkedNote[];        // 縺薙・繝弱・繝医∈縺ｮ繝ｪ繝ｳ繧ｯ
	lastReviewedAt: number | null;
	reviewCount: number;
	pinned: boolean;
	tags: string[];
	// SRS逕ｨ
	nextReviewAt: number | null;
	difficulty: number;
	interval: number;
	isNew: boolean;           // 譛ｪ繝ｬ繝薙Η繝ｼ縺ｮ繧ｫ繝ｼ繝・
	isDue: boolean;           // 繝ｬ繝薙Η繝ｼ譛滄剞蛻ｰ譚･
	// YAML騾｣謳ｺ
	yamlDifficulty: number | null;
	yamlPriority: number | null;
	// 作成日（フィルタリング用）
	createdAt: number | null;
}

/** 驕ｸ謚槭ヵ繧ｧ繝ｼ繧ｺ逕ｨ縺ｮ霆ｽ驥上き繝ｼ繝会ｼ医ヵ繧｡繧､繝ｫI/O縺ｪ縺暦ｼ・*/
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

/** 繝・ヵ繧ｩ繝ｫ繝医・繝ｬ繝薙Η繝ｼ繝ｭ繧ｰ */
export const DEFAULT_REVIEW_LOG: NoteReviewLog = {
	lastReviewedAt: null,
	reviewCount: 0,
	nextReviewAt: null,
	difficulty: 2.5,
	interval: 0,
	easeFactor: 2.5,
};

/** 繝・ヵ繧ｩ繝ｫ繝医け繧､繝・け繝弱・繝医ユ繝ｳ繝励Ξ繝ｼ繝・*/
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

/** 繝・ヵ繧ｩ繝ｫ繝亥ｼ慕畑繝弱・繝医ユ繝ｳ繝励Ξ繝ｼ繝・*/
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

> [!quote] [[{{originalNote}}]]繧医ｊ
{{quotedText}}

{{comment}}
`;

/** 繝悶ャ繧ｯ繝槭・繧ｯ繧｢繧､繝・Β・・bsidian 蜀・Κ API・・*/
export interface BookmarkItem {
	type: string;
	path?: string;
	title?: string;
}

/** 繝悶ャ繧ｯ繝槭・繧ｯ繝励Λ繧ｰ繧､繝ｳ繧､繝ｳ繧ｹ繧ｿ繝ｳ繧ｹ・・bsidian 蜀・Κ API・・*/
export interface BookmarkPluginInstance {
	items: BookmarkItem[];
	addItem(item: BookmarkItem): void;
	removeItem(item: BookmarkItem): void;
}

/** 繝悶ャ繧ｯ繝槭・繧ｯ蜀・Κ繝励Λ繧ｰ繧､繝ｳ・・bsidian 蜀・Κ API・・*/
export interface BookmarkInternalPlugin {
	enabled: boolean;
	instance: BookmarkPluginInstance | null;
}

/** 繝・ヵ繧ｩ繝ｫ繝郁ｨｭ螳・*/
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
	// SRS險ｭ螳・
	newCardsPerDay: 20,
	reviewCardsPerDay: 100,
	srsReviewUnlockMode: 'daily-quota',
	initialInterval: 1,
	easyBonus: 1.3,
	srsShowRandomFutureCards: false,
	srsRandomFutureCardsPct: 10,
	// YAML騾｣謳ｺ
	yamlDifficultyKey: '',
	yamlPriorityKey: '',
	yamlDateField: '',
	// 蠑慕畑繝弱・繝・
	quoteNoteTemplate: DEFAULT_QUOTE_NOTE_TEMPLATE,
	// 繧ｯ繧､繝・け繝弱・繝・
	quickNoteFolder: '',
	quickNoteTemplate: DEFAULT_QUICK_NOTE_TEMPLATE,
};

/** 繝・ヵ繧ｩ繝ｫ繝医ョ繝ｼ繧ｿ */
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

/** 莉頑律縺ｮ譌･莉俶枚蟄怜・繧貞叙蠕・*/
export function getTodayString(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}





