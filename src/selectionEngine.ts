// Timeline Note Launcher - Selection Engine
import { SelectionMode, CandidateCard, PluginSettings } from './types';

export interface SelectionResult {
	selectedPaths: string[];
	newCount: number;
	dueCount: number;
}

/**
 * 選択エンジン
 * 入力：候補カード、設定
 * 出力：選択されたパス配列（統計）
 */
export function selectCards(
	cards: CandidateCard[],
	mode: SelectionMode,
	settings: PluginSettings,
	dailyNewReviewed: number = 0,
	dailyReviewedCount: number = 0
): SelectionResult {
	const maxCards = settings.maxCards || 50;

	// 単一パスで統計を排除
	let newCount = 0;
	let dueCount = 0;
	for (const c of cards) {
		if (c.isNew) newCount++;
		if (c.isDue) dueCount++;
	}

	switch (mode) {
		case 'random':
			return {
				selectedPaths: selectRandom(cards).slice(0, maxCards).map(c => c.path),
				newCount, dueCount,
			};

		case 'age-priority':
			return {
				selectedPaths: selectAgePriority(cards).slice(0, maxCards).map(c => c.path),
				newCount, dueCount,
			};

		case 'srs':
			return selectSRS(cards, settings, dailyNewReviewed, dailyReviewedCount, newCount, dueCount);

		default:
			return {
				selectedPaths: selectRandom(cards).slice(0, maxCards).map(c => c.path),
				newCount, dueCount,
			};
	}
}

/**
 * モードA: 単純ランダム（公平性を向上した重み付けランダム）
 * lastSelectedAtが古いほど選ばれやすくなる
 */
function selectRandom(cards: CandidateCard[]): CandidateCard[] {
	const now = Date.now();

	// 重み付けカード配列を作成
	const weighted = cards.map(card => ({
		card,
		weight: calculateRandomWeight(card, now),
	}));

	// 重み付けシャッフル
	return weightedShuffle(weighted).map(w => w.card);
}

/**
 * ランダムモード用の重みを計算
 * lastSelectedAtが古いほど重みを増やす
 */
function calculateRandomWeight(card: CandidateCard, now: number): number {
	let weight = 1;

	// 最後にタイムラインに表示されてからの経過時間で重み付け
	if (card.lastSelectedAt !== null) {
		const daysSinceSelected = (now - card.lastSelectedAt) / (1000 * 60 * 60 * 24);
		weight += Math.min(daysSinceSelected, 30);  // 最大30日分のボーナス
	} else {
		// 一度も表示されていないカードは高い重み
		weight += 30;
	}

	// pinned加点
	if (card.pinned) {
		weight += 10;
	}

	return weight;
}
/**
 * モードB: 古い優先ランダム
 * lastReviewedAt が古いほど重み大、pinned に加点
 */
function selectAgePriority(cards: CandidateCard[]): CandidateCard[] {
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
	cards: CandidateCard[],
	settings: PluginSettings,
	dailyNewReviewed: number,
	dailyReviewedCount: number,
	newCount: number,
	dueCount: number
): SelectionResult {
	// 単一パスで分類
	const dueCards: CandidateCard[] = [];
	const newCards: CandidateCard[] = [];
	const futureCards: CandidateCard[] = [];
	for (const c of cards) {
		if (c.isDue) dueCards.push(c);
		else if (c.isNew) newCards.push(c);
		else futureCards.push(c);
	}

	// 残りの日次制限を計算
	const remainingNew = Math.max(0, settings.newCardsPerDay - dailyNewReviewed);
	const remainingReview = Math.max(0, settings.reviewCardsPerDay - dailyReviewedCount);

	// 1. 期限到来カード（期限が古い順）
	const sortedDue = [...dueCards].sort((a, b) => {
		const aNext = a.nextReviewAt ?? 0;
		const bNext = b.nextReviewAt ?? 0;
		return aNext - bNext;
	});

	// 2. 新規カード（YAML priority順、ランダム）
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

	const maxCards = settings.maxCards || 50;
	const selectedNew = sortedNew.slice(0, Math.min(remainingNew, maxCards));

	const unlockMode = settings.srsReviewUnlockMode ?? 'daily-quota';
	const allowReview = unlockMode === 'new-zero'
		? sortedNew.length === 0
		: remainingNew === 0 || sortedNew.length <= remainingNew;

	const selectedDue: CandidateCard[] = [];
	const selectedFuture: CandidateCard[] = [];
	const selectedRandomFuture: CandidateCard[] = [];

	if (allowReview && remainingReview > 0 && selectedNew.length < maxCards) {
		const reviewCapacity = Math.min(remainingReview, maxCards - selectedNew.length);
		const dueSlice = sortedDue.slice(0, reviewCapacity);
		selectedDue.push(...dueSlice);

		const remainingForFuture = reviewCapacity - selectedDue.length;
		if (remainingForFuture > 0) {
			selectedFuture.push(...sortedFuture.slice(0, remainingForFuture));
		}
	}

	// 間隔が長いカードをランダムに表示
	if (settings.srsShowRandomFutureCards && futureCards.length > 0) {
		const pct = settings.srsRandomFutureCardsPct ?? 10;
		const randomCount = Math.ceil(maxCards * pct / 100);
		// 既に選択されたカードを除外
		const selectedPaths = new Set([
			...selectedNew.map(c => c.path),
			...selectedDue.map(c => c.path),
			...selectedFuture.map(c => c.path),
		]);
		const availableFuture = futureCards.filter(c => !selectedPaths.has(c.path));
		// 間隔が長いカード（interval 30日以上）を優先
		const now = Date.now();
		const longIntervalCards = availableFuture.filter(c => {
			const nextReview = c.nextReviewAt;
			if (!nextReview) return false;
			const daysUntilDue = (nextReview - now) / (1000 * 60 * 60 * 24);
			return daysUntilDue > 30;
		});
		// シャッフルして選択
		const shuffled = [...longIntervalCards];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const temp = shuffled[i];
			shuffled[i] = shuffled[j]!;
			shuffled[j] = temp!;
		}
		selectedRandomFuture.push(...shuffled.slice(0, randomCount));
	}

	const result = [
		...selectedNew,
		...selectedDue,
		...selectedFuture,
		...selectedRandomFuture,
	];

	return {
		selectedPaths: result.map(c => c.path),
		newCount, dueCount,
	};
}

/**
 * 古さ重みを計算
 */
function calculateAgeWeight(card: CandidateCard, now: number): number {
	let weight = 1;

	// 古さによる重み（未レビューは最大重み）
	if (card.lastReviewedAt === null) {
		// 未レビュー: 作成日からの経過日数で重み付け
		if (card.createdAt !== null) {
			const daysSinceCreation = (now - card.createdAt) / (1000 * 60 * 60 * 24);
			weight += Math.min(daysSinceCreation, 100);  // 最大100日分
		} else {
			weight += 50;  // 作成日不明の場合は中程度の重み
		}
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
