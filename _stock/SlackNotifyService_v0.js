// /**
//  * ============================================================
//  * SlackNotifyService.gs
//  *
//  * @overview
//  * Slack 通知専用サービス。
//  *
//  * @designPolicy
//  * - diff ロジックと分離（通知＝整形・送信のみ）
//  * - Sheet 出力あり（要約＋リンク）
//  * - Sheet 出力なし（詳細のみ）も統一表示（コードブロック化）
//  * - 統合（要約＋URL＋詳細）を提供
//  * - 表示ノイズ（改行など）を正規化
//  * - 浮動小数誤差を表示上で吸収
//  * - Script Properties の Webhook URL を使用
//  * - try-catch / logging を徹底
//  *
//  * @dependsOn
//  * - Config.gs（EXEC_ENV / SLACK_PROP_WEBHOOK_URL_* / DIFF_TYPES / SNAPSHOT_DATA_START_ROW / SLACK_*）
//  * - LoggerUtil.gs
//  * ============================================================
//  */

// /**
//  * @namespace SlackNotifyService
//  */
// const SlackNotifyService = {};

// /* ============================================================
//  * Public: Sheet 出力あり（要約＋リンク）
//  * ============================================================
//  */

// /**
//  * @description
//  * diff シート URL を含む要約通知を Slack に送信する（sheet出力ありルート）。
//  *
//  * @param {Object} meta 通知メタ情報
//  * @param {string} meta.prev 比較元シート名
//  * @param {string} meta.curr 比較先シート名
//  * @param {{add:number,del:number,mod:number}} meta.summary diff 件数要約
//  * @param {string=} meta.diffSheetUrl 後方互換（単一URL）
//  * @param {Array<{label:string,sheetName:string,url:string}>=} meta.diffSheets 2リンク用（推奨）
//  * @param {string=} meta.channel 任意チャンネル（Webhook が許可する場合のみ）
//  */
// SlackNotifyService.notifyDiffResult = function (meta) {
//   const fn = 'SlackNotifyService.notifyDiffResult';
//   LoggerUtil.start(fn, {
//     prev: meta && meta.prev,
//     curr: meta && meta.curr,
//     summary: meta && meta.summary,
//     channel: meta && meta.channel
//   });

//   try {
//     SlackNotifyService.validateMetaForSummary_(meta);

//     const webhookUrl = SlackNotifyService.getWebhookUrl_();
//     const payload = SlackNotifyService.buildSummaryPayload_(meta);

//     LoggerUtil.info('Slack 要約通知（sheetあり）送信開始');
//     SlackNotifyService.post_(webhookUrl, payload);
//     LoggerUtil.info('Slack 要約通知（sheetあり）送信完了');

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Public: Sheet 出力なし（詳細）※統一表示（コードブロック）
//  * ============================================================
//  */

// /**
//  * @description
//  * diff を計算した結果を、Sheet 出力せず Slack に詳細通知する（Slack専用ルート）。
//  *
//  * 仕様：
//  * - 内訳はコードブロック化（統合通知と見え方を統一）
//  * - 総数が上限超なら Warning + 先頭N件のみ
//  * - 必要なら分割投稿（各投稿で ``` を必ず閉じる）
//  *
//  * @param {Object} meta 通知メタ情報
//  * @param {string} meta.prev 比較元シート名
//  * @param {string} meta.curr 比較先シート名
//  * @param {Array<Object>} meta.diffs DiffCore.buildDiff の結果
//  * @param {Array<string>} meta.headers ヘッダー配列（列名）
//  * @param {{add:number,del:number,mod:number}} meta.summary diff 件数要約
//  * @param {string=} meta.channel 任意チャンネル（Webhook が許可する場合のみ）
//  * @param {number=} meta.maxLines Slack 投稿の最大行数（省略時は既定）
//  * @param {number=} meta.maxChars Slack 投稿の最大文字数（省略時は既定）
//  */
// SlackNotifyService.notifyDiffResultDetailOnly = function (meta) {
//   const fn = 'SlackNotifyService.notifyDiffResultDetailOnly';
//   LoggerUtil.start(fn, {
//     prev: meta && meta.prev,
//     curr: meta && meta.curr,
//     summary: meta && meta.summary,
//     channel: meta && meta.channel
//   });

//   try {
//     SlackNotifyService.validateMetaForDetail_(meta);

