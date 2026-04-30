// Timeline Note Launcher - Filter Bar
// timelineView.ts から抽出されたフィルターバー関連のロジック
import { Notice, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type { TimelineCard, FilterPreset } from './types';
import type TimelineNoteLauncherPlugin from './main';
import { TextInputModal } from './textInputModal';

export type SearchMode = 'metadata' | 'content';

/**
 * フィルター状態
 */
export interface FilterBarState {
	searchQuery: string;
	fileTypeFilters: Set<string>;
	selectedTags: Set<string>;
	dateFilterStart: string;
	dateFilterEnd: string;
	isTagsCollapsed: boolean;
	searchDebounceTimer: number | null;
	searchMode: SearchMode;
	// Content モード時のスコア降順 path 集合（最後に実行した検索の結果）
	contentMatchedPaths: Set<string> | null;
}

/**
 * フィルターバーのコンテキスト
 */
export interface FilterBarContext {
	state: FilterBarState;
	cards: TimelineCard[];
	cachedAllTags: string[];
	listContainerEl: HTMLElement;
	app: App;
	plugin: TimelineNoteLauncherPlugin;
	onFilterChanged: () => void;
	render: () => Promise<void>;
}

/**
 * デフォルトのフィルター状態を生成
 */
export function createDefaultFilterBarState(): FilterBarState {
	return {
		searchQuery: '',
		fileTypeFilters: new Set(['markdown', 'text', 'image', 'pdf', 'audio', 'video', 'office', 'ipynb', 'excalidraw', 'canvas', 'other']),
		selectedTags: new Set(),
		dateFilterStart: '',
		dateFilterEnd: '',
		isTagsCollapsed: false,
		searchDebounceTimer: null,
		searchMode: 'metadata',
		contentMatchedPaths: null,
	};
}

/**
 * 全カードからユニークなタグを収集
 */
export function collectAllTags(cards: TimelineCard[]): string[] {
	const tagCounts = new Map<string, number>();

	for (const card of cards) {
		for (const tag of card.tags) {
			tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
		}
	}

	// 出現回数でソートして返す
	return Array.from(tagCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.map(([tag]) => tag);
}

/**
 * フィルタを適用してフィルタ済みカードを返す
 */
export function applyFilters(cards: TimelineCard[], state: FilterBarState): TimelineCard[] {
	return cards.filter(card => {
		// ファイルタイプフィルタ
		if (!state.fileTypeFilters.has(card.fileType)) {
			return false;
		}

		// タグフィルタ（選択タグがある場合、いずれかを含む）
		if (state.selectedTags.size > 0) {
			const hasMatchingTag = card.tags.some(tag => state.selectedTags.has(tag));
			if (!hasMatchingTag) {
				return false;
			}
		}

		// 検索クエリフィルタ
		if (state.searchQuery.trim()) {
			if (state.searchMode === 'content') {
				// 内容検索モード: 事前計算された索引検索結果で絞り込む
				if (!state.contentMatchedPaths || !state.contentMatchedPaths.has(card.path)) {
					return false;
				}
			} else {
				const query = state.searchQuery.toLowerCase();
				const titleMatch = card.title.toLowerCase().includes(query);
				const previewMatch = card.preview.toLowerCase().includes(query);
				const tagMatch = card.tags.some(tag => tag.toLowerCase().includes(query));
				if (!titleMatch && !previewMatch && !tagMatch) {
					return false;
				}
			}
		}

		// 日付範囲フィルタ
		if (state.dateFilterStart || state.dateFilterEnd) {
			const cardDate = card.createdAt;
			if (cardDate === null) {
				return false;  // 日付不明のカードは除外
			}
			if (state.dateFilterStart) {
				const startTimestamp = new Date(state.dateFilterStart).getTime();
				if (cardDate < startTimestamp) {
					return false;
				}
			}
			if (state.dateFilterEnd) {
				// 終了日は23:59:59まで含める
				const endTimestamp = new Date(state.dateFilterEnd).getTime() + 24 * 60 * 60 * 1000 - 1;
				if (cardDate > endTimestamp) {
					return false;
				}
			}
		}

		return true;
	});
}

/**
 * フィルタバーのUI状態を更新
 */
export function updateFilterBarUI(listContainerEl: HTMLElement, state: FilterBarState): void {
	// ファイルタイプボタンの状態更新
	const typeButtons = listContainerEl.querySelectorAll('.timeline-filter-type-btn');
	typeButtons.forEach(btn => {
		const type = btn.getAttribute('data-type');
		if (type) {
			btn.classList.toggle('is-active', state.fileTypeFilters.has(type));
		}
	});

	// タグチップの状態更新
	const tagChips = listContainerEl.querySelectorAll('.timeline-filter-tag-chip');
	tagChips.forEach(chip => {
		const tag = chip.textContent || '';
		chip.classList.toggle('is-selected', state.selectedTags.has(tag));
	});
}

/**
 * フィルターバーを描画
 */
export function renderFilterBar(ctx: FilterBarContext): void {
	const filterBar = ctx.listContainerEl.createDiv({ cls: 'timeline-filter-bar' });

	// 検索セクション
	const searchSection = filterBar.createDiv({ cls: 'timeline-filter-search' });
	const searchIcon = searchSection.createSpan({ cls: 'timeline-search-icon', text: '🔍' });
	searchIcon.setAttribute('aria-hidden', 'true');
	const searchInput = searchSection.createEl('input', {
		cls: 'timeline-search-input',
		attr: {
			type: 'text',
			placeholder: ctx.state.searchMode === 'content' ? 'Search content...' : 'Search...',
			value: ctx.state.searchQuery,
		},
	});
	searchInput.addEventListener('input', (e) => {
		const value = (e.target as HTMLInputElement).value;
		handleSearchInput(ctx, value);
	});
	const modeToggleBtn = searchSection.createEl('button', {
		cls: `timeline-search-mode-btn ${ctx.state.searchMode === 'content' ? 'is-content' : ''}`,
		text: ctx.state.searchMode === 'content' ? '📄' : '🏷',
		attr: {
			'aria-label': ctx.state.searchMode === 'content' ? 'Switch to metadata search' : 'Switch to content search',
			title: ctx.state.searchMode === 'content' ? '内容検索中（クリックでメタデータ検索へ）' : 'メタデータ検索中（クリックで内容検索へ）',
		},
	});
	modeToggleBtn.addEventListener('click', () => {
		if (ctx.state.searchMode === 'metadata') {
			if (!ctx.plugin.searchIndex.isBuilt()) {
				new Notice('検索索引が未構築です。設定から索引を構築してください。');
				return;
			}
			ctx.state.searchMode = 'content';
		} else {
			ctx.state.searchMode = 'metadata';
		}
		ctx.state.contentMatchedPaths = null;
		if (ctx.state.searchQuery.trim()) {
			recomputeContentMatches(ctx);
		}
		ctx.onFilterChanged();
		void ctx.render();
	});

	// フォルダーソースセクション
	renderFolderSourceSection(ctx, filterBar);

	// 日付範囲フィルタ
	const dateSection = filterBar.createDiv({ cls: 'timeline-filter-dates' });
	dateSection.createSpan({ cls: 'timeline-filter-dates-label', text: 'Date:' });
	const dateStartInput = dateSection.createEl('input', {
		cls: 'timeline-date-input',
		attr: {
			type: 'date',
			value: ctx.state.dateFilterStart,
			'aria-label': 'Filter start date',
		},
	});
	dateSection.createSpan({ text: '-' });
	const dateEndInput = dateSection.createEl('input', {
		cls: 'timeline-date-input',
		attr: {
			type: 'date',
			value: ctx.state.dateFilterEnd,
			'aria-label': 'Filter end date',
		},
	});
	dateStartInput.addEventListener('change', (e) => {
		ctx.state.dateFilterStart = (e.target as HTMLInputElement).value;
		ctx.onFilterChanged();
	});
	dateEndInput.addEventListener('change', (e) => {
		ctx.state.dateFilterEnd = (e.target as HTMLInputElement).value;
		ctx.onFilterChanged();
	});
	// クリアボタン
	if (ctx.state.dateFilterStart || ctx.state.dateFilterEnd) {
		const clearBtn = dateSection.createEl('button', {
			cls: 'timeline-date-clear-btn',
			text: '✕',
			attr: { 'aria-label': 'Clear date filter' },
		});
		clearBtn.addEventListener('click', () => {
			ctx.state.dateFilterStart = '';
			ctx.state.dateFilterEnd = '';
			ctx.onFilterChanged();
		});
	}

	// ファイルタイプフィルタ
	const typeFilters = filterBar.createDiv({ cls: 'timeline-filter-types' });
	const fileTypes: { type: string; icon: string; label: string }[] = [
		{ type: 'markdown', icon: '📝', label: 'Markdown' },
		{ type: 'text', icon: '📄', label: 'Text' },
		{ type: 'image', icon: 'IMG', label: 'Image' },
		{ type: 'pdf', icon: '📕', label: 'PDF' },
		{ type: 'audio', icon: '🎵', label: 'Audio' },
		{ type: 'video', icon: '🎬', label: 'Video' },
		{ type: 'office', icon: '📊', label: 'Office' },
		{ type: 'ipynb', icon: '🐍', label: 'Jupyter' },
		{ type: 'excalidraw', icon: '🎨', label: 'Excalidraw' },
		{ type: 'canvas', icon: '🔲', label: 'Canvas' },
	];

	for (const ft of fileTypes) {
		const isActive = ctx.state.fileTypeFilters.has(ft.type);
		const btn = typeFilters.createEl('button', {
			cls: `timeline-filter-type-btn ${isActive ? 'is-active' : ''}`,
			attr: { 'aria-label': ft.label, 'data-type': ft.type },
		});
		btn.textContent = ft.label;
		btn.addEventListener('click', () => toggleFileTypeFilter(ctx, ft.type));
	}

	// タグフィルタ
	const allTags = ctx.cachedAllTags;
	if (allTags.length > 0) {
		const tagSection = filterBar.createDiv({ cls: 'timeline-filter-tags' });
		tagSection.createSpan({ cls: 'timeline-filter-tags-label', text: 'Tags:' });
		const toggleBtn = tagSection.createEl('button', {
			cls: 'timeline-filter-tags-toggle',
			text: ctx.state.isTagsCollapsed ? 'Show' : 'Hide',
			attr: {
				'aria-label': ctx.state.isTagsCollapsed ? 'Show tags' : 'Hide tags',
				'aria-pressed': String(ctx.state.isTagsCollapsed),
			},
		});
		const state = ctx.state;
		const updateToggleState = () => {
			tagSection.toggleClass('is-collapsed', state.isTagsCollapsed);
			toggleBtn.textContent = state.isTagsCollapsed ? 'Show' : 'Hide';
			toggleBtn.setAttribute('aria-label', state.isTagsCollapsed ? 'Show tags' : 'Hide tags');
			toggleBtn.setAttribute('aria-pressed', String(state.isTagsCollapsed));
		};
		updateToggleState();
		toggleBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			state.isTagsCollapsed = !state.isTagsCollapsed;
			updateToggleState();
		});
		const tagChips = tagSection.createDiv({ cls: 'timeline-filter-tag-chips' });

		for (const tag of allTags.slice(0, 10)) {
			const isSelected = ctx.state.selectedTags.has(tag);
			const chip = tagChips.createEl('button', {
				cls: `timeline-filter-tag-chip ${isSelected ? 'is-selected' : ''}`,
				text: tag,
			});
			chip.addEventListener('click', () => toggleTagFilter(ctx, tag));
		}

		if (allTags.length > 10) {
			tagChips.createSpan({
				cls: 'timeline-filter-tag-more',
				text: `+${allTags.length - 10}`,
			});
		}
	}

	// フィルタープリセットセクション
	renderFilterPresets(ctx, filterBar);
}

