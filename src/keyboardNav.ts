// Timeline Note Launcher - Keyboard Navigation
// timelineView.ts から抽出されたキーボードナビゲーション
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { TimelineCard, DifficultyRating } from './types';
import type TimelineNoteLauncherPlugin from './main';
import { CommentModal } from './commentModal';
import { QuoteNoteModal } from './quoteNoteModal';
import { LinkNoteModal } from './linkNoteModal';

/**
 * キーボードナビゲーションのコンテキスト
 * focusedIndex はゲッターで最新値を返す想定
 */
export interface KeyboardNavContext {
	readonly filteredCards: TimelineCard[];
	readonly cardElements: HTMLElement[];
	readonly focusedIndex: number;
	updateFocusedIndex(index: number): void;
	readonly plugin: TimelineNoteLauncherPlugin;
	readonly app: App;
	openNote(card: TimelineCard): Promise<void>;
	createDifficultyButtons(container: HTMLElement, card: TimelineCard): void;
	replaceWithUndoButton(container: HTMLElement, card: TimelineCard): void;
	toggleBookmark(path: string): boolean;
	refresh(): Promise<void>;
}

/**
 * キー入力ハンドラー
 */
export function handleKeydown(ctx: KeyboardNavContext, e: KeyboardEvent): void {
	// 入力フィールドにフォーカスがある場合は無視
	const target = e.target as HTMLElement;
	if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
		return;
	}

	switch (e.key) {
		case 'j':
		case 'ArrowDown':
			e.preventDefault();
			focusNextCard(ctx);
			break;
		case 'k':
		case 'ArrowUp':
			e.preventDefault();
			focusPrevCard(ctx);
			break;
		case 'o':
		case 'Enter':
			if (ctx.focusedIndex >= 0) {
				e.preventDefault();
				void openFocusedCard(ctx);
			}
			break;
		case '1':
			if (ctx.focusedIndex >= 0) {
				e.preventDefault();
				void rateFocusedCard(ctx, 'again');
			}
			break;
		case '2':
			if (ctx.focusedIndex >= 0) {
				e.preventDefault();
				void rateFocusedCard(ctx, 'hard');
			}
			break;
		case '3':
			if (ctx.focusedIndex >= 0) {
				e.preventDefault();
				void rateFocusedCard(ctx, 'good');
			}
			break;
		case '4':
			if (ctx.focusedIndex >= 0) {
				e.preventDefault();
				void rateFocusedCard(ctx, 'easy');
			}
			break;
		case 'b':
			if (ctx.focusedIndex >= 0) {
				e.preventDefault();
				toggleFocusedBookmark(ctx);
			}
			break;
		case 'c':
			if (ctx.focusedIndex >= 0) {
				e.preventDefault();
				openFocusedComment(ctx);
			}
			break;
		case 'q':
			if (ctx.focusedIndex >= 0) {
				e.preventDefault();
				openFocusedQuoteNote(ctx);
			}
			break;
		case 'l':
			if (ctx.focusedIndex >= 0) {
				e.preventDefault();
				openFocusedLinkNote(ctx);
			}
			break;
		case 'u':
			if (ctx.focusedIndex >= 0) {
				e.preventDefault();
				void undoFocusedCard(ctx);
			}
			break;
		case 'r':
			e.preventDefault();
			void ctx.refresh();
			break;
		case 'Escape':
			e.preventDefault();
			clearFocus(ctx);
			break;
	}
}

/**
 * 次のカードにフォーカス
 */
function focusNextCard(ctx: KeyboardNavContext): void {
	if (ctx.cardElements.length === 0) return;

	const newIndex = ctx.focusedIndex < ctx.cardElements.length - 1
		? ctx.focusedIndex + 1
		: 0;
	setFocusedIndex(ctx, newIndex);
}

/**
 * 前のカードにフォーカス
 */
function focusPrevCard(ctx: KeyboardNavContext): void {
	if (ctx.cardElements.length === 0) return;

	const newIndex = ctx.focusedIndex > 0
		? ctx.focusedIndex - 1
		: ctx.cardElements.length - 1;
	setFocusedIndex(ctx, newIndex);
}

/**
 * フォーカスインデックスを設定
 */
