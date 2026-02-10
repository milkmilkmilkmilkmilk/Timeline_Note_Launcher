// Timeline Note Launcher - Timeline View
import { ItemView, WorkspaceLeaf, WorkspaceSplit, Platform, TFile, MarkdownRenderer, Component, Menu, Modal, setIcon } from 'obsidian';
import { TimelineCard, DifficultyRating, ColorTheme, ImageSizeMode, UITheme, DEFAULT_QUICK_NOTE_TEMPLATE, FilterPreset } from './types';
import { getNextIntervals, getBookmarkedPaths, getBookmarksPlugin, clearBookmarkCache } from './dataLayer';
import { CommentModal } from './commentModal';
import { QuoteNoteModal } from './quoteNoteModal';
import { LinkNoteModal } from './linkNoteModal';
import type TimelineNoteLauncherPlugin from './main';
import { arraysEqual, buildCardStateKey, formatPropertyValue, formatRelativeDate, getFileTypeIcon } from './timelineViewUtils';

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
	// フィルタ状態
	private searchQuery: string = '';
	private fileTypeFilters: Set<string> = new Set(['markdown', 'text', 'image', 'pdf', 'audio', 'video', 'office', 'ipynb', 'excalidraw', 'canvas', 'other']);
	private selectedTags: Set<string> = new Set();
	private searchDebounceTimer: number | null = null;
	// 日付範囲フィルタ
	private dateFilterStart: string = '';  // YYYY-MM-DD形式
	private dateFilterEnd: string = '';    // YYYY-MM-DD形式
	// 直前にアクティブだったleaf（タイムライン以外）
	private previousActiveLeaf: WorkspaceLeaf | null = null;
	// 差分レンダリング用：前回のカードパス
	private lastCardPaths: string[] = [];
	// 差分レンダリング用：前回のカード状態キー
	private lastCardStateKeys: string[] = [];
	// ブックマークパスのキャッシュ
	private cachedBookmarkedPaths: Set<string> | null = null;
	// タグキャッシュ（refresh()時に更新）
	private cachedAllTags: string[] = [];
	private isTagsCollapsed: boolean = false;
	// 無限スクロール用
	private displayedCount: number = 0;
	private isLoadingMore: boolean = false;
	private scrollHandler: () => void;
	private listEl: HTMLElement | null = null;
	// 遅延レンダリング用：DOM接続後に処理するコンテナ→カードデータの対応（PDF/Excalidraw）
	private pendingEmbeds: Map<HTMLElement, { card: TimelineCard; isGridMode: boolean; embedType: 'pdf' | 'excalidraw' | 'canvas' }> = new Map();
	// プルトゥリフレッシュ用
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
		// プルトゥリフレッシュ用
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

		// キーボードショートカット登録
		this.listContainerEl.tabIndex = 0;
		this.listContainerEl.addEventListener('keydown', this.keydownHandler);

		// 無限スクロール用スクロールイベント登録
		this.listContainerEl.addEventListener('scroll', this.scrollHandler);

		// プルトゥリフレッシュ用タッチイベント登録（モバイルのみ）
		if (Platform.isMobile) {
			this.listContainerEl.addEventListener('touchstart', this.touchStartHandler, { passive: true });
			this.listContainerEl.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
			this.listContainerEl.addEventListener('touchend', this.touchEndHandler, { passive: true });
		}

		// アクティブleafの変更を監視して、タイムライン以外のleafを記録
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf && leaf !== this.leaf && leaf.view.getViewType() !== TIMELINE_VIEW_TYPE) {
					this.previousActiveLeaf = leaf;
				}
			})
		);

		// 現在アクティブなleafを初期値として保存（タイムライン以外）
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
		// 実際のモバイルデバイス、またはPCでモバイルモードが有効な場合
		const isMobileView = Platform.isMobile || this.plugin.data.settings.mobileViewOnDesktop;
		if (isMobileView) {
			this.listContainerEl.addClass('timeline-mobile');
		} else {
			this.listContainerEl.removeClass('timeline-mobile');
		}
	}

	/**
	 * カラーテーマの更新
	 */
	private updateColorTheme(): void {
		const theme = this.plugin.data.settings.colorTheme;
		const themes: ColorTheme[] = ['default', 'blue', 'green', 'purple', 'orange', 'pink', 'red', 'cyan', 'yellow'];

		// 既存のテーマクラスを削除
		for (const t of themes) {
			this.listContainerEl.removeClass(`timeline-theme-${t}`);
		}

		// 新しいテーマクラスを追加
		this.listContainerEl.addClass(`timeline-theme-${theme}`);
	}

	/**
	 * UIテーマの更新
	 */
	private updateUITheme(): void {
		const uiTheme = this.plugin.data.settings.uiTheme;
		const themes: UITheme[] = ['classic', 'twitter'];

		// 既存のUIテーマクラスを削除
		for (const t of themes) {
			this.listContainerEl.removeClass(`timeline-ui-${t}`);
		}

		// 新しいUIテーマクラスを追加
		this.listContainerEl.addClass(`timeline-ui-${uiTheme}`);
	}

	/**
	 * モバイルモードを切り替え（PCのみ）
	 */
	async toggleMobileView(): Promise<void> {
		if (Platform.isMobile) return;
		this.plugin.data.settings.mobileViewOnDesktop = !this.plugin.data.settings.mobileViewOnDesktop;
		void this.plugin.syncAndSave();
		this.updateMobileClass();
		// 強制的に再描画するためにキャッシュをクリア
		this.lastCardPaths = [];
		this.lastCardStateKeys = [];
		await this.render();
	}

	onClose(): Promise<void> {
		// スクロール位置を保存
		this.scrollPosition = this.listContainerEl.scrollTop;
		// 検索デバウンスタイマーを解除
		if (this.searchDebounceTimer !== null) {
			window.clearTimeout(this.searchDebounceTimer);
			this.searchDebounceTimer = null;
		}
		// レンダリングコンポーネントをアンロード
		this.renderComponent.unload();
		// キーボードリスナーを解除
		this.listContainerEl.removeEventListener('keydown', this.keydownHandler);
		// スクロールリスナーを解除
		this.listContainerEl.removeEventListener('scroll', this.scrollHandler);
		// タッチリスナーを解除
		if (Platform.isMobile) {
			this.listContainerEl.removeEventListener('touchstart', this.touchStartHandler);
			this.listContainerEl.removeEventListener('touchmove', this.touchMoveHandler);
			this.listContainerEl.removeEventListener('touchend', this.touchEndHandler);
		}
		return Promise.resolve();
	}

	/**
	 * タイムラインを更新
	 */
	async refresh(): Promise<void> {
		// スクロール位置を保存
		this.scrollPosition = this.listContainerEl?.scrollTop ?? 0;

		// 表示設定を更新（設定との同期）
		this.updateMobileClass();
		this.updateColorTheme();
		this.updateUITheme();

		// ブックマークキャッシュを更新
		this.cachedBookmarkedPaths = getBookmarkedPaths(this.app);

		// カードを取得
		const result = await this.plugin.getTimelineCards();
		this.cards = result.cards;
		this.cachedAllTags = this.collectAllTags();
		this.newCount = result.newCount;
		this.dueCount = result.dueCount;

		// 描画
		await this.render();

		// スクロール位置を復元
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
		// カードパスの変更を検知
		const newPaths = this.cards.map(c => c.path);
		const newStateKeys = this.cards.map(card => buildCardStateKey(card));
		const pathsChanged = !arraysEqual(this.lastCardPaths, newPaths);
		const stateChanged = !arraysEqual(this.lastCardStateKeys, newStateKeys);

		// パスやカード内容が変わっていない場合は完全再構築をスキップ（ヘッダーの統計のみ更新）
		if (!pathsChanged && !stateChanged && this.listContainerEl.hasChildNodes()) {
			// 統計のみ更新
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

		// 古いレンダリングをクリーンアップ
		this.pendingEmbeds.clear();
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

		// プレビュー高さ制限（fixed lines モードのみ）
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
			attr: { 'aria-label': 'Refresh timeline' },
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

		// PC/モバイル切り替えボタン（PCのみ表示）
		if (!Platform.isMobile) {
			const isMobileView = settings.mobileViewOnDesktop;
			const toggleBtn = rightSection.createEl('button', {
				cls: 'timeline-view-toggle-btn',
				text: isMobileView ? 'Desktop' : 'Mobile',
				attr: { 'aria-label': isMobileView ? 'Switch to PC view' : 'Switch to Mobile view' },
			});
			toggleBtn.addEventListener('click', () => { void this.toggleMobileView(); });
		}

		// リスト/グリッド切り替えボタン
		const viewMode = settings.viewMode;
		const viewModeBtn = rightSection.createEl('button', {
			cls: 'timeline-view-mode-btn',
			text: viewMode === 'list' ? '☰' : '⊞',
			attr: { 'aria-label': viewMode === 'list' ? 'Switch to Grid view' : 'Switch to List view' },
		});
		viewModeBtn.addEventListener('click', () => { void this.toggleViewMode(); });

		// クイックノート作成ボックスを描画
		this.renderComposeBox();

		// フィルタバーを描画
		this.renderFilterBar();

		// フィルタを適用
		this.applyFilters();

		// カード数表示（フィルタ後）
		const countText = this.filteredCards.length === this.cards.length
			? `${this.cards.length} notes`
			: `${this.filteredCards.length} / ${this.cards.length} notes`;
		rightSection.createEl('span', {
			cls: 'timeline-count',
			text: countText,
		});

		// カードリスト/グリッド
		const isGridMode = settings.viewMode === 'grid';
		const listCls = isGridMode ? `timeline-grid timeline-grid-cols-${settings.gridColumns}` : 'timeline-list';
		this.listEl = this.listContainerEl.createDiv({ cls: listCls });

		// カード要素配列をリセット
		this.cardElements = [];

		// 無限スクロール対応：初期表示数を決定
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
		// DOM接続後にPDF埋め込みを実行
		await this.activatePendingEmbeds();

		// 下部フッター
		const footer = this.listContainerEl.createDiv({ cls: 'timeline-footer' });

		// 無限スクロール時のローディングインジケーター、そうでなければリフレッシュボタン
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

		// フォーカスインデックスをリセット
		this.focusedIndex = -1;
	}

	/**
	 * 表示モードを切り替え
	 */
	async toggleViewMode(): Promise<void> {
		const currentMode = this.plugin.data.settings.viewMode;
		this.plugin.data.settings.viewMode = currentMode === 'list' ? 'grid' : 'list';
		await this.plugin.syncAndSave();
		// 強制的に再描画するためにキャッシュをクリア
		this.lastCardPaths = [];
		this.lastCardStateKeys = [];
		await this.render();
	}

	/**
	 * クイックノート作成ボックスを描画
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

		// アクションバー
		const actionsBar = inputArea.createDiv({ cls: 'timeline-compose-actions' });

		// 文字数カウンター
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

				// タイムラインをリフレッシュ
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
	 * クイックノートを作成
	 */
	private async createQuickNote(content: string): Promise<void> {
		const settings = this.plugin.data.settings;
		const template = settings.quickNoteTemplate || DEFAULT_QUICK_NOTE_TEMPLATE;

		// UID生成（タイムスタンプベース）
		const now = new Date();
		const uid = now.getTime().toString(36);

		// 日付フォーマット
		const dateParts = now.toISOString().split('T');
		const dateStr = dateParts[0] ?? '';

		// タイトル生成（最初の行または最初の50文字）
		const lines = content.split('\n');
		const firstLine = lines[0] ?? '';
		const title = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;

		// テンプレートを適用
		const noteContent = template
			.replace(/\{\{uid\}\}/g, uid)
			.replace(/\{\{title\}\}/g, title)
			.replace(/\{\{date\}\}/g, dateStr)
			.replace(/\{\{content\}\}/g, content);

		// ファイル名を生成（タイムスタンプ + タイトルの一部）
		const safeTitle = title
			.replace(/[\\/:*?"<>|#^[\]]/g, '')
			.replace(/\s+/g, '_')
			.substring(0, 30);
		const fileName = `${dateStr}_${uid}_${safeTitle}.md`;

		// 保存先フォルダ
		const folder = settings.quickNoteFolder.trim();
		const filePath = folder ? `${folder}/${fileName}` : fileName;

		// フォルダが存在しない場合は作成（ネストされたフォルダにも対応）
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
							throw new Error(`フォルダの作成に失敗しました: ${currentPath}`);
						}
					}
				}
			}
		}

		// ノートを作成
		await this.app.vault.create(filePath, noteContent);
	}

	/**
	 * フィルタバーを描画
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

		// ファイルタイプフィルタ
		const typeFilters = filterBar.createDiv({ cls: 'timeline-filter-types' });
		const fileTypes: { type: string; icon: string; label: string }[] = [
			{ type: 'markdown', icon: '📝', label: 'Markdown' },
			{ type: 'text', icon: '📄', label: 'Text' },
			{ type: 'image', icon: 'IMG', label: 'Image' },
			{ type: 'pdf', icon: '📕', label: 'PDF' },
			{ type: 'audio', icon: '🎵', label: 'Audio' },
			{ type: 'video', icon: '🎬', label: 'Video' },
			{ type: 'office', icon: '📊', label: 'Office' },
			{ type: 'ipynb', icon: '🐍', label: 'Jupyter' },
			{ type: 'excalidraw', icon: '🎨', label: 'Excalidraw' },
			{ type: 'canvas', icon: '🔲', label: 'Canvas' },
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
	 * 全カードからユニークなタグを収集
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
	 * 検索入力ハンドラー（デバウンス付き）
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
			// 最低1つは残す
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

			// タグフィルタ（選択タグがある場合、いずれかを含む）
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
	 * カードリストのみを再描画（フィルタ変更時）
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

		// フィルタバーのUI状態を更新
		this.updateFilterBarUI();

		// カードリスト/グリッドを再描画
		const settings = this.plugin.data.settings;
		const isGridMode = settings.viewMode === 'grid';
		this.listEl = this.listContainerEl.querySelector('.timeline-list, .timeline-grid') as HTMLElement;
		if (!this.listEl) return;

		this.listEl.empty();
		this.cardElements = [];

		// 無限スクロール対応：初期表示数を決定
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
	 * フィルタバーのUI状態を更新
	 */
	private updateFilterBarUI(): void {
		// ファイルタイプボタンの状態更新
		const typeButtons = this.listContainerEl.querySelectorAll('.timeline-filter-type-btn');
		typeButtons.forEach(btn => {
			const type = btn.getAttribute('data-type');
			if (type) {
				btn.classList.toggle('is-active', this.fileTypeFilters.has(type));
			}
		});

		// タグチップの状態更新
		const tagChips = this.listContainerEl.querySelectorAll('.timeline-filter-tag-chip');
		tagChips.forEach(chip => {
			const tag = chip.textContent || '';
			chip.classList.toggle('is-selected', this.selectedTags.has(tag));
		});
	}

	/**
	 * カード要素を作成
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

		// メインコンテンツ領域
		const contentEl = cardEl.createDiv({ cls: 'timeline-card-content' });

		// Twitter風ヘッダー（フォルダ + タイムスタンプ）
		const headerEl = contentEl.createDiv({ cls: 'timeline-card-header' });
		const folderPath = card.path.includes('/') ? card.path.substring(0, card.path.lastIndexOf('/')) : '';
		headerEl.createSpan({ cls: 'timeline-card-header-folder', text: `📁 ${folderPath || 'Root'}` });
		headerEl.createSpan({ cls: 'timeline-card-header-separator', text: ' · ' });
		if (card.lastReviewedAt) {
			const date = new Date(card.lastReviewedAt);
			headerEl.createSpan({ cls: 'timeline-card-header-time', text: formatRelativeDate(date) });
		} else {
			headerEl.createSpan({ cls: 'timeline-card-header-time', text: 'New' });
		}
		// ヘッダー用アクションボタン（Twitterモードで表示）
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
				attr: { 'aria-label': 'Quote note' },
			});
			headerQuoteBtn.textContent = '🔁';
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
				attr: { 'aria-label': 'ノートをリンク' },
			});
			headerLinkBtn.textContent = '\uD83D\uDD17';
			headerLinkBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					new LinkNoteModal(this.app, this.plugin, file).open();
				}
			});
		}
		// ブックマークアイコン（ヘッダー用）
		const isBookmarked = this.isFileBookmarked(card.path);
		const headerBookmarkBtn = headerEl.createEl('button', {
			cls: `timeline-card-header-bookmark ${isBookmarked ? 'is-bookmarked' : ''}`,
		});
		setIcon(headerBookmarkBtn, 'bookmark');
		headerBookmarkBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const nowBookmarked = this.toggleBookmark(card.path);
			headerBookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
			// 同期：タイトル行のブックマークボタンも更新
			const titleBookmarkBtn = cardEl.querySelector('.timeline-bookmark-btn') as HTMLElement;
			if (titleBookmarkBtn) {
				titleBookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
			}
		});

		// タイトル行
		const titleRow = contentEl.createDiv({ cls: 'timeline-card-title-row' });

		// ファイルタイプバッジ（非マークダウンの場合）
		if (card.fileType !== 'markdown') {
			const typeIcon = getFileTypeIcon(card.fileType);
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

		// コメントボタン - Classic用
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

		// 引用ノートボタン - Classic用
		{
			const hasQuoteNoteDraft = this.plugin.hasQuoteNoteDraft(card.path);
			const quoteNoteBtn = titleRow.createEl('button', {
				cls: `timeline-quote-note-btn ${hasQuoteNoteDraft ? 'has-draft' : ''}`,
				attr: { 'aria-label': 'Quote note' },
			});
			quoteNoteBtn.textContent = '🔁';
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
				attr: { 'aria-label': 'ノートをリンク' },
			});
			linkBtn.textContent = '\uD83D\uDD17';
			linkBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					new LinkNoteModal(this.app, this.plugin, file).open();
				}
			});
		}

		// ブックマークボタン - Classic用
		const bookmarkBtn = titleRow.createEl('button', {
			cls: `timeline-bookmark-btn ${isBookmarked ? 'is-bookmarked' : ''}`,
			attr: { 'aria-label': isBookmarked ? 'Remove bookmark' : 'Add bookmark' },
		});
		setIcon(bookmarkBtn, 'bookmark');
		bookmarkBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const nowBookmarked = this.toggleBookmark(card.path);
			bookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
			bookmarkBtn.setAttribute('aria-label', nowBookmarked ? 'Remove bookmark' : 'Add bookmark');
			// 同期：ヘッダーのブックマークボタンも更新
			headerBookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
		});

		// プレビュー（Canvas/Officeは埋め込みのみ表示するためスキップ）
		if (card.fileType !== 'canvas' && card.fileType !== 'office') {
			const previewEl = contentEl.createDiv({ cls: 'timeline-card-preview' });
			if (card.fileType === 'markdown' || card.fileType === 'ipynb') {
				// 脚注記法をエスケープ（プレビューでは参照先がないため）
				const previewText = card.preview.replace(/\[\^/g, '\\[^');
				// マークダウンをレンダリング
				await MarkdownRenderer.render(
					this.app,
					previewText,
					previewEl,
					card.path,
					this.renderComponent
				);
				// ipynbの場合はクラスを追加
				if (card.fileType === 'ipynb') {
					previewEl.addClass('timeline-card-preview-ipynb');
				}
			} else {
				// 非マークダウンはプレーンテキスト表示
				previewEl.addClass('timeline-card-preview-file');
				previewEl.createSpan({
					cls: 'timeline-file-preview-text',
					text: card.preview,
				});
				// 拡張子バッジ
				previewEl.createSpan({
					cls: 'timeline-file-extension',
					text: `.${card.extension}`,
				});
			}
		}

		// サムネイル画像 / PDF・Excalidraw埋め込み（マークダウンはMarkdownRenderer内で位置通りに表示されるためスキップ）
		if (card.firstImagePath && card.fileType !== 'markdown') {
			if (card.fileType === 'pdf') {
				const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-pdf-embed' });
				this.pendingEmbeds.set(thumbnailEl, { card, isGridMode: false, embedType: 'pdf' });
			} else if (card.fileType === 'excalidraw') {
				const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-excalidraw-embed' });
				this.pendingEmbeds.set(thumbnailEl, { card, isGridMode: false, embedType: 'excalidraw' });
			} else if (card.fileType === 'canvas') {
				const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-canvas-embed' });
				this.pendingEmbeds.set(thumbnailEl, { card, isGridMode: false, embedType: 'canvas' });
			} else if (card.fileType === 'office') {
				const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-office-embed' });
				this.renderOfficeFallback(thumbnailEl, card, false);
			} else if (card.firstImagePath.startsWith('data:')) {
				// Base64 data URI（ipynbの出力画像など）
				const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-thumbnail-ipynb' });
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
					// 内部ファイル
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

		// リンクリスト
		if (card.outgoingLinks.length > 0 || card.backlinks.length > 0) {
			const linksEl = contentEl.createDiv({ cls: 'timeline-card-links' });

			// アウトゴーイングリンク
			if (card.outgoingLinks.length > 0) {
				const outgoingEl = linksEl.createDiv({ cls: 'timeline-links-section' });
				outgoingEl.createSpan({ cls: 'timeline-links-label', text: '→ Links' });
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
				backlinksEl.createSpan({ cls: 'timeline-links-label', text: '← Backlinks' });
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

		// Properties表示
		if (this.plugin.data.settings.showProperties !== 'off') {
			const props = card.properties;
			const keys = Object.keys(props);
			if (keys.length > 0) {
				const propsEl = contentEl.createDiv({ cls: 'timeline-card-properties' });
				for (const key of keys) {
					const item = propsEl.createDiv({ cls: 'timeline-property-item' });
					item.createSpan({ cls: 'timeline-property-key', text: key });
					item.createSpan({ cls: 'timeline-property-value', text: formatPropertyValue(props[key]) });
				}
			}
		}

		// メタ情報（Classic用）
		if (this.plugin.data.settings.showMeta) {
			const metaEl = contentEl.createDiv({ cls: 'timeline-card-meta' });

			if (card.lastReviewedAt) {
				const date = new Date(card.lastReviewedAt);
				const dateStr = formatRelativeDate(date);
				metaEl.createSpan({ text: `🕐 ${dateStr}` });
			}

			if (card.reviewCount > 0) {
				metaEl.createSpan({ text: `×${card.reviewCount}` });
			}

			if (card.interval > 0) {
				metaEl.createSpan({ cls: 'timeline-card-interval', text: `📅 ${card.interval}d` });
			}

			if (card.tags.length > 0) {
				const tagsStr = card.tags.slice(0, 3).join(' ');
				metaEl.createSpan({ cls: 'timeline-card-tags', text: tagsStr });
			}
		}

		// Twitter風アクションバー
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
			quoteAction.createSpan({ text: '🔁' });
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
					new LinkNoteModal(this.app, this.plugin, file).open();
				}
			});
		}

		// レビュー数アクション
		if (card.reviewCount > 0) {
			const reviewAction = actionsEl.createDiv({ cls: 'timeline-action-btn timeline-action-reviews' });
			reviewAction.createSpan({ text: '★' });
			reviewAction.createSpan({ cls: 'timeline-action-label', text: `${card.reviewCount} reviews` });
		}

		// タグ表示（Twitter風）
		if (card.tags.length > 0) {
			const tagsAction = actionsEl.createDiv({ cls: 'timeline-action-tags' });
			for (const tag of card.tags.slice(0, 2)) {
				tagsAction.createSpan({ cls: 'timeline-action-tag', text: tag });
			}
			if (card.tags.length > 2) {
				tagsAction.createSpan({ cls: 'timeline-action-tag-more', text: `+${card.tags.length - 2}` });
			}
		}

		// クリック/タップでノートを開く
		contentEl.addEventListener('click', () => {
			void this.openNote(card);
		});

		// 右クリックでコンテキストメニュー
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

		// 難易度ボタン（SRSモードまたは設定で有効時）
		const settings = this.plugin.data.settings;
		if (settings.showDifficultyButtons) {
			const buttonsEl = cardEl.createDiv({ cls: 'timeline-difficulty-buttons' });
			this.createDifficultyButtons(buttonsEl, card);
		} else {
			// 既読ショートカット（背景をタップ）
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
	 * グリッドカード要素を作成（画像中心の表示）
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
				this.pendingEmbeds.set(thumbnailEl, { card, isGridMode: true, embedType: 'pdf' });
			} else if (card.fileType === 'excalidraw') {
				thumbnailEl.addClass('timeline-grid-card-excalidraw-embed');
				this.pendingEmbeds.set(thumbnailEl, { card, isGridMode: true, embedType: 'excalidraw' });
			} else if (card.fileType === 'canvas') {
				thumbnailEl.addClass('timeline-grid-card-canvas-embed');
				this.pendingEmbeds.set(thumbnailEl, { card, isGridMode: true, embedType: 'canvas' });
			} else if (card.fileType === 'office') {
				thumbnailEl.addClass('timeline-grid-card-office-embed');
				this.renderOfficeFallback(thumbnailEl, card, true);
			} else if (card.firstImagePath.startsWith('data:')) {
				// Base64 data URI（ipynbの出力画像など）
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
			// 画像がない場合はファイルタイプアイコンを表示
			const icon = getFileTypeIcon(card.fileType);
			thumbnailEl.createDiv({
				cls: 'timeline-grid-card-icon',
				text: icon,
			});
		}

		// ファイルタイプバッジ
		if (card.fileType !== 'markdown') {
			const typeIcon = getFileTypeIcon(card.fileType);
			thumbnailEl.createSpan({
				cls: `timeline-grid-badge timeline-badge-${card.fileType}`,
				text: typeIcon,
			});
		}

		// オーバーレイ（ホバー時に表示）
		const overlayEl = thumbnailEl.createDiv({ cls: 'timeline-grid-card-overlay' });

		// ブックマークボタン
		const isBookmarked = this.isFileBookmarked(card.path);
		const bookmarkBtn = overlayEl.createEl('button', {
			cls: `timeline-grid-bookmark-btn ${isBookmarked ? 'is-bookmarked' : ''}`,
		});
		setIcon(bookmarkBtn, 'bookmark');
		bookmarkBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const nowBookmarked = this.toggleBookmark(card.path);
			bookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
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

		// タグ（最大2つまで表示）
		if (card.tags.length > 0) {
			const tagsEl = infoEl.createDiv({ cls: 'timeline-grid-card-tags' });
			for (const tag of card.tags.slice(0, 2)) {
				tagsEl.createSpan({ cls: 'timeline-grid-card-tag', text: tag });
			}
			if (card.tags.length > 2) {
				tagsEl.createSpan({ cls: 'timeline-grid-card-tag-more', text: `+${card.tags.length - 2}` });
			}
		}

		// クリックでノートを開く
		cardEl.addEventListener('click', () => {
			void this.openNote(card);
		});

		// 右クリックでコンテキストメニュー
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
	 * PDFオープンボタンを作成
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
	 * PDFページナビゲーションを作成
	 */
	private createPdfPageNav(container: HTMLElement, card: TimelineCard, isGridMode: boolean): void {
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
			void this.navigatePdfPage(container, card, current - 1, indicator, isGridMode);
		});

		nextBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const current = parseInt(container.dataset.pdfCurrentPage ?? '1', 10);
			void this.navigatePdfPage(container, card, current + 1, indicator, isGridMode);
		});
	}

	/**
	 * PDFページを指定ページに移動
	 */
	private async navigatePdfPage(
		container: HTMLElement,
		card: TimelineCard,
		page: number,
		indicator: HTMLElement,
		isGridMode: boolean
	): Promise<void> {
		const pdfPath = card.firstImagePath;
		if (!pdfPath) return;

		const pdfFile = this.app.vault.getAbstractFileByPath(pdfPath);
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
				this.app,
				`![[${pdfFile.path}#page=${page}]]`,
				embedHost,
				card.path,
				this.renderComponent
			);
		} catch (error: unknown) {
			console.error('Failed to navigate PDF page:', error);
			this.renderPdfFallback(container, card, 'PDF preview failed. Tap Open to view.', isGridMode);
			return;
		}

		this.applyInitialPdfZoom(embedHost);

		const renderedOk = await this.ensurePdfRendered(embedHost);
		if (renderedOk) {
			container.dataset.pdfCurrentPage = String(page);
			indicator.textContent = `Page ${page}`;
		}
	}

	/**
	 * PDFカードプレビューを描画（desktop: 埋め込み、mobile: フォールバック）
	 */
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
		this.createPdfPageNav(container, card, isGridMode);
	}

	/**
	 * 埋め込みPDF要素の描画可否を確認
	 */
	private async ensurePdfRendered(embedHost: HTMLElement): Promise<boolean> {
		const maxAttempts = 5;
		const intervalMs = 200;
		for (let i = 0; i < maxAttempts; i++) {
			await new Promise<void>(r => window.setTimeout(r, intervalMs));
			if (!embedHost.isConnected) return false;
			const pdfEl = this.findRenderedPdfElement(embedHost);
			if (pdfEl && this.hasVisibleSize(pdfEl)) return true;
		}
		return false;
	}

	/**
	 * DOM接続済みのPDFプレースホルダーに対して埋め込みを実行
	 */
	private async activatePendingEmbeds(): Promise<void> {
		const entries = Array.from(this.pendingEmbeds.entries());
		this.pendingEmbeds.clear();
		for (const [container, { card, isGridMode, embedType }] of entries) {
			if (!container.isConnected) continue;
			if (embedType === 'excalidraw') {
				await this.renderExcalidrawCardPreview(container, card, isGridMode);
			} else if (embedType === 'canvas') {
				await this.renderCanvasCardPreview(container, card, isGridMode);
			} else {
				await this.renderPdfCardPreview(container, card, isGridMode);
			}
		}
	}

	/**
	 * 埋め込みPDF要素を検索
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
	 * 要素が可視サイズを持っているか判定
	 */
	private hasVisibleSize(element: HTMLElement): boolean {
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	}

	/**
	 * PDFの初期ズームを100%に固定
	 */
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
					const zoomedSrc = this.withPdfFitWidth(currentSrc);
					if (zoomedSrc !== currentSrc) {
						target.setAttribute('src', zoomedSrc);
					}
					continue;
				}

				if (target instanceof HTMLObjectElement) {
					const currentData = target.getAttribute('data');
					if (!currentData) continue;
					const zoomedData = this.withPdfFitWidth(currentData);
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
	private withPdfFitWidth(url: string): string {
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
		fallbackEl.createDiv({ cls: 'timeline-pdf-fallback-icon', text: '📕' });
		const fileName = card.firstImagePath?.split('/').pop() ?? 'PDF';
		fallbackEl.createDiv({ cls: 'timeline-pdf-fallback-name', text: fileName });
		fallbackEl.createDiv({ cls: 'timeline-pdf-fallback-hint', text: message });

		this.createPdfOpenButton(container, card);
	}

	/**
	 * Excalidrawカードプレビューを描画
	 */
	private async renderExcalidrawCardPreview(
		container: HTMLElement,
		card: TimelineCard,
		isGridMode: boolean
	): Promise<void> {
		container.addEventListener('click', (e) => {
			e.stopPropagation();
		});

		const filePath = card.firstImagePath;
		if (!filePath) {
			this.renderExcalidrawFallback(container, card, 'Excalidraw preview failed.', isGridMode);
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			this.renderExcalidrawFallback(container, card, 'Excalidraw preview failed.', isGridMode);
			return;
		}

		const embedHost = container.createDiv({ cls: 'timeline-excalidraw-embed-host' });
		try {
			await MarkdownRenderer.render(
				this.app,
				`![[${file.path}]]`,
				embedHost,
				card.path,
				this.renderComponent
			);
		} catch (error: unknown) {
			console.error('Failed to render Excalidraw preview:', error);
			this.renderExcalidrawFallback(container, card, 'Excalidraw preview failed.', isGridMode);
			return;
		}

		const renderedOk = await this.ensureExcalidrawRendered(embedHost);
		if (!renderedOk) {
			this.renderExcalidrawFallback(container, card, 'Excalidraw plugin not installed or rendering failed.', isGridMode);
			return;
		}

		this.createExcalidrawOpenButton(container, card);
	}

	/**
	 * Excalidraw埋め込み要素の描画完了をポーリングで確認
	 */
	private async ensureExcalidrawRendered(embedHost: HTMLElement): Promise<boolean> {
		const maxAttempts = 10;
		const intervalMs = 300;
		for (let i = 0; i < maxAttempts; i++) {
			await new Promise<void>(r => window.setTimeout(r, intervalMs));
			if (!embedHost.isConnected) return false;
			// Excalidrawプラグインが描画するSVG/canvas/.excalidraw-svg要素を探す
			const excalidrawEl = embedHost.querySelector('svg, canvas, .excalidraw-svg, .excalidraw');
			if (excalidrawEl instanceof HTMLElement && this.hasVisibleSize(excalidrawEl)) return true;
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
	private renderExcalidrawFallback(
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

		this.createExcalidrawOpenButton(container, card);
	}

	/**
	 * Excalidrawオープンボタンを作成
	 */
	private createExcalidrawOpenButton(container: HTMLElement, card: TimelineCard): void {
		const openBtn = container.createEl('button', {
			cls: 'timeline-excalidraw-open-btn',
			text: '🎨 open',
		});
		openBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.openNote(card);
		});
	}

	/**
	 * Canvasカードプレビューを描画
	 */
	private async renderCanvasCardPreview(
		container: HTMLElement,
		card: TimelineCard,
		isGridMode: boolean
	): Promise<void> {
		container.addEventListener('click', (e) => {
			e.stopPropagation();
		});

		const filePath = card.firstImagePath;
		if (!filePath) {
			this.renderCanvasFallback(container, card, 'Canvas preview failed.', isGridMode);
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			this.renderCanvasFallback(container, card, 'Canvas preview failed.', isGridMode);
			return;
		}

		const embedHost = container.createDiv({ cls: 'timeline-canvas-embed-host' });
		try {
			await MarkdownRenderer.render(
				this.app,
				`![[${file.path}]]`,
				embedHost,
				card.path,
				this.renderComponent
			);
		} catch (error: unknown) {
			console.error('Failed to render Canvas preview:', error);
			this.renderCanvasFallback(container, card, 'Canvas preview failed.', isGridMode);
			return;
		}

		const renderedOk = await this.ensureCanvasRendered(embedHost);
		if (!renderedOk) {
			this.renderCanvasFallback(container, card, 'Canvas plugin not available or rendering failed.', isGridMode);
			return;
		}

		this.createCanvasOpenButton(container, card);
	}

	/**
	 * Canvas埋め込み要素の描画完了をポーリングで確認
	 */
	private async ensureCanvasRendered(embedHost: HTMLElement): Promise<boolean> {
		const maxAttempts = 10;
		const intervalMs = 300;
		for (let i = 0; i < maxAttempts; i++) {
			await new Promise<void>(r => window.setTimeout(r, intervalMs));
			if (!embedHost.isConnected) return false;
			// Canvasが描画する .canvas-node 要素または .internal-embed を探す
			const canvasEl = embedHost.querySelector('.canvas-node, .canvas, .internal-embed');
			if (canvasEl instanceof HTMLElement && this.hasVisibleSize(canvasEl)) return true;
		}
		return false;
	}

	/**
	 * Canvasプレビュー失敗時のフォールバックUI
	 */
	private renderCanvasFallback(
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

		this.createCanvasOpenButton(container, card);
	}

	/**
	 * Canvasオープンボタンを作成
	 */
	private createCanvasOpenButton(container: HTMLElement, card: TimelineCard): void {
		const openBtn = container.createEl('button', {
			cls: 'timeline-canvas-open-btn',
			text: '🔲 open',
		});
		openBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.openNote(card);
		});
	}

	/**
	 * Officeファイルの拡張子からサブタイプアイコンを返す
	 */
	private getOfficeSubIcon(extension: string): string {
		const ext = extension.toLowerCase();
		if (ext.startsWith('doc')) return '📝';
		if (ext.startsWith('xls')) return '📊';
		if (ext.startsWith('ppt')) return '📽️';
		return '📄';
	}

	/**
	 * Officeファイルの拡張子から種別ラベルを返す
	 */
	private getOfficeTypeLabel(extension: string): string {
		const ext = extension.toLowerCase();
		if (ext.startsWith('doc')) return 'Word document';
		if (ext.startsWith('xls')) return 'Spreadsheet';
		if (ext.startsWith('ppt')) return 'Presentation';
		return 'Office document';
	}

	/**
	 * OfficeファイルのフォールバックUIを構築
	 */
	private renderOfficeFallback(
		container: HTMLElement,
		card: TimelineCard,
		isGridMode: boolean
	): void {
		const fallbackEl = container.createDiv({ cls: 'timeline-office-fallback' });
		fallbackEl.addClass(isGridMode ? 'timeline-office-fallback-grid' : 'timeline-office-fallback-list');
		const icon = this.getOfficeSubIcon(card.extension);
		fallbackEl.createDiv({ cls: 'timeline-office-fallback-icon', text: icon });
		const fileName = card.path.split('/').pop() ?? card.title;
		fallbackEl.createDiv({ cls: 'timeline-office-fallback-name', text: fileName });
		const label = this.getOfficeTypeLabel(card.extension);
		fallbackEl.createDiv({ cls: 'timeline-office-fallback-hint', text: label });

		this.createOfficeOpenButton(container, card);
	}

	/**
	 * Officeオープンボタンを作成
	 */
	private createOfficeOpenButton(container: HTMLElement, card: TimelineCard): void {
		const icon = this.getOfficeSubIcon(card.extension);
		const openBtn = container.createEl('button', {
			cls: 'timeline-office-open-btn',
			text: `${icon} open`,
		});
		openBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.openNote(card);
		});
	}

	/**
	 * 難易度ボタンを作成
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
	 * 難易度ボタンをUndoボタンに置換
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
					// Undoクラスを除去し難易度ボタンを再描画
					container.removeClass('timeline-difficulty-undo');
					container.empty();
					this.createDifficultyButtons(container, card);
				}
			});
		});
	}

	/**
	 * ノートを開く
	 */
	private async openNote(card: TimelineCard): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (!file || !(file instanceof TFile)) return;

		if (Platform.isMobile) {
			// Mobile: 新しいleafで開く
			await this.app.workspace.getLeaf().openFile(file);
			return;
		}

		// Desktop: 直前にアクティブだったleafの隣に新しいタブとして開く
		let targetLeaf: WorkspaceLeaf;

		if (this.previousActiveLeaf) {
			// 直前のleafと同じタブグループに新しいタブを作成
			const parent = this.previousActiveLeaf.parent;
			if (parent) {
				// parent は WorkspaceTabs | WorkspaceMobileDrawer だが createLeafInParent は WorkspaceSplit を期待する。実行時は動作するため型アサーションで対応
				targetLeaf = this.app.workspace.createLeafInParent(parent as unknown as WorkspaceSplit, -1);
			} else {
				targetLeaf = this.app.workspace.getLeaf('tab');
			}
		} else {
			// 直前のleafがない場合は、タイムライン以外のleafを探して同じタブグループに開く
			const adjacentLeaf = this.findAdjacentLeaf(this.leaf);
			if (adjacentLeaf) {
				const parent = adjacentLeaf.parent;
				if (parent) {
					// parent は WorkspaceTabs | WorkspaceMobileDrawer だが createLeafInParent は WorkspaceSplit を期待する。実行時は動作するため型アサーションで対応
					targetLeaf = this.app.workspace.createLeafInParent(parent as unknown as WorkspaceSplit, -1);
				} else {
					targetLeaf = this.app.workspace.getLeaf('tab');
				}
			} else {
				// 隣のleafがなければ、右に分割して開く
				targetLeaf = this.app.workspace.getLeaf('split');
			}
		}

		await targetLeaf.openFile(file);

		// フォーカスをノートに移動
		this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
	}

	/**
	 * タイムライン以外の隣接するleafを探す
	 */
	private findAdjacentLeaf(timelineLeaf: WorkspaceLeaf): WorkspaceLeaf | null {
		let targetLeaf: WorkspaceLeaf | null = null;
		let foundMarkdownLeaf: WorkspaceLeaf | null = null;

		this.app.workspace.iterateAllLeaves((leaf) => {
			// タイムライン自身は除外
			if (leaf === timelineLeaf) return;

			// タイムラインビューは除外
			if (leaf.view.getViewType() === TIMELINE_VIEW_TYPE) return;

			// Markdownビュー（ノート）を優先
			if (leaf.view.getViewType() === 'markdown') {
				foundMarkdownLeaf = leaf;
			}

			// 空のビューまたはその他のビュー
			if (!targetLeaf) {
				targetLeaf = leaf;
			}
		});

		// Markdownビューがあればそれを優先
		return foundMarkdownLeaf || targetLeaf;
	}

	/**
	 * ファイルがブックマークされているか確認（キャッシュ使用）
	 */
	private isFileBookmarked(path: string): boolean {
		// キャッシュがあれば使用（(1)ルックアップ）
		if (this.cachedBookmarkedPaths) {
			return this.cachedBookmarkedPaths.has(path);
		}

		// キャッシュがない場合はdataLayerから取得
		this.cachedBookmarkedPaths = getBookmarkedPaths(this.app);
		return this.cachedBookmarkedPaths.has(path);
	}

	/**
	 * ブックマークをトグル
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
			// 既にブックマークされている場合は削除
			instance.removeItem(existing);
			result = false;
		} else {
			// ブックマークを追加
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file && file instanceof TFile) {
				instance.addItem({ type: 'file', path: path, title: '' });
				result = true;
			} else {
				result = false;
			}
		}

		// キャッシュをクリア
		clearBookmarkCache();
		this.cachedBookmarkedPaths = null;

		return result;
	}

	/**
	 * スクロールハンドラー（無限スクロール用）
	 */
	private handleScroll(): void {
		if (!this.plugin.data.settings.enableInfiniteScroll) return;
		if (this.isLoadingMore) return;
		if (this.displayedCount >= this.filteredCards.length) return;

		const container = this.listContainerEl;
		const scrollBottom = container.scrollTop + container.clientHeight;
		const threshold = container.scrollHeight - 200; // 200px手前でロード開始

		if (scrollBottom >= threshold) {
			void this.loadMoreCards();
		}
	}

	/**
	 * 追加カードをロード（無限スクロール用）
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
		// DOM接続後にPDF埋め込みを実行
		await this.activatePendingEmbeds();

		this.displayedCount = endIndex;
		this.isLoadingMore = false;

		// フッターを更新
		this.updateFooter();
	}

	/**
	 * タッチ開始ハンドラー（プルトゥリフレッシュ用）
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
	 * タッチ移動ハンドラー（プルトゥリフレッシュ用）
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
			// 引っ張り中 - デフォルトのスクロールを阻止
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
	 * タッチ終了ハンドラー（プルトゥリフレッシュ用）
	 */
	private handleTouchEnd(_e: TouchEvent): void {
		if (this.pullToRefreshTriggered) {
			this.pullToRefreshTriggered = false;
			this.showPullIndicator(0, 80, true);  // ローディング状態を表示
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
			this.pullIndicatorEl.createSpan({ text: '↓' });
			this.pullIndicatorEl.createSpan({ text: 'Release to refresh' });
			this.pullIndicatorEl.classList.add('is-ready');
			this.pullIndicatorEl.classList.remove('is-loading');
		} else {
			this.pullIndicatorEl.createSpan({ text: '↓' });
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
	 * フッターを更新（無限スクロール用）
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
	 * キーボードショートカットハンドラー
	 */
	private handleKeydown(e: KeyboardEvent): void {
		// 入力フィールドにフォーカスがある場合は無視
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
					this.toggleFocusedBookmark();
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
	 * 前のカードにフォーカス
	 */
	private focusPrevCard(): void {
		if (this.cardElements.length === 0) return;

		const newIndex = this.focusedIndex > 0
			? this.focusedIndex - 1
			: this.cardElements.length - 1;
		this.setFocusedIndex(newIndex);
	}

	/**
	 * フォーカスインデックスを設定
	 */
	private setFocusedIndex(index: number): void {
		// 前のフォーカスを解除
		if (this.focusedIndex >= 0 && this.focusedIndex < this.cardElements.length) {
			const prevEl = this.cardElements[this.focusedIndex];
			if (prevEl) {
				prevEl.removeClass('timeline-card-focused');
			}
		}

		// 新しいフォーカスを設定
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
	 * フォーカス中のカードの評価を取り消し
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
			// 難易度ボタンを再描画
			const buttonsEl = cardEl.querySelector('.timeline-difficulty-buttons') as HTMLElement;
			if (buttonsEl) {
				buttonsEl.removeClass('timeline-difficulty-undo');
				buttonsEl.empty();
				this.createDifficultyButtons(buttonsEl, card);
			}
		}
	}

	/**
	 * フォーカス中のカードのブックマークをトグル
	 */
	private toggleFocusedBookmark(): void {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;

		const card = this.filteredCards[this.focusedIndex];
		if (!card) return;

		const nowBookmarked = this.toggleBookmark(card.path);

		// ブックマークボタンのUIを更新
		const cardEl = this.cardElements[this.focusedIndex];
		if (cardEl) {
			const bookmarkBtn = cardEl.querySelector('.timeline-bookmark-btn') as HTMLElement;
			if (bookmarkBtn) {
				bookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
			}
		}
	}

	/**
	 * フォーカス中のカードのコメントモーダルを開く
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
	 * フォーカス中のカードの引用ノートモーダルを開く
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
	 * フォーカス中のカードのリンクノートモーダルを開く
	 */
	private openFocusedLinkNote(): void {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;

		const card = this.filteredCards[this.focusedIndex];
		if (!card) return;

		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (file && file instanceof TFile) {
			new LinkNoteModal(this.app, this.plugin, file).open();
		}
	}
}
