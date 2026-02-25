/**
 * ============================================================
 * SlackNotifyService.gs
 *
 * @overview
 * Slack 通知専用サービス（完全版）。
 *
 * @designPolicy
 * - diff ロジックと分離（通知＝整形・送信のみ）
 * - Sheet 出力あり（要約＋リンク）
 * - Sheet 出力なし（詳細のみ）も統一表示（コードブロック化）
 *   - 「sheet出力なし」は、要約（比較元/比較先/件数）も含めて “全文コードブロック” に入れる
 *     ⇒ Slack側の「テキストだけがコード外に出る」問題を防ぐ
 * - 統合（要約＋リンク＋詳細）を提供（要約=リンクあり / 内訳=コードブロック）
 * - 表示ノイズ（改行/末尾空白/タイムスタンプ混入など）を正規化
 * - 浮動小数誤差を表示上で吸収
 * - Script Properties の Webhook URL を使用（直書き禁止）
 * - try-catch / logging を徹底
 * - 分割投稿はしない（先頭N件のみ出力）
 *
 * @dependsOn
 * - Config.gs
 *   - EXEC_ENV / SLACK_PROP_WEBHOOK_URL_* / DIFF_TYPES / SNAPSHOT_DATA_START_ROW
 *   - SLACK_DETAIL_MAX_ITEMS / SLACK_NOTIFY_MAX_LINES / SLACK_NOTIFY_MAX_CHARS
 *   - DIFF_GIT_REP_COLUMNS（代表情報に使う列）
 * - LoggerUtil.gs
 * ============================================================
 */

/**
 * @namespace SlackNotifyService
 */
const SlackNotifyService = {};

/* ============================================================
 * Globals（表示文字列・内部定数）
 * ============================================================
 */

/** @type {string} */
const SLACK_TITLE_SUMMARY = "■■ 収支見込表 diff ■■";

/** @type {string} */
const SLACK_SECTION_DETAIL = "〜〜内訳〜〜";

/** @type {string} */
const SLACK_CODE_FENCE = "```";

/** @type {string} */
const SLACK_ARROW = "→";

/** @type {string} */
const SLACK_EMPTY_MARK = "{空白}";

/* ============================================================
 * Public: Sheet 出力あり（要約＋リンク）
 * ============================================================
 */

/**
 * @description
 * diff シート URL を含む要約通知を Slack に送信する（sheet出力ありルート）。
 *
 * @param {Object} meta 通知メタ情報
 * @param {string} meta.prev 比較元シート名
 * @param {string} meta.curr 比較先シート名
 * @param {{add:number,del:number,mod:number}} meta.summary diff 件数要約
 * @param {string=} meta.diffSheetUrl 後方互換（単一URL）
 * @param {Array<{label:string,sheetName:string,url:string}>=} meta.diffSheets 2リンク用（推奨）
 * @param {{prev?:{name:string,url:string},curr?:{name:string,url:string}}=} meta.sheetLinks 比較元/比較先をリンク化したい場合（任意）
 * @param {string=} meta.channel 任意チャンネル（Webhook が許可する場合のみ）
 */
