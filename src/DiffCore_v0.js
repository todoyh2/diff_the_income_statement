// /**
//  * ============================================================
//  * DiffCore.gs
//  *
//  * @overview
//  * diff 判定を行う純ロジック層。
//  *
//  * - Spreadsheet API を一切使用しない
//  * - 行配列とヘッダー配列のみを入力とする
//  *
//  * @designPolicy
//  * - 行番号ベースで比較する（現状方針）
//  * - DIFF_IGNORE_COLUMNS（列名ベース除外）に対応
//  * - 判定値は normalizeDiffValue_ により「意味的に同じ」を同一扱いに寄せる
//  * - デバッグ時は先頭数行のみ差分ログを出す（ログ爆発防止）
//  *
//  * @dependsOn
//  * - Config.gs（DIFF_TYPES / DIFF_IGNORE_COLUMNS / DEBUG_VERBOSE）
//  * - LoggerUtil.gs
//  * - Util.gs（normalizeDiffValue_ / normalizeHeaderName_）
//  * ============================================================
//  */

// /**
//  * @namespace DiffCore
//  */
// const DiffCore = {};

// /**
//  * @description
//  * 2つの行配列を比較し、diff 情報を生成する。
//  *
//  * 比較方針：
//  * - 行番号ベース比較
//  * - 全列空行は事前に extractEffectiveRows_ で除外されている前提
//  * - DIFF_IGNORE_COLUMNS に含まれる列は比較対象外（列名ベース）
//  *
//  * @param {Array<Array<any>>} prevRows 比較元行配列
//  * @param {Array<Array<any>>} currRows 比較先行配列
//  * @param {Array<string>} headers ヘッダー行（列名）
//  * @returns {Array<Object>} diff 情報配列
//  */
// DiffCore.buildDiff = function (prevRows, currRows, headers) {
//   const fn = 'DiffCore.buildDiff';
//   LoggerUtil.start(fn, {
//     prevRows: prevRows ? prevRows.length : 0,
//     currRows: currRows ? currRows.length : 0,
//     headers : headers  ? headers.length  : 0
//   });

//   try {
//     const diffs = [];
//     const safePrev    = prevRows || [];
//     const safeCurr    = currRows || [];
//     const safeHeaders = headers  || [];

//     const maxLen = Math.max(safePrev.length, safeCurr.length);

//     for (let rowIndex = 0; rowIndex < maxLen; rowIndex++) {
//       const prevRow = safePrev[rowIndex];
//       const currRow = safeCurr[rowIndex];

//       // ADD
//       if (!prevRow && currRow) {
//         diffs.push({
//           type: DIFF_TYPES.ADD,
//           rowIndex,
//           currRow
//         });
//         continue;
//       }

//       // DELETE
//       if (prevRow && !currRow) {
//         diffs.push({
//           type: DIFF_TYPES.DELETE,
//           rowIndex,
//           prevRow
//         });
//         continue;
//       }

//       // MODIFY
//       if (prevRow && currRow) {
//         const diffCols = [];

//         safeHeaders.forEach((header, colIndex) => {
//           const headerNorm = normalizeHeaderName_(header);

//           if (DIFF_IGNORE_COLUMNS.includes(headerNorm)) return;

//           const prevVal = normalizeDiffValue_(prevRow[colIndex], headerNorm);
//           const currVal = normalizeDiffValue_(currRow[colIndex], headerNorm);

//           if (prevVal !== currVal) {
//             diffCols.push(colIndex);

//             // デバッグ：先頭数行だけ出す（ログ爆発回避）
//             if (DEBUG_VERBOSE && rowIndex < 5) {
//               LoggerUtil.info(
//                 `[DIFF_DEBUG] rowIndex=${rowIndex} col=${colIndex} header=${headerNorm} prev=${String(prevVal)} curr=${String(currVal)}`
//               );
//             }
//           }
//         });

//         if (diffCols.length > 0) {
//           diffs.push({
//             type: DIFF_TYPES.MODIFY,
//             rowIndex,
//             prevRow,
//             currRow,
//             diffCols
//           });
//         }
//       }
//     }

//     LoggerUtil.info(`diff 判定完了: 件数=${diffs.length}`);
//     return diffs;

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };
