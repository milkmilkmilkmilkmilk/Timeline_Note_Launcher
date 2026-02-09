// Timeline Note Launcher - Data Layer
import { App, TFile, TFolder, CachedMetadata, normalizePath, Vault } from 'obsidian';
import {
	PluginSettings,
	NoteReviewLog,
	ReviewLogs,
	TimelineCard,
	CandidateCard,
	LinkedNote,
	DifficultyRating,
	PreviewMode,
	FileType,
	DailyReviewHistory,
	BookmarkInternalPlugin,
	DEFAULT_REVIEW_LOG,
	getTodayString,
} from './types';

/**
 * テキストとして読み取れるファイルタイプか判定
 */
export function isTextReadableFile(fileType: FileType): boolean {
	return fileType === 'markdown' || fileType === 'text';
}

// ===== Jupyter Notebook パース関連 =====

/**
 * Jupyter Notebook のセル
 */
interface JupyterCell {
	cell_type: 'markdown' | 'code' | 'raw';
	source: string | string[];
	outputs?: JupyterOutput[];
}

/**
 * Jupyter Notebook の出力
 */
interface JupyterOutput {
	output_type: string;
	data?: Record<string, string | string[]>;
}

/**
 * パース結果
 */
interface ParsedNotebook {
	markdownContent: string;
	codeContent: string;
	language: string;
	cellCounts: { markdown: number; code: number; raw: number };
	firstImageBase64: string | null;
}

/**
 * セルのソースを文字列に正規化
 */
function normalizeSource(source: string | string[]): string {
	if (Array.isArray(source)) {
		return source.join('');
	}
	return source;
}

/**
 * 出力から画像（Base64）を抽出
 */
function extractImageFromOutputs(outputs: JupyterOutput[] | undefined): string | null {
	if (!outputs) return null;

	for (const output of outputs) {
		const data = output.data;
		if (!data) continue;

		// PNG画像を優先
		if (data['image/png']) {
			const pngData = data['image/png'];
			const base64 = Array.isArray(pngData) ? pngData.join('') : pngData;
			return `data:image/png;base64,${base64}`;
		}
		// JPEG画像
		if (data['image/jpeg']) {
			const jpegData = data['image/jpeg'];
			const base64 = Array.isArray(jpegData) ? jpegData.join('') : jpegData;
			return `data:image/jpeg;base64,${base64}`;
		}
	}
	return null;
}

/**
 * Jupyter Notebook をパース
 */
export function parseJupyterNotebook(content: string): ParsedNotebook | null {
	try {
		const notebook = JSON.parse(content) as {
			cells?: JupyterCell[];
			metadata?: { kernelspec?: { language?: string } };
		};

		if (!notebook.cells || !Array.isArray(notebook.cells)) {
			return null;
		}

		const cellCounts = { markdown: 0, code: 0, raw: 0 };
		let markdownContent = '';
		let codeContent = '';
		let firstImageBase64: string | null = null;

		// カーネル言語を取得（デフォルトはpython）
		const language = notebook.metadata?.kernelspec?.language ?? 'python';

		for (const cell of notebook.cells) {
			const source = normalizeSource(cell.source);

			switch (cell.cell_type) {
				case 'markdown':
					cellCounts.markdown++;
					if (markdownContent.length < 2000) {
						markdownContent += (markdownContent ? '\n\n' : '') + source;
					}
					break;
				case 'code':
					cellCounts.code++;
					if (!codeContent && source.trim()) {
						// 最初のコードセルのみ取得
						codeContent = source;
					}
					// 画像出力を探す
					if (!firstImageBase64) {
						firstImageBase64 = extractImageFromOutputs(cell.outputs);
					}
					break;
				case 'raw':
					cellCounts.raw++;
					break;
			}
		}

		return {
			markdownContent: markdownContent.slice(0, 2000),
			codeContent: codeContent.slice(0, 1000),
			language,
			cellCounts,
			firstImageBase64,
		};
	} catch {
		return null;
	}
}

/**
 * ノートブックのプレビューを構築
 */
export function buildNotebookPreview(
	parsed: ParsedNotebook,
	previewMode: PreviewMode,
	previewLines: number
): string {
	const parts: string[] = [];

	// セル数サマリー
	const { markdown, code, raw } = parsed.cellCounts;
	const total = markdown + code + raw;
	const summary = `*${total} cells (${markdown} markdown, ${code} code${raw > 0 ? `, ${raw} raw` : ''})*`;
	parts.push(summary);

	// Markdownコンテンツ
	if (parsed.markdownContent) {
		let mdContent = parsed.markdownContent;
		if (previewMode === 'lines') {
			const lines = mdContent.split('\n').slice(0, previewLines);
			mdContent = lines.join('\n');
		} else if (previewMode === 'half') {
			const lines = mdContent.split('\n');
			mdContent = lines.slice(0, Math.ceil(lines.length / 2)).join('\n');
		}
		parts.push(mdContent);
	}

	// コードコンテンツ（最初のコードセル）
	if (parsed.codeContent) {
		let codeContent = parsed.codeContent;
		// プレビュー行数に合わせて制限
		if (previewMode === 'lines') {
			const lines = codeContent.split('\n').slice(0, Math.min(previewLines, 10));
			codeContent = lines.join('\n');
		} else {
			const lines = codeContent.split('\n').slice(0, 15);
			codeContent = lines.join('\n');
		}
		parts.push(`\`\`\`${parsed.language}\n${codeContent}\n\`\`\``);
	}

	return parts.join('\n\n');
}

/**
 * コンパニオンノートのパスを取得
 */
export function getCompanionNotePath(file: TFile): string {
	return normalizePath(file.path + '.md');
}

/**
 * コンパニオンノートを取得または作成
 */
export async function getOrCreateCompanionNote(app: App, file: TFile): Promise<TFile> {
	const companionPath = getCompanionNotePath(file);
	const existing = app.vault.getAbstractFileByPath(companionPath);
	if (existing && existing instanceof TFile) return existing;
	const link = app.fileManager.generateMarkdownLink(file, file.parent?.path ?? '');
	const content = `---\ncompanion_of: "${file.name}"\n---\n\n元ファイル: ${link}\n`;
	return await app.vault.create(companionPath, content);
}

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

/**
 * ノートから最初の画像パスを抽出
 */
export function extractFirstImage(
	app: App,
	file: TFile,
	content: string
): string | null {
	// Obsidian内部リンク形式: ![[image.png]] または ![[image.png|alt]]
	const wikiImageMatch = content.match(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
	if (wikiImageMatch && wikiImageMatch[1]) {
		const imageName = wikiImageMatch[1];
		// ファイルを解決
		const imageFile = app.metadataCache.getFirstLinkpathDest(imageName, file.path);
		if (imageFile) {
			return imageFile.path;
		}
	}

	// Markdown形式: ![alt](path)
	const mdImageMatch = content.match(/!\[[^\]]*\]\(([^)]+)\)/);
	if (mdImageMatch && mdImageMatch[1]) {
		const imagePath = mdImageMatch[1];
		// 外部URLの場合
		if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
			return imagePath;
		}
		// 内部パスを解決
		const imageFile = app.metadataCache.getFirstLinkpathDest(imagePath, file.path);
		if (imageFile) {
			return imageFile.path;
		}
	}

	return null;
}

/**
 * コンテンツ行数をカウント（単一パス、配列生成なし）
 */
function countContentLines(content: string, startIndex: number): number {
	let lines = 0;
	let inLine = false;
	let lineHasContent = false;

	for (let i = startIndex; i < content.length; i++) {
		const char = content[i];
		if (char === '\n') {
			if (lineHasContent) {
				lines++;
			}
			inLine = false;
			lineHasContent = false;
		} else {
			inLine = true;
			if (char !== ' ' && char !== '\t' && char !== '\r') {
				lineHasContent = true;
			}
		}
	}
	// 最後の行（改行で終わらない場合）
	if (inLine && lineHasContent) {
		lines++;
	}

	return lines;
}