//     const webhookUrl = SlackNotifyService.getWebhookUrl_();
//     const payloadBase = {};
//     if (meta.channel) payloadBase.channel = meta.channel;

//     const maxLines = SlackNotifyService.getMaxLines_(meta);
//     const maxChars = SlackNotifyService.getMaxChars_(meta);
//     const maxItems = SlackNotifyService.getMaxItems_();

//     const s = meta.summary || { add: 0, del: 0, mod: 0 };
//     const total = s.mod + s.add + s.del;

//     // ★ 比較元/比較先はシート名リンク化（同一スプレッドシート想定）
//     const headerLines = [];
//     headerLines.push('■■ 収支見込表 diff ■■');
//     headerLines.push(
//       `比較元: ${SlackNotifyService.buildSheetNameLink_(meta.prev)} | ` +
//       `比較先: ${SlackNotifyService.buildSheetNameLink_(meta.curr)}`
//     );
//     headerLines.push(`【結果】総数：${total}（ MODIFY=${s.mod} | ADD=${s.add} | DELETE=${s.del} ）`);

//     // diff件数ベースで制限
//     const chunks = SlackNotifyService.buildDetailBodyChunksByDiff_(meta);
//     const limitedChunks = (total <= maxItems) ? chunks : chunks.slice(0, maxItems);

//     const bodyLines = [];
//     limitedChunks.forEach(c => (c.lines || []).forEach(l => bodyLines.push(l)));
//     if (bodyLines.length === 0) bodyLines.push('（差分内訳なし）');

//     const warnLine = (total > maxItems)
//       ? `差分箇所が多いです（総数：${total}）。Slack の制限の都合上、先頭 ${maxItems} 件のみ出力します。`
//       : '';

//     const detailBlocks = SlackNotifyService.splitDetailIntoSlackBlocks_({
//       bodyLines: bodyLines,
//       maxLines: maxLines,
//       maxChars: maxChars,
//       warnLine: warnLine,
//       prefixLines: headerLines
//     });

//     for (let i = 0; i < detailBlocks.length; i++) {
//       LoggerUtil.info(`Slack 詳細通知（sheetなし）送信 ${i + 1}/${detailBlocks.length}`);
//       SlackNotifyService.post_(webhookUrl, Object.assign({}, payloadBase, { text: detailBlocks[i] }));
//     }

//     LoggerUtil.info('Slack 詳細通知（sheetなし）送信完了');

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Public: 統合（要約＋URL＋詳細）
//  * ============================================================
//  */

// /**
//  * @description
//  * diff結果を「要約 + diffシートURL + 詳細内訳」を Slack に通知する（統合通知）。
//  *
//  * @param {Object} meta
//  * @param {string} meta.prev
//  * @param {string} meta.curr
//  * @param {{add:number,del:number,mod:number}} meta.summary
//  * @param {string=} meta.diffSheetUrl 後方互換（単一URL）
//  * @param {Array<{label:string,sheetName:string,url:string}>=} meta.diffSheets
//  * @param {Array<Object>} meta.diffs
//  * @param {Array<string>} meta.headers
//  * @param {string=} meta.channel
//  * @param {number=} meta.maxLines
//  * @param {number=} meta.maxChars
//  */
// SlackNotifyService.notifyDiffResultSummaryWithUrlAndDetails = function (meta) {
//   const fn = 'SlackNotifyService.notifyDiffResultSummaryWithUrlAndDetails';
//   LoggerUtil.start(fn, {
//     prev: meta && meta.prev,
//     curr: meta && meta.curr,
//     summary: meta && meta.summary,
//     hasUrl: !!(meta && ((meta.diffSheets && meta.diffSheets.length) || meta.diffSheetUrl)),
//     channel: meta && meta.channel
//   });

//   try {
//     SlackNotifyService.validateMetaForDetail_(meta);

//     const webhookUrl = SlackNotifyService.getWebhookUrl_();
//     const payloadBase = {};
//     if (meta.channel) payloadBase.channel = meta.channel;

//     const s = meta.summary || { add: 0, del: 0, mod: 0 };
//     const total = s.mod + s.add + s.del;

//     const maxLines = SlackNotifyService.getMaxLines_(meta);
//     const maxChars = SlackNotifyService.getMaxChars_(meta);
//     const maxItems = SlackNotifyService.getMaxItems_();

