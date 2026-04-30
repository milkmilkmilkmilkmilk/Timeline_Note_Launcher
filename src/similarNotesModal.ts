// Timeline Note Launcher - Similar Notes Modal
// 現在のノートに類似するノート一覧を表示する。
// - 各項目クリックで該当ノートを新ペインで開く
// - Ctrl/Cmd+クリックでリンク付与モーダルを開く

import { App, Modal, Platform, TFile } from 'obsidian';
import type TimelineNoteLauncherPlugin from './main';
import { LinkNoteModal } from './linkNoteModal';

export class SimilarNotesModal extends Modal {
	private plugin: TimelineNoteLauncherPlugin;
	private sourceFile: TFile;
	private queryText: string;

	constructor(app: App, plugin: TimelineNoteLauncherPlugin, sourceFile: TFile, queryText: string) {
		super(app);
		this.plugin = plugin;
		this.sourceFile = sourceFile;
		this.queryText = queryText;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('timeline-similar-notes-modal');

		contentEl.createEl('h3', {
			text: `類似ノート: ${this.sourceFile.basename}`,
			cls: 'timeline-similar-notes-title',
		});

		contentEl.createDiv({
			cls: 'timeline-similar-notes-hint',
			text: 'クリックで開く / Ctrl/Cmd+クリックでリンク付与',
		});

		const results = this.plugin.searchIndex.search(this.queryText, 30)
			.filter(r => r.path !== this.sourceFile.path);

		const listEl = contentEl.createDiv({ cls: 'timeline-similar-notes-list' });

		if (results.length === 0) {
			listEl.createDiv({
				cls: 'timeline-similar-notes-empty',
				text: '類似するノートが見つかりませんでした。',
			});
			return;
		}

		for (const result of results) {
			const file = this.app.vault.getAbstractFileByPath(result.path);
			if (!(file instanceof TFile)) continue;

			const itemEl = listEl.createDiv({ cls: 'timeline-similar-notes-item' });

			const titleEl = itemEl.createDiv({ cls: 'timeline-similar-notes-item-title' });
			titleEl.createSpan({
				cls: 'timeline-similar-notes-item-name',
				text: file.basename,
			});
			titleEl.createSpan({
				cls: 'timeline-similar-notes-item-score',
				text: `score: ${result.score.toFixed(2)}`,
			});

			if (file.parent && file.parent.path !== '/') {
				itemEl.createDiv({
					cls: 'timeline-similar-notes-item-path',
					text: file.parent.path,
				});
			}

			itemEl.addEventListener('click', (event) => {
				if (event.ctrlKey || event.metaKey) {
					new LinkNoteModal(this.app, this.plugin, this.sourceFile).open();
					this.close();
					return;
				}
				void this.openFile(file);
				this.close();
			});
		}

		if (Platform.isMobile) {
			this.containerEl.addClass('timeline-modal-mobile-container');
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async openFile(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.openFile(file);
	}
}
