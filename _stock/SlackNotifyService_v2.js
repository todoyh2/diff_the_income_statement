// /**
//  * ============================================================
//  * SlackNotifyService.gs
//  *
//  * @overview
//  * Slack 通知専用サービス。
//  *
//  * @designPolicy
//  * - diff ロジックと分離（通知＝整形・送信のみ）
//  * - 投稿は「分割しない」（常に 1投稿）
//  * - 内訳はコードブロック化（統一表示）
//  * - ただし「先頭30件」だけでなく、コードブロックが破綻しないよう
//  *   行数・文字数でも強制的に抑制する
//  * - 表示ノイズ（改行、Slackタイムスタンプ混入等）を正規化
//  * - Script Properties の Webhook URL を使用（直書きしない）
//  * - try-catch / logging を徹底
//  *
//  * @dependsOn
//  * - Config.gs（EXEC_ENV / SLACK_PROP_WEBHOOK_URL_* / DIFF_TYPES / SNAPSHOT_DATA_START_ROW / SLACK_* / DIFF_GIT_REP_COLUMNS）
//  * - LoggerUtil.gs
//  * ============================================================
//  */

// /**
//  * @namespace SlackNotifyService
//  */
// const SlackNotifyService = {};

// /* ============================================================
//  * Public
//  * ============================================================
//  */

// /**
//  * @description
//  * 統合通知（要約 + diffシートリンク + 内訳）を 1投稿で送信する。
//  *
//  * - 内訳はコードブロック化
//  * - 分割投稿はしない（必ず1投稿）
//  * - 先頭 SLACK_DETAIL_MAX_ITEMS 件だけでなく、
//  *   SLACK_NOTIFY_MAX_LINES / SLACK_NOTIFY_MAX_CHARS を超えないよう抑制して、
//  *   コードブロックが崩れないことを優先する
//  *
//  * @param {Object} meta
//  * @param {string} meta.prev 比較元シート名
//  * @param {string} meta.curr 比較先シート名
//  * @param {{add:number,del:number,mod:number}} meta.summary 件数要約
//  * @param {Array<Object>} meta.diffs DiffCore.buildDiff or DiffCore.buildDiffGitLike の結果
//  * @param {Array<string>} meta.headers ヘッダー配列
//  * @param {Array<{label:string,sheetName:string,url:string}>=} meta.diffSheets diffシートリンク情報（推奨）
//  * @param {string=} meta.channel webhookが許可する場合のみ
//  */
// SlackNotifyService.notifyDiffResult = function (meta) {
//   const fn = 'SlackNotifyService.notifyDiffResult';
//   LoggerUtil.start(fn, {
//     prev: meta && meta.prev,
//     curr: meta && meta.curr,
//     diffCount: meta && Array.isArray(meta.diffs) ? meta.diffs.length : 'N/A'
//   });

//   try {
//     SlackNotifyService.validateMeta_(meta);

//     const webhookUrl = SlackNotifyService.getWebhookUrl_();

//     const text = SlackNotifyService.buildSinglePostMessage_(meta);

//     const payload = { text: text };
//     if (meta.channel) payload.channel = meta.channel;

//     LoggerUtil.info(`Slack送信開始: textLength=${text.length}`);
//     SlackNotifyService.post_(webhookUrl, payload);
//     LoggerUtil.info('Slack送信完了');

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Private: Message Builder
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * Slackへ 1投稿で送る全文を生成する。
//  *
//  * @param {Object} meta
//  * @returns {string}
//  */
// SlackNotifyService.buildSinglePostMessage_ = function (meta) {
//   const fn = 'SlackNotifyService.buildSinglePostMessage_';
//   LoggerUtil.start(fn);

//   try {
//     const lines = [];

//     // ---- ヘッダー（要約）----
//     const summaryLines = SlackNotifyService.buildSummaryLines_(meta);
//     summaryLines.forEach(l => lines.push(l));

//     // ---- 内訳（コードブロック）----
//     lines.push('');
//     lines.push('〜〜内訳〜〜');

//     const detail = SlackNotifyService.buildDetailCodeBlock_(meta);

//     // warn はコードブロックの外に出す（読みやすさ＆ブロック破綻回避）
//     if (detail.warnLine) {
//       lines.push(detail.warnLine);
//       lines.push('');
//     }

//     // コードブロック（必ず閉じる）
//     lines.push('```');
//     detail.bodyLines.forEach(l => lines.push(l));
//     lines.push('```');

//     // Slack投稿の最大文字数を超える場合も「必ず閉じる」形で切り詰める
//     const maxChars = SlackNotifyService.getMaxChars_();
//     let text = lines.join('\n');