//     // 1) 要約＋URL（2本リンク）を 1投稿
//     const summaryText = SlackNotifyService.buildSummaryText_(meta);
//     LoggerUtil.info('Slack 統合通知: 要約（+URL）送信開始');
//     SlackNotifyService.post_(webhookUrl, Object.assign({}, payloadBase, { text: summaryText }));
//     LoggerUtil.info('Slack 統合通知: 要約（+URL）送信完了');

//     // 2) 内訳（diff件数ベースで制限）
//     const chunks = SlackNotifyService.buildDetailBodyChunksByDiff_(meta);
//     const limitedChunks = (total <= maxItems) ? chunks : chunks.slice(0, maxItems);

//     const bodyLines = [];
//     limitedChunks.forEach(c => (c.lines || []).forEach(l => bodyLines.push(l)));
//     if (bodyLines.length === 0) bodyLines.push('（差分内訳なし）');

//     const warnLine = (total > maxItems)
//       ? `差分箇所が多いです（総数：${total}）。Slack の制限の都合上、先頭 ${maxItems} 件のみ出力します。`
//       : '';

//     const detailBlocks = SlackNotifyService.splitDetailIntoSlackBlocks_({
//       bodyLines: bodyLines,
//       maxLines: maxLines,
//       maxChars: maxChars,
//       warnLine: warnLine
//     });

//     for (let i = 0; i < detailBlocks.length; i++) {
//       LoggerUtil.info(`Slack 統合通知: 内訳ブロック送信 ${i + 1}/${detailBlocks.length}`);
//       SlackNotifyService.post_(webhookUrl, Object.assign({}, payloadBase, { text: detailBlocks[i] }));
//     }

//     LoggerUtil.info('Slack 統合通知（要約+URL+内訳）送信完了');

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Private: Webhook URL / HTTP
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * 実行環境に応じた Slack Webhook URL を Script Properties から取得する。
//  *
//  * @returns {string}
//  */
// SlackNotifyService.getWebhookUrl_ = function () {
//   const fn = 'SlackNotifyService.getWebhookUrl_';
//   LoggerUtil.start(fn);

//   try {
//     const props = PropertiesService.getScriptProperties();

//     const key =
//       EXEC_ENV === 'prod'
//         ? SLACK_PROP_WEBHOOK_URL_PROD
//         : SLACK_PROP_WEBHOOK_URL_TEST;

//     const url = props.getProperty(key);
//     if (!url) throw new Error(`Slack Webhook 未設定: ${key}`);

//     LoggerUtil.info(`Slack Webhook Key 選択: ${key}`);
//     return url;

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
//  * Slack へ POST する共通処理。
//  *
//  * @param {string} webhookUrl
//  * @param {Object} payload
//  * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse}
//  */
// SlackNotifyService.post_ = function (webhookUrl, payload) {
//   const fn = 'SlackNotifyService.post_';
//   LoggerUtil.start(fn);

//   try {
//     if (!webhookUrl) throw new Error('webhookUrl が空です');
//     if (!payload || typeof payload.text !== 'string') throw new Error('payload.text が不正です');

//     const res = UrlFetchApp.fetch(webhookUrl, {
//       method: 'post',
//       contentType: 'application/json',
//       payload: JSON.stringify(payload),
//       muteHttpExceptions: true
//     });

//     const code = res.getResponseCode();
//     const body = res.getContentText();

//     LoggerUtil.info(`Slack HTTP status=${code}`);
//     if (code < 200 || code >= 300) {
//       LoggerUtil.info(`Slack HTTP response body=${body}`);
//       throw new Error(`Slack POST 失敗: status=${code}`);
//     }

//     return res;

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Private: Payload / Text Builders
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * 要約通知（sheetありルート）の payload を生成する。
//  *
//  * @param {Object} meta
//  * @returns {{text:string, channel?:string}}
//  */
// SlackNotifyService.buildSummaryPayload_ = function (meta) {
//   const fn = 'SlackNotifyService.buildSummaryPayload_';
//   LoggerUtil.start(fn);

//   try {
//     const text = SlackNotifyService.buildSummaryText_(meta);
//     const payload = { text: text };
//     if (meta.channel) payload.channel = meta.channel;
//     return payload;

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
//  * Slack mrkdwn のリンク形式: <URL|表示テキスト>
//  *
//  * @param {string} url
//  * @param {string} text
//  * @returns {string}
//  */
// SlackNotifyService.buildSlackLink_ = function (url, text) {
//   const u = String(url || '').trim();
//   const t = String(text || '').trim();
//   if (!u || !t) return '';
//   return `<${u}|${t}>`;
// };

