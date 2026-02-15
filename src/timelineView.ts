// Timeline Note Launcher - Timeline View
import { ItemView, WorkspaceLeaf, WorkspaceSplit, Platform, TFile, Component } from 'obsidian';
import { TimelineCard, ColorTheme, ImageSizeMode, UITheme, DEFAULT_QUICK_NOTE_TEMPLATE } from './types';
import { getBookmarkedPaths, getBookmarksPlugin, clearBookmarkCache } from './dataLayer';
import type TimelineNoteLauncherPlugin from './main';
import { arraysEqual, buildCardStateKey } from './timelineViewUtils';
import { activatePendingEmbeds } from './embedRenderers';
import type { EmbedRenderContext } from './pdfRenderer';
import { createPullToRefreshState, handleTouchStart, handleTouchMove, handleTouchEnd } from './pullToRefresh';
import type { PullToRefreshState } from './pullToRefresh';
import { createDefaultFilterBarState, collectAllTags, applyFilters, renderFilterBar, updateFilterBarUI } from './filterBar';
import type { FilterBarState, FilterBarContext } from './filterBar';
import { handleKeydown } from './keyboardNav';
import type { KeyboardNavContext } from './keyboardNav';
import { createCardElement, createGridCardElement, createDifficultyButtons, replaceWithUndoButton } from './cardRenderer';
import type { CardRenderContext } from './cardRenderer';

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
	private filterState: FilterBarState = createDefaultFilterBarState();
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
	// 無限スクロール用
	private displayedCount: number = 0;
	private isLoadingMore: boolean = false;
	private scrollHandler: () => void;
	private listEl: HTMLElement | null = null;
	// 遅延レンダリング用：DOM接続後に処理するコンテナ→カードデータの対応（PDF/Excalidraw）
	private pendingEmbeds: Map<HTMLElement, { card: TimelineCard; isGridMode: boolean; embedType: 'pdf' | 'excalidraw' | 'canvas' }> = new Map();
	// プルトゥリフレッシュ用
	private pullState: PullToRefreshState = createPullToRefreshState();
	private touchStartHandler: (e: TouchEvent) => void;
	private touchMoveHandler: (e: TouchEvent) => void;
	private touchEndHandler: (e: TouchEvent) => void;

	constructor(leaf: WorkspaceLeaf, plugin: TimelineNoteLauncherPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.renderComponent = new Component();
		this.keydownHandler = (e: KeyboardEvent) => handleKeydown(this.getKeyboardNavContext(), e);
		this.scrollHandler = this.handleScroll.bind(this);
		// プルトゥリフレッシュ用
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
		if (this.filterState.searchDebounceTimer !== null) {
			window.clearTimeout(this.filterState.searchDebounceTimer);
			this.filterState.searchDebounceTimer = null;
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
		this.cachedAllTags = collectAllTags(this.cards);
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
			const cardCtx = this.getCardRenderContext();
			const chunkEls = await Promise.all(
				chunk.map(card =>
					isGridMode ? createGridCardElement(cardCtx, card) : createCardElement(cardCtx, card)
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
		renderFilterBar(this.getFilterBarContext());

		// フィルタを適用
		this.filteredCards = applyFilters(this.cards, this.filterState);

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
		await activatePendingEmbeds(this.getEmbedRenderContext(), this.pendingEmbeds);

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
	 * フィルターバーのコンテキストを取得
	 */
	private getFilterBarContext(): FilterBarContext {
		return {
			state: this.filterState,
			cards: this.cards,
			cachedAllTags: this.cachedAllTags,
			listContainerEl: this.listContainerEl,
			app: this.app,
			plugin: this.plugin,
			onFilterChanged: () => { void this.renderCardList(); },
			render: () => this.render(),
		};
	}

	/**
	 * カードリストのみを再描画（フィルタ変更時）
	 */
	private async renderCardList(): Promise<void> {
		if (!this.listContainerEl) {
			return;
		}
		// フィルタを適用
		this.filteredCards = applyFilters(this.cards, this.filterState);

		// カード数表示を更新
		const countEl = this.listContainerEl.querySelector('.timeline-count');
		if (countEl) {
			const countText = this.filteredCards.length === this.cards.length
				? `${this.cards.length} notes`
				: `${this.filteredCards.length} / ${this.cards.length} notes`;
			countEl.textContent = countText;
		}

		// フィルタバーのUI状態を更新
		updateFilterBarUI(this.listContainerEl, this.filterState);

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
	 * 埋め込みレンダリングのコンテキストを取得
	 */
	private getEmbedRenderContext(): EmbedRenderContext {
		return {
			app: this.app,
			renderComponent: this.renderComponent,
			openNote: (card: TimelineCard) => this.openNote(card),
		};
	}

	/**
	 * カードレンダリングのコンテキストを取得
	 */
	private getCardRenderContext(): CardRenderContext {
		return {
			app: this.app,
			plugin: this.plugin,
			renderComponent: this.renderComponent,
			pendingEmbeds: this.pendingEmbeds,
			embedRenderContext: this.getEmbedRenderContext(),
			openNote: (card) => this.openNote(card),
			isFileBookmarked: (path) => this.isFileBookmarked(path),
			toggleBookmark: (path) => this.toggleBookmark(path),
		};
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
		await activatePendingEmbeds(this.getEmbedRenderContext(), this.pendingEmbeds);

		this.displayedCount = endIndex;
		this.isLoadingMore = false;

		// フッターを更新
		this.updateFooter();
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
	 * キーボードナビゲーションのコンテキストを取得
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
			refresh: () => this.refresh(),
		};
	}
}
