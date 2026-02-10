// Timeline Note Launcher - Note Annotation
// dataLayer.ts から抽出されたノート注釈機能（コメント、リンク、引用ノート）
import { App, TFile, normalizePath } from 'obsidian';
import type { FileType } from './types';

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
