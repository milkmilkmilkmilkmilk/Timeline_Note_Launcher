// Timeline Note Launcher - Link Note Modal
import { App, Modal, Platform, TFile } from 'obsidian';
import { appendLinksToNote, extractOutgoingLinks, getCompanionNotePath, getFileType } from './dataLayer';
import { FileType, LinkedNote } from './types';

export class LinkNoteModal extends Modal {
	private file: TFile;
	private fileType: FileType;
	private existingLinks: LinkedNote[] = [];
	private selectedNotes: TFile[] = [];
	private searchInput: HTMLInputElement;
	private searchResultsEl: HTMLElement;
	private selectedListEl: HTMLElement;
	private debounceTimer: number | null = null;
	private existingPaths: Set<string>;
	private allMarkdownFiles: TFile[];

	constructor(app: App, file: TFile) {
		super(app);
		this.file = file;
		this.fileType = getFileType(file.extension);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('timeline-link-note-modal');

		// 既存リンクを取得（非マークダウンはコンパニオンノートから読む）
		if (this.fileType !== 'markdown') {
			const companionPath = getCompanionNotePath(this.file);
			const companionFile = this.app.vault.getAbstractFileByPath(companionPath);
			if (companionFile && companionFile instanceof TFile) {
				const cache = this.app.metadataCache.getFileCache(companionFile);
				this.existingLinks = extractOutgoingLinks(this.app, companionFile, cache);
			}
		} else {
			const cache = this.app.metadataCache.getFileCache(this.file);
			this.existingLinks = extractOutgoingLinks(this.app, this.file, cache);
		}

		// キャッシュを初期化
		this.existingPaths = new Set(this.existingLinks.map(l => l.path));
		this.allMarkdownFiles = this.app.vault.getMarkdownFiles();

		// タイトル
		contentEl.createEl('h3', {
			text: `リンクを追加: ${this.file.basename}`,
			cls: 'timeline-link-note-modal-title',
		});

		// 非マークダウンの場合、コンパニオンノートへの保存を通知
		if (this.fileType !== 'markdown') {
			contentEl.createDiv({
				cls: 'timeline-link-note-companion-info',
				text: 'リンクはコンパニオンノートに保存されます。',
			});
		}

		// 既存リンク表示
		if (this.existingLinks.length > 0) {
			const existingSection = contentEl.createDiv({ cls: 'timeline-link-note-existing-section' });
			existingSection.createEl('label', {
				text: '既存のリンク',
				cls: 'timeline-link-note-label',
			});
			const chipsEl = existingSection.createDiv({ cls: 'timeline-link-note-existing-chips' });
			for (const link of this.existingLinks) {
				chipsEl.createSpan({
					cls: 'timeline-link-note-existing-chip',
					text: link.title,
				});
			}
		}

		// 検索入力
		const searchSection = contentEl.createDiv({ cls: 'timeline-link-note-search-section' });
		searchSection.createEl('label', {
			text: 'ノートを検索',
			cls: 'timeline-link-note-label',
		});

		this.searchInput = searchSection.createEl('input', {
			cls: 'timeline-link-note-search-input',
			attr: {
				type: 'text',
				placeholder: 'ノート名を入力して検索...',
			},
		});

		this.searchInput.addEventListener('input', () => {
			if (this.debounceTimer !== null) {
				window.clearTimeout(this.debounceTimer);
			}
			this.debounceTimer = window.setTimeout(() => {
				this.performSearch(this.searchInput.value);
			}, 300);
		});

		// 検索結果リスト
		this.searchResultsEl = searchSection.createDiv({ cls: 'timeline-link-note-search-results' });

		// 選択済みリスト
		const selectedSection = contentEl.createDiv({ cls: 'timeline-link-note-selected-section' });
		selectedSection.createEl('label', {
			text: '選択済みノート',
			cls: 'timeline-link-note-label',
		});
		this.selectedListEl = selectedSection.createDiv({ cls: 'timeline-link-note-selected-list' });
		this.renderSelectedList();

		// ボタンセクション
		const buttonSection = contentEl.createDiv({ cls: 'timeline-link-note-buttons' });

		const cancelBtn = buttonSection.createEl('button', {
			text: 'キャンセル',
			cls: 'timeline-link-note-btn-cancel',
		});
		cancelBtn.addEventListener('click', () => {
			this.close();
		});

		const confirmBtn = buttonSection.createEl('button', {
			text: 'リンクを追加',
			cls: 'timeline-link-note-btn-confirm',
		});
		confirmBtn.addEventListener('click', () => {
			void this.confirmLinks();
		});

		// Ctrl+Enter で確定
		contentEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void this.confirmLinks();
			}
		});

		// モバイル: キーボード表示時にモーダルを上に配置
		if (Platform.isMobile) {
			this.containerEl.addClass('timeline-modal-mobile-container');
			this.searchInput.addEventListener('focus', () => {
				setTimeout(() => {
					this.searchInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
				}, 300);
			});
		}

		// フォーカスを検索入力に
		this.searchInput.focus();
	}

	onClose(): void {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
		}
	}

	private performSearch(query: string): void {
		this.searchResultsEl.empty();

		const trimmed = query.trim().toLowerCase();
		if (!trimmed) return;

		const selectedPaths = new Set(this.selectedNotes.map(f => f.path));

		const results: TFile[] = [];

		for (const f of this.allMarkdownFiles) {
			// 自分自身を除外
			if (f.path === this.file.path) continue;
			// 選択済みを除外
			if (selectedPaths.has(f.path)) continue;

			// basename/path で case-insensitive includes フィルタ
			if (f.basename.toLowerCase().includes(trimmed) || f.path.toLowerCase().includes(trimmed)) {
				results.push(f);
				if (results.length >= 20) break;
			}
		}

		if (results.length === 0) {
			this.searchResultsEl.createDiv({
				cls: 'timeline-link-note-search-empty',
				text: 'ノートが見つかりません。',
			});
			return;
		}

		for (const f of results) {
			const isExisting = this.existingPaths.has(f.path);
			const itemEl = this.searchResultsEl.createDiv({
				cls: `timeline-link-note-search-item ${isExisting ? 'is-existing' : ''}`,
			});

			itemEl.createSpan({
				cls: 'timeline-link-note-search-item-title',
				text: f.basename,
			});

			if (f.parent && f.parent.path !== '/') {
				itemEl.createSpan({
					cls: 'timeline-link-note-search-item-path',
					text: f.parent.path,
				});
			}

			if (isExisting) {
				itemEl.createSpan({
					cls: 'timeline-link-note-search-item-badge',
					text: 'リンク済み',
				});
			} else {
				itemEl.addEventListener('click', () => {
					this.addNote(f);
				});
			}
		}
	}

	private addNote(file: TFile): void {
		if (this.selectedNotes.some(f => f.path === file.path)) return;
		this.selectedNotes.push(file);
		// 再検索して選択済みを反映
		this.performSearch(this.searchInput.value);
		this.renderSelectedList();
	}

	private removeNote(index: number): void {
		this.selectedNotes.splice(index, 1);
		// 再検索して選択済みを反映
		this.performSearch(this.searchInput.value);
		this.renderSelectedList();
	}

	private renderSelectedList(): void {
		this.selectedListEl.empty();

		if (this.selectedNotes.length === 0) {
			this.selectedListEl.createDiv({
				cls: 'timeline-link-note-selected-empty',
				text: 'ノートが未選択です。検索して追加してください。',
			});
			return;
		}

		for (let i = 0; i < this.selectedNotes.length; i++) {
			const note = this.selectedNotes[i];
			if (!note) continue;

			const itemEl = this.selectedListEl.createDiv({ cls: 'timeline-link-note-selected-item' });

			itemEl.createSpan({
				cls: 'timeline-link-note-selected-number',
				text: `${i + 1}.`,
			});

			itemEl.createSpan({
				cls: 'timeline-link-note-selected-title',
				text: note.basename,
			});

			const removeBtn = itemEl.createEl('button', {
				cls: 'timeline-link-note-selected-remove',
				text: '\u00d7',
				attr: { 'aria-label': '削除' },
			});
			removeBtn.addEventListener('click', () => {
				this.removeNote(i);
			});
		}
	}

	private async confirmLinks(): Promise<void> {
		if (this.selectedNotes.length === 0) {
			this.selectedListEl.addClass('timeline-link-note-error');
			setTimeout(() => {
				this.selectedListEl.removeClass('timeline-link-note-error');
			}, 2000);
			return;
		}

		await appendLinksToNote(this.app, this.file, this.selectedNotes, this.fileType);
		this.close();
	}
}
