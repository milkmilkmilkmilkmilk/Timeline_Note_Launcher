// Timeline Note Launcher - Content Preview
// dataLayer.ts から抽出されたコンテンツプレビュー生成ロジック
import { App, TFile } from 'obsidian';
import type { PreviewMode } from './types';

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
