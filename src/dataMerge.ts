// Timeline Note Launcher - データマージ関数群
// data.json の同期競合を解決するための純粋関数

import type {
	PluginData,
	ReviewLogs,
	DailyReviewHistory,
	CommentDrafts,
	QuoteNoteDrafts,
	FilterPreset,
} from './types';
import { DEFAULT_DATA } from './types';

/**
 * レビューログをマージ
 * - 両方のパスを和集合で結合
 * - 同じパスは lastReviewedAt が新しい方を採用
 */
export function mergeReviewLogs(local: ReviewLogs, remote: ReviewLogs): ReviewLogs {
	const merged: ReviewLogs = { ...remote };
	for (const path of Object.keys(local)) {
		const localLog = local[path];
		const remoteLog = merged[path];
		if (!localLog) continue;
		if (!remoteLog) {
			merged[path] = localLog;
		} else {
			// lastReviewedAt が新しい方を採用
			const localTime = localLog.lastReviewedAt ?? 0;
			const remoteTime = remoteLog.lastReviewedAt ?? 0;
			merged[path] = localTime >= remoteTime ? localLog : remoteLog;
		}
	}
	return merged;
}

/**
 * 日次統計をマージ
 * - 異なる日付 → 新しい日付の方を採用
 * - 同じ日付 → 各カウントの最大値を取る
 */
export function mergeDailyStats(
	local: PluginData['dailyStats'],
	remote: PluginData['dailyStats']
): PluginData['dailyStats'] {
	if (local.date !== remote.date) {
		// 異なる日付の場合、新しい方を採用
		return local.date > remote.date ? local : remote;
	}
	// 同じ日付の場合、各カウントの最大値を取る
	return {
		date: local.date,
		newReviewed: Math.max(local.newReviewed, remote.newReviewed),
		reviewedCount: Math.max(local.reviewedCount, remote.reviewedCount),
	};
}

/**
 * レビュー履歴をマージ
 * - 全日付の和集合
 * - 同じ日付 → 各カウントの最大値を取る
 */
export function mergeReviewHistory(
	local: DailyReviewHistory,
	remote: DailyReviewHistory
): DailyReviewHistory {
	const merged: DailyReviewHistory = { ...remote };
	for (const date of Object.keys(local)) {
		const localEntry = local[date];
		const remoteEntry = merged[date];
		if (!localEntry) continue;
		if (!remoteEntry) {
			merged[date] = localEntry;
		} else {
			// 各カウントの最大値を取る
			merged[date] = {
				newReviewed: Math.max(localEntry.newReviewed, remoteEntry.newReviewed),
				reviewedCount: Math.max(localEntry.reviewedCount, remoteEntry.reviewedCount),
				fileTypes: {
					markdown: Math.max(localEntry.fileTypes.markdown, remoteEntry.fileTypes.markdown),
					text: Math.max(localEntry.fileTypes.text, remoteEntry.fileTypes.text),
					image: Math.max(localEntry.fileTypes.image, remoteEntry.fileTypes.image),
					pdf: Math.max(localEntry.fileTypes.pdf, remoteEntry.fileTypes.pdf),
					audio: Math.max(localEntry.fileTypes.audio, remoteEntry.fileTypes.audio),
					video: Math.max(localEntry.fileTypes.video, remoteEntry.fileTypes.video),
					office: Math.max(localEntry.fileTypes.office, remoteEntry.fileTypes.office),
					ipynb: Math.max(localEntry.fileTypes.ipynb, remoteEntry.fileTypes.ipynb),
					other: Math.max(localEntry.fileTypes.other, remoteEntry.fileTypes.other),
				},
			};
		}
	}
	return merged;
}

/**
 * コメントドラフトをマージ
 * - リモートをベースに、ローカルで内容があるものを上書き
 */
export function mergeCommentDrafts(local: CommentDrafts, remote: CommentDrafts): CommentDrafts {
	const merged: CommentDrafts = { ...remote };
	for (const path of Object.keys(local)) {
		const localDraft = local[path];
		if (localDraft && localDraft.trim()) {
			merged[path] = localDraft;
		}
	}
	return merged;
}

/**
 * 引用ノートドラフトをマージ
 * - リモートをベースに、ローカルで内容があるものを上書き
 */
export function mergeQuoteNoteDrafts(local: QuoteNoteDrafts, remote: QuoteNoteDrafts): QuoteNoteDrafts {
	const merged: QuoteNoteDrafts = { ...remote };
	for (const path of Object.keys(local)) {
		const localDraft = local[path];
		if (!localDraft) continue;
		const hasContent = localDraft.selectedTexts.some(t => t.trim()) ||
			localDraft.title.trim() ||
			localDraft.comment.trim();
		if (hasContent) {
			merged[path] = localDraft;
		}
	}
	return merged;
}

/**
 * プラグインデータ全体をマージ
 * - settings: ローカルを常に優先
 * - reviewLogs, dailyStats, reviewHistory, drafts: 各マージ戦略に従う
 * - engineVersion: Math.max
 */
export function mergePluginData(local: PluginData, remote: PluginData): PluginData {
	return {
		settings: local.settings,
		reviewLogs: mergeReviewLogs(local.reviewLogs, remote.reviewLogs),
		dailyStats: mergeDailyStats(local.dailyStats, remote.dailyStats),
		reviewHistory: mergeReviewHistory(local.reviewHistory, remote.reviewHistory),
		commentDrafts: mergeCommentDrafts(local.commentDrafts, remote.commentDrafts),
		quoteNoteDrafts: mergeQuoteNoteDrafts(local.quoteNoteDrafts, remote.quoteNoteDrafts),
		filterPresets: mergeFilterPresets(local.filterPresets, remote.filterPresets),
		engineVersion: Math.max(local.engineVersion, remote.engineVersion),
	};
}

/**
 * フィルタープリセットをマージ（ID基準で重複排除、ローカル優先）
 */
function mergeFilterPresets(
	local: FilterPreset[],
	remote: FilterPreset[]
): FilterPreset[] {
	const result = [...local];
	const localIds = new Set(local.map(p => p.id));

	for (const preset of remote) {
		if (!localIds.has(preset.id)) {
			result.push(preset);
		}
	}

	return result;
}

/**
 * 部分データにデフォルト値を適用してフル形状に復元
 */
export function reconstructFullData(diskData: Partial<PluginData> | null): PluginData {
	const base = Object.assign({}, DEFAULT_DATA, diskData);
	base.settings = Object.assign({}, DEFAULT_DATA.settings, diskData?.settings);
	if (!base.dailyStats) {
		base.dailyStats = { ...DEFAULT_DATA.dailyStats };
	}
	if (!base.reviewHistory) {
		base.reviewHistory = {};
	}
	if (!base.commentDrafts) {
		base.commentDrafts = {};
	}
	if (!base.quoteNoteDrafts) {
		base.quoteNoteDrafts = {};
	}
	if (!base.filterPresets) {
		base.filterPresets = [];
	}
	return base;
}
