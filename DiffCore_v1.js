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

// /**
//  * ============================================================
//  * DiffCore.gs（追記分）
//  * ============================================================
//  */

// /**
//  * @typedef {Object} DiffResult
//  * @property {string} type DIFF_TYPES.*
//  * @property {number} rowIndex 0-based（比較後の行インデックス）
//  * @property {Array<any>=} prevRow
//  * @property {Array<any>=} currRow
//  * @property {number[]=} diffCols
//  */

// /**
//  * @description
//  * Git的差分（安定ソート + 同位置比較）で diff を生成する。
//  * - 並び替えノイズを抑えたい場合に有効
//  * - 途中挿入でズレる弱点は「安定ソート」でかなり緩和
//  *
//  * @param {Array<Array<any>>} prevRows
//  * @param {Array<Array<any>>} currRows
//  * @param {Array<string>} headers
//  * @param {Object} opt
//  * @param {string[]} opt.sortKeys 列名ベース
//  * @returns {DiffResult[]}
//  */
// DiffCore.buildDiffGitLike = function (prevRows, currRows, headers, opt) {
//   const fn = 'DiffCore.buildDiffGitLike';
//   LoggerUtil.start(fn, {
//     prev: prevRows ? prevRows.length : 0,
//     curr: currRows ? currRows.length : 0,
//     sortKeys: opt && opt.sortKeys
//   });

//   try {
//     if (!Array.isArray(prevRows)) throw new Error('prevRows が配列ではありません');
//     if (!Array.isArray(currRows)) throw new Error('currRows が配列ではありません');
//     if (!Array.isArray(headers)) throw new Error('headers が配列ではありません');

//     const sortKeys = (opt && Array.isArray(opt.sortKeys)) ? opt.sortKeys : [];
//     const sortIdxs = DiffCore.resolveHeaderIndexes_(headers, sortKeys);

//     const prevSorted = DiffCore.sortRowsStable_(prevRows, headers, sortIdxs);
//     const currSorted = DiffCore.sortRowsStable_(currRows, headers, sortIdxs);

//     const maxLen = Math.max(prevSorted.length, currSorted.length);
//     /** @type {DiffResult[]} */
//     const diffs = [];

//     for (let i = 0; i < maxLen; i++) {
//       const a = prevSorted[i] || null;
//       const b = currSorted[i] || null;

//       if (a && !b) {
//         diffs.push({ type: DIFF_TYPES.DELETE, rowIndex: i, prevRow: a, currRow: null, diffCols: [] });
//         continue;
//       }
//       if (!a && b) {
//         diffs.push({ type: DIFF_TYPES.ADD, rowIndex: i, prevRow: null, currRow: b, diffCols: [] });
//         continue;
//       }
//       if (!a && !b) continue;

//       const diffCols = DiffCore.diffCols_(a, b, headers);

//       if (diffCols.length > 0) {
//         diffs.push({ type: DIFF_TYPES.MODIFY, rowIndex: i, prevRow: a, currRow: b, diffCols: diffCols });
//       }
//     }

//     LoggerUtil.info(`GitLike diff: diffs=${diffs.length}`);
//     return diffs;

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /**
//  * @private
//  * @description 列名→列インデックス配列へ解決（見つからない列は無視）
//  * @param {string[]} headers
//  * @param {string[]} names
//  * @returns {number[]}
//  */
// DiffCore.resolveHeaderIndexes_ = function (headers, names) {
//   const map = {};
//   headers.forEach((h, i) => { map[String(h)] = i; });

//   const idxs = [];
//   (names || []).forEach(n => {
//     const key = String(n);
//     if (Object.prototype.hasOwnProperty.call(map, key)) idxs.push(map[key]);
//   });
//   return idxs;
// };

// /**
//  * @private
//  * @description 安定ソート（キーが同一なら元順序維持）
//  * @param {Array<Array<any>>} rows
//  * @param {string[]} headers
//  * @param {number[]} sortIdxs
//  * @returns {Array<Array<any>>}
//  */
// DiffCore.sortRowsStable_ = function (rows, headers, sortIdxs) {
//   const decorated = (rows || []).map((r, originalIndex) => {
//     return {
//       row: r,
//       idx: originalIndex,
//       key: DiffCore.buildSortKey_(r, sortIdxs)
//     };
//   });

//   decorated.sort((a, b) => {
//     if (a.key < b.key) return -1;
//     if (a.key > b.key) return 1;
//     return a.idx - b.idx; // stable
//   });

//   return decorated.map(x => x.row);
// };

// /**
//  * @private
//  * @description ソートキー文字列を作る（区切りは確実に衝突しにくいもの）
//  * @param {Array<any>} row
//  * @param {number[]} sortIdxs
//  * @returns {string}
//  */
// DiffCore.buildSortKey_ = function (row, sortIdxs) {
//   const SEP = '\u001F'; // unit separator
//   if (!row) return '';

//   return (sortIdxs || []).map(i => {
//     const v = row[i];
//     // 既存の正規化関数がある前提（無いなら後で差し替え）
//     const s = (typeof normalizeDiffValue_ === 'function')
//       ? String(normalizeDiffValue_(v))
//       : String(v === null || typeof v === 'undefined' ? '' : v);
//     return s;
//   }).join(SEP);
// };

// /**
//  * @private
//  * @description 2行の差分列インデックスを返す
//  * @param {Array<any>} a
//  * @param {Array<any>} b
//  * @param {string[]} headers
//  * @returns {number[]}
//  */
// DiffCore.diffCols_ = function (a, b, headers) {
//   const cols = Math.max(a.length, b.length, headers.length);
//   const out = [];

//   for (let i = 0; i < cols; i++) {
//     const av = (typeof normalizeDiffValue_ === 'function') ? normalizeDiffValue_(a[i]) : a[i];
//     const bv = (typeof normalizeDiffValue_ === 'function') ? normalizeDiffValue_(b[i]) : b[i];
//     if (String(av) !== String(bv)) out.push(i);
//   }
//   return out;
// };
