// Timeline Note Launcher - Content Search Index
// BM25 を用いた自前の軽量全文検索索引。
// - 日本語は文字 bigram、英数字は単語トークン化、lowercase 正規化
// - 差分更新 (updateDoc / removeDoc) で起動後のファイル変更に追従
// - シリアライズして data.json に永続化する

/** 1ドキュメントの情報 */
export interface SerializedDoc {
	length: number;
	tfs: Record<string, number>;
}

/** 永続化用の索引スナップショット */
export interface SerializedIndex {
	version: number;
	docs: Record<string, SerializedDoc>;
	totalLength: number;
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const INDEX_VERSION = 1;

/**
 * CJK 判定（ひらがな・カタカナ・漢字・全角英数）
 */
function isCJK(codePoint: number): boolean {
	return (
		(codePoint >= 0x3040 && codePoint <= 0x309F) ||
		(codePoint >= 0x30A0 && codePoint <= 0x30FF) ||
		(codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||
		(codePoint >= 0x3400 && codePoint <= 0x4DBF) ||
		(codePoint >= 0xF900 && codePoint <= 0xFAFF) ||
		(codePoint >= 0xFF10 && codePoint <= 0xFF5E)
	);
}

/**
 * 日本語は 2 文字 bigram、英数字は単語に分割してトークン化
 */
export function tokenize(text: string): string[] {
	const tokens: string[] = [];
	const lower = text.toLowerCase();

	let asciiBuffer = '';
	let cjkRun = '';

	const flushAscii = (): void => {
		if (asciiBuffer.length >= 2) {
			tokens.push(asciiBuffer);
		}
		asciiBuffer = '';
	};

	const flushCjk = (): void => {
		if (cjkRun.length === 1) {
			tokens.push(cjkRun);
		} else if (cjkRun.length >= 2) {
			for (let i = 0; i < cjkRun.length - 1; i++) {
				tokens.push(cjkRun.substring(i, i + 2));
			}
		}
		cjkRun = '';
	};

	for (const ch of lower) {
		const cp = ch.codePointAt(0) ?? 0;
		if (isCJK(cp)) {
			flushAscii();
			cjkRun += ch;
		} else if ((cp >= 0x30 && cp <= 0x39) || (cp >= 0x61 && cp <= 0x7A)) {
			flushCjk();
			asciiBuffer += ch;
		} else {
			flushAscii();
			flushCjk();
		}
	}
	flushAscii();
	flushCjk();

	return tokens;
}

interface DocEntry {
	length: number;
	tfs: Map<string, number>;
}

/**
 * 全文検索索引（BM25）
 */
export class SearchIndex {
	private docs = new Map<string, DocEntry>();
	// token -> 含まれるドキュメントのパス集合（逆引き）
	private postings = new Map<string, Set<string>>();
	private totalLength = 0;
	private built = false;

	isBuilt(): boolean {
		return this.built;
	}

	getDocCount(): number {
		return this.docs.size;
	}

	hasDoc(path: string): boolean {
		return this.docs.has(path);
	}

	/** 全ドキュメント一括構築 */
	build(inputs: ReadonlyArray<{ path: string; text: string }>): void {
		this.docs.clear();
		this.postings.clear();
		this.totalLength = 0;
		for (const input of inputs) {
			this.addDocInternal(input.path, input.text);
		}
		this.built = true;
	}

	/** 1ドキュメント追加/更新 */
	updateDoc(path: string, text: string): void {
		this.removeDocInternal(path);
		this.addDocInternal(path, text);
		this.built = true;
	}

	/** 1ドキュメント削除 */
	removeDoc(path: string): void {
		this.removeDocInternal(path);
	}

	/** リネーム対応（既存エントリを新パスへ移動） */
	renameDoc(oldPath: string, newPath: string): void {
		const entry = this.docs.get(oldPath);
		if (!entry) return;
		this.docs.delete(oldPath);
		this.docs.set(newPath, entry);
		for (const token of entry.tfs.keys()) {
			const posting = this.postings.get(token);
			if (!posting) continue;
			posting.delete(oldPath);
			posting.add(newPath);
		}
	}

	private addDocInternal(path: string, text: string): void {
		const tokens = tokenize(text);
		if (tokens.length === 0) return;
		const tfs = new Map<string, number>();
		for (const t of tokens) {
			tfs.set(t, (tfs.get(t) ?? 0) + 1);
		}
		this.docs.set(path, { length: tokens.length, tfs });
		this.totalLength += tokens.length;
		for (const token of tfs.keys()) {
			let posting = this.postings.get(token);
			if (!posting) {
				posting = new Set<string>();
				this.postings.set(token, posting);
			}
			posting.add(path);
		}
	}

	private removeDocInternal(path: string): void {
		const entry = this.docs.get(path);
		if (!entry) return;
		this.totalLength -= entry.length;
		for (const token of entry.tfs.keys()) {
			const posting = this.postings.get(token);
			if (!posting) continue;
			posting.delete(path);
			if (posting.size === 0) {
				this.postings.delete(token);
			}
		}
		this.docs.delete(path);
	}

	/**
	 * クエリ文字列で BM25 スコア降順検索
	 */
	search(query: string, limit = 50): Array<{ path: string; score: number }> {
		if (!this.built || this.docs.size === 0) return [];
		const tokens = tokenize(query);
		if (tokens.length === 0) return [];

		const uniqueTokens = Array.from(new Set(tokens));
		const N = this.docs.size;
		const avgLength = this.totalLength / N;
		const scores = new Map<string, number>();

		for (const token of uniqueTokens) {
			const posting = this.postings.get(token);
			if (!posting || posting.size === 0) continue;
			const df = posting.size;
			const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
			for (const path of posting) {
				const doc = this.docs.get(path);
				if (!doc) continue;
				const tf = doc.tfs.get(token) ?? 0;
				if (tf === 0) continue;
				const numerator = tf * (BM25_K1 + 1);
				const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / avgLength));
				const contribution = idf * (numerator / denominator);
				scores.set(path, (scores.get(path) ?? 0) + contribution);
			}
		}

		const entries = Array.from(scores, ([path, score]) => ({ path, score }));
		entries.sort((a, b) => b.score - a.score);
		return entries.slice(0, limit);
	}

	serialize(): SerializedIndex {
		const docs: Record<string, SerializedDoc> = {};
		for (const [path, entry] of this.docs) {
			const tfs: Record<string, number> = {};
			for (const [token, freq] of entry.tfs) {
				tfs[token] = freq;
			}
			docs[path] = { length: entry.length, tfs };
		}
		return {
			version: INDEX_VERSION,
			docs,
			totalLength: this.totalLength,
		};
	}

	static deserialize(data: SerializedIndex | null | undefined): SearchIndex {
		const index = new SearchIndex();
		if (!data || data.version !== INDEX_VERSION) return index;
		for (const [path, serialized] of Object.entries(data.docs)) {
			const tfs = new Map<string, number>();
			for (const [token, freq] of Object.entries(serialized.tfs)) {
				tfs.set(token, freq);
			}
			index.docs.set(path, { length: serialized.length, tfs });
			for (const token of tfs.keys()) {
				let posting = index.postings.get(token);
				if (!posting) {
					posting = new Set<string>();
					index.postings.set(token, posting);
				}
				posting.add(path);
			}
		}
		index.totalLength = data.totalLength;
		index.built = index.docs.size > 0;
		return index;
	}
}
