// Timeline Note Launcher - Timeline View Utilities
// timelineView.ts から抽出された純粋ユーティリティ関数群
import type { TimelineCard } from './types';

/**
 * 配列の内容が等しいかを比較
 */
export function arraysEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/**
 * プロパティ値を表示用文字列に変換
 */
export function formatPropertyValue(value: unknown): string {
	if (Array.isArray(value)) {
		return value.map(String).join(', ');
	}
	if (value !== null && typeof value === 'object') {
		return JSON.stringify(value);
	}
	return String(value);
}

/**
 * カードの更新検知用キー
 */
export function buildCardStateKey(card: TimelineCard): string {
	return [
		card.path,
		String(card.lastReviewedAt ?? ''),
		String(card.reviewCount),
		String(card.nextReviewAt ?? ''),
	].join('|');
}

/**
 * 相対日付フォーマット
 */
export function formatRelativeDate(date: Date): string {
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
export function getFileTypeIcon(fileType: string): string {
	switch (fileType) {
		case 'text': return '📄';
		case 'image': return 'IMG';
		case 'pdf': return '📕';
		case 'audio': return '🎵';
		case 'video': return '🎬';
		case 'office': return '📊';
		case 'ipynb': return '🐍';
		case 'excalidraw': return '🎨';
		case 'canvas': return '🔲';
		default: return '📁';
	}
}

/**
 * 次フレームまで待機
 */
export function waitForAnimationFrame(): Promise<void> {
	return new Promise((resolve) => {
		window.requestAnimationFrame(() => resolve());
	});
}