SlackNotifyService.notifyDiffResult = (meta) => {
	const fn = "SlackNotifyService.notifyDiffResult";
	LoggerUtil.start(fn, {
		prev: meta?.prev,
		curr: meta?.curr,
		summary: meta?.summary,
		channel: meta?.channel,
		hasDiffSheets: !!meta?.diffSheets?.length,
		hasSheetLinks: !!meta?.sheetLinks,
	});

	try {
		SlackNotifyService.validateMetaForSummary_(meta);

		const webhookUrl = SlackNotifyService.getWebhookUrl_();
		const payload = SlackNotifyService.buildSummaryPayload_(meta);

		LoggerUtil.info("Slack 要約通知（sheetあり）送信開始");
		SlackNotifyService.post_(webhookUrl, payload);
		LoggerUtil.info("Slack 要約通知（sheetあり）送信完了");
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/* ============================================================
 * Public: Sheet 出力なし（詳細）※統一表示（全文コードブロック・単一投稿）
 * ============================================================
 */

/**
 * @description
 * diff を計算した結果を、Sheet 出力せず Slack に詳細通知する（Slack専用ルート）。
 *
 * 仕様：
 * - 要約（比較元/比較先/件数）も含めて “全文コードブロック” に入れる
 *   ⇒ Slack側で「比較元/比較先がコードブロック外に出る」問題を防ぐ
 * - 総数が上限超なら Warning + 先頭N件のみ
 * - 分割投稿はしない
 *
 * @param {Object} meta 通知メタ情報
 * @param {string} meta.prev 比較元シート名
 * @param {string} meta.curr 比較先シート名
 * @param {Array<Object>} meta.diffs DiffCore.buildDiff / buildDiffGitLike の結果
 * @param {Array<string>} meta.headers ヘッダー配列（列名）
 * @param {{add:number,del:number,mod:number}} meta.summary diff 件数要約
 * @param {{prev?:{name:string,url:string},curr?:{name:string,url:string}}=} meta.sheetLinks 比較元/比較先をリンク化したい場合（任意）
 * @param {string=} meta.channel 任意チャンネル（Webhook が許可する場合のみ）
 * @param {number=} meta.maxLines Slack 投稿の最大行数（省略時は既定）
 * @param {number=} meta.maxChars Slack 投稿の最大文字数（省略時は既定）
 */
SlackNotifyService.notifyDiffResultDetailOnly = (meta) => {
	const fn = "SlackNotifyService.notifyDiffResultDetailOnly";
	LoggerUtil.start(fn, {
		prev: meta?.prev,
		curr: meta?.curr,
		summary: meta?.summary,
		channel: meta?.channel,
	});

	try {
		SlackNotifyService.validateMetaForDetail_(meta);

		const webhookUrl = SlackNotifyService.getWebhookUrl_();
		const payloadBase = {};
		if (meta.channel) payloadBase.channel = meta.channel;

		const s = meta.summary || { add: 0, del: 0, mod: 0 };
		const total = s.mod + s.add + s.del;

		const maxLines = SlackNotifyService.getMaxLines_(meta);
		const maxChars = SlackNotifyService.getMaxChars_(meta);
		const maxItems = SlackNotifyService.getMaxItems_();

		// 1) 要約（1投稿）※ リンクなし形式
		const summaryLines = SlackNotifyService.buildSummaryLines_(meta);
		const summaryText = summaryLines.join("\n");
		LoggerUtil.info("Slack 詳細通知（sheetなし）: 要約送信開始");
		SlackNotifyService.post_(
			webhookUrl,
			Object.assign({}, payloadBase, { text: summaryText }),
		);
		LoggerUtil.info("Slack 詳細通知（sheetなし）: 要約送信完了");

		// 2) 内訳（1投稿、コードブロック化）
		// ※ 件数制限はしない。buildSingleDetailPostText_ の行数・文字数制限に任せる
		const chunks = SlackNotifyService.buildDetailBodyChunksByDiff_(meta);

		const bodyLines = [];
		chunks.forEach((c) => {
			(c.lines || []).forEach((l) => {
				bodyLines.push(l);
			});
		});

		// Warning を表示するかの判定は buildSingleDetailPostText_ の行数・文字数制限で判定させるので、
		// ここでは空にする（ただし必要に応じて実装可能）
		const warnLine = "";

		const detailText = SlackNotifyService.buildSingleDetailPostText_({
			prefixLines: [], // 要約は別投稿
			warnLine: warnLine,
			bodyLines: bodyLines,
			maxLines: maxLines,
			maxChars: maxChars,
			wrapAllInCodeBlock: false,
		});

		LoggerUtil.info("Slack 詳細通知（sheetなし）: 内訳送信開始");
		SlackNotifyService.post_(
			webhookUrl,
			Object.assign({}, payloadBase, { text: detailText }),
		);
		LoggerUtil.info("Slack 詳細通知（sheetなし）: 内訳送信完了");
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/* ============================================================
 * Public: 統合（要約＋リンク＋詳細）※要約1投＋内訳1投（分割なし）
 * ============================================================
 */

/**
 * @description
 * diff結果を「要約 + diffシートリンク + 詳細内訳」を Slack に通知する（統合通知）。
 *
 * 仕様：
 * - 要約（+リンク）は 1投稿（リンクを効かせるためコードブロックに入れない）
 * - 内訳は 1投稿（コードブロック化）
 * - 総数が上限超なら Warning + 先頭N件のみ
 *
 * @param {Object} meta
 * @param {string} meta.prev
 * @param {string} meta.curr
 * @param {{add:number,del:number,mod:number}} meta.summary
 * @param {Array<{label:string,sheetName:string,url:string}>=} meta.diffSheets
 * @param {Array<Object>} meta.diffs
 * @param {Array<string>} meta.headers
 * @param {{prev?:{name:string,url:string},curr?:{name:string,url:string}}=} meta.sheetLinks
 * @param {string=} meta.channel
 * @param {number=} meta.maxLines
 * @param {number=} meta.maxChars
 */
SlackNotifyService.notifyDiffResultSummaryWithUrlAndDetails = (meta) => {
	const fn = "SlackNotifyService.notifyDiffResultSummaryWithUrlAndDetails";
	LoggerUtil.start(fn, {
		prev: meta?.prev,
		curr: meta?.curr,
		summary: meta?.summary,
		hasUrl: !!meta?.diffSheets?.length,
		channel: meta?.channel,
	});

	try {
		SlackNotifyService.validateMetaForDetail_(meta);

		const webhookUrl = SlackNotifyService.getWebhookUrl_();
		const payloadBase = {};
		if (meta.channel) payloadBase.channel = meta.channel;

		const s = meta.summary || { add: 0, del: 0, mod: 0 };
		const total = s.mod + s.add + s.del;

		const maxLines = SlackNotifyService.getMaxLines_(meta);
		const maxChars = SlackNotifyService.getMaxChars_(meta);
		const maxItems = SlackNotifyService.getMaxItems_();

		// 1) 要約＋リンク（1投稿）
		const summaryText = SlackNotifyService.buildSummaryText_(meta);
		LoggerUtil.info("Slack 統合通知: 要約（+リンク）送信開始");
		SlackNotifyService.post_(
			webhookUrl,
			Object.assign({}, payloadBase, { text: summaryText }),
		);
		LoggerUtil.info("Slack 統合通知: 要約（+リンク）送信完了");

		// 2) 内訳（先頭N件、単一投稿）
		// ※ 件数制限はしない。buildSingleDetailPostText_ の行数・文字数制限に任せる
		const chunks = SlackNotifyService.buildDetailBodyChunksByDiff_(meta);

		const bodyLines = [];
		chunks.forEach((c) => {
			(c.lines || []).forEach((l) => {
				bodyLines.push(l);
			});
		});

		// Warning を表示するかの判定は buildSingleDetailPostText_ の行数・文字数制限で判定させるので、
		// ここでは空にする
		const warnLine = "";

		const detailText = SlackNotifyService.buildSingleDetailPostText_({
			prefixLines: [], // 統合通知は要約が別投稿
			warnLine: warnLine,
			bodyLines: bodyLines,
			maxLines: maxLines,
			maxChars: maxChars,
			wrapAllInCodeBlock: false,
		});

		LoggerUtil.info("Slack 統合通知: 内訳（単一投稿）送信開始");
		SlackNotifyService.post_(
			webhookUrl,
			Object.assign({}, payloadBase, { text: detailText }),
		);
		LoggerUtil.info("Slack 統合通知: 内訳（単一投稿）送信完了");

		LoggerUtil.info("Slack 統合通知（要約+リンク+内訳）送信完了");
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/* ============================================================
 * Private: Webhook URL / HTTP
 * ============================================================
 */

/**
 * @private
 * @description
 * 実行環境に応じた Slack Webhook URL を Script Properties から取得する。
 *
 * @returns {string} Slack Incoming Webhook URL
 */
SlackNotifyService.getWebhookUrl_ = () => {
	const fn = "SlackNotifyService.getWebhookUrl_";
	LoggerUtil.start(fn);

	try {
		const props = PropertiesService.getScriptProperties();

		const key =
			EXEC_ENV === "prod"
				? SLACK_PROP_WEBHOOK_URL_PROD
				: SLACK_PROP_WEBHOOK_URL_TEST;

		const url = props.getProperty(key);
		if (!url) {
			throw new Error(`Slack Webhook 未設定: ${key}`);
		}

		LoggerUtil.info(`Slack Webhook Key 選択: ${key}`);
		return url;
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
 * Slack へ POST する共通処理。
 *
 * @param {string} webhookUrl Slack Incoming Webhook URL
 * @param {Object} payload Slack payload（少なくとも text を含む）
 * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse}
 */
SlackNotifyService.post_ = (webhookUrl, payload) => {
	const fn = "SlackNotifyService.post_";
	LoggerUtil.start(fn, { hasUrl: !!webhookUrl });

	try {
		if (!webhookUrl) throw new Error("webhookUrl が空です");

		// payload は text (string) または blocks (array) のいずれかを含むことを許可する
		if (!payload || (typeof payload.text !== "string" && !Array.isArray(payload.blocks))) {
			throw new Error("payload.text または payload.blocks が不正です");
		}

		const textLength = payload.text
			? payload.text.length
			: payload.blocks
			? JSON.stringify(payload.blocks).length
			: 0;

		LoggerUtil.info(`Slack POST 送信: textLength=${textLength}`);

		const res = UrlFetchApp.fetch(webhookUrl, {
			method: "post",
			contentType: "application/json",
			payload: JSON.stringify(payload),
			muteHttpExceptions: true,
		});

		const code = res.getResponseCode();
		const body = res.getContentText();

		LoggerUtil.info(`Slack HTTP status=${code}`);
		if (code < 200 || code >= 300) {
			LoggerUtil.info(`Slack HTTP response body=${body}`);
			throw new Error(`Slack POST 失敗: status=${code}`);
		}

		return res;
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/* ============================================================
 * Private: Payload / Text Builders
 * ============================================================
 */

/**
 * @private
 * @description
 * 要約通知（sheetありルート）の payload を生成する。
 *
 * @param {Object} meta
 * @returns {{text:string, channel?:string}}
 */
SlackNotifyService.buildSummaryPayload_ = (meta) => {
	const fn = "SlackNotifyService.buildSummaryPayload_";
	LoggerUtil.start(fn);

	try {
		const text = SlackNotifyService.buildSummaryText_(meta);
		const payload = { text: text };
		if (meta.channel) payload.channel = meta.channel;
		return payload;
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
 * Slack mrkdwn のリンク形式: <URL|表示テキスト>
 *
 * @param {string} url
 * @param {string} text
 * @returns {string}
 */
SlackNotifyService.buildSlackLink_ = (url, text) => {
	const fn = "SlackNotifyService.buildSlackLink_";
	LoggerUtil.start(fn);

	try {
		const u = String(url || "").trim();
		const t = String(text || "").trim();
		if (!u || !t) return "";
		return `<${u}|${t}>`;
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
 * 比較元/比較先を「リンク or プレーン文字列」で返す。
 *
 * @param {string} name
 * @param {{name:string,url:string}=} linkObj
 * @returns {string}
 */
SlackNotifyService.buildSheetNameWithOptionalLink_ = (name, linkObj) => {
	const fn = "SlackNotifyService.buildSheetNameWithOptionalLink_";
	LoggerUtil.start(fn, { name: name, hasLink: !!linkObj?.url });

	try {
		const n = SlackNotifyService.normalizeDisplayValue_(name);
		if (!linkObj || !linkObj.url) return n;

		const url = String(linkObj.url || "").trim();
		if (!url) return n;

		const link = SlackNotifyService.buildSlackLink_(url, n);
		return link || n;
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
 * 要約行（配列）を生成する。
 *
 * @param {Object} meta
 * @returns {string[]}
 */
SlackNotifyService.buildSummaryLines_ = (meta) => {
	const fn = "SlackNotifyService.buildSummaryLines_";
	LoggerUtil.start(fn);

	try {
		const s = meta.summary || { add: 0, del: 0, mod: 0 };
		const total = s.mod + s.add + s.del;

		const prev = SlackNotifyService.buildSheetNameWithOptionalLink_(
			meta.prev,
			meta.sheetLinks?.prev ? meta.sheetLinks.prev : undefined,
		);
		const curr = SlackNotifyService.buildSheetNameWithOptionalLink_(
			meta.curr,
			meta.sheetLinks?.curr ? meta.sheetLinks.curr : undefined,
		);

		const lines = [];
		lines.push(SLACK_TITLE_SUMMARY);
		lines.push(`比較元: ${prev} | 比較先: ${curr}`);
		lines.push(
			`【結果】総数：${total}（ MODIFY=${s.mod} | ADD=${s.add} | DELETE=${s.del} ）`,
		);
		return lines;
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
 * 要約テキストを生成する（統合通知でも利用）。
 *
 * @param {Object} meta
 * @returns {string}
 */
SlackNotifyService.buildSummaryText_ = (meta) => {
	const fn = "SlackNotifyService.buildSummaryText_";
	LoggerUtil.start(fn);

	try {
		const lines = SlackNotifyService.buildSummaryLines_(meta);

		// 推奨: diffSheets（複数リンク）
		if (
			meta.diffSheets &&
			Array.isArray(meta.diffSheets) &&
			meta.diffSheets.length > 0
		) {
			lines.push("");
			lines.push("▼ diff シート");

			meta.diffSheets.forEach((ds) => {
				if (!ds) return;

				const label = SlackNotifyService.normalizeDisplayValue_(ds.label);
				const sheetName = SlackNotifyService.normalizeDisplayValue_(
					ds.sheetName,
				);
				const url = String(ds.url || "").trim();

				if (!label || !sheetName || !url) return;

				const link = SlackNotifyService.buildSlackLink_(url, sheetName);
				if (!link) return;

				lines.push(`・${label}  : ${link}`);
			});

			return lines.join("\n");
		}

		// 後方互換: 単一URL
		if (meta.diffSheetUrl) {
			lines.push("");
			lines.push("▼ diff シート");
			lines.push(String(meta.diffSheetUrl));
		}

		return lines.join("\n");
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/* ============================================================
 * Private: Detail Builders（diff単位）
 * ============================================================
 */

/**
 * @private
 * @description
 * diff（1件）単位で Slack 内訳行を作る（件数制御のため）。
 *
 * - 1 diff => 先頭行（[ADD]/[DELETE]/[MODIFY]）＋必要なら列差分行
 * - 先頭行には rowLabel / SeqNo（先頭列）/ 代表情報（任意）を含める
 *
 * @param {Object} meta
 * @returns {Array<{lines:string[]}>}
 */
SlackNotifyService.buildDetailBodyChunksByDiff_ = (meta) => {
	const fn = "SlackNotifyService.buildDetailBodyChunksByDiff_";
	LoggerUtil.start(fn, { diffs: meta?.diffs ? meta.diffs.length : 0 });

	try {
		const out = [];

		(meta.diffs || []).forEach((d) => {
			if (!d || !d.type) return;

			const lines = [];
			const rowLabel = SlackNotifyService.buildRowLabel_(d);

			if (d.type === DIFF_TYPES.ADD) {
				const rep = SlackNotifyService.buildRepInfo_(d.currRow, meta.headers);
				lines.push(
					SlackNotifyService.sanitizeSlackLine_(
						`- [ADD] ${rowLabel} . ${SlackNotifyService.buildSeqInfo_(d.currRow)} . ${rep}`,
					),
				);
				out.push({ lines: lines });
				return;
			}

			if (d.type === DIFF_TYPES.DELETE) {
				const rep = SlackNotifyService.buildRepInfo_(d.prevRow, meta.headers);
				lines.push(
					SlackNotifyService.sanitizeSlackLine_(
						`- [DELETE] ${rowLabel} . ${SlackNotifyService.buildSeqInfo_(d.prevRow)} . ${rep}`,
					),
				);
				out.push({ lines: lines });
				return;
			}

			if (d.type === DIFF_TYPES.MODIFY) {
				const rep = SlackNotifyService.buildRepInfo_(d.currRow, meta.headers);
				lines.push(
					SlackNotifyService.sanitizeSlackLine_(
						`- [MODIFY] ${rowLabel} . ${SlackNotifyService.buildSeqInfo_(d.currRow)} . ${rep}`,
					),
				);

				const diffCols = d.diffCols || [];
				diffCols.forEach((colIdx) => {
					const rawColName =
						meta.headers && typeof meta.headers[colIdx] !== "undefined"
							? meta.headers[colIdx]
							: `COL_${colIdx + 1}`;

					const colName = SlackNotifyService.normalizeDisplayValue_(rawColName);

					const beforeRaw = d.prevRow ? d.prevRow[colIdx] : "";
					const afterRaw = d.currRow ? d.currRow[colIdx] : "";

					const before =
						SlackNotifyService.normalizeDisplayValueOrEmptyMark_(beforeRaw);
					const after =
						SlackNotifyService.normalizeDisplayValueOrEmptyMark_(afterRaw);

					lines.push(
						SlackNotifyService.sanitizeSlackLine_(
							`　- ${colName}： ${before} ${SLACK_ARROW} ${after}`,
						),
					);
				});

				out.push({ lines: lines });
				return;
			}

			lines.push(
				SlackNotifyService.sanitizeSlackLine_(
					`[UNKNOWN] ${rowLabel} type=${SlackNotifyService.normalizeDisplayValue_(d.type)}`,
				),
			);
			out.push({ lines: lines });
		});

		LoggerUtil.info(`diff単位チャンク生成: chunks=${out.length}`);
		return out;
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/* ============================================================
 * Private: Single Post Builder（分割しない）
 * ============================================================
 */

/**
 * @private
 * @description
 * 内訳を「1投稿ぶん」に整形する（分割しない）。
 *
 * - wrapAllInCodeBlock=true の場合：
 *   prefixLines / warnLine / 見出し / 内訳 をすべて 1つのコードブロックに入れる
 *   ⇒ 比較元/比較先も必ずコードブロック化される（今回の是正ポイント）
 *
 * - maxLines は「1投稿全体」の行数上限（超える場合は末尾省略）
 * - maxChars で文字数も安全に切る
 *
 * @param {Object} opt
 * @param {string[]=} opt.prefixLines 先頭に付ける行（要約など）
 * @param {string=} opt.warnLine Warning行（任意）
 * @param {string[]} opt.bodyLines コードブロック内に入れる行
 * @param {number} opt.maxLines
 * @param {number} opt.maxChars
 * @param {boolean=} opt.wrapAllInCodeBlock 全文を1つのコードブロックに入れる
 * @returns {string}
 */
SlackNotifyService.buildSingleDetailPostText_ = (opt) => {
	const fn = "SlackNotifyService.buildSingleDetailPostText_";
	LoggerUtil.start(fn, {
		prefix: opt?.prefixLines ? opt.prefixLines.length : 0,
		body: opt?.bodyLines ? opt.bodyLines.length : 0,
		maxLines: opt?.maxLines,
		maxChars: opt?.maxChars,
		hasWarn: !!opt?.warnLine,
		wrapAll: !!opt?.wrapAllInCodeBlock,
	});

	try {
		const prefixLines =
			opt && Array.isArray(opt.prefixLines) ? opt.prefixLines : [];
		const warnLine = opt?.warnLine ? String(opt.warnLine) : "";
		const bodyLines = opt && Array.isArray(opt.bodyLines) ? opt.bodyLines : [];
		const maxLines =
			opt && typeof opt.maxLines === "number" && opt.maxLines > 0
				? opt.maxLines
				: 250;
		const maxChars =
			opt && typeof opt.maxChars === "number" && opt.maxChars > 0
				? opt.maxChars
				: 35000;
		const wrapAll = !!opt?.wrapAllInCodeBlock;

		/** @type {string[]} */
		const lines = [];

		if (wrapAll) {
			// 全文コードブロック（比較元/比較先も含めて全部）
			lines.push(SLACK_CODE_FENCE);

			prefixLines.forEach((l) => {
				lines.push(SlackNotifyService.sanitizeSlackLine_(String(l)));
			});
			if (prefixLines.length > 0) lines.push("");

			if (warnLine) {
				lines.push(SlackNotifyService.sanitizeSlackLine_(warnLine));
				lines.push("");
			}

			lines.push(SLACK_SECTION_DETAIL);

			if (bodyLines.length === 0) {
				lines.push("（差分内訳なし）");
			} else {
				bodyLines.forEach((l) => {
					lines.push(SlackNotifyService.sanitizeSlackLine_(l));
				});
			}

			lines.push(SLACK_CODE_FENCE);
		} else {
			// prefix/warn はコードブロック外、内訳だけコードブロック（従来）
			if (prefixLines.length > 0) {
				prefixLines.forEach((l) => {
					lines.push(String(l));
				});
				lines.push("");
			}

			if (warnLine) {
				lines.push(warnLine);
				lines.push("");
			}

			lines.push(SLACK_SECTION_DETAIL);
			lines.push(SLACK_CODE_FENCE);

			if (bodyLines.length === 0) {
				lines.push("（差分内訳なし）");
			} else {
				bodyLines.forEach((l) => {
					lines.push(SlackNotifyService.sanitizeSlackLine_(l));
				});
			}

			lines.push(SLACK_CODE_FENCE);
		}

		// 行数制限（全体）
		let outLines = lines;
		if (outLines.length > maxLines) {
			const head = outLines.slice(0, Math.max(0, maxLines - 2));
			head.push("...");
			head.push("（省略：行数制限）");
			outLines = head;
		}

		// 文字数制限（全体）
		let text = outLines.join("\n");
		if (text.length > maxChars) {
			const cut = text.slice(0, Math.max(0, maxChars - 60));
			text = `${cut}\n...（省略：文字数制限）`;
		}

		return text;
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/* ============================================================
 * Private: Validators
 * ============================================================
 */

/**
 * @private
 * @description
 * 要約通知用 meta の最低限バリデーション。
 *
 * @param {Object} meta
 */
SlackNotifyService.validateMetaForSummary_ = (meta) => {
	const fn = "SlackNotifyService.validateMetaForSummary_";
	LoggerUtil.start(fn);

	try {
		if (!meta) throw new Error("meta が未指定です");
		if (!meta.prev) throw new Error("meta.prev が未指定です");
		if (!meta.curr) throw new Error("meta.curr が未指定です");
		if (!meta.summary) throw new Error("meta.summary が未指定です");
	} finally {
		LoggerUtil.end(fn);
	}
};

/**
 * @private
 * @description
 * 詳細通知用 meta の最低限バリデーション。
 *
 * @param {Object} meta
 */
SlackNotifyService.validateMetaForDetail_ = (meta) => {
	const fn = "SlackNotifyService.validateMetaForDetail_";
	LoggerUtil.start(fn);

	try {
		if (!meta) throw new Error("meta が未指定です");
		if (!meta.prev) throw new Error("meta.prev が未指定です");
		if (!meta.curr) throw new Error("meta.curr が未指定です");
		if (!Array.isArray(meta.diffs))
			throw new Error("meta.diffs が配列ではありません");
		if (!Array.isArray(meta.headers))
			throw new Error("meta.headers が配列ではありません");
		if (!meta.summary) throw new Error("meta.summary が未指定です");
	} finally {
		LoggerUtil.end(fn);
	}
};

/* ============================================================
 * Private: Formatting / Normalization
 * ============================================================
 */

/**
 * @private
 * @description
 * 表示用正規化。
 * - 改行コードをスペースへ置換（\r\n, \n, \r）
 * - 前後空白を trim
 * - Date は yyyy-MM-dd
 * - number は Slack 表示向けに丸め（浮動小数誤差を吸収）
 *
 * @param {any} value
 * @returns {string}
 */
SlackNotifyService.normalizeDisplayValue_ = (value) => {
	if (value === null || typeof value === "undefined") return "";

	if (value instanceof Date) {
		return Utilities.formatDate(
			value,
			Session.getScriptTimeZone(),
			"yyyy-MM-dd",
		);
	}

	if (typeof value === "number") {
		return SlackNotifyService.formatNumberForSlack_(value);
	}

	return String(value)
		.replace(/\r\n/g, " ")
		.replace(/\n/g, " ")
		.replace(/\r/g, " ")
		.trim();
};

/**
 * @private
 * @description
 * 値が空の場合に {空白} を返す。
 *
 * @param {any} value
 * @returns {string}
 */
SlackNotifyService.normalizeDisplayValueOrEmptyMark_ = (value) => {
	const normalized = SlackNotifyService.normalizeDisplayValue_(value);
	return normalized ? normalized : SLACK_EMPTY_MARK;
};

/**
 * @private
 * @description
 * Slack表示用に数値を整形する。
 *
 * - 浮動小数誤差（例: 110000.00000000001）を吸収
 * - 小数部が実質0なら整数化
 * - 小数がある場合は最大2桁まで
 * - カンマ区切り
 *
 * @param {number} n
 * @returns {string}
 */
SlackNotifyService.formatNumberForSlack_ = (n) => {
	if (!Number.isFinite(n)) return String(n);

	// 誤差吸収（強めの丸め）
	const rounded = Math.round(n * 1e9) / 1e9;

	const asInt = Math.round(rounded);
	if (Math.abs(rounded - asInt) < 1e-9) {
		return asInt.toLocaleString("ja-JP");
	}

	const fixed2 = Math.round(rounded * 100) / 100;

	let s = fixed2.toString();
	if (s.indexOf(".") >= 0) {
		s = s.replace(/0+$/, "").replace(/\.$/, "");
	}

	const parts = s.split(".");
	parts[0] = Number(parts[0]).toLocaleString("ja-JP");
	return parts.join(".");
};

/**
 * @private
 * @description
 * Slack の表示を壊しやすい文字列を正規化する。
 *
 * - 先頭インデントは維持（trimしない）
 * - 末尾空白だけ除去
 * - 改行はスペース化
 * - Slackのタイムスタンプ混入（例: [20:38]）は除去（途中に出るので /g）
 *
 * @param {string} line
 * @returns {string}
 */
SlackNotifyService.sanitizeSlackLine_ = (line) => {
	const fn = "SlackNotifyService.sanitizeSlackLine_";
	LoggerUtil.start(fn);

	try {
		const s = line === null || typeof line === "undefined" ? "" : String(line);

		const noBreak = s
			.replace(/\r\n/g, " ")
			.replace(/\n/g, " ")
			.replace(/\r/g, " ");

		const noTs = noBreak.replace(
			/$begin:math:display$\\d\{1,2\}:\\d\{2\}$end:math:display$/g,
			"",
		);

		return noTs.replace(/[ \t\u3000]+$/g, "");
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/* ============================================================
 * Private: Row Labels / Representative Info
 * ============================================================
 */

/**
 * @private
 * @description
 * Diff 情報から行ラベル（Row=...）を生成する。
 *
 * @param {Object} diff
 * @returns {string}
 */
SlackNotifyService.buildRowLabel_ = (diff) => {
	const idx = typeof diff.rowIndex === "number" ? diff.rowIndex : null;
	if (idx === null) return "";
	return `Row=${idx + SNAPSHOT_DATA_START_ROW}`;
};

/**
 * @private
 * @description
 * 行データの先頭列を SeqNo とみなし表示する（正規化あり）。
 *
 * @param {Array<any>} row
 * @returns {string}
 */
SlackNotifyService.buildSeqInfo_ = (row) => {
	if (!row || row.length === 0) return "";
	const seq = row[0];
	const text = SlackNotifyService.normalizeDisplayValue_(seq);
	return text ? `SeqNo=${text}` : "";
};

/**
 * @private
 * @description
 * 代表情報を組み立てる（任意）。
 *
 * - Config.gs の DIFF_GIT_REP_COLUMNS に列名が定義されている場合に使う
 * - 見つからない列名は無視する
 *
 * @param {Array<any>} row
 * @param {Array<string>} headers
 * @returns {string} 例: "計上月=2026-02-01 | クライアント=AAA | 案件名=BBB | 金額=200,000"
 */
SlackNotifyService.buildRepInfo_ = (row, headers) => {
	const fn = "SlackNotifyService.buildRepInfo_";
	LoggerUtil.start(fn);

	try {
		if (!row || !Array.isArray(row)) return "";
		if (!headers || !Array.isArray(headers)) return "";

		if (
			typeof DIFF_GIT_REP_COLUMNS === "undefined" ||
			!Array.isArray(DIFF_GIT_REP_COLUMNS)
		) {
			return "";
		}

		const parts = [];

		DIFF_GIT_REP_COLUMNS.forEach((colNameRaw) => {
			const colName = String(colNameRaw || "").trim();
			if (!colName) return;

			const idx = headers.findIndex((h) => String(h) === colName);
			if (idx < 0) return;

			const v = SlackNotifyService.normalizeDisplayValueOrEmptyMark_(row[idx]);
			parts.push(`${colName}=${v}`);
		});

		if (parts.length === 0) return "";
		return parts.join(" | ");
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
};

/* ============================================================
 * Private: Limits / Helpers
 * ============================================================
 */

/**
 * @private
 * @description
 * Slack 投稿の最大行数（既定値）を取得する。
 *
 * @param {Object} meta
 * @returns {number}
 */
SlackNotifyService.getMaxLines_ = (meta) => {
	const v = meta?.maxLines;
	if (typeof v === "number" && v > 0) return v;
	if (typeof SLACK_NOTIFY_MAX_LINES === "number" && SLACK_NOTIFY_MAX_LINES > 0)
		return SLACK_NOTIFY_MAX_LINES;
	return 250;
};

/**
 * @private
 * @description
 * Slack 投稿の最大文字数（既定値）を取得する。
 *
 * @param {Object} meta
 * @returns {number}
 */
SlackNotifyService.getMaxChars_ = (meta) => {
	const v = meta?.maxChars;
	if (typeof v === "number" && v > 0) return v;
	if (typeof SLACK_NOTIFY_MAX_CHARS === "number" && SLACK_NOTIFY_MAX_CHARS > 0)
		return SLACK_NOTIFY_MAX_CHARS;
	return 35000;
};

/**
 * @private
 * @description
 * 内訳の最大採用件数を取得する（diff件数ベース）。
 *
 * @returns {number}
 */
SlackNotifyService.getMaxItems_ = () => {
	if (typeof SLACK_DETAIL_MAX_ITEMS === "number" && SLACK_DETAIL_MAX_ITEMS > 0)
		return SLACK_DETAIL_MAX_ITEMS;
	return 30;
};
