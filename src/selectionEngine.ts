// Timeline Note Launcher - Selection Engine
import { SelectionMode, CandidateCard, PluginSettings } from './types';

export interface SelectionResult {
	selectedPaths: string[];
	newCount: number;
	dueCount: number;
}

/**
 * 驕ｸ謚槭お繝ｳ繧ｸ繝ｳ
 * 蜈･蜉幢ｼ壼呵｣懊き繝ｼ繝会ｼ玖ｨｭ螳・ * 蜃ｺ蜉幢ｼ夐∈謚槭＆繧後◆繝代せ驟榊・・狗ｵｱ險・ */
export function selectCards(
	cards: CandidateCard[],
	mode: SelectionMode,
	settings: PluginSettings,
	dailyNewReviewed: number = 0,
	dailyReviewedCount: number = 0
): SelectionResult {
	const maxCards = settings.maxCards || 50;

	// 蜊倅ｸ繝代せ縺ｧ邨ｱ險医ｒ髮・ｨ・	let newCount = 0;
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
 * 繝｢繝ｼ繝陰: 蜊倡ｴ斐Λ繝ｳ繝繝
 */
function selectRandom(cards: CandidateCard[]): CandidateCard[] {
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
 * 繝｢繝ｼ繝隠: 蜿､縺募━蜈医Λ繝ｳ繝繝
 * lastReviewedAt 縺悟商縺・⊇縺ｩ驥阪∩竊代｝inned 縺ｫ蜉轤ｹ
 */
function selectAgePriority(cards: CandidateCard[]): CandidateCard[] {
	const now = Date.now();

	// 驥阪∩莉倥″繧ｫ繝ｼ繝蛾・蛻励ｒ菴懈・
	const weighted = cards.map(card => ({
		card,
		weight: calculateAgeWeight(card, now),
	}));

	// 驥阪∩莉倥″繝ｩ繝ｳ繝繝驕ｸ謚・	return weightedShuffle(weighted).map(w => w.card);
}

/**
 * 繝｢繝ｼ繝韻: SRS・磯俣髫泌渚蠕ｩ・・ */
function selectSRS(
	cards: CandidateCard[],
	settings: PluginSettings,
	dailyNewReviewed: number,
	dailyReviewedCount: number,
	newCount: number,
	dueCount: number
): SelectionResult {
	// 蜊倅ｸ繝代せ縺ｧ蛻・｡・
	const dueCards: CandidateCard[] = [];
	const newCards: CandidateCard[] = [];
	const futureCards: CandidateCard[] = [];
	for (const c of cards) {
		if (c.isDue) dueCards.push(c);
		else if (c.isNew) newCards.push(c);
		else futureCards.push(c);
	}

	// 谿九ｊ縺ｮ譌･谺｡蛻ｶ髯舌ｒ險育ｮ・
	const remainingNew = Math.max(0, settings.newCardsPerDay - dailyNewReviewed);
	const remainingReview = Math.max(0, settings.reviewCardsPerDay - dailyReviewedCount);

	// 1. 譛滄剞蛻ｰ譚･繧ｫ繝ｼ繝会ｼ域悄髯舌′蜿､縺・・ｼ・
	const sortedDue = [...dueCards].sort((a, b) => {
		const aNext = a.nextReviewAt ?? 0;
		const bNext = b.nextReviewAt ?? 0;
		return aNext - bNext;
	});

	// 2. 譁ｰ隕上き繝ｼ繝会ｼ・AML priority閠・・縲√Λ繝ｳ繝繝・・
	const sortedNew = [...newCards].sort((a, b) => {
		// YAML縺ｮ蜆ｪ蜈亥ｺｦ縺碁ｫ倥＞繧ゅ・繧貞・縺ｫ
		const aPriority = a.yamlPriority ?? 0;
		const bPriority = b.yamlPriority ?? 0;
		if (aPriority !== bPriority) return bPriority - aPriority;
		// 蜷後§縺ｪ繧峨Λ繝ｳ繝繝
		return Math.random() - 0.5;
	});

	// 3. 蟆・擂縺ｮ繧ｫ繝ｼ繝会ｼ域ｬ｡蝗槭Ξ繝薙Η繝ｼ譌･縺瑚ｿ代＞鬆・ｼ・
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

	if (allowReview && remainingReview > 0 && selectedNew.length < maxCards) {
		const reviewCapacity = Math.min(remainingReview, maxCards - selectedNew.length);
		const dueSlice = sortedDue.slice(0, reviewCapacity);
		selectedDue.push(...dueSlice);

		const remainingForFuture = reviewCapacity - selectedDue.length;
		if (remainingForFuture > 0) {
			selectedFuture.push(...sortedFuture.slice(0, remainingForFuture));
		}
	}

	const result = [
		...selectedNew,
		...selectedDue,
		...selectedFuture,
	];

	return {
		selectedPaths: result.map(c => c.path),
		newCount, dueCount,
	};
}

/**
 * 蜿､縺暮㍾縺ｿ繧定ｨ育ｮ・ */
function calculateAgeWeight(card: CandidateCard, now: number): number {
	let weight = 1;

	// 蜿､縺輔↓繧医ｋ驥阪∩・域悴繝ｬ繝薙Η繝ｼ縺ｯ譛螟ｧ驥阪∩・・	if (card.lastReviewedAt === null) {
		weight += 100;  // 譛ｪ繝ｬ繝薙Η繝ｼ縺ｯ鬮伜━蜈・	} else {
		const daysSinceReview = (now - card.lastReviewedAt) / (1000 * 60 * 60 * 24);
		weight += Math.min(daysSinceReview, 100);  // 譛螟ｧ100譌･蛻・	}

	// pinned蜉轤ｹ
	if (card.pinned) {
		weight += 20;
	}

	// 繝ｬ繝薙Η繝ｼ蝗樊焚縺悟ｰ代↑縺・⊇縺ｩ蜉轤ｹ
	const reviewBonus = Math.max(0, 10 - card.reviewCount);
	weight += reviewBonus;

	// YAML priority蜉轤ｹ
	if (card.yamlPriority !== null) {
		weight += card.yamlPriority * 10;
	}

	return weight;
}

/**
 * 驥阪∩莉倥″繧ｷ繝｣繝・ヵ繝ｫ・・(n log n)・・ * Exponential sorting繧｢繝ｫ繧ｴ繝ｪ繧ｺ繝: 蜷・い繧､繝・Β縺ｫ random^(1/weight) 縺ｧ繧ｽ繝ｼ繝医く繝ｼ繧貞牡繧雁ｽ薙※縲・ * 繧ｽ繝ｼ繝医☆繧九％縺ｨ縺ｧ驥阪∩莉倥″繝ｩ繝ｳ繝繝驕ｸ謚槭ｒ螳溽樟
 */
function weightedShuffle<T>(items: { card: T; weight: number }[]): { card: T; weight: number }[] {
	// 蜷・い繧､繝・Β縺ｫ繧ｽ繝ｼ繝医く繝ｼ繧剃ｻ倅ｸ弱＠縺ｦ繧ｽ繝ｼ繝・	return items
		.map(item => ({
			item,
			// 驥阪∩縺悟､ｧ縺阪＞縺ｻ縺ｩ縲√％縺ｮ蛟､縺悟､ｧ縺阪￥縺ｪ繧翫ｄ縺吶＞
			sortKey: Math.pow(Math.random(), 1 / Math.max(item.weight, 0.001)),
		}))
		.sort((a, b) => b.sortKey - a.sortKey)
		.map(x => x.item);
}


