// /**
//  * ============================================================
//  * SlackNotifyService.gs
//  *
//  * @overview
//  * Slack 通知専用サービス（整形＋送信のみ）。
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
//  * Global-like constants (possible overrides by Config.gs)
//  * ============================================================
//  * - Apps Script では「ファイル直下の const」は実質グローバル定義扱い。
//  * - 既存 Config の値があればそれを優先し、なければ既定値を使う。
//  */

// /** @type {number} Slack 投稿の最大行数（既定） */
// const SLACK_NOTIFY_MAX_LINES_DEFAULT = 250;

// /** @type {number} Slack 投稿の最大文字数（既定） */
// const SLACK_NOTIFY_MAX_CHARS_DEFAULT = 35000;

// /** @type {number} Slack 内訳に採用する最大 diff 件数（既定） */
// const SLACK_DETAIL_MAX_ITEMS_DEFAULT = 30;

// /** @type {string} Slack コードブロック開始 */
// const SLACK_CODE_OPEN = '```text';

// /** @type {string} Slack コードブロック終了 */
// const SLACK_CODE_CLOSE = '```';

// /** @type {string} Slack 通知タイトル（固定文言） */
// const SLACK_DIFF_TITLE = '■■ 収支見込表 diff ■■';

// /* ============================================================
//  * Public: Sheet 出力あり（要約＋リンク）
//  * ============================================================
//  */

// /**
//  * @description
//  * diff シート URL を含む「要約通知」を Slack に送信する（sheet出力ありルート）。
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
//     hasDiffSheets: !!(meta && meta.diffSheets && meta.diffSheets.length),
//     hasDiffUrl: !!(meta && meta.diffSheetUrl),
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
//  * - SlackOnly では「要約ヘッダー（比較元/比較先/件数）」を内訳1投目の先頭に付与する
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
//     diffCount: meta && meta.diffs ? meta.diffs.length : 0,
//     headerCount: meta && meta.headers ? meta.headers.length : 0,
//     summary: meta && meta.summary,
//     channel: meta && meta.channel
//   });

//   try {
//     SlackNotifyService.validateMetaForDetail_(meta);

//     const webhookUrl = SlackNotifyService.getWebhookUrl_();
//     const payloadBase = SlackNotifyService.buildPayloadBase_(meta);

//     const maxLines = SlackNotifyService.getMaxLines_(meta);
//     const maxChars = SlackNotifyService.getMaxChars_(meta);
//     const maxItems = SlackNotifyService.getMaxItems_();

//     const summary = SlackNotifyService.normalizeSummary_(meta.summary);
//     const total = summary.mod + summary.add + summary.del;

//     LoggerUtil.info(`SlackOnly: maxLines=${maxLines}, maxChars=${maxChars}, maxItems=${maxItems}, total=${total}`);

//     // 1投目に載せる「要約ヘッダー」行（prefixLines）
//     const prefixLines = SlackNotifyService.buildCommonHeaderLines_({
//       prev: meta.prev,
//       curr: meta.curr,
//       summary: summary,
//       // SlackOnly は URL を持たないため diffSheets は渡さない
//       diffSheets: null
//     });

//     // 内訳（diff件数ベースで制限）
//     const bodyLines = SlackNotifyService.buildLimitedBodyLinesByDiff_(meta, maxItems);

//     // 件数が多い場合の warning（1投目のみ）
//     const warnLine = (total > maxItems)
//       ? `差分箇所が多いです（総数：${total}）。Slack の制限の都合上、先頭 ${maxItems} 件のみ出力します。`
//       : '';

//     // コードブロック分割（prefixLines + warnLine は 1投目のみ）
//     const blocks = SlackNotifyService.splitDetailIntoSlackBlocks_({
//       bodyLines: bodyLines,
//       maxLines: maxLines,
//       maxChars: maxChars,
//       warnLine: warnLine,
//       prefixLines: prefixLines
//     });

//     LoggerUtil.info(`SlackOnly: blocks=${blocks.length}`);