// /**
//  * @private
//  * @description
//  * 同一スプレッドシート内のシート名を Slack テキストリンク化する。
//  * 取得できない場合は、シート名をそのまま返す（安全策）。
//  *
//  * @param {string} sheetName
//  * @returns {string}
//  */
// SlackNotifyService.buildSheetNameLink_ = function (sheetName) {
//   const fn = 'SlackNotifyService.buildSheetNameLink_';
//   LoggerUtil.start(fn, { sheetName });

//   try {
//     const name = SlackNotifyService.normalizeDisplayValue_(sheetName);
//     if (!name) return '';

//     const ss = SpreadsheetApp.getActive();
//     const sheet = ss.getSheetByName(name);
//     if (!sheet) return name;

//     const url = ss.getUrl() + '#gid=' + sheet.getSheetId();
//     return SlackNotifyService.buildSlackLink_(url, name);

//   } catch (e) {
//     LoggerUtil.error(e);
//     return SlackNotifyService.normalizeDisplayValue_(sheetName);
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /**
//  * @private
//  * @description
//  * 要約テキストを生成する。
//  * - 比較元/比較先はシート名リンク化（同一スプレッドシート想定）
//  * - diffSheets があれば 2リンク表示（推奨）
//  * - diffSheetUrl があれば後方互換で単一URL表示
//  *
//  * @param {Object} meta
//  * @returns {string}
//  */
// SlackNotifyService.buildSummaryText_ = function (meta) {
//   const fn = 'SlackNotifyService.buildSummaryText_';
//   LoggerUtil.start(fn);

//   try {
//     const s = meta.summary || { add: 0, del: 0, mod: 0 };
//     const total = s.mod + s.add + s.del;

//     const prev = SlackNotifyService.buildSheetNameLink_(meta.prev);
//     const curr = SlackNotifyService.buildSheetNameLink_(meta.curr);

//     const lines = [];
//     lines.push('■■ 収支見込表 diff ■■');
//     lines.push(`比較元: ${prev} | 比較先: ${curr}`);
//     lines.push(`【結果】総数：${total}（ MODIFY=${s.mod} | ADD=${s.add} | DELETE=${s.del} ）`);

//     // ★ 推奨: diffSheets（2本）
//     if (meta.diffSheets && Array.isArray(meta.diffSheets) && meta.diffSheets.length > 0) {
//       lines.push('');
//       lines.push('▼ diff シート');
//       meta.diffSheets.forEach(ds => {
//         if (!ds) return;
//         const label = SlackNotifyService.normalizeDisplayValue_(ds.label);
//         const sheetName = SlackNotifyService.normalizeDisplayValue_(ds.sheetName);
//         const url = String(ds.url || '').trim();
//         if (!label || !sheetName || !url) return;

//         const link = SlackNotifyService.buildSlackLink_(url, sheetName);
//         lines.push(`・${label}  : ${link}`);
//       });
//       return lines.join('\n');
//     }

//     // 後方互換: 単一URL
//     if (meta.diffSheetUrl) {
//       lines.push('');
//       lines.push('▼ diff シート');
//       lines.push(meta.diffSheetUrl);
//     }

//     return lines.join('\n');

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Private: Detail Body Builders（diff単位）
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * diff（1件）単位で Slack 内訳行を作る（件数制御のため）。
//  * 返り値は diff件数と同じ長さの配列になる。
//  *
//  * @param {Object} meta
//  * @returns {Array<{lines:string[]}>}
//  */
// SlackNotifyService.buildDetailBodyChunksByDiff_ = function (meta) {
//   const fn = 'SlackNotifyService.buildDetailBodyChunksByDiff_';
//   LoggerUtil.start(fn);

//   try {
//     const out = [];

//     (meta.diffs || []).forEach(d => {
//       if (!d || !d.type) return;

//       const lines = [];
//       const rowLabel = SlackNotifyService.buildRowLabel_(d);

//       if (d.type === DIFF_TYPES.ADD) {
//         lines.push(SlackNotifyService.sanitizeSlackLine_(
//           `- [ADD] ${rowLabel} . ${SlackNotifyService.buildSeqInfo_(d.currRow)} .`
//         ));
//         out.push({ lines: lines });
//         return;
//       }

