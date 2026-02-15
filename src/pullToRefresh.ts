// Timeline Note Launcher - Pull to Refresh
// timelineView.ts から抽出されたプルトゥリフレッシュ機能

/**
 * プルトゥリフレッシュの状態
 */
export interface PullToRefreshState {
	startY: number;
	triggered: boolean;
	indicatorEl: HTMLElement | null;
}

/**
 * デフォルトの初期状態を生成
 */
export function createPullToRefreshState(): PullToRefreshState {
	return {
		startY: 0,
		triggered: false,
		indicatorEl: null,
	};
}

/**
 * タッチ開始ハンドラー（プルトゥリフレッシュ用）
 */
export function handleTouchStart(
	state: PullToRefreshState,
	listContainerEl: HTMLElement,
	e: TouchEvent
): void {
	if (listContainerEl.scrollTop === 0) {
		const touch = e.touches[0];
		if (touch) {
			state.startY = touch.clientY;
		}
	}
}

/**
 * タッチ移動ハンドラー（プルトゥリフレッシュ用）
 */
export function handleTouchMove(
	state: PullToRefreshState,
	listContainerEl: HTMLElement,
	e: TouchEvent
): void {
	if (state.startY === 0) return;
	if (listContainerEl.scrollTop > 0) {
		state.startY = 0;
		hidePullIndicator(state);
		return;
	}

	const touch = e.touches[0];
	if (!touch) return;

	const pullDistance = touch.clientY - state.startY;
	const threshold = 80;

	if (pullDistance > 0) {
		// 引っ張り中 - デフォルトのスクロールを阻止
		e.preventDefault();

		// インジケーターを表示・更新
		showPullIndicator(state, listContainerEl, pullDistance, threshold);

		if (pullDistance >= threshold) {
			state.triggered = true;
		} else {
			state.triggered = false;
		}
	}
}

/**
 * タッチ終了ハンドラー（プルトゥリフレッシュ用）
 */
export function handleTouchEnd(
	state: PullToRefreshState,
	listContainerEl: HTMLElement,
	refresh: () => Promise<void>
): void {
	if (state.triggered) {
		state.triggered = false;
		showPullIndicator(state, listContainerEl, 0, 80, true);  // ローディング状態を表示
		void refresh().then(() => {
			hidePullIndicator(state);
		});
	} else {
		hidePullIndicator(state);
	}
	state.startY = 0;
}

/**
 * プルインジケーターを表示
 */
function showPullIndicator(
	state: PullToRefreshState,
	listContainerEl: HTMLElement,
	distance: number,
	threshold: number,
	loading: boolean = false
): void {
	if (!state.indicatorEl) {
		const el = document.createElement('div');
		el.className = 'timeline-pull-indicator';
		listContainerEl.insertBefore(el, listContainerEl.firstChild);
		state.indicatorEl = el;
	}

	const el = state.indicatorEl;
	const progress = Math.min(distance / threshold, 1);
	const height = Math.min(distance * 0.5, 60);

	el.style.height = `${height}px`;
	el.style.opacity = String(progress);

	el.empty();
	if (loading) {
		el.createSpan({ cls: 'timeline-pull-spinner' });
		el.createSpan({ text: 'Refreshing...' });
		el.classList.add('is-loading');
	} else if (progress >= 1) {
		el.createSpan({ text: '↓' });
		el.createSpan({ text: 'Release to refresh' });
		el.classList.add('is-ready');
		el.classList.remove('is-loading');
	} else {
		el.createSpan({ text: '↓' });
		el.createSpan({ text: 'Pull to refresh' });
		el.classList.remove('is-ready', 'is-loading');
	}
}

/**
 * プルインジケーターを非表示
 */
export function hidePullIndicator(state: PullToRefreshState): void {
	if (state.indicatorEl) {
		state.indicatorEl.remove();
		state.indicatorEl = null;
	}
}
