// Timeline Note Launcher - Timeline View
import { App, ItemView, WorkspaceLeaf, WorkspaceSplit, Platform, TFile, MarkdownRenderer, Component, setIcon, Menu, Notice } from 'obsidian';
import { TimelineCard, ColorTheme, ImageSizeMode, UITheme, DEFAULT_QUICK_NOTE_TEMPLATE } from './types';
import { getBookmarkedPaths, getBookmarksPlugin, clearBookmarkCache } from './dataLayer';
import type TimelineNoteLauncherPlugin from './main';
import { arraysEqual, buildCardStateKey } from './timelineViewUtils';
import { activatePendingEmbeds } from './embedRenderers';
import type { EmbedRenderContext } from './embedRenderers';
import { createPullToRefreshState, handleTouchStart, handleTouchMove, handleTouchEnd } from './pullToRefresh';
import type { PullToRefreshState } from './pullToRefresh';
import { createDefaultFilterBarState, collectAllTags, applyFilters, renderFilterBar, updateFilterBarUI } from './filterBar';
import type { FilterBarState, FilterBarContext } from './filterBar';
import { handleKeydown } from './keyboardNav';
import type { KeyboardNavContext } from './keyboardNav';
import { createCardElement, createGridCardElement, createDifficultyButtons, replaceWithUndoButton } from './cardRenderer';
import type { CardRenderContext, PendingMarkdownRender } from './cardRenderer';
import { QuickNoteModal } from './quickNoteModal';

export const TIMELINE_VIEW_TYPE = 'timeline-note-launcher';

export class TimelineView extends ItemView {
	private static readonly SCROLL_IDLE_MS = 120;
	private static readonly SCROLL_APPEND_CHUNK_SIZE = 6;
	private static readonly EMBED_RENDER_BATCH_SIZE = 1;
	private static readonly VIEWPORT_PREFETCH_MARGIN_PX = 900;
	private plugin: TimelineNoteLauncherPlugin;
	private cards: TimelineCard[] = [];
	private filteredCards: TimelineCard[] = [];
	private listContainerEl: HTMLElement;
	private scrollPosition: number = 0;
	private newCount: number = 0;
	private dueCount: number = 0;
	private renderComponent: Component;
	private focusedIndex: number = -1;
	private cardElements: HTMLElement[] = [];
	private keydownHandler: (e: KeyboardEvent) => void;
	// 説明: フィルターバーの状態
	private filterState: FilterBarState = createDefaultFilterBarState();
	// 説明: 直前にアクティブだったLeaf
	private previousActiveLeaf: WorkspaceLeaf | null = null;
	// 説明: 差分描画用の前回カードパス
	private lastCardPaths: string[] = [];
	// 説明: 差分描画用の前回カード状態キー
	private lastCardStateKeys: string[] = [];
	// 説明: ブックマークキャッシュ
	private cachedBookmarkedPaths: Set<string> | null = null;
	// 説明: 全タグのキャッシュ
	private cachedAllTags: string[] = [];
	// 説明: 現在表示中のカード数
	private displayedCount: number = 0;
	private isLoadingMore: boolean = false;
	private scrollHandler: () => void;
	private listEl: HTMLElement | null = null;
	// 説明: 埋め込み描画待ちキュー
	private pendingEmbeds: Map<HTMLElement, { card: TimelineCard; isGridMode: boolean; embedType: 'excalidraw' | 'canvas' | 'pdf' }> = new Map();
	// 説明: Markdown描画待ちキュー
	private pendingMarkdownRenders: PendingMarkdownRender[] = [];
	private isFlushingEmbeds: boolean = false;
	private isFlushingMarkdownRenders: boolean = false;
	private lastScrollEventAt: number = 0;
	// 説明: プル・トゥ・リフレッシュ状態
	private pullState: PullToRefreshState = createPullToRefreshState();
	private touchStartHandler: (e: TouchEvent) => void;
	private touchMoveHandler: (e: TouchEvent) => void;
	private touchEndHandler: (e: TouchEvent) => void;
	private twitterDueOnly: boolean = false;
	private twitterBookmarkedOnly: boolean = false;
	private twitterLikedOnly: boolean = false;
	private twitterFilterDrawerOpen: boolean = false;
	private twitterFilterDrawerEl: HTMLElement | null = null;
	private twitterFilterSearchInputEl: HTMLInputElement | null = null;
	private twitterSearchButtons: HTMLButtonElement[] = [];
	private twitterBellButtons: HTMLButtonElement[] = [];
	private twitterBookmarkButtons: HTMLButtonElement[] = [];
	private twitterHeartButtons: HTMLButtonElement[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: TimelineNoteLauncherPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.renderComponent = new Component();
		this.keydownHandler = (e: KeyboardEvent) => handleKeydown(this.getKeyboardNavContext(), e);
		this.scrollHandler = this.handleScroll.bind(this);
// 説明: スクロール状態を管理する
		this.touchStartHandler = (e: TouchEvent) => handleTouchStart(this.pullState, this.listContainerEl, e);
		this.touchMoveHandler = (e: TouchEvent) => handleTouchMove(this.pullState, this.listContainerEl, e);
		this.touchEndHandler = () => handleTouchEnd(this.pullState, this.listContainerEl, () => this.refresh());
	}

	getViewType(): string {
		return TIMELINE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Timeline';
	}

	getIcon(): string {
		return 'rocket';
	}

	async onOpen(): Promise<void> {
		this.listContainerEl = this.contentEl.createDiv({ cls: 'timeline-container' });

// 説明: UIを描画する
		this.updateMobileClass();

// 説明: モバイル向け処理を行う
		this.listContainerEl.tabIndex = 0;
		this.listContainerEl.addEventListener('keydown', this.keydownHandler);

// 説明: イベントを登録する
		this.listContainerEl.addEventListener('scroll', this.scrollHandler, { passive: true });

// 説明: イベントを登録する
		if (Platform.isMobile) {
			this.listContainerEl.addEventListener('touchstart', this.touchStartHandler, { passive: true });
			this.listContainerEl.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
			this.listContainerEl.addEventListener('touchend', this.touchEndHandler, { passive: true });
		}

// 説明: 補助的な更新処理
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf && leaf !== this.leaf && leaf.view.getViewType() !== TIMELINE_VIEW_TYPE) {
					this.previousActiveLeaf = leaf;
				}
			})
		);

// 説明: Leaf選択を調整する
		const currentActive = this.app.workspace.getActiveViewOfType(ItemView)?.leaf;
		if (currentActive && currentActive !== this.leaf && currentActive.view.getViewType() !== TIMELINE_VIEW_TYPE) {
			this.previousActiveLeaf = currentActive;
		}