//       if (d.type === DIFF_TYPES.DELETE) {
//         lines.push(SlackNotifyService.sanitizeSlackLine_(
//           `- [DELETE] ${rowLabel} . ${SlackNotifyService.buildSeqInfo_(d.prevRow)} .`
//         ));
//         out.push({ lines: lines });
//         return;
//       }

//       if (d.type === DIFF_TYPES.MODIFY) {
//         lines.push(SlackNotifyService.sanitizeSlackLine_(
//           `- [MODIFY] ${rowLabel} . ${SlackNotifyService.buildSeqInfo_(d.currRow)} .`
//         ));

//         const diffCols = d.diffCols || [];
//         diffCols.forEach(colIdx => {
//           const rawColName =
//             (meta.headers && typeof meta.headers[colIdx] !== 'undefined')
//               ? meta.headers[colIdx]
//               : `COL_${colIdx + 1}`;

//           const colName = SlackNotifyService.normalizeDisplayValue_(rawColName);

//           const beforeRaw = d.prevRow ? d.prevRow[colIdx] : '';
//           const afterRaw = d.currRow ? d.currRow[colIdx] : '';

//           const before = SlackNotifyService.normalizeDisplayValueOrEmptyMark_(beforeRaw);
//           const after = SlackNotifyService.normalizeDisplayValueOrEmptyMark_(afterRaw);

//           // ★ 先頭インデント維持の sanitize を使う
//           lines.push(SlackNotifyService.sanitizeSlackLine_(
//             `　- ${colName}： ${before} → ${after}`
//           ));
//         });

//         out.push({ lines: lines });
//         return;
//       }

//       lines.push(SlackNotifyService.sanitizeSlackLine_(
//         `[UNKNOWN] ${rowLabel} type=${SlackNotifyService.normalizeDisplayValue_(d.type)}`
//       ));
//       out.push({ lines: lines });
//     });

//     LoggerUtil.info(`diff単位チャンク生成: chunks=${out.length}`);
//     return out;

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Private: Validators
//  * ============================================================
//  */

// SlackNotifyService.validateMetaForSummary_ = function (meta) {
//   const fn = 'SlackNotifyService.validateMetaForSummary_';
//   LoggerUtil.start(fn);

//   try {
//     if (!meta) throw new Error('meta が未指定です');
//     if (!meta.prev) throw new Error('meta.prev が未指定です');
//     if (!meta.curr) throw new Error('meta.curr が未指定です');
//     if (!meta.summary) throw new Error('meta.summary が未指定です');
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// SlackNotifyService.validateMetaForDetail_ = function (meta) {
//   const fn = 'SlackNotifyService.validateMetaForDetail_';
//   LoggerUtil.start(fn);

//   try {
//     if (!meta) throw new Error('meta が未指定です');
//     if (!meta.prev) throw new Error('meta.prev が未指定です');
//     if (!meta.curr) throw new Error('meta.curr が未指定です');
//     if (!Array.isArray(meta.diffs)) throw new Error('meta.diffs が配列ではありません');
//     if (!Array.isArray(meta.headers)) throw new Error('meta.headers が配列ではありません');
//     if (!meta.summary) throw new Error('meta.summary が未指定です');
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Private: Formatting / Normalization
//  * ============================================================
//  */

// SlackNotifyService.normalizeDisplayValue_ = function (value) {
//   if (value === null || typeof value === 'undefined') return '';

//   if (value instanceof Date) {
//     return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
//   }

//   if (typeof value === 'number') {
//     return SlackNotifyService.formatNumberForSlack_(value);
//   }

//   return String(value)
//     .replace(/\r\n/g, ' ')
//     .replace(/\n/g, ' ')
//     .replace(/\r/g, ' ')
//     .trim();
// };

// SlackNotifyService.normalizeDisplayValueOrEmptyMark_ = function (value) {
//   const normalized = SlackNotifyService.normalizeDisplayValue_(value);
//   return normalized ? normalized : '{空白}';
// };

// SlackNotifyService.formatNumberForSlack_ = function (n) {
//   if (!isFinite(n)) return String(n);

//   const rounded = Math.round(n * 1e9) / 1e9;