/**
 * フォルダーソースセクションを描画
 */
function renderFolderSourceSection(ctx: FilterBarContext, container: HTMLElement): void {
	const topFolders = ctx.app.vault.getRoot().children
		.filter((child): child is TFolder => child instanceof TFolder)
		.sort((a, b) => a.name.localeCompare(b.name));

	if (topFolders.length === 0) return;

	const section = container.createDiv({ cls: 'timeline-filter-folders' });
	section.createSpan({ cls: 'timeline-filter-folders-label', text: 'Source:' });

	const currentFolders = ctx.plugin.data.settings.targetFolders;

	const allBtn = section.createEl('button', {
		cls: `timeline-folder-chip ${currentFolders.length === 0 ? 'is-active' : ''}`,
		text: 'All',
		attr: { 'aria-label': 'Show all folders', 'aria-pressed': String(currentFolders.length === 0) },
	});
	allBtn.addEventListener('click', () => {
		ctx.plugin.data.settings.targetFolders = [];
		void saveFolderFilterAndRefresh(ctx);
	});

	for (const folder of topFolders) {
		const isActive = currentFolders.includes(folder.path);
		const chip = section.createEl('button', {
			cls: `timeline-folder-chip ${isActive ? 'is-active' : ''}`,
			text: folder.name,
			attr: { 'aria-label': `Filter by folder: ${folder.name}`, 'aria-pressed': String(isActive) },
		});
		chip.addEventListener('click', () => {
			const folders = ctx.plugin.data.settings.targetFolders;
			const idx = folders.indexOf(folder.path);
			if (idx >= 0) {
				folders.splice(idx, 1);
			} else {
				folders.push(folder.path);
			}
			void saveFolderFilterAndRefresh(ctx);
		});
	}
}

