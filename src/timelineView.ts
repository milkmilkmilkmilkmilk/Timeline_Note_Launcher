// Timeline Note Launcher - Timeline View
import { ItemView, WorkspaceLeaf, WorkspaceSplit, Platform, TFile, MarkdownRenderer, Component, Menu, Modal } from 'obsidian';
import { TimelineCard, DifficultyRating, ColorTheme, ImageSizeMode, UITheme, DEFAULT_QUICK_NOTE_TEMPLATE, FilterPreset } from './types';
import { getNextIntervals, getBookmarkedPaths, getBookmarksPlugin, clearBookmarkCache } from './dataLayer';
import { CommentModal } from './commentModal';
import { QuoteNoteModal } from './quoteNoteModal';
import { LinkNoteModal } from './linkNoteModal';
import type TimelineNoteLauncherPlugin from './main';

/**
 * 驟榊・縺ｮ蜀・ｮｹ縺檎ｭ峨＠縺・°繧呈ｯ碑ｼ・
 */
function arraysEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/**
 * 繧ｫ繝ｼ繝峨・譖ｴ譁ｰ讀懃衍逕ｨ繧ｭ繝ｼ
 */
function buildCardStateKey(card: TimelineCard): string {
	return [
		card.path,
		String(card.lastReviewedAt ?? ''),
		String(card.reviewCount),
		String(card.nextReviewAt ?? ''),
	].join('|');
}

/**
 * シンプルな入力モーダル（プリセット名入力用）
 */
class TextInputModal extends Modal {
	private result: string | null = null;
	private resolvePromise: ((value: string | null) => void) | null = null;
	private title: string;
	private placeholder: string;

	constructor(app: import('obsidian').App, title: string, placeholder: string) {
		super(app);
		this.title = title;
		this.placeholder = placeholder;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('timeline-preset-name-modal');
		contentEl.createEl('h3', { text: this.title });

		const inputEl = contentEl.createEl('input', {
			type: 'text',
			placeholder: this.placeholder,
			cls: 'timeline-preset-name-input',
		});

		const buttonContainer = contentEl.createDiv({ cls: 'timeline-preset-modal-buttons' });

		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => {
			this.result = null;
			this.close();
		});

		const saveBtn = buttonContainer.createEl('button', { text: 'Save', cls: 'mod-cta' });
		saveBtn.addEventListener('click', () => {
			this.result = inputEl.value;
			this.close();
		});

		// Enter キーで保存
		inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				this.result = inputEl.value;
				this.close();
			}
		});

		// フォーカスを入力欄に
		setTimeout(() => inputEl.focus(), 50);
	}

	onClose(): void {
		if (this.resolvePromise) {
			this.resolvePromise(this.result);
		}
	}

	async waitForResult(): Promise<string | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
		});
	}
}

export const TIMELINE_VIEW_TYPE = 'timeline-note-launcher';

export class TimelineView extends ItemView {
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
	// 繝輔ぅ繝ｫ繧ｿ迥ｶ諷・
	private searchQuery: string = '';
	private fileTypeFilters: Set<string> = new Set(['markdown', 'text', 'image', 'pdf', 'audio', 'video', 'office', 'ipynb', 'other']);
	private selectedTags: Set<string> = new Set();
	private searchDebounceTimer: number | null = null;
	// 日付範囲フィルタ
	private dateFilterStart: string = '';  // YYYY-MM-DD形式
	private dateFilterEnd: string = '';    // YYYY-MM-DD形式
	// 逶ｴ蜑阪↓繧｢繧ｯ繝・ぅ繝悶□縺｣縺殕eaf・医ち繧､繝繝ｩ繧､繝ｳ莉･螟厄ｼ・
	private previousActiveLeaf: WorkspaceLeaf | null = null;
	// 蟾ｮ蛻・Ξ繝ｳ繝繝ｪ繝ｳ繧ｰ逕ｨ・壼燕蝗槭・繧ｫ繝ｼ繝峨ヱ繧ｹ
	private lastCardPaths: string[] = [];
	// 蟾ｮ蛻・Ξ繝ｳ繝繝ｪ繝ｳ繧ｰ逕ｨ・壼燕蝗槭・繧ｫ繝ｼ繝臥憾諷九く繝ｼ
	private lastCardStateKeys: string[] = [];
	// 繝悶ャ繧ｯ繝槭・繧ｯ繝代せ縺ｮ繧ｭ繝｣繝・す繝･
	private cachedBookmarkedPaths: Set<string> | null = null;
	// 繧ｿ繧ｰ繧ｭ繝｣繝・す繝･・・efresh()譎ゅ↓譖ｴ譁ｰ・・
	private cachedAllTags: string[] = [];
	private isTagsCollapsed: boolean = false;
	// 辟｡髯舌せ繧ｯ繝ｭ繝ｼ繝ｫ逕ｨ
	private displayedCount: number = 0;
	private isLoadingMore: boolean = false;
	private scrollHandler: () => void;
	private listEl: HTMLElement | null = null;
	// 繝励Ν繝医ぇ繝ｪ繝輔Ξ繝・す繝･逕ｨ
	private pullToRefreshStartY: number = 0;
	private pullToRefreshTriggered: boolean = false;
	private pullIndicatorEl: HTMLElement | null = null;
	private touchStartHandler: (e: TouchEvent) => void;
	private touchMoveHandler: (e: TouchEvent) => void;
	private touchEndHandler: (e: TouchEvent) => void;

