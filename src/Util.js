/**
 * ============================================================
 * Util.gs
 *
 * @overview
 * 横断的に使用するユーティリティ関数群。
 * 業務ロジックや Spreadsheet API には依存しない。
 *
 * @designPolicy
 * - “差分が暴れる原因”になりやすい空行・空白・改行を安定化させる
 * - diff 判定用（normalizeDiffValue_）と、表示用（normalizeHeaderName_）を分離する
 * - try-catch / logging を徹底し、原因特定できるログを残す
 *
 * @dependsOn
 * - Config.gs（DEBUG_VERBOSE / DIFF_* 設定）
 * - LoggerUtil.gs
 * ============================================================
 */

/**
 * @description
 * ヘッダー名の比較用正規化（改行や余計な空白を除去）。
 *
 * - シートのヘッダーセルに改行が混入していても列判定が壊れないようにする
 *
 * @param {string} header
 * @returns {string}
 */
function normalizeHeaderName_(header) {
  if (header === null || typeof header === 'undefined') return '';
  return String(header)
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .trim();
}

/**
 * @description
 * Snapshotシートからヘッダー以降のデータ範囲（values）を安全に取得する。
 *
 * 重要:
 * - getRange(row, col, numRows, numCols) の第3引数は「最終行番号」ではなく「行数」。
 * - lastRow を直接入れると、下の空行を大量に含んで diff が暴れやすい。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Array<Array<any>>}
 */
function getSnapshotDataValues_(sheet) {
  const fn = 'getSnapshotDataValues_';
  LoggerUtil.start(fn, { sheet: sheet.getName() });

  try {
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    const numRows = Math.max(0, lastRow - SNAPSHOT_DATA_START_ROW + 1);
    if (numRows === 0 || lastCol === 0) {
      LoggerUtil.info('データ範囲なし');
      return [];
    }

    const values = sheet.getRange(SNAPSHOT_DATA_START_ROW, 1, numRows, lastCol).getValues();
    LoggerUtil.info(`データ取得: rows=${values.length}, cols=${lastCol}`);

    if (DEBUG_VERBOSE) {
      const sampleCount = Math.min(2, values.length);
      for (let i = 0; i < sampleCount; i++) {
        LoggerUtil.info(`snapshotDataSample[${i}]=${JSON.stringify(values[i])}`);
      }
    }

    return values;

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/**
 * @description
 * diff 対象となる「実データ行」のみを抽出する。
 *
 * - 全列が空（null / '' / 空白のみ）の行は除外
 * - UI 上の見た目と GAS 上の配列差異を解消する目的
 *
 * @param {Array<Array<any>>} rows getValues() で取得した行配列
 * @returns {Array<Array<any>>} 実データ行のみ
 */
function extractEffectiveRows_(rows) {
  const fn = 'extractEffectiveRows_';
  LoggerUtil.start(fn, { inputRows: rows ? rows.length : 0 });

  try {
    const safeRows = rows || [];
    const filtered = safeRows.filter(row =>
      (row || []).some(v => v !== '' && v !== null && String(v).trim() !== '')
    );

    LoggerUtil.info(`実データ行抽出: before=${safeRows.length}, after=${filtered.length}`);

    if (DEBUG_VERBOSE) {
      const sampleCount = Math.min(3, filtered.length);
      for (let i = 0; i < sampleCount; i++) {
        LoggerUtil.info(`effectiveRowSample[${i}]=${JSON.stringify(filtered[i])}`);
      }
    }

    return filtered;

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/**
 * @description
 * diff 判定用にセル値を正規化する。
 *
 * 方針:
 * - 列名(header)に応じて「意味が同じなら同じ値」になるよう整形する
 * - 表示上の期待（計上月=yyyy年M月、入金予定日=M/d、利益率=%）に合わせる
 *
 * 注意:
 * - “表示用”ではなく“判定用”。DiffDetail/Slackの表示整形とは別。
 * - ここで改行や前後空白を潰すことで「備考の改行差分」ノイズも抑えられる。
 *
 * @param {any} value セル値
 * @param {string} header 列名
 * @returns {string|number|null}
 */
function normalizeDiffValue_(value, header) {
  if (value === null || value === '') return null;

  const tz = Session.getScriptTimeZone();
  const h = normalizeHeaderName_(header);

  // ログ対象列（必要に応じて追加）
  const debugHeaders = ['計上月', '入金予定日', '予定利益率', '利益率', 'SecNO'];
  if (DEBUG_VERBOSE && debugHeaders.includes(h)) {
    LoggerUtil.info(
      `[normalizeDiffValue_] header=${h} raw=${String(value)} type=${Object.prototype.toString.call(value)}`
    );
  }

  let result;

  // Date系（列ごと）
  if (value instanceof Date) {
    if (DIFF_YEAR_MONTH_COLUMNS.includes(h)) {
      result = Utilities.formatDate(value, tz, 'yyyy年M月');
    } else if (DIFF_MONTH_DAY_COLUMNS.includes(h)) {
      result = Utilities.formatDate(value, tz, 'M/d');
    } else {
      result = Utilities.formatDate(value, tz, 'yyyy-MM-dd');
    }

  // 数値系（％も含む）
  } else if (typeof value === 'number') {
    if (DIFF_PERCENT_0_COLUMNS.includes(h)) {
      // 例: 0.1234 → 0.12（比率として2桁へ）
      result = Math.round(value * 100) / 100;
    } else if (DIFF_PERCENT_1_COLUMNS.includes(h)) {
      // 例: 0.1234 → 0.123（比率として3桁へ）
      result = Math.round(value * 1000) / 1000;
    } else {
      result = value;
    }

  // 文字列系（改行・前後空白を正規化）
  } else if (typeof value === 'string') {
    result = value
      .replace(/\r\n/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\r/g, ' ')
      .trim();

  } else {
    // boolean / object など
    result = value;
  }

  if (DEBUG_VERBOSE && debugHeaders.includes(h)) {
    LoggerUtil.info(`[normalizeDiffValue_] header=${h} normalized=${String(result)}`);
  }

  return result;
}
