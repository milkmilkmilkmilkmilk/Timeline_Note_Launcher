// Timeline Note Launcher - Embed Renderers
// timelineView.ts から抽出されたExcalidraw, Canvas, Office埋め込みレンダラー
import { MarkdownRenderer, TFile } from 'obsidian';
import type { TimelineCard } from './types';
import type { EmbedRenderContext } from './pdfRenderer';
import { hasVisibleSize, renderPdfCardPreview } from './pdfRenderer';

// re-export: EmbedRenderContext を embedRenderers 経由でもアクセス可能に
export type { EmbedRenderContext } from './pdfRenderer';

/**
 * DOM接続済みの埋め込みプレースホルダーに対してレンダリングを実行
 */
export async function activatePendingEmbeds(
	ctx: EmbedRenderContext,
	pendingEmbeds: Map<HTMLElement, { card: TimelineCard; isGridMode: boolean; embedType: string }>
): Promise<void> {
	const entries = Array.from(pendingEmbeds.entries());
	pendingEmbeds.clear();
	for (const [container, { card, isGridMode, embedType }] of entries) {
		if (!container.isConnected) continue;
		if (embedType === 'excalidraw') {
			await renderExcalidrawCardPreview(ctx, container, card, isGridMode);
		} else if (embedType === 'canvas') {
			await renderCanvasCardPreview(ctx, container, card, isGridMode);
		} else {
			await renderPdfCardPreview(ctx, container, card, isGridMode);
		}
	}
}

// ===== Excalidraw =====

/**
 * Excalidrawカードプレビューを描画
 */
export async function renderExcalidrawCardPreview(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard,
	isGridMode: boolean
): Promise<void> {
	container.addEventListener('click', (e) => {
		e.stopPropagation();
	});

	const filePath = card.firstImagePath;
	if (!filePath) {
		renderExcalidrawFallback(ctx, container, card, 'Excalidraw preview failed.', isGridMode);
		return;
	}

	const file = ctx.app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) {
		renderExcalidrawFallback(ctx, container, card, 'Excalidraw preview failed.', isGridMode);
		return;
	}

	const embedHost = container.createDiv({ cls: 'timeline-excalidraw-embed-host' });
	try {
		await MarkdownRenderer.render(
			ctx.app,
			`![[${file.path}]]`,
			embedHost,
			card.path,
			ctx.renderComponent
		);
	} catch (error: unknown) {
		console.error('Failed to render Excalidraw preview:', error);
		renderExcalidrawFallback(ctx, container, card, 'Excalidraw preview failed.', isGridMode);
		return;
	}

	const renderedOk = await ensureExcalidrawRendered(embedHost);
	if (!renderedOk) {
		renderExcalidrawFallback(ctx, container, card, 'Excalidraw plugin not installed or rendering failed.', isGridMode);
		return;
	}

	createExcalidrawOpenButton(ctx, container, card);
}

/**
 * Excalidraw埋め込み要素の描画完了をポーリングで確認
 */
async function ensureExcalidrawRendered(embedHost: HTMLElement): Promise<boolean> {
	const maxAttempts = 10;
	const intervalMs = 300;
	for (let i = 0; i < maxAttempts; i++) {
		await new Promise<void>(r => window.setTimeout(r, intervalMs));
		if (!embedHost.isConnected) return false;
		// Excalidrawプラグインが描画するSVG/canvas/.excalidraw-svg要素を探す
		const excalidrawEl = embedHost.querySelector('svg, canvas, .excalidraw-svg, .excalidraw');
		if (excalidrawEl instanceof HTMLElement && hasVisibleSize(excalidrawEl)) return true;
		// SVGElementはHTMLElementではないので別途チェック
		if (excalidrawEl instanceof SVGElement) {
			const rect = excalidrawEl.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) return true;
		}
	}
	return false;
}

/**
 * Excalidrawプレビュー失敗時のフォールバックUI
 */
function renderExcalidrawFallback(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard,
	message: string,
	isGridMode: boolean
): void {
	container.empty();

	const fallbackEl = container.createDiv({ cls: 'timeline-excalidraw-fallback' });
	fallbackEl.addClass(isGridMode ? 'timeline-excalidraw-fallback-grid' : 'timeline-excalidraw-fallback-list');
	fallbackEl.createDiv({ cls: 'timeline-excalidraw-fallback-icon', text: '🎨' });
	const fileName = card.firstImagePath?.split('/').pop() ?? 'Excalidraw';
	fallbackEl.createDiv({ cls: 'timeline-excalidraw-fallback-name', text: fileName });
	fallbackEl.createDiv({ cls: 'timeline-excalidraw-fallback-hint', text: message });

	createExcalidrawOpenButton(ctx, container, card);
}

/**
 * Excalidrawオープンボタンを作成
 */
function createExcalidrawOpenButton(ctx: EmbedRenderContext, container: HTMLElement, card: TimelineCard): void {
	const openBtn = container.createEl('button', {
		cls: 'timeline-excalidraw-open-btn',
		text: '🎨 open',
	});
	openBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		void ctx.openNote(card);
	});
}

// ===== Canvas =====

/**
 * Canvasカードプレビューを描画
 */
