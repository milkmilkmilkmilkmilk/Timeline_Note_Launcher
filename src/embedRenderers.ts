// Timeline Note Launcher - Embed Renderers
// timelineView.ts から抽出されたExcalidraw, Canvas, Office埋め込みレンダラー
import { MarkdownRenderer, TFile, setIcon } from 'obsidian';
import type { App, Component } from 'obsidian';
import type { TimelineCard } from './types';

/**
 * 埋め込みレンダリング用コンテキスト
 */
export interface EmbedRenderContext {
	app: App;
	renderComponent: Component;
	openNote: (card: TimelineCard) => Promise<void>;
}

/**
 * 要素が可視サイズを持っているか判定
 */
export function hasVisibleSize(element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}

/**
 * DOM接続済みの埋め込みプレースホルダーに対してレンダリングを実行
 */
export async function activatePendingEmbeds(
	ctx: EmbedRenderContext,
	pendingEmbeds: Map<HTMLElement, { card: TimelineCard; isGridMode: boolean; embedType: 'excalidraw' | 'canvas' | 'pdf' }>,
	maxItems: number = Number.POSITIVE_INFINITY,
	parallel: boolean = false
): Promise<void> {
	const entries = Array.from(pendingEmbeds.entries());
	pendingEmbeds.clear();
	const limit = Math.min(entries.length, Math.max(1, Math.floor(maxItems)));
	for (let i = limit; i < entries.length; i++) {
		const entry = entries[i];
		if (entry) {
			pendingEmbeds.set(entry[0], entry[1]);
		}
	}
	const renderEmbed = async (
		container: HTMLElement,
		payload: { card: TimelineCard; isGridMode: boolean; embedType: 'excalidraw' | 'canvas' | 'pdf' }
	): Promise<void> => {
		if (!container.isConnected) return;
		const { card, isGridMode, embedType } = payload;
		if (embedType === 'excalidraw') {
			await renderExcalidrawCardPreview(ctx, container, card, isGridMode);
		} else if (embedType === 'canvas') {
			await renderCanvasCardPreview(ctx, container, card, isGridMode);
		} else if (embedType === 'pdf') {
			await renderPdfCardPreview(ctx, container, card, isGridMode);
		}
	};

	if (parallel) {
		const tasks: Promise<void>[] = [];
		for (let i = 0; i < limit; i++) {
			const entry = entries[i];
			if (!entry) continue;
			tasks.push(renderEmbed(entry[0], entry[1]));
		}
		await Promise.allSettled(tasks);
		return;
	}

	for (let i = 0; i < limit; i++) {
		const entry = entries[i];
		if (!entry) continue;
		await renderEmbed(entry[0], entry[1]);
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
	createCanvasDetailButton(container);
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

/**
 * Canvasプレビューの詳細表示トグルボタンを作成
 */
function createCanvasDetailButton(container: HTMLElement): void {
	let isDetailed = false;
	const detailBtn = container.createEl('button', {
		cls: 'timeline-canvas-detail-btn',
		text: '🔍 detail',
	});

	const syncState = (): void => {
		container.classList.toggle('timeline-canvas-detailed', isDetailed);
		detailBtn.textContent = isDetailed ? '↙ collapse' : '🔍 detail';
		detailBtn.setAttribute('aria-label', isDetailed ? 'Collapse canvas preview' : 'Expand canvas preview');
	};
	syncState();

	detailBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		isDetailed = !isDetailed;
		syncState();
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

// ===== PDF =====

/**
 * PDFカードプレビューを描画（desktop/mobile共通で本文表示を優先）
 */
export async function renderPdfCardPreview(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard,
	_isGridMode: boolean
): Promise<void> {
	container.addEventListener('click', (e) => {
		e.stopPropagation();
	});

	const rendered = await renderPdfEmbedAtPage(ctx, container, card, 1);
	if (!rendered) {
		console.warn('Failed to render PDF preview in timeline:', card.path);
		return;
	}

	if (!container.querySelector('.timeline-pdf-page-nav')) {
		createPdfPageNav(ctx, container, card);
	}
}

/**
 * 指定ページのPDF埋め込みを描画（Markdown埋め込み → ネイティブiframe の順に試行）
 * 成功時のみ既存埋め込みを置換し、失敗時は既存表示を維持する。
 */
async function renderPdfEmbedAtPage(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard,
	page: number
): Promise<boolean> {
	const pdfFile = getPdfFileFromCard(ctx, card);
	if (!pdfFile) {
		return false;
	}

	const currentHost = container.querySelector('.timeline-pdf-embed-host');
	const navEl = container.querySelector('.timeline-pdf-page-nav');
	const nextHost = container.createDiv({ cls: 'timeline-pdf-embed-host' });
	if (navEl) {
		container.insertBefore(nextHost, navEl);
	}

	// Markdown埋め込みをスキップし、常にiframe（navpanes=0対応）を使用
	const rendered = await renderPdfViaNativeIframe(ctx, pdfFile, nextHost, page);

	if (!rendered) {
		nextHost.remove();
		return false;
	}

	if (currentHost && currentHost !== nextHost) {
		currentHost.remove();
	}
	container.dataset.pdfCurrentPage = String(page);
	return true;
}

function getPdfFileFromCard(ctx: EmbedRenderContext, card: TimelineCard): TFile | null {
	const pdfPath = card.firstImagePath;
	if (!pdfPath) return null;
	const file = ctx.app.vault.getAbstractFileByPath(pdfPath);
	return file instanceof TFile ? file : null;
}

async function renderPdfViaNativeIframe(
	ctx: EmbedRenderContext,
	pdfFile: TFile,
	host: HTMLElement,
	page: number
): Promise<boolean> {
	const resourcePath = ctx.app.vault.getResourcePath(pdfFile);
	const src = buildPdfResourceSrc(resourcePath, page);
	const frame = host.createEl('iframe', {
		cls: 'timeline-pdf-native-frame',
		attr: {
			src,
			title: `PDF preview: ${pdfFile.basename}`,
			loading: 'lazy',
		},
	});
	return waitForPdfFrame(frame);
}

function buildPdfResourceSrc(resourcePath: string, page: number): string {
	const safePage = String(Math.max(1, page));
	const [base, hash = ''] = resourcePath.split('#', 2);
	const params = new URLSearchParams(hash);
	params.set('page', safePage);
	params.set('navpanes', '0');  // サムネイルペインを非表示
	return `${base}#${params.toString()}`;
}

async function waitForPdfFrame(frame: HTMLIFrameElement): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		let settled = false;
		const finish = (ok: boolean): void => {
			if (settled) return;
			settled = true;
			resolve(ok);
		};

		const timeoutId = window.setTimeout(() => {
			finish(true);
		}, 2500);

		frame.addEventListener('load', () => {
			window.clearTimeout(timeoutId);
			finish(true);
		}, { once: true });

		frame.addEventListener('error', () => {
			window.clearTimeout(timeoutId);
			finish(false);
		}, { once: true });
	});
}

