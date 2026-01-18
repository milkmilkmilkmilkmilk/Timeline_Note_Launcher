// Timeline Note Launcher - Timeline View
import { ItemView, WorkspaceLeaf, Platform, TFile, MarkdownRenderer, Component, Menu } from 'obsidian';
import { TimelineCard, DifficultyRating, ColorTheme, ViewMode } from './types';
import { getNextIntervals } from './dataLayer';
import { CommentModal } from './commentModal';
import { QuoteNoteModal } from './quoteNoteModal';
import type TimelineNoteLauncherPlugin from './main';

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
	private fileTypeFilters: Set<string> = new Set(['markdown', 'image', 'pdf', 'audio', 'video', 'other']);
	private selectedTags: Set<string> = new Set();
	private searchDebounceTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TimelineNoteLauncherPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.renderComponent = new Component();
		this.keydownHandler = this.handleKeydown.bind(this);
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
	 * モバイルモードを切り替え（PCのみ）
	 */
	async toggleMobileView(): Promise<void> {
		if (Platform.isMobile) return;
		this.plugin.data.settings.mobileViewOnDesktop = !this.plugin.data.settings.mobileViewOnDesktop;
		this.plugin.saveData(this.plugin.data);
		this.updateMobileClass();
		await this.render();
	}

	async onClose(): Promise<void> {
		// スクロール位置を保存
		this.scrollPosition = this.listContainerEl.scrollTop;
		// レンダリングコンポーネントをアンロード
		this.renderComponent.unload();
		// キーボードリスナーを解除
		this.listContainerEl.removeEventListener('keydown', this.keydownHandler);
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
		// 古いレンダリングをクリーンアップ
		this.renderComponent.unload();
		this.renderComponent = new Component();
		this.renderComponent.load();

		this.listContainerEl.empty();

		// ヘッダー
		const header = this.listContainerEl.createDiv({ cls: 'timeline-header' });

		const leftSection = header.createDiv({ cls: 'timeline-header-left' });
		const refreshBtn = leftSection.createEl('button', {
			cls: 'timeline-refresh-btn',
			text: '↻',
		});
		refreshBtn.addEventListener('click', () => this.refresh());

		// SRSモードでは統計を表示
		const settings = this.plugin.data.settings;
		if (settings.selectionMode === 'srs') {
			const statsEl = leftSection.createSpan({ cls: 'timeline-stats' });
			statsEl.innerHTML = `<span class="timeline-stat-new">${this.newCount} new</span> · <span class="timeline-stat-due">${this.dueCount} due</span>`;
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
			toggleBtn.addEventListener('click', () => this.toggleMobileView());
		}

		// リスト/グリッド切り替えボタン
		const viewMode = settings.viewMode;
		const viewModeBtn = rightSection.createEl('button', {
			cls: 'timeline-view-mode-btn',
			text: viewMode === 'list' ? '▤' : '▦',
			attr: { 'aria-label': viewMode === 'list' ? 'Switch to Grid view' : 'Switch to List view' },
		});
		viewModeBtn.addEventListener('click', () => this.toggleViewMode());

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
		const listEl = this.listContainerEl.createDiv({ cls: listCls });

		// カード要素配列をリセット
		this.cardElements = [];

		for (const card of this.filteredCards) {
			const cardEl = isGridMode
				? await this.createGridCardElement(card)
				: await this.createCardElement(card);
			listEl.appendChild(cardEl);
			this.cardElements.push(cardEl);
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
		await this.render();
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
			{ type: 'image', icon: '🖼️', label: 'Image' },
			{ type: 'pdf', icon: '📄', label: 'PDF' },
			{ type: 'audio', icon: '🎵', label: 'Audio' },
			{ type: 'video', icon: '🎬', label: 'Video' },
		];

		for (const ft of fileTypes) {
			const isActive = this.fileTypeFilters.has(ft.type);
			const btn = typeFilters.createEl('button', {
				cls: `timeline-filter-type-btn ${isActive ? 'is-active' : ''}`,
				attr: { 'aria-label': ft.label, 'data-type': ft.type },
			});
			btn.innerHTML = ft.icon;
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
			this.renderCardList();
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
		this.renderCardList();
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
		this.renderCardList();
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
		const isGridMode = this.plugin.data.settings.viewMode === 'grid';
		const listEl = this.listContainerEl.querySelector('.timeline-list, .timeline-grid');
		if (!listEl) return;

		listEl.empty();
		this.cardElements = [];

		for (const card of this.filteredCards) {
			const cardEl = isGridMode
				? await this.createGridCardElement(card)
				: await this.createCardElement(card);
			listEl.appendChild(cardEl);
			this.cardElements.push(cardEl);
		}

		this.focusedIndex = -1;
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

		// コメントボタン（マークダウンのみ）
		if (card.fileType === 'markdown') {
			const hasDraft = this.plugin.hasCommentDraft(card.path);
			const commentBtn = titleRow.createEl('button', {
				cls: `timeline-comment-btn ${hasDraft ? 'has-draft' : ''}`,
				attr: { 'aria-label': 'コメントを追加' },
			});
			commentBtn.innerHTML = '💬';
			commentBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					const modal = new CommentModal(this.app, this.plugin, file);
					modal.open();
				}
			});

			// 引用ノートボタン（マークダウンのみ）
			const hasQuoteNoteDraft = this.plugin.hasQuoteNoteDraft(card.path);
			const quoteNoteBtn = titleRow.createEl('button', {
				cls: `timeline-quote-note-btn ${hasQuoteNoteDraft ? 'has-draft' : ''}`,
				attr: { 'aria-label': '引用ノート' },
			});
			quoteNoteBtn.innerHTML = '🔄';
			quoteNoteBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(card.path);
				if (file && file instanceof TFile) {
					const modal = new QuoteNoteModal(this.app, this.plugin, file);
					modal.open();
				}
			});
		}

		// ブックマークボタン
		const isBookmarked = this.isFileBookmarked(card.path);
		const bookmarkBtn = titleRow.createEl('button', {
			cls: `timeline-bookmark-btn ${isBookmarked ? 'is-bookmarked' : ''}`,
			attr: { 'aria-label': isBookmarked ? 'Remove bookmark' : 'Add bookmark' },
		});
		bookmarkBtn.innerHTML = isBookmarked ? '★' : '☆';
		bookmarkBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			const nowBookmarked = await this.toggleBookmark(card.path);
			bookmarkBtn.innerHTML = nowBookmarked ? '★' : '☆';
			bookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
			bookmarkBtn.setAttribute('aria-label', nowBookmarked ? 'Remove bookmark' : 'Add bookmark');
		});

		// サムネイル画像
		if (card.firstImagePath) {
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
					linkEl.addEventListener('click', async (e) => {
						e.stopPropagation();
						const file = this.app.vault.getAbstractFileByPath(link.path);
						if (file && file instanceof TFile) {
							await this.app.workspace.getLeaf().openFile(file);
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
					linkEl.addEventListener('click', async (e) => {
						e.stopPropagation();
						const file = this.app.vault.getAbstractFileByPath(link.path);
						if (file && file instanceof TFile) {
							await this.app.workspace.getLeaf().openFile(file);
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

		// メタ情報
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

		// クリック/タップでノートを開く
		contentEl.addEventListener('click', async () => {
			await this.openNote(card);
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
			markReadBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				await this.plugin.markAsReviewed(card.path);
				cardEl.addClass('timeline-card-reviewed');
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
			if (card.firstImagePath.startsWith('http://') || card.firstImagePath.startsWith('https://')) {
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
		bookmarkBtn.innerHTML = isBookmarked ? '★' : '☆';
		bookmarkBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			const nowBookmarked = await this.toggleBookmark(card.path);
			bookmarkBtn.innerHTML = nowBookmarked ? '★' : '☆';
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
		cardEl.addEventListener('click', async () => {
			await this.openNote(card);
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

			buttonEl.addEventListener('click', async (e) => {
				e.stopPropagation();
				await this.plugin.rateCard(card.path, btn.rating);
				container.closest('.timeline-card')?.addClass('timeline-card-reviewed');
				// 次のカードにフォーカス
				const nextCard = container.closest('.timeline-card')?.nextElementSibling;
				if (nextCard) {
					(nextCard as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
				}
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

		// Desktop: タイムライン以外のleafを探して再利用
		const timelineLeaf = this.leaf;
		let targetLeaf = this.findAdjacentLeaf(timelineLeaf);

		if (targetLeaf) {
			// 既存のleafでファイルを開く
			await targetLeaf.openFile(file);
		} else {
			// 隣のleafがなければ、右に分割して開く
			targetLeaf = this.app.workspace.getLeaf('split');
			await targetLeaf.openFile(file);
		}

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
			case 'image': return '🖼️';
			case 'pdf': return '📄';
			case 'audio': return '🎵';
			case 'video': return '🎬';
			default: return '📁';
		}
	}

	/**
	 * ファイルがブックマークされているか確認
	 */
	private isFileBookmarked(path: string): boolean {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const bookmarksPlugin = (this.app as any).internalPlugins?.plugins?.bookmarks;
		if (!bookmarksPlugin?.enabled || !bookmarksPlugin?.instance) {
			return false;
		}

		const items = bookmarksPlugin.instance.items || [];
		return items.some((item: { type: string; path?: string }) =>
			item.type === 'file' && item.path === path
		);
	}

	/**
	 * ブックマークをトグル
	 */
	private async toggleBookmark(path: string): Promise<boolean> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const bookmarksPlugin = (this.app as any).internalPlugins?.plugins?.bookmarks;
		if (!bookmarksPlugin?.enabled || !bookmarksPlugin?.instance) {
			return false;
		}

		const instance = bookmarksPlugin.instance;
		const items = instance.items || [];
		const existingIndex = items.findIndex((item: { type: string; path?: string }) =>
			item.type === 'file' && item.path === path
		);

		if (existingIndex >= 0) {
			// 既にブックマークされている場合は削除
			instance.removeItem(items[existingIndex]);
			return false;
		} else {
			// ブックマークを追加
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file && file instanceof TFile) {
				instance.addItem({ type: 'file', path: path, title: '' });
				return true;
			}
			return false;
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
					this.openFocusedCard();
				}
				break;
			case '1':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					this.rateFocusedCard('again');
				}
				break;
			case '2':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					this.rateFocusedCard('hard');
				}
				break;
			case '3':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					this.rateFocusedCard('good');
				}
				break;
			case '4':
				if (this.focusedIndex >= 0) {
					e.preventDefault();
					this.rateFocusedCard('easy');
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
			case 'r':
				e.preventDefault();
				this.refresh();
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
				bookmarkBtn.innerHTML = nowBookmarked ? '★' : '☆';
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
}