//     for (let i = 0; i < blocks.length; i++) {
//       LoggerUtil.info(`SlackOnly: 内訳ブロック送信 ${i + 1}/${blocks.length}`);
//       SlackNotifyService.post_(webhookUrl, Object.assign({}, payloadBase, { text: blocks[i] }));
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
//  * diff結果を「要約 + diffシートURL（2本推奨） + 詳細内訳」を Slack に通知する（統合通知）。
//  *
//  * 仕様：
//  * - 要約＋URL は 1投稿
//  * - 内訳はコードブロック化し、必要なら分割投稿
//  * - 総数が上限超なら Warning + 先頭N件のみ
//  *
//  * @param {Object} meta
//  * @param {string} meta.prev
//  * @param {string} meta.curr
//  * @param {{add:number,del:number,mod:number}} meta.summary
//  * @param {string=} meta.diffSheetUrl 後方互換（単一URL）
//  * @param {Array<{label:string,sheetName:string,url:string}>=} meta.diffSheets 2リンク用（推奨）
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
//     diffCount: meta && meta.diffs ? meta.diffs.length : 0,
//     headerCount: meta && meta.headers ? meta.headers.length : 0,
//     summary: meta && meta.summary,
//     hasDiffSheets: !!(meta && meta.diffSheets && meta.diffSheets.length),
//     hasDiffUrl: !!(meta && meta.diffSheetUrl),
//     channel: meta && meta.channel
//   });

//   try {
//     SlackNotifyService.validateMetaForDetail_(meta);

//     const webhookUrl = SlackNotifyService.getWebhookUrl_();
//     const payloadBase = SlackNotifyService.buildPayloadBase_(meta);

//     const maxLines = SlackNotifyService.getMaxLines_(meta);
//     const maxChars = SlackNotifyService.getMaxChars_(meta);
//     const maxItems = SlackNotifyService.getMaxItems_();

//     const summary = SlackNotifyService.normalizeSummary_(meta.summary);
//     const total = summary.mod + summary.add + summary.del;

//     LoggerUtil.info(`統合通知: maxLines=${maxLines}, maxChars=${maxChars}, maxItems=${maxItems}, total=${total}`);

//     // 1) 要約＋URL（2本推奨）
//     const summaryText = SlackNotifyService.buildSummaryText_(meta);
//     LoggerUtil.info('統合通知: 要約（+URL）送信開始');
//     SlackNotifyService.post_(webhookUrl, Object.assign({}, payloadBase, { text: summaryText }));
//     LoggerUtil.info('統合通知: 要約（+URL）送信完了');

//     // 2) 内訳（diff件数ベースで制限）
//     const bodyLines = SlackNotifyService.buildLimitedBodyLinesByDiff_(meta, maxItems);

//     const warnLine = (total > maxItems)
//       ? `差分箇所が多いです（総数：${total}）。Slack の制限の都合上、先頭 ${maxItems} 件のみ出力します。`
//       : '';

//     const blocks = SlackNotifyService.splitDetailIntoSlackBlocks_({
//       bodyLines: bodyLines,
//       maxLines: maxLines,
//       maxChars: maxChars,
//       warnLine: warnLine
//       // 統合通知は prefixLines なし（要約投稿を先に出しているため）
//     });

//     LoggerUtil.info(`統合通知: blocks=${blocks.length}`);

//     for (let i = 0; i < blocks.length; i++) {
//       LoggerUtil.info(`統合通知: 内訳ブロック送信 ${i + 1}/${blocks.length}`);
//       SlackNotifyService.post_(webhookUrl, Object.assign({}, payloadBase, { text: blocks[i] }));
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
//  * - EXEC_ENV=prod の場合: SLACK_PROP_WEBHOOK_URL_PROD
//  * - それ以外: SLACK_PROP_WEBHOOK_URL_TEST
//  *
//  * @returns {string} Slack Incoming Webhook URL
//  */
// SlackNotifyService.getWebhookUrl_ = function () {
//   const fn = 'SlackNotifyService.getWebhookUrl_';
//   LoggerUtil.start(fn);

//   try {
//     const props = PropertiesService.getScriptProperties();

//     const key = (EXEC_ENV === 'prod')
//       ? SLACK_PROP_WEBHOOK_URL_PROD
//       : SLACK_PROP_WEBHOOK_URL_TEST;

