/**
 * ============================================================
 * LoggerUtil.gs
 *
 * @overview
 * logging 共通ユーティリティ。
 * ログだけで処理フローと異常原因を追えることを目的とする。
 *
 * @policy
 * - ログ形式を統一
 * - start / info / error / end を必ず用意
 * ============================================================
 */

/**
 * @namespace LoggerUtil
 */
const LoggerUtil = {};

/**
 * @description
 * 関数開始ログを出力する。
 *
 * @param {string} fn 関数名
 * @param {Object=} params 任意パラメータ
 */
LoggerUtil.start = function (fn, params) {
  Logger.log(
    `[START] ${fn}` +
    (params ? ` ${JSON.stringify(params)}` : '')
  );
};

/**
 * @description
 * 情報ログを出力する。
 *
 * @param {string} msg メッセージ
 */
LoggerUtil.info = function (msg) {
  Logger.log(`[INFO] ${msg}`);
};

/**
 * @description
 * エラーログを出力する。
 *
 * @param {Error|string} e エラー
 */
LoggerUtil.error = function (e) {
  if (e && e.stack) {
    Logger.log(`[ERROR] ${e.stack}`);
  } else {
    Logger.log(`[ERROR] ${e}`);
  }
};

/**
 * @description
 * 関数終了ログを出力する。
 *
 * @param {string} fn 関数名
 */
LoggerUtil.end = function (fn) {
  Logger.log(`[END] ${fn}`);
};
