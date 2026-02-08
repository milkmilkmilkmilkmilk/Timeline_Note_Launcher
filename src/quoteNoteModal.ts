// Timeline Note Launcher - Quote Note Modal
import { App, Modal, Platform, TFile } from 'obsidian';
import type TimelineNoteLauncherPlugin from './main';
import { createQuoteNote, getFileType, isTextReadableFile } from './dataLayer';
import type { FileType } from './types';

export class QuoteNoteModal extends Modal {
	private plugin: TimelineNoteLauncherPlugin;
	private file: TFile;
	private fileType: FileType;
	private noteContent: string = '';
	private previewEl: HTMLPreElement;
	private selectionPreviewEl: HTMLElement;
	private quotesListEl: HTMLElement;
	private titleInput: HTMLInputElement;
	private commentTextArea: HTMLTextAreaElement;
	private currentSelection: string = '';
	private selectedTexts: string[] = [];

	constructor(app: App, plugin: TimelineNoteLauncherPlugin, file: TFile) {
		super(app);
		this.plugin = plugin;
		this.file = file;
		this.fileType = getFileType(file.extension);
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.addClass('timeline-quote-note-modal');

		const isTextReadable = isTextReadableFile(this.fileType);

		// タイトル
		contentEl.createEl('h3', {
			text: `引用ノート: ${this.file.basename}`,
			cls: 'timeline-quote-note-modal-title',
		});

		// ノートプレビューセクション
		const previewSection = contentEl.createDiv({ cls: 'timeline-quote-note-preview-section' });

		if (isTextReadable) {
			// テキスト読取可能: 既存のテキスト選択UI
			this.noteContent = await this.app.vault.cachedRead(this.file);
			previewSection.createEl('label', {
				text: '元ノートの内容（テキスト選択で引用範囲を指定）',
				cls: 'timeline-quote-note-label',
			});

			const previewContainer = previewSection.createDiv({ cls: 'timeline-quote-note-preview-container' });
			this.previewEl = previewContainer.createEl('pre', {
				cls: 'timeline-quote-note-preview',
			});
			this.previewEl.textContent = this.noteContent;

			// 選択テキストプレビュー + 追加ボタン
			const selectionRow = previewSection.createDiv({ cls: 'timeline-quote-note-selection-row' });

			this.selectionPreviewEl = selectionRow.createDiv({
				cls: 'timeline-quote-note-selection-preview',
			});
			this.updateSelectionPreview();

			const addBtn = selectionRow.createEl('button', {
				text: '追加',
				cls: 'timeline-quote-note-add-btn',
			});
			// pointerdownを使用: タッチ/マウス両方で選択が解除される前に処理
			addBtn.addEventListener('pointerdown', (e) => {
				e.preventDefault();
				// DOMから直接選択テキストを取得（selectionchangeに頼らない）
				this.captureSelectionFromDOM();
				this.addCurrentSelection();
			});
		} else {
			// バイナリファイル: ファイル情報 + 手動テキスト入力
			previewSection.createEl('label', {
				text: 'ファイル情報',
				cls: 'timeline-quote-note-label',
			});
			const fileInfoEl = previewSection.createDiv({ cls: 'timeline-quote-note-file-info' });
			fileInfoEl.createDiv({ text: `ファイル名: ${this.file.name}` });
			fileInfoEl.createDiv({ text: `種類: ${this.fileType.toUpperCase()}` });
			fileInfoEl.createDiv({ text: `パス: ${this.file.path}` });

			// 手動引用入力セクション
			const manualSection = previewSection.createDiv({ cls: 'timeline-quote-note-manual-quote-section' });
			manualSection.createEl('label', {
				text: '引用テキストを入力',
				cls: 'timeline-quote-note-label',
			});
			const manualTextarea = manualSection.createEl('textarea', {
				cls: 'timeline-quote-note-manual-textarea',
				attr: {
					placeholder: '引用するテキストをここに入力...',
					rows: '3',
				},
			});
			const addBtn = manualSection.createEl('button', {
				text: '追加',
				cls: 'timeline-quote-note-add-btn',
			});
			addBtn.addEventListener('click', () => {
				const text = manualTextarea.value.trim();
				if (!text) return;
				if (this.selectedTexts.includes(text)) return;
				this.selectedTexts.push(text);
				manualTextarea.value = '';
				this.renderQuotesList();
			});
		}

		// 選択済み引用リスト
		const quotesSection = previewSection.createDiv({ cls: 'timeline-quote-note-quotes-section' });
		quotesSection.createEl('label', {
			text: '選択済みの引用',
			cls: 'timeline-quote-note-label',
		});
		this.quotesListEl = quotesSection.createDiv({ cls: 'timeline-quote-note-quotes-list' });
		this.renderQuotesList();

		// タイトル入力セクション
		const titleSection = contentEl.createDiv({ cls: 'timeline-quote-note-input-section' });
		titleSection.createEl('label', {
			text: 'タイトル（任意）',
			cls: 'timeline-quote-note-label',
		});

		this.titleInput = titleSection.createEl('input', {
			cls: 'timeline-quote-note-title-input',
			attr: {
				type: 'text',
				placeholder: 'タイトルを入力...',
			},
		});

		// コメント入力セクション
		const commentSection = contentEl.createDiv({ cls: 'timeline-quote-note-input-section' });
		commentSection.createEl('label', {
			text: 'コメント',
			cls: 'timeline-quote-note-label',
		});

		this.commentTextArea = commentSection.createEl('textarea', {
			cls: 'timeline-quote-note-textarea',
			attr: {
				placeholder: 'ここにコメントを入力...',
				rows: '5',
			},
		});

		// ドラフトを復元
		const draft = this.plugin.getQuoteNoteDraft(this.file.path);
		if (draft) {
			this.selectedTexts = [...(draft.selectedTexts || [])];
			this.titleInput.value = draft.title;
			this.commentTextArea.value = draft.comment;
			this.renderQuotesList();
		}

		// ボタンセクション
		const buttonSection = contentEl.createDiv({ cls: 'timeline-quote-note-buttons' });

		const cancelBtn = buttonSection.createEl('button', {
			text: 'キャンセル',
			cls: 'timeline-quote-note-btn-cancel',
		});
		cancelBtn.addEventListener('click', () => {
			this.close();
		});

		const createBtn = buttonSection.createEl('button', {
			text: '作成して開く',
			cls: 'timeline-quote-note-btn-create',
		});
		createBtn.addEventListener('click', () => {
			void this.createNote();
		});

		// テキスト選択イベント（テキスト読取可能時のみ）
		if (isTextReadable) {
			document.addEventListener('selectionchange', this.handleSelectionChange);
		}

		// Enter + Ctrl/Cmd で作成
		this.commentTextArea.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void this.createNote();
			}
		});

		// モバイル: キーボード表示時にモーダルを上に配置
		if (Platform.isMobile) {
			this.containerEl.addClass('timeline-modal-mobile-container');
			this.commentTextArea.addEventListener('focus', () => {
				setTimeout(() => {
					this.commentTextArea.scrollIntoView({ block: 'center', behavior: 'smooth' });
				}, 300);
			});
			this.titleInput.addEventListener('focus', () => {
				setTimeout(() => {
					this.titleInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
				}, 300);
			});
		}

		// フォーカスをコメント入力欄に移動
		this.commentTextArea.focus();
	}

	onClose(): void {
		// イベントリスナーを削除
		document.removeEventListener('selectionchange', this.handleSelectionChange);

		// モーダルを閉じるときにドラフトを保存
		void this.plugin.saveQuoteNoteDraft(this.file.path, {
			selectedTexts: this.selectedTexts,
			title: this.titleInput?.value ?? '',
			comment: this.commentTextArea?.value ?? '',
		});
	}

	private handleSelectionChange = (): void => {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) {
			this.currentSelection = '';
			this.updateSelectionPreview();
			return;
		}

		// プレビュー要素内の選択のみを処理
		const range = selection.getRangeAt(0);
		if (this.previewEl.contains(range.commonAncestorContainer)) {
			this.currentSelection = selection.toString();
			this.updateSelectionPreview();
		}
	};

	private updateSelectionPreview(): void {
		if (this.currentSelection.trim()) {
			const truncated = this.currentSelection.length > 80
				? this.currentSelection.substring(0, 80) + '...'
				: this.currentSelection;
			this.selectionPreviewEl.textContent = `選択中: "${truncated}"`;
			this.selectionPreviewEl.addClass('has-selection');
		} else {
			this.selectionPreviewEl.textContent = '選択中: （テキストを選択してください）';
			this.selectionPreviewEl.removeClass('has-selection');
		}
	}

	/**
	 * DOMから直接選択テキストを取得してcurrentSelectionに反映
	 * selectionchangeのタイミング問題を回避するため、ボタン操作時に呼び出す
	 */
	private captureSelectionFromDOM(): void {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) return;
		const range = selection.getRangeAt(0);
		if (this.previewEl?.contains(range.commonAncestorContainer)) {
			this.currentSelection = selection.toString();
		}
	}

	private addCurrentSelection(): void {
		if (!this.currentSelection.trim()) {
			return;
		}

		// 重複チェック
		if (this.selectedTexts.includes(this.currentSelection.trim())) {
			return;
		}

		this.selectedTexts.push(this.currentSelection.trim());
		this.currentSelection = '';
		this.updateSelectionPreview();
		this.renderQuotesList();

		// 選択を解除
		window.getSelection()?.removeAllRanges();
	}

	private removeQuote(index: number): void {
		this.selectedTexts.splice(index, 1);
		this.renderQuotesList();
	}

	private renderQuotesList(): void {
		this.quotesListEl.empty();

		if (this.selectedTexts.length === 0) {
			const emptyText = isTextReadableFile(this.fileType)
				? '引用がまだありません。テキストを選択して「追加」をクリックしてください。'
				: '引用がまだありません。テキストを入力して「追加」をクリックしてください。';
			this.quotesListEl.createDiv({
				cls: 'timeline-quote-note-quotes-empty',
				text: emptyText,
			});
			return;
		}

		for (let i = 0; i < this.selectedTexts.length; i++) {
			const text = this.selectedTexts[i] ?? '';
			const quoteItem = this.quotesListEl.createDiv({ cls: 'timeline-quote-note-quote-item' });

			quoteItem.createSpan({
				cls: 'timeline-quote-note-quote-number',
				text: `${i + 1}.`,
			});

			const truncated = text.length > 100 ? text.substring(0, 100) + '...' : text;
			quoteItem.createSpan({
				cls: 'timeline-quote-note-quote-text',
				text: truncated,
			});

			const removeBtn = quoteItem.createEl('button', {
				cls: 'timeline-quote-note-quote-remove',
				text: '×',
				attr: { 'aria-label': '削除' },
			});
			removeBtn.addEventListener('click', () => {
				this.removeQuote(i);
			});
		}
	}

	private async createNote(): Promise<void> {
		// 引用テキストがない場合は警告
		if (this.selectedTexts.length === 0) {
			this.quotesListEl.addClass('timeline-quote-note-error');
			setTimeout(() => {
				this.quotesListEl.removeClass('timeline-quote-note-error');
			}, 2000);
			return;
		}

		const title = this.titleInput.value.trim();
		const comment = this.commentTextArea.value.trim();

		// ノートを作成
		const template = this.plugin.data.settings.quoteNoteTemplate;
		const newFile = await createQuoteNote(
			this.app,
			this.file,
			this.selectedTexts,
			title,
			comment,
			template
		);

		// ドラフトを削除
		await this.plugin.deleteQuoteNoteDraft(this.file.path);

		// モーダルを閉じる（onCloseでドラフト保存されないように先にクリア）
		this.selectedTexts = [];
		this.titleInput.value = '';
		this.commentTextArea.value = '';
		this.close();

		// 作成したノートを開く
		await this.app.workspace.getLeaf().openFile(newFile);
	}
}
