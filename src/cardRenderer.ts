// Timeline Note Launcher - Card Renderer
// timelineView.ts から抽出されたカードレンダリングロジック
import { TFile, Menu, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type { TimelineCard, DifficultyRating } from './types';
import type TimelineNoteLauncherPlugin from './main';
import type { EmbedRenderContext } from './embedRenderers';
import { renderOfficeFallback } from './embedRenderers';
import { CommentModal } from './commentModal';
import { QuoteNoteModal } from './quoteNoteModal';
import { LinkNoteModal } from './linkNoteModal';
import { getNextIntervals } from './dataLayer';
import { formatRelativeDate, getFileTypeIcon, formatPropertyValue } from './timelineViewUtils';

export interface PendingMarkdownRender {
	previewEl: HTMLElement;
	previewText: string;
	sourcePath: string;
}

const PREVIEW_PLACEHOLDER_CHAR_LIMIT = 300;
const PREVIEW_PLACEHOLDER_SCAN_LIMIT = 600;

function buildPreviewPlaceholderText(preview: string): string {
	const bounded = preview.length > PREVIEW_PLACEHOLDER_SCAN_LIMIT
		? preview.slice(0, PREVIEW_PLACEHOLDER_SCAN_LIMIT)
		: preview;
	return bounded.replace(/[#*_~`>![\]()]/g, '').substring(0, PREVIEW_PLACEHOLDER_CHAR_LIMIT);
}

function hasActiveSelectionWithin(container: HTMLElement): boolean {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
		return false;
	}

	for (let i = 0; i < selection.rangeCount; i++) {
		const range = selection.getRangeAt(i);
		if (range.collapsed) continue;

		try {
			if (range.intersectsNode(container)) {
				return true;
			}
		} catch {
			// Fallback for environments where intersectsNode may throw.
		}

		const ancestor = range.commonAncestorContainer;
		if (container.contains(ancestor)) {
			return true;
		}
	}

	return false;
}

/**
 * カードレンダリングのコンテキスト
 */
export interface CardRenderContext {
	app: App;
	plugin: TimelineNoteLauncherPlugin;
	pendingEmbeds: Map<HTMLElement, { card: TimelineCard; isGridMode: boolean; embedType: 'pdf' | 'excalidraw' | 'canvas' }>;
	pendingMarkdownRenders: PendingMarkdownRender[];
	embedRenderContext: EmbedRenderContext;
	openNote(card: TimelineCard): Promise<void>;
	isFileBookmarked(path: string): boolean;
	toggleBookmark(path: string): boolean;
	applySrsCountDelta(deltaNew: number, deltaDue: number): void;
	refresh(): Promise<void>;
}

function createTwitterActionButton(
	container: HTMLElement,
	icon: string,
	label: string,
	onClick: (event: MouseEvent) => void,
	extraClass = '',
): HTMLButtonElement {
	const button = container.createEl('button', {
		cls: `timeline-action-btn timeline-twitter-v2-action ${extraClass}`.trim(),
		attr: { 'aria-label': label },
	});
	const iconEl = button.createSpan({ cls: 'timeline-twitter-v2-action-icon' });
	setIcon(iconEl, icon);
	button.createSpan({ cls: 'timeline-action-label', text: label });
	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		onClick(event);
	});
	return button;
}

function renderTwitterCardMedia(
	ctx: CardRenderContext,
	containerEl: HTMLElement,
	card: TimelineCard,
): void {
	if (!card.firstImagePath) return;

	if (card.fileType === 'pdf') {
		const thumbnailEl = containerEl.createDiv({ cls: 'timeline-card-thumbnail timeline-twitter-card-media timeline-card-pdf-embed' });
		ctx.pendingEmbeds.set(thumbnailEl, { card, isGridMode: false, embedType: 'pdf' });
		return;
	}
	if (card.fileType === 'excalidraw') {
		const thumbnailEl = containerEl.createDiv({ cls: 'timeline-card-thumbnail timeline-twitter-card-media timeline-card-excalidraw-embed' });
		ctx.pendingEmbeds.set(thumbnailEl, { card, isGridMode: false, embedType: 'excalidraw' });
		return;
	}
	if (card.fileType === 'canvas') {
		const thumbnailEl = containerEl.createDiv({ cls: 'timeline-card-thumbnail timeline-twitter-card-media timeline-card-canvas-embed' });
		ctx.pendingEmbeds.set(thumbnailEl, { card, isGridMode: false, embedType: 'canvas' });
		return;
	}
	if (card.fileType === 'office') {
		const thumbnailEl = containerEl.createDiv({ cls: 'timeline-card-thumbnail timeline-twitter-card-media timeline-card-office-embed' });
		renderOfficeFallback(ctx.embedRenderContext, thumbnailEl, card, false);
		return;
	}

	const mediaEl = containerEl.createDiv({ cls: 'timeline-card-thumbnail timeline-twitter-card-media' });
	if (card.firstImagePath.startsWith('data:')) {
		mediaEl.createEl('img', { attr: { src: card.firstImagePath, alt: card.title } });
		return;
	}
	if (card.firstImagePath.startsWith('http://') || card.firstImagePath.startsWith('https://')) {
		mediaEl.createEl('img', { attr: { src: card.firstImagePath, alt: card.title } });
		return;
	}

	const imageFile = ctx.app.vault.getAbstractFileByPath(card.firstImagePath);
	if (imageFile && imageFile instanceof TFile) {
		const resourcePath = ctx.app.vault.getResourcePath(imageFile);
		mediaEl.createEl('img', { attr: { src: resourcePath, alt: card.title } });
	}
}

function getTwitterSrsLabel(card: TimelineCard): string {
	if (card.isDue) return 'Due';
	if (card.isNew) return 'New';
	if (card.nextReviewAt) {
		return `Next ${formatRelativeDate(new Date(card.nextReviewAt))}`;
	}
	if (card.interval > 0) {
		return `${card.interval}d`;
	}
	return 'Reviewed';
}

