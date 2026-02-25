/**
 * ============================================================
 * SnapshotArchiveService.gs
 *
 * @overview
 * 古い Snapshot シートをアーカイブ（CSV 出力）し、運用に応じて
 * 元シートを削除するユーティリティ。
 *
 * 基本方針（今回の導入案）：
 * - 対象シート名は `^{期番号}_yyMMdd$` 形式（例: 15_260225）と想定
 * - 保持期間は `SNAPSHOT_ARCHIVE_RETENTION_DAYS`（`Config.js`）に従う
 * - アーカイブ先は Drive 内の `SNAPSHOT_ARCHIVE_FOLDER_NAME` フォルダ
 * - デフォルトでは削除しない（`SNAPSHOT_ARCHIVE_DELETE_ENABLED=false`）
 *
 * できること：
 * - archiveOldSnapshots(opts)
 * - restoreFromArchivePrompt(): UI でファイル名を指定して復元
 * - listArchiveFiles(): Drive の一覧取得（ユーティリティ）
 *
 * @dependsOn
 * - Config.js
 * - LoggerUtil.js
 * ============================================================
 */

const SnapshotArchiveService = {};

/**
 * 古い Snapshot シートをアーカイブする
 * @param {{days?:number, dryRun?:boolean}=} opts
 * @returns {{archived:string[], skipped:string[]}}
 */
SnapshotArchiveService.archiveOldSnapshots = (opts) => {
	const fn = 'SnapshotArchiveService.archiveOldSnapshots';
	LoggerUtil.start(fn, { opts });

	try {
		opts = opts || {};
		const retentionDays = typeof opts.days === 'number' ? opts.days : SNAPSHOT_ARCHIVE_RETENTION_DAYS;
		const dryRun = !!opts.dryRun;

		const ss = SpreadsheetApp.getActive();
		const sheets = ss.getSheets();

		const now = new Date();

		const archived = [];
		const skipped = [];

		const folder = SnapshotArchiveService.getOrCreateArchiveFolder_();

		sheets.forEach((sh) => {
			const name = sh.getName();
			// 対象パターン: 期番号_yyMMdd 例: 15_260225
			if (!/^\d+_\d{6}$/.test(name)) return;

			const parts = name.split('_');
			const datePart = parts[1];
			const yy = parseInt(datePart.slice(0, 2), 10);
			const mm = parseInt(datePart.slice(2, 4), 10);
			const dd = parseInt(datePart.slice(4, 6), 10);
			const year = 2000 + yy;
			const sheetDate = new Date(year, mm - 1, dd);

			const ageDays = Math.floor((now - sheetDate) / (1000 * 60 * 60 * 24));

			if (ageDays < retentionDays) {
				skipped.push(name);
				return;
			}

			// CSV に変換して保存
			const csv = SnapshotArchiveService.sheetToCsv_(sh);
			const fileName = `${name}.csv`;

			LoggerUtil.info(`Archive 対象: ${name} (age=${ageDays}日) -> ${fileName}`);

			if (!dryRun) {
				folder.createFile(fileName, csv, MimeType.PLAIN_TEXT);

				// 削除フラグに従って元シートを削除
				if (typeof SNAPSHOT_ARCHIVE_DELETE_ENABLED !== 'undefined' && SNAPSHOT_ARCHIVE_DELETE_ENABLED) {
					ss.deleteSheet(sh);
					LoggerUtil.info(`元シートを削除しました: ${name}`);
				} else {
					LoggerUtil.info(`削除フラグが無効のためシートは残します: ${name}`);
				}
			}

			archived.push(name);
		});

		LoggerUtil.info(`Archive 完了: archived=${archived.length}, skipped=${skipped.length}`);
		return { archived, skipped };
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/**
 * シートを CSV 文字列に変換する
 * @private
 */
SnapshotArchiveService.sheetToCsv_ = (sheet) => {
	const fn = 'SnapshotArchiveService.sheetToCsv_';
	LoggerUtil.start(fn, { sheet: sheet.getName() });

	try {
		const values = sheet.getDataRange().getValues();
		const lines = values.map((row) => {
			return row
				.map((cell) => {
					if (cell === null || typeof cell === 'undefined') return '';
					let s = String(cell);
					// CSV エスケープ: " を "" に置換し、必要ならダブルクオートで囲む
					if (s.indexOf('"') >= 0) s = s.replace(/"/g, '""');
					if (s.indexOf(',') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('"') >= 0) {
						return `"${s}"`;
					}
					return s;
				})
				.join(',');
		});

		return lines.join('\n');
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/**
 * Archive 用フォルダを取得または作成する
 * @private
 */
SnapshotArchiveService.getOrCreateArchiveFolder_ = () => {
	const fn = 'SnapshotArchiveService.getOrCreateArchiveFolder_';
	LoggerUtil.start(fn);

	try {
		const name = typeof SNAPSHOT_ARCHIVE_FOLDER_NAME === 'string' && SNAPSHOT_ARCHIVE_FOLDER_NAME ? SNAPSHOT_ARCHIVE_FOLDER_NAME : 'snapshot_archive';
		const it = DriveApp.getFoldersByName(name);
		if (it.hasNext()) return it.next();
		return DriveApp.createFolder(name);
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/**
 * UI から復元するファイル名を入力して復元する（CSV -> 新規シート）
 */
SnapshotArchiveService.restoreFromArchivePrompt = () => {
	const fn = 'SnapshotArchiveService.restoreFromArchivePrompt';
	LoggerUtil.start(fn);

	try {
		const ui = SpreadsheetApp.getUi();
		const resp = ui.prompt('復元するアーカイブ CSV のファイル名を入力してください（例: 15_260225.csv）', ui.ButtonSet.OK_CANCEL);
		if (resp.getSelectedButton() !== ui.Button.OK) return;
		const fileName = (resp.getResponseText() || '').trim();
		if (!fileName) throw new Error('ファイル名が空です');

		const folder = SnapshotArchiveService.getOrCreateArchiveFolder_();
		const files = folder.getFilesByName(fileName);
		if (!files.hasNext()) throw new Error(`指定ファイルが見つかりません: ${fileName}`);
		const file = files.next();
		const csv = file.getBlob().getDataAsString();

		SnapshotArchiveService.restoreCsvToSheet_(csv, fileName.replace(/\.csv$/i, ''));
		ui.alert('復元が完了しました: ' + fileName);
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/**
 * CSV を新規シートに復元する
 * @private
 */
SnapshotArchiveService.restoreCsvToSheet_ = (csv, sheetNameBase) => {
	const fn = 'SnapshotArchiveService.restoreCsvToSheet_';
	LoggerUtil.start(fn, { sheetNameBase });

	try {
		const ss = SpreadsheetApp.getActive();
		let name = sheetNameBase || 'restored_snapshot';
		let idx = 1;
		while (ss.getSheetByName(name)) {
			name = `${sheetNameBase}_${idx++}`;
		}

		const sheet = ss.insertSheet(name);

		const rows = csv.split('\n').map((r) => {
			// 簡易な CSV パーサ（ダブルクオート囲みには対応）
			const cols = [];
			let cur = '';
			let inQuotes = false;
			for (let i = 0; i < r.length; i++) {
				const ch = r[i];
				if (ch === '"') {
					if (inQuotes && r[i + 1] === '"') {
						cur += '"';
						i++; // skip escaped quote
					} else {
						inQuotes = !inQuotes;
					}
				} else if (ch === ',' && !inQuotes) {
					cols.push(cur);
					cur = '';
				} else {
					cur += ch;
				}
			}
			cols.push(cur);
			return cols;
		});

		if (rows.length > 0) {
			sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
		}

		LoggerUtil.info(`CSV をシートに復元しました: ${name}`);
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/**
 * Drive のアーカイブフォルダ内のファイル名一覧を返す（ユーティリティ）
 */
SnapshotArchiveService.listArchiveFiles = () => {
	const fn = 'SnapshotArchiveService.listArchiveFiles';
	LoggerUtil.start(fn);

	try {
		const folder = SnapshotArchiveService.getOrCreateArchiveFolder_();
		const it = folder.getFiles();
		const out = [];
		while (it.hasNext()) {
			const f = it.next();
			out.push({ name: f.getName(), id: f.getId(), date: f.getLastUpdated() });
		}
		return out;
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};