//     if (text.length > maxChars) {
//       LoggerUtil.info(`文字数超過: ${text.length} > ${maxChars} / 強制トリム`);
//       text = SlackNotifyService.trimMessageKeepCodeFence_(text, maxChars);
//     }

//     return text;

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
//  * 要約行（ヘッダー＋リンク）を配列で生成する。
//  *
//  * @param {Object} meta
//  * @returns {string[]}
//  */
// SlackNotifyService.buildSummaryLines_ = function (meta) {
//   const fn = 'SlackNotifyService.buildSummaryLines_';
//   LoggerUtil.start(fn);

//   try {
//     const s = meta.summary || { add: 0, del: 0, mod: 0 };
//     const total = s.mod + s.add + s.del;

//     const prev = SlackNotifyService.normalizeDisplayValue_(meta.prev);
//     const curr = SlackNotifyService.normalizeDisplayValue_(meta.curr);

//     const lines = [];
//     lines.push('■■ 収支見込表 diff ■■');
//     lines.push(`比較元: ${prev} | 比較先: ${curr}`);
//     lines.push(`【結果】総数：${total}（ MODIFY=${s.mod} | ADD=${s.add} | DELETE=${s.del} ）`);

//     if (meta.diffSheets && Array.isArray(meta.diffSheets) && meta.diffSheets.length > 0) {
//       lines.push('');
//       lines.push('▼ diff シート');
//       meta.diffSheets.forEach(ds => {
//         if (!ds) return;
//         const label = SlackNotifyService.normalizeDisplayValue_(ds.label);
//         const sheetName = SlackNotifyService.normalizeDisplayValue_(ds.sheetName);
//         const url = String(ds.url || '').trim();
//         if (!label || !sheetName || !url) return;

//         // Slack mrkdwn link: <URL|text>
//         lines.push(`・${label} : <${url}|${sheetName}>`);
//       });
//     }

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
//  * 内訳のコードブロック本文（行配列）を生成しつつ、
//  * 「件数」「行数」「文字数」の観点で 1つのコードブロックに収まるように抑制する。
//  *
//  * 重要:
//  * - “先頭30件” だけだと 1件あたりの差分列が多いケースでコードブロックが巨大化する
//  * - そのため「行数上限」「文字数上限」でも止める
//  *
//  * @param {Object} meta
//  * @returns {{bodyLines:string[], warnLine:string}}
//  */
// SlackNotifyService.buildDetailCodeBlock_ = function (meta) {
//   const fn = 'SlackNotifyService.buildDetailCodeBlock_';
//   LoggerUtil.start(fn);

//   try {
//     const diffs = Array.isArray(meta.diffs) ? meta.diffs : [];
//     const headers = Array.isArray(meta.headers) ? meta.headers : [];

//     // 1) diff単位の“塊”を作る（1diff => 複数行）
//     const chunks = SlackNotifyService.buildDetailChunksByDiff_(diffs, headers);

//     const maxItems = SlackNotifyService.getMaxItems_();  // 例: 30
//     const maxLines = SlackNotifyService.getMaxLines_();  // 例: 250
//     const maxChars = SlackNotifyService.getMaxChars_();  // 例: 35000

//     // コードブロック外（ヘッダー等）もあるので、コードブロックに使える行数は少し控えめにする
//     // - 目安: 250行丸々をコードに使うと、ヘッダーやWarningで溢れる可能性がある
//     const usableLines = Math.max(10, maxLines - 30);

//     const bodyLines = [];
//     let usedChars = 0;
//     let usedItems = 0;

//     // 2) pack: 件数上限 or 行数上限 or 文字数上限で止める
//     for (let i = 0; i < chunks.length; i++) {
//       if (usedItems >= maxItems) break;

//       const c = chunks[i];
//       const lines = (c && Array.isArray(c.lines)) ? c.lines : [];
//       if (lines.length === 0) continue;

//       // 行数上限チェック（これ以上入れるとコードブロックが“1つ”として危険）
//       if (bodyLines.length + lines.length > usableLines) break;

//       // 文字数上限チェック（コードブロックを含めた全体で超過しないように保守的に）
//       // - ここでは「本文だけ」の概算を積む（全体では後段でも再チェックしてtrimする）
//       const addChars = lines.reduce((acc, l) => acc + String(l).length + 1, 0);
//       if (usedChars + addChars > Math.max(1000, Math.floor(maxChars * 0.80))) {
//         break;
//       }