/**
 * ノートのプレビューテキストを取得（単一パス、中間配列なし）
 */
export async function getPreviewText(
	app: App,
	file: TFile,
	mode: PreviewMode,
	lines: number,
	preloadedContent?: string
): Promise<string> {
	const content = preloadedContent ?? await app.vault.cachedRead(file);

	// frontmatterをスキップ
	let bodyStart = 0;
	if (content.startsWith('---')) {
		const endIndex = content.indexOf('\n---', 3);
		if (endIndex !== -1) {
			const nextLineIndex = content.indexOf('\n', endIndex + 4);
			bodyStart = nextLineIndex !== -1 ? nextLineIndex + 1 : content.length;
		}
	}

	// fullモード: split不要で直接返却
	if (mode === 'full') {
		return content.slice(bodyStart);
	}

	// halfモード: 総行数を取得してから目標行まで走査
	if (mode === 'half') {
		const totalContentLines = countContentLines(content, bodyStart);
		const targetLines = Math.ceil(totalContentLines / 2);
		return sliceContentLines(content, bodyStart, targetLines);
	}

	// linesモード（デフォルト）: 先頭数行のみ走査して早期終了
	return sliceContentLines(content, bodyStart, lines);
}

/**
 * contentのstartIndexから、指定した内容行数分だけ切り出す（中間配列なし）
 */
