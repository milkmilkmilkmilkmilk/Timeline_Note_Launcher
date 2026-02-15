// Timeline Note Launcher - PDF Renderer
// timelineView.ts から抽出されたPDFプレビュー描画ロジック
import { MarkdownRenderer, Platform, TFile, setIcon } from 'obsidian';
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
 * PDFオープンボタンを作成
 */
export function createPdfOpenButton(ctx: EmbedRenderContext, container: HTMLElement, card: TimelineCard): void {
	const openBtn = container.createEl('button', {
		cls: 'timeline-pdf-open-btn',
		text: '📄 open',
	});
	openBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		void ctx.openNote(card);
	});
}

/**
 * PDFページナビゲーションを作成
 */
export function createPdfPageNav(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard,
	isGridMode: boolean
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
		void navigatePdfPage(ctx, container, card, current - 1, indicator, isGridMode);
	});

	nextBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const current = parseInt(container.dataset.pdfCurrentPage ?? '1', 10);
		void navigatePdfPage(ctx, container, card, current + 1, indicator, isGridMode);
	});
}

/**
 * PDFページを指定ページに移動
 */
export async function navigatePdfPage(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard,
	page: number,
	indicator: HTMLElement,
	isGridMode: boolean
): Promise<void> {
	const pdfPath = card.firstImagePath;
	if (!pdfPath) return;

	const pdfFile = ctx.app.vault.getAbstractFileByPath(pdfPath);
	if (!(pdfFile instanceof TFile)) return;

	// 既存の埋め込みを削除
	const oldHost = container.querySelector('.timeline-pdf-embed-host');
	if (oldHost) oldHost.remove();

	// ナビ要素の前に新しいembedHostを挿入
	const navEl = container.querySelector('.timeline-pdf-page-nav');
	const embedHost = container.createDiv({ cls: 'timeline-pdf-embed-host' });
	if (navEl) {
		container.insertBefore(embedHost, navEl);
	}

	try {
		await MarkdownRenderer.render(
			ctx.app,
			`![[${pdfFile.path}#page=${page}]]`,
			embedHost,
			card.path,
			ctx.renderComponent
		);
	} catch (error: unknown) {
		console.error('Failed to navigate PDF page:', error);
		renderPdfFallback(ctx, container, card, 'PDF preview failed. Tap Open to view.', isGridMode);
		return;
	}

	applyInitialPdfZoom(embedHost);

	const renderedOk = await ensurePdfRendered(embedHost);
	if (renderedOk) {
		container.dataset.pdfCurrentPage = String(page);
		indicator.textContent = `Page ${page}`;
	}
}

/**
 * PDFカードプレビューを描画（desktop: 埋め込み、mobile: フォールバック）
 */
export async function renderPdfCardPreview(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard,
	isGridMode: boolean
): Promise<void> {
	container.removeClass('timeline-pdf-has-fallback');
	container.addEventListener('click', (e) => {
		e.stopPropagation();
	});

	const pdfPath = card.firstImagePath;
	if (!pdfPath) {
		renderPdfFallback(ctx, container, card, 'PDF preview failed. Tap Open to view.', isGridMode);
		return;
	}

	const pdfFile = ctx.app.vault.getAbstractFileByPath(pdfPath);
	if (!(pdfFile instanceof TFile)) {
		renderPdfFallback(ctx, container, card, 'PDF preview failed. Tap Open to view.', isGridMode);
		return;
	}

	if (Platform.isMobile) {
		renderPdfFallback(ctx, container, card, 'PDF preview is unavailable on mobile. Tap Open.', isGridMode);
		return;
	}

	const embedHost = container.createDiv({ cls: 'timeline-pdf-embed-host' });
	try {
		await MarkdownRenderer.render(
			ctx.app,
			`![[${pdfFile.path}]]`,
			embedHost,
			card.path,
			ctx.renderComponent
		);
	} catch (error: unknown) {
		console.error('Failed to render PDF preview:', error);
		renderPdfFallback(ctx, container, card, 'PDF preview failed. Tap Open to view.', isGridMode);
		return;
	}

	applyInitialPdfZoom(embedHost);

	const renderedOk = await ensurePdfRendered(embedHost);
	if (!renderedOk) {
		renderPdfFallback(ctx, container, card, 'PDF preview failed. Tap Open to view.', isGridMode);
		return;
	}

	createPdfOpenButton(ctx, container, card);
	createPdfPageNav(ctx, container, card, isGridMode);
}

