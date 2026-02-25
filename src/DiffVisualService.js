/**
 * ============================================================
 * DiffVisualService.gs
 *
 * @overview
 * 視覚的 diff（背景色付き）を生成するサービス。
 *
 * @designPolicy
 * - 比較先シートを基準に表示
 * - 差分セルのみを着色
 * - diff 0 件でも必ずシート生成
 *
 * @dependsOn
 * - Config.gs
 * - LoggerUtil.gs
 * - Util.gs
 * ============================================================
 */

/**
 * @namespace DiffVisualService
 */
const DiffVisualService = {};

/**
 * @description
 * 視覚 diff シートを生成する。
 *
 * @param {string} prevName 比較元シート名
 * @param {string} currName 比較先シート名
 * @param {Array<Object>} diffs DiffCore.buildDiff の結果
 * @param {Array<string>} headers ヘッダー行
 * @param {{add:number,del:number,mod:number}} summary 件数要約
 * @returns {string} 生成した diff シートの URL
 */
DiffVisualService.generate = function (
  prevName,
  currName,
  diffs,
  headers,
  summary
) {
  const fn = 'DiffVisualService.generate';
  LoggerUtil.start(fn, { prevName, currName });

  try {
    const ss = SpreadsheetApp.getActive();
    const sheetName = `diff_${prevName}_vs_${currName}`;

    const existing = ss.getSheetByName(sheetName);
    if (existing) {
      LoggerUtil.info(`既存 diff シート削除: ${sheetName}`);
      ss.deleteSheet(existing);
    }

    const sheet = ss.insertSheet(sheetName);

    // --- メタ行 ---
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const total = summary.mod + summary.add + summary.del;

    sheet.getRange('A1').setValue(
      `比較元=${prevName} | 比較先=${currName} | 実行=${now}  ` +
      `【結果】総数：${total}（ MODIFY=${summary.mod} | ADD=${summary.add} | DELETE=${summary.del} ）`
    );

    sheet.getRange(1, 1, 1, headers.length + 2)
      .setBackground(META_BG_COLOR)
      .setFontWeight('bold');

    // --- ヘッダー ---
    sheet.getRange(2, 1, 1, headers.length + 2)
      .setValues([['DiffType', 'RowNo', ...headers]]);

    // --- データ ---
    let rowPtr = 3;

    diffs.forEach(diff => {
      const baseRow = diff.currRow || diff.prevRow;

      sheet.getRange(rowPtr, 1, 1, baseRow.length + 2)
        .setValues([[
          diff.type,
          diff.rowIndex + SNAPSHOT_DATA_START_ROW,
          ...baseRow
        ]]);

      // 行単位の背景
      if (diff.type === DIFF_TYPES.ADD || diff.type === DIFF_TYPES.DELETE) {
        sheet.getRange(rowPtr, 1, 1, baseRow.length + 2)
          .setBackground(DIFF_COLORS[diff.type]);
      }

      // セル単位の背景（MODIFY）
      if (diff.type === DIFF_TYPES.MODIFY) {
        diff.diffCols.forEach(colIdx => {
          sheet.getRange(rowPtr, colIdx + 3)
            .setBackground(DIFF_COLORS.MODIFY);
        });
      }

      rowPtr++;
    });

    LoggerUtil.info(`視覚 diff シート生成完了: ${sheetName}`);
    // return sheet.getUrl();
    return sheet.getParent().getUrl() + '#gid=' + sheet.getSheetId();

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
};
