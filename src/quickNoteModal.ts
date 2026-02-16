import { App, Modal, Notice } from 'obsidian';

type QuickNoteSubmitHandler = (content: string) => Promise<void>;

export class QuickNoteModal extends Modal {
	private readonly onSubmit: QuickNoteSubmitHandler;
	private textArea: HTMLTextAreaElement;
	private submitBtn: HTMLButtonElement;
	private isSubmitting = false;

	constructor(app: App, onSubmit: QuickNoteSubmitHandler) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('timeline-quick-note-modal');
		contentEl.createEl('h3', { text: 'Quick note' });

		this.textArea = contentEl.createEl('textarea', {
			cls: 'timeline-quick-note-input',
			attr: {
				placeholder: 'Write a quick note...',
				rows: '10',
			},
		});

		const actions = contentEl.createDiv({ cls: 'timeline-quick-note-actions' });
		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.submitBtn = actions.createEl('button', {
			text: 'Create note',
			cls: 'mod-cta',
		});
		this.submitBtn.addEventListener('click', () => {
			void this.submit();
		});

		this.scope.register(['Mod'], 'Enter', () => {
			void this.submit();
			return false;
		});

		setTimeout(() => this.textArea.focus(), 10);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		if (this.isSubmitting) return;
		this.isSubmitting = true;
		this.submitBtn.disabled = true;

		try {
			await this.onSubmit(this.textArea.value);
			this.close();
		} catch (error) {
			console.error('Failed to create quick note from modal:', error);
			new Notice('Failed to create quick note');
		} finally {
			this.isSubmitting = false;
			if (this.submitBtn) {
				this.submitBtn.disabled = false;
			}
		}
	}
}
