// Timeline Note Launcher - Data Layer
import { App, TFile, TFolder, CachedMetadata, Vault } from 'obsidian';
import {
	PluginSettings,
	NoteReviewLog,
	TimelineCard,
	CandidateCard,
	LinkedNote,
	FileType,
	BookmarkInternalPlugin,
	DEFAULT_REVIEW_LOG,
} from './types';
import { parseJupyterNotebook, buildNotebookPreview } from './notebookParser';
import { parseCanvas, buildCanvasPreview } from './canvasParser';
import { extractFirstImage, getPreviewText } from './contentPreview';

// re-export: 他ファイルからの既存importを維持
export { parseJupyterNotebook, buildNotebookPreview } from './notebookParser';
export type { ParsedNotebook } from './notebookParser';

/**
 * テキストとして読み取れるファイルタイプか判定
 */
export function isTextReadableFile(fileType: FileType): boolean {
	return fileType === 'markdown' || fileType === 'text';
}

// re-export: ノート注釈関数
export { getCompanionNotePath, getOrCreateCompanionNote, appendCommentToNote, appendLinksToNote, createQuoteNote } from './noteAnnotation';

/** テキスト拡張子 */
const TEXT_EXTENSIONS = ['txt', 'text', 'log', 'ini', 'cfg', 'conf', 'json', 'xml', 'yaml', 'yml', 'toml', 'csv', 'tsv'];

/** 画像拡張子 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'avif'];

/** PDF拡張子 */
const PDF_EXTENSIONS = ['pdf'];

/** 音声拡張子 */
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma'];

/** 動画拡張子 */
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv'];

/** Office拡張子 */
const OFFICE_EXTENSIONS = ['pptx', 'ppt', 'docx', 'doc', 'xlsx', 'xls', 'odt', 'ods', 'odp'];

/** Jupyter Notebook拡張子 */
const IPYNB_EXTENSIONS = ['ipynb'];

/** Canvas拡張子 */
const CANVAS_EXTENSIONS = ['canvas'];

/** キャッシュのTTL（ミリ秒） */
const CACHE_TTL = 5000;

/** ブックマークパスのキャッシュ */
let bookmarkedPathsCache: { paths: Set<string>; timestamp: number } | null = null;

/**
 * ブックマークプラグインを取得するヘルパー
 */
export function getBookmarksPlugin(app: App): BookmarkInternalPlugin | null {
	const plugin = (app as unknown as { internalPlugins?: { plugins?: { bookmarks?: BookmarkInternalPlugin } } })
		.internalPlugins?.plugins?.bookmarks;
	if (!plugin?.enabled || !plugin.instance) return null;
	return plugin;
}

/**
 * ブックマークされているファイルパスを取得（キャッシュ付き）
 */
export function getBookmarkedPaths(app: App): Set<string> {
	const now = Date.now();

	// キャッシュが有効ならそれを返す
	if (bookmarkedPathsCache && now - bookmarkedPathsCache.timestamp < CACHE_TTL) {
		return bookmarkedPathsCache.paths;
	}

	// キャッシュを再構築
	const paths = new Set<string>();
	const bookmarks = getBookmarksPlugin(app);
	if (bookmarks?.instance) {
		for (const item of bookmarks.instance.items) {
			if (item.type === 'file' && item.path) {
				paths.add(item.path);
			}
		}
	}

	bookmarkedPathsCache = { paths, timestamp: now };
	return paths;
}

/**
 * ブックマークキャッシュをクリア（ブックマーク変更時に呼び出す）
 */
export function clearBookmarkCache(): void {
	bookmarkedPathsCache = null;
}

/**
 * 拡張子からファイルタイプを判定
 */
export function getFileType(extension: string): FileType {
	const ext = extension.toLowerCase();
	if (ext === 'md') return 'markdown';
	if (TEXT_EXTENSIONS.includes(ext)) return 'text';
	if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
	if (PDF_EXTENSIONS.includes(ext)) return 'pdf';
	if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
	if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
	if (OFFICE_EXTENSIONS.includes(ext)) return 'office';
	if (IPYNB_EXTENSIONS.includes(ext)) return 'ipynb';
	if (CANVAS_EXTENSIONS.includes(ext)) return 'canvas';
	return 'other';
}

/**
 * TFileからファイルタイプを判定（Excalidrawファイル名を考慮）
 */
export function getFileTypeFromFile(file: TFile): FileType {
	const name = file.name.toLowerCase();
	if (name.endsWith('.excalidraw.md') || name.endsWith('.excalidraw')) return 'excalidraw';
	return getFileType(file.extension);
}