function createTwitterV2CardElement(ctx: CardRenderContext, card: TimelineCard): HTMLElement {
	const settings = ctx.plugin.data.settings;
	const cardEl = createDiv({ cls: ['timeline-card', `timeline-card-type-${card.fileType}`, 'timeline-twitter-v2-card'] });
	if (card.pinned) cardEl.addClass('timeline-card-pinned');
	if (card.isNew) cardEl.addClass('timeline-card-new');
	if (card.isDue) cardEl.addClass('timeline-card-due');

	const contentEl = cardEl.createDiv({ cls: 'timeline-card-content' });

	const headerEl = contentEl.createDiv({ cls: 'timeline-twitter-card-header' });
	const avatarEl = headerEl.createDiv({ cls: 'timeline-twitter-card-avatar' });
	avatarEl.textContent = settings.twitterAvatarEmoji.trim() || '\u{1F4DD}';

	const userMetaEl = headerEl.createDiv({ cls: 'timeline-twitter-card-user' });
	userMetaEl.createDiv({
		cls: 'timeline-twitter-card-display-name',
		text: settings.twitterDisplayName.trim() || 'Timeline User',
	});
	userMetaEl.createDiv({
		cls: 'timeline-twitter-card-handle',
		text: settings.twitterHandle.trim() || '@timeline_user',
	});

	const timestamp = card.createdAt ?? card.lastReviewedAt;
	headerEl.createDiv({
		cls: 'timeline-twitter-card-date',
		text: timestamp ? new Date(timestamp).toLocaleDateString() : '',
	});

	const previewEl = contentEl.createDiv({ cls: 'timeline-card-preview timeline-twitter-card-preview' });
	if (card.fileType === 'markdown' || card.fileType === 'ipynb') {
		previewEl.addClass('timeline-card-preview-pending');
		const placeholderText = buildPreviewPlaceholderText(card.preview);
		previewEl.createDiv({
			cls: 'timeline-card-preview-placeholder',
			text: placeholderText.length > 0 ? placeholderText : 'Loading preview...',
		});
		ctx.pendingMarkdownRenders.push({
			previewEl,
			previewText: card.preview,
			sourcePath: card.path,
		});
	} else {
		previewEl.addClass('timeline-card-preview-file');
		previewEl.createSpan({
			cls: 'timeline-file-preview-text',
			text: card.preview,
		});
	}

	renderTwitterCardMedia(ctx, contentEl, card);

	const helperEl = contentEl.createDiv({ cls: 'timeline-twitter-card-helper' });
	helperEl.createDiv({ cls: 'timeline-twitter-card-helper-title', text: card.title });
	helperEl.createDiv({ cls: 'timeline-twitter-card-helper-path', text: card.path });

	const actionsEl = contentEl.createDiv({ cls: 'timeline-card-actions timeline-twitter-v2-actions' });
	createTwitterActionButton(actionsEl, 'message-circle', 'Comment', () => {
		const file = ctx.app.vault.getAbstractFileByPath(card.path);
		if (file && file instanceof TFile) {
			new CommentModal(ctx.app, ctx.plugin, file).open();
		}
	});
	createTwitterActionButton(actionsEl, 'repeat', 'Quote note', () => {
		const file = ctx.app.vault.getAbstractFileByPath(card.path);
		if (file && file instanceof TFile) {
			new QuoteNoteModal(ctx.app, ctx.plugin, file).open();
		}
	});
	createTwitterActionButton(actionsEl, 'heart', 'Good rating', () => {
		void ctx.plugin.rateCard(card.path, 'good')
			.then(() => {
				ctx.applySrsCountDelta(card.isNew ? -1 : 0, card.isDue ? -1 : 0);
				return ctx.refresh();
			})
			.catch((error: unknown) => {
				console.error('Failed to apply good rating from Twitter action:', error);
			});
	});
	createTwitterActionButton(actionsEl, 'share', 'Link note', () => {
		const file = ctx.app.vault.getAbstractFileByPath(card.path);
		if (file && file instanceof TFile) {
			new LinkNoteModal(ctx.app, ctx.plugin, file).open();
		}
	});

	const bookmarkAction = createTwitterActionButton(actionsEl, 'bookmark', 'Bookmark', () => {
		const nowBookmarked = ctx.toggleBookmark(card.path);
		bookmarkAction.classList.toggle('is-bookmarked', nowBookmarked);
		bookmarkAction.setAttribute('aria-label', nowBookmarked ? 'Remove bookmark' : 'Add bookmark');
	});
	const initiallyBookmarked = ctx.isFileBookmarked(card.path);
	bookmarkAction.classList.toggle('is-bookmarked', initiallyBookmarked);
	bookmarkAction.setAttribute('aria-label', initiallyBookmarked ? 'Remove bookmark' : 'Add bookmark');

	createTwitterActionButton(actionsEl, 'more-horizontal', 'More', (event) => {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle('Open note').onClick(() => { void ctx.openNote(card); }));
		menu.addItem((item) => item.setTitle('Open file menu').onClick(() => {
			const file = ctx.app.vault.getAbstractFileByPath(card.path);
			if (!file || !(file instanceof TFile)) return;
			const fileMenu = new Menu();
			ctx.app.workspace.trigger('file-menu', fileMenu, file, 'file-explorer-context-menu', null);
			fileMenu.showAtMouseEvent(event);
		}));
		menu.showAtMouseEvent(event);
	}, 'timeline-twitter-v2-action-overflow');

	if (settings.twitterShowSrsInActions) {
		actionsEl.createSpan({
			cls: 'timeline-twitter-srs-chip',
			text: getTwitterSrsLabel(card),
		});
	}

	contentEl.addEventListener('click', () => {
		if (hasActiveSelectionWithin(contentEl)) return;
		void ctx.openNote(card);
	});
	cardEl.addEventListener('contextmenu', (event) => {
		if (hasActiveSelectionWithin(contentEl)) return;
		event.preventDefault();
		const file = ctx.app.vault.getAbstractFileByPath(card.path);
		if (file && file instanceof TFile) {
			const menu = new Menu();
			ctx.app.workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu', null);
			menu.showAtMouseEvent(event);
		}
	});

	if (settings.showDifficultyButtons) {
		const buttonsEl = cardEl.createDiv({ cls: 'timeline-difficulty-buttons' });
		createDifficultyButtons(ctx, buttonsEl, card);
	}

	return cardEl;
}

/**
 * リストカード要素を作成
 */