/**
 * 埋め込みPDF要素の描画可否を確認
 */
export async function ensurePdfRendered(embedHost: HTMLElement): Promise<boolean> {
	const maxAttempts = 5;
	const intervalMs = 200;
	for (let i = 0; i < maxAttempts; i++) {
		await new Promise<void>(r => window.setTimeout(r, intervalMs));
		if (!embedHost.isConnected) return false;
		const pdfEl = findRenderedPdfElement(embedHost);
		if (pdfEl && hasVisibleSize(pdfEl)) return true;
	}
	return false;
}

/**
 * 埋め込みPDF要素を検索
 */
export function findRenderedPdfElement(container: HTMLElement): HTMLElement | null {
	const selectors = [
		'.internal-embed.pdf-embed',
		'.pdf-embed',
		'.internal-embed',
		'embed[type="application/pdf"]',
		'object[type="application/pdf"]',
		'iframe',
	];
	for (const selector of selectors) {
		const matched = container.querySelector(selector);
		if (matched instanceof HTMLElement) {
			return matched;
		}
	}
	return null;
}

/**
 * 要素が可視サイズを持っているか判定
 */
export function hasVisibleSize(element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}

/**
 * PDFの初期ズームを100%に固定
 */
export function applyInitialPdfZoom(container: HTMLElement): void {
	const zoomSelectors = [
		'embed[type="application/pdf"][src]',
		'object[type="application/pdf"][data]',
		'iframe[src]',
	];

	for (const selector of zoomSelectors) {
		for (const target of Array.from(container.querySelectorAll(selector))) {
			if (target instanceof HTMLEmbedElement || target instanceof HTMLIFrameElement) {
				const currentSrc = target.getAttribute('src');
				if (!currentSrc) continue;
				const zoomedSrc = withPdfFitWidth(currentSrc);
				if (zoomedSrc !== currentSrc) {
					target.setAttribute('src', zoomedSrc);
				}
				continue;
			}

			if (target instanceof HTMLObjectElement) {
				const currentData = target.getAttribute('data');
				if (!currentData) continue;
				const zoomedData = withPdfFitWidth(currentData);
				if (zoomedData !== currentData) {
					target.setAttribute('data', zoomedData);
				}
			}
		}
	}
}

/**
 * URLフラグメントに view=FitH を適用（ページ幅をビューア幅に合わせる）
 */
export function withPdfFitWidth(url: string): string {
	const [base, hash = ''] = url.split('#', 2);
	const tokens = hash
		.replace(/^\?/, '')
		.split('&')
		.map(token => token.trim())
		.filter(token => token.length > 0);

	let hasView = false;
	const nextTokens = tokens
		.filter(token => !token.startsWith('zoom='))
		.map((token) => {
			if (token.startsWith('view=')) {
				hasView = true;
				return 'view=FitH';
			}
			return token;
		});

	if (!hasView) {
		nextTokens.unshift('view=FitH');
	}

	return `${base}#${nextTokens.join('&')}`;
}

/**
 * PDFプレビューのフォールバックを描画
 */
export function renderPdfFallback(
	ctx: EmbedRenderContext,
	container: HTMLElement,
	card: TimelineCard,
	message: string,
	isGridMode: boolean
): void {
	container.addClass('timeline-pdf-has-fallback');
	container.empty();

	const fallbackEl = container.createDiv({ cls: 'timeline-pdf-fallback timeline-pdf-fallback-visible' });
	fallbackEl.addClass(isGridMode ? 'timeline-pdf-fallback-grid' : 'timeline-pdf-fallback-list');
	fallbackEl.createDiv({ cls: 'timeline-pdf-fallback-icon', text: '📕' });
	const fileName = card.firstImagePath?.split('/').pop() ?? 'PDF';
	fallbackEl.createDiv({ cls: 'timeline-pdf-fallback-name', text: fileName });
	fallbackEl.createDiv({ cls: 'timeline-pdf-fallback-hint', text: message });

	createPdfOpenButton(ctx, container, card);
}