export function setFocusedIndex(ctx: KeyboardNavContext, index: number): void {
	// 前のフォーカスを解除
	if (ctx.focusedIndex >= 0 && ctx.focusedIndex < ctx.cardElements.length) {
		const prevEl = ctx.cardElements[ctx.focusedIndex];
		if (prevEl) {
			prevEl.removeClass('timeline-card-focused');
		}
	}

	// 新しいフォーカスを設定
	ctx.updateFocusedIndex(index);
	if (index >= 0 && index < ctx.cardElements.length) {
		const cardEl = ctx.cardElements[index];
		if (cardEl) {
			cardEl.addClass('timeline-card-focused');
			cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}
}

/**
 * フォーカスをクリア
 */
export function clearFocus(ctx: KeyboardNavContext): void {
	if (ctx.focusedIndex >= 0 && ctx.focusedIndex < ctx.cardElements.length) {
		const el = ctx.cardElements[ctx.focusedIndex];
		if (el) {
			el.removeClass('timeline-card-focused');
		}
	}
	ctx.updateFocusedIndex(-1);
}

/**
 * フォーカス中のカードを開く
 */
async function openFocusedCard(ctx: KeyboardNavContext): Promise<void> {
	if (ctx.focusedIndex < 0 || ctx.focusedIndex >= ctx.filteredCards.length) return;
	const card = ctx.filteredCards[ctx.focusedIndex];
	if (card) {
		await ctx.openNote(card);
	}
}

/**
 * フォーカス中のカードに難易度評価
 */
async function rateFocusedCard(ctx: KeyboardNavContext, rating: DifficultyRating): Promise<void> {
	if (ctx.focusedIndex < 0 || ctx.focusedIndex >= ctx.filteredCards.length) return;

	const card = ctx.filteredCards[ctx.focusedIndex];
	if (!card) return;

	await ctx.plugin.rateCard(card.path, rating);
	const cardEl = ctx.cardElements[ctx.focusedIndex];
	if (cardEl) {
		cardEl.addClass('timeline-card-reviewed');
		// Undoボタンを表示
		const buttonsEl = cardEl.querySelector('.timeline-difficulty-buttons') as HTMLElement;
		if (buttonsEl) {
			ctx.replaceWithUndoButton(buttonsEl, card);
		}
	}

	// 次のカードにフォーカス
	if (ctx.focusedIndex < ctx.cardElements.length - 1) {
		setFocusedIndex(ctx, ctx.focusedIndex + 1);
	}
}

/**
 * フォーカス中のカードの評価を取り消し
 */
async function undoFocusedCard(ctx: KeyboardNavContext): Promise<void> {
	if (ctx.focusedIndex < 0 || ctx.focusedIndex >= ctx.filteredCards.length) return;

	const card = ctx.filteredCards[ctx.focusedIndex];
	if (!card) return;
	if (!ctx.plugin.hasUndoForCard(card.path)) return;

	const success = await ctx.plugin.undoRating(card.path);
	if (!success) return;

	const cardEl = ctx.cardElements[ctx.focusedIndex];
	if (cardEl) {
		cardEl.removeClass('timeline-card-reviewed');
		// 難易度ボタンを再描画
		const buttonsEl = cardEl.querySelector('.timeline-difficulty-buttons') as HTMLElement;
		if (buttonsEl) {
			buttonsEl.removeClass('timeline-difficulty-undo');
			buttonsEl.empty();
			ctx.createDifficultyButtons(buttonsEl, card);
		}
	}
}

/**
 * フォーカス中のカードのブックマークをトグル
 */
function toggleFocusedBookmark(ctx: KeyboardNavContext): void {
	if (ctx.focusedIndex < 0 || ctx.focusedIndex >= ctx.filteredCards.length) return;

	const card = ctx.filteredCards[ctx.focusedIndex];
	if (!card) return;

	const nowBookmarked = ctx.toggleBookmark(card.path);

	// ブックマークボタンのUIを更新
	const cardEl = ctx.cardElements[ctx.focusedIndex];
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
function openFocusedComment(ctx: KeyboardNavContext): void {
	if (ctx.focusedIndex < 0 || ctx.focusedIndex >= ctx.filteredCards.length) return;

	const card = ctx.filteredCards[ctx.focusedIndex];
	if (!card) return;

	const file = ctx.app.vault.getAbstractFileByPath(card.path);
	if (file && file instanceof TFile) {
		const modal = new CommentModal(ctx.app, ctx.plugin, file);
		modal.open();
	}
}

/**
 * フォーカス中のカードの引用ノートモーダルを開く
 */
function openFocusedQuoteNote(ctx: KeyboardNavContext): void {
	if (ctx.focusedIndex < 0 || ctx.focusedIndex >= ctx.filteredCards.length) return;

	const card = ctx.filteredCards[ctx.focusedIndex];
	if (!card) return;

	const file = ctx.app.vault.getAbstractFileByPath(card.path);
	if (file && file instanceof TFile) {
		const modal = new QuoteNoteModal(ctx.app, ctx.plugin, file);
		modal.open();
	}
}

/**
 * フォーカス中のカードのリンクノートモーダルを開く
 */
function openFocusedLinkNote(ctx: KeyboardNavContext): void {
	if (ctx.focusedIndex < 0 || ctx.focusedIndex >= ctx.filteredCards.length) return;

	const card = ctx.filteredCards[ctx.focusedIndex];
	if (!card) return;

	const file = ctx.app.vault.getAbstractFileByPath(card.path);
	if (file && file instanceof TFile) {
		new LinkNoteModal(ctx.app, ctx.plugin, file).open();
	}
}
