// Timeline Note Launcher - Content Extractor for Search Index
// ノート種別に応じて検索対象テキストを抽出する。
// 画像や PDF などは専用本文を持たないので、コンパニオン .note ファイル（`<path>.md`）本文で代替する。

import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { getCompanionNotePath } from './noteAnnotation';
import { parseJupyterNotebook } from './notebookParser';
import { parseCanvas } from './canvasParser';
import { getFileTypeFromFile } from './dataLayer';

/**
 * frontmatter を除去
 */
function stripFrontmatter(content: string): string {
	if (!content.startsWith('---')) return content;
	const endMatch = content.match(/^---[\s\S]*?\n---\n/);
	if (!endMatch) return content;
	return content.slice(endMatch[0].length);
}

/**
 * コンパニオンノート本文を読む（存在しなければ空文字）
 */
async function readCompanionContent(app: App, file: TFile): Promise<string> {
	const companionPath = getCompanionNotePath(file);
	const companion = app.vault.getAbstractFileByPath(companionPath);
	if (!(companion instanceof TFile)) return '';
	try {
		const content = await app.vault.cachedRead(companion);
		return stripFrontmatter(content);
	} catch {
		return '';
	}
}

/**
 * 検索対象テキストを抽出
 * Markdown: 本文（frontmatter除去）
 * ipynb: markdown セル + code セル
 * canvas: text ノードとグループラベル
 * excalidraw: .md なのでそのまま読む
 * 画像/PDF/音声/動画/Office/other: コンパニオン `.note` ファイル本文
 */
export async function extractSearchableText(app: App, file: TFile): Promise<string> {
	const fileType = getFileTypeFromFile(file);

	try {
		switch (fileType) {
			case 'markdown':
			case 'text': {
				const content = await app.vault.cachedRead(file);
				return stripFrontmatter(content);
			}
			case 'excalidraw': {
				const content = await app.vault.cachedRead(file);
				return stripFrontmatter(content);
			}
			case 'ipynb': {
				const content = await app.vault.cachedRead(file);
				const parsed = parseJupyterNotebook(content);
				if (!parsed) return '';
				return `${parsed.markdownContent}\n${parsed.codeContent}`;
			}
			case 'canvas': {
				const content = await app.vault.cachedRead(file);
				const parsed = parseCanvas(content);
				if (!parsed) return '';
				return [
					...parsed.textNodes,
					...parsed.groupLabels,
					...parsed.fileRefs,
				].join('\n');
			}
			default:
				// 画像・PDF・音声・動画・Office・その他: コンパニオン .note 本文
				return await readCompanionContent(app, file);
		}
	} catch {
		return '';
	}
}