/**
 * 対象ファイルを列挙・フィルタリングする
 * ターゲットフォルダ指定時は対象フォルダのみ走査して最適化
 */
export function enumerateTargetNotes(
	app: App,
	settings: PluginSettings
): TFile[] {
	// ターゲットフォルダ指定時は対象フォルダのみ走査
	let candidateFiles: TFile[];
	if (settings.targetFolders.length > 0) {
		candidateFiles = [];
		for (const folderPath of settings.targetFolders) {
			const folder = app.vault.getAbstractFileByPath(folderPath);
			if (folder instanceof TFolder) {
				Vault.recurseChildren(folder, (file) => {
					if (file instanceof TFile) {
						candidateFiles.push(file);
					}
				});
			}
		}
	} else {
		candidateFiles = app.vault.getFiles();
	}

	return candidateFiles.filter(file => {
		// 除外フォルダフィルタ
		if (settings.excludeFolders.length > 0) {
			const inExcludedFolder = settings.excludeFolders.some(folder =>
				file.path.startsWith(folder + '/') || file.path === folder
			);
			if (inExcludedFolder) return false;
		}

		// タグフィルタ（マークダウン/Excalidrawファイルのみ適用）
		if (settings.targetTags.length > 0) {
			const fileType = getFileTypeFromFile(file);
			if (fileType === 'markdown' || fileType === 'excalidraw') {
				const cache = app.metadataCache.getFileCache(file);
				const fileTags = extractTags(cache);
				const hasTag = settings.targetTags.some(tag =>
					fileTags.includes(tag) || fileTags.includes('#' + tag)
				);
				if (!hasTag) return false;
			} else {
				// 非マークダウンファイルはタグフィルタ時に除外
				return false;
			}
		}

		return true;
	});
}

/**
 * CachedMetadataからタグを抽出
 */
function extractTags(cache: CachedMetadata | null): string[] {
	if (!cache) return [];

	const tags: string[] = [];

	// frontmatterのtags
	if (cache.frontmatter?.tags) {
		const fmTags: unknown = cache.frontmatter.tags;
		if (Array.isArray(fmTags)) {
			tags.push(...fmTags.map(t => String(t)));
		} else if (typeof fmTags === 'string') {
			tags.push(fmTags);
		}
	}

	// インラインタグ
	if (cache.tags) {
		tags.push(...cache.tags.map(t => t.tag));
	}

	return tags;
}

/**
 * ノートからpinned状態を取得（YAML frontmatter）
 */
function isPinned(cache: CachedMetadata | null): boolean {
	return cache?.frontmatter?.pinned === true;
}

/**
 * YAMLから数値を読み取る
 */
function getYamlNumber(cache: CachedMetadata | null, key: string): number | null {
	if (!cache?.frontmatter || !key) return null;
	const value: unknown = cache.frontmatter[key];
	if (typeof value === 'number') return value;
	if (typeof value === 'string') {
		const parsed = parseFloat(value);
		return isNaN(parsed) ? null : parsed;
	}
	return null;
}

/**
 * YAMLまたはファイル情報からノート作成日を取得
 * 優先順位: 1. YAML日付フィールド 2. ファイル名の日付 3. ファイル作成日時
 */
function extractNoteDate(
	cache: CachedMetadata | null,
	file: TFile,
	yamlDateField: string
): number | null {
	// 1. YAMLフィールドから取得
	if (yamlDateField && cache?.frontmatter) {
		const value: unknown = cache.frontmatter[yamlDateField];
		if (value) {
			// 文字列の場合はパース
			if (typeof value === 'string') {
				const parsed = Date.parse(value);
				if (!isNaN(parsed)) return parsed;
			}
			// 数値の場合はUnixタイムスタンプとして扱う
			if (typeof value === 'number') {
				// 秒単位の場合はミリ秒に変換
				return value < 1e12 ? value * 1000 : value;
			}
		}
	}

	// 2. ファイル名から日付を抽出（YYYY-MM-DD形式）
	const dateMatch = file.basename.match(/^(\d{4}-\d{2}-\d{2})/);
	if (dateMatch?.[1]) {
		const parsed = Date.parse(dateMatch[1]);
		if (!isNaN(parsed)) return parsed;
	}

	// 3. ファイル作成日時にフォールバック
	return file.stat.ctime;
}

/**
 * frontmatter から表示用 Properties を抽出
 * 内部キー・既存表示項目を除外し、設定に応じてフィルタリング
 */