//     const url = props.getProperty(key);
//     if (!url) {
//       // どのキーを見に行ったか、原因が明確になるようにメッセージへ含める
//       throw new Error(`Slack Webhook 未設定: key=${key}（Script Properties を確認してください）`);
//     }

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
//  * - payload.text の存在を強制
//  * - Slack から 2xx 以外が返った場合は body をログに残し例外
//  *
//  * @param {string} webhookUrl Slack Incoming Webhook URL
//  * @param {{text:string, channel?:string}} payload Slack payload
//  * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse}
//  */
// SlackNotifyService.post_ = function (webhookUrl, payload) {
//   const fn = 'SlackNotifyService.post_';
//   LoggerUtil.start(fn);

//   try {
//     if (!webhookUrl) throw new Error('webhookUrl が空です');
//     if (!payload || typeof payload.text !== 'string') {
//       throw new Error(`payload.text が不正です: payload=${JSON.stringify(payload)}`);
//     }

//     // Incoming Webhook は mrkdwn を text にそのまま解釈する前提
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
//       // 失敗時は body をログに残す（原因が Slack 側の制約であるケースを追いやすい）
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

// /**
//  * @private
//  * @description
//  * Slack payload の共通ベースを作る。
//  * - channel 指定があれば含める（Webhook 側の設定に依存）
//  *
//  * @param {Object} meta
//  * @returns {{channel?:string}}
//  */
// SlackNotifyService.buildPayloadBase_ = function (meta) {
//   const fn = 'SlackNotifyService.buildPayloadBase_';
//   LoggerUtil.start(fn, { channel: meta && meta.channel });

//   try {
//     const base = {};
//     if (meta && meta.channel) base.channel = meta.channel;
//     return base;

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
//  * Slack mrkdwn のリンク形式を生成する: <URL|表示テキスト>
//  *
//  * @param {string} url
//  * @param {string} text
//  * @returns {string}
//  */
// SlackNotifyService.buildSlackLink_ = function (url, text) {
//   const fn = 'SlackNotifyService.buildSlackLink_';
//   LoggerUtil.start(fn, { hasUrl: !!url, hasText: !!text });

//   try {
//     const u = String(url || '').trim();
//     const t = String(text || '').trim();
//     if (!u || !t) return '';
//     return `<${u}|${t}>`;

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
//  * 通知の共通ヘッダー行（タイトル / 比較元・先 / 件数）を生成する。
//  *
//  * - SlackOnly の 1投目 prefixLines に使う
//  * - 将来的に「比較元/比較先をリンク化」したくなった場合も、この関数へ集約して差し替えられる
//  *
//  * @param {Object} opt
//  * @param {string} opt.prev
//  * @param {string} opt.curr
//  * @param {{add:number,del:number,mod:number}} opt.summary
//  * @param {Array<{label:string,sheetName:string,url:string}>=} opt.diffSheets
//  * @returns {string[]} 行配列
//  */
// SlackNotifyService.buildCommonHeaderLines_ = function (opt) {
//   const fn = 'SlackNotifyService.buildCommonHeaderLines_';
//   LoggerUtil.start(fn, {
//     prev: opt && opt.prev,
//     curr: opt && opt.curr,
//     summary: opt && opt.summary,
//     hasDiffSheets: !!(opt && opt.diffSheets && opt.diffSheets.length)
//   });

//   try {
//     const summary = SlackNotifyService.normalizeSummary_(opt && opt.summary);
//     const total = summary.mod + summary.add + summary.del;

//     const prev = SlackNotifyService.normalizeDisplayValue_(opt && opt.prev);
//     const curr = SlackNotifyService.normalizeDisplayValue_(opt && opt.curr);

//     const lines = [];
//     lines.push(SLACK_DIFF_TITLE);
//     lines.push(`比較元: ${prev} | 比較先: ${curr}`);
//     lines.push(`【結果】総数：${total}（ MODIFY=${summary.mod} | ADD=${summary.add} | DELETE=${summary.del} ）`);

//     // ここで URL も付けたい場合は、呼び出し側で buildDiffSheetsLines_ を別途追加する想定
//     return lines;

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
//  * diff シートのリンク行（2本推奨）を生成する。
//  *
//  * - 「定義（dataTargets）」と「処理（ループ）」を分離する。
//  * - Slack の mrkdwn 形式で「シート名をリンク化」する。
//  *
//  * @param {Object} meta
//  * @returns {string[]} 行配列（0行の可能性あり）
//  */
// SlackNotifyService.buildDiffSheetsLines_ = function (meta) {
//   const fn = 'SlackNotifyService.buildDiffSheetsLines_';
//   LoggerUtil.start(fn, {
//     hasDiffSheets: !!(meta && meta.diffSheets && meta.diffSheets.length),
//     hasDiffUrl: !!(meta && meta.diffSheetUrl)
//   });

