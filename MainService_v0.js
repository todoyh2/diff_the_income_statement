// /**
//  * ============================================================
//  * MainService.gs
//  *
//  * @overview
//  * Snapshot / Diff / Slack 通知を統合制御するオーケストレーション層。
//  *
//  * @designPolicy
//  * - 個別ロジックは各 Service に委譲する（MainService は順序制御に徹する）
//  * - Sheet 出力ルート（視覚/詳細）と、Slack 専用ルート（sheet出力なし）を分離する
//  * - try-catch と logging を必ず行い、原因特定可能なログを残す
//  *
//  * @dependsOn
//  * - Config.gs
//  * - LoggerUtil.gs
//  * - SnapshotService.gs
//  * - Util.gs（extractEffectiveRows_ / getSnapshotDataValues_ 等）
//  * - DiffCore.gs
//  * - DiffVisualService.gs
//  * - DiffDetailService.gs
//  * - SlackNotifyService.gs
//  * ============================================================
//  */

// /**
//  * @namespace MainService
//  */
// const MainService = {};

// /* ============================================================
//  * Public: Snapshot + Diff
//  * ============================================================
//  */

// /**
//  * @description
//  * Snapshot を作成し、その直前 Snapshot と diff を実行する。
//  *
//  * @param {{visual:boolean,detail:boolean}} outputMode diff 出力モード
//  * @param {boolean} notifySlack Slack 通知有無
//  */
// MainService.runSnapshotAndDiff = function (outputMode, notifySlack) {
//   const fn = 'MainService.runSnapshotAndDiff';
//   LoggerUtil.start(fn, { outputMode, notifySlack });

//   try {
//     const currSnapshotName = SnapshotService.createOrUpdateDailySnapshot('manual');
//     const prevSnapshotName = MainService.findPreviousSnapshot_(currSnapshotName);

//     MainService.runDiffInternal_(
//       prevSnapshotName,
//       currSnapshotName,
//       outputMode,
//       notifySlack
//     );

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Public: Diff (Latest Two)
//  * ============================================================
//  */

// /**
//  * @description
//  * 最新 2 Snapshot を用いて diff を実行する。
//  *
//  * @param {{visual:boolean,detail:boolean}} outputMode diff 出力モード
//  * @param {boolean} notifySlack Slack 通知有無（sheet出力ありルート）
//  */
// MainService.runDiffLatest = function (outputMode, notifySlack) {
//   const fn = 'MainService.runDiffLatest';
//   LoggerUtil.start(fn, { outputMode, notifySlack });

//   try {
//     const pair = MainService.findLatestTwoSnapshots_();
//     LoggerUtil.info(`最新2シート検出: prev=${pair.prev}, curr=${pair.curr}`);

//     MainService.runDiffInternal_(
//       pair.prev,
//       pair.curr,
//       outputMode,
//       notifySlack
//     );

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Public: Diff (Manual)
//  * ============================================================
//  */

// /**
//  * @description
//  * 任意 2 シートを指定して diff を実行する（sheet出力ありルート）。
//  *
//  * @param {string} prevName 比較元シート名
//  * @param {string} currName 比較先シート名
//  * @param {{visual:boolean,detail:boolean}} outputMode diff 出力モード
//  * @param {boolean} notifySlack Slack 通知有無（sheet出力ありルート）
//  */
// MainService.runDiffManual = function (prevName, currName, outputMode, notifySlack) {
//   const fn = 'MainService.runDiffManual';
//   LoggerUtil.start(fn, { prevName, currName, outputMode, notifySlack });

//   try {
//     MainService.runDiffInternal_(
//       prevName,
//       currName,
//       outputMode,
//       notifySlack
//     );

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Public: Diff -> Slack Only (No Sheet Output)
//  * ============================================================
//  */

// /**
//  * @description
//  * 任意 2 シートを指定して diff を計算し、Sheet 出力せず Slack にのみ通知する。
//  *
//  * @param {string} prevName 比較元シート名
//  * @param {string} currName 比較先シート名
//  * @param {string=} channel 任意チャンネル（省略時は webhook 既定）
//  */
// MainService.runDiffForSlackOnlyManual = function (prevName, currName, channel) {
//   const fn = 'MainService.runDiffForSlackOnlyManual';
//   LoggerUtil.start(fn, { prevName, currName, channel });

//   try {
//     const ss = SpreadsheetApp.getActive();
//     const prevSheet = ss.getSheetByName(prevName);
//     const currSheet = ss.getSheetByName(currName);

//     if (!prevSheet || !currSheet) {
//       throw new Error(`比較対象シートが存在しません: ${prevName}, ${currName}`);
//     }

//     const headers = currSheet
//       .getRange(SNAPSHOT_HEADER_ROW, 1, 1, currSheet.getLastColumn())
//       .getValues()[0];

