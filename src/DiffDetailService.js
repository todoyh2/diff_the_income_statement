/**
 * ============================================================
 * DiffDetailService.gs
 *
 * @overview
 * diff_detail_XXXX シート（詳細差分一覧）を生成するサービス。
 *
 * @designPolicy
 * - diff 判定は DiffCore に委譲し、本サービスは「出力」に徹する
 * - 表示品質を上げるため、Column/OldValue/NewValue は正規化（改行除去）する
 * - try-catch / logging を徹底し、原因特定できるログを残す
 *
 * @dependsOn
 * - Config.gs
 * - LoggerUtil.gs
 * - Util.gs（必要なら）
 * ============================================================
 */

/**
 * @namespace DiffDetailService
 */
const DiffDetailService = {};

/**
 * @description
 * diff_detail シートを作成する。
 *
 * @param {string} prevName 比較元シート名
 * @param {string} currName 比較先シート名
 * @param {Array<Object>} diffs DiffCore.buildDiff の結果
 * @param {Array<string>} headers ヘッダー配列（列名）
 * @param {{add:number,del:number,mod:number}} summary 件数要約
 * @returns {string} 作成した詳細シート名
 */
DiffDetailService.generate = function (prevName, currName, diffs, headers, summary) {
  const fn = 'DiffDetailService.generate';
  LoggerUtil.start(fn, {
    prevName,
    currName,
    diffCount: diffs ? diffs.length : 0,
    summary
  });

  try {
    const ss = SpreadsheetApp.getActive();

    const detailSheetName = DiffDetailService.buildDetailSheetName_(prevName, currName);
    const sheet = DiffDetailService.createOrReplaceSheet_(ss, detailSheetName);

    // ヘッダー行
    DiffDetailService.writeHeader_(sheet);

    // メタ行（要望があればここに出せる。現状は最小で控えめ）
    DiffDetailService.writeMeta_(sheet, prevName, currName, summary);

    // データ行生成
    const rows = DiffDetailService.buildDetailRows_(diffs, headers);

    // 書き込み（3行目以降へ）
    if (rows.length > 0) {
      sheet.getRange(3, 1, rows.length, rows[0].length).setValues(rows);
    }

    // 見た目調整
    DiffDetailService.applyFormat_(sheet, rows.length);

    LoggerUtil.info(`diff_detail 出力完了: sheet=${detailSheetName} rows=${rows.length}`);
    return detailSheetName;

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
};

/* ============================================================
 * Private: Sheet name / create
 * ============================================================
 */

/**
 * @private
 * @description
 * diff_detail シート名を生成する。
 * 例: diff_detail_15_260203_vs_15_260206
 *
 * @param {string} prevName
 * @param {string} currName
 * @returns {string}
 */
DiffDetailService.buildDetailSheetName_ = function (prevName, currName) {
  return `diff_detail_${prevName}_vs_${currName}`;
};

/**
 * @private
 * @description
 * 同名シートがあれば削除し、作り直す（履歴を残す方針ならここを変更）。
 *
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @param {string} name
 * @returns {SpreadsheetApp.Sheet}
 */
DiffDetailService.createOrReplaceSheet_ = function (ss, name) {
  const fn = 'DiffDetailService.createOrReplaceSheet_';
  LoggerUtil.start(fn, { name });

  try {
    const exist = ss.getSheetByName(name);
    if (exist) {
      ss.deleteSheet(exist);
      LoggerUtil.info(`既存 diff_detail シートを削除: ${name}`);
    }
    const sheet = ss.insertSheet(name);
    return sheet;

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
};

/* ============================================================
 * Private: Header / Meta
 * ============================================================
 */

/**
 * @private
 * @description
 * 詳細シートのヘッダー行（2行目）を出力する。
 *
 * @param {SpreadsheetApp.Sheet} sheet
 */
DiffDetailService.writeHeader_ = function (sheet) {
  const fn = 'DiffDetailService.writeHeader_';
  LoggerUtil.start(fn);

  try {
    // 1行目はメタ情報（writeMeta_ が書く）。2行目がヘッダー。
    const headers = [
      'Type',
      'Row',
      'SecNO',
      'Column',
      'OldValue',
      'NewValue'
    ];
    sheet.getRange(2, 1, 1, headers.length).setValues([headers]);

    // ヘッダー見た目
    sheet.getRange(2, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(2);

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
};

/**
 * @private
 * @description
 * 1行目にメタ情報を 1 行で書き出す（背景色つき）。
 *
 * @param {SpreadsheetApp.Sheet} sheet
 * @param {string} prevName
 * @param {string} currName
 * @param {{add:number,del:number,mod:number}} summary
 */
DiffDetailService.writeMeta_ = function (sheet, prevName, currName, summary) {
  const fn = 'DiffDetailService.writeMeta_';
  LoggerUtil.start(fn);

  try {
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const total = summary.mod + summary.add + summary.del;

    sheet.getRange('A1').setValue(
      `比較元=${prevName} | 比較先=${currName} | 実行=${now}  ` +
      `【結果】総数：${total}（ MODIFY=${summary.mod} | ADD=${summary.add} | DELETE=${summary.del} ）`
    );

    sheet.getRange(1, 1, 1, 8)
      .setBackground(META_BG_COLOR)
      .setFontWeight('bold');

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
};

/* ============================================================
 * Private: Build rows
 * ============================================================
 */

/**
 * @private
 * @description
 * diffs から diff_detail 用の行データを作成する。
 *
 * - Column / OldValue / NewValue は表示用に正規化（改行除去）
 *
 * @param {Array<Object>} diffs
 * @param {Array<string>} headers
 * @returns {Array<Array<any>>}
 */
DiffDetailService.buildDetailRows_ = function (diffs, headers) {
  const fn = 'DiffDetailService.buildDetailRows_';
  LoggerUtil.start(fn, { diffCount: diffs ? diffs.length : 0 });

  try {
    const rows = [];

    (diffs || []).forEach(d => {
      if (!d || !d.type) return;

      // Row 表示（DiffCore の rowIndex を想定）
      const rowIndex = (typeof d.rowIndex === 'number') ? d.rowIndex : null;
      const rowLabel = rowIndex === null ? '' : (rowIndex + SNAPSHOT_DATA_START_ROW);

      // SecNO（先頭列想定）
      const seq = DiffDetailService.normalizeDisplayValue_(
        (d.type === DIFF_TYPES.DELETE ? (d.prevRow && d.prevRow[0]) : (d.currRow && d.currRow[0]))
      );

      if (d.type === DIFF_TYPES.ADD) {
        // ADD は OldValue/NewValue を埋めない（一覧では行追加の事実が分かればよい）
        rows.push([
          'ADD',
          rowLabel,
          seq,
          '',
          '',
          ''
        ]);
        return;
      }

      if (d.type === DIFF_TYPES.DELETE) {
        rows.push([
          'DELETE',
          rowLabel,
          seq,
          '',
          '',
          ''
        ]);
        return;
      }

      if (d.type === DIFF_TYPES.MODIFY) {
        const diffCols = d.diffCols || [];

        diffCols.forEach(colIdx => {
          const colNameRaw =
            (headers && typeof headers[colIdx] !== 'undefined')
              ? headers[colIdx]
              : `COL_${colIdx + 1}`;

          const colName = DiffDetailService.normalizeDisplayValue_(colNameRaw);

          const oldRaw = d.prevRow ? d.prevRow[colIdx] : '';
          const newRaw = d.currRow ? d.currRow[colIdx] : '';

          const oldValue = DiffDetailService.normalizeDisplayValue_(oldRaw);
          const newValue = DiffDetailService.normalizeDisplayValue_(newRaw);

          rows.push([
            'MODIFY',
            rowLabel,
            seq,
            colName,
            oldValue,
            newValue
          ]);
        });

        return;
      }

      // 未知タイプ
      rows.push([
        `UNKNOWN:${DiffDetailService.normalizeDisplayValue_(d.type)}`,
        rowLabel,
        seq,
        '',
        '',
        ''
      ]);
    });

    LoggerUtil.info(`diff_detail rows=${rows.length}`);
    return rows;

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
};

/* ============================================================
 * Private: Formatting
 * ============================================================
 */

/**
 * @private
 * @description
 * 表示整形（列幅・折返しなど）を適用する。
 *
 * @param {SpreadsheetApp.Sheet} sheet
 * @param {number} rowCount データ行数
 */
DiffDetailService.applyFormat_ = function (sheet, rowCount) {
  const fn = 'DiffDetailService.applyFormat_';
  LoggerUtil.start(fn, { rowCount });

  try {
    // 列幅（好みに合わせて調整可能）
    sheet.setColumnWidth(1, 80);  // Type
    sheet.setColumnWidth(2, 70);  // Row
    sheet.setColumnWidth(3, 120); // SecNO
    sheet.setColumnWidth(4, 220); // Column
    sheet.setColumnWidth(5, 320); // OldValue
    sheet.setColumnWidth(6, 320); // NewValue

    // 折返し：Old/New は折返しすると読みづらい場合があるので OFF（必要なら true）
    if (rowCount > 0) {
      sheet.getRange(3, 4, rowCount, 3).setWrap(false); // Column/Old/New
    }

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
};

/* ============================================================
 * Private: Normalization (Display only)
 * ============================================================
 */

/**
 * @private
 * @description
 * 表示用に値を正規化する。
 *
 * - 改行コードを除去（スペースに置換）
 * - 前後空白を trim
 *
 * @param {any} value
 * @returns {string}
 */
DiffDetailService.normalizeDisplayValue_ = function (value) {
  if (value === null || typeof value === 'undefined') return '';

  return String(value)
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .trim();
};
