// Timeline Note Launcher - Timeline View
import { ItemView, WorkspaceLeaf, WorkspaceSplit, Platform, TFile, MarkdownRenderer, Component, Menu } from 'obsidian';
import { TimelineCard, DifficultyRating, ColorTheme, ImageSizeMode, UITheme, DEFAULT_QUICK_NOTE_TEMPLATE } from './types';
import { getNextIntervals, getBookmarkedPaths, getBookmarksPlugin, clearBookmarkCache } from './dataLayer';
import { CommentModal } from './commentModal';
import { QuoteNoteModal } from './quoteNoteModal';
import { LinkNoteModal } from './linkNoteModal';
import type TimelineNoteLauncherPlugin from './main';

/**
 * 配�Eの冁E��が等しぁE��を比輁E
 */
function arraysEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/**
 * カード�E更新検知用キー
 */
function buildCardStateKey(card: TimelineCard): string {
	return [
		card.path,
		String(card.lastReviewedAt ?? ''),
		String(card.reviewCount),
		String(card.nextReviewAt ?? ''),
	].join('|');
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
	// フィルタ状慁E
	private searchQuery: string = '';
	private fileTypeFilters: Set<string> = new Set(['markdown', 'text', 'image', 'pdf', 'audio', 'video', 'office', 'ipynb', 'other']);
	private selectedTags: Set<string> = new Set();
	private searchDebounceTimer: number | null = null;
	// 直前にアクチE��ブだったleaf�E�タイムライン以外！E
	private previousActiveLeaf: WorkspaceLeaf | null = null;
	// 差刁E��ンダリング用�E�前回�Eカードパス
	private lastCardPaths: string[] = [];
	// 差刁E��ンダリング用�E�前回�Eカード状態キー
	private lastCardStateKeys: string[] = [];
	// ブックマ�EクパスのキャチE��ュ
	private cachedBookmarkedPaths: Set<string> | null = null;
	// タグキャチE��ュ�E�Eefresh()時に更新�E�E
	private cachedAllTags: string[] = [];
	private isTagsCollapsed: boolean = false;
	// 無限スクロール用
	private displayedCount: number = 0;
	private isLoadingMore: boolean = false;
	private scrollHandler: () => void;
	private listEl: HTMLElement | null = null;
	// プルトゥリフレチE��ュ用
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
		// プルトゥリフレチE��ュ用
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

		// モバイル向けクラス追加
		this.updateMobileClass();

		// キーボ�EドショートカチE��登録
		this.listContainerEl.tabIndex = 0;
		this.listContainerEl.addEventListener('keydown', this.keydownHandler);

		// 無限スクロール用スクロールイベント登録
		this.listContainerEl.addEventListener('scroll', this.scrollHandler);

		// プルトゥリフレチE��ュ用タチE��イベント登録�E�モバイルのみ�E�E
		if (Platform.isMobile) {
			this.listContainerEl.addEventListener('touchstart', this.touchStartHandler, { passive: true });
			this.listContainerEl.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
			this.listContainerEl.addEventListener('touchend', this.touchEndHandler, { passive: true });
		}

		// アクチE��ブleafの変更を監視して、タイムライン以外�Eleafを記録
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf && leaf !== this.leaf && leaf.view.getViewType() !== TIMELINE_VIEW_TYPE) {
					this.previousActiveLeaf = leaf;
				}
			})
		);

		// 現在アクチE��ブなleafを�E期値として保存（タイムライン以外！E
		const currentActive = this.app.workspace.getActiveViewOfType(ItemView)?.leaf;
		if (currentActive && currentActive !== this.leaf && currentActive.view.getViewType() !== TIMELINE_VIEW_TYPE) {
			this.previousActiveLeaf = currentActive;
		}

		await this.refresh();
	}

	/**
	 * モバイルクラスの更新
	 */
	private updateMobileClass(): void {
		// 実際のモバイルチE��イス、また�EPCでモバイルモードが有効な場吁E
		const isMobileView = Platform.isMobile || this.plugin.data.settings.mobileViewOnDesktop;
		if (isMobileView) {
			this.listContainerEl.addClass('timeline-mobile');
		} else {
			this.listContainerEl.removeClass('timeline-mobile');
		}
	}

	/**
	 * カラーチE�Eマ�E更新
	 */
	private updateColorTheme(): void {
		const theme = this.plugin.data.settings.colorTheme;
		const themes: ColorTheme[] = ['default', 'blue', 'green', 'purple', 'orange', 'pink', 'red', 'cyan', 'yellow'];

		// 既存�EチE�Eマクラスを削除
		for (const t of themes) {
			this.listContainerEl.removeClass(`timeline-theme-${t}`);
		}

		// 新しいチE�Eマクラスを追加
		this.listContainerEl.addClass(`timeline-theme-${theme}`);
	}

	/**
	 * UIチE�Eマ�E更新
	 */
	private updateUITheme(): void {
		const uiTheme = this.plugin.data.settings.uiTheme;
		const themes: UITheme[] = ['classic', 'twitter'];

		// 既存�EUIチE�Eマクラスを削除
		for (const t of themes) {
			this.listContainerEl.removeClass(`timeline-ui-${t}`);
		}

		// 新しいUIチE�Eマクラスを追加
		this.listContainerEl.addClass(`timeline-ui-${uiTheme}`);
	}

	/**
	 * モバイルモードを刁E��替え！ECのみ�E�E
	 */
	async toggleMobileView(): Promise<void> {
		if (Platform.isMobile) return;
		this.plugin.data.settings.mobileViewOnDesktop = !this.plugin.data.settings.mobileViewOnDesktop;
		void this.plugin.syncAndSave();
		this.updateMobileClass();
		// 強制皁E��再描画するためにキャチE��ュをクリア
		this.lastCardPaths = [];
		this.lastCardStateKeys = [];
		await this.render();
	}

	async onClose(): Promise<void> {
		// スクロール位置を保孁E
		this.scrollPosition = this.listContainerEl.scrollTop;
		// 検索チE��ウンスタイマ�Eを解除
		if (this.searchDebounceTimer !== null) {
			window.clearTimeout(this.searchDebounceTimer);
			this.searchDebounceTimer = null;
		}
		// レンダリングコンポ�EネントをアンローチE
		this.renderComponent.unload();
		// キーボ�Eドリスナ�Eを解除
		this.listContainerEl.removeEventListener('keydown', this.keydownHandler);
		// スクロールリスナ�Eを解除
		this.listContainerEl.removeEventListener('scroll', this.scrollHandler);
		// タチE��リスナ�Eを解除
		if (Platform.isMobile) {
			this.listContainerEl.removeEventListener('touchstart', this.touchStartHandler);
			this.listContainerEl.removeEventListener('touchmove', this.touchMoveHandler);
			this.listContainerEl.removeEventListener('touchend', this.touchEndHandler);
		}
	}

	/**
	 * タイムラインを更新
	 */
	async refresh(): Promise<void> {
		// スクロール位置を保孁E
		this.scrollPosition = this.listContainerEl?.scrollTop ?? 0;

		// 表示設定を更新�E�設定との同期�E�E
		this.updateMobileClass();
		this.updateColorTheme();
		this.updateUITheme();

		// ブックマ�EクキャチE��ュを更新
		this.cachedBookmarkedPaths = getBookmarkedPaths(this.app);

		// カードを取征E
		const result = await this.plugin.getTimelineCards();
		this.cards = result.cards;
		this.cachedAllTags = this.collectAllTags();
		this.newCount = result.newCount;
		this.dueCount = result.dueCount;

		// 描画
		await this.render();

		// スクロール位置を復允E
		if (this.listContainerEl) {
			this.listContainerEl.scrollTop = this.scrollPosition;
		}
	}

	/**
	 * カードをチャンク単位で描画しDocumentFragmentに追加
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
	 * カード一覧を描画
	 */
	private async render(): Promise<void> {
		// カードパスの変更を検�E
		const newPaths = this.cards.map(c => c.path);
		const newStateKeys = this.cards.map(card => buildCardStateKey(card));
		const pathsChanged = !arraysEqual(this.lastCardPaths, newPaths);
		const stateChanged = !arraysEqual(this.lastCardStateKeys, newStateKeys);

		// パスめE��ード�E容が変わってぁE��ぁE��合�E完�E再構築をスキチE�E�E��EチE��ーの統計�Eみ更新�E�E
		if (!pathsChanged && !stateChanged && this.listContainerEl.hasChildNodes()) {
			// 統計�Eみ更新
			const statsEl = this.listContainerEl.querySelector('.timeline-stats');
			if (statsEl && this.plugin.data.settings.selectionMode === 'srs') {
				statsEl.empty();
				statsEl.createSpan({ cls: 'timeline-stat-new', text: `${this.newCount} new` });
				statsEl.appendText(' · ');
				statsEl.createSpan({ cls: 'timeline-stat-due', text: `${this.dueCount} due` });
			}
			return;
		}

		// パスを記録
		this.lastCardPaths = newPaths;
		this.lastCardStateKeys = newStateKeys;

		// 古ぁE��ンダリングをクリーンアチE�E
		this.renderComponent.unload();
		this.renderComponent = new Component();
		this.renderComponent.load();

		this.listContainerEl.empty();

		// 画像サイズモードクラスを適用
		const imageSizeMode = this.plugin.data.settings.imageSizeMode;
		const sizeModes: ImageSizeMode[] = ['small', 'medium', 'large', 'full'];
		for (const mode of sizeModes) {
			this.listContainerEl.removeClass(`timeline-image-${mode}`);
		}
		this.listContainerEl.addClass(`timeline-image-${imageSizeMode}`);

		// プレビュー高さ制紁E��Eixed lines モード�Eみ�E�E
		if (this.plugin.data.settings.previewMode === 'lines') {
			this.listContainerEl.addClass('timeline-preview-clamped');
			const maxHeight = this.plugin.data.settings.previewLines * 40 + 16;
			this.listContainerEl.style.setProperty('--preview-max-height', `${maxHeight}px`);
		} else {
			this.listContainerEl.removeClass('timeline-preview-clamped');
			this.listContainerEl.style.removeProperty('--preview-max-height');
		}

		// ヘッダー
		const header = this.listContainerEl.createDiv({ cls: 'timeline-header' });

		const leftSection = header.createDiv({ cls: 'timeline-header-left' });
		const refreshBtn = leftSection.createEl('button', {
			cls: 'timeline-refresh-btn',
			text: '↻',
		});
		refreshBtn.addEventListener('click', () => { void this.refresh(); });

		// SRSモードでは統計を表示
		const settings = this.plugin.data.settings;
		if (settings.selectionMode === 'srs') {
			const statsEl = leftSection.createSpan({ cls: 'timeline-stats' });
			statsEl.createSpan({ cls: 'timeline-stat-new', text: `${this.newCount} new` });
			statsEl.createSpan({ text: ' · ' });
			statsEl.createSpan({ cls: 'timeline-stat-due', text: `${this.dueCount} due` });
		}

		const rightSection = header.createDiv({ cls: 'timeline-header-right' });

		// PC/モバイル刁E��替え�Eタン�E�ECのみ表示�E�E
		if (!Platform.isMobile) {
			const isMobileView = settings.mobileViewOnDesktop;
			const toggleBtn = rightSection.createEl('button', {
				cls: 'timeline-view-toggle-btn',
				text: isMobileView ? '📱' : '🖥�E�E,
				attr: { 'aria-label': isMobileView ? 'Switch to PC view' : 'Switch to Mobile view' },
			});
			toggleBtn.addEventListener('click', () => { void this.toggleMobileView(); });
		}

		// リスチEグリチE��刁E��替え�Eタン
		const viewMode = settings.viewMode;
		const viewModeBtn = rightSection.createEl('button', {
			cls: 'timeline-view-mode-btn',
			text: viewMode === 'list' ? '▤' : '▦',
			attr: { 'aria-label': viewMode === 'list' ? 'Switch to Grid view' : 'Switch to List view' },
		});
		viewModeBtn.addEventListener('click', () => { void this.toggleViewMode(); });

		// クイチE��ノ�Eト作�Eボックスを描画
		this.renderComposeBox();

		// フィルタバ�Eを描画
		this.renderFilterBar();

		// フィルタを適用
		this.applyFilters();

		// カード数表示�E�フィルタ後！E
		const countText = this.filteredCards.length === this.cards.length
			? `${this.cards.length} notes`
			: `${this.filteredCards.length} / ${this.cards.length} notes`;
		rightSection.createEl('span', {
			cls: 'timeline-count',
			text: countText,
		});

		// カードリスチEグリチE��
		const isGridMode = settings.viewMode === 'grid';
		const listCls = isGridMode ? `timeline-grid timeline-grid-cols-${settings.gridColumns}` : 'timeline-list';
		this.listEl = this.listContainerEl.createDiv({ cls: listCls });

		// カード要素配�EをリセチE��
		this.cardElements = [];

		// 無限スクロール対応：�E期表示数を決宁E
		const enableInfiniteScroll = settings.enableInfiniteScroll;
		const batchSize = settings.infiniteScrollBatchSize || 20;
		const initialCount = enableInfiniteScroll ? batchSize : this.filteredCards.length;
		this.displayedCount = Math.min(initialCount, this.filteredCards.length);

		// 初期カードをチャンク描画
		const { fragment, elements } = await this.renderCardsToFragment(
			this.filteredCards.slice(0, this.displayedCount), isGridMode
		);
		this.cardElements = elements;
		this.listEl.appendChild(fragment);

		// 下部フッター
		const footer = this.listContainerEl.createDiv({ cls: 'timeline-footer' });

		// 無限スクロール時�EローチE��ングインジケーター、そぁE��なければリフレチE��ュボタン
		if (enableInfiniteScroll && this.displayedCount < this.filteredCards.length) {
			const loadingEl = footer.createDiv({ cls: 'timeline-loading-indicator' });
			loadingEl.createSpan({ cls: 'timeline-loading-spinner' });
			loadingEl.createSpan({ cls: 'timeline-loading-text', text: 'Scroll for more...' });
		} else {
			const bottomRefreshBtn = footer.createEl('button', {
				cls: 'timeline-refresh-btn',
				text: '↻',
			});
			bottomRefreshBtn.addEventListener('click', () => { void this.refresh(); });
		}

		// フォーカスインチE��クスをリセチE��
		this.focusedIndex = -1;
	}

	/**
	 * 表示モードを刁E��替ぁE
	 */
	async toggleViewMode(): Promise<void> {
		const currentMode = this.plugin.data.settings.viewMode;
		this.plugin.data.settings.viewMode = currentMode === 'list' ? 'grid' : 'list';
		await this.plugin.syncAndSave();
		// 強制皁E��再描画するためにキャチE��ュをクリア
		this.lastCardPaths = [];
		this.lastCardStateKeys = [];
		await this.render();
	}

	/**
	 * クイチE��ノ�Eト作�Eボックスを描画
	 */
	private renderComposeBox(): void {
		const composeBox = this.listContainerEl.createDiv({ cls: 'timeline-compose-box' });

		// アバター風のアイコン
		const avatarEl = composeBox.createDiv({ cls: 'timeline-compose-avatar' });
		avatarEl.textContent = '📝';

		// 入力エリア
		const inputArea = composeBox.createDiv({ cls: 'timeline-compose-input-area' });

		const textarea = inputArea.createEl('textarea', {
			cls: 'timeline-compose-textarea',
			attr: {
				placeholder: "What's on your mind?",
				rows: '1',
			},
		});

		// アクションバ�E
		const actionsBar = inputArea.createDiv({ cls: 'timeline-compose-actions' });

		// 斁E��数カウンター
		const charCounter = actionsBar.createSpan({ cls: 'timeline-compose-char-counter' });
		charCounter.textContent = '0';

		textarea.addEventListener('input', () => {
			charCounter.textContent = String(textarea.value.length);
		});

		// 投稿ボタン
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

				// タイムラインをリフレチE��ュ
				void this.refresh();
			}).catch((error: unknown) => {
				console.error('Failed to create quick note:', error);
				postBtn.textContent = 'Post';
				postBtn.disabled = false;
			});
		});

		// Ctrl+Enter で投稿
		textarea.addEventListener('keydown', (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !postBtn.disabled) {
				e.preventDefault();
				postBtn.click();
			}
		});
	}

	/**
	 * クイチE��ノ�Eトを作�E
	 */
	private async createQuickNote(content: string): Promise<void> {
		const settings = this.plugin.data.settings;
		const template = settings.quickNoteTemplate || DEFAULT_QUICK_NOTE_TEMPLATE;

		// UID生�E�E�タイムスタンプ�Eース�E�E
		const now = new Date();
		const uid = now.getTime().toString(36);

		// 日付フォーマッチE
		const dateParts = now.toISOString().split('T');
		const dateStr = dateParts[0] ?? '';

		// タイトル生�E�E�最初�E行また�E最初�E50斁E��！E
		const lines = content.split('\n');
		const firstLine = lines[0] ?? '';
		const title = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;

		// チE��プレートを適用
		const noteContent = template
			.replace(/\{\{uid\}\}/g, uid)
			.replace(/\{\{title\}\}/g, title)
			.replace(/\{\{date\}\}/g, dateStr)
			.replace(/\{\{content\}\}/g, content);

		// ファイル名を生�E�E�タイムスタンチE+ タイトルの一部�E�E
		const safeTitle = title
			.replace(/[\\/:*?"<>|#^[\]]/g, '')
			.replace(/\s+/g, '_')
			.substring(0, 30);
		const fileName = `${dateStr}_${uid}_${safeTitle}.md`;

		// 保存�Eフォルダ
		const folder = settings.quickNoteFolder.trim();
		const filePath = folder ? `${folder}/${fileName}` : fileName;

		// フォルダが存在しなぁE��合�E作�E�E�ネストされたフォルダにも対応！E
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
							throw new Error(`フォルダの作�Eに失敗しました: ${currentPath}`);
						}
					}
				}
			}
		}

		// ノ�Eトを作�E
		await this.app.vault.create(filePath, noteContent);
	}

	/**
	 * フィルタバ�Eを描画
	 */
	private renderFilterBar(): void {
		const filterBar = this.listContainerEl.createDiv({ cls: 'timeline-filter-bar' });

		// 検索セクション
		const searchSection = filterBar.createDiv({ cls: 'timeline-filter-search' });
		const searchIcon = searchSection.createSpan({ cls: 'timeline-search-icon', text: '🔍' });
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

		// ファイルタイプフィルタ
		const typeFilters = filterBar.createDiv({ cls: 'timeline-filter-types' });
		const fileTypes: { type: string; icon: string; label: string }[] = [
			{ type: 'markdown', icon: '📝', label: 'Markdown' },
			{ type: 'text', icon: '📃', label: 'Text' },
			{ type: 'image', icon: '🖼�E�E, label: 'Image' },
			{ type: 'pdf', icon: '📄', label: 'PDF' },
			{ type: 'audio', icon: '🎵', label: 'Audio' },
			{ type: 'video', icon: '🎬', label: 'Video' },
			{ type: 'office', icon: '📊', label: 'Office' },
			{ type: 'ipynb', icon: '📓', label: 'Jupyter' },
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

		// タグフィルタ
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
	}

	/**
	 * 全カードからユニ�Eクなタグを収雁E
	 */
	private collectAllTags(): string[] {
		const tagCounts = new Map<string, number>();

		for (const card of this.cards) {
			for (const tag of card.tags) {
				tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
			}
		}

		// 出現回数でソートして返す
		return Array.from(tagCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([tag]) => tag);
	}

	/**
	 * 検索入力ハンドラー�E�デバウンス付き�E�E
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
	 * ファイルタイプフィルタをトグル
	 */
	private toggleFileTypeFilter(type: string): void {
		if (this.fileTypeFilters.has(type)) {
			// 最佁Eつは残す
			if (this.fileTypeFilters.size > 1) {
				this.fileTypeFilters.delete(type);
			}
		} else {
			this.fileTypeFilters.add(type);
		}
		void this.renderCardList();
	}

	/**
	 * タグフィルタをトグル
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
	 * フィルタを適用
	 */
	private applyFilters(): void {
		this.filteredCards = this.cards.filter(card => {
			// ファイルタイプフィルタ
			if (!this.fileTypeFilters.has(card.fileType)) {
				return false;
			}

			// タグフィルタ�E�選択タグがある場合、いずれかを含む�E�E
			if (this.selectedTags.size > 0) {
				const hasMatchingTag = card.tags.some(tag => this.selectedTags.has(tag));
				if (!hasMatchingTag) {
					return false;
				}
			}

			// 検索クエリフィルタ
			if (this.searchQuery.trim()) {
				const query = this.searchQuery.toLowerCase();
				const titleMatch = card.title.toLowerCase().includes(query);
				const previewMatch = card.preview.toLowerCase().includes(query);
				const tagMatch = card.tags.some(tag => tag.toLowerCase().includes(query));
				if (!titleMatch && !previewMatch && !tagMatch) {
					return false;
				}
			}

			return true;
		});
	}

	/**
	 * カードリスト�Eみを�E描画�E�フィルタ変更時！E
	 */
	private async renderCardList(): Promise<void> {
		if (!this.listContainerEl) {
			return;
		}
		// フィルタを適用
		this.applyFilters();

		// カード数表示を更新
		const countEl = this.listContainerEl.querySelector('.timeline-count');
		if (countEl) {
			const countText = this.filteredCards.length === this.cards.length
				? `${this.cards.length} notes`
				: `${this.filteredCards.length} / ${this.cards.length} notes`;
			countEl.textContent = countText;
		}

		// フィルタバ�EのUI状態を更新
		this.updateFilterBarUI();

		// カードリスチEグリチE��を�E描画
		const settings = this.plugin.data.settings;
		const isGridMode = settings.viewMode === 'grid';
		this.listEl = this.listContainerEl.querySelector('.timeline-list, .timeline-grid') as HTMLElement;
		if (!this.listEl) return;

		this.listEl.empty();
		this.cardElements = [];

		// 無限スクロール対応：�E期表示数を決宁E
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

		// フッターを更新
		this.updateFooter();
	}

	/**
	 * フィルタバ�EのUI状態を更新
	 */
	private updateFilterBarUI(): void {
		// ファイルタイプ�Eタンの状態更新
		const typeButtons = this.listContainerEl.querySelectorAll('.timeline-filter-type-btn');
		typeButtons.forEach(btn => {
			const type = btn.getAttribute('data-type');
			if (type) {
				btn.classList.toggle('is-active', this.fileTypeFilters.has(type));
			}
		});

		// タグチップ�E状態更新
		const tagChips = this.listContainerEl.querySelectorAll('.timeline-filter-tag-chip');
		tagChips.forEach(chip => {
			const tag = chip.textContent || '';
			chip.classList.toggle('is-selected', this.selectedTags.has(tag));
		});
	}

	/**
	 * カード要素を作�E
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

		// メインコンチE��チE��域
		const contentEl = cardEl.createDiv({ cls: 'timeline-card-content' });

		// Twitter風ヘッダー�E�フォルダ + タイムスタンプ！E
		const headerEl = contentEl.createDiv({ cls: 'timeline-card-header' });
		const folderPath = card.path.includes('/') ? card.path.substring(0, card.path.lastIndexOf('/')) : '';
		headerEl.createSpan({ cls: 'timeline-card-header-folder', text: `📁 ${folderPath || 'Root'}` });
		headerEl.createSpan({ cls: 'timeline-card-header-separator', text: ' · ' });
		if (card.lastReviewedAt) {
			const date = new Date(card.lastReviewedAt);
			headerEl.createSpan({ cls: 'timeline-card-header-time', text: this.formatRelativeDate(date) });
		} else {
			headerEl.createSpan({ cls: 'timeline-card-header-time', text: 'New' });
		}
		// ヘッダー用アクションボタン�E�Ewitterモードで表示�E�E
		{
			const hasDraft = this.plugin.hasCommentDraft(card.path);
			const headerCommentBtn = headerEl.createEl('button', {
				cls: `timeline-card-header-action timeline-card-header-comment ${hasDraft ? 'has-draft' : ''}`,
				attr: { 'aria-label': 'コメントを追加' },
			});
			headerCommentBtn.textContent = '💬';
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
				attr: { 'aria-label': '引用ノ�EチE },
			});
			headerQuoteBtn.textContent = '🔄';
			headerQuoteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					const modal = new QuoteNoteModal(this.app, this.plugin, file);
					modal.open();
				}
			});
		}

		// リンクボタン - Twitter ヘッダー用
		{
			const headerLinkBtn = headerEl.createEl('button', {
				cls: 'timeline-card-header-action timeline-card-header-link',
				attr: { 'aria-label': 'ノ�Eトをリンク' },
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
		// ブックマ�Eクアイコン�E��EチE��ー用�E�E
		const isBookmarked = this.isFileBookmarked(card.path);
		const headerBookmarkBtn = headerEl.createEl('button', {
			cls: `timeline-card-header-bookmark ${isBookmarked ? 'is-bookmarked' : ''}`,
		});
		headerBookmarkBtn.textContent = isBookmarked ? '☁E : '☁E;
		headerBookmarkBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.toggleBookmark(card.path).then(nowBookmarked => {
				headerBookmarkBtn.textContent = nowBookmarked ? '☁E : '☁E;
				headerBookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
				// 同期�E�タイトル行�Eブックマ�Eクボタンも更新
				const titleBookmarkBtn = cardEl.querySelector('.timeline-bookmark-btn') as HTMLElement;
				if (titleBookmarkBtn) {
					titleBookmarkBtn.textContent = nowBookmarked ? '☁E : '☁E;
					titleBookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
				}
			});
		});

		// タイトル衁E
		const titleRow = contentEl.createDiv({ cls: 'timeline-card-title-row' });

		// ファイルタイプバチE���E�非マ�Eクダウンの場合！E
		if (card.fileType !== 'markdown') {
			const typeIcon = this.getFileTypeIcon(card.fileType);
			titleRow.createSpan({
				cls: `timeline-badge timeline-badge-filetype timeline-badge-${card.fileType}`,
				text: typeIcon,
			});
		}

		const titleEl = titleRow.createDiv({ cls: 'timeline-card-title' });
		titleEl.textContent = card.title;

		// バッジ
		if (card.pinned) {
			titleRow.createSpan({ cls: 'timeline-badge timeline-badge-pin', text: '📌' });
		}
		if (card.isNew) {
			titleRow.createSpan({ cls: 'timeline-badge timeline-badge-new', text: 'NEW' });
		}
		if (card.isDue) {
			titleRow.createSpan({ cls: 'timeline-badge timeline-badge-due', text: 'DUE' });
		}

		// コメント�Eタン - Classic用
		{
			const hasDraft = this.plugin.hasCommentDraft(card.path);
			const commentBtn = titleRow.createEl('button', {
				cls: `timeline-comment-btn ${hasDraft ? 'has-draft' : ''}`,
				attr: { 'aria-label': 'コメントを追加' },
			});
			commentBtn.textContent = '💬';
			commentBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					const modal = new CommentModal(this.app, this.plugin, file);
					modal.open();
				}
			});
		}

		// 引用ノ�Eト�Eタン - Classic用
		{
			const hasQuoteNoteDraft = this.plugin.hasQuoteNoteDraft(card.path);
			const quoteNoteBtn = titleRow.createEl('button', {
				cls: `timeline-quote-note-btn ${hasQuoteNoteDraft ? 'has-draft' : ''}`,
				attr: { 'aria-label': '引用ノ�EチE },
			});
			quoteNoteBtn.textContent = '🔄';
			quoteNoteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					const modal = new QuoteNoteModal(this.app, this.plugin, file);
					modal.open();
				}
			});
		}

		// リンクボタン - Classic用
		{
			const linkBtn = titleRow.createEl('button', {
				cls: 'timeline-link-note-btn',
				attr: { 'aria-label': 'ノ�Eトをリンク' },
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

		// ブックマ�Eクボタン - Classic用
		const bookmarkBtn = titleRow.createEl('button', {
			cls: `timeline-bookmark-btn ${isBookmarked ? 'is-bookmarked' : ''}`,
			attr: { 'aria-label': isBookmarked ? 'Remove bookmark' : 'Add bookmark' },
		});
		bookmarkBtn.textContent = isBookmarked ? '☁E : '☁E;
		bookmarkBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.toggleBookmark(card.path).then(nowBookmarked => {
				bookmarkBtn.textContent = nowBookmarked ? '☁E : '☁E;
				bookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
				bookmarkBtn.setAttribute('aria-label', nowBookmarked ? 'Remove bookmark' : 'Add bookmark');
				// 同期�E��EチE��ーのブックマ�Eクボタンも更新
				headerBookmarkBtn.textContent = nowBookmarked ? '☁E : '☁E;
				headerBookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
			});
		});

		// プレビュー
		const previewEl = contentEl.createDiv({ cls: 'timeline-card-preview' });
		if (card.fileType === 'markdown' || card.fileType === 'ipynb') {
			// 脚注記法をエスケープ（�Eレビューでは参�E先がなぁE��めE��E
			const previewText = card.preview.replace(/\[\^/g, '\\[^');
			// マ�Eクダウンをレンダリング
			await MarkdownRenderer.render(
				this.app,
				previewText,
				previewEl,
				card.path,
				this.renderComponent
			);
			// ipynbの場合�Eクラスを追加
			if (card.fileType === 'ipynb') {
				previewEl.addClass('timeline-card-preview-ipynb');
			}
		} else {
			// 非�EークダウンはプレーンチE��スト表示
			previewEl.addClass('timeline-card-preview-file');
			previewEl.createSpan({
				cls: 'timeline-file-preview-text',
				text: card.preview,
			});
			// 拡張子バチE��
			previewEl.createSpan({
				cls: 'timeline-file-extension',
				text: `.${card.extension}`,
			});
		}

		// サムネイル画僁E/ PDF埋め込み
		if (card.firstImagePath) {
			if (card.fileType === 'pdf') {
				const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-pdf-embed' });
				await this.renderPdfCardPreview(thumbnailEl, card, false);
			} else if (card.firstImagePath.startsWith('data:')) {
				// Base64 data URI�E�Epynbの出力画像など�E�E				const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-thumbnail-ipynb' });
				thumbnailEl.createEl('img', {
					attr: { src: card.firstImagePath, alt: 'notebook output' },
				});
			} else {
				// 画像サムネイル
				const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail' });
				if (card.firstImagePath.startsWith('http://') || card.firstImagePath.startsWith('https://')) {
					// 外部URL
					thumbnailEl.createEl('img', {
						attr: { src: card.firstImagePath, alt: 'thumbnail' },
					});
				} else {
					// 冁E��ファイル
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

		// リンクリスチE
		if (card.outgoingLinks.length > 0 || card.backlinks.length > 0) {
			const linksEl = contentEl.createDiv({ cls: 'timeline-card-links' });

			// アウトゴーイングリンク
			if (card.outgoingLinks.length > 0) {
				const outgoingEl = linksEl.createDiv({ cls: 'timeline-links-section' });
				outgoingEl.createSpan({ cls: 'timeline-links-label', text: 'ↁELinks' });
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

			// バックリンク
			if (card.backlinks.length > 0) {
				const backlinksEl = linksEl.createDiv({ cls: 'timeline-links-section' });
				backlinksEl.createSpan({ cls: 'timeline-links-label', text: 'ↁEBacklinks' });
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

		// メタ惁E���E�Elassic用�E�E
		if (this.plugin.data.settings.showMeta) {
			const metaEl = contentEl.createDiv({ cls: 'timeline-card-meta' });

			if (card.lastReviewedAt) {
				const date = new Date(card.lastReviewedAt);
				const dateStr = this.formatRelativeDate(date);
				metaEl.createSpan({ text: `👁 ${dateStr}` });
			}

			if (card.reviewCount > 0) {
				metaEl.createSpan({ text: `ÁE{card.reviewCount}` });
			}

			if (card.interval > 0) {
				metaEl.createSpan({ cls: 'timeline-card-interval', text: `📅 ${card.interval}d` });
			}

			if (card.tags.length > 0) {
				const tagsStr = card.tags.slice(0, 3).join(' ');
				metaEl.createSpan({ cls: 'timeline-card-tags', text: tagsStr });
			}
		}

		// Twitter風アクションバ�E
		const actionsEl = contentEl.createDiv({ cls: 'timeline-card-actions' });

		// コメントアクション
		{
			const hasDraft = this.plugin.hasCommentDraft(card.path);
			const commentAction = actionsEl.createEl('button', {
				cls: `timeline-action-btn timeline-action-comment ${hasDraft ? 'has-draft' : ''}`,
			});
			commentAction.createSpan({ text: '💬' });
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

		// 引用アクション
		{
			const hasQuoteNoteDraft = this.plugin.hasQuoteNoteDraft(card.path);
			const quoteAction = actionsEl.createEl('button', {
				cls: `timeline-action-btn timeline-action-quote ${hasQuoteNoteDraft ? 'has-draft' : ''}`,
			});
			quoteAction.createSpan({ text: '🔄' });
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

		// リンクアクション
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

		// レビュー数アクション
		if (card.reviewCount > 0) {
			const reviewAction = actionsEl.createDiv({ cls: 'timeline-action-btn timeline-action-reviews' });
			reviewAction.createSpan({ text: '⭁E });
			reviewAction.createSpan({ cls: 'timeline-action-label', text: `${card.reviewCount} reviews` });
		}

		// タグ表示�E�Ewitter風�E�E
		if (card.tags.length > 0) {
			const tagsAction = actionsEl.createDiv({ cls: 'timeline-action-tags' });
			for (const tag of card.tags.slice(0, 2)) {
				tagsAction.createSpan({ cls: 'timeline-action-tag', text: tag });
			}
			if (card.tags.length > 2) {
				tagsAction.createSpan({ cls: 'timeline-action-tag-more', text: `+${card.tags.length - 2}` });
			}
		}

		// クリチE��/タチE�Eでノ�Eトを開く
		contentEl.addEventListener('click', () => {
			void this.openNote(card);
		});

		// 右クリチE��でコンチE��ストメニュー
		cardEl.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const file = this.app.vault.getAbstractFileByPath(card.path);
			if (file && file instanceof TFile) {
				const menu = new Menu();

				// Obsidianの標準ファイルメニューをトリガー
				this.app.workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu', null);

				menu.showAtMouseEvent(e);
			}
		});

		// 難易度ボタン�E�ERSモードまた�E設定で有効時！E
		const settings = this.plugin.data.settings;
		if (settings.showDifficultyButtons) {
			const buttonsEl = cardEl.createDiv({ cls: 'timeline-difficulty-buttons' });
			this.createDifficultyButtons(buttonsEl, card);
		} else {
			// 既読ショートカチE���E�右端をタチE�E�E�E
			const markReadBtn = cardEl.createDiv({ cls: 'timeline-mark-read' });
			markReadBtn.textContent = '✁E;
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
	 * グリチE��カード要素を作�E�E�画像中忁E�E表示�E�E
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

		// サムネイル/プレビュー領域
		const thumbnailEl = cardEl.createDiv({ cls: 'timeline-grid-card-thumbnail' });
		if (card.firstImagePath) {
			if (card.fileType === 'pdf') {
				thumbnailEl.addClass('timeline-grid-card-pdf-embed');
				await this.renderPdfCardPreview(thumbnailEl, card, true);
			} else if (card.firstImagePath.startsWith('data:')) {
				// Base64 data URI�E�Epynbの出力画像など�E�E				thumbnailEl.addClass('timeline-grid-card-thumbnail-ipynb');
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
			// 画像がなぁE��合�Eファイルタイプアイコンを表示
			const icon = this.getFileTypeIcon(card.fileType);
			thumbnailEl.createDiv({
				cls: 'timeline-grid-card-icon',
				text: icon,
			});
		}

		// ファイルタイプバチE��
		if (card.fileType !== 'markdown') {
			const typeIcon = this.getFileTypeIcon(card.fileType);
			thumbnailEl.createSpan({
				cls: `timeline-grid-badge timeline-badge-${card.fileType}`,
				text: typeIcon,
			});
		}

		// オーバ�Eレイ�E��Eバ�E時に表示�E�E
		const overlayEl = thumbnailEl.createDiv({ cls: 'timeline-grid-card-overlay' });

		// ブックマ�Eクボタン
		const isBookmarked = this.isFileBookmarked(card.path);
		const bookmarkBtn = overlayEl.createEl('button', {
			cls: `timeline-grid-bookmark-btn ${isBookmarked ? 'is-bookmarked' : ''}`,
		});
		bookmarkBtn.textContent = isBookmarked ? '☁E : '☁E;
		bookmarkBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.toggleBookmark(card.path).then(nowBookmarked => {
				bookmarkBtn.textContent = nowBookmarked ? '☁E : '☁E;
				bookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
			});
		});

		// タイトル
		const infoEl = cardEl.createDiv({ cls: 'timeline-grid-card-info' });
		const titleEl = infoEl.createDiv({ cls: 'timeline-grid-card-title' });
		titleEl.textContent = card.title;

		// バッジ
		if (card.pinned) {
			titleEl.createSpan({ cls: 'timeline-badge timeline-badge-pin', text: '📌' });
		}
		if (card.isNew) {
			titleEl.createSpan({ cls: 'timeline-badge timeline-badge-new', text: 'NEW' });
		}
		if (card.isDue) {
			titleEl.createSpan({ cls: 'timeline-badge timeline-badge-due', text: 'DUE' });
		}

		// タグ�E�最大2つまで表示�E�E
		if (card.tags.length > 0) {
			const tagsEl = infoEl.createDiv({ cls: 'timeline-grid-card-tags' });
			for (const tag of card.tags.slice(0, 2)) {
				tagsEl.createSpan({ cls: 'timeline-grid-card-tag', text: tag });
			}
			if (card.tags.length > 2) {
				tagsEl.createSpan({ cls: 'timeline-grid-card-tag-more', text: `+${card.tags.length - 2}` });
			}
		}

		// クリチE��でノ�Eトを開く
		cardEl.addEventListener('click', () => {
			void this.openNote(card);
		});

		// 右クリチE��でコンチE��ストメニュー
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
	 * PDFオープンボタンを作�E
	 */
	private createPdfOpenButton(container: HTMLElement, card: TimelineCard): void {
		const openBtn = container.createEl('button', {
			cls: 'timeline-pdf-open-btn',
			text: '📄 Open',
		});
		openBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.openNote(card);
		});
	}

	/**
	 * PDFカード�Eレビューを描画�E�Eesktop: 埋め込み、Mobile: フォールバック�E�E	 */
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
	 * 埋め込みPDF要素の描画可否を確誁E	 */
	private async ensurePdfRendered(embedHost: HTMLElement): Promise<boolean> {
		await this.waitForAnimationFrame();
		await this.waitForAnimationFrame();

		const pdfEl = this.findRenderedPdfElement(embedHost);
		return !!pdfEl && this.hasVisibleSize(pdfEl);
	}

	/**
	 * 埋め込みPDF要素を検�E
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
	 * 要素が可視サイズを持ってぁE��か判宁E	 */
	private hasVisibleSize(element: HTMLElement): boolean {
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	}

	/**
	 * PDFの初期ズームめE00%に固宁E	 */
	private applyInitialPdfZoom(container: HTMLElement): void {
		const zoomSelectors = [
			'embed[type="application/pdf"][src]',
			'object[type="application/pdf"][data]',
			'iframe[src]',
		];

		for (const selector of zoomSelectors) {
			for (const target of container.querySelectorAll(selector)) {
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
	 * URLフラグメントに zoom=100 を適用
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
	 * PDFプレビューのフォールバックを描画
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
		fallbackEl.createDiv({ cls: 'timeline-pdf-fallback-icon', text: '📄' });
		const fileName = card.firstImagePath?.split('/').pop() ?? 'PDF';
		fallbackEl.createDiv({ cls: 'timeline-pdf-fallback-name', text: fileName });
		fallbackEl.createDiv({ cls: 'timeline-pdf-fallback-hint', text: message });

		this.createPdfOpenButton(container, card);
	}

	/**
	 * 次フレームまで征E��E	 */
	private waitForAnimationFrame(): Promise<void> {
		return new Promise((resolve) => {
			window.requestAnimationFrame(() => resolve());
		});
	}

	/**
	 * 難易度ボタンを作�E
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
	 * 難易度ボタンをUndoボタンに置揁E
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
					// レビュー済みクラスを解除
					container.closest('.timeline-card')?.removeClass('timeline-card-reviewed');
					// Undoクラスを除去し、E��易度ボタンを�E描画
					container.removeClass('timeline-difficulty-undo');
					container.empty();
					this.createDifficultyButtons(container, card);
				}
			});
		});
	}

	/**
	 * ノ�Eトを開く
	 */
	private async openNote(card: TimelineCard): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (!file || !(file instanceof TFile)) return;

		if (Platform.isMobile) {
			// Mobile: 新しいleafで開く
			await this.app.workspace.getLeaf().openFile(file);
			return;
		}

		// Desktop: 直前にアクチE��ブだったleafの隣に新しいタブとして開く
		let targetLeaf: WorkspaceLeaf;

		if (this.previousActiveLeaf) {
			// 直前�Eleafと同じタブグループに新しいタブを作�E
			const parent = this.previousActiveLeaf.parent;
			if (parent) {
				// parent は WorkspaceTabs | WorkspaceMobileDrawer だぁEcreateLeafInParent は WorkspaceSplit を期征E��る。実行時は動作するため型アサーションで対忁E
				targetLeaf = this.app.workspace.createLeafInParent(parent as unknown as WorkspaceSplit, -1);
			} else {
				targetLeaf = this.app.workspace.getLeaf('tab');
			}
		} else {
			// 直前�EleafがなぁE��合�E、タイムライン以外�Eleafを探して同じタブグループに開く
			const adjacentLeaf = this.findAdjacentLeaf(this.leaf);
			if (adjacentLeaf) {
				const parent = adjacentLeaf.parent;
				if (parent) {
					// parent は WorkspaceTabs | WorkspaceMobileDrawer だぁEcreateLeafInParent は WorkspaceSplit を期征E��る。実行時は動作するため型アサーションで対忁E
					targetLeaf = this.app.workspace.createLeafInParent(parent as unknown as WorkspaceSplit, -1);
				} else {
					targetLeaf = this.app.workspace.getLeaf('tab');
				}
			} else {
				// 隣のleafがなければ、右に刁E��して開く
				targetLeaf = this.app.workspace.getLeaf('split');
			}
		}

		await targetLeaf.openFile(file);

		// フォーカスをノートに移勁E
		this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
	}

	/**
	 * タイムライン以外�E隣接するleafを探ぁE
	 */
	private findAdjacentLeaf(timelineLeaf: WorkspaceLeaf): WorkspaceLeaf | null {
		let targetLeaf: WorkspaceLeaf | null = null;
		let foundMarkdownLeaf: WorkspaceLeaf | null = null;

		this.app.workspace.iterateAllLeaves((leaf) => {
			// タイムライン自身は除夁E
			if (leaf === timelineLeaf) return;

			// タイムラインビューは除夁E
			if (leaf.view.getViewType() === TIMELINE_VIEW_TYPE) return;

			// Markdownビュー�E�ノート）を優允E
			if (leaf.view.getViewType() === 'markdown') {
				foundMarkdownLeaf = leaf;
			}

			// 空のビューまた�Eそ�E他�Eビュー
			if (!targetLeaf) {
				targetLeaf = leaf;
			}
		});

		// Markdownビューがあれ�Eそれを優允E
		return foundMarkdownLeaf || targetLeaf;
	}

	/**
	 * 相対日付フォーマッチE
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
	 * ファイルタイプアイコンを取征E
	 */
	private getFileTypeIcon(fileType: string): string {
		switch (fileType) {
			case 'text': return '📃';
			case 'image': return '🖼�E�E;
			case 'pdf': return '📄';
			case 'audio': return '🎵';
			case 'video': return '🎬';
			case 'office': return '📊';
			case 'ipynb': return '📓';
			default: return '📁';
		}
	}

	/**
	 * ファイルがブチE��マ�EクされてぁE��か確認（キャチE��ュ使用�E�E
	 */
	private isFileBookmarked(path: string): boolean {
		// キャチE��ュがあれ�E使用�E�E(1)ルチE��アチE�E�E�E
		if (this.cachedBookmarkedPaths) {
			return this.cachedBookmarkedPaths.has(path);
		}

		// キャチE��ュがなぁE��合�EdataLayerから取征E
		this.cachedBookmarkedPaths = getBookmarkedPaths(this.app);
		return this.cachedBookmarkedPaths.has(path);
	}

	/**
	 * ブックマ�Eクをトグル
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
			// 既にブックマ�EクされてぁE��場合�E削除
			instance.removeItem(existing);
			result = false;
		} else {
			// ブックマ�Eクを追加
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file && file instanceof TFile) {
				instance.addItem({ type: 'file', path: path, title: '' });
				result = true;
			} else {
				result = false;
			}
		}

		// キャチE��ュをクリア
		clearBookmarkCache();
		this.cachedBookmarkedPaths = null;

		return result;
	}

	/**
	 * スクロールハンドラー�E�無限スクロール用�E�E
	 */
	private handleScroll(): void {
		if (!this.plugin.data.settings.enableInfiniteScroll) return;
		if (this.isLoadingMore) return;
		if (this.displayedCount >= this.filteredCards.length) return;

		const container = this.listContainerEl;
		const scrollBottom = container.scrollTop + container.clientHeight;
		const threshold = container.scrollHeight - 200; // 200px手前でロード開姁E

		if (scrollBottom >= threshold) {
			void this.loadMoreCards();
		}
	}

	/**
	 * 追加カードをロード（無限スクロール用�E�E
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

		// 追加カードをチャンク描画
		const cardsToLoad = this.filteredCards.slice(startIndex, endIndex).filter((c): c is TimelineCard => !!c);
		const { fragment: moreFragment, elements: moreElements } = await this.renderCardsToFragment(
			cardsToLoad, isGridMode
		);
		this.cardElements.push(...moreElements);
		this.listEl.appendChild(moreFragment);

		this.displayedCount = endIndex;
		this.isLoadingMore = false;

		// フッターを更新
		this.updateFooter();
	}

	/**
	 * タチE��開始ハンドラー�E��EルトゥリフレチE��ュ用�E�E
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
	 * タチE��移動ハンドラー�E��EルトゥリフレチE��ュ用�E�E
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
			// 引っ張り中 - チE��ォルト�Eスクロールを防止
			e.preventDefault();

			// インジケーターを表示・更新
			this.showPullIndicator(pullDistance, threshold);

			if (pullDistance >= threshold) {
				this.pullToRefreshTriggered = true;
			} else {
				this.pullToRefreshTriggered = false;
			}
		}
	}

	/**
	 * タチE��終亁E��ンドラー�E��EルトゥリフレチE��ュ用�E�E
	 */
	private handleTouchEnd(_e: TouchEvent): void {
		if (this.pullToRefreshTriggered) {
			this.pullToRefreshTriggered = false;
			this.showPullIndicator(0, 80, true);  // ローチE��ング状態を表示
			void this.refresh().then(() => {
				this.hidePullIndicator();
			});
		} else {
			this.hidePullIndicator();
		}
		this.pullToRefreshStartY = 0;
	}

	/**
	 * プルインジケーターを表示
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
			this.pullIndicatorEl.createSpan({ text: 'ↁE });
			this.pullIndicatorEl.createSpan({ text: 'Release to refresh' });
			this.pullIndicatorEl.classList.add('is-ready');
			this.pullIndicatorEl.classList.remove('is-loading');
		} else {
			this.pullIndicatorEl.createSpan({ text: 'ↁE });
			this.pullIndicatorEl.createSpan({ text: 'Pull to refresh' });
			this.pullIndicatorEl.classList.remove('is-ready', 'is-loading');
		}
	}

	/**
	 * プルインジケーターを非表示
	 */
	private hidePullIndicator(): void {
		if (this.pullIndicatorEl) {
			this.pullIndicatorEl.remove();
			this.pullIndicatorEl = null;
		}
	}

	/**
	 * フッターを更新�E�無限スクロール用�E�E
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
			});
			bottomRefreshBtn.addEventListener('click', () => { void this.refresh(); });
		}
	}

	/**
	 * キーボ�EドショートカチE��ハンドラー
	 */
	private handleKeydown(e: KeyboardEvent): void {
		// 入力フィールドにフォーカスがある場合�E無要E
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
	 * 次のカードにフォーカス
	 */
	private focusNextCard(): void {
		if (this.cardElements.length === 0) return;

		const newIndex = this.focusedIndex < this.cardElements.length - 1
			? this.focusedIndex + 1
			: 0;
		this.setFocusedIndex(newIndex);
	}

	/**
	 * 前�Eカードにフォーカス
	 */
	private focusPrevCard(): void {
		if (this.cardElements.length === 0) return;

		const newIndex = this.focusedIndex > 0
			? this.focusedIndex - 1
			: this.cardElements.length - 1;
		this.setFocusedIndex(newIndex);
	}

	/**
	 * フォーカスインチE��クスを設宁E
	 */
	private setFocusedIndex(index: number): void {
		// 前�Eフォーカスを解除
		if (this.focusedIndex >= 0 && this.focusedIndex < this.cardElements.length) {
			const prevEl = this.cardElements[this.focusedIndex];
			if (prevEl) {
				prevEl.removeClass('timeline-card-focused');
			}
		}

		// 新しいフォーカスを設宁E
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
	 * フォーカスをクリア
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
	 * フォーカス中のカードを開く
	 */
	private async openFocusedCard(): Promise<void> {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;
		const card = this.filteredCards[this.focusedIndex];
		if (card) {
			await this.openNote(card);
		}
	}

	/**
	 * フォーカス中のカードに難易度評価
	 */
	private async rateFocusedCard(rating: DifficultyRating): Promise<void> {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;

		const card = this.filteredCards[this.focusedIndex];
		if (!card) return;

		await this.plugin.rateCard(card.path, rating);
		const cardEl = this.cardElements[this.focusedIndex];
		if (cardEl) {
			cardEl.addClass('timeline-card-reviewed');
			// Undoボタンを表示
			const buttonsEl = cardEl.querySelector('.timeline-difficulty-buttons') as HTMLElement;
			if (buttonsEl) {
				this.replaceWithUndoButton(buttonsEl, card);
			}
		}

		// 次のカードにフォーカス
		if (this.focusedIndex < this.cardElements.length - 1) {
			this.setFocusedIndex(this.focusedIndex + 1);
		}
	}

	/**
	 * フォーカス中のカード�E評価を取り消し
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
			// 難易度ボタンを�E描画
			const buttonsEl = cardEl.querySelector('.timeline-difficulty-buttons') as HTMLElement;
			if (buttonsEl) {
				buttonsEl.removeClass('timeline-difficulty-undo');
				buttonsEl.empty();
				this.createDifficultyButtons(buttonsEl, card);
			}
		}
	}

	/**
	 * フォーカス中のカード�Eブックマ�Eクをトグル
	 */
	private async toggleFocusedBookmark(): Promise<void> {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;

		const card = this.filteredCards[this.focusedIndex];
		if (!card) return;

		const nowBookmarked = await this.toggleBookmark(card.path);

		// ブックマ�EクボタンのUIを更新
		const cardEl = this.cardElements[this.focusedIndex];
		if (cardEl) {
			const bookmarkBtn = cardEl.querySelector('.timeline-bookmark-btn') as HTMLElement;
			if (bookmarkBtn) {
				bookmarkBtn.textContent = nowBookmarked ? '☁E : '☁E;
				bookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
			}
		}
	}

	/**
	 * フォーカス中のカード�Eコメントモーダルを開ぁE
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
	 * フォーカス中のカード�E引用ノ�Eトモーダルを開ぁE
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
	 * フォーカス中のカード�Eリンクノ�Eトモーダルを開ぁE
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






