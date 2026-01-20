// Timeline Note Launcher - Selection Engine
import { SelectionMode, TimelineCard, PluginSettings } from './types';

export interface SelectionResult {
	cards: TimelineCard[];
	newCount: number;
	dueCount: number;
}

/**
 * 選択エンジン
 * 入力：候補カード＋設定
 * 出力：並び替えられたカード配列＋統計
 */
export function selectCards(
	cards: TimelineCard[],
	mode: SelectionMode,
	settings: PluginSettings,
	dailyNewReviewed: number = 0,
	dailyReviewedCount: number = 0
): SelectionResult {
	const maxCards = settings.maxCards || 50;

	switch (mode) {
		case 'random':
			return {
				cards: selectRandom(cards).slice(0, maxCards),
				newCount: cards.filter(c => c.isNew).length,
				dueCount: cards.filter(c => c.isDue).length,
			};

		case 'age-priority':
			return {
				cards: selectAgePriority(cards).slice(0, maxCards),
				newCount: cards.filter(c => c.isNew).length,
				dueCount: cards.filter(c => c.isDue).length,
			};

		case 'srs':
			return selectSRS(cards, settings, dailyNewReviewed, dailyReviewedCount);

		default:
			return {
				cards: selectRandom(cards).slice(0, maxCards),
				newCount: cards.filter(c => c.isNew).length,
				dueCount: cards.filter(c => c.isDue).length,
			};
	}
}

/**
 * モードA: 単純ランダム
 */
function selectRandom(cards: TimelineCard[]): TimelineCard[] {
	const shuffled = [...cards];

	// Fisher-Yates shuffle
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const temp = shuffled[i];
		shuffled[i] = shuffled[j]!;
		shuffled[j] = temp!;
	}

	return shuffled;
}

/**
 * モードB: 古さ優先ランダム
 * lastReviewedAt が古いほど重み↑、pinned に加点
 */
function selectAgePriority(cards: TimelineCard[]): TimelineCard[] {
	const now = Date.now();

	// 重み付きカード配列を作成
	const weighted = cards.map(card => ({
		card,
		weight: calculateAgeWeight(card, now),
	}));

	// 重み付きランダム選択
	return weightedShuffle(weighted).map(w => w.card);
}

/**
 * モードC: SRS（間隔反復）
 */
function selectSRS(
	cards: TimelineCard[],
	settings: PluginSettings,
	dailyNewReviewed: number,
	dailyReviewedCount: number
): SelectionResult {
	const now = Date.now();

	// カードを分類
	const dueCards = cards.filter(c => c.isDue);
	const newCards = cards.filter(c => c.isNew);
	const futureCards = cards.filter(c => !c.isNew && !c.isDue);

	// 残りの日次制限を計算
	const remainingNew = Math.max(0, settings.newCardsPerDay - dailyNewReviewed);
	const remainingReview = Math.max(0, settings.reviewCardsPerDay - dailyReviewedCount);

	// 優先順位で並べ替え
	// 1. 期限到来カード（期限が古い順）
	const sortedDue = [...dueCards].sort((a, b) => {
		const aNext = a.nextReviewAt ?? 0;
		const bNext = b.nextReviewAt ?? 0;
		return aNext - bNext;
	});

	// 2. 新規カード（YAML priority考慮、ランダム）
	const sortedNew = [...newCards].sort((a, b) => {
		// YAMLの優先度が高いものを先に
		const aPriority = a.yamlPriority ?? 0;
		const bPriority = b.yamlPriority ?? 0;
		if (aPriority !== bPriority) return bPriority - aPriority;
		// 同じならランダム
		return Math.random() - 0.5;
	});

	// 3. 将来のカード（次回レビュー日が近い順）
	const sortedFuture = [...futureCards].sort((a, b) => {
		const aNext = a.nextReviewAt ?? Infinity;
		const bNext = b.nextReviewAt ?? Infinity;
		return aNext - bNext;
	});

	// 制限を適用してマージ
	const selectedDue = sortedDue.slice(0, remainingReview);
	const selectedNew = sortedNew.slice(0, remainingNew);

	// 結果をマージ（期限到来 → 新規 → 将来）
	const maxCards = settings.maxCards || 50;
	const combined: TimelineCard[] = [
		...selectedDue,
		...selectedNew,
	];

	// 残り枠で将来のカードを追加
	const remainingSlots = Math.max(0, maxCards - combined.length);
	const result = [
		...combined,
		...sortedFuture.slice(0, remainingSlots),
	].slice(0, maxCards);

	return {
		cards: result,
		newCount: newCards.length,
		dueCount: dueCards.length,
	};
}

/**
 * 古さ重みを計算
 */
function calculateAgeWeight(card: TimelineCard, now: number): number {
	let weight = 1;

	// 古さによる重み（未レビューは最大重み）
	if (card.lastReviewedAt === null) {
		weight += 100;  // 未レビューは高優先
	} else {
		const daysSinceReview = (now - card.lastReviewedAt) / (1000 * 60 * 60 * 24);
		weight += Math.min(daysSinceReview, 100);  // 最大100日分
	}

	// pinned加点
	if (card.pinned) {
		weight += 20;
	}

	// レビュー回数が少ないほど加点
	const reviewBonus = Math.max(0, 10 - card.reviewCount);
	weight += reviewBonus;

	// YAML priority加点
	if (card.yamlPriority !== null) {
		weight += card.yamlPriority * 10;
	}

	return weight;
}

/**
 * 重み付きシャッフル（O(n log n)）
 * Exponential sortingアルゴリズム: 各アイテムに random^(1/weight) でソートキーを割り当て、
 * ソートすることで重み付きランダム選択を実現
 */
function weightedShuffle<T>(items: { card: T; weight: number }[]): { card: T; weight: number }[] {
	// 各アイテムにソートキーを付与してソート
	return items
		.map(item => ({
			item,
			// 重みが大きいほど、この値が大きくなりやすい
			sortKey: Math.pow(Math.random(), 1 / Math.max(item.weight, 0.001)),
		}))
		.sort((a, b) => b.sortKey - a.sortKey)
		.map(x => x.item);
}