async function saveFolderFilterAndRefresh(ctx: FilterBarContext): Promise<void> {
	await ctx.plugin.saveData(ctx.plugin.data);
	ctx.plugin.refreshAllViews();
}

/**
 * フィルタープリセットを描画
 */
function renderFilterPresets(ctx: FilterBarContext, container: HTMLElement): void {
	const presetSection = container.createDiv({ cls: 'timeline-filter-presets' });

	// 保存ボタン
	const saveBtn = presetSection.createEl('button', {
		cls: 'timeline-preset-save-btn',
		text: '+ save',
		attr: { 'aria-label': 'Save current filter as preset' },
	});
	saveBtn.addEventListener('click', () => {
		void saveCurrentFilterAsPreset(ctx);
	});

	// 既存のプリセット
	const presets = ctx.plugin.getFilterPresets();
	for (const preset of presets) {
		const presetChip = presetSection.createDiv({ cls: 'timeline-preset-chip' });
		const presetName = presetChip.createSpan({
			cls: 'timeline-preset-name',
			text: preset.name,
		});
		presetName.addEventListener('click', () => {
			loadFilterPreset(ctx, preset);
		});
		const deleteBtn = presetChip.createEl('button', {
			cls: 'timeline-preset-delete-btn',
			text: '×',
			attr: { 'aria-label': `Delete preset "${preset.name}"` },
		});
		deleteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void ctx.plugin.deleteFilterPreset(preset.id);
			void ctx.render();
		});
	}
}

