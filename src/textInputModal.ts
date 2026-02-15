// Timeline Note Launcher - Text Input Modal
// timelineView.ts から抽出されたシンプルなテキスト入力モーダル
import { Modal } from 'obsidian';
import type { App } from 'obsidian';

/**
 * シンプルな入力モーダル（プリセット名入力用）
 */
export class TextInputModal extends Modal {
	private result: string | null = null;
	private resolvePromise: ((value: string | null) => void) | null = null;
	private title: string;
	private placeholder: string;

	constructor(app: App, title: string, placeholder: string) {
		super(app);
		this.title = title;
		this.placeholder = placeholder;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('timeline-preset-name-modal');
		contentEl.createEl('h3', { text: this.title });

		const inputEl = contentEl.createEl('input', {
			type: 'text',
			placeholder: this.placeholder,
			cls: 'timeline-preset-name-input',
		});

		const buttonContainer = contentEl.createDiv({ cls: 'timeline-preset-modal-buttons' });

		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => {
			this.result = null;
			this.close();
		});

		const saveBtn = buttonContainer.createEl('button', { text: 'Save', cls: 'mod-cta' });
		saveBtn.addEventListener('click', () => {
			this.result = inputEl.value;
			this.close();
		});

		// Enter キーで保存
		inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				this.result = inputEl.value;
				this.close();
			}
		});

		// フォーカスを入力欄に
		setTimeout(() => inputEl.focus(), 50);
	}

	onClose(): void {
		if (this.resolvePromise) {
			this.resolvePromise(this.result);
		}
	}

	async waitForResult(): Promise<string | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
		});
	}
}
