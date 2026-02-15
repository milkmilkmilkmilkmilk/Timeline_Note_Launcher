// Timeline Note Launcher - Note Annotation
// dataLayer.ts から抽出されたノート注釈機能（コメント、リンク、引用ノート）
import { App, TFile, normalizePath } from 'obsidian';
import type { FileType } from './types';

/** 画像拡張子 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'avif'];

function isImageFile(file: TFile): boolean {
	return IMAGE_EXTENSIONS.includes(file.extension.toLowerCase());
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
	if (existing && existing instanceof TFile) {
		await ensureCompanionImageEmbed(app, existing, file);
		return existing;
	}
	const content = buildCompanionHeader(app, file, companionPath);
	return await app.vault.create(companionPath, content);
}

/**
 * コンパニオンノート先頭の固定コンテンツを構築
 */
function buildCompanionHeader(app: App, file: TFile, companionPath: string): string {
	const sourceLink = app.fileManager.generateMarkdownLink(file, companionPath);
	const lines = [
		'---',
		`companion_of: "${file.name}"`,
		'---',
		'',
		`元ファイル: ${sourceLink}`,
	];

	// 画像ファイルは元画像をそのまま表示
	if (isImageFile(file)) {
		lines.push(`!${sourceLink}`);
	}

	return `${lines.join('\n')}\n`;
}

/**
 * 既存コンパニオンノートに元画像埋め込みがなければ追記
 */
async function ensureCompanionImageEmbed(app: App, companionNote: TFile, sourceFile: TFile): Promise<void> {
	if (!isImageFile(sourceFile)) return;

	const sourcePath = normalizePath(sourceFile.path);
	const content = await app.vault.cachedRead(companionNote);
	const embeddedTargets = collectEmbeddedTargets(app, content, companionNote.path);
	if (embeddedTargets.has(sourcePath)) return;

	const sourceLink = app.fileManager.generateMarkdownLink(sourceFile, companionNote.path);
	const embedLine = `!${sourceLink}`;
	const lines = content.split('\n');
	const sourceLineIndex = lines.findIndex(line => line.trimStart().startsWith('元ファイル:'));

	let nextContent: string;
	if (sourceLineIndex !== -1) {
		lines.splice(sourceLineIndex + 1, 0, embedLine);
		nextContent = lines.join('\n');
	} else {
		const trimmed = content.trimEnd();
		nextContent = `${trimmed}\n\n元ファイル: ${sourceLink}\n${embedLine}\n`;
	}

	if (nextContent !== content) {
		await app.vault.modify(companionNote, nextContent);
	}
}

/**
 * 画像埋め込みのリンク先を解決して収集
 */
function collectEmbeddedTargets(app: App, content: string, sourcePath: string): Set<string> {
	const targets = new Set<string>();

	// ![[image.png]] / ![[path/to/image.png|alt]]
	const wikiEmbedRe = /!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]*)?\]\]/g;
	let wikiMatch: RegExpExecArray | null;
	while ((wikiMatch = wikiEmbedRe.exec(content)) !== null) {
		const rawTarget = wikiMatch[1]?.trim();
		if (!rawTarget) continue;
		const resolved = app.metadataCache.getFirstLinkpathDest(rawTarget, sourcePath);
		if (resolved) {
			targets.add(normalizePath(resolved.path));
		} else {
			targets.add(normalizePath(rawTarget));
		}
	}

	// ![alt](path/to/image.png)
	const mdEmbedRe = /!\[[^\]]*]\(([^)]+)\)/g;
	let mdMatch: RegExpExecArray | null;
	while ((mdMatch = mdEmbedRe.exec(content)) !== null) {
		let rawTarget = mdMatch[1]?.trim();
		if (!rawTarget) continue;

		// <path with spaces> 形式を優先し、それ以外はタイトル部を除去
		if (rawTarget.startsWith('<') && rawTarget.endsWith('>')) {
			rawTarget = rawTarget.slice(1, -1).trim();
		} else {
			const whitespaceIndex = rawTarget.search(/\s/);
			if (whitespaceIndex !== -1) {
				rawTarget = rawTarget.slice(0, whitespaceIndex).trim();
			}
		}
		if (!rawTarget) continue;
		if (rawTarget.startsWith('http://') || rawTarget.startsWith('https://') || rawTarget.startsWith('data:')) {
			continue;
		}

		const resolved = app.metadataCache.getFirstLinkpathDest(rawTarget, sourcePath);
		if (resolved) {
			targets.add(normalizePath(resolved.path));
		} else {
			targets.add(normalizePath(rawTarget));
		}
	}

	return targets;
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