	constructor(leaf: WorkspaceLeaf, plugin: TimelineNoteLauncherPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.renderComponent = new Component();
		this.keydownHandler = this.handleKeydown.bind(this);
		this.scrollHandler = this.handleScroll.bind(this);
		// 繝励Ν繝医ぇ繝ｪ繝輔Ξ繝・す繝･逕ｨ
		this.touchStartHandler = this.handleTouchStart.bind(this);
		this.touchMoveHandler = this.handleTouchMove.bind(this);
		this.touchEndHandler = this.handleTouchEnd.bind(this);
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

		// 繝｢繝舌う繝ｫ蜷代￠繧ｯ繝ｩ繧ｹ霑ｽ蜉
		this.updateMobileClass();

		// 繧ｭ繝ｼ繝懊・繝峨す繝ｧ繝ｼ繝医き繝・ヨ逋ｻ骭ｲ
		this.listContainerEl.tabIndex = 0;
		this.listContainerEl.addEventListener('keydown', this.keydownHandler);

		// 辟｡髯舌せ繧ｯ繝ｭ繝ｼ繝ｫ逕ｨ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ繧､繝吶Φ繝育匳骭ｲ
		this.listContainerEl.addEventListener('scroll', this.scrollHandler);

		// 繝励Ν繝医ぇ繝ｪ繝輔Ξ繝・す繝･逕ｨ繧ｿ繝・メ繧､繝吶Φ繝育匳骭ｲ・医Δ繝舌う繝ｫ縺ｮ縺ｿ・・
		if (Platform.isMobile) {
			this.listContainerEl.addEventListener('touchstart', this.touchStartHandler, { passive: true });
			this.listContainerEl.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
			this.listContainerEl.addEventListener('touchend', this.touchEndHandler, { passive: true });
		}

		// 繧｢繧ｯ繝・ぅ繝僕eaf縺ｮ螟画峩繧堤屮隕悶＠縺ｦ縲√ち繧､繝繝ｩ繧､繝ｳ莉･螟悶・leaf繧定ｨ倬鹸
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf && leaf !== this.leaf && leaf.view.getViewType() !== TIMELINE_VIEW_TYPE) {
					this.previousActiveLeaf = leaf;
				}
			})
		);

		// 迴ｾ蝨ｨ繧｢繧ｯ繝・ぅ繝悶↑leaf繧貞・譛溷､縺ｨ縺励※菫晏ｭ假ｼ医ち繧､繝繝ｩ繧､繝ｳ莉･螟厄ｼ・
		const currentActive = this.app.workspace.getActiveViewOfType(ItemView)?.leaf;
		if (currentActive && currentActive !== this.leaf && currentActive.view.getViewType() !== TIMELINE_VIEW_TYPE) {
			this.previousActiveLeaf = currentActive;
		}

		await this.refresh();
	}

	/**
	 * 繝｢繝舌う繝ｫ繧ｯ繝ｩ繧ｹ縺ｮ譖ｴ譁ｰ
	 */
	private updateMobileClass(): void {
		// 螳滄圀縺ｮ繝｢繝舌う繝ｫ繝・ヰ繧､繧ｹ縲√∪縺溘・PC縺ｧ繝｢繝舌う繝ｫ繝｢繝ｼ繝峨′譛牙柑縺ｪ蝣ｴ蜷・
		const isMobileView = Platform.isMobile || this.plugin.data.settings.mobileViewOnDesktop;
		if (isMobileView) {
			this.listContainerEl.addClass('timeline-mobile');
		} else {
			this.listContainerEl.removeClass('timeline-mobile');
		}
	}

	/**
	 * 繧ｫ繝ｩ繝ｼ繝・・繝槭・譖ｴ譁ｰ
	 */
	private updateColorTheme(): void {
		const theme = this.plugin.data.settings.colorTheme;
		const themes: ColorTheme[] = ['default', 'blue', 'green', 'purple', 'orange', 'pink', 'red', 'cyan', 'yellow'];

		// 譌｢蟄倥・繝・・繝槭け繝ｩ繧ｹ繧貞炎髯､
		for (const t of themes) {
			this.listContainerEl.removeClass(`timeline-theme-${t}`);
		}

		// 譁ｰ縺励＞繝・・繝槭け繝ｩ繧ｹ繧定ｿｽ蜉
		this.listContainerEl.addClass(`timeline-theme-${theme}`);
	}

	/**
	 * UI繝・・繝槭・譖ｴ譁ｰ
	 */
	private updateUITheme(): void {
		const uiTheme = this.plugin.data.settings.uiTheme;
		const themes: UITheme[] = ['classic', 'twitter'];

		// 譌｢蟄倥・UI繝・・繝槭け繝ｩ繧ｹ繧貞炎髯､
		for (const t of themes) {
			this.listContainerEl.removeClass(`timeline-ui-${t}`);
		}

		// 譁ｰ縺励＞UI繝・・繝槭け繝ｩ繧ｹ繧定ｿｽ蜉
		this.listContainerEl.addClass(`timeline-ui-${uiTheme}`);
	}

	/**
	 * 繝｢繝舌う繝ｫ繝｢繝ｼ繝峨ｒ蛻・ｊ譖ｿ縺茨ｼ・C縺ｮ縺ｿ・・
	 */
	async toggleMobileView(): Promise<void> {
		if (Platform.isMobile) return;
		this.plugin.data.settings.mobileViewOnDesktop = !this.plugin.data.settings.mobileViewOnDesktop;
		void this.plugin.syncAndSave();
		this.updateMobileClass();
		// 蠑ｷ蛻ｶ逧・↓蜀肴緒逕ｻ縺吶ｋ縺溘ａ縺ｫ繧ｭ繝｣繝・す繝･繧偵け繝ｪ繧｢
		this.lastCardPaths = [];
		this.lastCardStateKeys = [];
		await this.render();
	}

	async onClose(): Promise<void> {
		// 繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ菴咲ｽｮ繧剃ｿ晏ｭ・
		this.scrollPosition = this.listContainerEl.scrollTop;
		// 讀懃ｴ｢繝・ヰ繧ｦ繝ｳ繧ｹ繧ｿ繧､繝槭・繧定ｧ｣髯､
		if (this.searchDebounceTimer !== null) {
			window.clearTimeout(this.searchDebounceTimer);
			this.searchDebounceTimer = null;
		}
		// 繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ繧ｳ繝ｳ繝昴・繝阪Φ繝医ｒ繧｢繝ｳ繝ｭ繝ｼ繝・
		this.renderComponent.unload();
		// 繧ｭ繝ｼ繝懊・繝峨Μ繧ｹ繝翫・繧定ｧ｣髯､
		this.listContainerEl.removeEventListener('keydown', this.keydownHandler);
		// 繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ繝ｪ繧ｹ繝翫・繧定ｧ｣髯､
		this.listContainerEl.removeEventListener('scroll', this.scrollHandler);
		// 繧ｿ繝・メ繝ｪ繧ｹ繝翫・繧定ｧ｣髯､
		if (Platform.isMobile) {
			this.listContainerEl.removeEventListener('touchstart', this.touchStartHandler);
			this.listContainerEl.removeEventListener('touchmove', this.touchMoveHandler);
			this.listContainerEl.removeEventListener('touchend', this.touchEndHandler);
		}
	}

	/**
	 * 繧ｿ繧､繝繝ｩ繧､繝ｳ繧呈峩譁ｰ
	 */
	async refresh(): Promise<void> {
		// 繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ菴咲ｽｮ繧剃ｿ晏ｭ・
		this.scrollPosition = this.listContainerEl?.scrollTop ?? 0;

		// 陦ｨ遉ｺ險ｭ螳壹ｒ譖ｴ譁ｰ・郁ｨｭ螳壹→縺ｮ蜷梧悄・・
		this.updateMobileClass();
		this.updateColorTheme();
		this.updateUITheme();

		// 繝悶ャ繧ｯ繝槭・繧ｯ繧ｭ繝｣繝・す繝･繧呈峩譁ｰ
		this.cachedBookmarkedPaths = getBookmarkedPaths(this.app);

		// 繧ｫ繝ｼ繝峨ｒ蜿門ｾ・
		const result = await this.plugin.getTimelineCards();
		this.cards = result.cards;
		this.cachedAllTags = this.collectAllTags();
		this.newCount = result.newCount;
		this.dueCount = result.dueCount;

		// 謠冗判
		await this.render();

		// 繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ菴咲ｽｮ繧貞ｾｩ蜈・
		if (this.listContainerEl) {
			this.listContainerEl.scrollTop = this.scrollPosition;
		}
	}

	/**
	 * 繧ｫ繝ｼ繝峨ｒ繝√Ε繝ｳ繧ｯ蜊倅ｽ阪〒謠冗判縺優ocumentFragment縺ｫ霑ｽ蜉
	 */
	private async renderCardsToFragment(
		cards: TimelineCard[],
		isGridMode: boolean,
		chunkSize: number = 5
	): Promise<{ fragment: DocumentFragment; elements: HTMLElement[] }> {
		const fragment = document.createDocumentFragment();
		const elements: HTMLElement[] = [];
		for (let i = 0; i < cards.length; i += chunkSize) {
			const chunk = cards.slice(i, i + chunkSize);
			const chunkEls = await Promise.all(
				chunk.map(card =>
					isGridMode ? this.createGridCardElement(card) : this.createCardElement(card)
				)
			);
			for (const el of chunkEls) {
				fragment.appendChild(el);
				elements.push(el);
			}
		}
		return { fragment, elements };
	}

	/**
	 * 繧ｫ繝ｼ繝我ｸ隕ｧ繧呈緒逕ｻ
	 */
	private async render(): Promise<void> {
		// 繧ｫ繝ｼ繝峨ヱ繧ｹ縺ｮ螟画峩繧呈､懷・
		const newPaths = this.cards.map(c => c.path);
		const newStateKeys = this.cards.map(card => buildCardStateKey(card));
		const pathsChanged = !arraysEqual(this.lastCardPaths, newPaths);
		const stateChanged = !arraysEqual(this.lastCardStateKeys, newStateKeys);

		// 繝代せ繧・き繝ｼ繝牙・螳ｹ縺悟､峨ｏ縺｣縺ｦ縺・↑縺・ｴ蜷医・螳悟・蜀肴ｧ狗ｯ峨ｒ繧ｹ繧ｭ繝・・・医・繝・ム繝ｼ縺ｮ邨ｱ險医・縺ｿ譖ｴ譁ｰ・・
		if (!pathsChanged && !stateChanged && this.listContainerEl.hasChildNodes()) {
			// 邨ｱ險医・縺ｿ譖ｴ譁ｰ
			const statsEl = this.listContainerEl.querySelector('.timeline-stats');
			if (statsEl && this.plugin.data.settings.selectionMode === 'srs') {
				statsEl.empty();
				statsEl.createSpan({ cls: 'timeline-stat-new', text: `${this.newCount} new` });
				statsEl.appendText(' ﾂｷ ');
				statsEl.createSpan({ cls: 'timeline-stat-due', text: `${this.dueCount} due` });
			}
			return;
		}

		// 繝代せ繧定ｨ倬鹸
		this.lastCardPaths = newPaths;
		this.lastCardStateKeys = newStateKeys;

		// 蜿､縺・Ξ繝ｳ繝繝ｪ繝ｳ繧ｰ繧偵け繝ｪ繝ｼ繝ｳ繧｢繝・・
		this.renderComponent.unload();
		this.renderComponent = new Component();
		this.renderComponent.load();

		this.listContainerEl.empty();

		// 逕ｻ蜒上し繧､繧ｺ繝｢繝ｼ繝峨け繝ｩ繧ｹ繧帝←逕ｨ
		const imageSizeMode = this.plugin.data.settings.imageSizeMode;
		const sizeModes: ImageSizeMode[] = ['small', 'medium', 'large', 'full'];
		for (const mode of sizeModes) {
			this.listContainerEl.removeClass(`timeline-image-${mode}`);
		}
		this.listContainerEl.addClass(`timeline-image-${imageSizeMode}`);

		// 繝励Ξ繝薙Η繝ｼ鬮倥＆蛻ｶ邏・ｼ・ixed lines 繝｢繝ｼ繝峨・縺ｿ・・
		if (this.plugin.data.settings.previewMode === 'lines') {
			this.listContainerEl.addClass('timeline-preview-clamped');
			const maxHeight = this.plugin.data.settings.previewLines * 40 + 16;
			this.listContainerEl.style.setProperty('--preview-max-height', `${maxHeight}px`);
		} else {
			this.listContainerEl.removeClass('timeline-preview-clamped');
			this.listContainerEl.style.removeProperty('--preview-max-height');
		}

		// 繝倥ャ繝繝ｼ
		const header = this.listContainerEl.createDiv({ cls: 'timeline-header' });

		const leftSection = header.createDiv({ cls: 'timeline-header-left' });
		const refreshBtn = leftSection.createEl('button', {
			cls: 'timeline-refresh-btn',
			text: '↻',
			attr: { 'aria-label': 'Refresh timeline' },
		});
		refreshBtn.addEventListener('click', () => { void this.refresh(); });

		// SRS繝｢繝ｼ繝峨〒縺ｯ邨ｱ險医ｒ陦ｨ遉ｺ
		const settings = this.plugin.data.settings;
		if (settings.selectionMode === 'srs') {
			const statsEl = leftSection.createSpan({ cls: 'timeline-stats' });
			statsEl.createSpan({ cls: 'timeline-stat-new', text: `${this.newCount} new` });
			statsEl.createSpan({ text: ' ﾂｷ ' });
			statsEl.createSpan({ cls: 'timeline-stat-due', text: `${this.dueCount} due` });
		}

		const rightSection = header.createDiv({ cls: 'timeline-header-right' });

		// PC/繝｢繝舌う繝ｫ蛻・ｊ譖ｿ縺医・繧ｿ繝ｳ・・C縺ｮ縺ｿ陦ｨ遉ｺ・・
		if (!Platform.isMobile) {
			const isMobileView = settings.mobileViewOnDesktop;
			const toggleBtn = rightSection.createEl('button', {
				cls: 'timeline-view-toggle-btn',
				text: isMobileView ? 'Desktop' : 'Mobile',
				attr: { 'aria-label': isMobileView ? 'Switch to PC view' : 'Switch to Mobile view' },
			});
			toggleBtn.addEventListener('click', () => { void this.toggleMobileView(); });
		}

		// 繝ｪ繧ｹ繝・繧ｰ繝ｪ繝・ラ蛻・ｊ譖ｿ縺医・繧ｿ繝ｳ
		const viewMode = settings.viewMode;
		const viewModeBtn = rightSection.createEl('button', {
			cls: 'timeline-view-mode-btn',
			text: viewMode === 'list' ? '笆､' : '笆ｦ',
			attr: { 'aria-label': viewMode === 'list' ? 'Switch to Grid view' : 'Switch to List view' },
		});
		viewModeBtn.addEventListener('click', () => { void this.toggleViewMode(); });

		// 繧ｯ繧､繝・け繝弱・繝井ｽ懈・繝懊ャ繧ｯ繧ｹ繧呈緒逕ｻ
		this.renderComposeBox();

		// 繝輔ぅ繝ｫ繧ｿ繝舌・繧呈緒逕ｻ
		this.renderFilterBar();

		// 繝輔ぅ繝ｫ繧ｿ繧帝←逕ｨ
		this.applyFilters();

		// 繧ｫ繝ｼ繝画焚陦ｨ遉ｺ・医ヵ繧｣繝ｫ繧ｿ蠕鯉ｼ・
		const countText = this.filteredCards.length === this.cards.length
			? `${this.cards.length} notes`
			: `${this.filteredCards.length} / ${this.cards.length} notes`;
		rightSection.createEl('span', {
			cls: 'timeline-count',
			text: countText,
		});

		// 繧ｫ繝ｼ繝峨Μ繧ｹ繝・繧ｰ繝ｪ繝・ラ
		const isGridMode = settings.viewMode === 'grid';
		const listCls = isGridMode ? `timeline-grid timeline-grid-cols-${settings.gridColumns}` : 'timeline-list';
		this.listEl = this.listContainerEl.createDiv({ cls: listCls });

		// 繧ｫ繝ｼ繝芽ｦ∫ｴ驟榊・繧偵Μ繧ｻ繝・ヨ
		this.cardElements = [];

		// 辟｡髯舌せ繧ｯ繝ｭ繝ｼ繝ｫ蟇ｾ蠢懶ｼ壼・譛溯｡ｨ遉ｺ謨ｰ繧呈ｱｺ螳・
		const enableInfiniteScroll = settings.enableInfiniteScroll;
		const batchSize = settings.infiniteScrollBatchSize || 20;
		const initialCount = enableInfiniteScroll ? batchSize : this.filteredCards.length;
		this.displayedCount = Math.min(initialCount, this.filteredCards.length);

		// 蛻晄悄繧ｫ繝ｼ繝峨ｒ繝√Ε繝ｳ繧ｯ謠冗判
		const { fragment, elements } = await this.renderCardsToFragment(
			this.filteredCards.slice(0, this.displayedCount), isGridMode
		);
		this.cardElements = elements;
		this.listEl.appendChild(fragment);

		// 荳矩Κ繝輔ャ繧ｿ繝ｼ
		const footer = this.listContainerEl.createDiv({ cls: 'timeline-footer' });

		// 辟｡髯舌せ繧ｯ繝ｭ繝ｼ繝ｫ譎ゅ・繝ｭ繝ｼ繝・ぅ繝ｳ繧ｰ繧､繝ｳ繧ｸ繧ｱ繝ｼ繧ｿ繝ｼ縲√◎縺・〒縺ｪ縺代ｌ縺ｰ繝ｪ繝輔Ξ繝・す繝･繝懊ち繝ｳ
		if (enableInfiniteScroll && this.displayedCount < this.filteredCards.length) {
			const loadingEl = footer.createDiv({ cls: 'timeline-loading-indicator' });
			loadingEl.createSpan({ cls: 'timeline-loading-spinner' });
			loadingEl.createSpan({ cls: 'timeline-loading-text', text: 'Scroll for more...' });
		} else {
			const bottomRefreshBtn = footer.createEl('button', {
				cls: 'timeline-refresh-btn',
				text: '↻',
				attr: { 'aria-label': 'Refresh timeline' },
			});
			bottomRefreshBtn.addEventListener('click', () => { void this.refresh(); });
		}

		// 繝輔か繝ｼ繧ｫ繧ｹ繧､繝ｳ繝・ャ繧ｯ繧ｹ繧偵Μ繧ｻ繝・ヨ
		this.focusedIndex = -1;
	}

	/**
	 * 陦ｨ遉ｺ繝｢繝ｼ繝峨ｒ蛻・ｊ譖ｿ縺・
	 */
	async toggleViewMode(): Promise<void> {
		const currentMode = this.plugin.data.settings.viewMode;
		this.plugin.data.settings.viewMode = currentMode === 'list' ? 'grid' : 'list';
		await this.plugin.syncAndSave();
		// 蠑ｷ蛻ｶ逧・↓蜀肴緒逕ｻ縺吶ｋ縺溘ａ縺ｫ繧ｭ繝｣繝・す繝･繧偵け繝ｪ繧｢
		this.lastCardPaths = [];
		this.lastCardStateKeys = [];
		await this.render();
	}

	/**
	 * 繧ｯ繧､繝・け繝弱・繝井ｽ懈・繝懊ャ繧ｯ繧ｹ繧呈緒逕ｻ
	 */
	private renderComposeBox(): void {
		const composeBox = this.listContainerEl.createDiv({ cls: 'timeline-compose-box' });

		// 繧｢繝舌ち繝ｼ鬚ｨ縺ｮ繧｢繧､繧ｳ繝ｳ
		const avatarEl = composeBox.createDiv({ cls: 'timeline-compose-avatar' });
		avatarEl.textContent = '統';

		// 蜈･蜉帙お繝ｪ繧｢
		const inputArea = composeBox.createDiv({ cls: 'timeline-compose-input-area' });

		const textarea = inputArea.createEl('textarea', {
			cls: 'timeline-compose-textarea',
			attr: {
				placeholder: "What's on your mind?",
				rows: '1',
			},
		});

		// 繧｢繧ｯ繧ｷ繝ｧ繝ｳ繝舌・
		const actionsBar = inputArea.createDiv({ cls: 'timeline-compose-actions' });

		// 譁・ｭ玲焚繧ｫ繧ｦ繝ｳ繧ｿ繝ｼ
		const charCounter = actionsBar.createSpan({ cls: 'timeline-compose-char-counter' });
		charCounter.textContent = '0';

		textarea.addEventListener('input', () => {
			charCounter.textContent = String(textarea.value.length);
		});

		// 謚慕ｨｿ繝懊ち繝ｳ
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

				// 繧ｿ繧､繝繝ｩ繧､繝ｳ繧偵Μ繝輔Ξ繝・す繝･
				void this.refresh();
			}).catch((error: unknown) => {
				console.error('Failed to create quick note:', error);
				postBtn.textContent = 'Post';
				postBtn.disabled = false;
			});
		});

		// Ctrl+Enter 縺ｧ謚慕ｨｿ
		textarea.addEventListener('keydown', (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !postBtn.disabled) {
				e.preventDefault();
				postBtn.click();
			}
		});
	}

	/**
	 * 繧ｯ繧､繝・け繝弱・繝医ｒ菴懈・
	 */
	private async createQuickNote(content: string): Promise<void> {
		const settings = this.plugin.data.settings;
		const template = settings.quickNoteTemplate || DEFAULT_QUICK_NOTE_TEMPLATE;

		// UID逕滓・・医ち繧､繝繧ｹ繧ｿ繝ｳ繝励・繝ｼ繧ｹ・・
		const now = new Date();
		const uid = now.getTime().toString(36);

		// 譌･莉倥ヵ繧ｩ繝ｼ繝槭ャ繝・
		const dateParts = now.toISOString().split('T');
		const dateStr = dateParts[0] ?? '';

		// 繧ｿ繧､繝医Ν逕滓・・域怙蛻昴・陦後∪縺溘・譛蛻昴・50譁・ｭ暦ｼ・
		const lines = content.split('\n');
		const firstLine = lines[0] ?? '';
		const title = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;

		// 繝・Φ繝励Ξ繝ｼ繝医ｒ驕ｩ逕ｨ
		const noteContent = template
			.replace(/\{\{uid\}\}/g, uid)
			.replace(/\{\{title\}\}/g, title)
			.replace(/\{\{date\}\}/g, dateStr)
			.replace(/\{\{content\}\}/g, content);

		// 繝輔ぃ繧､繝ｫ蜷阪ｒ逕滓・・医ち繧､繝繧ｹ繧ｿ繝ｳ繝・+ 繧ｿ繧､繝医Ν縺ｮ荳驛ｨ・・
		const safeTitle = title
			.replace(/[\\/:*?"<>|#^[\]]/g, '')
			.replace(/\s+/g, '_')
			.substring(0, 30);
		const fileName = `${dateStr}_${uid}_${safeTitle}.md`;

		// 菫晏ｭ伜・繝輔か繝ｫ繝
		const folder = settings.quickNoteFolder.trim();
		const filePath = folder ? `${folder}/${fileName}` : fileName;

		// 繝輔か繝ｫ繝縺悟ｭ伜惠縺励↑縺・ｴ蜷医・菴懈・・医ロ繧ｹ繝医＆繧後◆繝輔か繝ｫ繝縺ｫ繧ょｯｾ蠢懶ｼ・
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
							throw new Error(`繝輔か繝ｫ繝縺ｮ菴懈・縺ｫ螟ｱ謨励＠縺ｾ縺励◆: ${currentPath}`);
						}
					}
				}
			}
		}

		// 繝弱・繝医ｒ菴懈・
		await this.app.vault.create(filePath, noteContent);
	}

	/**
	 * 繝輔ぅ繝ｫ繧ｿ繝舌・繧呈緒逕ｻ
	 */
	private renderFilterBar(): void {
		const filterBar = this.listContainerEl.createDiv({ cls: 'timeline-filter-bar' });

		// 讀懃ｴ｢繧ｻ繧ｯ繧ｷ繝ｧ繝ｳ
		const searchSection = filterBar.createDiv({ cls: 'timeline-filter-search' });
		const searchIcon = searchSection.createSpan({ cls: 'timeline-search-icon', text: '剥' });
		searchIcon.setAttribute('aria-hidden', 'true');
		const searchInput = searchSection.createEl('input', {
			cls: 'timeline-search-input',
			attr: {
				type: 'text',
				placeholder: 'Search...',
				value: this.searchQuery,
			},
		});
		searchInput.addEventListener('input', (e) => {
			const value = (e.target as HTMLInputElement).value;
			this.handleSearchInput(value);
		});

		// 日付範囲フィルタ
		const dateSection = filterBar.createDiv({ cls: 'timeline-filter-dates' });
		dateSection.createSpan({ cls: 'timeline-filter-dates-label', text: 'Date:' });
		const dateStartInput = dateSection.createEl('input', {
			cls: 'timeline-date-input',
			attr: {
				type: 'date',
				value: this.dateFilterStart,
				'aria-label': 'Filter start date',
			},
		});
		dateSection.createSpan({ text: '-' });
		const dateEndInput = dateSection.createEl('input', {
			cls: 'timeline-date-input',
			attr: {
				type: 'date',
				value: this.dateFilterEnd,
				'aria-label': 'Filter end date',
			},
		});
		dateStartInput.addEventListener('change', (e) => {
			this.dateFilterStart = (e.target as HTMLInputElement).value;
			void this.renderCardList();
		});
		dateEndInput.addEventListener('change', (e) => {
			this.dateFilterEnd = (e.target as HTMLInputElement).value;
			void this.renderCardList();
		});
		// クリアボタン
		if (this.dateFilterStart || this.dateFilterEnd) {
			const clearBtn = dateSection.createEl('button', {
				cls: 'timeline-date-clear-btn',
				text: '✕',
				attr: { 'aria-label': 'Clear date filter' },
			});
			clearBtn.addEventListener('click', () => {
				this.dateFilterStart = '';
				this.dateFilterEnd = '';
				void this.renderCardList();
			});
		}

		// 繝輔ぃ繧､繝ｫ繧ｿ繧､繝励ヵ繧｣繝ｫ繧ｿ
		const typeFilters = filterBar.createDiv({ cls: 'timeline-filter-types' });
		const fileTypes: { type: string; icon: string; label: string }[] = [
			{ type: 'markdown', icon: '統', label: 'Markdown' },
			{ type: 'text', icon: '塔', label: 'Text' },
			{ type: 'image', icon: 'IMG', label: 'Image' },
			{ type: 'pdf', icon: '塘', label: 'PDF' },
			{ type: 'audio', icon: '七', label: 'Audio' },
			{ type: 'video', icon: '汐', label: 'Video' },
			{ type: 'office', icon: '投', label: 'Office' },
			{ type: 'ipynb', icon: '涛', label: 'Jupyter' },
		];

		for (const ft of fileTypes) {
			const isActive = this.fileTypeFilters.has(ft.type);
			const btn = typeFilters.createEl('button', {
				cls: `timeline-filter-type-btn ${isActive ? 'is-active' : ''}`,
				attr: { 'aria-label': ft.label, 'data-type': ft.type },
			});
			btn.textContent = ft.label;
			btn.addEventListener('click', () => this.toggleFileTypeFilter(ft.type));
		}

		// 繧ｿ繧ｰ繝輔ぅ繝ｫ繧ｿ
		const allTags = this.cachedAllTags;
		if (allTags.length > 0) {
			const tagSection = filterBar.createDiv({ cls: 'timeline-filter-tags' });
			tagSection.createSpan({ cls: 'timeline-filter-tags-label', text: 'Tags:' });
			const toggleBtn = tagSection.createEl('button', {
				cls: 'timeline-filter-tags-toggle',
				text: this.isTagsCollapsed ? 'Show' : 'Hide',
				attr: {
					'aria-label': this.isTagsCollapsed ? 'Show tags' : 'Hide tags',
					'aria-pressed': String(this.isTagsCollapsed),
				},
			});
			const updateToggleState = () => {
				tagSection.toggleClass('is-collapsed', this.isTagsCollapsed);
				toggleBtn.textContent = this.isTagsCollapsed ? 'Show' : 'Hide';
				toggleBtn.setAttribute('aria-label', this.isTagsCollapsed ? 'Show tags' : 'Hide tags');
				toggleBtn.setAttribute('aria-pressed', String(this.isTagsCollapsed));
			};
			updateToggleState();
			toggleBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.isTagsCollapsed = !this.isTagsCollapsed;
				updateToggleState();
			});
			const tagChips = tagSection.createDiv({ cls: 'timeline-filter-tag-chips' });

			for (const tag of allTags.slice(0, 10)) {
				const isSelected = this.selectedTags.has(tag);
				const chip = tagChips.createEl('button', {
					cls: `timeline-filter-tag-chip ${isSelected ? 'is-selected' : ''}`,
					text: tag,
				});
				chip.addEventListener('click', () => this.toggleTagFilter(tag));
			}

			if (allTags.length > 10) {
				tagChips.createSpan({
					cls: 'timeline-filter-tag-more',
					text: `+${allTags.length - 10}`,
				});
			}
		}

		// フィルタープリセットセクション
		this.renderFilterPresets(filterBar);
	}

	/**
	 * フィルタープリセットを描画
	 */
	private renderFilterPresets(container: HTMLElement): void {
		const presetSection = container.createDiv({ cls: 'timeline-filter-presets' });

		// 保存ボタン
		const saveBtn = presetSection.createEl('button', {
			cls: 'timeline-preset-save-btn',
			text: '+ save',
			attr: { 'aria-label': 'Save current filter as preset' },
		});
		saveBtn.addEventListener('click', () => {
			void this.saveCurrentFilterAsPreset();
		});

		// 既存のプリセット
		const presets = this.plugin.getFilterPresets();
		for (const preset of presets) {
			const presetChip = presetSection.createDiv({ cls: 'timeline-preset-chip' });
			const presetName = presetChip.createSpan({
				cls: 'timeline-preset-name',
				text: preset.name,
			});
			presetName.addEventListener('click', () => {
				this.loadFilterPreset(preset);
			});
			const deleteBtn = presetChip.createEl('button', {
				cls: 'timeline-preset-delete-btn',
				text: '×',
				attr: { 'aria-label': `Delete preset "${preset.name}"` },
			});
			deleteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.plugin.deleteFilterPreset(preset.id);
				void this.render();
			});
		}
	}

	/**
	 * 現在のフィルタをプリセットとして保存
	 */
	private async saveCurrentFilterAsPreset(): Promise<void> {
		const modal = new TextInputModal(this.app, 'Save filter preset', 'Enter preset name');
		modal.open();
		const name = await modal.waitForResult();
		if (!name?.trim()) return;

		const preset: FilterPreset = {
			id: `preset-${Date.now()}`,
			name: name.trim(),
			searchQuery: this.searchQuery,
			fileTypeFilters: Array.from(this.fileTypeFilters),
			selectedTags: Array.from(this.selectedTags),
			dateFilterStart: this.dateFilterStart,
			dateFilterEnd: this.dateFilterEnd,
		};

		await this.plugin.saveFilterPreset(preset);
		await this.render();
	}

	/**
	 * プリセットを読み込み
	 */
	private loadFilterPreset(preset: FilterPreset): void {
		this.searchQuery = preset.searchQuery;
		this.fileTypeFilters = new Set(preset.fileTypeFilters);
		this.selectedTags = new Set(preset.selectedTags);
		this.dateFilterStart = preset.dateFilterStart;
		this.dateFilterEnd = preset.dateFilterEnd;
		void this.render();
	}

	/**
	 * 蜈ｨ繧ｫ繝ｼ繝峨°繧峨Θ繝九・繧ｯ縺ｪ繧ｿ繧ｰ繧貞庶髮・
	 */
	private collectAllTags(): string[] {
		const tagCounts = new Map<string, number>();

		for (const card of this.cards) {
			for (const tag of card.tags) {
				tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
			}
		}

		// 蜃ｺ迴ｾ蝗樊焚縺ｧ繧ｽ繝ｼ繝医＠縺ｦ霑斐☆
		return Array.from(tagCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([tag]) => tag);
	}

	/**
	 * 讀懃ｴ｢蜈･蜉帙ワ繝ｳ繝峨Λ繝ｼ・医ョ繝舌え繝ｳ繧ｹ莉倥″・・
	 */
	private handleSearchInput(query: string): void {
		if (!this.listContainerEl) {
			return;
		}
		if (this.searchDebounceTimer !== null) {
			window.clearTimeout(this.searchDebounceTimer);
		}

		this.searchDebounceTimer = window.setTimeout(() => {
			if (!this.listContainerEl) {
				return;
			}
			this.searchQuery = query;
			void this.renderCardList();
		}, 300);
	}

	/**
	 * 繝輔ぃ繧､繝ｫ繧ｿ繧､繝励ヵ繧｣繝ｫ繧ｿ繧偵ヨ繧ｰ繝ｫ
	 */
	private toggleFileTypeFilter(type: string): void {
		if (this.fileTypeFilters.has(type)) {
			// 譛菴・縺､縺ｯ谿九☆
			if (this.fileTypeFilters.size > 1) {
				this.fileTypeFilters.delete(type);
			}
		} else {
			this.fileTypeFilters.add(type);
		}
		void this.renderCardList();
	}

	/**
	 * 繧ｿ繧ｰ繝輔ぅ繝ｫ繧ｿ繧偵ヨ繧ｰ繝ｫ
	 */
	private toggleTagFilter(tag: string): void {
		if (this.selectedTags.has(tag)) {
			this.selectedTags.delete(tag);
		} else {
			this.selectedTags.add(tag);
		}
		void this.renderCardList();
	}

	/**
	 * 繝輔ぅ繝ｫ繧ｿ繧帝←逕ｨ
	 */
	private applyFilters(): void {
		this.filteredCards = this.cards.filter(card => {
			// 繝輔ぃ繧､繝ｫ繧ｿ繧､繝励ヵ繧｣繝ｫ繧ｿ
			if (!this.fileTypeFilters.has(card.fileType)) {
				return false;
			}

			// 繧ｿ繧ｰ繝輔ぅ繝ｫ繧ｿ・磯∈謚槭ち繧ｰ縺後≠繧句ｴ蜷医√＞縺壹ｌ縺九ｒ蜷ｫ繧・・
			if (this.selectedTags.size > 0) {
				const hasMatchingTag = card.tags.some(tag => this.selectedTags.has(tag));
				if (!hasMatchingTag) {
					return false;
				}
			}

			// 讀懃ｴ｢繧ｯ繧ｨ繝ｪ繝輔ぅ繝ｫ繧ｿ
			if (this.searchQuery.trim()) {
				const query = this.searchQuery.toLowerCase();
				const titleMatch = card.title.toLowerCase().includes(query);
				const previewMatch = card.preview.toLowerCase().includes(query);
				const tagMatch = card.tags.some(tag => tag.toLowerCase().includes(query));
				if (!titleMatch && !previewMatch && !tagMatch) {
					return false;
				}
			}

			// 日付範囲フィルタ
			if (this.dateFilterStart || this.dateFilterEnd) {
				const cardDate = card.createdAt;
				if (cardDate === null) {
					return false;  // 日付不明のカードは除外
				}
				if (this.dateFilterStart) {
					const startTimestamp = new Date(this.dateFilterStart).getTime();
					if (cardDate < startTimestamp) {
						return false;
					}
				}
				if (this.dateFilterEnd) {
					// 終了日は23:59:59まで含める
					const endTimestamp = new Date(this.dateFilterEnd).getTime() + 24 * 60 * 60 * 1000 - 1;
					if (cardDate > endTimestamp) {
						return false;
					}
				}
			}

			return true;
		});
	}

	/**
	 * 繧ｫ繝ｼ繝峨Μ繧ｹ繝医・縺ｿ繧貞・謠冗判・医ヵ繧｣繝ｫ繧ｿ螟画峩譎ゑｼ・
	 */
	private async renderCardList(): Promise<void> {
		if (!this.listContainerEl) {
			return;
		}
		// 繝輔ぅ繝ｫ繧ｿ繧帝←逕ｨ
		this.applyFilters();

		// 繧ｫ繝ｼ繝画焚陦ｨ遉ｺ繧呈峩譁ｰ
		const countEl = this.listContainerEl.querySelector('.timeline-count');
		if (countEl) {
			const countText = this.filteredCards.length === this.cards.length
				? `${this.cards.length} notes`
				: `${this.filteredCards.length} / ${this.cards.length} notes`;
			countEl.textContent = countText;
		}

		// 繝輔ぅ繝ｫ繧ｿ繝舌・縺ｮUI迥ｶ諷九ｒ譖ｴ譁ｰ
		this.updateFilterBarUI();

		// 繧ｫ繝ｼ繝峨Μ繧ｹ繝・繧ｰ繝ｪ繝・ラ繧貞・謠冗判
		const settings = this.plugin.data.settings;
		const isGridMode = settings.viewMode === 'grid';
		this.listEl = this.listContainerEl.querySelector('.timeline-list, .timeline-grid') as HTMLElement;
		if (!this.listEl) return;

		this.listEl.empty();
		this.cardElements = [];

		// 辟｡髯舌せ繧ｯ繝ｭ繝ｼ繝ｫ蟇ｾ蠢懶ｼ壼・譛溯｡ｨ遉ｺ謨ｰ繧呈ｱｺ螳・
		const enableInfiniteScroll = settings.enableInfiniteScroll;
		const batchSize = settings.infiniteScrollBatchSize || 20;
		const initialCount = enableInfiniteScroll ? batchSize : this.filteredCards.length;
		this.displayedCount = Math.min(initialCount, this.filteredCards.length);

		const { fragment: listFragment, elements: listElements } = await this.renderCardsToFragment(
			this.filteredCards.slice(0, this.displayedCount), isGridMode
		);
		this.cardElements = listElements;
		this.listEl.appendChild(listFragment);

		this.focusedIndex = -1;

		// 繝輔ャ繧ｿ繝ｼ繧呈峩譁ｰ
		this.updateFooter();
	}

	/**
	 * 繝輔ぅ繝ｫ繧ｿ繝舌・縺ｮUI迥ｶ諷九ｒ譖ｴ譁ｰ
	 */
	private updateFilterBarUI(): void {
		// 繝輔ぃ繧､繝ｫ繧ｿ繧､繝励・繧ｿ繝ｳ縺ｮ迥ｶ諷区峩譁ｰ
		const typeButtons = this.listContainerEl.querySelectorAll('.timeline-filter-type-btn');
		typeButtons.forEach(btn => {
			const type = btn.getAttribute('data-type');
			if (type) {
				btn.classList.toggle('is-active', this.fileTypeFilters.has(type));
			}
		});

		// 繧ｿ繧ｰ繝√ャ繝励・迥ｶ諷区峩譁ｰ
		const tagChips = this.listContainerEl.querySelectorAll('.timeline-filter-tag-chip');
		tagChips.forEach(chip => {
			const tag = chip.textContent || '';
			chip.classList.toggle('is-selected', this.selectedTags.has(tag));
		});
	}

	/**
	 * 繧ｫ繝ｼ繝芽ｦ∫ｴ繧剃ｽ懈・
	 */
	private async createCardElement(card: TimelineCard): Promise<HTMLElement> {
		const cardEl = createDiv({ cls: ['timeline-card', `timeline-card-type-${card.fileType}`] });
		if (card.pinned) {
			cardEl.addClass('timeline-card-pinned');
		}
		if (card.isNew) {
			cardEl.addClass('timeline-card-new');
		}
		if (card.isDue) {
			cardEl.addClass('timeline-card-due');
		}

		// 繝｡繧､繝ｳ繧ｳ繝ｳ繝・Φ繝・伜沺
		const contentEl = cardEl.createDiv({ cls: 'timeline-card-content' });

		// Twitter鬚ｨ繝倥ャ繝繝ｼ・医ヵ繧ｩ繝ｫ繝 + 繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝暦ｼ・
		const headerEl = contentEl.createDiv({ cls: 'timeline-card-header' });
		const folderPath = card.path.includes('/') ? card.path.substring(0, card.path.lastIndexOf('/')) : '';
		headerEl.createSpan({ cls: 'timeline-card-header-folder', text: `刀 ${folderPath || 'Root'}` });
		headerEl.createSpan({ cls: 'timeline-card-header-separator', text: ' ﾂｷ ' });
		if (card.lastReviewedAt) {
			const date = new Date(card.lastReviewedAt);
			headerEl.createSpan({ cls: 'timeline-card-header-time', text: this.formatRelativeDate(date) });
		} else {
			headerEl.createSpan({ cls: 'timeline-card-header-time', text: 'New' });
		}
		// 繝倥ャ繝繝ｼ逕ｨ繧｢繧ｯ繧ｷ繝ｧ繝ｳ繝懊ち繝ｳ・・witter繝｢繝ｼ繝峨〒陦ｨ遉ｺ・・
		{
			const hasDraft = this.plugin.hasCommentDraft(card.path);
			const headerCommentBtn = headerEl.createEl('button', {
				cls: `timeline-card-header-action timeline-card-header-comment ${hasDraft ? 'has-draft' : ''}`,
				attr: { 'aria-label': '繧ｳ繝｡繝ｳ繝医ｒ霑ｽ蜉' },
			});
			headerCommentBtn.textContent = '町';
			headerCommentBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					const modal = new CommentModal(this.app, this.plugin, file);
					modal.open();
				}
			});

			const hasQuoteNoteDraft = this.plugin.hasQuoteNoteDraft(card.path);
			const headerQuoteBtn = headerEl.createEl('button', {
				cls: `timeline-card-header-action timeline-card-header-quote ${hasQuoteNoteDraft ? 'has-draft' : ''}`,
				attr: { 'aria-label': 'Quote note' },
			});
			headerQuoteBtn.textContent = '売';
			headerQuoteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					const modal = new QuoteNoteModal(this.app, this.plugin, file);
					modal.open();
				}
			});
		}

		// 繝ｪ繝ｳ繧ｯ繝懊ち繝ｳ - Twitter 繝倥ャ繝繝ｼ逕ｨ
		{
			const headerLinkBtn = headerEl.createEl('button', {
				cls: 'timeline-card-header-action timeline-card-header-link',
				attr: { 'aria-label': '繝弱・繝医ｒ繝ｪ繝ｳ繧ｯ' },
			});
			headerLinkBtn.textContent = '\uD83D\uDD17';
			headerLinkBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					new LinkNoteModal(this.app, file).open();
				}
			});
		}
		// 繝悶ャ繧ｯ繝槭・繧ｯ繧｢繧､繧ｳ繝ｳ・医・繝・ム繝ｼ逕ｨ・・
		const isBookmarked = this.isFileBookmarked(card.path);
		const headerBookmarkBtn = headerEl.createEl('button', {
			cls: `timeline-card-header-bookmark ${isBookmarked ? 'is-bookmarked' : ''}`,
		});
		headerBookmarkBtn.textContent = isBookmarked ? '★' : '☆';
		headerBookmarkBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.toggleBookmark(card.path).then(nowBookmarked => {
				headerBookmarkBtn.textContent = nowBookmarked ? '★' : '☆';
				headerBookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
				// 蜷梧悄・壹ち繧､繝医Ν陦後・繝悶ャ繧ｯ繝槭・繧ｯ繝懊ち繝ｳ繧よ峩譁ｰ
				const titleBookmarkBtn = cardEl.querySelector('.timeline-bookmark-btn') as HTMLElement;
				if (titleBookmarkBtn) {
					titleBookmarkBtn.textContent = nowBookmarked ? '★' : '☆';
					titleBookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
				}
			});
		});

		// 繧ｿ繧､繝医Ν陦・
		const titleRow = contentEl.createDiv({ cls: 'timeline-card-title-row' });

		// 繝輔ぃ繧､繝ｫ繧ｿ繧､繝励ヰ繝・ず・磯撼繝槭・繧ｯ繝繧ｦ繝ｳ縺ｮ蝣ｴ蜷茨ｼ・
		if (card.fileType !== 'markdown') {
			const typeIcon = this.getFileTypeIcon(card.fileType);
			titleRow.createSpan({
				cls: `timeline-badge timeline-badge-filetype timeline-badge-${card.fileType}`,
				text: typeIcon,
			});
		}

		const titleEl = titleRow.createDiv({ cls: 'timeline-card-title' });
		titleEl.textContent = card.title;

		// 繝舌ャ繧ｸ
		if (card.pinned) {
			titleRow.createSpan({ cls: 'timeline-badge timeline-badge-pin', text: '東' });
		}
		if (card.isNew) {
			titleRow.createSpan({ cls: 'timeline-badge timeline-badge-new', text: 'NEW' });
		}
		if (card.isDue) {
			titleRow.createSpan({ cls: 'timeline-badge timeline-badge-due', text: 'DUE' });
		}

		// 繧ｳ繝｡繝ｳ繝医・繧ｿ繝ｳ - Classic逕ｨ
		{
			const hasDraft = this.plugin.hasCommentDraft(card.path);
			const commentBtn = titleRow.createEl('button', {
				cls: `timeline-comment-btn ${hasDraft ? 'has-draft' : ''}`,
				attr: { 'aria-label': '繧ｳ繝｡繝ｳ繝医ｒ霑ｽ蜉' },
			});
			commentBtn.textContent = '町';
			commentBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					const modal = new CommentModal(this.app, this.plugin, file);
					modal.open();
				}
			});
		}

		// 蠑慕畑繝弱・繝医・繧ｿ繝ｳ - Classic逕ｨ
		{
			const hasQuoteNoteDraft = this.plugin.hasQuoteNoteDraft(card.path);
			const quoteNoteBtn = titleRow.createEl('button', {
				cls: `timeline-quote-note-btn ${hasQuoteNoteDraft ? 'has-draft' : ''}`,
				attr: { 'aria-label': 'Quote note' },
			});
			quoteNoteBtn.textContent = '売';
			quoteNoteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					const modal = new QuoteNoteModal(this.app, this.plugin, file);
					modal.open();
				}
			});
		}

		// 繝ｪ繝ｳ繧ｯ繝懊ち繝ｳ - Classic逕ｨ
		{
			const linkBtn = titleRow.createEl('button', {
				cls: 'timeline-link-note-btn',
				attr: { 'aria-label': '繝弱・繝医ｒ繝ｪ繝ｳ繧ｯ' },
			});
			linkBtn.textContent = '\uD83D\uDD17';
			linkBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					new LinkNoteModal(this.app, file).open();
				}
			});
		}

		// 繝悶ャ繧ｯ繝槭・繧ｯ繝懊ち繝ｳ - Classic逕ｨ
		const bookmarkBtn = titleRow.createEl('button', {
			cls: `timeline-bookmark-btn ${isBookmarked ? 'is-bookmarked' : ''}`,
			attr: { 'aria-label': isBookmarked ? 'Remove bookmark' : 'Add bookmark' },
		});
		bookmarkBtn.textContent = isBookmarked ? '★' : '☆';
		bookmarkBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.toggleBookmark(card.path).then(nowBookmarked => {
				bookmarkBtn.textContent = nowBookmarked ? '★' : '☆';
				bookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
				bookmarkBtn.setAttribute('aria-label', nowBookmarked ? 'Remove bookmark' : 'Add bookmark');
				// 蜷梧悄・壹・繝・ム繝ｼ縺ｮ繝悶ャ繧ｯ繝槭・繧ｯ繝懊ち繝ｳ繧よ峩譁ｰ
				headerBookmarkBtn.textContent = nowBookmarked ? '★' : '☆';
				headerBookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
			});
		});

		// 繝励Ξ繝薙Η繝ｼ
		const previewEl = contentEl.createDiv({ cls: 'timeline-card-preview' });
		if (card.fileType === 'markdown' || card.fileType === 'ipynb') {
			// 閼壽ｳｨ險俶ｳ輔ｒ繧ｨ繧ｹ繧ｱ繝ｼ繝暦ｼ医・繝ｬ繝薙Η繝ｼ縺ｧ縺ｯ蜿ら・蜈医′縺ｪ縺・◆繧・ｼ・
			const previewText = card.preview.replace(/\[\^/g, '\\[^');
			// 繝槭・繧ｯ繝繧ｦ繝ｳ繧偵Ξ繝ｳ繝繝ｪ繝ｳ繧ｰ
			await MarkdownRenderer.render(
				this.app,
				previewText,
				previewEl,
				card.path,
				this.renderComponent
			);
			// ipynb縺ｮ蝣ｴ蜷医・繧ｯ繝ｩ繧ｹ繧定ｿｽ蜉
			if (card.fileType === 'ipynb') {
				previewEl.addClass('timeline-card-preview-ipynb');
			}
		} else {
			// 髱槭・繝ｼ繧ｯ繝繧ｦ繝ｳ縺ｯ繝励Ξ繝ｼ繝ｳ繝・く繧ｹ繝郁｡ｨ遉ｺ
			previewEl.addClass('timeline-card-preview-file');
			previewEl.createSpan({
				cls: 'timeline-file-preview-text',
				text: card.preview,
			});
			// 諡｡蠑ｵ蟄舌ヰ繝・ず
			previewEl.createSpan({
				cls: 'timeline-file-extension',
				text: `.${card.extension}`,
			});
		}

		// 繧ｵ繝繝阪う繝ｫ逕ｻ蜒・/ PDF蝓九ａ霎ｼ縺ｿ
		if (card.firstImagePath) {
			if (card.fileType === 'pdf') {
				const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-pdf-embed' });
				await this.renderPdfCardPreview(thumbnailEl, card, false);
			} else if (card.firstImagePath.startsWith('data:')) {
				// Base64 data URI・・pynb縺ｮ蜃ｺ蜉帷判蜒上↑縺ｩ・・
				const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-thumbnail-ipynb' });
				thumbnailEl.createEl('img', {
					attr: { src: card.firstImagePath, alt: 'notebook output' },
				});
			} else {
				// 逕ｻ蜒上し繝繝阪う繝ｫ
				const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail' });
				if (card.firstImagePath.startsWith('http://') || card.firstImagePath.startsWith('https://')) {
					// 螟夜ΚURL
					thumbnailEl.createEl('img', {
						attr: { src: card.firstImagePath, alt: 'thumbnail' },
					});
				} else {
					// 蜀・Κ繝輔ぃ繧､繝ｫ
					const imageFile = this.app.vault.getAbstractFileByPath(card.firstImagePath);
					if (imageFile && imageFile instanceof TFile) {
						const resourcePath = this.app.vault.getResourcePath(imageFile);
						thumbnailEl.createEl('img', {
							attr: { src: resourcePath, alt: 'thumbnail' },
						});
					}
				}
			}
		}

		// 繝ｪ繝ｳ繧ｯ繝ｪ繧ｹ繝・
		if (card.outgoingLinks.length > 0 || card.backlinks.length > 0) {
			const linksEl = contentEl.createDiv({ cls: 'timeline-card-links' });

			// 繧｢繧ｦ繝医ざ繝ｼ繧､繝ｳ繧ｰ繝ｪ繝ｳ繧ｯ
			if (card.outgoingLinks.length > 0) {
				const outgoingEl = linksEl.createDiv({ cls: 'timeline-links-section' });
				outgoingEl.createSpan({ cls: 'timeline-links-label', text: '竊・Links' });
				const outgoingList = outgoingEl.createDiv({ cls: 'timeline-links-list' });
				for (const link of card.outgoingLinks.slice(0, 5)) {
					const linkEl = outgoingList.createSpan({
						cls: 'timeline-link-item',
						text: link.title,
					});
					linkEl.addEventListener('click', (e) => {
						e.stopPropagation();
						const file = this.app.vault.getAbstractFileByPath(link.path);
						if (file && file instanceof TFile) {
							void this.app.workspace.getLeaf().openFile(file);
						}
					});
				}
				if (card.outgoingLinks.length > 5) {
					outgoingList.createSpan({
						cls: 'timeline-link-more',
						text: `+${card.outgoingLinks.length - 5}`,
					});
				}
			}

			// 繝舌ャ繧ｯ繝ｪ繝ｳ繧ｯ
			if (card.backlinks.length > 0) {
				const backlinksEl = linksEl.createDiv({ cls: 'timeline-links-section' });
				backlinksEl.createSpan({ cls: 'timeline-links-label', text: '竊・Backlinks' });
				const backlinksList = backlinksEl.createDiv({ cls: 'timeline-links-list' });
				for (const link of card.backlinks.slice(0, 5)) {
					const linkEl = backlinksList.createSpan({
						cls: 'timeline-link-item',
						text: link.title,
					});
					linkEl.addEventListener('click', (e) => {
						e.stopPropagation();
						const file = this.app.vault.getAbstractFileByPath(link.path);
						if (file && file instanceof TFile) {
							void this.app.workspace.getLeaf().openFile(file);
						}
					});
				}
				if (card.backlinks.length > 5) {
					backlinksList.createSpan({
						cls: 'timeline-link-more',
						text: `+${card.backlinks.length - 5}`,
					});
				}
			}
		}

		// 繝｡繧ｿ諠・ｱ・・lassic逕ｨ・・
		if (this.plugin.data.settings.showMeta) {
			const metaEl = contentEl.createDiv({ cls: 'timeline-card-meta' });

			if (card.lastReviewedAt) {
				const date = new Date(card.lastReviewedAt);
				const dateStr = this.formatRelativeDate(date);
				metaEl.createSpan({ text: `早 ${dateStr}` });
			}

			if (card.reviewCount > 0) {
				metaEl.createSpan({ text: `ﾃ・{card.reviewCount}` });
			}

			if (card.interval > 0) {
				metaEl.createSpan({ cls: 'timeline-card-interval', text: `套 ${card.interval}d` });
			}

			if (card.tags.length > 0) {
				const tagsStr = card.tags.slice(0, 3).join(' ');
				metaEl.createSpan({ cls: 'timeline-card-tags', text: tagsStr });
			}
		}

		// Twitter鬚ｨ繧｢繧ｯ繧ｷ繝ｧ繝ｳ繝舌・
		const actionsEl = contentEl.createDiv({ cls: 'timeline-card-actions' });

		// 繧ｳ繝｡繝ｳ繝医い繧ｯ繧ｷ繝ｧ繝ｳ
		{
			const hasDraft = this.plugin.hasCommentDraft(card.path);
			const commentAction = actionsEl.createEl('button', {
				cls: `timeline-action-btn timeline-action-comment ${hasDraft ? 'has-draft' : ''}`,
			});
			commentAction.createSpan({ text: '町' });
			commentAction.createSpan({ cls: 'timeline-action-label', text: 'Comment' });
			commentAction.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					const modal = new CommentModal(this.app, this.plugin, file);
					modal.open();
				}
			});
		}

		// 蠑慕畑繧｢繧ｯ繧ｷ繝ｧ繝ｳ
		{
			const hasQuoteNoteDraft = this.plugin.hasQuoteNoteDraft(card.path);
			const quoteAction = actionsEl.createEl('button', {
				cls: `timeline-action-btn timeline-action-quote ${hasQuoteNoteDraft ? 'has-draft' : ''}`,
			});
			quoteAction.createSpan({ text: '売' });
			quoteAction.createSpan({ cls: 'timeline-action-label', text: 'Quote' });
			quoteAction.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					const modal = new QuoteNoteModal(this.app, this.plugin, file);
					modal.open();
				}
			});
		}

		// 繝ｪ繝ｳ繧ｯ繧｢繧ｯ繧ｷ繝ｧ繝ｳ
		{
			const linkAction = actionsEl.createEl('button', {
				cls: 'timeline-action-btn timeline-action-link',
			});
			linkAction.createSpan({ text: '\uD83D\uDD17' });
			linkAction.createSpan({ cls: 'timeline-action-label', text: 'Link' });
			linkAction.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					new LinkNoteModal(this.app, file).open();
				}
			});
		}

		// 繝ｬ繝薙Η繝ｼ謨ｰ繧｢繧ｯ繧ｷ繝ｧ繝ｳ
		if (card.reviewCount > 0) {
			const reviewAction = actionsEl.createDiv({ cls: 'timeline-action-btn timeline-action-reviews' });
			reviewAction.createSpan({ text: '★' });
			reviewAction.createSpan({ cls: 'timeline-action-label', text: `${card.reviewCount} reviews` });
		}

		// 繧ｿ繧ｰ陦ｨ遉ｺ・・witter鬚ｨ・・
		if (card.tags.length > 0) {
			const tagsAction = actionsEl.createDiv({ cls: 'timeline-action-tags' });
			for (const tag of card.tags.slice(0, 2)) {
				tagsAction.createSpan({ cls: 'timeline-action-tag', text: tag });
			}
			if (card.tags.length > 2) {
				tagsAction.createSpan({ cls: 'timeline-action-tag-more', text: `+${card.tags.length - 2}` });
			}
		}

		// 繧ｯ繝ｪ繝・け/繧ｿ繝・・縺ｧ繝弱・繝医ｒ髢九￥
		contentEl.addEventListener('click', () => {
			void this.openNote(card);
		});

		// 蜿ｳ繧ｯ繝ｪ繝・け縺ｧ繧ｳ繝ｳ繝・く繧ｹ繝医Γ繝九Η繝ｼ
		cardEl.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const file = this.app.vault.getAbstractFileByPath(card.path);
			if (file && file instanceof TFile) {
				const menu = new Menu();

				// Obsidian縺ｮ讓呎ｺ悶ヵ繧｡繧､繝ｫ繝｡繝九Η繝ｼ繧偵ヨ繝ｪ繧ｬ繝ｼ
				this.app.workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu', null);

				menu.showAtMouseEvent(e);
			}
		});

		// 髮｣譏灘ｺｦ繝懊ち繝ｳ・・RS繝｢繝ｼ繝峨∪縺溘・險ｭ螳壹〒譛牙柑譎ゑｼ・
		const settings = this.plugin.data.settings;
		if (settings.showDifficultyButtons) {
			const buttonsEl = cardEl.createDiv({ cls: 'timeline-difficulty-buttons' });
			this.createDifficultyButtons(buttonsEl, card);
		} else {
			// 譌｢隱ｭ繧ｷ繝ｧ繝ｼ繝医き繝・ヨ・亥承遶ｯ繧偵ち繝・・・・
			const markReadBtn = cardEl.createDiv({ cls: 'timeline-mark-read' });
			markReadBtn.textContent = 'Read';
			markReadBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.plugin.markAsReviewed(card.path).then(() => {
					cardEl.addClass('timeline-card-reviewed');
				});
			});
		}

		return cardEl;
	}

	/**
	 * 繧ｰ繝ｪ繝・ラ繧ｫ繝ｼ繝芽ｦ∫ｴ繧剃ｽ懈・・育判蜒丈ｸｭ蠢・・陦ｨ遉ｺ・・
	 */
	private async createGridCardElement(card: TimelineCard): Promise<HTMLElement> {
		const cardEl = createDiv({ cls: ['timeline-grid-card', `timeline-card-type-${card.fileType}`] });
		if (card.pinned) {
			cardEl.addClass('timeline-card-pinned');
		}
		if (card.isNew) {
			cardEl.addClass('timeline-card-new');
		}
		if (card.isDue) {
			cardEl.addClass('timeline-card-due');
		}

		// 繧ｵ繝繝阪う繝ｫ/繝励Ξ繝薙Η繝ｼ鬆伜沺
		const thumbnailEl = cardEl.createDiv({ cls: 'timeline-grid-card-thumbnail' });
		if (card.firstImagePath) {
			if (card.fileType === 'pdf') {
				thumbnailEl.addClass('timeline-grid-card-pdf-embed');
				await this.renderPdfCardPreview(thumbnailEl, card, true);
			} else if (card.firstImagePath.startsWith('data:')) {
				// Base64 data URI・・pynb縺ｮ蜃ｺ蜉帷判蜒上↑縺ｩ・・
				thumbnailEl.addClass('timeline-grid-card-thumbnail-ipynb');
				thumbnailEl.createEl('img', {
					attr: { src: card.firstImagePath, alt: 'notebook output' },
				});
			} else if (card.firstImagePath.startsWith('http://') || card.firstImagePath.startsWith('https://')) {
				thumbnailEl.createEl('img', {
					attr: { src: card.firstImagePath, alt: card.title },
				});
			} else {
				const imageFile = this.app.vault.getAbstractFileByPath(card.firstImagePath);
				if (imageFile && imageFile instanceof TFile) {
					const resourcePath = this.app.vault.getResourcePath(imageFile);
					thumbnailEl.createEl('img', {
						attr: { src: resourcePath, alt: card.title },
					});
				}
			}
		} else {
			// 逕ｻ蜒上′縺ｪ縺・ｴ蜷医・繝輔ぃ繧､繝ｫ繧ｿ繧､繝励い繧､繧ｳ繝ｳ繧定｡ｨ遉ｺ
			const icon = this.getFileTypeIcon(card.fileType);
			thumbnailEl.createDiv({
				cls: 'timeline-grid-card-icon',
				text: icon,
			});
		}

		// 繝輔ぃ繧､繝ｫ繧ｿ繧､繝励ヰ繝・ず
		if (card.fileType !== 'markdown') {
			const typeIcon = this.getFileTypeIcon(card.fileType);
			thumbnailEl.createSpan({
				cls: `timeline-grid-badge timeline-badge-${card.fileType}`,
				text: typeIcon,
			});
		}

		// 繧ｪ繝ｼ繝舌・繝ｬ繧､・医・繝舌・譎ゅ↓陦ｨ遉ｺ・・
		const overlayEl = thumbnailEl.createDiv({ cls: 'timeline-grid-card-overlay' });

		// 繝悶ャ繧ｯ繝槭・繧ｯ繝懊ち繝ｳ
		const isBookmarked = this.isFileBookmarked(card.path);
		const bookmarkBtn = overlayEl.createEl('button', {
			cls: `timeline-grid-bookmark-btn ${isBookmarked ? 'is-bookmarked' : ''}`,
		});
		bookmarkBtn.textContent = isBookmarked ? '★' : '☆';
		bookmarkBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.toggleBookmark(card.path).then(nowBookmarked => {
				bookmarkBtn.textContent = nowBookmarked ? '★' : '☆';
				bookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
			});
		});

		// 繧ｿ繧､繝医Ν
		const infoEl = cardEl.createDiv({ cls: 'timeline-grid-card-info' });
		const titleEl = infoEl.createDiv({ cls: 'timeline-grid-card-title' });
		titleEl.textContent = card.title;

		// 繝舌ャ繧ｸ
		if (card.pinned) {
			titleEl.createSpan({ cls: 'timeline-badge timeline-badge-pin', text: '東' });
		}
		if (card.isNew) {
			titleEl.createSpan({ cls: 'timeline-badge timeline-badge-new', text: 'NEW' });
		}
		if (card.isDue) {
			titleEl.createSpan({ cls: 'timeline-badge timeline-badge-due', text: 'DUE' });
		}

		// 繧ｿ繧ｰ・域怙螟ｧ2縺､縺ｾ縺ｧ陦ｨ遉ｺ・・
		if (card.tags.length > 0) {
			const tagsEl = infoEl.createDiv({ cls: 'timeline-grid-card-tags' });
			for (const tag of card.tags.slice(0, 2)) {
				tagsEl.createSpan({ cls: 'timeline-grid-card-tag', text: tag });
			}
			if (card.tags.length > 2) {
				tagsEl.createSpan({ cls: 'timeline-grid-card-tag-more', text: `+${card.tags.length - 2}` });
			}
		}

		// 繧ｯ繝ｪ繝・け縺ｧ繝弱・繝医ｒ髢九￥
		cardEl.addEventListener('click', () => {
			void this.openNote(card);
		});

		// 蜿ｳ繧ｯ繝ｪ繝・け縺ｧ繧ｳ繝ｳ繝・く繧ｹ繝医Γ繝九Η繝ｼ
		cardEl.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const file = this.app.vault.getAbstractFileByPath(card.path);
			if (file && file instanceof TFile) {
				const menu = new Menu();
				this.app.workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu', null);
				menu.showAtMouseEvent(e);
			}
		});

		return cardEl;
	}

	/**
	 * PDF繧ｪ繝ｼ繝励Φ繝懊ち繝ｳ繧剃ｽ懈・
	 */
	private createPdfOpenButton(container: HTMLElement, card: TimelineCard): void {
		const openBtn = container.createEl('button', {
			cls: 'timeline-pdf-open-btn',
			text: '📄 open',
		});
		openBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.openNote(card);
		});
	}

	/**
	 * PDF繧ｫ繝ｼ繝峨・繝ｬ繝薙Η繝ｼ繧呈緒逕ｻ・・esktop: 蝓九ａ霎ｼ縺ｿ縲｀obile: 繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ・・	 */
	private async renderPdfCardPreview(
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
			this.renderPdfFallback(container, card, 'PDF preview failed. Tap Open to view.', isGridMode);
			return;
		}

		const pdfFile = this.app.vault.getAbstractFileByPath(pdfPath);
		if (!(pdfFile instanceof TFile)) {
			this.renderPdfFallback(container, card, 'PDF preview failed. Tap Open to view.', isGridMode);
			return;
		}

		if (Platform.isMobile) {
			this.renderPdfFallback(container, card, 'PDF preview is unavailable on mobile. Tap Open.', isGridMode);
			return;
		}

		const embedHost = container.createDiv({ cls: 'timeline-pdf-embed-host' });
		try {
			await MarkdownRenderer.render(
				this.app,
				`![[${pdfFile.path}]]`,
				embedHost,
				card.path,
				this.renderComponent
			);
		} catch (error: unknown) {
			console.error('Failed to render PDF preview:', error);
			this.renderPdfFallback(container, card, 'PDF preview failed. Tap Open to view.', isGridMode);
			return;
		}

		this.applyInitialPdfZoom(embedHost);

		const renderedOk = await this.ensurePdfRendered(embedHost);
		if (!renderedOk) {
			this.renderPdfFallback(container, card, 'PDF preview failed. Tap Open to view.', isGridMode);
			return;
		}

		this.createPdfOpenButton(container, card);

		const checkTimeout = window.setTimeout(() => {
			if (!container.isConnected) return;
			this.applyInitialPdfZoom(embedHost);
			const currentPdfEl = this.findRenderedPdfElement(embedHost);
			if (!currentPdfEl || !this.hasVisibleSize(currentPdfEl)) {
				this.renderPdfFallback(container, card, 'PDF preview failed. Tap Open to view.', isGridMode);
			}
		}, 1500);
		this.register(() => { window.clearTimeout(checkTimeout); });
	}

	/**
	 * 蝓九ａ霎ｼ縺ｿPDF隕∫ｴ縺ｮ謠冗判蜿ｯ蜷ｦ繧堤｢ｺ隱・	 */
	private async ensurePdfRendered(embedHost: HTMLElement): Promise<boolean> {
		await this.waitForAnimationFrame();
		await this.waitForAnimationFrame();

		const pdfEl = this.findRenderedPdfElement(embedHost);
		return !!pdfEl && this.hasVisibleSize(pdfEl);
	}

	/**
	 * 蝓九ａ霎ｼ縺ｿPDF隕∫ｴ繧呈､懷・
	 */
	private findRenderedPdfElement(container: HTMLElement): HTMLElement | null {
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
	 * 隕∫ｴ縺悟庄隕悶し繧､繧ｺ繧呈戟縺｣縺ｦ縺・ｋ縺句愛螳・	 */
	private hasVisibleSize(element: HTMLElement): boolean {
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	}

	/**
	 * PDF縺ｮ蛻晄悄繧ｺ繝ｼ繝繧・00%縺ｫ蝗ｺ螳・	 */
	private applyInitialPdfZoom(container: HTMLElement): void {
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
					const zoomedSrc = this.withPdfZoom100(currentSrc);
					if (zoomedSrc !== currentSrc) {
						target.setAttribute('src', zoomedSrc);
					}
					continue;
				}

				if (target instanceof HTMLObjectElement) {
					const currentData = target.getAttribute('data');
					if (!currentData) continue;
					const zoomedData = this.withPdfZoom100(currentData);
					if (zoomedData !== currentData) {
						target.setAttribute('data', zoomedData);
					}
				}
			}
		}
	}

	/**
	 * URL繝輔Λ繧ｰ繝｡繝ｳ繝医↓ zoom=100 繧帝←逕ｨ
	 */
	private withPdfZoom100(url: string): string {
		const [base, hash = ''] = url.split('#', 2);
		const tokens = hash
			.replace(/^\?/, '')
			.split('&')
			.map(token => token.trim())
			.filter(token => token.length > 0);

		let hasZoom = false;
		const nextTokens = tokens.map((token) => {
			if (token.startsWith('zoom=')) {
				hasZoom = true;
				return 'zoom=100';
			}
			return token;
		});

		if (!hasZoom) {
			nextTokens.unshift('zoom=100');
		}

		return `${base}#${nextTokens.join('&')}`;
	}

	/**
	 * PDF繝励Ξ繝薙Η繝ｼ縺ｮ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ繧呈緒逕ｻ
	 */
	private renderPdfFallback(
		container: HTMLElement,
		card: TimelineCard,
		message: string,
		isGridMode: boolean
	): void {
		container.addClass('timeline-pdf-has-fallback');
		container.empty();

		const fallbackEl = container.createDiv({ cls: 'timeline-pdf-fallback timeline-pdf-fallback-visible' });
		fallbackEl.addClass(isGridMode ? 'timeline-pdf-fallback-grid' : 'timeline-pdf-fallback-list');
		fallbackEl.createDiv({ cls: 'timeline-pdf-fallback-icon', text: '塘' });
		const fileName = card.firstImagePath?.split('/').pop() ?? 'PDF';
		fallbackEl.createDiv({ cls: 'timeline-pdf-fallback-name', text: fileName });
		fallbackEl.createDiv({ cls: 'timeline-pdf-fallback-hint', text: message });

		this.createPdfOpenButton(container, card);
	}

	/**
	 * 谺｡繝輔Ξ繝ｼ繝縺ｾ縺ｧ蠕・ｩ・	 */
	private waitForAnimationFrame(): Promise<void> {
		return new Promise((resolve) => {
			window.requestAnimationFrame(() => resolve());
		});
	}

	/**
	 * 髮｣譏灘ｺｦ繝懊ち繝ｳ繧剃ｽ懈・
	 */
	private createDifficultyButtons(container: HTMLElement, card: TimelineCard): void {
		const log = this.plugin.data.reviewLogs[card.path];
		const intervals = getNextIntervals(log, this.plugin.data.settings);

		const buttons: { rating: DifficultyRating; label: string; interval: string; cls: string }[] = [
			{ rating: 'again', label: 'Again', interval: intervals.again, cls: 'timeline-btn-again' },
			{ rating: 'hard', label: 'Hard', interval: intervals.hard, cls: 'timeline-btn-hard' },
			{ rating: 'good', label: 'Good', interval: intervals.good, cls: 'timeline-btn-good' },
			{ rating: 'easy', label: 'Easy', interval: intervals.easy, cls: 'timeline-btn-easy' },
		];

		for (const btn of buttons) {
			const buttonEl = container.createEl('button', {
				cls: `timeline-difficulty-btn ${btn.cls}`,
			});
			buttonEl.createSpan({ cls: 'timeline-btn-label', text: btn.label });
			buttonEl.createSpan({ cls: 'timeline-btn-interval', text: btn.interval });

			buttonEl.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.plugin.rateCard(card.path, btn.rating).then(() => {
					container.closest('.timeline-card')?.addClass('timeline-card-reviewed');
					this.replaceWithUndoButton(container, card);
				});
			});
		}
	}

	/**
	 * 髮｣譏灘ｺｦ繝懊ち繝ｳ繧旦ndo繝懊ち繝ｳ縺ｫ鄂ｮ謠・
	 */
	private replaceWithUndoButton(container: HTMLElement, card: TimelineCard): void {
		container.empty();
		container.addClass('timeline-difficulty-undo');

		const undoBtn = container.createEl('button', {
			cls: 'timeline-undo-btn',
		});
		undoBtn.createSpan({ text: '\u21A9 Undo' });

		undoBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.plugin.undoRating(card.path).then((success) => {
				if (success) {
					// 繝ｬ繝薙Η繝ｼ貂医∩繧ｯ繝ｩ繧ｹ繧定ｧ｣髯､
					container.closest('.timeline-card')?.removeClass('timeline-card-reviewed');
					// Undo繧ｯ繝ｩ繧ｹ繧帝勁蜴ｻ縺励・屮譏灘ｺｦ繝懊ち繝ｳ繧貞・謠冗判
					container.removeClass('timeline-difficulty-undo');
					container.empty();
					this.createDifficultyButtons(container, card);
				}
			});
		});
	}

	/**
	 * 繝弱・繝医ｒ髢九￥
	 */
	private async openNote(card: TimelineCard): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (!file || !(file instanceof TFile)) return;

		if (Platform.isMobile) {
			// Mobile: 譁ｰ縺励＞leaf縺ｧ髢九￥
			await this.app.workspace.getLeaf().openFile(file);
			return;
		}

		// Desktop: 逶ｴ蜑阪↓繧｢繧ｯ繝・ぅ繝悶□縺｣縺殕eaf縺ｮ髫｣縺ｫ譁ｰ縺励＞繧ｿ繝悶→縺励※髢九￥
		let targetLeaf: WorkspaceLeaf;

		if (this.previousActiveLeaf) {
			// 逶ｴ蜑阪・leaf縺ｨ蜷後§繧ｿ繝悶げ繝ｫ繝ｼ繝励↓譁ｰ縺励＞繧ｿ繝悶ｒ菴懈・
			const parent = this.previousActiveLeaf.parent;
			if (parent) {
				// parent 縺ｯ WorkspaceTabs | WorkspaceMobileDrawer 縺縺・createLeafInParent 縺ｯ WorkspaceSplit 繧呈悄蠕・☆繧九ょｮ溯｡梧凾縺ｯ蜍穂ｽ懊☆繧九◆繧∝梛繧｢繧ｵ繝ｼ繧ｷ繝ｧ繝ｳ縺ｧ蟇ｾ蠢・
				targetLeaf = this.app.workspace.createLeafInParent(parent as unknown as WorkspaceSplit, -1);
			} else {
				targetLeaf = this.app.workspace.getLeaf('tab');
			}
		} else {
			// 逶ｴ蜑阪・leaf縺後↑縺・ｴ蜷医・縲√ち繧､繝繝ｩ繧､繝ｳ莉･螟悶・leaf繧呈爾縺励※蜷後§繧ｿ繝悶げ繝ｫ繝ｼ繝励↓髢九￥
			const adjacentLeaf = this.findAdjacentLeaf(this.leaf);
			if (adjacentLeaf) {
				const parent = adjacentLeaf.parent;
				if (parent) {
					// parent 縺ｯ WorkspaceTabs | WorkspaceMobileDrawer 縺縺・createLeafInParent 縺ｯ WorkspaceSplit 繧呈悄蠕・☆繧九ょｮ溯｡梧凾縺ｯ蜍穂ｽ懊☆繧九◆繧∝梛繧｢繧ｵ繝ｼ繧ｷ繝ｧ繝ｳ縺ｧ蟇ｾ蠢・
					targetLeaf = this.app.workspace.createLeafInParent(parent as unknown as WorkspaceSplit, -1);
				} else {
					targetLeaf = this.app.workspace.getLeaf('tab');
				}
			} else {
				// 髫｣縺ｮleaf縺後↑縺代ｌ縺ｰ縲∝承縺ｫ蛻・牡縺励※髢九￥
				targetLeaf = this.app.workspace.getLeaf('split');
			}
		}

		await targetLeaf.openFile(file);

		// 繝輔か繝ｼ繧ｫ繧ｹ繧偵ヮ繝ｼ繝医↓遘ｻ蜍・
		this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
	}

	/**
	 * 繧ｿ繧､繝繝ｩ繧､繝ｳ莉･螟悶・髫｣謗･縺吶ｋleaf繧呈爾縺・
	 */
	private findAdjacentLeaf(timelineLeaf: WorkspaceLeaf): WorkspaceLeaf | null {
		let targetLeaf: WorkspaceLeaf | null = null;
		let foundMarkdownLeaf: WorkspaceLeaf | null = null;

		this.app.workspace.iterateAllLeaves((leaf) => {
			// 繧ｿ繧､繝繝ｩ繧､繝ｳ閾ｪ霄ｫ縺ｯ髯､螟・
			if (leaf === timelineLeaf) return;

			// 繧ｿ繧､繝繝ｩ繧､繝ｳ繝薙Η繝ｼ縺ｯ髯､螟・
			if (leaf.view.getViewType() === TIMELINE_VIEW_TYPE) return;

			// Markdown繝薙Η繝ｼ・医ヮ繝ｼ繝茨ｼ峨ｒ蜆ｪ蜈・
			if (leaf.view.getViewType() === 'markdown') {
				foundMarkdownLeaf = leaf;
			}

			// 遨ｺ縺ｮ繝薙Η繝ｼ縺ｾ縺溘・縺昴・莉悶・繝薙Η繝ｼ
			if (!targetLeaf) {
				targetLeaf = leaf;
			}
		});

		// Markdown繝薙Η繝ｼ縺後≠繧後・縺昴ｌ繧貞━蜈・
		return foundMarkdownLeaf || targetLeaf;
	}

	/**
	 * 逶ｸ蟇ｾ譌･莉倥ヵ繧ｩ繝ｼ繝槭ャ繝・
	 */
	private formatRelativeDate(date: Date): string {
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return 'today';
		if (diffDays === 1) return 'yesterday';
		if (diffDays < 7) return `${diffDays}d ago`;
		if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
		return `${Math.floor(diffDays / 30)}mo ago`;
	}

	/**
	 * 繝輔ぃ繧､繝ｫ繧ｿ繧､繝励い繧､繧ｳ繝ｳ繧貞叙蠕・
	 */
	private getFileTypeIcon(fileType: string): string {
		switch (fileType) {
			case 'text': return '塔';
			case 'image': return 'IMG';
			case 'pdf': return '塘';
			case 'audio': return '七';
			case 'video': return '汐';
			case 'office': return '投';
			case 'ipynb': return '涛';
			default: return '刀';
		}
	}

	/**
	 * 繝輔ぃ繧､繝ｫ縺後ヶ繝・け繝槭・繧ｯ縺輔ｌ縺ｦ縺・ｋ縺狗｢ｺ隱搾ｼ医く繝｣繝・す繝･菴ｿ逕ｨ・・
	 */
	private isFileBookmarked(path: string): boolean {
		// 繧ｭ繝｣繝・す繝･縺後≠繧後・菴ｿ逕ｨ・・(1)繝ｫ繝・け繧｢繝・・・・
		if (this.cachedBookmarkedPaths) {
			return this.cachedBookmarkedPaths.has(path);
		}

		// 繧ｭ繝｣繝・す繝･縺後↑縺・ｴ蜷医・dataLayer縺九ｉ蜿門ｾ・
		this.cachedBookmarkedPaths = getBookmarkedPaths(this.app);
		return this.cachedBookmarkedPaths.has(path);
	}

	/**
	 * 繝悶ャ繧ｯ繝槭・繧ｯ繧偵ヨ繧ｰ繝ｫ
	 */
	private async toggleBookmark(path: string): Promise<boolean> {
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
			// 譌｢縺ｫ繝悶ャ繧ｯ繝槭・繧ｯ縺輔ｌ縺ｦ縺・ｋ蝣ｴ蜷医・蜑企勁
			instance.removeItem(existing);
			result = false;
		} else {
			// 繝悶ャ繧ｯ繝槭・繧ｯ繧定ｿｽ蜉
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file && file instanceof TFile) {
				instance.addItem({ type: 'file', path: path, title: '' });
				result = true;
			} else {
				result = false;
			}
		}

		// 繧ｭ繝｣繝・す繝･繧偵け繝ｪ繧｢
		clearBookmarkCache();
		this.cachedBookmarkedPaths = null;

		return result;
	}

	/**
	 * 繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ繝上Φ繝峨Λ繝ｼ・育┌髯舌せ繧ｯ繝ｭ繝ｼ繝ｫ逕ｨ・・
	 */
	private handleScroll(): void {
		if (!this.plugin.data.settings.enableInfiniteScroll) return;
		if (this.isLoadingMore) return;
		if (this.displayedCount >= this.filteredCards.length) return;

		const container = this.listContainerEl;
		const scrollBottom = container.scrollTop + container.clientHeight;
		const threshold = container.scrollHeight - 200; // 200px謇句燕縺ｧ繝ｭ繝ｼ繝蛾幕蟋・

		if (scrollBottom >= threshold) {
			void this.loadMoreCards();
		}
	}

	/**
	 * 霑ｽ蜉繧ｫ繝ｼ繝峨ｒ繝ｭ繝ｼ繝会ｼ育┌髯舌せ繧ｯ繝ｭ繝ｼ繝ｫ逕ｨ・・
	 */
	private async loadMoreCards(): Promise<void> {
		if (this.isLoadingMore) return;
		if (this.displayedCount >= this.filteredCards.length) return;
		if (!this.listEl) return;

		this.isLoadingMore = true;

		const settings = this.plugin.data.settings;
		const isGridMode = settings.viewMode === 'grid';
		const batchSize = settings.infiniteScrollBatchSize || 20;
		const startIndex = this.displayedCount;
		const endIndex = Math.min(startIndex + batchSize, this.filteredCards.length);

		// 霑ｽ蜉繧ｫ繝ｼ繝峨ｒ繝√Ε繝ｳ繧ｯ謠冗判
		const cardsToLoad = this.filteredCards.slice(startIndex, endIndex).filter((c): c is TimelineCard => !!c);
		const { fragment: moreFragment, elements: moreElements } = await this.renderCardsToFragment(
			cardsToLoad, isGridMode
		);
		this.cardElements.push(...moreElements);
		this.listEl.appendChild(moreFragment);

		this.displayedCount = endIndex;
		this.isLoadingMore = false;

		// 繝輔ャ繧ｿ繝ｼ繧呈峩譁ｰ
		this.updateFooter();
	}

	/**
	 * 繧ｿ繝・メ髢句ｧ九ワ繝ｳ繝峨Λ繝ｼ・医・繝ｫ繝医ぇ繝ｪ繝輔Ξ繝・す繝･逕ｨ・・
	 */
	private handleTouchStart(e: TouchEvent): void {
		if (this.listContainerEl.scrollTop === 0) {
			const touch = e.touches[0];
			if (touch) {
				this.pullToRefreshStartY = touch.clientY;
			}
		}
	}

	/**
	 * 繧ｿ繝・メ遘ｻ蜍輔ワ繝ｳ繝峨Λ繝ｼ・医・繝ｫ繝医ぇ繝ｪ繝輔Ξ繝・す繝･逕ｨ・・
	 */
	private handleTouchMove(e: TouchEvent): void {
		if (this.pullToRefreshStartY === 0) return;
		if (this.listContainerEl.scrollTop > 0) {
			this.pullToRefreshStartY = 0;
			this.hidePullIndicator();
			return;
		}

		const touch = e.touches[0];
		if (!touch) return;

		const pullDistance = touch.clientY - this.pullToRefreshStartY;
		const threshold = 80;

		if (pullDistance > 0) {
			// 蠑輔▲蠑ｵ繧贋ｸｭ - 繝・ヵ繧ｩ繝ｫ繝医・繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ繧帝亟豁｢
			e.preventDefault();

			// 繧､繝ｳ繧ｸ繧ｱ繝ｼ繧ｿ繝ｼ繧定｡ｨ遉ｺ繝ｻ譖ｴ譁ｰ
			this.showPullIndicator(pullDistance, threshold);

			if (pullDistance >= threshold) {
				this.pullToRefreshTriggered = true;
			} else {
				this.pullToRefreshTriggered = false;
			}
		}
	}

	/**
	 * 繧ｿ繝・メ邨ゆｺ・ワ繝ｳ繝峨Λ繝ｼ・医・繝ｫ繝医ぇ繝ｪ繝輔Ξ繝・す繝･逕ｨ・・
	 */
	private handleTouchEnd(_e: TouchEvent): void {
		if (this.pullToRefreshTriggered) {
			this.pullToRefreshTriggered = false;
			this.showPullIndicator(0, 80, true);  // 繝ｭ繝ｼ繝・ぅ繝ｳ繧ｰ迥ｶ諷九ｒ陦ｨ遉ｺ
			void this.refresh().then(() => {
				this.hidePullIndicator();
			});
		} else {
			this.hidePullIndicator();
		}
		this.pullToRefreshStartY = 0;
	}

	/**
	 * 繝励Ν繧､繝ｳ繧ｸ繧ｱ繝ｼ繧ｿ繝ｼ繧定｡ｨ遉ｺ
	 */
	private showPullIndicator(distance: number, threshold: number, loading: boolean = false): void {
		if (!this.pullIndicatorEl) {
			this.pullIndicatorEl = createDiv({ cls: 'timeline-pull-indicator' });
			this.listContainerEl.insertBefore(this.pullIndicatorEl, this.listContainerEl.firstChild);
		}

		const progress = Math.min(distance / threshold, 1);
		const height = Math.min(distance * 0.5, 60);

		this.pullIndicatorEl.style.height = `${height}px`;
		this.pullIndicatorEl.style.opacity = String(progress);

		this.pullIndicatorEl.empty();
		if (loading) {
			this.pullIndicatorEl.createSpan({ cls: 'timeline-pull-spinner' });
			this.pullIndicatorEl.createSpan({ text: 'Refreshing...' });
			this.pullIndicatorEl.classList.add('is-loading');
		} else if (progress >= 1) {
			this.pullIndicatorEl.createSpan({ text: 'v' });
			this.pullIndicatorEl.createSpan({ text: 'Release to refresh' });
			this.pullIndicatorEl.classList.add('is-ready');
			this.pullIndicatorEl.classList.remove('is-loading');
		} else {
			this.pullIndicatorEl.createSpan({ text: 'v' });
			this.pullIndicatorEl.createSpan({ text: 'Pull to refresh' });
			this.pullIndicatorEl.classList.remove('is-ready', 'is-loading');
		}
	}

	/**
	 * 繝励Ν繧､繝ｳ繧ｸ繧ｱ繝ｼ繧ｿ繝ｼ繧帝撼陦ｨ遉ｺ
	 */
	private hidePullIndicator(): void {
		if (this.pullIndicatorEl) {
			this.pullIndicatorEl.remove();
			this.pullIndicatorEl = null;
		}
	}

	/**
	 * 繝輔ャ繧ｿ繝ｼ繧呈峩譁ｰ・育┌髯舌せ繧ｯ繝ｭ繝ｼ繝ｫ逕ｨ・・
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
				text: '↻',
				attr: { 'aria-label': 'Refresh timeline' },
			});
			bottomRefreshBtn.addEventListener('click', () => { void this.refresh(); });
		}
	}

	/**
	 * 繧ｭ繝ｼ繝懊・繝峨す繝ｧ繝ｼ繝医き繝・ヨ繝上Φ繝峨Λ繝ｼ
	 */
	private handleKeydown(e: KeyboardEvent): void {
		// 蜈･蜉帙ヵ繧｣繝ｼ繝ｫ繝峨↓繝輔か繝ｼ繧ｫ繧ｹ縺後≠繧句ｴ蜷医・辟｡隕・
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
			return;
		}

		switch (e.key) {
			case 'j':
			case 'ArrowDown':
				e.preventDefault();
				this.focusNextCard();
				break;
			case 'k':
			case 'ArrowUp':
				e.preventDefault();
				this.focusPrevCard();
				break;
			case 'o':
			case 'Enter':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					void this.openFocusedCard();
				}
				break;
			case '1':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					void this.rateFocusedCard('again');
				}
				break;
			case '2':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					void this.rateFocusedCard('hard');
				}
				break;
			case '3':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					void this.rateFocusedCard('good');
				}
				break;
			case '4':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					void this.rateFocusedCard('easy');
				}
				break;
			case 'b':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					void this.toggleFocusedBookmark();
				}
				break;
			case 'c':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					this.openFocusedComment();
				}
				break;
			case 'q':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					this.openFocusedQuoteNote();
				}
				break;
			case 'l':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					this.openFocusedLinkNote();
				}
				break;
			case 'u':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					void this.undoFocusedCard();
				}
				break;
			case 'r':
				e.preventDefault();
				void this.refresh();
				break;
			case 'Escape':
				e.preventDefault();
				this.clearFocus();
				break;
		}
	}

	/**
	 * 谺｡縺ｮ繧ｫ繝ｼ繝峨↓繝輔か繝ｼ繧ｫ繧ｹ
	 */
	private focusNextCard(): void {
		if (this.cardElements.length === 0) return;

		const newIndex = this.focusedIndex < this.cardElements.length - 1
			? this.focusedIndex + 1
			: 0;
		this.setFocusedIndex(newIndex);
	}

	/**
	 * 蜑阪・繧ｫ繝ｼ繝峨↓繝輔か繝ｼ繧ｫ繧ｹ
	 */
	private focusPrevCard(): void {
		if (this.cardElements.length === 0) return;

		const newIndex = this.focusedIndex > 0
			? this.focusedIndex - 1
			: this.cardElements.length - 1;
		this.setFocusedIndex(newIndex);
	}

	/**
	 * 繝輔か繝ｼ繧ｫ繧ｹ繧､繝ｳ繝・ャ繧ｯ繧ｹ繧定ｨｭ螳・
	 */
	private setFocusedIndex(index: number): void {
		// 蜑阪・繝輔か繝ｼ繧ｫ繧ｹ繧定ｧ｣髯､
		if (this.focusedIndex >= 0 && this.focusedIndex < this.cardElements.length) {
			const prevEl = this.cardElements[this.focusedIndex];
			if (prevEl) {
				prevEl.removeClass('timeline-card-focused');
			}
		}

		// 譁ｰ縺励＞繝輔か繝ｼ繧ｫ繧ｹ繧定ｨｭ螳・
		this.focusedIndex = index;
		if (index >= 0 && index < this.cardElements.length) {
			const cardEl = this.cardElements[index];
			if (cardEl) {
				cardEl.addClass('timeline-card-focused');
				cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		}
	}

	/**
	 * 繝輔か繝ｼ繧ｫ繧ｹ繧偵け繝ｪ繧｢
	 */
	private clearFocus(): void {
		if (this.focusedIndex >= 0 && this.focusedIndex < this.cardElements.length) {
			const el = this.cardElements[this.focusedIndex];
			if (el) {
				el.removeClass('timeline-card-focused');
			}
		}
		this.focusedIndex = -1;
	}

	/**
	 * 繝輔か繝ｼ繧ｫ繧ｹ荳ｭ縺ｮ繧ｫ繝ｼ繝峨ｒ髢九￥
	 */
	private async openFocusedCard(): Promise<void> {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;
		const card = this.filteredCards[this.focusedIndex];
		if (card) {
			await this.openNote(card);
		}
	}

	/**
	 * 繝輔か繝ｼ繧ｫ繧ｹ荳ｭ縺ｮ繧ｫ繝ｼ繝峨↓髮｣譏灘ｺｦ隧穂ｾ｡
	 */
	private async rateFocusedCard(rating: DifficultyRating): Promise<void> {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;

		const card = this.filteredCards[this.focusedIndex];
		if (!card) return;

		await this.plugin.rateCard(card.path, rating);
		const cardEl = this.cardElements[this.focusedIndex];
		if (cardEl) {
			cardEl.addClass('timeline-card-reviewed');
			// Undo繝懊ち繝ｳ繧定｡ｨ遉ｺ
			const buttonsEl = cardEl.querySelector('.timeline-difficulty-buttons') as HTMLElement;
			if (buttonsEl) {
				this.replaceWithUndoButton(buttonsEl, card);
			}
		}

		// 谺｡縺ｮ繧ｫ繝ｼ繝峨↓繝輔か繝ｼ繧ｫ繧ｹ
		if (this.focusedIndex < this.cardElements.length - 1) {
			this.setFocusedIndex(this.focusedIndex + 1);
		}
	}

	/**
	 * 繝輔か繝ｼ繧ｫ繧ｹ荳ｭ縺ｮ繧ｫ繝ｼ繝峨・隧穂ｾ｡繧貞叙繧頑ｶ医＠
	 */
	private async undoFocusedCard(): Promise<void> {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;

		const card = this.filteredCards[this.focusedIndex];
		if (!card) return;
		if (!this.plugin.hasUndoForCard(card.path)) return;

		const success = await this.plugin.undoRating(card.path);
		if (!success) return;

		const cardEl = this.cardElements[this.focusedIndex];
		if (cardEl) {
			cardEl.removeClass('timeline-card-reviewed');
			// 髮｣譏灘ｺｦ繝懊ち繝ｳ繧貞・謠冗判
			const buttonsEl = cardEl.querySelector('.timeline-difficulty-buttons') as HTMLElement;
			if (buttonsEl) {
				buttonsEl.removeClass('timeline-difficulty-undo');
				buttonsEl.empty();
				this.createDifficultyButtons(buttonsEl, card);
			}
		}
	}

	/**
	 * 繝輔か繝ｼ繧ｫ繧ｹ荳ｭ縺ｮ繧ｫ繝ｼ繝峨・繝悶ャ繧ｯ繝槭・繧ｯ繧偵ヨ繧ｰ繝ｫ
	 */
	private async toggleFocusedBookmark(): Promise<void> {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;

		const card = this.filteredCards[this.focusedIndex];
		if (!card) return;

		const nowBookmarked = await this.toggleBookmark(card.path);

		// 繝悶ャ繧ｯ繝槭・繧ｯ繝懊ち繝ｳ縺ｮUI繧呈峩譁ｰ
		const cardEl = this.cardElements[this.focusedIndex];
		if (cardEl) {
			const bookmarkBtn = cardEl.querySelector('.timeline-bookmark-btn') as HTMLElement;
			if (bookmarkBtn) {
				bookmarkBtn.textContent = nowBookmarked ? '★' : '☆';
				bookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
			}
		}
	}

	/**
	 * 繝輔か繝ｼ繧ｫ繧ｹ荳ｭ縺ｮ繧ｫ繝ｼ繝峨・繧ｳ繝｡繝ｳ繝医Δ繝ｼ繝繝ｫ繧帝幕縺・
	 */
	private openFocusedComment(): void {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;

		const card = this.filteredCards[this.focusedIndex];
		if (!card) return;

		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (file && file instanceof TFile) {
			const modal = new CommentModal(this.app, this.plugin, file);
			modal.open();
		}
	}

	/**
	 * 繝輔か繝ｼ繧ｫ繧ｹ荳ｭ縺ｮ繧ｫ繝ｼ繝峨・蠑慕畑繝弱・繝医Δ繝ｼ繝繝ｫ繧帝幕縺・
	 */
	private openFocusedQuoteNote(): void {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;

		const card = this.filteredCards[this.focusedIndex];
		if (!card) return;

		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (file && file instanceof TFile) {
			const modal = new QuoteNoteModal(this.app, this.plugin, file);
			modal.open();
		}
	}

	/**
	 * 繝輔か繝ｼ繧ｫ繧ｹ荳ｭ縺ｮ繧ｫ繝ｼ繝峨・繝ｪ繝ｳ繧ｯ繝弱・繝医Δ繝ｼ繝繝ｫ繧帝幕縺・
	 */
	private openFocusedLinkNote(): void {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;

		const card = this.filteredCards[this.focusedIndex];
		if (!card) return;

		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (file && file instanceof TFile) {
			new LinkNoteModal(this.app, file).open();
		}
	}
}