export async function renderCanvasCardPreview(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard,
	isGridMode: boolean
): Promise<void> {
	container.addEventListener('click', (e) => {
		e.stopPropagation();
	});

	const filePath = card.firstImagePath;
	if (!filePath) {
		renderCanvasFallback(ctx, container, card, 'Canvas preview failed.', isGridMode);
		return;
	}

	const file = ctx.app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) {
		renderCanvasFallback(ctx, container, card, 'Canvas preview failed.', isGridMode);
		return;
	}

	const embedHost = container.createDiv({ cls: 'timeline-canvas-embed-host' });
	try {
		await MarkdownRenderer.render(
			ctx.app,
			`![[${file.path}]]`,
			embedHost,
			card.path,
			ctx.renderComponent
		);
	} catch (error: unknown) {
		console.error('Failed to render Canvas preview:', error);
		renderCanvasFallback(ctx, container, card, 'Canvas preview failed.', isGridMode);
		return;
	}

	const renderedOk = await ensureCanvasRendered(embedHost);
	if (!renderedOk) {
		renderCanvasFallback(ctx, container, card, 'Canvas plugin not available or rendering failed.', isGridMode);
		return;
	}

	createCanvasOpenButton(ctx, container, card);
}

/**
 * Canvas埋め込み要素の描画完了をポーリングで確認
 */
async function ensureCanvasRendered(embedHost: HTMLElement): Promise<boolean> {
	const maxAttempts = 10;
	const intervalMs = 300;
	for (let i = 0; i < maxAttempts; i++) {
		await new Promise<void>(r => window.setTimeout(r, intervalMs));
		if (!embedHost.isConnected) return false;
		// Canvasが描画する .canvas-node 要素または .internal-embed を探す
		const canvasEl = embedHost.querySelector('.canvas-node, .canvas, .internal-embed');
		if (canvasEl instanceof HTMLElement && hasVisibleSize(canvasEl)) return true;
	}
	return false;
}

/**
 * Canvasプレビュー失敗時のフォールバックUI
 */
function renderCanvasFallback(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard,
	message: string,
	isGridMode: boolean
): void {
	container.empty();

	const fallbackEl = container.createDiv({ cls: 'timeline-canvas-fallback' });
	fallbackEl.addClass(isGridMode ? 'timeline-canvas-fallback-grid' : 'timeline-canvas-fallback-list');
	fallbackEl.createDiv({ cls: 'timeline-canvas-fallback-icon', text: '🔲' });
	const fileName = card.firstImagePath?.split('/').pop() ?? 'Canvas';
	fallbackEl.createDiv({ cls: 'timeline-canvas-fallback-name', text: fileName });
	fallbackEl.createDiv({ cls: 'timeline-canvas-fallback-hint', text: message });

	createCanvasOpenButton(ctx, container, card);
}

/**
 * Canvasオープンボタンを作成
 */
function createCanvasOpenButton(ctx: EmbedRenderContext, container: HTMLElement, card: TimelineCard): void {
	const openBtn = container.createEl('button', {
		cls: 'timeline-canvas-open-btn',
		text: '🔲 open',
	});
	openBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		void ctx.openNote(card);
	});
}

// ===== Office =====

/**
 * Officeファイルの拡張子からサブタイプアイコンを返す
 */
export function getOfficeSubIcon(extension: string): string {
	const ext = extension.toLowerCase();
	if (ext.startsWith('doc')) return '📝';
	if (ext.startsWith('xls')) return '📊';
	if (ext.startsWith('ppt')) return '📽️';
	return '📄';
}

/**
 * Officeファイルの拡張子から種別ラベルを返す
 */
export function getOfficeTypeLabel(extension: string): string {
	const ext = extension.toLowerCase();
	if (ext.startsWith('doc')) return 'Word document';
	if (ext.startsWith('xls')) return 'Spreadsheet';
	if (ext.startsWith('ppt')) return 'Presentation';
	return 'Office document';
}

/**
 * OfficeファイルのフォールバックUIを構築
 */
export function renderOfficeFallback(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard,
	isGridMode: boolean
): void {
	const fallbackEl = container.createDiv({ cls: 'timeline-office-fallback' });
	fallbackEl.addClass(isGridMode ? 'timeline-office-fallback-grid' : 'timeline-office-fallback-list');
	const icon = getOfficeSubIcon(card.extension);
	fallbackEl.createDiv({ cls: 'timeline-office-fallback-icon', text: icon });
	const fileName = card.path.split('/').pop() ?? card.title;
	fallbackEl.createDiv({ cls: 'timeline-office-fallback-name', text: fileName });
	const label = getOfficeTypeLabel(card.extension);
	fallbackEl.createDiv({ cls: 'timeline-office-fallback-hint', text: label });

	createOfficeOpenButton(ctx, container, card);
}

/**
 * Officeオープンボタンを作成
 */
function createOfficeOpenButton(ctx: EmbedRenderContext, container: HTMLElement, card: TimelineCard): void {
	const icon = getOfficeSubIcon(card.extension);
	const openBtn = container.createEl('button', {
		cls: 'timeline-office-open-btn',
		text: `${icon} open`,
	});
	openBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		void ctx.openNote(card);
	});
}
