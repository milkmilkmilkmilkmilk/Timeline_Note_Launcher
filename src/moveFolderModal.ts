// Timeline Note Launcher - Move to Folder Modal
import { App, FuzzySuggestModal, Notice, TFile, TFolder } from 'obsidian';

export class MoveFolderModal extends FuzzySuggestModal<TFolder> {
	private file: TFile;
	private onMoved: () => Promise<void>;

	constructor(app: App, file: TFile, onMoved: () => Promise<void>) {
		super(app);
		this.file = file;
		this.onMoved = onMoved;
		this.setPlaceholder('移動先フォルダを選択...');
		this.setInstructions([
			{ command: '↑↓', purpose: 'ナビゲート' },
			{ command: '↵', purpose: 'フォルダを選択して移動' },
			{ command: 'esc', purpose: 'キャンセル' },
		]);
	}

	getItems(): TFolder[] {
		const folders: TFolder[] = [this.app.vault.getRoot()];
		for (const f of this.app.vault.getAllLoadedFiles()) {
			if (f instanceof TFolder && f.path !== '/') {
				folders.push(f);
			}
		}
		return folders;
	}

	getItemText(folder: TFolder): string {
		// ルートフォルダは "/" で表示
		return folder.path === '/' ? '/' : folder.path;
	}

	onChooseItem(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
		void this.moveFile(folder);
	}

	private async moveFile(folder: TFolder): Promise<void> {
		const folderPath = folder.path === '/' ? '' : folder.path;
		const newPath = folderPath ? `${folderPath}/${this.file.name}` : this.file.name;

		if (newPath === this.file.path) {
			new Notice('すでにこのフォルダにあります');
			return;
		}

		try {
			await this.app.fileManager.renameFile(this.file, newPath);
			new Notice(`"${this.file.basename}" を移動しました`);
			await this.onMoved();
		} catch (error) {
			console.error('Failed to move file:', error);
			new Notice('移動に失敗しました');
		}
	}
}
