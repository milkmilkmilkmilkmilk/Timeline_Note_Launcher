// Timeline Note Launcher - Comment Modal
import { App, Modal, TFile } from 'obsidian';
import type TimelineNoteLauncherPlugin from './main';
import { appendCommentToNote } from './dataLayer';

export class CommentModal extends Modal {
	private plugin: TimelineNoteLauncherPlugin;
	private file: TFile;
	private textArea: HTMLTextAreaElement;
	private noteContent: string = '';

	constructor(app: App, plugin: TimelineNoteLauncherPlugin, file: TFile) {
		super(app);
		this.plugin = plugin;
		this.file = file;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.addClass('timeline-comment-modal');

		// ノート内容を読み込み
		this.noteContent = await this.app.vault.cachedRead(this.file);

		// タイトル
		contentEl.createEl('h3', {
			text: `コメントを追加: ${this.file.basename}`,
			cls: 'timeline-comment-modal-title',
		});

		// ノートプレビューセクション
		const previewSection = contentEl.createDiv({ cls: 'timeline-comment-preview-section' });
		previewSection.createEl('label', {
			text: 'ノートの内容',
			cls: 'timeline-comment-label',
		});

		const previewContainer = previewSection.createDiv({ cls: 'timeline-comment-preview-container' });
		const previewEl = previewContainer.createEl('pre', {
			cls: 'timeline-comment-preview',
		});
		previewEl.textContent = this.noteContent;

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

		const saveBtn = buttonSection.createEl('button', {
			text: '保存',
			cls: 'timeline-comment-btn timeline-comment-btn-save',
		});
		saveBtn.addEventListener('click', () => {
			void this.saveComment();
		});

		// Enter + Ctrl/Cmd で保存
		this.textArea.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void this.saveComment();
			}
		});

		// フォーカスをテキストエリアに移動
		this.textArea.focus();
	}

	onClose(): void {
		// モーダルを閉じるときにドラフトを保存
		const comment = this.textArea?.value ?? '';
		void this.plugin.saveCommentDraft(this.file.path, comment);
	}

	private async saveComment(): Promise<void> {
		const comment = this.textArea.value.trim();
		if (!comment) {
			return;
		}

		// ノートにコメントを追記
		await appendCommentToNote(this.app, this.file, comment);

		// ドラフトを削除
		await this.plugin.deleteCommentDraft(this.file.path);

		// モーダルを閉じる（onCloseでドラフト保存されないようにテキストエリアをクリア）
		this.textArea.value = '';
		this.close();
	}
}
