// Timeline Note Launcher - Statistics Module
// dataLayer.ts から抽出されたレビュー統計・履歴ロジック
import type {
	ReviewLogs,
	DailyReviewHistory,
	FileType,
} from './types';
import { getTodayString } from './types';

/**
 * レビュー履歴を記録
 */
export function recordReviewToHistory(
	history: DailyReviewHistory,
	fileType: FileType,
	isNew: boolean
): DailyReviewHistory {
	const today = getTodayString();
	const existing = history[today] || {
		newReviewed: 0,
		reviewedCount: 0,
		fileTypes: {
			markdown: 0,
			text: 0,
			image: 0,
			pdf: 0,
			audio: 0,
			video: 0,
			office: 0,
			ipynb: 0,
			excalidraw: 0,
			canvas: 0,
			other: 0,
		},
	};

	return {
		...history,
		[today]: {
			newReviewed: existing.newReviewed + (isNew ? 1 : 0),
			reviewedCount: existing.reviewedCount + 1,
			fileTypes: {
				...existing.fileTypes,
				[fileType]: (existing.fileTypes[fileType] ?? 0) + 1,
			},
		},
	};
}

/**
 * 古い履歴をクリーンアップ（30日以上前のデータを削除）
 */
export function cleanupOldHistory(
	history: DailyReviewHistory,
	retentionDays: number = 30
): DailyReviewHistory {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
	const cutoffStr = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;

	const cleaned: DailyReviewHistory = {};
	for (const [date, data] of Object.entries(history)) {
		if (date >= cutoffStr) {
			cleaned[date] = data;
		}
	}

	return cleaned;
}

/**
 * 統計情報
 */
export interface ReviewStatistics {
	totalNotes: number;
	reviewedNotes: number;
	totalReviews: number;
	dueToday: number;
	todayReviews: number;
	todayNewReviews: number;
	weekReviews: number;
	monthReviews: number;
	currentStreak: number;
	fileTypeBreakdown: {
		markdown: number;
		text: number;
		image: number;
		pdf: number;
		audio: number;
		video: number;
		office: number;
		ipynb: number;
		excalidraw: number;
		canvas: number;
		other: number;
	};
	heatmapData: { date: string; count: number }[];
}

export function calculateStatistics(
	logs: ReviewLogs,
	history: DailyReviewHistory
): ReviewStatistics {
	const entries = Object.values(logs);
	const now = Date.now();
	const today = getTodayString();

	// 基本統計
	const totalNotes = entries.length;
	const reviewedNotes = entries.filter(l => l.lastReviewedAt !== null).length;
	const totalReviews = entries.reduce((sum, l) => sum + l.reviewCount, 0);
	const dueToday = entries.filter(l => l.nextReviewAt !== null && l.nextReviewAt <= now).length;

	// 今日の統計
	const todayData = history[today];
	const todayReviews = todayData?.reviewedCount ?? 0;
	const todayNewReviews = todayData?.newReviewed ?? 0;

	// 週間統計
	const weekAgo = new Date();
	weekAgo.setDate(weekAgo.getDate() - 7);
	let weekReviews = 0;
	let monthReviews = 0;

	// 月間統計
	const monthAgo = new Date();
	monthAgo.setDate(monthAgo.getDate() - 30);

	// ファイルタイプ別統計（30日間）
	const fileTypeBreakdown = {
		markdown: 0,
		text: 0,
		image: 0,
		pdf: 0,
		audio: 0,
		video: 0,
		office: 0,
		ipynb: 0,
		excalidraw: 0,
		canvas: 0,
		other: 0,
	};

	// ヒートマップデータ（過去30日）
	const heatmapData: { date: string; count: number }[] = [];
	const dates: string[] = [];
	for (let i = 29; i >= 0; i--) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		dates.push(dateStr);
	}

	for (const dateStr of dates) {
		const data = history[dateStr];
		const count = data?.reviewedCount ?? 0;
		heatmapData.push({ date: dateStr, count });

		// 月間レビュー数を加算
		monthReviews += count;

		// ファイルタイプ別を加算
		if (data?.fileTypes) {
			for (const [type, cnt] of Object.entries(data.fileTypes)) {
				fileTypeBreakdown[type as keyof typeof fileTypeBreakdown] += cnt;
			}
		}
	}

	// 週間レビュー数（過去7日）
	for (let i = 0; i < 7; i++) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		weekReviews += history[dateStr]?.reviewedCount ?? 0;
	}

	// 連続レビュー日数（ストリーク）
	let currentStreak = 0;
	for (let i = 0; i <= 365; i++) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		if (history[dateStr]?.reviewedCount && history[dateStr].reviewedCount > 0) {
			currentStreak++;
		} else {
			// 今日レビューしていない場合は、昨日から数える
			if (i === 0 && !history[dateStr]?.reviewedCount) {
				continue;
			}
			break;
		}
	}

	return {
		totalNotes,
		reviewedNotes,
		totalReviews,
		dueToday,
		todayReviews,
		todayNewReviews,
		weekReviews,
		monthReviews,
		currentStreak,
		fileTypeBreakdown,
		heatmapData,
	};
}