//     const prevRows = extractEffectiveRows_(getSnapshotDataValues_(prevSheet));
//     const currRows = extractEffectiveRows_(getSnapshotDataValues_(currSheet));

//     LoggerUtil.info(`SlackOnly diff 取得行数: prev=${prevRows.length} | curr=${currRows.length}`);

//     const diffs = DiffCore.buildDiff(prevRows, currRows, headers);
//     const summary = MainService.buildSummary_(diffs);
//     LoggerUtil.info(`SlackOnly diff 要約: MODIFY=${summary.mod} | ADD=${summary.add} | DELETE=${summary.del}`);

//     // ★ SlackOnly でも見え方を統一（コードブロック化＆上限警告/先頭N件）
//     SlackNotifyService.notifyDiffResultDetailOnly({
//       prev: prevName,
//       curr: currName,
//       diffs: diffs,
//       headers: headers,
//       summary: summary,
//       channel: channel
//     });

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Internal: Diff Common
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * diff 実行の共通内部処理（sheet出力ありルート）。
//  *
//  * @param {string} prevName 比較元シート名
//  * @param {string} currName 比較先シート名
//  * @param {{visual:boolean,detail:boolean}} outputMode diff 出力モード
//  * @param {boolean} notifySlack Slack 通知有無（sheet出力あり）
//  */
// MainService.runDiffInternal_ = function (prevName, currName, outputMode, notifySlack) {
//   const fn = 'MainService.runDiffInternal_';
//   LoggerUtil.start(fn, { prevName, currName, outputMode, notifySlack });

//   try {
//     const ss = SpreadsheetApp.getActive();
//     const prevSheet = ss.getSheetByName(prevName);
//     const currSheet = ss.getSheetByName(currName);

//     if (!prevSheet || !currSheet) {
//       throw new Error(`比較対象シートが存在しません: ${prevName}, ${currName}`);
//     }

//     const headers = currSheet
//       .getRange(SNAPSHOT_HEADER_ROW, 1, 1, currSheet.getLastColumn())
//       .getValues()[0];

//     const prevRows = extractEffectiveRows_(getSnapshotDataValues_(prevSheet));
//     const currRows = extractEffectiveRows_(getSnapshotDataValues_(currSheet));
//     LoggerUtil.info(`diff 取得行数: prev=${prevRows.length}, curr=${currRows.length}`);

//     const diffs = DiffCore.buildDiff(prevRows, currRows, headers);
//     const summary = MainService.buildSummary_(diffs);
//     LoggerUtil.info(`diff 要約: MODIFY=${summary.mod} | ADD=${summary.add} | DELETE=${summary.del}`);

//     // --- Sheet出力（2種） ---
//     // DiffVisualService.generate() がURLを返す前提でも、念のため「Sheet名→URL」も確保する
//     const diffSheets = [];

//     // 差分比較（旧: 視覚）
//     if (outputMode && outputMode.visual) {
//       const visualUrlMaybe = DiffVisualService.generate(prevName, currName, diffs, headers, summary);
//       const visualSheetName = MainService.buildDiffSheetNameCompare_(prevName, currName);
//       const visualUrl = MainService.findSheetUrlByName_(visualSheetName) || visualUrlMaybe || '';

//       diffSheets.push({
//         label: '差分比較',
//         sheetName: visualSheetName,
//         url: visualUrl
//       });

//       LoggerUtil.info(`差分比較 出力完了: sheet=${visualSheetName} url=${visualUrl}`);
//     }

//     // 変更一覧（旧: 詳細）
//     if (outputMode && outputMode.detail) {
//       DiffDetailService.generate(prevName, currName, diffs, headers, summary);

//       const detailSheetName = MainService.buildDiffSheetNameDetail_(prevName, currName);
//       const detailUrl = MainService.findSheetUrlByName_(detailSheetName) || '';

//       diffSheets.push({
//         label: '変更一覧',
//         sheetName: detailSheetName,
//         url: detailUrl
//       });

//       LoggerUtil.info(`変更一覧 出力完了: sheet=${detailSheetName} url=${detailUrl}`);
//     }

//     // --- Slack通知（sheet出力あり） ---
//     if (notifySlack) {
//       const wantsDetailInline = !!(outputMode && outputMode.detail);

//       if (wantsDetailInline) {
//         SlackNotifyService.notifyDiffResultSummaryWithUrlAndDetails({
//           prev: prevName,
//           curr: currName,
//           summary: summary,
//           diffs: diffs,
//           headers: headers,
//           diffSheets: diffSheets, // ★ 2つのリンクを渡す
//           maxLines: 250
//         });
//         LoggerUtil.info('Slack 統合通知（要約+URL+内訳）送信完了');