//       lines.forEach(l => bodyLines.push(l));
//       usedChars += addChars;
//       usedItems++;
//     }

//     if (bodyLines.length === 0) {
//       bodyLines.push('（差分内訳なし）');
//     }

//     // 3) 警告文（「総数」は diff件数、表示は usedItems/usableLines で止めた可能性）
//     const total = chunks.length;

//     let warnLine = '';
//     if (total > usedItems) {
//       // “Slack制限の都合” というより “1つのコードブロックに収めるため” が本質
//       warnLine =
//         `差分箇所が多いです（総数：${total}）。` +
//         `1つのコードブロックとして崩れないよう、先頭 ${usedItems} 件まで表示します。`;
//     }

//     LoggerUtil.info(`内訳生成: totalDiff=${total}, shownDiff=${usedItems}, bodyLines=${bodyLines.length}`);
//     return {
//       bodyLines: bodyLines.map(SlackNotifyService.sanitizeSlackLine_),
//       warnLine: warnLine
//     };

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
//  * diff配列を「diff1件＝複数行」のチャンクに変換する。
//  *
//  * - MODIFY は 先頭行 + 差分列行
//  * - 代表情報は DIFF_GIT_REP_COLUMNS から抽出（存在する列のみ）
//  *
//  * @param {Array<Object>} diffs
//  * @param {Array<string>} headers
//  * @returns {Array<{lines:string[]}>}
//  */
// SlackNotifyService.buildDetailChunksByDiff_ = function (diffs, headers) {
//   const fn = 'SlackNotifyService.buildDetailChunksByDiff_';
//   LoggerUtil.start(fn, { diffs: diffs ? diffs.length : 0 });

//   try {
//     const out = [];

//     (diffs || []).forEach(d => {
//       if (!d || !d.type) return;

//       const lines = [];
//       const rowLabel = SlackNotifyService.buildRowLabel_(d);

//       const rep = SlackNotifyService.buildRepresentativeText_(d, headers);
//       const repSuffix = rep ? ` . ${rep}` : '';

//       if (d.type === DIFF_TYPES.ADD) {
//         lines.push(`- [ADD] ${rowLabel} . ${SlackNotifyService.buildSeqInfo_(d.currRow)} .${repSuffix}`);
//         out.push({ lines });
//         return;
//       }

//       if (d.type === DIFF_TYPES.DELETE) {
//         lines.push(`- [DELETE] ${rowLabel} . ${SlackNotifyService.buildSeqInfo_(d.prevRow)} .${repSuffix}`);
//         out.push({ lines });
//         return;
//       }

//       if (d.type === DIFF_TYPES.MODIFY) {
//         lines.push(`- [MODIFY] ${rowLabel} . ${SlackNotifyService.buildSeqInfo_(d.currRow)} .${repSuffix}`);

//         const diffCols = Array.isArray(d.diffCols) ? d.diffCols : [];
//         diffCols.forEach(colIdx => {
//           const colName =
//             (headers && typeof headers[colIdx] !== 'undefined')
//               ? String(headers[colIdx])
//               : `COL_${colIdx + 1}`;

//           const beforeRaw = d.prevRow ? d.prevRow[colIdx] : '';
//           const afterRaw  = d.currRow ? d.currRow[colIdx] : '';

//           const before = SlackNotifyService.normalizeDisplayValueOrEmptyMark_(beforeRaw);
//           const after  = SlackNotifyService.normalizeDisplayValueOrEmptyMark_(afterRaw);

//           // 先頭インデントはスペース2つで統一（Slack上で安定しやすい）
//           lines.push(`  - ${SlackNotifyService.normalizeDisplayValue_(colName)}： ${before} → ${after}`);
//         });

//         out.push({ lines });
//         return;
//       }

//       lines.push(`[UNKNOWN] ${rowLabel} type=${SlackNotifyService.normalizeDisplayValue_(d.type)}`);
//       out.push({ lines });
//     });

//     LoggerUtil.info(`チャンク生成完了: chunks=${out.length}`);
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
//  * 代表情報（Slack先頭行に付ける）を構築する。
//  *
//  * - DIFF_GIT_REP_COLUMNS に含まれる列を、存在する分だけ "列名=値" で連結する
//  * - 値は normalize する（改行除去など）
//  *
//  * @param {Object} diff
//  * @param {Array<string>} headers
//  * @returns {string}
//  */
// SlackNotifyService.buildRepresentativeText_ = function (diff, headers) {
//   const fn = 'SlackNotifyService.buildRepresentativeText_';
//   LoggerUtil.start(fn);