//   try {
//     const lines = [];

//     // --- dataTargets（定義） ---
//     /** @type {Array<{label:string,sheetName:string,url:string}>} */
//     const dataTargets = [];

//     // 推奨: diffSheets（2本リンク）
//     if (meta && Array.isArray(meta.diffSheets) && meta.diffSheets.length > 0) {
//       meta.diffSheets.forEach(ds => {
//         if (!ds) return;
//         dataTargets.push({
//           label: ds.label,
//           sheetName: ds.sheetName,
//           url: ds.url
//         });
//       });
//     }

//     // 後方互換: 単一URL（label/sheetName が無いので素のURLで出す）
//     const hasTargets = dataTargets.length > 0;
//     const fallbackUrl = String((meta && meta.diffSheetUrl) ? meta.diffSheetUrl : '').trim();

//     if (!hasTargets && fallbackUrl) {
//       lines.push('▼ diff シート');
//       lines.push(fallbackUrl);
//       return lines;
//     }

//     if (!hasTargets) return lines;

//     lines.push('▼ diff シート');

//     // --- loop（処理） ---
//     dataTargets.forEach(t => {
//       const label = SlackNotifyService.normalizeDisplayValue_(t.label);
//       const sheetName = SlackNotifyService.normalizeDisplayValue_(t.sheetName);
//       const url = String(t.url || '').trim();

//       if (!label || !sheetName || !url) return;

//       const link = SlackNotifyService.buildSlackLink_(url, sheetName);
//       if (!link) return;

//       lines.push(`・${label}  : ${link}`);
//     });

//     return lines;

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
//  * 要約テキストを生成する（統合通知でも利用）。
//  *
//  * - 2リンク（diffSheets）を優先
//  * - 無い場合は後方互換として diffSheetUrl を使用
//  *
//  * @param {Object} meta
//  * @returns {string}
//  */
// SlackNotifyService.buildSummaryText_ = function (meta) {
//   const fn = 'SlackNotifyService.buildSummaryText_';
//   LoggerUtil.start(fn);

//   try {
//     const summary = SlackNotifyService.normalizeSummary_(meta && meta.summary);
//     const headerLines = SlackNotifyService.buildCommonHeaderLines_({
//       prev: meta && meta.prev,
//       curr: meta && meta.curr,
//       summary: summary
//     });

//     const diffLines = SlackNotifyService.buildDiffSheetsLines_(meta);

//     // 結合（ここでは「ヘッダー」「URL」まで。内訳は別投稿で送る設計）
//     const lines = [];
//     headerLines.forEach(l => lines.push(l));

//     if (diffLines.length > 0) {
//       lines.push('');
//       diffLines.forEach(l => lines.push(l));
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
//  *
//  * - 1 diff => 先頭行（[ADD]/[DELETE]/[MODIFY]）＋必要なら列差分行
//  * - 返り値は diff件数と同じ長さの配列になる
//  *
//  * @param {Object} meta
//  * @returns {Array<{lines:string[]}>}
//  */
// SlackNotifyService.buildDetailBodyChunksByDiff_ = function (meta) {
//   const fn = 'SlackNotifyService.buildDetailBodyChunksByDiff_';
//   LoggerUtil.start(fn, {
//     diffCount: meta && meta.diffs ? meta.diffs.length : 0,
//     headerCount: meta && meta.headers ? meta.headers.length : 0
//   });

//   try {
//     const out = [];

//     (meta.diffs || []).forEach(d => {
//       if (!d || !d.type) return;

//       /** @type {string[]} */
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
//         // diff 1件の先頭行
//         lines.push(SlackNotifyService.sanitizeSlackLine_(
//           `- [MODIFY] ${rowLabel} . ${SlackNotifyService.buildSeqInfo_(d.currRow)} .`
//         ));

//         // 列差分行（インデント維持）
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

//           lines.push(SlackNotifyService.sanitizeSlackLine_(
//             `　- ${colName}： ${before} → ${after}`
//           ));
//         });

//         out.push({ lines: lines });
//         return;
//       }

//       // 想定外 type
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

// /**
//  * @private
//  * @description
//  * diff件数ベースで内訳を制限し、Slack 投稿用の「1行配列（bodyLines）」を作る。
//  *
//  * - 30件超などの場合に先頭 N 件のみ採用する用途
//  * - 「定義（dataTargets）」と「処理（ループ）」を分離し、冗長化を避ける
//  *
//  * @param {Object} meta
//  * @param {number} maxItems
//  * @returns {string[]} bodyLines
//  */
// SlackNotifyService.buildLimitedBodyLinesByDiff_ = function (meta, maxItems) {
//   const fn = 'SlackNotifyService.buildLimitedBodyLinesByDiff_';
//   LoggerUtil.start(fn, { maxItems });

//   try {
//     const summary = SlackNotifyService.normalizeSummary_(meta && meta.summary);
//     const total = summary.mod + summary.add + summary.del;

//     // --- dataTargets（定義） ---
//     const chunks = SlackNotifyService.buildDetailBodyChunksByDiff_(meta);
//     const limitedChunks = (total <= maxItems) ? chunks : chunks.slice(0, maxItems);

//     // --- loop（処理） ---
//     /** @type {string[]} */
//     const bodyLines = [];
//     limitedChunks.forEach(c => (c.lines || []).forEach(l => bodyLines.push(l)));

//     if (bodyLines.length === 0) bodyLines.push('（差分内訳なし）');

//     LoggerUtil.info(`bodyLines生成: total=${total}, chunks=${chunks.length}, limited=${limitedChunks.length}, bodyLines=${bodyLines.length}`);
//     return bodyLines;

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

// /**
//  * @private
//  * @description
//  * 要約通知用 meta の最低限バリデーション。
//  *
//  * @param {Object} meta
//  */
// SlackNotifyService.validateMetaForSummary_ = function (meta) {
//   const fn = 'SlackNotifyService.validateMetaForSummary_';
//   LoggerUtil.start(fn);

//   try {
//     if (!meta) throw new Error('meta が未指定です');
//     if (!meta.prev) throw new Error('meta.prev が未指定です');
//     if (!meta.curr) throw new Error('meta.curr が未指定です');
//     if (!meta.summary) throw new Error('meta.summary が未指定です');

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
//  * 詳細通知用 meta の最低限バリデーション。
//  *
//  * @param {Object} meta
//  */
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

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Private: Formatting / Normalization
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * summary の欠損を吸収し、常に {add,del,mod} を返す。
//  *
//  * @param {{add:number,del:number,mod:number}|null|undefined} s
//  * @returns {{add:number,del:number,mod:number}}
//  */
// SlackNotifyService.normalizeSummary_ = function (s) {
//   const fn = 'SlackNotifyService.normalizeSummary_';
//   LoggerUtil.start(fn);

//   try {
//     const out = {
//       add: (s && typeof s.add === 'number') ? s.add : 0,
//       del: (s && typeof s.del === 'number') ? s.del : 0,
//       mod: (s && typeof s.mod === 'number') ? s.mod : 0
//     };
//     return out;

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
//  * 表示用正規化。
//  * - 改行コードをスペースへ置換（\r\n, \n, \r）
//  * - 前後空白を trim（※先頭インデントが必要な行は sanitizeSlackLine_ を使用）
//  * - Date は yyyy-MM-dd
//  * - number は Slack 表示向けに丸め（浮動小数誤差を吸収）
//  *
//  * @param {any} value
//  * @returns {string}
//  */
// SlackNotifyService.normalizeDisplayValue_ = function (value) {
//   const fn = 'SlackNotifyService.normalizeDisplayValue_';
//   // normalize は大量に呼ばれるため、start/end を省略するとログ量は減るが、
//   // ルールに合わせ、最低限の start だけ入れておく（verbose 運用時のみ有効化などは LoggerUtil 側で調整可能）
//   LoggerUtil.start(fn);

//   try {
//     if (value === null || typeof value === 'undefined') return '';

//     if (value instanceof Date) {
//       return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
//     }

//     if (typeof value === 'number') {
//       return SlackNotifyService.formatNumberForSlack_(value);
//     }

//     return String(value)
//       .replace(/\r\n/g, ' ')
//       .replace(/\n/g, ' ')
//       .replace(/\r/g, ' ')
//       .trim();

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
//  * 値が空の場合に {空白} を返す。
//  *
//  * @param {any} value
//  * @returns {string}
//  */
// SlackNotifyService.normalizeDisplayValueOrEmptyMark_ = function (value) {
//   const fn = 'SlackNotifyService.normalizeDisplayValueOrEmptyMark_';
//   LoggerUtil.start(fn);

//   try {
//     const normalized = SlackNotifyService.normalizeDisplayValue_(value);
//     return normalized ? normalized : '{空白}';

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
//  * Slack表示用に数値を整形する。
//  *
//  * - 浮動小数誤差（例: 110000.00000000001）を吸収
//  * - 小数部が実質0なら整数化
//  * - 小数がある場合は最大2桁まで
//  * - カンマ区切り
//  *
//  * @param {number} n
//  * @returns {string}
//  */
// SlackNotifyService.formatNumberForSlack_ = function (n) {
//   const fn = 'SlackNotifyService.formatNumberForSlack_';
//   LoggerUtil.start(fn);

//   try {
//     if (!isFinite(n)) return String(n);

//     // 誤差吸収（強めに丸め）
//     const rounded = Math.round(n * 1e9) / 1e9;

//     const asInt = Math.round(rounded);
//     if (Math.abs(rounded - asInt) < 1e-9) {
//       return asInt.toLocaleString('ja-JP');
//     }

//     const fixed2 = Math.round(rounded * 100) / 100;

//     let s = fixed2.toString();
//     if (s.indexOf('.') >= 0) {
//       s = s.replace(/0+$/, '').replace(/\.$/, '');
//     }

//     const parts = s.split('.');
//     parts[0] = Number(parts[0]).toLocaleString('ja-JP');
//     return parts.join('.');

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
//  * Slack 表示のための「行」正規化。
//  *
//  * ポイント：
//  * - 先頭インデント（全角スペース等）を維持（trim()しない）
//  * - 改行はスペース化（Slack 表示ノイズ除去）
//  * - Slackのタイムスタンプ混入（例: [16:19]）を除去
//  * - 末尾空白のみ除去（先頭は維持）
//  *
//  * @param {string} line
//  * @returns {string}
//  */
// SlackNotifyService.sanitizeSlackLine_ = function (line) {
//   const fn = 'SlackNotifyService.sanitizeSlackLine_';
//   LoggerUtil.start(fn);

//   try {
//     const s = (line === null || typeof line === 'undefined') ? '' : String(line);

//     const noBreak = s
//       .replace(/\r\n/g, ' ')
//       .replace(/\n/g, ' ')
//       .replace(/\r/g, ' ');

//     const noTs = noBreak.replace(/$begin:math:display$\\d\{1\,2\}\:\\d\{2\}$end:math:display$/g, '');

//     return noTs.replace(/[ \t\u3000]+$/g, '');

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
//  * Diff 情報から行ラベル（Row=...）を生成する。
//  *
//  * @param {Object} diff
//  * @returns {string}
//  */
// SlackNotifyService.buildRowLabel_ = function (diff) {
//   const fn = 'SlackNotifyService.buildRowLabel_';
//   LoggerUtil.start(fn);

//   try {
//     const idx = typeof diff.rowIndex === 'number' ? diff.rowIndex : null;
//     if (idx === null) return '';
//     return `Row=${idx + SNAPSHOT_DATA_START_ROW}`;

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
//  * 行データの先頭列を SecNO とみなし表示する（正規化あり）。
//  *
//  * @param {Array<any>} row
//  * @returns {string}
//  */
// SlackNotifyService.buildSeqInfo_ = function (row) {
//   const fn = 'SlackNotifyService.buildSeqInfo_';
//   LoggerUtil.start(fn);

//   try {
//     if (!row || row.length === 0) return '';
//     const seq = row[0];
//     const text = SlackNotifyService.normalizeDisplayValue_(seq);
//     return text ? `SecNO=${text}` : '';

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Private: Limits / Helpers
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * Slack 投稿の最大行数（既定値）を取得する。
//  *
//  * 優先順位：
//  * 1) meta.maxLines
//  * 2) Config.gs の SLACK_NOTIFY_MAX_LINES
//  * 3) このファイルの既定値
//  *
//  * @param {Object} meta
//  * @returns {number}
//  */
// SlackNotifyService.getMaxLines_ = function (meta) {
//   const fn = 'SlackNotifyService.getMaxLines_';
//   LoggerUtil.start(fn);