function extractProperties(
	cache: CachedMetadata | null,
	settings: PluginSettings
): Record<string, unknown> {
	if (settings.showProperties === 'off' || !cache?.frontmatter) {
		return {};
	}

	// 内部キー・既存表示項目を除外
	const excludeKeys = new Set(['position', 'tags', 'tag', 'cssclasses', 'cssclass', 'aliases', 'alias']);

	const result: Record<string, unknown> = {};

	if (settings.showProperties === 'custom') {
		// 指定キーのみ抽出
		const keys = settings.propertiesKeys
			.split(',')
			.map(k => k.trim())
			.filter(k => k.length > 0);
		for (const key of keys) {
			if (!excludeKeys.has(key) && key in cache.frontmatter) {
				result[key] = cache.frontmatter[key];
			}
		}
	} else {
		// 全キーを抽出
		for (const [key, value] of Object.entries(cache.frontmatter)) {
			if (!excludeKeys.has(key)) {
				result[key] = value;
			}
		}
	}

	return result;
}

/**
 * アウトゴーイングリンク（このノートから他のノートへのリンク）を抽出
 */
export function extractOutgoingLinks(
	app: App,
	file: TFile,
	cache: CachedMetadata | null
): LinkedNote[] {
	if (!cache?.links) return [];

	const links: LinkedNote[] = [];
	const seen = new Set<string>();

	for (const link of cache.links) {
		const linkedFile = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
		if (linkedFile && linkedFile instanceof TFile && !seen.has(linkedFile.path)) {
			seen.add(linkedFile.path);
			links.push({
				path: linkedFile.path,
				title: linkedFile.basename,
			});
		}
	}

	return links;
}

/**
 * バックリンクインデックスの型
 */
export type BacklinkIndex = Map<string, LinkedNote[]>;

/**
 * バックリンクインデックスを構築（O(n)で一度に全ファイルのバックリンクを計算）
 */
export function buildBacklinkIndex(app: App): BacklinkIndex {
	const index: BacklinkIndex = new Map();
	const resolvedLinks = app.metadataCache.resolvedLinks;

	if (!resolvedLinks) return index;

	for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
		const sourceFile = app.vault.getAbstractFileByPath(sourcePath);
		if (!sourceFile || !(sourceFile instanceof TFile)) continue;

		for (const targetPath of Object.keys(links)) {
			if (targetPath === sourcePath) continue;

			let backlinks = index.get(targetPath);
			if (!backlinks) {
				backlinks = [];
				index.set(targetPath, backlinks);
			}
			backlinks.push({
				path: sourceFile.path,
				title: sourceFile.basename,
			});
		}
	}

	return index;
}

/**
 * バックリンク（他のノートからこのノートへのリンク）を抽出
 * backlinkIndexが提供された場合はO(1)、そうでなければO(n)
 */
export function extractBacklinks(
	app: App,
	file: TFile,
	backlinkIndex?: BacklinkIndex
): LinkedNote[] {
	// インデックスがあれば高速パス
	if (backlinkIndex) {
		return backlinkIndex.get(file.path) || [];
	}

	// インデックスがない場合は従来の処理（後方互換性）
	const backlinks: LinkedNote[] = [];
	const resolvedLinks = app.metadataCache.resolvedLinks;

	if (!resolvedLinks) return backlinks;

	for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
		if (sourcePath === file.path) continue;

		if (links[file.path]) {
			const sourceFile = app.vault.getAbstractFileByPath(sourcePath);
			if (sourceFile && sourceFile instanceof TFile) {
				backlinks.push({
					path: sourceFile.path,
					title: sourceFile.basename,
				});
			}
		}
	}

	return backlinks;
}

// re-export: コンテンツプレビュー関数
export { extractFirstImage, getPreviewText } from './contentPreview';

interface CandidateStaticCacheEntry {
	fileType: FileType;
	extension: string;
	pinned: boolean;
	yamlPriority: number | null;
	createdAt: number | null;
}

const CANDIDATE_STATIC_CACHE_MAX = 8000;
const candidateStaticCache = new Map<string, CandidateStaticCacheEntry>();

function getCandidateStaticCacheKey(file: TFile, settings: PluginSettings): string {
	const yamlPriorityKey = settings.yamlPriorityKey ?? '';
	const yamlDateField = settings.yamlDateField ?? '';
	return `${file.path}|${file.stat.mtime}|${yamlPriorityKey}|${yamlDateField}`;
}

function getCandidateStatic(
	app: App,
	file: TFile,
	settings: PluginSettings
): CandidateStaticCacheEntry {
	const cacheKey = getCandidateStaticCacheKey(file, settings);
	const cached = candidateStaticCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const fileType = getFileTypeFromFile(file);
	let pinned = false;
	let yamlPriority: number | null = null;
	let createdAt: number | null = file.stat.ctime;

	if (fileType === 'markdown' || fileType === 'excalidraw') {
		const fileCache = app.metadataCache.getFileCache(file);
		pinned = isPinned(fileCache);
		yamlPriority = getYamlNumber(fileCache, settings.yamlPriorityKey);
		createdAt = extractNoteDate(fileCache, file, settings.yamlDateField);
	}

	const entry: CandidateStaticCacheEntry = {
		fileType,
		extension: file.extension,
		pinned,
		yamlPriority,
		createdAt,
	};
	candidateStaticCache.set(cacheKey, entry);

	if (candidateStaticCache.size > CANDIDATE_STATIC_CACHE_MAX) {
		const oldestKey = candidateStaticCache.keys().next().value as string | undefined;
		if (oldestKey) {
			candidateStaticCache.delete(oldestKey);
		}
	}

	return entry;
}

/**
 * TFileから軽量なCandidateCardを生成（同期・ファイルI/Oなし）
 * 選択フェーズで使用し、選択後にcreateTimelineCardでフルカード化する
 */
export function createCandidateCard(
	app: App,
	file: TFile,
	reviewLog: NoteReviewLog | undefined,
	settings: PluginSettings
): CandidateCard {
	const log = reviewLog ?? DEFAULT_REVIEW_LOG;
	const now = Date.now();
	const staticEntry = getCandidateStatic(app, file, settings);

	return {
		path: file.path,
		fileType: staticEntry.fileType,
		extension: staticEntry.extension,
		lastReviewedAt: log.lastReviewedAt,
		reviewCount: log.reviewCount,
		nextReviewAt: log.nextReviewAt,
		isNew: log.reviewCount === 0,
		isDue: log.nextReviewAt !== null && log.nextReviewAt <= now,
		pinned: staticEntry.pinned,
		yamlPriority: staticEntry.yamlPriority,
		createdAt: staticEntry.createdAt,
		lastSelectedAt: log.lastSelectedAt ?? null,
	};
}

/**
 * TFileからTimelineCardを生成
 */
export async function createTimelineCard(
	app: App,
	file: TFile,
	reviewLog: NoteReviewLog | undefined,
	settings: PluginSettings,
	backlinkIndex?: BacklinkIndex
): Promise<TimelineCard> {
	const log = reviewLog ?? DEFAULT_REVIEW_LOG;
	const now = Date.now();
	const fileType = getFileTypeFromFile(file);

	// 新規カード判定（一度もレビューしていない）
	const isNew = log.reviewCount === 0;

	// 期限到来判定
	const isDue = log.nextReviewAt !== null && log.nextReviewAt <= now;

	// マークダウンファイルの場合（Excalidraw除く）
	if (fileType === 'markdown') {
		const cache = app.metadataCache.getFileCache(file);
		const content = await app.vault.cachedRead(file);
		const preview = await getPreviewText(app, file, settings.previewMode, settings.previewLines, content);

		// 最初の画像を抽出
		const firstImagePath = extractFirstImage(app, file, content);

		// リンク情報を抽出
		const outgoingLinks = extractOutgoingLinks(app, file, cache);
		const backlinks = extractBacklinks(app, file, backlinkIndex);

		// YAML読み取り
		const yamlDifficulty = getYamlNumber(cache, settings.yamlDifficultyKey);
		const yamlPriority = getYamlNumber(cache, settings.yamlPriorityKey);

		return {
			path: file.path,
			title: file.basename,
			preview,
			fileType,
			extension: file.extension,
			firstImagePath,
			outgoingLinks,
			backlinks,
			lastReviewedAt: log.lastReviewedAt,
			reviewCount: log.reviewCount,
			pinned: isPinned(cache),
			tags: extractTags(cache),
			// SRS
			nextReviewAt: log.nextReviewAt,
			difficulty: log.difficulty,
			interval: log.interval,
			isNew,
			isDue,
			// YAML
			yamlDifficulty,
			yamlPriority,
			// 作成日
			createdAt: extractNoteDate(cache, file, settings.yamlDateField),
			// Properties
			properties: extractProperties(cache, settings),
		};
	}

	// 非マークダウンファイルの場合
	let preview = '';
	let firstImagePath: string | null = null;

	switch (fileType) {
		case 'text':
			// テキストファイルの場合は内容を読み込んでプレビュー
			try {
				const textContent = await app.vault.cachedRead(file);
				const lines = textContent.split('\n');
				const previewLines = settings.previewMode === 'full'
					? lines
					: settings.previewMode === 'half'
						? lines.slice(0, Math.ceil(lines.length / 2))
						: lines.slice(0, settings.previewLines);
				preview = previewLines.join('\n');
			} catch {
				preview = `📝 ${file.extension.toUpperCase()} file`;
			}
			break;
		case 'image':
			preview = `📷 ${file.extension.toUpperCase()} image`;
			firstImagePath = file.path;  // 画像ファイル自身をサムネイルとして使用
			break;
		case 'pdf':
			preview = `📄 ${file.basename}.${file.extension}`;
			firstImagePath = file.path;  // PDF埋め込み表示用
			break;
		case 'audio':
			preview = `🎵 ${file.extension.toUpperCase()} audio`;
			break;
		case 'video':
			preview = `🎬 ${file.extension.toUpperCase()} video`;
			break;
		case 'office':
			preview = `📊 ${file.extension.toUpperCase()} file`;
			firstImagePath = file.path;  // フォールバック表示用
			break;
		case 'ipynb':
			try {
				const ipynbContent = await app.vault.cachedRead(file);
				const parsed = parseJupyterNotebook(ipynbContent);
				if (parsed) {
					preview = buildNotebookPreview(parsed, settings.previewMode, settings.previewLines);
					firstImagePath = parsed.firstImageBase64;
				} else {
					preview = '📓 Jupyter Notebook (invalid format)';
				}
			} catch {
				preview = '📓 Jupyter Notebook';
			}
			break;
		case 'excalidraw':
			preview = '🎨 Excalidraw drawing';
			firstImagePath = file.path;  // 埋め込み表示用
			break;
		case 'canvas':
			try {
				const canvasContent = await app.vault.cachedRead(file);
				const parsedCanvas = parseCanvas(canvasContent);
				if (parsedCanvas) {
					preview = buildCanvasPreview(parsedCanvas, settings.previewMode, settings.previewLines);
				} else {
					preview = '📊 Canvas (invalid format)';
				}
			} catch {
				preview = '📊 Canvas';
			}
			firstImagePath = file.path;  // 埋め込み表示用
			break;
		default:
			preview = `📁 ${file.extension.toUpperCase()} file`;
			break;
	}

	// バックリンクを抽出（非マークダウンでもリンクされている可能性がある）
	const backlinks = extractBacklinks(app, file, backlinkIndex);

	// Excalidraw（.excalidraw.md）はメタデータキャッシュからタグ等を補完
	if (fileType === 'excalidraw') {
		const cache = app.metadataCache.getFileCache(file);
		const outgoingLinks = extractOutgoingLinks(app, file, cache);
		const yamlDifficulty = getYamlNumber(cache, settings.yamlDifficultyKey);
		const yamlPriority = getYamlNumber(cache, settings.yamlPriorityKey);
		return {
			path: file.path,
			title: file.basename,
			preview,
			fileType,
			extension: file.extension,
			firstImagePath,
			outgoingLinks,
			backlinks,
			lastReviewedAt: log.lastReviewedAt,
			reviewCount: log.reviewCount,
			pinned: isPinned(cache),
			tags: extractTags(cache),
			nextReviewAt: log.nextReviewAt,
			difficulty: log.difficulty,
			interval: log.interval,
			isNew,
			isDue,
			yamlDifficulty,
			yamlPriority,
			createdAt: extractNoteDate(cache, file, settings.yamlDateField),
			properties: extractProperties(cache, settings),
		};
	}

	return {
		path: file.path,
		title: file.basename,
		preview,
		fileType,
		extension: file.extension,
		firstImagePath,
		outgoingLinks: [],
		backlinks,
		lastReviewedAt: log.lastReviewedAt,
		reviewCount: log.reviewCount,
		pinned: false,
		tags: [],
		// SRS
		nextReviewAt: log.nextReviewAt,
		difficulty: log.difficulty,
		interval: log.interval,
		isNew,
		isDue,
		// YAML
		yamlDifficulty: null,
		yamlPriority: null,
		// 作成日（非マークダウンはファイル作成日時を使用）
		createdAt: file.stat.ctime,
		// Properties（非マークダウンは空）
		properties: {},
	};
}

// re-export: SRSエンジン関数
export { updateReviewLog, updateReviewLogWithSRS, getNextIntervals, cleanupOldLogs } from './srsEngine';

// re-export: 統計関連関数
export { recordReviewToHistory, cleanupOldHistory, calculateStatistics } from './statistics';
export type { ReviewStatistics } from './statistics';