/**
 * PDFページナビゲーションを作成
 */
function createPdfPageNav(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard
): void {
	const nav = container.createDiv({ cls: 'timeline-pdf-page-nav' });
	container.dataset.pdfCurrentPage = '1';

	const prevBtn = nav.createEl('button', { cls: 'timeline-pdf-page-btn' });
	setIcon(prevBtn, 'chevron-left');
	prevBtn.ariaLabel = 'Previous page';

	const indicator = nav.createDiv({ cls: 'timeline-pdf-page-indicator', text: 'Page 1' });

	const nextBtn = nav.createEl('button', { cls: 'timeline-pdf-page-btn' });
	setIcon(nextBtn, 'chevron-right');
	nextBtn.ariaLabel = 'Next page';

	prevBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const current = parseInt(container.dataset.pdfCurrentPage ?? '1', 10);
		if (current <= 1) return;
		void navigatePdfPage(ctx, container, card, current - 1, indicator);
	});

	nextBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const current = parseInt(container.dataset.pdfCurrentPage ?? '1', 10);
		void navigatePdfPage(ctx, container, card, current + 1, indicator);
	});
}

/**
 * PDFページを指定ページに移動
 */
async function navigatePdfPage(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard,
	page: number,
	indicator: HTMLElement
): Promise<void> {
	const renderedOk = await renderPdfEmbedAtPage(ctx, container, card, page);
	if (renderedOk) {
		container.dataset.pdfCurrentPage = String(page);
		indicator.textContent = `Page ${page}`;
	} else {
		console.warn('Failed to navigate PDF page:', card.path, page);
	}
}