//   try {
//     const v = meta && meta.maxLines;
//     if (typeof v === 'number' && v > 0) return v;

//     if (typeof SLACK_NOTIFY_MAX_LINES === 'number' && SLACK_NOTIFY_MAX_LINES > 0) {
//       return SLACK_NOTIFY_MAX_LINES;
//     }

//     return SLACK_NOTIFY_MAX_LINES_DEFAULT;

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
//  * Slack 投稿の最大文字数（既定値）を取得する。
//  *
//  * 優先順位：
//  * 1) meta.maxChars
//  * 2) Config.gs の SLACK_NOTIFY_MAX_CHARS
//  * 3) このファイルの既定値
//  *
//  * @param {Object} meta
//  * @returns {number}
//  */
// SlackNotifyService.getMaxChars_ = function (meta) {
//   const fn = 'SlackNotifyService.getMaxChars_';
//   LoggerUtil.start(fn);

//   try {
//     const v = meta && meta.maxChars;
//     if (typeof v === 'number' && v > 0) return v;

//     if (typeof SLACK_NOTIFY_MAX_CHARS === 'number' && SLACK_NOTIFY_MAX_CHARS > 0) {
//       return SLACK_NOTIFY_MAX_CHARS;
//     }

//     return SLACK_NOTIFY_MAX_CHARS_DEFAULT;

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
//  * 内訳の最大採用件数（diff件数ベース）を取得する。
//  *
//  * 優先順位：
//  * 1) Config.gs の SLACK_DETAIL_MAX_ITEMS
//  * 2) このファイルの既定値
//  *
//  * @returns {number}
//  */
// SlackNotifyService.getMaxItems_ = function () {
//   const fn = 'SlackNotifyService.getMaxItems_';
//   LoggerUtil.start(fn);

//   try {
//     if (typeof SLACK_DETAIL_MAX_ITEMS === 'number' && SLACK_DETAIL_MAX_ITEMS > 0) {
//       return SLACK_DETAIL_MAX_ITEMS;
//     }
//     return SLACK_DETAIL_MAX_ITEMS_DEFAULT;

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Private: Slack Code Block Splitter
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * 内訳を Slack 制限（maxLines / maxChars）に合わせて“コードブロック付き”の投稿に分割する。
//  *
//  * 重要仕様：
//  * - warnLine は「1投目」にだけ入れる（Warning 単独投稿にしない）
//  * - prefixLines は「1投目」の先頭に追加（例: SlackOnly の要約ヘッダー）
//  * - 各投稿で ``` を必ず閉じる
//  * - 0行でも 1投稿は必ず返す
//  *
//  * 実装方針：
//  * - 「まず greedy に本文（bodyLines）を詰めた tentativeBlocks を作る」
//  * - 「1投目だけ prefix/warn を付けるので、最終的に maxChars 超なら後ろから削る」
//  * - 「必ずコードブロックを閉じる」
//  *
//  * @param {Object} opt
//  * @param {string[]} opt.bodyLines コードブロック内に入れる行（sanitize 済み/未済み混在OK）
//  * @param {number} opt.maxLines
//  * @param {number} opt.maxChars
//  * @param {string=} opt.warnLine 1投目に入れる Warning
//  * @param {string[]=} opt.prefixLines 1投目先頭に入れる前置き行
//  * @returns {string[]} Slack 投稿テキスト配列
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
//     const maxLines = (opt && typeof opt.maxLines === 'number' && opt.maxLines > 0) ? opt.maxLines : SLACK_NOTIFY_MAX_LINES_DEFAULT;
//     const maxChars = (opt && typeof opt.maxChars === 'number' && opt.maxChars > 0) ? opt.maxChars : SLACK_NOTIFY_MAX_CHARS_DEFAULT;
//     const warnLine = (opt && opt.warnLine) ? String(opt.warnLine) : '';
//     const prefixLines = (opt && Array.isArray(opt.prefixLines)) ? opt.prefixLines : [];

//     /** @type {string[]} */
//     const blocks = [];