//       } else {
//         // 従来通り（要約＋URLのみ）だが、diffSheets があれば 2本出せる
//         SlackNotifyService.notifyDiffResult({
//           prev: prevName,
//           curr: currName,
//           summary: summary,
//           diffSheets: diffSheets,
//           // 後方互換：diffSheetUrl でもOK
//           diffSheetUrl: (diffSheets[0] && diffSheets[0].url) ? diffSheets[0].url : ''
//         });
//         LoggerUtil.info('Slack 要約通知（sheetあり）送信完了');
//       }
//     }

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /**
//  * @private
//  * @description
//  * diffs 配列から MODIFY/ADD/DELETE の件数要約を作る。
//  *
//  * @param {Array<Object>} diffs DiffCore.buildDiff() の返却配列
//  * @returns {{add:number,del:number,mod:number}}
//  */
// MainService.buildSummary_ = function (diffs) {
//   const fn = 'MainService.buildSummary_';
//   LoggerUtil.start(fn, { diffCount: diffs ? diffs.length : 0 });

//   try {
//     const summary = { mod: 0, add: 0, del: 0 };

//     (diffs || []).forEach(d => {
//       if (!d || !d.type) return;
//       if (d.type === DIFF_TYPES.ADD) summary.add++;
//       if (d.type === DIFF_TYPES.DELETE) summary.del++;
//       if (d.type === DIFF_TYPES.MODIFY) summary.mod++;
//     });

//     return summary;

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Internal: Sheet URL helpers
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * “差分比較”シート名を生成する。
//  *
//  * @param {string} prevName
//  * @param {string} currName
//  * @returns {string}
//  */
// MainService.buildDiffSheetNameCompare_ = function (prevName, currName) {
//   return `diff_${prevName}_vs_${currName}`;
// };

// /**
//  * @private
//  * @description
//  * “変更一覧”シート名を生成する。
//  *
//  * @param {string} prevName
//  * @param {string} currName
//  * @returns {string}
//  */
// MainService.buildDiffSheetNameDetail_ = function (prevName, currName) {
//   return `diff_detail_${prevName}_vs_${currName}`;
// };

// /**
//  * @private
//  * @description
//  * 指定のシート名から URL（gid付き）を作る。見つからなければ空文字。
//  *
//  * @param {string} sheetName
//  * @returns {string}
//  */
// MainService.findSheetUrlByName_ = function (sheetName) {
//   const fn = 'MainService.findSheetUrlByName_';
//   LoggerUtil.start(fn, { sheetName });

//   try {
//     if (!sheetName) return '';

//     const ss = SpreadsheetApp.getActive();
//     const sheet = ss.getSheetByName(sheetName);
//     if (!sheet) return '';

//     const gid = sheet.getSheetId();
//     return `${ss.getUrl()}#gid=${gid}`;

//   } catch (e) {
//     LoggerUtil.error(e);
//     return '';
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Internal: Snapshot Search
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * 指定 Snapshot の直前 Snapshot を取得する。
//  *
//  * @param {string} currentName Snapshot シート名
//  * @returns {string} 直前 Snapshot シート名
//  */
// MainService.findPreviousSnapshot_ = function (currentName) {
//   const fn = 'MainService.findPreviousSnapshot_';
//   LoggerUtil.start(fn, { currentName });

//   try {
//     const prefix = currentName.split('_')[0] + '_';
//     const names = SpreadsheetApp.getActive()
//       .getSheets()
//       .map(s => s.getName())
//       .filter(name => name.startsWith(prefix))
//       .sort();

//     const idx = names.indexOf(currentName);
//     if (idx <= 0) {
//       throw new Error(`直前 Snapshot が見つかりません: ${currentName}`);
//     }

//     const prev = names[idx - 1];
//     LoggerUtil.info(`直前 Snapshot 検出: ${prev}`);
//     return prev;

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /**
//  * @private
//  * @description
//  * Snapshot 命名規則（例: 15_260206）に一致するシートのうち、最新 2 件を返す。
//  *
//  * @returns {{prev:string,curr:string}}
//  */
// MainService.findLatestTwoSnapshots_ = function () {
//   const fn = 'MainService.findLatestTwoSnapshots_';
//   LoggerUtil.start(fn);

//   try {
//     const names = SpreadsheetApp.getActive()
//       .getSheets()
//       .map(s => s.getName())
//       .filter(name => /^\d+_\d{6}$/.test(name))
//       .sort();

//     if (names.length < 2) {
//       throw new Error('Snapshot が 2 枚未満です');
//     }

//     const result = {
//       prev: names[names.length - 2],
//       curr: names[names.length - 1]
//     };

//     LoggerUtil.info(`最新2 Snapshot: prev=${result.prev}, curr=${result.curr}`);
//     return result;

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };
