// Timeline Note Launcher - SRS Engine
// dataLayer.ts から抽出されたSM-2アルゴリズム実装
import type {
	NoteReviewLog,
	ReviewLogs,
	DifficultyRating,
	PluginSettings,
} from './types';
import { DEFAULT_REVIEW_LOG } from './types';

/**
 * レビューログを更新（通常のレビュー）
 */
export function updateReviewLog(
	logs: ReviewLogs,
	path: string
): ReviewLogs {
	const now = Date.now();
	const existing = logs[path] ?? { ...DEFAULT_REVIEW_LOG };

	return {
		...logs,
		[path]: {
			...existing,
			lastReviewedAt: now,
			reviewCount: existing.reviewCount + 1,
		},
	};
}

/**
 * SM-2アルゴリズムに基づいてレビューログを更新
 */
export function updateReviewLogWithSRS(
	logs: ReviewLogs,
	path: string,
	rating: DifficultyRating,
	settings: PluginSettings
): ReviewLogs {
	const now = Date.now();
	const existing = logs[path] ?? { ...DEFAULT_REVIEW_LOG };

	// 難易度に応じた品質スコア（0-5）
	const qualityScore = getQualityScore(rating);

	// 新しい易しさ係数を計算（SM-2）
	let newEaseFactor = existing.easeFactor + (0.1 - (5 - qualityScore) * (0.08 + (5 - qualityScore) * 0.02));
	newEaseFactor = Math.max(1.3, newEaseFactor);  // 最小1.3

	// 新しい間隔を計算
	let newInterval: number;
	if (rating === 'again') {
		// 再度：間隔をリセット
		newInterval = 0;
	} else if (existing.interval === 0) {
		// 初回正解
		newInterval = settings.initialInterval;
	} else if (existing.interval === settings.initialInterval) {
		// 2回目正解
		newInterval = 6;
	} else {
		// 3回目以降
		newInterval = Math.round(existing.interval * newEaseFactor);
	}

	// Easyボーナス
	if (rating === 'easy') {
		newInterval = Math.round(newInterval * settings.easyBonus);
	}

	// Hardは間隔を短縮
	if (rating === 'hard') {
		newInterval = Math.round(newInterval * 0.8);
	}

	// 次回レビュー日を計算
	const nextReviewAt = rating === 'again'
		? now + 10 * 60 * 1000  // 10分後に再度
		: now + newInterval * 24 * 60 * 60 * 1000;

	return {
		...logs,
		[path]: {
			lastReviewedAt: now,
			reviewCount: existing.reviewCount + 1,
			nextReviewAt,
			difficulty: existing.difficulty,  // YAMLで上書き可能
			interval: newInterval,
			easeFactor: newEaseFactor,
		},
	};
}

/**
 * 難易度評価から品質スコアを取得
 */
function getQualityScore(rating: DifficultyRating): number {
	switch (rating) {
		case 'again': return 0;
		case 'hard': return 2;
		case 'good': return 4;
		case 'easy': return 5;
	}
}

/**
 * 次回レビューまでの推定間隔を取得
 */
export function getNextIntervals(
	log: NoteReviewLog | undefined,
	settings: PluginSettings
): { again: string; hard: string; good: string; easy: string } {
	const existing = log ?? { ...DEFAULT_REVIEW_LOG };

	if (existing.interval === 0) {
		// 新規カード
		return {
			again: '10m',
			hard: `${settings.initialInterval}d`,
			good: `${settings.initialInterval}d`,
			easy: `${Math.round(settings.initialInterval * settings.easyBonus)}d`,
		};
	}

	const ef = existing.easeFactor;
	const baseInterval = existing.interval === settings.initialInterval ? 6 : Math.round(existing.interval * ef);

	return {
		again: '10m',
		hard: `${Math.round(baseInterval * 0.8)}d`,
		good: `${baseInterval}d`,
		easy: `${Math.round(baseInterval * settings.easyBonus)}d`,
	};
}

/**
 * 古いログをクリーンアップ
 */
export function cleanupOldLogs(
	logs: ReviewLogs,
	retentionDays: number
): ReviewLogs {
	const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
	const cleaned: ReviewLogs = {};

	for (const [path, log] of Object.entries(logs)) {
		if (log.lastReviewedAt && log.lastReviewedAt > cutoff) {
			cleaned[path] = log;
		}
	}

	return cleaned;
}