//     /**
//      * @description
//      * 1ブロックのヘッダー部分（prefix/warn/見出し/コード開始）を構築する。
//      *
//      * @param {number} blockIndex 1始まり
//      * @param {number} blockCount 総ブロック数
//      * @param {boolean} isFirst 1投目か
//      * @returns {string[]}
//      */
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
//       lines.push(SLACK_CODE_OPEN);
//       return lines;
//     }

//     // まず greedy で “コード内の行” を maxChars/maxLines に収まるだけ詰める（prefix/warn は後段で再調整）
//     let cursor = 0;
//     /** @type {Array<string[]>} */
//     const tentativeBlocks = [];

//     // 本文が空でも 1 回は回す（最低1投稿保証）
//     while (cursor < Math.max(1, bodyLines.length)) {
//       /** @type {string[]} */
//       const buf = [];
//       let charCount = 0;

//       // wrapper の概算（prefix/warn はここでは見積もらない）
//       const wrapperChars = ('〜〜内訳〜〜\n' + SLACK_CODE_OPEN + '\n' + SLACK_CODE_CLOSE + '\n').length;
//       charCount += wrapperChars;

//       // ブロック内の行数上限（見出し/コード開始/終了 + 余白を考慮）
//       const usableLineCount = Math.max(1, maxLines - 6);

//       for (let i = 0; i < usableLineCount && cursor < bodyLines.length; i++) {
//         const line = SlackNotifyService.sanitizeSlackLine_(bodyLines[cursor]);
//         const add = line.length + 1; // + \n

//         if (charCount + add > maxChars) break;

//         buf.push(line);
//         charCount += add;
//         cursor++;
//       }

//       // bodyLines が空だった場合でも 1行は入れる
//       if (bodyLines.length === 0 && buf.length === 0) {
//         buf.push('（差分内訳なし）');
//         cursor = 1;
//       }

//       tentativeBlocks.push(buf);

//       // 文字数のせいで 0 行のまま抜けた場合は無限ループになるので強制追加
//       if (buf.length === 0) {
//         buf.push('（出力できないほど長い行が含まれています）');
//         cursor++;
//       }
//     }

//     const blockCount = Math.max(1, tentativeBlocks.length);

//     for (let i = 0; i < tentativeBlocks.length; i++) {
//       const isFirst = (i === 0);

//       // base
//       const base = buildBaseLines_(i + 1, blockCount, isFirst);

//       // compose
//       const lines = base.slice();
//       tentativeBlocks[i].forEach(l => lines.push(l));
//       lines.push(SLACK_CODE_CLOSE);

//       let text = lines.join('\n');

//       // 1投目は prefix/warn が乗るため超過しやすい。超過したら本文を削って収める。
//       if (text.length > maxChars) {
//         LoggerUtil.info(`block(${i + 1}) が maxChars を超過: len=${text.length}, maxChars=${maxChars} -> 調整開始`);

//         // 後ろから削って収める（最低1行は残す）
//         while (text.length > maxChars && tentativeBlocks[i].length > 1) {
//           tentativeBlocks[i].pop();
//           const lines2 = buildBaseLines_(i + 1, blockCount, isFirst);
//           tentativeBlocks[i].forEach(l => lines2.push(l));
//           lines2.push(SLACK_CODE_CLOSE);
//           text = lines2.join('\n');
//         }

//         // それでも無理なら、本文は 1行固定にする（ヘッダー＋コードブロックを守る）
//         if (text.length > maxChars) {
//           LoggerUtil.info(`block(${i + 1}) がまだ超過: len=${text.length} -> 強制簡略化`);
//           const lines3 = buildBaseLines_(i + 1, blockCount, isFirst);
//           lines3.push('（省略：文字数制限）');
//           lines3.push(SLACK_CODE_CLOSE);
//           text = lines3.join('\n');
//         }
//       }

//       blocks.push(text);
//     }

//     // 最低1投稿保証（理論上ここには来ないが保険）
//     if (blocks.length === 0) {
//       LoggerUtil.info('blocks が空のため fallback を生成');
//       const fallback = [];
//       prefixLines.forEach(l => fallback.push(String(l)));
//       if (prefixLines.length) fallback.push('');
//       if (warnLine) fallback.push(warnLine, '');
//       fallback.push('〜〜内訳〜〜');
//       fallback.push(SLACK_CODE_OPEN);
//       fallback.push('（差分内訳なし）');
//       fallback.push(SLACK_CODE_CLOSE);
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