//   try {
//     const row = diff && (diff.currRow || diff.prevRow);
//     if (!row || !Array.isArray(headers) || headers.length === 0) return '';

//     const repCols = Array.isArray(DIFF_GIT_REP_COLUMNS) ? DIFF_GIT_REP_COLUMNS : [];
//     if (repCols.length === 0) return '';

//     // header -> index
//     const idxMap = {};
//     headers.forEach((h, i) => { idxMap[String(h)] = i; });

//     const parts = [];
//     repCols.forEach(colName => {
//       const key = String(colName);
//       if (!Object.prototype.hasOwnProperty.call(idxMap, key)) return;
//       const i = idxMap[key];
//       const v = SlackNotifyService.normalizeDisplayValueOrEmptyMark_(row[i]);
//       parts.push(`${key}=${v}`);
//     });

//     // 長すぎるとコードブロックが膨らむので、代表情報は安全側で抑制
//     const text = parts.join(' | ');
//     return SlackNotifyService.limitInlineText_(text, 160);

//   } catch (e) {
//     LoggerUtil.error(e);
//     throw e;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

// /* ============================================================
//  * Private: Validators / Webhook / HTTP
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * metaの最低限バリデーション
//  *
//  * @param {Object} meta
//  */
// SlackNotifyService.validateMeta_ = function (meta) {
//   const fn = 'SlackNotifyService.validateMeta_';
//   LoggerUtil.start(fn);

//   try {
//     if (!meta) throw new Error('meta が未指定です');
//     if (!meta.prev) throw new Error('meta.prev が未指定です');
//     if (!meta.curr) throw new Error('meta.curr が未指定です');
//     if (!meta.summary) throw new Error('meta.summary が未指定です');
//     if (!Array.isArray(meta.diffs)) throw new Error('meta.diffs が配列ではありません');
//     if (!Array.isArray(meta.headers)) throw new Error('meta.headers が配列ではありません');
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };

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

//     LoggerUtil.info(`Slack Webhook Key: ${key}`);
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
//  * Private: Formatting / Normalization
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * 表示用正規化。
//  * - 改行コードをスペースへ置換
//  * - 前後空白を trim
//  * - Date は yyyy-MM-dd
//  * - number は文字列化（ここでは安全側。必要なら金額などは別途拡張）
//  *
//  * @param {any} value
//  * @returns {string}
//  */
// SlackNotifyService.normalizeDisplayValue_ = function (value) {
//   if (value === null || typeof value === 'undefined') return '';

//   if (value instanceof Date) {
//     return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
//   }

//   if (typeof value === 'number') {
//     // 小数誤差吸収を入れたい場合はここで（既存実装があるなら差し替えてOK）
//     const rounded = Math.round(value * 1e9) / 1e9;
//     const asInt = Math.round(rounded);
//     if (Math.abs(rounded - asInt) < 1e-9) return asInt.toLocaleString('ja-JP');
//     return String(rounded);
//   }

//   return String(value)
//     .replace(/\r\n/g, ' ')
//     .replace(/\n/g, ' ')
//     .replace(/\r/g, ' ')
//     .trim();
// };

// /**
//  * @private
//  * @description
//  * 値が空の場合は {空白} を返す。
//  *
//  * @param {any} value
//  * @returns {string}
//  */
// SlackNotifyService.normalizeDisplayValueOrEmptyMark_ = function (value) {
//   const s = SlackNotifyService.normalizeDisplayValue_(value);
//   return s ? s : '{空白}';
// };

// /**
//  * @private
//  * @description
//  * Slack表示を壊しやすい混入文字を除去し、行として安全化する。
//  *
//  * - 先頭インデントは維持（trimしない）
//  * - 改行はスペース化
//  * - Slackのタイムスタンプ混入（例: [11:03]）を除去
//  * - ``` を含む場合は破綻要因になるので置換する
//  * - 末尾空白のみ除去
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

//   // [11:03] のような混入を除去（文中に出ても基本ノイズなので消す）
//   const noTs = noBreak.replace(/\[\d{1,2}:\d{2}\]/g, '');

//   // コードフェンスを壊す可能性があるため、本文中の ``` は潰す
//   const noFence = noTs.replace(/```/g, "'''");

//   // 末尾空白だけ除去（先頭は維持）
//   return noFence.replace(/[ \t\u3000]+$/g, '');
// };

// /* ============================================================
//  * Private: Row Labels / Seq / Limits
//  * ============================================================
//  */

