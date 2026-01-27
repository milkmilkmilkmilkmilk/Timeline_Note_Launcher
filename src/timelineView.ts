// Timeline Note Launcher - Timeline View
import { ItemView, WorkspaceLeaf, Platform, TFile, MarkdownRenderer, Component, Menu } from 'obsidian';
import { TimelineCard, DifficultyRating, ColorTheme, ImageSizeMode, UITheme, DEFAULT_QUICK_NOTE_TEMPLATE } from './types';
import { getNextIntervals, getBookmarkedPaths, clearBookmarkCache } from './dataLayer';
import { CommentModal } from './commentModal';
import { QuoteNoteModal } from './quoteNoteModal';
import { LinkNoteModal } from './linkNoteModal';
import type TimelineNoteLauncherPlugin from './main';

/**
 * 配列の内容が等しいかを比較
 */
function arraysEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
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
	private fileTypeFilters: Set<string> = new Set(['markdown', 'text', 'image', 'pdf', 'audio', 'video', 'office', 'ipynb', 'other']);
	private selectedTags: Set<string> = new Set();
	private searchDebounceTimer: number | null = null;
	// 直前にアクティブだったleaf（タイムライン以外）
	private previousActiveLeaf: WorkspaceLeaf | null = null;
	// 差分レンダリング用：前回のカードパス
	private lastCardPaths: string[] = [];
	// ブックマークパスのキャッシュ
	private cachedBookmarkedPaths: Set<string> | null = null;
	// 無限スクロール用
	private displayedCount: number = 0;
	private isLoadingMore: boolean = false;
	private scrollHandler: () => void;
	private listEl: HTMLElement | null = null;
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
		void this.plugin.saveData(this.plugin.data);
		this.updateMobileClass();
		// 強制的に再描画するためにキャッシュをクリア
		this.lastCardPaths = [];
		await this.render();
	}

	async onClose(): Promise<void> {
		// スクロール位置を保存
		this.scrollPosition = this.listContainerEl.scrollTop;
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
	 * カード一覧を描画
	 */
	private async render(): Promise<void> {
		// カードパスの変更を検出
		const newPaths = this.cards.map(c => c.path);
		const pathsChanged = !arraysEqual(this.lastCardPaths, newPaths);

		// パスが変わっていない場合は完全再構築をスキップ（ヘッダーの統計のみ更新）
		if (!pathsChanged && this.listContainerEl.hasChildNodes()) {
			// 統計のみ更新
			const statsEl = this.listContainerEl.querySelector('.timeline-stats');
			if (statsEl && this.plugin.data.settings.selectionMode === 'srs') {
				statsEl.innerHTML = `<span class="timeline-stat-new">${this.newCount} new</span> · <span class="timeline-stat-due">${this.dueCount} due</span>`;
			}
			return;
		}

		// パスを記録
		this.lastCardPaths = newPaths;

		// 古いレンダリングをクリーンアップ
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

		// PC/モバイル切り替えボタン（PCのみ表示）
		if (!Platform.isMobile) {
			const isMobileView = settings.mobileViewOnDesktop;
			const toggleBtn = rightSection.createEl('button', {
				cls: 'timeline-view-toggle-btn',
				text: isMobileView ? '📱' : '🖥️',
				attr: { 'aria-label': isMobileView ? 'Switch to PC view' : 'Switch to Mobile view' },
			});
			toggleBtn.addEventListener('click', () => { void this.toggleMobileView(); });
		}

		// リスト/グリッド切り替えボタン
		const viewMode = settings.viewMode;
		const viewModeBtn = rightSection.createEl('button', {
			cls: 'timeline-view-mode-btn',
			text: viewMode === 'list' ? '▤' : '▦',
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

		// 初期カードを描画
		for (let i = 0; i < this.displayedCount; i++) {
			const card = this.filteredCards[i];
			if (!card) continue;
			const cardEl = isGridMode
				? await this.createGridCardElement(card)
				: await this.createCardElement(card);
			this.listEl.appendChild(cardEl);
			this.cardElements.push(cardEl);
		}

		// 下部フッター
		const footer = this.listContainerEl.createDiv({ cls: 'timeline-footer' });

		// 無限スクロール時はローディングインジケーター、そうでなければリフレッシュボタン
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

		// フォーカスインデックスをリセット
		this.focusedIndex = -1;
	}

	/**
	 * 表示モードを切り替え
	 */
	async toggleViewMode(): Promise<void> {
		const currentMode = this.plugin.data.settings.viewMode;
		this.plugin.data.settings.viewMode = currentMode === 'list' ? 'grid' : 'list';
		await this.plugin.saveData(this.plugin.data);
		// 強制的に再描画するためにキャッシュをクリア
		this.lastCardPaths = [];
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

		// テキストエリアの自動リサイズ
		textarea.addEventListener('input', () => {
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			textarea.style.height = 'auto';
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
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
				// eslint-disable-next-line obsidianmd/no-static-styles-assignment
				textarea.style.height = 'auto';
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

		// ファイルタイプフィルタ
		const typeFilters = filterBar.createDiv({ cls: 'timeline-filter-types' });
		const fileTypes: { type: string; icon: string; label: string }[] = [
			{ type: 'markdown', icon: '📝', label: 'Markdown' },
			{ type: 'text', icon: '📃', label: 'Text' },
			{ type: 'image', icon: '🖼️', label: 'Image' },
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
			btn.textContent = ft.icon;
			btn.addEventListener('click', () => this.toggleFileTypeFilter(ft.type));
		}

		// タグフィルタ
		const allTags = this.collectAllTags();
		if (allTags.length > 0) {
			const tagSection = filterBar.createDiv({ cls: 'timeline-filter-tags' });
			tagSection.createSpan({ cls: 'timeline-filter-tags-label', text: 'Tags:' });
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
		if (this.searchDebounceTimer !== null) {
			window.clearTimeout(this.searchDebounceTimer);
		}

		this.searchDebounceTimer = window.setTimeout(() => {
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

			return true;
		});
	}

	/**
	 * カードリストのみを再描画（フィルタ変更時）
	 */
	private async renderCardList(): Promise<void> {
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

		for (let i = 0; i < this.displayedCount; i++) {
			const card = this.filteredCards[i];
			if (!card) continue;
			const cardEl = isGridMode
				? await this.createGridCardElement(card)
				: await this.createCardElement(card);
			this.listEl.appendChild(cardEl);
			this.cardElements.push(cardEl);
		}

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
		const cardEl = document.createElement('div');
		cardEl.className = 'timeline-card';
		cardEl.addClass(`timeline-card-type-${card.fileType}`);
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
			headerEl.createSpan({ cls: 'timeline-card-header-time', text: this.formatRelativeDate(date) });
		} else {
			headerEl.createSpan({ cls: 'timeline-card-header-time', text: 'New' });
		}
		// ブックマークアイコン（ヘッダー用）
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
				// 同期：タイトル行のブックマークボタンも更新
				const titleBookmarkBtn = cardEl.querySelector('.timeline-bookmark-btn') as HTMLElement;
				if (titleBookmarkBtn) {
					titleBookmarkBtn.textContent = nowBookmarked ? '★' : '☆';
					titleBookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
				}
			});
		});

		// タイトル行
		const titleRow = contentEl.createDiv({ cls: 'timeline-card-title-row' });

		// ファイルタイプバッジ（非マークダウンの場合）
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

		// コメントボタン（マークダウンのみ）- Classic用
		if (card.fileType === 'markdown') {
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

			// 引用ノートボタン（マークダウンのみ）- Classic用
			const hasQuoteNoteDraft = this.plugin.hasQuoteNoteDraft(card.path);
			const quoteNoteBtn = titleRow.createEl('button', {
				cls: `timeline-quote-note-btn ${hasQuoteNoteDraft ? 'has-draft' : ''}`,
				attr: { 'aria-label': '引用ノート' },
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

			// リンクボタン（マークダウンのみ）- Classic用
			const linkBtn = titleRow.createEl('button', {
				cls: 'timeline-link-note-btn',
				attr: { 'aria-label': 'ノートをリンク' },
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

		// ブックマークボタン - Classic用
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
				// 同期：ヘッダーのブックマークボタンも更新
				headerBookmarkBtn.textContent = nowBookmarked ? '★' : '☆';
				headerBookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
			});
		});

		// プレビュー
		const previewEl = contentEl.createDiv({ cls: 'timeline-card-preview' });
		if (card.fileType === 'markdown') {
			// マークダウンをレンダリング
			await MarkdownRenderer.render(
				this.app,
				card.preview,
				previewEl,
				card.path,
				this.renderComponent
			);
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

		// サムネイル画像 / PDF埋め込み
		if (card.firstImagePath) {
			if (card.fileType === 'pdf') {
				// PDF埋め込み表示
				const pdfFile = this.app.vault.getAbstractFileByPath(card.firstImagePath);
				if (pdfFile && pdfFile instanceof TFile) {
					const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-pdf-embed' });
					const resourcePath = this.app.vault.getResourcePath(pdfFile);
					thumbnailEl.createEl('embed', {
						attr: {
							src: resourcePath,
							type: 'application/pdf',
						},
					});
					// PDFクリック時のイベント伝播を停止
					thumbnailEl.addEventListener('click', (e) => {
						e.stopPropagation();
					});
					// オープンボタンを追加
					this.createPdfOpenButton(thumbnailEl, card);
				}
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

		// メタ情報（Classic用）
		if (this.plugin.data.settings.showMeta) {
			const metaEl = contentEl.createDiv({ cls: 'timeline-card-meta' });

			if (card.lastReviewedAt) {
				const date = new Date(card.lastReviewedAt);
				const dateStr = this.formatRelativeDate(date);
				metaEl.createSpan({ text: `👁 ${dateStr}` });
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

		// コメントアクション（マークダウンのみ）
		if (card.fileType === 'markdown') {
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

			// 引用アクション
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

			// リンクアクション（マークダウンのみ）
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
			reviewAction.createSpan({ text: '⭐' });
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
			// 既読ショートカット（右端をタップ）
			const markReadBtn = cardEl.createDiv({ cls: 'timeline-mark-read' });
			markReadBtn.textContent = '✓';
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
		const cardEl = document.createElement('div');
		cardEl.className = 'timeline-grid-card';
		cardEl.addClass(`timeline-card-type-${card.fileType}`);
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
				// PDF埋め込み表示
				thumbnailEl.addClass('timeline-grid-card-pdf-embed');
				const pdfFile = this.app.vault.getAbstractFileByPath(card.firstImagePath);
				if (pdfFile && pdfFile instanceof TFile) {
					const resourcePath = this.app.vault.getResourcePath(pdfFile);
					thumbnailEl.createEl('embed', {
						attr: {
							src: resourcePath,
							type: 'application/pdf',
						},
					});
					// PDFクリック時のイベント伝播を停止
					thumbnailEl.addEventListener('click', (e) => {
						e.stopPropagation();
					});
					// オープンボタンを追加
					this.createPdfOpenButton(thumbnailEl, card);
				}
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
			const icon = this.getFileTypeIcon(card.fileType);
			thumbnailEl.createDiv({
				cls: 'timeline-grid-card-icon',
				text: icon,
			});
		}

		// ファイルタイプバッジ
		if (card.fileType !== 'markdown') {
			const typeIcon = this.getFileTypeIcon(card.fileType);
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
		bookmarkBtn.textContent = isBookmarked ? '★' : '☆';
		bookmarkBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.toggleBookmark(card.path).then(nowBookmarked => {
				bookmarkBtn.textContent = nowBookmarked ? '★' : '☆';
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
				});
			});
		}
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
				// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
				targetLeaf = (this.app.workspace as any).createLeafInParent(parent, -1);
			} else {
				targetLeaf = this.app.workspace.getLeaf('tab');
			}
		} else {
			// 直前のleafがない場合は、タイムライン以外のleafを探して同じタブグループに開く
			const adjacentLeaf = this.findAdjacentLeaf(this.leaf);
			if (adjacentLeaf) {
				const parent = adjacentLeaf.parent;
				if (parent) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
					targetLeaf = (this.app.workspace as any).createLeafInParent(parent, -1);
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
	 * 相対日付フォーマット
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
	 * ファイルタイプアイコンを取得
	 */
	private getFileTypeIcon(fileType: string): string {
		switch (fileType) {
			case 'text': return '📃';
			case 'image': return '🖼️';
			case 'pdf': return '📄';
			case 'audio': return '🎵';
			case 'video': return '🎬';
			case 'office': return '📊';
			case 'ipynb': return '📓';
			default: return '📁';
		}
	}

	/**
	 * ファイルがブックマークされているか確認（キャッシュ使用）
	 */
	private isFileBookmarked(path: string): boolean {
		// キャッシュがあれば使用（O(1)ルックアップ）
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
	private async toggleBookmark(path: string): Promise<boolean> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
		const bookmarksPlugin = (this.app as any).internalPlugins?.plugins?.bookmarks;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		if (!bookmarksPlugin?.enabled || !bookmarksPlugin?.instance) {
			return false;
		}

		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
		const instance = bookmarksPlugin.instance;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
		const items = instance.items || [];
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		const existingIndex = items.findIndex((item: { type: string; path?: string }) =>
			item.type === 'file' && item.path === path
		);

		let result: boolean;
		if (existingIndex >= 0) {
			// 既にブックマークされている場合は削除
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
			instance.removeItem(items[existingIndex]);
			result = false;
		} else {
			// ブックマークを追加
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file && file instanceof TFile) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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

		// 追加カードを描画
		for (let i = startIndex; i < endIndex; i++) {
			const card = this.filteredCards[i];
			if (!card) continue;
			const cardEl = isGridMode
				? await this.createGridCardElement(card)
				: await this.createCardElement(card);
			this.listEl.appendChild(cardEl);
			this.cardElements.push(cardEl);
		}

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
			// 引っ張り中 - デフォルトのスクロールを防止
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
			this.pullIndicatorEl = document.createElement('div');
			this.pullIndicatorEl.className = 'timeline-pull-indicator';
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
			this.pullIndicatorEl.createSpan({ text: '↑' });
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
		}

		// 次のカードにフォーカス
		if (this.focusedIndex < this.cardElements.length - 1) {
			this.setFocusedIndex(this.focusedIndex + 1);
		}
	}

	/**
	 * フォーカス中のカードのブックマークをトグル
	 */
	private async toggleFocusedBookmark(): Promise<void> {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;

		const card = this.filteredCards[this.focusedIndex];
		if (!card) return;

		const nowBookmarked = await this.toggleBookmark(card.path);

		// ブックマークボタンのUIを更新
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
	 * フォーカス中のカードのコメントモーダルを開く
	 */
	private openFocusedComment(): void {
		if (this.focusedIndex < 0 || this.focusedIndex >= this.filteredCards.length) return;

		const card = this.filteredCards[this.focusedIndex];
		if (!card || card.fileType !== 'markdown') return;

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
		if (!card || card.fileType !== 'markdown') return;

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
		if (!card || card.fileType !== 'markdown') return;

		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (file && file instanceof TFile) {
			new LinkNoteModal(this.app, file).open();
		}
	}
}
