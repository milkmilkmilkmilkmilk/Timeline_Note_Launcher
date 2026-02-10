// Timeline Note Launcher - Jupyter Notebook Parser
// dataLayer.ts から抽出されたノートブック解析ロジック
import type { PreviewMode } from './types';

/**
 * Jupyter Notebook のセル
 */
export interface JupyterCell {
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
export interface ParsedNotebook {
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