// /**
//  * @private
//  * @description
//  * Diff 情報から行ラベル（Row=...）を生成する。
//  *
//  * @param {Object} diff
//  * @returns {string}
//  */
// SlackNotifyService.buildRowLabel_ = function (diff) {
//   const idx = typeof diff.rowIndex === 'number' ? diff.rowIndex : null;
//   if (idx === null) return '';
//   return `Row=${idx + SNAPSHOT_DATA_START_ROW}`;
// };

// /**
//  * @private
//  * @description
//  * 行データの先頭列を SeqNo とみなし表示する。
//  *
//  * @param {Array<any>} row
//  * @returns {string}
//  */
// SlackNotifyService.buildSeqInfo_ = function (row) {
//   if (!row || row.length === 0) return '';
//   const seq = row[0];
//   const text = SlackNotifyService.normalizeDisplayValue_(seq);
//   return text ? `SeqNo=${text}` : '';
// };

// /**
//  * @private
//  * @description
//  * 内訳の最大採用件数（diff件数ベース）を取得する。
//  *
//  * @returns {number}
//  */
// SlackNotifyService.getMaxItems_ = function () {
//   if (typeof SLACK_DETAIL_MAX_ITEMS === 'number' && SLACK_DETAIL_MAX_ITEMS > 0) return SLACK_DETAIL_MAX_ITEMS;
//   return 30;
// };

// /**
//  * @private
//  * @description
//  * Slack投稿の最大行数（既定値）を取得する。
//  *
//  * @returns {number}
//  */
// SlackNotifyService.getMaxLines_ = function () {
//   if (typeof SLACK_NOTIFY_MAX_LINES === 'number' && SLACK_NOTIFY_MAX_LINES > 0) return SLACK_NOTIFY_MAX_LINES;
//   return 250;
// };

// /**
//  * @private
//  * @description
//  * Slack投稿の最大文字数（既定値）を取得する。
//  *
//  * @returns {number}
//  */
// SlackNotifyService.getMaxChars_ = function () {
//   if (typeof SLACK_NOTIFY_MAX_CHARS === 'number' && SLACK_NOTIFY_MAX_CHARS > 0) return SLACK_NOTIFY_MAX_CHARS;
//   return 35000;
// };

// /**
//  * @private
//  * @description
//  * インライン文字列を指定文字数で切る（代表情報用）
//  *
//  * @param {string} s
//  * @param {number} limit
//  * @returns {string}
//  */
// SlackNotifyService.limitInlineText_ = function (s, limit) {
//   const text = String(s || '');
//   const n = (typeof limit === 'number' && limit > 0) ? limit : 160;
//   if (text.length <= n) return text;
//   return text.slice(0, Math.max(0, n - 1)) + '…';
// };

// /**
//  * @private
//  * @description
//  * 「文字数制限で切る」際に、コードブロック（```）が必ず閉じた状態になるよう整形する。
//  *
//  * - maxChars を超えそうなら末尾を削る
//  * - ただし ``` の数が奇数になると表示が壊れるので、必ず偶数にする
//  * - 最後に（省略）行を入れる
//  *
//  * @param {string} text
//  * @param {number} maxChars
//  * @returns {string}
//  */
// SlackNotifyService.trimMessageKeepCodeFence_ = function (text, maxChars) {
//   const fn = 'SlackNotifyService.trimMessageKeepCodeFence_';
//   LoggerUtil.start(fn, { len: text ? text.length : 0, maxChars });

//   try {
//     const limit = (typeof maxChars === 'number' && maxChars > 0) ? maxChars : 35000;
//     if (!text || text.length <= limit) return text;

//     // まず保守的に削る（省略行の分を確保）
//     const head = text.slice(0, Math.max(0, limit - 80));
//     let t = head + '\n...（省略：文字数制限）';

//     // ``` の数が奇数なら 1つ追加して閉じる
//     const fenceCount = (t.match(/```/g) || []).length;
//     if (fenceCount % 2 === 1) {
//       t += '\n```';
//     }

//     // それでも超えていたら、最後の方を更に削って整形し直す
//     if (t.length > limit) {
//       t = t.slice(0, Math.max(0, limit - 10));
//       const fenceCount2 = (t.match(/```/g) || []).length;
//       if (fenceCount2 % 2 === 1) t += '\n```';
//     }

//     return t;

//   } catch (e) {
//     LoggerUtil.error(e);
//     // 失敗しても “閉じる” を優先した簡易fallback
//     const fallback = (String(text || '').slice(0, Math.max(0, maxChars - 10))) + '\n```';
//     return fallback;
//   } finally {
//     LoggerUtil.end(fn);
//   }
// };