// 説明: キャッシュを更新する
		const cached = this.plugin.getCachedTimelineCards();
		if (cached) {
			this.cards = cached.cards;
			this.cachedAllTags = collectAllTags(this.cards);
			this.newCount = cached.newCount;
			this.dueCount = cached.dueCount;
		} else {
// 説明: 補助的な更新処理
			this.cards = [];
			this.cachedAllTags = [];
			this.newCount = 0;
			this.dueCount = 0;
		}

// 説明: UIを描画する
		await this.render();

// 説明: UIを描画する
		void this.refresh().catch((error: unknown) => {
			console.error('Failed to refresh timeline:', error);
			this.renderErrorState();
		});
	}

	private renderLoadingState(): void {
		this.listContainerEl.empty();
		const loading = this.listContainerEl.createDiv({ cls: 'timeline-loading-indicator' });
		loading.createSpan({ cls: 'timeline-loading-spinner' });
		loading.createSpan({ cls: 'timeline-loading-text', text: 'Loading timeline...' });
	}

	private renderErrorState(): void {
// 説明: UIを描画する
		if (this.listContainerEl.querySelector('.timeline-header')) return;
		this.listContainerEl.empty();
		const loading = this.listContainerEl.createDiv({ cls: 'timeline-loading-indicator' });
		loading.createSpan({ cls: 'timeline-loading-text', text: 'Failed to load timeline. Tap refresh to retry.' });
	}

	/**
* 処理: モバイル表示クラスを更新する
	 */
	private updateMobileClass(): void {
// 説明: モバイル向け処理を行う
		const isMobileView = Platform.isMobile || this.plugin.data.settings.mobileViewOnDesktop;
		if (isMobileView) {
			this.listContainerEl.addClass('timeline-mobile');
		} else {
			this.listContainerEl.removeClass('timeline-mobile');
		}
	}

	/**
* 処理: カラーテーマクラスを適用する
	 */
	private updateColorTheme(): void {
		const theme = this.plugin.data.settings.colorTheme;
		const themes: ColorTheme[] = ['default', 'blue', 'green', 'purple', 'orange', 'pink', 'red', 'cyan', 'yellow'];

// 説明: 補助的な更新処理
		for (const t of themes) {
			this.listContainerEl.removeClass(`timeline-theme-${t}`);
		}

// 説明: 補助的な更新処理
		this.listContainerEl.addClass(`timeline-theme-${theme}`);
	}

	/**
* 処理: UIテーマクラスを適用する
	 */
	private updateUITheme(): void {
		const uiTheme = this.plugin.data.settings.uiTheme;
		const themes: UITheme[] = ['classic', 'twitter'];

// 説明: 補助的な更新処理
		for (const t of themes) {
			this.listContainerEl.removeClass(`timeline-ui-${t}`);
		}

// 説明: 補助的な更新処理
		this.listContainerEl.addClass(`timeline-ui-${uiTheme}`);
	}

	/**
* 処理: デスクトップのモバイル表示を切替する
	  */
	async toggleMobileView(): Promise<void> {
		if (Platform.isMobile) return;
		this.plugin.data.settings.mobileViewOnDesktop = !this.plugin.data.settings.mobileViewOnDesktop;
		void this.plugin.syncAndSave();
		this.updateMobileClass();
// 説明: モバイル向け処理を行う
		this.lastCardPaths = [];
		this.lastCardStateKeys = [];
		await this.render();
	}

	onClose(): Promise<void> {
// 説明: スクロール状態を管理する
		this.scrollPosition = this.listContainerEl.scrollTop;
		this.resetTwitterUiRefs();
// 説明: UIを描画する
		this.pendingMarkdownRenders = [];
		this.isFlushingEmbeds = false;
		this.isFlushingMarkdownRenders = false;
// 説明: フィルター状態を反映する
		if (this.filterState.searchDebounceTimer !== null) {
			window.clearTimeout(this.filterState.searchDebounceTimer);
			this.filterState.searchDebounceTimer = null;
		}
// 説明: UIを描画する
		this.renderComponent.unload();
// 説明: イベントを解除する
		this.listContainerEl.removeEventListener('keydown', this.keydownHandler);
// 説明: イベントを解除する
		this.listContainerEl.removeEventListener('scroll', this.scrollHandler);
// 説明: イベントを解除する
		if (Platform.isMobile) {
			this.listContainerEl.removeEventListener('touchstart', this.touchStartHandler);
			this.listContainerEl.removeEventListener('touchmove', this.touchMoveHandler);
			this.listContainerEl.removeEventListener('touchend', this.touchEndHandler);
		}
		return Promise.resolve();
	}

	/**
* 処理: タイムラインを再取得して再描画する
	 */
	async refresh(): Promise<void> {
// 説明: スクロール状態を管理する
		this.scrollPosition = this.listContainerEl?.scrollTop ?? 0;

// 説明: スクロール状態を管理する
		this.updateMobileClass();
		this.updateColorTheme();
		this.updateUITheme();

// 説明: ブックマーク状態を更新する
		this.cachedBookmarkedPaths = getBookmarkedPaths(this.app);

		// ユーザー操作によるリフレッシュはキャッシュを破棄して必ず再取得する
		this.plugin.invalidateTimelineCache();
		const result = await this.plugin.getTimelineCards();
		this.cards = result.cards;
		this.cachedAllTags = collectAllTags(this.cards);
		this.newCount = result.newCount;
		this.dueCount = result.dueCount;
		if (this.plugin.data.settings.selectionMode === 'srs') {
			try {
				const latestCounts = await this.plugin.getLatestNewDueCounts();
				this.newCount = latestCounts.newCount;
				this.dueCount = latestCounts.dueCount;
			} catch (error) {
				console.error('Failed to recalculate timeline stats:', error);
			}
		}

// 説明: UIを描画する
		await this.render();

// 説明: UIを描画する
		if (this.listContainerEl) {
			this.listContainerEl.scrollTop = this.scrollPosition;
		}
	}

	/**
* 処理: SRS統計表示を更新する
	  */
	private updateSrsStatsDisplay(): void {
		if (this.plugin.data.settings.selectionMode !== 'srs') return;
		const statsEl = this.listContainerEl?.querySelector('.timeline-stats');
		if (!statsEl) return;
		statsEl.empty();
		statsEl.createSpan({ cls: 'timeline-stat-new', text: `${this.newCount} new` });
		statsEl.appendText(' | ');
		statsEl.createSpan({ cls: 'timeline-stat-due', text: `${this.dueCount} due` });
	}

	private applySrsCountDelta(deltaNew: number, deltaDue: number): void {
		if (this.plugin.data.settings.selectionMode !== 'srs') return;
		this.newCount = Math.max(0, this.newCount + deltaNew);
		this.dueCount = Math.max(0, this.dueCount + deltaDue);
		this.updateSrsStatsDisplay();
	}

	private renderCardsToFragment(
		cards: TimelineCard[],
		isGridMode: boolean,
	): { fragment: DocumentFragment; elements: HTMLElement[] } {
		const fragment = document.createDocumentFragment();
		const elements: HTMLElement[] = [];
		const cardCtx = this.getCardRenderContext();
		for (const card of cards) {
			const el = isGridMode ? createGridCardElement(cardCtx, card) : createCardElement(cardCtx, card);
			fragment.appendChild(el);
			elements.push(el);
		}
		return { fragment, elements };
	}

	private async waitForScrollIdle(): Promise<void> {
		while (true) {
			const elapsed = Date.now() - this.lastScrollEventAt;
			const remaining = TimelineView.SCROLL_IDLE_MS - elapsed;
			if (remaining <= 0) return;
			await new Promise<void>(resolve => { window.setTimeout(() => { resolve(); }, remaining); });
			if (!this.listContainerEl?.isConnected) return;
		}
	}

	private isNearViewport(element: HTMLElement): boolean {
		const rootRect = this.listContainerEl.getBoundingClientRect();
		const rect = element.getBoundingClientRect();
		const margin = TimelineView.VIEWPORT_PREFETCH_MARGIN_PX;
		return rect.bottom >= rootRect.top - margin && rect.top <= rootRect.bottom + margin;
	}

	private takeNearViewportEmbeds(
		limit: number
	): Map<HTMLElement, { card: TimelineCard; isGridMode: boolean; embedType: 'excalidraw' | 'canvas' | 'pdf' }> {
		const selected = new Map<HTMLElement, { card: TimelineCard; isGridMode: boolean; embedType: 'excalidraw' | 'canvas' | 'pdf' }>();
		if (!this.listContainerEl?.isConnected) return selected;

		for (const [container, payload] of this.pendingEmbeds) {
			if (!container.isConnected) {
				this.pendingEmbeds.delete(container);
				continue;
			}
			if (!this.isNearViewport(container)) continue;
			this.pendingEmbeds.delete(container);
			selected.set(container, payload);
			if (selected.size >= limit) break;
		}
		return selected;
	}

	private hasNearViewportPendingEmbeds(): boolean {
		let found = false;
		for (const container of this.pendingEmbeds.keys()) {
			if (!container.isConnected) {
				this.pendingEmbeds.delete(container);
				continue;
			}
			if (this.isNearViewport(container)) {
				found = true;
			}
		}
		return found;
	}

	private takeNextNearViewportMarkdownRender(): PendingMarkdownRender | null {
		for (let i = 0; i < this.pendingMarkdownRenders.length; i++) {
			const next = this.pendingMarkdownRenders[i];
			if (!next) continue;
			if (!next.previewEl.isConnected) {
				this.pendingMarkdownRenders.splice(i, 1);
				i--;
				continue;
			}
			if (!this.isNearViewport(next.previewEl)) continue;
			this.pendingMarkdownRenders.splice(i, 1);
			return next;
		}
		return null;
	}

	/**
* 処理: 埋め込み待機キューを処理する
	  */
	private async flushPendingEmbeds(): Promise<void> {
		if (this.isFlushingEmbeds) return;
		this.isFlushingEmbeds = true;
		try {
			while (this.pendingEmbeds.size > 0) {
				await this.waitForScrollIdle();
				const nearViewportEmbeds = this.takeNearViewportEmbeds(TimelineView.EMBED_RENDER_BATCH_SIZE);
				if (nearViewportEmbeds.size === 0) return;
				await activatePendingEmbeds(
					this.getEmbedRenderContext(),
					nearViewportEmbeds
				);
				await new Promise<void>(resolve => { requestAnimationFrame(() => { resolve(); }); });
			}
		} finally {
			this.isFlushingEmbeds = false;
			if (this.pendingEmbeds.size > 0) {
				if (this.hasNearViewportPendingEmbeds()) {
					void this.flushPendingEmbeds();
				}
			}
		}
	}

	/**
* 処理: Markdown待機描画を処理する
	  */
	private async flushPendingMarkdownRenders(): Promise<void> {
		if (this.isFlushingMarkdownRenders) return;
		this.isFlushingMarkdownRenders = true;
		try {
			while (this.pendingMarkdownRenders.length > 0) {
				await this.waitForScrollIdle();
				const next = this.takeNextNearViewportMarkdownRender();
				if (!next) return;
				const { previewEl, previewText, sourcePath } = next;
				if (!previewEl.isConnected) continue;
				const escapedPreviewText = previewText.includes('[^')
					? previewText.replace(/\[\^/g, '\\[^')
					: previewText;
				await MarkdownRenderer.render(
					this.app,
					escapedPreviewText,
					previewEl,
					sourcePath,
					this.renderComponent
				);
// 説明: 補助的な更新処理
				const placeholder = previewEl.querySelector('.timeline-card-preview-placeholder');
				if (placeholder) placeholder.remove();
				previewEl.removeClass('timeline-card-preview-pending');
				await new Promise<void>(resolve => { requestAnimationFrame(() => { resolve(); }); });
			}
		} finally {
			this.isFlushingMarkdownRenders = false;
			if (this.pendingMarkdownRenders.length > 0) {
				const hasNearViewportPending = this.pendingMarkdownRenders.some(p => p.previewEl.isConnected && this.isNearViewport(p.previewEl));
				if (hasNearViewportPending) {
					void this.flushPendingMarkdownRenders();
				}
			}
		}
	}

	/**
* 処理: 補助処理を実行する
	  */
	private async appendCardsInChunks(cards: TimelineCard[], isGridMode: boolean): Promise<HTMLElement[]> {
		const elements: HTMLElement[] = [];
		const chunkSize = TimelineView.SCROLL_APPEND_CHUNK_SIZE;
		if (!this.listEl || cards.length === 0) return elements;

		for (let i = 0; i < cards.length; i += chunkSize) {
			const chunk = cards.slice(i, i + chunkSize);
			const { fragment, elements: chunkEls } = this.renderCardsToFragment(chunk, isGridMode);
			this.listEl.appendChild(fragment);
			elements.push(...chunkEls);
			if (i + chunkSize < cards.length) {
				await new Promise<void>(resolve => { requestAnimationFrame(() => { resolve(); }); });
			}
		}
		return elements;
	}

	/**
* 処理: 現在設定で画面全体を描画する
	 */
	private async render(): Promise<void> {
// 説明: UIを描画する
		const settings = this.plugin.data.settings;
		const newPaths = this.cards.map(c => c.path);
		const newStateKeys = this.cards.map(card => buildCardStateKey(card));
		const pathsChanged = !arraysEqual(this.lastCardPaths, newPaths);
		const stateChanged = !arraysEqual(this.lastCardStateKeys, newStateKeys);
		const hasRenderedTimeline = this.listContainerEl.querySelector('.timeline-header') !== null;
		const themeLayoutChanged = (settings.uiTheme === 'twitter') !== this.listContainerEl.classList.contains('timeline-twitter-v2');

// 説明: UIを描画する
		if (!pathsChanged && !stateChanged && hasRenderedTimeline && !themeLayoutChanged) {
// 説明: UIを描画する
			const statsEl = this.listContainerEl.querySelector('.timeline-stats');
			if (statsEl && this.plugin.data.settings.selectionMode === 'srs') {
				this.updateSrsStatsDisplay();
			}
			return;
		}

// 説明: 補助的な更新処理
		this.lastCardPaths = newPaths;
		this.lastCardStateKeys = newStateKeys;

// 説明: 補助的な更新処理
		this.pendingEmbeds.clear();
		this.pendingMarkdownRenders = [];
		this.renderComponent.unload();
		this.renderComponent = new Component();
		this.renderComponent.load();

		this.listContainerEl.empty();

// 説明: 補助的な更新処理
		const imageSizeMode = settings.imageSizeMode;
		const sizeModes: ImageSizeMode[] = ['small', 'medium', 'large', 'full'];
		for (const mode of sizeModes) {
			this.listContainerEl.removeClass(`timeline-image-${mode}`);
		}
		this.listContainerEl.addClass(`timeline-image-${imageSizeMode}`);

// 説明: 補助的な更新処理
		if (settings.previewMode === 'lines') {
			this.listContainerEl.addClass('timeline-preview-clamped');
			const maxHeight = settings.previewLines * 40 + 16;
			this.listContainerEl.style.setProperty('--preview-max-height', `${maxHeight}px`);
		} else {
			this.listContainerEl.removeClass('timeline-preview-clamped');
			this.listContainerEl.style.removeProperty('--preview-max-height');
		}

// 説明: 補助的な更新処理
		if (settings.uiTheme === 'twitter') {
			this.renderTwitterV2Layout();
			this.focusedIndex = -1;
			return;
		}

		this.listContainerEl.removeClass('timeline-twitter-v2');
		this.resetTwitterUiRefs();

		const header = this.listContainerEl.createDiv({ cls: 'timeline-header' });

		const leftSection = header.createDiv({ cls: 'timeline-header-left' });
		const refreshBtn = leftSection.createEl('button', {
			cls: 'timeline-refresh-btn',
			text: 'Refresh',
			attr: { 'aria-label': 'Refresh timeline' },
		});
		refreshBtn.addEventListener('click', () => { void this.refresh(); });

// 説明: イベントを登録する
		if (settings.selectionMode === 'srs') {
			leftSection.createSpan({ cls: 'timeline-stats' });
			this.updateSrsStatsDisplay();
		}

		const rightSection = header.createDiv({ cls: 'timeline-header-right' });

// 説明: UIを描画する
		if (!Platform.isMobile) {
			const isMobileView = settings.mobileViewOnDesktop;
			const toggleBtn = rightSection.createEl('button', {
				cls: 'timeline-view-toggle-btn',
				text: isMobileView ? 'Desktop' : 'Mobile',
				attr: { 'aria-label': isMobileView ? 'Switch to PC view' : 'Switch to Mobile view' },
			});
			toggleBtn.addEventListener('click', () => { void this.toggleMobileView(); });
		}

// 説明: 補助的な更新処理
		const viewMode = settings.viewMode;
		const viewModeBtn = rightSection.createEl('button', {
			cls: 'timeline-view-mode-btn',
			text: viewMode === 'list' ? 'List' : 'Grid',
			attr: { 'aria-label': viewMode === 'list' ? 'Switch to Grid view' : 'Switch to List view' },
		});
		viewModeBtn.addEventListener('click', () => { void this.toggleViewMode(); });

// 説明: イベントを登録する
		this.renderComposeBox();

// 説明: フィルター状態を反映する
		renderFilterBar(this.getFilterBarContext());

// 説明: フィルター状態を反映する
		this.filteredCards = this.applyTwitterSecondaryFilters(applyFilters(this.cards, this.filterState));

// 説明: フィルター状態を反映する
		const countText = this.filteredCards.length === this.cards.length
			? `${this.cards.length} notes`
			: `${this.filteredCards.length} / ${this.cards.length} notes`;
		rightSection.createEl('span', {
			cls: 'timeline-count',
			text: countText,
		});

// 説明: 補助的な更新処理
		const isGridMode = settings.viewMode === 'grid';
		const listCls = isGridMode ? `timeline-grid timeline-grid-cols-${settings.gridColumns}` : 'timeline-list';
		this.listEl = this.listContainerEl.createDiv({ cls: listCls });

// 説明: UIを描画する
		this.cardElements = [];

// 説明: スクロール状態を管理する
		const enableInfiniteScroll = settings.enableInfiniteScroll;
		const batchSize = settings.infiniteScrollBatchSize || 20;
		const initialCount = enableInfiniteScroll ? batchSize : this.filteredCards.length;
		this.displayedCount = Math.min(initialCount, this.filteredCards.length);

// 説明: フィルター状態を反映する
		const { fragment, elements } = this.renderCardsToFragment(
			this.filteredCards.slice(0, this.displayedCount), isGridMode
		);
		this.cardElements = elements;
		this.listEl.appendChild(fragment);
		// DOM接続後にPDF埋め込みとMarkdownレンダリングを実行する
		await Promise.all([
			this.flushPendingEmbeds(),
			this.flushPendingMarkdownRenders(),
		]);

// 説明: UIを描画する
		const footer = this.listContainerEl.createDiv({ cls: 'timeline-footer' });

// 説明: フィルター状態を反映する
		if (enableInfiniteScroll && this.displayedCount < this.filteredCards.length) {
			const loadingEl = footer.createDiv({ cls: 'timeline-loading-indicator' });
			loadingEl.createSpan({ cls: 'timeline-loading-spinner' });
			loadingEl.createSpan({ cls: 'timeline-loading-text', text: 'Scroll for more...' });
		} else {
			const bottomRefreshBtn = footer.createEl('button', {
				cls: 'timeline-refresh-btn',
				text: 'Refresh',
				attr: { 'aria-label': 'Refresh timeline' },
			});
			bottomRefreshBtn.addEventListener('click', () => { void this.refresh(); });
		}

// 説明: 補助的な更新処理
		this.focusedIndex = -1;
	}

	/**
* 処理: Twitter UI参照をリセットする
	  */
	private resetTwitterUiRefs(): void {
		this.twitterFilterDrawerEl = null;
		this.twitterFilterSearchInputEl = null;
		this.twitterSearchButtons = [];
		this.twitterBellButtons = [];
		this.twitterBookmarkButtons = [];
		this.twitterHeartButtons = [];
	}

	private applyTwitterSecondaryFilters(cards: TimelineCard[]): TimelineCard[] {
		if (this.plugin.data.settings.uiTheme !== 'twitter') {
			return cards;
		}

		let filtered = cards;
		if (this.twitterDueOnly) {
			filtered = filtered.filter((card) => card.isDue);
		}
		if (this.twitterBookmarkedOnly) {
			const bookmarked = getBookmarkedPaths(this.app);
			this.cachedBookmarkedPaths = bookmarked;
			filtered = filtered.filter((card) => bookmarked.has(card.path));
		}
		if (this.twitterLikedOnly) {
			const likedNotes = this.plugin.data.likedNotes;
			filtered = filtered
				.filter((card) => likedNotes[card.path] !== undefined)
				.sort((a, b) => (likedNotes[b.path] ?? 0) - (likedNotes[a.path] ?? 0));
		}
		return filtered;
	}

	private updateTwitterShortcutStates(): void {
		for (const btn of this.twitterSearchButtons) {
			btn.classList.toggle('is-active', this.twitterFilterDrawerOpen);
		}
		for (const btn of this.twitterBellButtons) {
			btn.classList.toggle('is-active', this.twitterDueOnly);
		}
		for (const btn of this.twitterBookmarkButtons) {
			btn.classList.toggle('is-active', this.twitterBookmarkedOnly);
		}
		for (const btn of this.twitterHeartButtons) {
			btn.classList.toggle('is-active', this.twitterLikedOnly);
		}
	}

	private setTwitterFilterDrawerState(nextOpen: boolean, focusSearch: boolean): void {
		this.twitterFilterDrawerOpen = nextOpen;
		if (this.twitterFilterDrawerEl) {
			this.twitterFilterDrawerEl.classList.toggle('is-open', nextOpen);
			this.twitterFilterDrawerEl.classList.toggle('is-collapsed', !nextOpen);
		}
		this.updateTwitterShortcutStates();

		if (nextOpen && focusSearch) {
			window.setTimeout(() => {
				this.twitterFilterSearchInputEl?.focus();
			}, 0);
		}
	}

	private openPluginSettings(): void {
		const appWithSettings = this.app as App & {
			setting?: {
				open: () => void;
				openTabById: (tabId: string) => void;
			};
		};
		appWithSettings.setting?.open();
		appWithSettings.setting?.openTabById(this.plugin.manifest.id);
	}

	private openCommandPalette(): void {
		const candidates = ['app:open-command-palette', 'command-palette:open'];
		const appWithCommands = this.app as App & {
			commands?: {
				commands?: Record<string, unknown>;
				executeCommandById: (commandId: string) => void;
			};
		};
		for (const commandId of candidates) {
			if (appWithCommands.commands?.commands?.[commandId]) {
				appWithCommands.commands.executeCommandById(commandId);
				return;
			}
		}
		new Notice('Command palette command is not available.');
	}

	private async handleTwitterFeatherAction(): Promise<void> {
		const action = this.plugin.data.settings.twitterFeatherAction;
		if (action === 'quick-note-modal') {
			const modal = new QuickNoteModal(this.app, async (content) => {
				const next = content.trim();
				if (next.length === 0) {
					throw new Error('Quick note content is empty.');
				}
				await this.createQuickNote(next);
				await this.refresh();
			});
			modal.open();
			return;
		}

		if (action === 'create-empty-note') {
			await this.createQuickNote('');
			await this.refresh();
			return;
		}

		this.openCommandPalette();
	}

	private createTwitterShortcutButton(
		container: HTMLElement,
		icon: string,
		label: string,
		onClick: (event: MouseEvent) => void,
		tracker: 'search' | 'bell' | 'bookmark' | 'heart' | null = null,
	): HTMLButtonElement {
		const btn = container.createEl('button', {
			cls: 'timeline-twitter-shortcut-btn',
			attr: { 'aria-label': label, title: label },
		});
		setIcon(btn, icon);
		btn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick(event);
		});

		if (tracker === 'search') {
			this.twitterSearchButtons.push(btn);
		} else if (tracker === 'bell') {
			this.twitterBellButtons.push(btn);
		} else if (tracker === 'bookmark') {
			this.twitterBookmarkButtons.push(btn);
		} else if (tracker === 'heart') {
			this.twitterHeartButtons.push(btn);
		}

		return btn;
	}

	private openTwitterMoreMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle('Refresh').onClick(() => { void this.refresh(); }));
		menu.addItem((item) => item.setTitle('Open settings').onClick(() => this.openPluginSettings()));
		menu.addItem((item) => item.setTitle('Scroll to bottom').onClick(() => {
			this.listContainerEl.scrollTo({ top: this.listContainerEl.scrollHeight, behavior: 'smooth' });
		}));
		menu.showAtMouseEvent(event);
	}

	private renderTwitterRail(container: HTMLElement, isBottomBar: boolean): void {
		container.addClass(isBottomBar ? 'timeline-twitter-bottom-actions' : 'timeline-twitter-rail-actions');
		const settings = this.plugin.data.settings;

		this.createTwitterShortcutButton(container, 'home', 'Home', () => {
			this.twitterDueOnly = false;
			this.twitterBookmarkedOnly = false;
			this.twitterLikedOnly = false;
			this.setTwitterFilterDrawerState(false, false);
			void this.renderCardList();
		});
		this.createTwitterShortcutButton(container, 'search', 'Search', () => {
			this.setTwitterFilterDrawerState(!this.twitterFilterDrawerOpen, true);
		}, 'search');
		this.createTwitterShortcutButton(container, 'bell', 'Due only', () => {
			this.twitterDueOnly = !this.twitterDueOnly;
			void this.renderCardList();
		}, 'bell');
		this.createTwitterShortcutButton(container, 'bookmark', 'Bookmarks only', () => {
			this.twitterBookmarkedOnly = !this.twitterBookmarkedOnly;
			void this.renderCardList();
		}, 'bookmark');
		this.createTwitterShortcutButton(container, 'heart', 'Likes only', () => {
			this.twitterLikedOnly = !this.twitterLikedOnly;
			void this.renderCardList();
		}, 'heart');
		this.createTwitterShortcutButton(container, 'feather', 'Compose', () => {
			void this.handleTwitterFeatherAction();
		});
		this.createTwitterShortcutButton(container, 'more-horizontal', 'More', (event) => {
			this.openTwitterMoreMenu(event);
		});

		if (settings.twitterRailDensity === 'full') {
			this.createTwitterShortcutButton(container, 'refresh-cw', 'Refresh', () => { void this.refresh(); });
			this.createTwitterShortcutButton(container, 'settings', 'Settings', () => this.openPluginSettings());
			this.createTwitterShortcutButton(container, 'chevrons-down', 'Bottom', () => {
				this.listContainerEl.scrollTo({ top: this.listContainerEl.scrollHeight, behavior: 'smooth' });
			});
		}
	}

	private renderTwitterV2Layout(): void {
		const settings = this.plugin.data.settings;
		this.resetTwitterUiRefs();
		this.listContainerEl.addClass('timeline-twitter-v2');

		const shellEl = this.listContainerEl.createDiv({ cls: 'timeline-twitter-shell' });
		const railEl = shellEl.createDiv({ cls: 'timeline-twitter-rail' });
		this.renderTwitterRail(railEl, false);

		const mainEl = shellEl.createDiv({ cls: 'timeline-twitter-main' });
		const header = mainEl.createDiv({ cls: 'timeline-header timeline-twitter-main-header' });
		const leftSection = header.createDiv({ cls: 'timeline-header-left' });
		const refreshBtn = leftSection.createEl('button', {
			cls: 'timeline-refresh-btn',
			text: 'Refresh',
			attr: { 'aria-label': 'Refresh timeline' },
		});
		refreshBtn.addEventListener('click', () => { void this.refresh(); });
		if (settings.selectionMode === 'srs') {
			leftSection.createSpan({ cls: 'timeline-stats' });
			this.updateSrsStatsDisplay();
		}

		const rightSection = header.createDiv({ cls: 'timeline-header-right' });
		const countEl = rightSection.createEl('span', { cls: 'timeline-count' });

		const drawerEl = mainEl.createDiv({ cls: 'timeline-twitter-filter-drawer' });
		const drawerInner = drawerEl.createDiv({ cls: 'timeline-twitter-filter-drawer-inner' });
		this.twitterFilterDrawerEl = drawerEl;
		renderFilterBar(this.getFilterBarContext(drawerInner));
		this.twitterFilterSearchInputEl = drawerInner.querySelector<HTMLInputElement>('.timeline-search-input');
		this.setTwitterFilterDrawerState(this.twitterFilterDrawerOpen, false);

		this.filteredCards = this.applyTwitterSecondaryFilters(applyFilters(this.cards, this.filterState));
		countEl.textContent = this.filteredCards.length === this.cards.length
			? `${this.cards.length} notes`
			: `${this.filteredCards.length} / ${this.cards.length} notes`;

		this.listEl = mainEl.createDiv({ cls: 'timeline-list timeline-twitter-list' });
		this.cardElements = [];

		const enableInfiniteScroll = settings.enableInfiniteScroll;
		const batchSize = settings.infiniteScrollBatchSize || 20;
		const initialCount = enableInfiniteScroll ? batchSize : this.filteredCards.length;
		this.displayedCount = Math.min(initialCount, this.filteredCards.length);

		const { fragment, elements } = this.renderCardsToFragment(
			this.filteredCards.slice(0, this.displayedCount),
			false,
		);
		this.cardElements = elements;
		this.listEl.appendChild(fragment);
		void this.flushPendingEmbeds();
		void this.flushPendingMarkdownRenders();

		mainEl.createDiv({ cls: 'timeline-footer timeline-twitter-footer' });
		this.updateFooter();

		const mobileBar = this.listContainerEl.createDiv({ cls: 'timeline-twitter-bottom-bar' });
		this.renderTwitterRail(mobileBar, true);
		this.updateTwitterShortcutStates();
	}
	async toggleViewMode(): Promise<void> {
		if (this.plugin.data.settings.uiTheme === 'twitter') {
			return;
		}
		const currentMode = this.plugin.data.settings.viewMode;
		this.plugin.data.settings.viewMode = currentMode === 'list' ? 'grid' : 'list';
		await this.plugin.syncAndSave();
		this.lastCardPaths = [];
		this.lastCardStateKeys = [];
		await this.render();
	}

	/**
* 処理: Compose入力を描画する
	 */
	private renderComposeBox(): void {
		const composeBox = this.listContainerEl.createDiv({ cls: 'timeline-compose-box' });

// 説明: UIを描画する
		const avatarEl = composeBox.createDiv({ cls: 'timeline-compose-avatar' });
		avatarEl.textContent = this.plugin.data.settings.twitterAvatarEmoji || '\u{1F4DD}';

// 説明: UIを描画する
		const inputArea = composeBox.createDiv({ cls: 'timeline-compose-input-area' });

		const textarea = inputArea.createEl('textarea', {
			cls: 'timeline-compose-textarea',
			attr: {
				placeholder: "What's on your mind?",
				rows: '1',
			},
		});

// 説明: UIを描画する
		const actionsBar = inputArea.createDiv({ cls: 'timeline-compose-actions' });

// 説明: UIを描画する
		const charCounter = actionsBar.createSpan({ cls: 'timeline-compose-char-counter' });
		charCounter.textContent = '0';

		textarea.addEventListener('input', () => {
			charCounter.textContent = String(textarea.value.length);
		});

// 説明: UIを描画する
		const postBtn = actionsBar.createEl('button', {
			cls: 'timeline-compose-post-btn',
			text: 'Post',
		});
		postBtn.disabled = true;

		textarea.addEventListener('input', () => {
			postBtn.disabled = textarea.value.trim().length === 0;
		});

		postBtn.addEventListener('click', () => {
			const content = textarea.value.trim();
			if (content.length === 0) return;

			postBtn.disabled = true;
			postBtn.textContent = 'Posting...';

			void this.createQuickNote(content).then(() => {
				textarea.value = '';
				charCounter.textContent = '0';
				postBtn.textContent = 'Post';

// 説明: 補助的な更新処理
				void this.refresh();
			}).catch((error: unknown) => {
				console.error('Failed to create quick note:', error);
				postBtn.textContent = 'Post';
				postBtn.disabled = false;
			});
		});

// 説明: イベントを登録する
		textarea.addEventListener('keydown', (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !postBtn.disabled) {
				e.preventDefault();
				postBtn.click();
			}
		});
	}

	/**
* 処理: 補助処理を実行する
	 */
	private async createQuickNote(content: string): Promise<void> {
		const settings = this.plugin.data.settings;
		const template = settings.quickNoteTemplate || DEFAULT_QUICK_NOTE_TEMPLATE;

// 説明: 補助的な更新処理
		const now = new Date();
		const uid = now.getTime().toString(36);

// 説明: 補助的な更新処理
		const dateParts = now.toISOString().split('T');
		const dateStr = dateParts[0] ?? '';

// 説明: 補助的な更新処理
		const lines = content.split('\n');
		const firstLine = lines[0] ?? '';
		const title = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;

// 説明: 補助的な更新処理
		const noteContent = template
			.replace(/\{\{uid\}\}/g, uid)
			.replace(/\{\{title\}\}/g, title)
			.replace(/\{\{date\}\}/g, dateStr)
			.replace(/\{\{content\}\}/g, content);

// 説明: 補助的な更新処理
		const safeTitle = title
			.replace(/[\\/:*?"<>|#^[\]]/g, '')
			.replace(/\s+/g, '_')
			.substring(0, 30);
		const fileName = `${dateStr}_${uid}_${safeTitle}.md`;

// 説明: 補助的な更新処理
		const folder = settings.quickNoteFolder.trim();
		const filePath = folder ? `${folder}/${fileName}` : fileName;

// 説明: 補助的な更新処理
		if (folder) {
			const folderExists = this.app.vault.getAbstractFileByPath(folder);
			if (!folderExists) {
				const parts = folder.split('/');
				let currentPath = '';
				for (const part of parts) {
					currentPath = currentPath ? `${currentPath}/${part}` : part;
					const exists = this.app.vault.getAbstractFileByPath(currentPath);
					if (!exists) {
						try {
							await this.app.vault.createFolder(currentPath);
						} catch (err) {
							console.error(`Failed to create folder: ${currentPath}`, err);
							throw new Error(`Failed to create quick-note folder: ${currentPath}`);
						}
					}
				}
			}
		}

// 説明: ノートファイルを作成する
		await this.app.vault.create(filePath, noteContent);
	}

	/**
* 処理: フィルターバーコンテキストを構築する
	  */
	private getFilterBarContext(containerEl: HTMLElement = this.listContainerEl): FilterBarContext {
		return {
			state: this.filterState,
			cards: this.cards,
			cachedAllTags: this.cachedAllTags,
			listContainerEl: containerEl,
			app: this.app,
			plugin: this.plugin,
			onFilterChanged: () => { void this.renderCardList(); },
			render: () => this.render(),
		};
	}

	/**
* 処理: 補助処理を実行する
	  */
	private async renderCardList(): Promise<void> {
		if (!this.listContainerEl) {
			return;
		}
// 説明: フィルター状態を反映する
		this.filteredCards = this.applyTwitterSecondaryFilters(applyFilters(this.cards, this.filterState));

// 説明: フィルター状態を反映する
		const countEl = this.listContainerEl.querySelector('.timeline-count');
		if (countEl) {
			const countText = this.filteredCards.length === this.cards.length
				? `${this.cards.length} notes`
				: `${this.filteredCards.length} / ${this.cards.length} notes`;
			countEl.textContent = countText;
		}

// 説明: フィルター状態を反映する
		updateFilterBarUI(this.listContainerEl, this.filterState);

// 説明: フィルター状態を反映する
		const settings = this.plugin.data.settings;
		const isGridMode = settings.uiTheme === 'twitter' ? false : settings.viewMode === 'grid';
		this.listEl = this.listContainerEl.querySelector('.timeline-list, .timeline-grid') as HTMLElement;
		if (!this.listEl) return;

		this.listEl.empty();
		this.cardElements = [];

// 説明: スクロール状態を管理する
		const enableInfiniteScroll = settings.enableInfiniteScroll;
		const batchSize = settings.infiniteScrollBatchSize || 20;
		const initialCount = enableInfiniteScroll ? batchSize : this.filteredCards.length;
		this.displayedCount = Math.min(initialCount, this.filteredCards.length);

		this.pendingEmbeds.clear();
		this.pendingMarkdownRenders = [];
		const { fragment: listFragment, elements: listElements } = this.renderCardsToFragment(
			this.filteredCards.slice(0, this.displayedCount), isGridMode
		);
		this.cardElements = listElements;
		this.listEl.appendChild(listFragment);
		await Promise.all([
			this.flushPendingEmbeds(),
			this.flushPendingMarkdownRenders(),
		]);

		this.focusedIndex = -1;

// 説明: 補助的な更新処理
		this.updateFooter();
		this.updateTwitterShortcutStates();
	}

	/**
* 処理: 補助処理を実行する
	  */
	private getEmbedRenderContext(): EmbedRenderContext {
		return {
			app: this.app,
			renderComponent: this.renderComponent,
			openNote: (card: TimelineCard) => this.openNote(card),
		};
	}

	/**
* 処理: カード描画コンテキストを構築する
	  */
	private getCardRenderContext(): CardRenderContext {
		return {
			app: this.app,
			plugin: this.plugin,
			pendingEmbeds: this.pendingEmbeds,
			pendingMarkdownRenders: this.pendingMarkdownRenders,
			embedRenderContext: this.getEmbedRenderContext(),
			openNote: (card) => this.openNote(card),
			isFileBookmarked: (path) => this.isFileBookmarked(path),
			toggleBookmark: (path) => this.toggleBookmark(path),
			isLiked: (path) => this.plugin.isLiked(path),
			toggleLike: (path) => this.plugin.toggleLike(path),
			applySrsCountDelta: (deltaNew, deltaDue) => this.applySrsCountDelta(deltaNew, deltaDue),
			refresh: () => this.refresh(),
			createQuickNote: (content) => this.createQuickNote(content),
		};
	}

	/**
* 処理: ノートを開く
	 */
	private async openNote(card: TimelineCard): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (!file || !(file instanceof TFile)) return;

		if (Platform.isMobile) {
// 説明: モバイル向け処理を行う
			await this.app.workspace.getLeaf().openFile(file);
			return;
		}

// 説明: Leaf選択を調整する
		let targetLeaf: WorkspaceLeaf;

		if (this.previousActiveLeaf) {
// 説明: Leaf選択を調整する
			const parent = this.previousActiveLeaf.parent;
			if (parent) {
// 説明: Leaf選択を調整する
				targetLeaf = this.app.workspace.createLeafInParent(parent as unknown as WorkspaceSplit, -1);
			} else {
				targetLeaf = this.app.workspace.getLeaf('tab');
			}
		} else {
// 説明: Leaf選択を調整する
			const adjacentLeaf = this.findAdjacentLeaf(this.leaf);
			if (adjacentLeaf) {
				const parent = adjacentLeaf.parent;
				if (parent) {
// 説明: Leaf選択を調整する
					targetLeaf = this.app.workspace.createLeafInParent(parent as unknown as WorkspaceSplit, -1);
				} else {
					targetLeaf = this.app.workspace.getLeaf('tab');
				}
			} else {
// 説明: Leaf選択を調整する
				targetLeaf = this.app.workspace.getLeaf('split');
			}
		}

		await targetLeaf.openFile(file);

// 説明: Leaf選択を調整する
		this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
	}

	/**
* 処理: 隔接Leafを探索する
	  */
	private findAdjacentLeaf(timelineLeaf: WorkspaceLeaf): WorkspaceLeaf | null {
		let targetLeaf: WorkspaceLeaf | null = null;
		let foundMarkdownLeaf: WorkspaceLeaf | null = null;

		this.app.workspace.iterateAllLeaves((leaf) => {
// 説明: Leaf選択を調整する
			if (leaf === timelineLeaf) return;

// 説明: Leaf選択を調整する
			if (leaf.view.getViewType() === TIMELINE_VIEW_TYPE) return;

// 説明: Leaf選択を調整する
			if (leaf.view.getViewType() === 'markdown') {
				foundMarkdownLeaf = leaf;
			}

// 説明: Leaf選択を調整する
			if (!targetLeaf) {
				targetLeaf = leaf;
			}
		});

// 説明: Leaf選択を調整する
		return foundMarkdownLeaf || targetLeaf;
	}

	/**
* 処理: ブックマーク状態を判定する
	  */
	private isFileBookmarked(path: string): boolean {
// 説明: ブックマーク状態を更新する
		if (this.cachedBookmarkedPaths) {
			return this.cachedBookmarkedPaths.has(path);
		}

// 説明: ブックマーク状態を更新する
		this.cachedBookmarkedPaths = getBookmarkedPaths(this.app);
		return this.cachedBookmarkedPaths.has(path);
	}

	/**
* 処理: ブックマーク状態を切替する
	 */
	private toggleBookmark(path: string): boolean {
		const bookmarks = getBookmarksPlugin(this.app);
		if (!bookmarks?.instance) {
			return false;
		}

		const instance = bookmarks.instance;
		const existing = instance.items.find(item =>
			item.type === 'file' && item.path === path
		);

		let result: boolean;
		if (existing) {
// 説明: 補助的な更新処理
			instance.removeItem(existing);
			result = false;
		} else {
// 説明: 補助的な更新処理
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file && file instanceof TFile) {
				instance.addItem({ type: 'file', path: path, title: '' });
				result = true;
			} else {
				result = false;
			}
		}

// 説明: ブックマーク状態を更新する
		clearBookmarkCache();
		this.cachedBookmarkedPaths = null;

		return result;
	}

	/**
* 処理: スクロールに応じて追加読込を判定する
	  */
	private handleScroll(): void {
		this.lastScrollEventAt = Date.now();
		void this.flushPendingEmbeds();
		void this.flushPendingMarkdownRenders();
		if (!this.plugin.data.settings.enableInfiniteScroll) return;
		if (this.isLoadingMore) return;
		if (this.displayedCount >= this.filteredCards.length) return;

		const container = this.listContainerEl;
		const scrollBottom = container.scrollTop + container.clientHeight;
		const threshold = container.scrollHeight - 200; // 説明: 下端手前で追加読み込みを開始
		if (scrollBottom >= threshold) {
			void this.loadMoreCards();
		}
	}

	/**
* 処理: カードを追加読込する
	  */
	private async loadMoreCards(): Promise<void> {
		if (this.isLoadingMore) return;
		if (this.displayedCount >= this.filteredCards.length) return;
		if (!this.listEl) return;

		this.isLoadingMore = true;

		const settings = this.plugin.data.settings;
		const isGridMode = settings.uiTheme === 'twitter' ? false : settings.viewMode === 'grid';
		const batchSize = settings.infiniteScrollBatchSize || 20;
		const startIndex = this.displayedCount;
		const endIndex = Math.min(startIndex + batchSize, this.filteredCards.length);

// 説明: フィルター状態を反映する
		const cardsToLoad = this.filteredCards.slice(startIndex, endIndex).filter((c): c is TimelineCard => !!c);
		const moreElements = await this.appendCardsInChunks(cardsToLoad, isGridMode);
		this.cardElements.push(...moreElements);
// 説明: 補助的な更新処理
		void this.flushPendingEmbeds();
		void this.flushPendingMarkdownRenders();

		this.displayedCount = endIndex;
		this.isLoadingMore = false;

// 説明: 補助的な更新処理
		this.updateFooter();
		this.updateTwitterShortcutStates();
	}

	/**
* 処理: フッター表示を更新する
	  */
	private updateFooter(): void {
		const footer = this.listContainerEl.querySelector('.timeline-footer');
		if (!footer) return;

		footer.empty();

		const settings = this.plugin.data.settings;
		if (settings.enableInfiniteScroll && this.displayedCount < this.filteredCards.length) {
			const loadingEl = footer.createDiv({ cls: 'timeline-loading-indicator' });
			loadingEl.createSpan({ cls: 'timeline-loading-spinner' });
			loadingEl.createSpan({ cls: 'timeline-loading-text', text: 'Scroll for more...' });
		} else {
			const bottomRefreshBtn = footer.createEl('button', {
				cls: 'timeline-refresh-btn',
				text: 'Refresh',
				attr: { 'aria-label': 'Refresh timeline' },
			});
			bottomRefreshBtn.addEventListener('click', () => { void this.refresh(); });
		}
	}

	/**
* 処理: キーボードナビコンテキストを構築する
	 */
	private getKeyboardNavContext(): KeyboardNavContext {
		return {
			filteredCards: this.filteredCards,
			cardElements: this.cardElements,
			focusedIndex: this.focusedIndex,
			updateFocusedIndex: (index: number) => { this.focusedIndex = index; },
			plugin: this.plugin,
			app: this.app,
			openNote: (card) => this.openNote(card),
			createDifficultyButtons: (c, card) => createDifficultyButtons(this.getCardRenderContext(), c, card),
			replaceWithUndoButton: (c, card) => replaceWithUndoButton(this.getCardRenderContext(), c, card),
			toggleBookmark: (path) => this.toggleBookmark(path),
			applySrsCountDelta: (deltaNew, deltaDue) => this.applySrsCountDelta(deltaNew, deltaDue),
			refresh: () => this.refresh(),
		};
	}
}