export function createCardElement(ctx: CardRenderContext, card: TimelineCard): HTMLElement {
	if (ctx.plugin.data.settings.uiTheme === 'twitter') {
		return createTwitterV2CardElement(ctx, card);
	}

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
		const hasDraft = ctx.plugin.hasCommentDraft(card.path);
		const headerCommentBtn = headerEl.createEl('button', {
			cls: `timeline-card-header-action timeline-card-header-comment ${hasDraft ? 'has-draft' : ''}`,
			attr: { 'aria-label': 'コメントを追加' },
		});
		headerCommentBtn.textContent = '💬';
		headerCommentBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const file = ctx.app.vault.getAbstractFileByPath(card.path);
			if (file && file instanceof TFile) {
				const modal = new CommentModal(ctx.app, ctx.plugin, file);
				modal.open();
			}
		});

		const hasQuoteNoteDraft = ctx.plugin.hasQuoteNoteDraft(card.path);
		const headerQuoteBtn = headerEl.createEl('button', {
			cls: `timeline-card-header-action timeline-card-header-quote ${hasQuoteNoteDraft ? 'has-draft' : ''}`,
			attr: { 'aria-label': 'Quote note' },
		});
		headerQuoteBtn.textContent = '🔁';
		headerQuoteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const file = ctx.app.vault.getAbstractFileByPath(card.path);
			if (file && file instanceof TFile) {
				const modal = new QuoteNoteModal(ctx.app, ctx.plugin, file);
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
			const file = ctx.app.vault.getAbstractFileByPath(card.path);
			if (file && file instanceof TFile) {
				new LinkNoteModal(ctx.app, ctx.plugin, file).open();
			}
		});
	}
	// ブックマークアイコン（ヘッダー用）
	const isBookmarked = ctx.isFileBookmarked(card.path);
	const headerBookmarkBtn = headerEl.createEl('button', {
		cls: `timeline-card-header-bookmark ${isBookmarked ? 'is-bookmarked' : ''}`,
	});
	setIcon(headerBookmarkBtn, 'bookmark');
	headerBookmarkBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const nowBookmarked = ctx.toggleBookmark(card.path);
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
		const hasDraft = ctx.plugin.hasCommentDraft(card.path);
		const commentBtn = titleRow.createEl('button', {
			cls: `timeline-comment-btn ${hasDraft ? 'has-draft' : ''}`,
			attr: { 'aria-label': 'コメントを追加' },
		});
		commentBtn.textContent = '💬';
		commentBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const file = ctx.app.vault.getAbstractFileByPath(card.path);
			if (file && file instanceof TFile) {
				const modal = new CommentModal(ctx.app, ctx.plugin, file);
				modal.open();
			}
		});
	}

	// 引用ノートボタン - Classic用
	{
		const hasQuoteNoteDraft = ctx.plugin.hasQuoteNoteDraft(card.path);
		const quoteNoteBtn = titleRow.createEl('button', {
			cls: `timeline-quote-note-btn ${hasQuoteNoteDraft ? 'has-draft' : ''}`,
			attr: { 'aria-label': 'Quote note' },
		});
		quoteNoteBtn.textContent = '🔁';
		quoteNoteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const file = ctx.app.vault.getAbstractFileByPath(card.path);
			if (file && file instanceof TFile) {
				const modal = new QuoteNoteModal(ctx.app, ctx.plugin, file);
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
			const file = ctx.app.vault.getAbstractFileByPath(card.path);
			if (file && file instanceof TFile) {
				new LinkNoteModal(ctx.app, ctx.plugin, file).open();
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
		const nowBookmarked = ctx.toggleBookmark(card.path);
		bookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
		bookmarkBtn.setAttribute('aria-label', nowBookmarked ? 'Remove bookmark' : 'Add bookmark');
		// 同期：ヘッダーのブックマークボタンも更新
		headerBookmarkBtn.classList.toggle('is-bookmarked', nowBookmarked);
	});

	// プレビュー（Canvas/Officeは埋め込みのみ表示するためスキップ）
	if (card.fileType !== 'canvas' && card.fileType !== 'office') {
		const previewEl = contentEl.createDiv({ cls: 'timeline-card-preview' });
		if (card.fileType === 'markdown' || card.fileType === 'ipynb') {
			// プレースホルダーを即座に描画（Markdownレンダリングは遅延実行）
			previewEl.addClass('timeline-card-preview-pending');
			if (card.fileType === 'ipynb') {
				previewEl.addClass('timeline-card-preview-ipynb');
			}
			const placeholderText = buildPreviewPlaceholderText(card.preview);
			previewEl.createDiv({
				cls: 'timeline-card-preview-placeholder',
				text: placeholderText.length > 0 ? placeholderText : 'Loading preview...',
			});
			ctx.pendingMarkdownRenders.push({
				previewEl,
				previewText: card.preview,
				sourcePath: card.path,
			});
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
			ctx.pendingEmbeds.set(thumbnailEl, { card, isGridMode: false, embedType: 'pdf' });
		} else if (card.fileType === 'excalidraw') {
			const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-excalidraw-embed' });
			ctx.pendingEmbeds.set(thumbnailEl, { card, isGridMode: false, embedType: 'excalidraw' });
		} else if (card.fileType === 'canvas') {
			const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-canvas-embed' });
			ctx.pendingEmbeds.set(thumbnailEl, { card, isGridMode: false, embedType: 'canvas' });
		} else if (card.fileType === 'office') {
			const thumbnailEl = contentEl.createDiv({ cls: 'timeline-card-thumbnail timeline-card-office-embed' });
			renderOfficeFallback(ctx.embedRenderContext, thumbnailEl, card, false);
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
				const imageFile = ctx.app.vault.getAbstractFileByPath(card.firstImagePath);
				if (imageFile && imageFile instanceof TFile) {
					const resourcePath = ctx.app.vault.getResourcePath(imageFile);
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
					const file = ctx.app.vault.getAbstractFileByPath(link.path);
					if (file && file instanceof TFile) {
						void ctx.app.workspace.getLeaf().openFile(file);
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
					const file = ctx.app.vault.getAbstractFileByPath(link.path);
					if (file && file instanceof TFile) {
						void ctx.app.workspace.getLeaf().openFile(file);
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
	if (ctx.plugin.data.settings.showProperties !== 'off') {
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
	if (ctx.plugin.data.settings.showMeta) {
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
		const hasDraft = ctx.plugin.hasCommentDraft(card.path);
		const commentAction = actionsEl.createEl('button', {
			cls: `timeline-action-btn timeline-action-comment ${hasDraft ? 'has-draft' : ''}`,
		});
		commentAction.createSpan({ text: '💬' });
		commentAction.createSpan({ cls: 'timeline-action-label', text: 'Comment' });
		commentAction.addEventListener('click', (e) => {
			e.stopPropagation();
			const file = ctx.app.vault.getAbstractFileByPath(card.path);
			if (file && file instanceof TFile) {
				const modal = new CommentModal(ctx.app, ctx.plugin, file);
				modal.open();
			}
		});
	}

	// 引用アクション
	{
		const hasQuoteNoteDraft = ctx.plugin.hasQuoteNoteDraft(card.path);
		const quoteAction = actionsEl.createEl('button', {
			cls: `timeline-action-btn timeline-action-quote ${hasQuoteNoteDraft ? 'has-draft' : ''}`,
		});
		quoteAction.createSpan({ text: '🔁' });
		quoteAction.createSpan({ cls: 'timeline-action-label', text: 'Quote' });
		quoteAction.addEventListener('click', (e) => {
			e.stopPropagation();
			const file = ctx.app.vault.getAbstractFileByPath(card.path);
			if (file && file instanceof TFile) {
				const modal = new QuoteNoteModal(ctx.app, ctx.plugin, file);
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
			const file = ctx.app.vault.getAbstractFileByPath(card.path);
			if (file && file instanceof TFile) {
				new LinkNoteModal(ctx.app, ctx.plugin, file).open();
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
		if (hasActiveSelectionWithin(contentEl)) return;
		void ctx.openNote(card);
	});

	// 右クリックでコンテキストメニュー
	cardEl.addEventListener('contextmenu', (e) => {
		if (hasActiveSelectionWithin(contentEl)) return;
		e.preventDefault();
		const file = ctx.app.vault.getAbstractFileByPath(card.path);
		if (file && file instanceof TFile) {
			const menu = new Menu();

			// Obsidianの標準ファイルメニューをトリガー
			ctx.app.workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu', null);

			menu.showAtMouseEvent(e);
		}
	});

	// 難易度ボタン（SRSモードまたは設定で有効時）
	const settings = ctx.plugin.data.settings;
	if (settings.showDifficultyButtons) {
		const buttonsEl = cardEl.createDiv({ cls: 'timeline-difficulty-buttons' });
		createDifficultyButtons(ctx, buttonsEl, card);
	} else {
		// 既読ショートカット（背景をタップ）
		const markReadBtn = cardEl.createDiv({ cls: 'timeline-mark-read' });
		markReadBtn.textContent = 'Read';
		markReadBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void ctx.plugin.markAsReviewed(card.path).then(() => {
				cardEl.addClass('timeline-card-reviewed');
			});
		});
	}

	return cardEl;
}

/**
 * グリッドカード要素を作成（画像中心の表示）
 */
export function createGridCardElement(ctx: CardRenderContext, card: TimelineCard): HTMLElement {
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
			ctx.pendingEmbeds.set(thumbnailEl, { card, isGridMode: true, embedType: 'pdf' });
		} else if (card.fileType === 'excalidraw') {
			thumbnailEl.addClass('timeline-grid-card-excalidraw-embed');
			ctx.pendingEmbeds.set(thumbnailEl, { card, isGridMode: true, embedType: 'excalidraw' });
		} else if (card.fileType === 'canvas') {
			thumbnailEl.addClass('timeline-grid-card-canvas-embed');
			ctx.pendingEmbeds.set(thumbnailEl, { card, isGridMode: true, embedType: 'canvas' });
		} else if (card.fileType === 'office') {
			thumbnailEl.addClass('timeline-grid-card-office-embed');
			renderOfficeFallback(ctx.embedRenderContext, thumbnailEl, card, true);
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
			const imageFile = ctx.app.vault.getAbstractFileByPath(card.firstImagePath);
			if (imageFile && imageFile instanceof TFile) {
				const resourcePath = ctx.app.vault.getResourcePath(imageFile);
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
	const isBookmarked = ctx.isFileBookmarked(card.path);
	const bookmarkBtn = overlayEl.createEl('button', {
		cls: `timeline-grid-bookmark-btn ${isBookmarked ? 'is-bookmarked' : ''}`,
	});
	setIcon(bookmarkBtn, 'bookmark');
	bookmarkBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const nowBookmarked = ctx.toggleBookmark(card.path);
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
		void ctx.openNote(card);
	});

	// 右クリックでコンテキストメニュー
	cardEl.addEventListener('contextmenu', (e) => {
		e.preventDefault();
		const file = ctx.app.vault.getAbstractFileByPath(card.path);
		if (file && file instanceof TFile) {
			const menu = new Menu();
			ctx.app.workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu', null);
			menu.showAtMouseEvent(e);
		}
	});

	return cardEl;
}

/**
 * 難易度ボタンを作成
 */
export function createDifficultyButtons(ctx: CardRenderContext, container: HTMLElement, card: TimelineCard): void {
	const log = ctx.plugin.data.reviewLogs[card.path];
	const intervals = getNextIntervals(log, ctx.plugin.data.settings);

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
			void ctx.plugin.rateCard(card.path, btn.rating).then(() => {
				ctx.applySrsCountDelta(card.isNew ? -1 : 0, card.isDue ? -1 : 0);
				container.closest('.timeline-card')?.addClass('timeline-card-reviewed');
				replaceWithUndoButton(ctx, container, card);
			});
		});
	}
}

/**
 * 難易度ボタンをUndoボタンに置換
 */
export function replaceWithUndoButton(ctx: CardRenderContext, container: HTMLElement, card: TimelineCard): void {
	container.empty();
	container.addClass('timeline-difficulty-undo');

	const undoBtn = container.createEl('button', {
		cls: 'timeline-undo-btn',
	});
	undoBtn.createSpan({ text: '\u21A9 Undo' });

	undoBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		void ctx.plugin.undoRating(card.path).then((success) => {
			if (success) {
				ctx.applySrsCountDelta(card.isNew ? 1 : 0, card.isDue ? 1 : 0);
				// レビュー済みクラスを解除
				container.closest('.timeline-card')?.removeClass('timeline-card-reviewed');
				// Undoクラスを除去し難易度ボタンを再描画
				container.removeClass('timeline-difficulty-undo');
				container.empty();
				createDifficultyButtons(ctx, container, card);
			}
		});
	});
}