//   const asInt = Math.round(rounded);
//   if (Math.abs(rounded - asInt) < 1e-9) {
//     return asInt.toLocaleString('ja-JP');
//   }

//   const fixed2 = Math.round(rounded * 100) / 100;

//   let s = fixed2.toString();
//   if (s.indexOf('.') >= 0) {
//     s = s.replace(/0+$/, '').replace(/\.$/, '');
//   }

//   const parts = s.split('.');
//   parts[0] = Number(parts[0]).toLocaleString('ja-JP');
//   return parts.join('.');
// };

// /**
//  * @private
//  * @description
//  * 先頭インデント維持 + タイムスタンプ混入除去 + 改行除去 + 末尾空白除去
//  *
//  * @param {string} line
//  * @returns {string}
//  */
// SlackNotifyService.sanitizeSlackLine_ = function (line) {
//   const s = (line === null || typeof line === 'undefined') ? '' : String(line);

//   const noBreak = s
//     .replace(/\r\n/g, ' ')
//     .replace(/\n/g, ' ')
//     .replace(/\r/g, ' ');

//   // 正規表現が壊れていたので修正（例: [16:19]）
//   const noTs = noBreak.replace(/$begin:math:display$\\d\{1\,2\}\:\\d\{2\}$end:math:display$/g, '');

//   return noTs.replace(/[ \t\u3000]+$/g, '');
// };

// SlackNotifyService.buildRowLabel_ = function (diff) {
//   const idx = typeof diff.rowIndex === 'number' ? diff.rowIndex : null;
//   if (idx === null) return '';
//   return `Row=${idx + SNAPSHOT_DATA_START_ROW}`;
// };

// SlackNotifyService.buildSeqInfo_ = function (row) {
//   if (!row || row.length === 0) return '';
//   const seq = row[0];
//   const text = SlackNotifyService.normalizeDisplayValue_(seq);
//   return text ? `SeqNo=${text}` : '';
// };

// /* ============================================================
//  * Private: Limits / Helpers
//  * ============================================================
//  */

// SlackNotifyService.getMaxLines_ = function (meta) {
//   const v = meta && meta.maxLines;
//   if (typeof v === 'number' && v > 0) return v;
//   if (typeof SLACK_NOTIFY_MAX_LINES === 'number' && SLACK_NOTIFY_MAX_LINES > 0) return SLACK_NOTIFY_MAX_LINES;
//   return 250;
// };

// SlackNotifyService.getMaxChars_ = function (meta) {
//   const v = meta && meta.maxChars;
//   if (typeof v === 'number' && v > 0) return v;
//   if (typeof SLACK_NOTIFY_MAX_CHARS === 'number' && SLACK_NOTIFY_MAX_CHARS > 0) return SLACK_NOTIFY_MAX_CHARS;
//   return 35000;
// };

// SlackNotifyService.getMaxItems_ = function () {
//   if (typeof SLACK_DETAIL_MAX_ITEMS === 'number' && SLACK_DETAIL_MAX_ITEMS > 0) return SLACK_DETAIL_MAX_ITEMS;
//   return 30;
// };

// /**
//  * @private
//  * @description
//  * 内訳を Slack 制限（maxLines / maxChars）に合わせて“コードブロック付き”の投稿に分割する。
//  *
//  * - warnLine は「1投目」にだけ入れる（Warning 単独投稿にしない）
//  * - prefixLines は「1投目」の先頭に追加（例: SlackOnly の要約ヘッダー）
//  * - 各投稿で ``` を必ず閉じる
//  *
//  * @param {Object} opt
//  * @param {string[]} opt.bodyLines コードブロック内に入れる行
//  * @param {number} opt.maxLines
//  * @param {number} opt.maxChars
//  * @param {string=} opt.warnLine
//  * @param {string[]=} opt.prefixLines
//  * @returns {string[]}
//  */
// SlackNotifyService.splitDetailIntoSlackBlocks_ = function (opt) {
//   const fn = 'SlackNotifyService.splitDetailIntoSlackBlocks_';
//   LoggerUtil.start(fn, {
//     bodyLines: opt && opt.bodyLines ? opt.bodyLines.length : 0,
//     maxLines: opt && opt.maxLines,
//     maxChars: opt && opt.maxChars,
//     hasWarn: !!(opt && opt.warnLine),
//     hasPrefix: !!(opt && opt.prefixLines && opt.prefixLines.length)
//   });

//   try {
//     const bodyLines = (opt && Array.isArray(opt.bodyLines)) ? opt.bodyLines : [];
//     const maxLines = (opt && typeof opt.maxLines === 'number' && opt.maxLines > 0) ? opt.maxLines : 250;
//     const maxChars = (opt && typeof opt.maxChars === 'number' && opt.maxChars > 0) ? opt.maxChars : 35000;
//     const warnLine = (opt && opt.warnLine) ? String(opt.warnLine) : '';
//     const prefixLines = (opt && Array.isArray(opt.prefixLines)) ? opt.prefixLines : [];

//     const blocks = [];
//     const codeOpen  = '```';  // '```text'
//     const codeClose = '```';

//     function buildBaseLines_(blockIndex, blockCount, isFirst) {
//       const lines = [];

//       if (isFirst && prefixLines.length > 0) {
//         prefixLines.forEach(l => lines.push(String(l)));
//         lines.push('');
//       }

//       if (isFirst && warnLine) {
//         lines.push(warnLine);
//         lines.push('');
//       }

//       lines.push('〜〜内訳〜〜' + (blockCount >= 2 ? `（${blockIndex}/${blockCount}）` : ''));
//       lines.push(codeOpen);
//       return lines;
//     }

//     // greedy packing
//     let cursor = 0;
//     const tentativeBlocks = [];

//     while (cursor < Math.max(1, bodyLines.length)) {
//       const buf = [];
//       let charCount = 0;

//       // wrapper 概算（prefix/warn は後段で再調整）
//       const wrapperChars = ('〜〜内訳〜〜\n' + codeOpen + '\n' + codeClose + '\n').length;
//       charCount += wrapperChars;

//       // ラッパー/空行を考慮して少し余裕
//       const usableLineCount = Math.max(1, maxLines - 8);

//       for (let i = 0; i < usableLineCount && cursor < bodyLines.length; i++) {
//         const line = SlackNotifyService.sanitizeSlackLine_(bodyLines[cursor]);
//         const add = line.length + 1;

//         if (charCount + add > maxChars) break;

//         buf.push(line);
//         charCount += add;
//         cursor++;
//       }

//       if (bodyLines.length === 0 && buf.length === 0) {
//         buf.push('（差分内訳なし）');
//         cursor = 1;
//       }

//       tentativeBlocks.push(buf);

//       if (buf.length === 0) {
//         // 1行も入らない＝異常に長い行など
//         buf.push('（出力できないほど長い行が含まれています）');
//         cursor++;
//       }
//     }

//     const blockCount = Math.max(1, tentativeBlocks.length);

//     for (let i = 0; i < tentativeBlocks.length; i++) {
//       const isFirst = (i === 0);
//       const base = buildBaseLines_(i + 1, blockCount, isFirst);

//       const lines = base.slice();
//       tentativeBlocks[i].forEach(l => lines.push(l));
//       lines.push(codeClose);

//       let text = lines.join('\n');

//       // prefix/warn を入れたことで maxChars を超えたら後ろから削る
//       if (text.length > maxChars) {
//         while (text.length > maxChars && tentativeBlocks[i].length > 1) {
//           tentativeBlocks[i].pop();
//           const lines2 = buildBaseLines_(i + 1, blockCount, isFirst);
//           tentativeBlocks[i].forEach(l => lines2.push(l));
//           lines2.push(codeClose);
//           text = lines2.join('\n');
//         }

//         if (text.length > maxChars) {
//           const lines3 = buildBaseLines_(i + 1, blockCount, isFirst);
//           lines3.push('（省略：文字数制限）');
//           lines3.push(codeClose);
//           text = lines3.join('\n');
//         }
//       }

//       blocks.push(text);
//     }

//     if (blocks.length === 0) {
//       const fallback = [];
//       prefixLines.forEach(l => fallback.push(String(l)));
//       if (prefixLines.length) fallback.push('');
//       if (warnLine) fallback.push(warnLine, '');
//       fallback.push('〜〜内訳〜〜');
//       fallback.push(codeOpen);
//       fallback.push('（差分内訳なし）');
//       fallback.push(codeClose);
//       blocks.push(fallback.join('\n'));
//     }

//     LoggerUtil.info(`内訳ブロック生成: blocks=${blocks.length}`);
//     return blocks;

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };
