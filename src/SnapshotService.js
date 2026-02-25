/**
 * ============================================================
 * SnapshotService.gs
 *
 * @overview
 * 原本シートから Snapshot（履歴用シート）を作成・更新するサービス。
 * Snapshot は「値のみ貼り付け」を原則とし、原本の状態を
 * 時点固定データとして保持する。
 *
 * @designPolicy
 * - 原本シートは一切変更しない
 * - Snapshot は履歴（正）として扱う
 * - 同日 Snapshot は上書き更新を許可する
 * - 値のみコピーし、数式は残さない
 *
 * @dependsOn
 * - Config.gs
 * - LoggerUtil.gs
 * ============================================================
 */

/**
 * @namespace SnapshotService
 */
const SnapshotService = {};

/* ============================================================
 * Public Functions
 * ============================================================
 */

/**
 * @description
 * 指定したシート名から Snapshot データを読み取る。
 *
 * @param {string} sheetName 読み取り対象のシート名
 * @returns {Object} { headers, rows } - headers は文字列配列、rows は2次元配列
 */
SnapshotService.readSnapshotData = (sheetName) => {
	const fn = "SnapshotService.readSnapshotData";
	LoggerUtil.start(fn, { sheetName });

	try {
		const ss = SpreadsheetApp.getActive();
		const sheet = ss.getSheetByName(sheetName);
		if (!sheet) {
			throw new Error(`シートが存在しません: ${sheetName}`);
		}

		// ヘッダー行を取得
		const headerRange = sheet.getRange(
			SNAPSHOT_HEADER_ROW,
			1,
			1,
			sheet.getLastColumn(),
		);
		const headers = headerRange.getValues()[0];

		// データ行を取得
		const lastRow = sheet.getLastRow();
		if (lastRow < SNAPSHOT_DATA_START_ROW) {
			// データなし
			return { headers, rows: [] };
		}

		const dataRange = sheet.getRange(
			SNAPSHOT_DATA_START_ROW,
			1,
			lastRow - SNAPSHOT_DATA_START_ROW + 1,
			sheet.getLastColumn(),
		);
		const rows = dataRange.getValues();

		return { headers, rows };
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/**
 * @description
 * 当日分の Snapshot シートを作成または更新する。
 *
 * - 既に当日 Snapshot が存在する場合は上書き更新する
 * - Snapshot 名は「{期番号}_{yyMMdd}」
 *
 * @param {string} method 実行方法（manual / trigger 等）
 * @returns {string} 作成または更新した Snapshot シート名
 */
SnapshotService.createOrUpdateDailySnapshot = (method) => {
	const fn = "SnapshotService.createOrUpdateDailySnapshot";
	LoggerUtil.start(fn, { method });

	try {
		const ss = SpreadsheetApp.getActive();
		const source = ss.getSheetByName(SOURCE_SHEET_NAME);
		if (!source) {
			throw new Error(`原本シートが存在しません: ${SOURCE_SHEET_NAME}`);
		}

		const term = SnapshotService.extractTermNumber_(SOURCE_SHEET_NAME);
		const snapshotName = SnapshotService.buildSnapshotName_(term);

		let snapshot = ss.getSheetByName(snapshotName);
		if (!snapshot) {
			LoggerUtil.info(`Snapshot 新規作成: ${snapshotName}`);
			snapshot = ss.insertSheet(snapshotName);
		} else {
			LoggerUtil.info(`Snapshot 上書き更新: ${snapshotName}`);
			snapshot.clearContents();
		}

		SnapshotService.writeMeta_(snapshot, SOURCE_SHEET_NAME, method);
		SnapshotService.copySourceValues_(source, snapshot);

		return snapshotName;
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/* ============================================================
 * Private Functions
 * ============================================================
 */

/**
 * @private
 * @description
 * 原本シート名から期番号を抽出する。
 *
 * @param {string} sourceName 原本シート名
 * @returns {string} 期番号
 */
SnapshotService.extractTermNumber_ = (sourceName) => {
	const fn = "SnapshotService.extractTermNumber_";
	LoggerUtil.start(fn, { sourceName });

	try {
		const m = sourceName.match(/第(\d+)期/);
		if (!m) {
			throw new Error(`期番号を抽出できません: ${sourceName}`);
		}
		return m[1];
	} finally {
		LoggerUtil.end(fn);
	}
};

/**
 * @private
 * @description
 * Snapshot シート名を生成する。
 *
 * @param {string} term 期番号
 * @returns {string} Snapshot シート名
 */
SnapshotService.buildSnapshotName_ = (term) => {
	const fn = "SnapshotService.buildSnapshotName_";
	LoggerUtil.start(fn, { term });

	try {
		const dateStr = Utilities.formatDate(
			new Date(),
			Session.getScriptTimeZone(),
			"yyMMdd",
		);
		return `${term}_${dateStr}`;
	} finally {
		LoggerUtil.end(fn);
	}
};

/**
 * @private
 * @description
 * Snapshot シートのメタ情報行（1行目）を書き込む。
 *
 * 表示内容：
 * - A1: 元シート名
 * - C1: 最終取得日時
 * - E1: 取得方法
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet Snapshot シート
 * @param {string} sourceName 原本シート名
 * @param {string} method 取得方法
 */
SnapshotService.writeMeta_ = (sheet, sourceName, method) => {
	const fn = "SnapshotService.writeMeta_";
	LoggerUtil.start(fn, { sheet: sheet.getName() });

	try {
		const now = Utilities.formatDate(
			new Date(),
			Session.getScriptTimeZone(),
			"yyyy-MM-dd HH:mm",
		);

		sheet.getRange("A1").setValue(`元=${sourceName}`);
		sheet.getRange("C1").setValue(`最終=${now}`);
		sheet.getRange("E1").setValue(`method=${method}`);

		sheet
			.getRange(1, 1, 1, 6)
			.setBackground(META_BG_COLOR)
			.setFontWeight("bold");
	} finally {
		LoggerUtil.end(fn);
	}
};

/**
 * @private
 * @description
 * 原本シートの内容を Snapshot シートへ「値のみ」でコピーする。
 *
 * - 数式はコピーしない
 * - 書式は原本依存とし、必要な表示調整は diff 側で行う
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} source 原本シート
 * @param {GoogleAppsScript.Spreadsheet.Sheet} snapshot Snapshot シート
 */
SnapshotService.copySourceValues_ = (source, snapshot) => {
	const fn = "SnapshotService.copySourceValues_";
	LoggerUtil.start(fn, {
		source: source.getName(),
		snapshot: snapshot.getName(),
	});

	try {
		const sourceRange = source.getDataRange();

		/**
		 * getValues() を使うことで、
		 * - 数式は評価結果の「値」に変換される
		 * - 「特殊貼り付け ＞ 値のみ貼り付け」と同義になる
		 */
		const values = sourceRange.getValues();

		snapshot
			.getRange(SNAPSHOT_META_ROWS + 1, 1, values.length, values[0].length)
			.setValues(values);

		LoggerUtil.info(
			`Snapshot コピー完了: rows=${values.length}, cols=${values[0].length}`,
		);
	} finally {
		LoggerUtil.end(fn);
	}
};
