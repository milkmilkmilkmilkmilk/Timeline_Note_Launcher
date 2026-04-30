// Timeline Note Launcher - Canvas (.canvas) Parser
// Canvas JSONからテキストノード等を抽出しプレビュー文字列を組み立てる
import type { PreviewMode } from './types';

/**
 * Canvas ノードの種別
 */
type CanvasNodeType = 'text' | 'file' | 'link' | 'group';

/**
 * Canvas ノード（必要フィールドのみ）
 */
interface CanvasNode {
	id?: string;
	type?: CanvasNodeType;
	text?: string;
	file?: string;
	url?: string;
	label?: string;
}

/**
 * パース結果
 */
export interface ParsedCanvas {
	textNodes: string[];
	groupLabels: string[];
	fileRefs: string[];
	linkUrls: string[];
	nodeCounts: { text: number; file: number; link: number; group: number };
}

/**
 * ファイルパスからベース名（拡張子なし）を取得
 */
function basenameWithoutExt(path: string): string {
	const lastSlash = path.lastIndexOf('/');
	const base = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
	const lastDot = base.lastIndexOf('.');
	return lastDot > 0 ? base.slice(0, lastDot) : base;
}

/**
 * Canvas ファイル (.canvas) をパース
 */
export function parseCanvas(content: string): ParsedCanvas | null {
	try {
		const data = JSON.parse(content) as { nodes?: CanvasNode[] };
		if (!data.nodes || !Array.isArray(data.nodes)) {
			return null;
		}

		const textNodes: string[] = [];
		const groupLabels: string[] = [];
		const fileRefs: string[] = [];
		const linkUrls: string[] = [];
		const nodeCounts = { text: 0, file: 0, link: 0, group: 0 };

		for (const node of data.nodes) {
			switch (node.type) {
				case 'text':
					nodeCounts.text++;
					if (typeof node.text === 'string' && node.text.trim().length > 0) {
						textNodes.push(node.text);
					}
					break;
				case 'file':
					nodeCounts.file++;
					if (typeof node.file === 'string' && node.file.length > 0) {
						fileRefs.push(basenameWithoutExt(node.file));
					}
					break;
				case 'link':
					nodeCounts.link++;
					if (typeof node.url === 'string' && node.url.length > 0) {
						linkUrls.push(node.url);
					}
					break;
				case 'group':
					nodeCounts.group++;
					if (typeof node.label === 'string' && node.label.trim().length > 0) {
						groupLabels.push(node.label);
					}
					break;
			}
		}

		return { textNodes, groupLabels, fileRefs, linkUrls, nodeCounts };
	} catch {
		return null;
	}
}

/**
 * プレビュー文字列を previewMode に従って切り詰める
 */
function truncateByMode(content: string, previewMode: PreviewMode, previewLines: number): string {
	if (previewMode === 'full') {
		return content;
	}
	const lines = content.split('\n');
	if (previewMode === 'half') {
		return lines.slice(0, Math.ceil(lines.length / 2)).join('\n');
	}
	return lines.slice(0, previewLines).join('\n');
}

/**
 * Canvas のプレビューを構築
 */
export function buildCanvasPreview(
	parsed: ParsedCanvas,
	previewMode: PreviewMode,
	previewLines: number
): string {
	const parts: string[] = [];

	const { text, file, link, group } = parsed.nodeCounts;
	const total = text + file + link + group;
	const summarySegments: string[] = [];
	if (text > 0) summarySegments.push(`${text} text`);
	if (file > 0) summarySegments.push(`${file} file`);
	if (link > 0) summarySegments.push(`${link} link`);
	if (group > 0) summarySegments.push(`${group} group`);
	const summary = `*📊 Canvas: ${total} nodes${summarySegments.length > 0 ? ` (${summarySegments.join(', ')})` : ''}*`;
	parts.push(summary);

	if (parsed.groupLabels.length > 0) {
		parts.push(parsed.groupLabels.map((label) => `# ${label}`).join('\n'));
	}

	if (parsed.textNodes.length > 0) {
		const textContent = parsed.textNodes.join('\n\n---\n\n');
		parts.push(truncateByMode(textContent, previewMode, previewLines));
	}

	if (parsed.fileRefs.length > 0) {
		const refs = parsed.fileRefs.slice(0, 10).map((name) => `- ${name}`).join('\n');
		parts.push(`**Linked files:**\n${refs}`);
	}

	return parts.join('\n\n');
}