function sliceContentLines(content: string, startIndex: number, targetLines: number): string {
	let contentLineCount = 0;
	let pos = startIndex;
	let endPos = startIndex;

	while (pos < content.length) {
		const nextNewline = content.indexOf('\n', pos);
		const lineEnd = nextNewline === -1 ? content.length : nextNewline;

		// この行が内容を持つかチェック（空白のみでないか）
		let hasContent = false;
		for (let i = pos; i < lineEnd; i++) {
			const ch = content[i];
			if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
				hasContent = true;
				break;
			}
		}

		if (hasContent) {
			contentLineCount++;
		}

		// 現在の行の終端（改行を含む位置）を記録
		endPos = nextNewline === -1 ? content.length : nextNewline;

		if (contentLineCount >= targetLines) {
			break;
		}

		if (nextNewline === -1) break;
		pos = nextNewline + 1;
		continue;
	}

	return content.slice(startIndex, endPos);
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
	const fileType = getFileTypeFromFile(file);

	let pinned = false;
	let yamlPriority: number | null = null;
	let createdAt: number | null = file.stat.ctime;
	if (fileType === 'markdown' || fileType === 'excalidraw') {
		const cache = app.metadataCache.getFileCache(file);
		pinned = isPinned(cache);
		yamlPriority = getYamlNumber(cache, settings.yamlPriorityKey);
		createdAt = extractNoteDate(cache, file, settings.yamlDateField);
	}

	return {
		path: file.path,
		fileType,
		extension: file.extension,
		lastReviewedAt: log.lastReviewedAt,
		reviewCount: log.reviewCount,
		nextReviewAt: log.nextReviewAt,
		isNew: log.reviewCount === 0,
		isDue: log.nextReviewAt !== null && log.nextReviewAt <= now,
		pinned,
		yamlPriority,
		createdAt,
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
			preview = `📄 PDF document`;
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
			preview = '📊 Canvas';
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

/**
 * レビューログを更新（通常のレビュー）
 */
export function updateReviewLog(
	logs: ReviewLogs,
	path: string
): ReviewLogs {
	const now = Date.now();
	const existing = logs[path] ?? { ...DEFAULT_REVIEW_LOG };

	return {
		...logs,
		[path]: {
			...existing,
			lastReviewedAt: now,
			reviewCount: existing.reviewCount + 1,
		},
	};
}

/**
 * SM-2アルゴリズムに基づいてレビューログを更新
 */
export function updateReviewLogWithSRS(
	logs: ReviewLogs,
	path: string,
	rating: DifficultyRating,
	settings: PluginSettings
): ReviewLogs {
	const now = Date.now();
	const existing = logs[path] ?? { ...DEFAULT_REVIEW_LOG };

	// 難易度に応じた品質スコア（0-5）
	const qualityScore = getQualityScore(rating);

	// 新しい易しさ係数を計算（SM-2）
	let newEaseFactor = existing.easeFactor + (0.1 - (5 - qualityScore) * (0.08 + (5 - qualityScore) * 0.02));
	newEaseFactor = Math.max(1.3, newEaseFactor);  // 最小1.3

	// 新しい間隔を計算
	let newInterval: number;
	if (rating === 'again') {
		// 再度：間隔をリセット
		newInterval = 0;
	} else if (existing.interval === 0) {
		// 初回正解
		newInterval = settings.initialInterval;
	} else if (existing.interval === settings.initialInterval) {
		// 2回目正解
		newInterval = 6;
	} else {
		// 3回目以降
		newInterval = Math.round(existing.interval * newEaseFactor);
	}

	// Easyボーナス
	if (rating === 'easy') {
		newInterval = Math.round(newInterval * settings.easyBonus);
	}

	// Hardは間隔を短縮
	if (rating === 'hard') {
		newInterval = Math.round(newInterval * 0.8);
	}

	// 次回レビュー日を計算
	const nextReviewAt = rating === 'again'
		? now + 10 * 60 * 1000  // 10分後に再度
		: now + newInterval * 24 * 60 * 60 * 1000;

	return {
		...logs,
		[path]: {
			lastReviewedAt: now,
			reviewCount: existing.reviewCount + 1,
			nextReviewAt,
			difficulty: existing.difficulty,  // YAMLで上書き可能
			interval: newInterval,
			easeFactor: newEaseFactor,
		},
	};
}

/**
 * 難易度評価から品質スコアを取得
 */
function getQualityScore(rating: DifficultyRating): number {
	switch (rating) {
		case 'again': return 0;
		case 'hard': return 2;
		case 'good': return 4;
		case 'easy': return 5;
	}
}

/**
 * 次回レビューまでの推定間隔を取得
 */
export function getNextIntervals(
	log: NoteReviewLog | undefined,
	settings: PluginSettings
): { again: string; hard: string; good: string; easy: string } {
	const existing = log ?? { ...DEFAULT_REVIEW_LOG };

	if (existing.interval === 0) {
		// 新規カード
		return {
			again: '10m',
			hard: `${settings.initialInterval}d`,
			good: `${settings.initialInterval}d`,
			easy: `${Math.round(settings.initialInterval * settings.easyBonus)}d`,
		};
	}

	const ef = existing.easeFactor;
	const baseInterval = existing.interval === settings.initialInterval ? 6 : Math.round(existing.interval * ef);

	return {
		again: '10m',
		hard: `${Math.round(baseInterval * 0.8)}d`,
		good: `${baseInterval}d`,
		easy: `${Math.round(baseInterval * settings.easyBonus)}d`,
	};
}

/**
 * 古いログをクリーンアップ
 */
export function cleanupOldLogs(
	logs: ReviewLogs,
	retentionDays: number
): ReviewLogs {
	const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
	const cleaned: ReviewLogs = {};

	for (const [path, log] of Object.entries(logs)) {
		if (log.lastReviewedAt && log.lastReviewedAt > cutoff) {
			cleaned[path] = log;
		}
	}

	return cleaned;
}

/**
 * ノートの末尾にコメントをCallout形式で追加
 * マークダウンファイルは直接追記、それ以外はコンパニオンノートに追記
 */
export async function appendCommentToNote(
	app: App,
	file: TFile,
	comment: string,
	fileType?: FileType
): Promise<string> {
	const now = new Date();
	const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

	// コメントの各行を引用形式に変換
	const commentLines = comment.split('\n').map(line => `> ${line}`).join('\n');

	// Callout形式で追記
	const calloutContent = `\n\n> [!comment] ${timestamp}\n${commentLines}`;

	// マークダウンファイルは直接追記、それ以外はコンパニオンノートに追記
	if (fileType && fileType !== 'markdown') {
		const companionNote = await getOrCreateCompanionNote(app, file);
		await app.vault.append(companionNote, calloutContent);
		return companionNote.path;
	} else {
		await app.vault.append(file, calloutContent);
		return file.path;
	}
}

/**
 * ノートの末尾にリンクを追加（Vault設定に準じたリンク形式を使用）
 */
export async function appendLinksToNote(
	app: App,
	sourceFile: TFile,
	targetFiles: TFile[],
	fileType?: FileType
): Promise<void> {
	if (targetFiles.length === 0) return;
	// 書き込み先を決定（マークダウン以外はコンパニオンノートへ）
	let writeTarget: TFile;
	if (fileType && fileType !== 'markdown') {
		writeTarget = await getOrCreateCompanionNote(app, sourceFile);
	} else {
		writeTarget = sourceFile;
	}
	const linkLines = targetFiles
		.map(f => app.fileManager.generateMarkdownLink(f, writeTarget.path))
		.join('\n');
	await app.vault.append(writeTarget, `\n\n${linkLines}`);
}

/**
 * 引用ノートノートを作成
 */
export async function createQuoteNote(
	app: App,
	originalFile: TFile,
	quotedTexts: string[],
	title: string,
	comment: string,
	template: string
): Promise<TFile> {
	const now = new Date();

	// タイムスタンプ形式のファイル名を生成（YYYYMMDDHHmmss）
	const uid = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

	// 日付文字列（YYYY-MM-DD）
	const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

	// 複数の引用テキストを結合（各引用をCallout形式で）
	const formattedQuotedText = quotedTexts
		.map(text => {
			// 各引用テキストを > プレフィックス付きに変換
			return text
				.split('\n')
				.map(line => `> ${line}`)
				.join('\n');
		})
		.join('\n>\n');  // 引用間に空行を入れる

	// テンプレート変数を置換
	const content = template
		.replace(/\{\{uid\}\}/g, uid)
		.replace(/\{\{title\}\}/g, title)
		.replace(/\{\{date\}\}/g, dateStr)
		.replace(/\{\{originalNote\}\}/g, originalFile.basename)
		.replace(/\{\{quotedText\}\}/g, formattedQuotedText)
		.replace(/\{\{comment\}\}/g, comment);

	// 元ノートと同じフォルダにファイルを作成
	const folderPath = originalFile.parent?.path ?? '';
	const newFilePath = normalizePath(folderPath ? `${folderPath}/${uid}.md` : `${uid}.md`);

	// ファイルを作成
	const newFile = await app.vault.create(newFilePath, content);

	return newFile;
}

// ===== 統計関連関数 =====

/**
 * レビュー履歴を記録
 */
export function recordReviewToHistory(
	history: DailyReviewHistory,
	fileType: FileType,
	isNew: boolean
): DailyReviewHistory {
	const today = getTodayString();
	const existing = history[today] || {
		newReviewed: 0,
		reviewedCount: 0,
		fileTypes: {
			markdown: 0,
			text: 0,
			image: 0,
			pdf: 0,
			audio: 0,
			video: 0,
			office: 0,
			ipynb: 0,
			excalidraw: 0,
			canvas: 0,
			other: 0,
		},
	};

	return {
		...history,
		[today]: {
			newReviewed: existing.newReviewed + (isNew ? 1 : 0),
			reviewedCount: existing.reviewedCount + 1,
			fileTypes: {
				...existing.fileTypes,
				[fileType]: (existing.fileTypes[fileType] ?? 0) + 1,
			},
		},
	};
}

/**
 * 古い履歴をクリーンアップ（30日以上前のデータを削除）
 */
export function cleanupOldHistory(
	history: DailyReviewHistory,
	retentionDays: number = 30
): DailyReviewHistory {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
	const cutoffStr = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;

	const cleaned: DailyReviewHistory = {};
	for (const [date, data] of Object.entries(history)) {
		if (date >= cutoffStr) {
			cleaned[date] = data;
		}
	}

	return cleaned;
}

/**
 * 統計情報を計算
 */
export interface ReviewStatistics {
	totalNotes: number;
	reviewedNotes: number;
	totalReviews: number;
	dueToday: number;
	todayReviews: number;
	todayNewReviews: number;
	weekReviews: number;
	monthReviews: number;
	currentStreak: number;
	fileTypeBreakdown: {
		markdown: number;
		text: number;
		image: number;
		pdf: number;
		audio: number;
		video: number;
		office: number;
		ipynb: number;
		excalidraw: number;
		canvas: number;
		other: number;
	};
	heatmapData: { date: string; count: number }[];
}

export function calculateStatistics(
	logs: ReviewLogs,
	history: DailyReviewHistory
): ReviewStatistics {
	const entries = Object.values(logs);
	const now = Date.now();
	const today = getTodayString();

	// 基本統計
	const totalNotes = entries.length;
	const reviewedNotes = entries.filter(l => l.lastReviewedAt !== null).length;
	const totalReviews = entries.reduce((sum, l) => sum + l.reviewCount, 0);
	const dueToday = entries.filter(l => l.nextReviewAt !== null && l.nextReviewAt <= now).length;

	// 今日の統計
	const todayData = history[today];
	const todayReviews = todayData?.reviewedCount ?? 0;
	const todayNewReviews = todayData?.newReviewed ?? 0;

	// 週間統計
	const weekAgo = new Date();
	weekAgo.setDate(weekAgo.getDate() - 7);
	let weekReviews = 0;
	let monthReviews = 0;

	// 月間統計
	const monthAgo = new Date();
	monthAgo.setDate(monthAgo.getDate() - 30);

	// ファイルタイプ別統計（30日間）
	const fileTypeBreakdown = {
		markdown: 0,
		text: 0,
		image: 0,
		pdf: 0,
		audio: 0,
		video: 0,
		office: 0,
		ipynb: 0,
		excalidraw: 0,
		canvas: 0,
		other: 0,
	};

	// ヒートマップデータ（過去30日）
	const heatmapData: { date: string; count: number }[] = [];
	const dates: string[] = [];
	for (let i = 29; i >= 0; i--) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		dates.push(dateStr);
	}

	for (const dateStr of dates) {
		const data = history[dateStr];
		const count = data?.reviewedCount ?? 0;
		heatmapData.push({ date: dateStr, count });

		// 月間レビュー数を加算
		monthReviews += count;

		// ファイルタイプ別を加算
		if (data?.fileTypes) {
			for (const [type, cnt] of Object.entries(data.fileTypes)) {
				fileTypeBreakdown[type as keyof typeof fileTypeBreakdown] += cnt;
			}
		}
	}

	// 週間レビュー数（過去7日）
	for (let i = 0; i < 7; i++) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		weekReviews += history[dateStr]?.reviewedCount ?? 0;
	}

	// 連続レビュー日数（ストリーク）
	let currentStreak = 0;
	for (let i = 0; i <= 365; i++) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		if (history[dateStr]?.reviewedCount && history[dateStr].reviewedCount > 0) {
			currentStreak++;
		} else {
			// 今日レビューしていない場合は、昨日から数える
			if (i === 0 && !history[dateStr]?.reviewedCount) {
				continue;
			}
			break;
		}
	}

	return {
		totalNotes,
		reviewedNotes,
		totalReviews,
		dueToday,
		todayReviews,
		todayNewReviews,
		weekReviews,
		monthReviews,
		currentStreak,
		fileTypeBreakdown,
		heatmapData,
	};
}
