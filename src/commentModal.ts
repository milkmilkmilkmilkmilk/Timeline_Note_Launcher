// Timeline Note Launcher - Comment Modal
import { App, Modal, Notice, Platform, TFile } from 'obsidian';
import type TimelineNoteLauncherPlugin from './main';
import { appendCommentToNote, getFileTypeFromFile, isTextReadableFile } from './dataLayer';
import type { FileType } from './types';

export class CommentModal extends Modal {
	private plugin: TimelineNoteLauncherPlugin;
	private file: TFile;
	private fileType: FileType;
	private textArea: HTMLTextAreaElement;
	private saveBtn: HTMLButtonElement;
	private noteContent: string = '';
	// ドラッグ状態
	private isDragging: boolean = false;
	private dragOffsetX: number = 0;
	private dragOffsetY: number = 0;

	constructor(app: App, plugin: TimelineNoteLauncherPlugin, file: TFile) {
		super(app);
		this.plugin = plugin;
		this.file = file;
		this.fileType = getFileTypeFromFile(file);
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.addClass('timeline-comment-modal');

		// タイトル（ドラッグハンドル）
		const titleEl = contentEl.createEl('h3', {
			text: `コメントを追加: ${this.file.basename}`,
			cls: 'timeline-comment-modal-title timeline-comment-modal-drag-handle',
		});

		// デスクトップのみドラッグ有効化
		if (!Platform.isMobile) {
			this.setupDrag(titleEl);
		}

		// ノートプレビューセクション
		const previewSection = contentEl.createDiv({ cls: 'timeline-comment-preview-section' });

		if (isTextReadableFile(this.fileType)) {
			// テキスト読取可能: 既存のテキストプレビュー
			this.noteContent = await this.app.vault.cachedRead(this.file);
			previewSection.createEl('label', {
				text: 'ノートの内容',
				cls: 'timeline-comment-label',
			});
			const previewContainer = previewSection.createDiv({ cls: 'timeline-comment-preview-container' });
			const previewEl = previewContainer.createEl('pre', {
				cls: 'timeline-comment-preview',
			});
			previewEl.textContent = this.noteContent;
		} else {
			// バイナリファイル: ファイル情報を表示
			previewSection.createEl('label', {
				text: 'ファイル情報',
				cls: 'timeline-comment-label',
			});
			const fileInfoEl = previewSection.createDiv({ cls: 'timeline-comment-file-info' });
			fileInfoEl.createDiv({ text: `ファイル名: ${this.file.name}` });
			fileInfoEl.createDiv({ text: `種類: ${this.fileType.toUpperCase()}` });
			fileInfoEl.createDiv({ text: `パス: ${this.file.path}` });
			previewSection.createDiv({
				cls: 'timeline-comment-file-info-note',
				text: 'コメントはコンパニオンノートに保存されます',
			});
		}

		// コメント入力セクション
		const commentSection = contentEl.createDiv({ cls: 'timeline-comment-input-section' });
		commentSection.createEl('label', {
			text: 'コメント',
			cls: 'timeline-comment-label',
		});

		this.textArea = commentSection.createEl('textarea', {
			cls: 'timeline-comment-textarea',
			attr: {
				placeholder: 'ここにコメントを入力...',
				rows: '5',
			},
		});

		// ドラフトを復元
		const draft = this.plugin.getCommentDraft(this.file.path);
		if (draft) {
			this.textArea.value = draft;
		}

		// ボタンセクション
		const buttonSection = contentEl.createDiv({ cls: 'timeline-comment-buttons' });

		const cancelBtn = buttonSection.createEl('button', {
			text: 'キャンセル',
			cls: 'timeline-comment-btn timeline-comment-btn-cancel',
		});
		cancelBtn.addEventListener('click', () => {
			this.close();
		});

		this.saveBtn = buttonSection.createEl('button', {
			text: '保存',
			cls: 'timeline-comment-btn timeline-comment-btn-save',
		});
		this.saveBtn.addEventListener('click', () => {
			void this.saveComment();
		});

		// テキスト入力に応じて保存ボタンの状態を更新
		this.textArea.addEventListener('input', () => {
			this.updateSaveButtonState();
		});

		// Enter + Ctrl/Cmd で保存
		this.textArea.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void this.saveComment();
			}
		});

		// モバイル: キーボード表示時にモーダルを上に配置
		if (Platform.isMobile) {
			this.containerEl.addClass('timeline-modal-mobile-container');
			this.textArea.addEventListener('focus', () => {
				setTimeout(() => {
					this.textArea.scrollIntoView({ block: 'center', behavior: 'smooth' });
				}, 300);
			});
		}

		// 保存ボタンの初期状態を設定
		this.updateSaveButtonState();

		// フォーカスをテキストエリアに移動
		this.textArea.focus();
	}

	private setupDrag(handleEl: HTMLElement): void {
		const modalEl = this.modalEl;

		const onMouseMove = (e: MouseEvent): void => {
			if (!this.isDragging) return;
			const x = e.clientX - this.dragOffsetX;
			const y = e.clientY - this.dragOffsetY;
			modalEl.style.left = `${x}px`;
			modalEl.style.top = `${y}px`;
		};

		const onMouseUp = (): void => {
			this.isDragging = false;
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		};

		handleEl.addEventListener('mousedown', (e: MouseEvent) => {
			// テキスト選択でなくドラッグ操作
			if (e.button !== 0) return;
			e.preventDefault();

			// 初回ドラッグ時: 中央配置からposition固定に切替
			const rect = modalEl.getBoundingClientRect();
			if (!modalEl.hasClass('timeline-modal-dragged')) {
				modalEl.style.left = `${rect.left}px`;
				modalEl.style.top = `${rect.top}px`;
				modalEl.addClass('timeline-modal-dragged');
			}

			this.isDragging = true;
			this.dragOffsetX = e.clientX - rect.left;
			this.dragOffsetY = e.clientY - rect.top;

			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		});
	}

	onClose(): void {
		// モーダルを閉じるときにドラフトを保存
		const comment = this.textArea?.value ?? '';
		void this.plugin.saveCommentDraft(this.file.path, comment);
	}

	private updateSaveButtonState(): void {
		const hasContent = this.textArea.value.trim().length > 0;
		this.saveBtn.toggleClass('is-active', hasContent);
	}

	private async saveComment(): Promise<void> {
		const comment = this.textArea.value.trim();
		if (!comment) {
			return;
		}

		// ノートにコメントを追記（非マークダウンはコンパニオンノートへ）
		const savedPath = await appendCommentToNote(this.app, this.file, comment, this.fileType);

		// 保存先を通知
		new Notice(`コメントを保存しました: ${savedPath}`);

		// ドラフトを削除
		await this.plugin.deleteCommentDraft(this.file.path);

		// モーダルを閉じる（onCloseでドラフト保存されないようにテキストエリアをクリア）
		this.textArea.value = '';
		this.close();
	}
}