/**
 * 現在のフィルタをプリセットとして保存
 */
async function saveCurrentFilterAsPreset(ctx: FilterBarContext): Promise<void> {
	const modal = new TextInputModal(ctx.app, 'Save filter preset', 'Enter preset name');
	modal.open();
	const name = await modal.waitForResult();
	if (!name?.trim()) return;

	const preset: FilterPreset = {
		id: `preset-${Date.now()}`,
		name: name.trim(),
		searchQuery: ctx.state.searchQuery,
		fileTypeFilters: Array.from(ctx.state.fileTypeFilters),
		selectedTags: Array.from(ctx.state.selectedTags),
		dateFilterStart: ctx.state.dateFilterStart,
		dateFilterEnd: ctx.state.dateFilterEnd,
	};

	await ctx.plugin.saveFilterPreset(preset);
	await ctx.render();
}

/**
 * プリセットを読み込み
 */
function loadFilterPreset(ctx: FilterBarContext, preset: FilterPreset): void {
	ctx.state.searchQuery = preset.searchQuery;
	ctx.state.fileTypeFilters = new Set(preset.fileTypeFilters);
	ctx.state.selectedTags = new Set(preset.selectedTags);
	ctx.state.dateFilterStart = preset.dateFilterStart;
	ctx.state.dateFilterEnd = preset.dateFilterEnd;
	if (ctx.state.searchMode === 'content') {
		recomputeContentMatches(ctx);
	}
	void ctx.render();
}

/**
 * 検索入力ハンドラー（デバウンス付き）
 */
function handleSearchInput(ctx: FilterBarContext, query: string): void {
	if (!ctx.listContainerEl) {
		return;
	}
	if (ctx.state.searchDebounceTimer !== null) {
		window.clearTimeout(ctx.state.searchDebounceTimer);
	}

	ctx.state.searchDebounceTimer = window.setTimeout(() => {
		if (!ctx.listContainerEl) {
			return;
		}
		ctx.state.searchQuery = query;
		if (ctx.state.searchMode === 'content') {
			recomputeContentMatches(ctx);
		}
		ctx.onFilterChanged();
	}, 300);
}

/**
 * 内容検索モードでクエリから索引を引いて一致 path 集合を計算
 */
function recomputeContentMatches(ctx: FilterBarContext): void {
	const trimmed = ctx.state.searchQuery.trim();
	if (!trimmed) {
		ctx.state.contentMatchedPaths = null;
		return;
	}
	if (!ctx.plugin.searchIndex.isBuilt()) {
		ctx.state.contentMatchedPaths = new Set();
		return;
	}
	const hits = ctx.plugin.searchIndex.search(trimmed, 500);
	ctx.state.contentMatchedPaths = new Set(hits.map(h => h.path));
}

/**
 * ファイルタイプフィルタをトグル
 */
function toggleFileTypeFilter(ctx: FilterBarContext, type: string): void {
	if (ctx.state.fileTypeFilters.has(type)) {
		// 最低1つは残す
		if (ctx.state.fileTypeFilters.size > 1) {
			ctx.state.fileTypeFilters.delete(type);
		}
	} else {
		ctx.state.fileTypeFilters.add(type);
	}
	ctx.onFilterChanged();
}

/**
 * タグフィルタをトグル
 */
function toggleTagFilter(ctx: FilterBarContext, tag: string): void {
	if (ctx.state.selectedTags.has(tag)) {
		ctx.state.selectedTags.delete(tag);
	} else {
		ctx.state.selectedTags.add(tag);
	}
	ctx.onFilterChanged();
}
