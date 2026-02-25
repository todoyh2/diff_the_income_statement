// /**
//  * ============================================================
//  * Config.gs
//  *
//  * @overview
//  * アプリ全体で使用する定数・設定値を集約する。
//  * ロジックは禁止。定義のみを記載する。
//  *
//  * @policy
//  * - 処理を書かない
//  * - 依存関係を持たせない
//  * - ここを見れば全体仕様が把握できる状態にする
//  * ============================================================
//  */

// /** 実行環境 ⇒ 本番：prod | テスト：test */
// const EXEC_ENV = 'test';

// /** デバッグログ（詳細）を出すか ⇒ NO（本番運用時）：false | YES（テスト運用時）：true*/
// const DEBUG_VERBOSE = false;

// /* ============================================================
//  * 原本シート設定
//  * ============================================================
//  */

// /** 原本シート名 */
// const SOURCE_SHEET_NAME = '収支見込表第15期';

// /** 原本ヘッダー行 */
// const SOURCE_HEADER_ROW = 4;

// /** 原本データ開始行 */
// const SOURCE_DATA_START_ROW = 5;

// /* ============================================================
//  * Snapshot 設定
//  * ============================================================
//  */

// /** Snapshot メタ情報行数 */
// const SNAPSHOT_META_ROWS = 1;

// /** Snapshot ヘッダー行 */
// const SNAPSHOT_HEADER_ROW = SOURCE_HEADER_ROW + SNAPSHOT_META_ROWS;

// /** Snapshot データ開始行 */
// const SNAPSHOT_DATA_START_ROW = SOURCE_DATA_START_ROW + SNAPSHOT_META_ROWS;

// /** Snapshot メタ行 背景色 */
// const META_BG_COLOR = '#eeeeee';

// /* ============================================================
//  * diff 設定
//  * ============================================================
//  */

// /** diff 種別 */
// const DIFF_TYPES = {
//   ADD   : 'ADD'   ,
//   DELETE: 'DELETE',
//   MODIFY: 'MODIFY'
// };

// /** diff 出力モード */
// const DIFF_OUTPUT_MODE = {
//   VISUAL: { visual: true, detail: false },
//   DETAIL: { visual: false, detail: true },
//   BOTH:   { visual: true, detail: true }
// };

// /** diff 背景色 */
// const DIFF_COLORS = {
//   ADD   : '#e6f4ea',
//   DELETE: '#fce8e6',
//   MODIFY: '#fff4cc'
// };

// /* ============================================================
//  * diff 表示正規化設定
//  * ============================================================
//  */

// /**
//  * diff 判定時に無視する列（列名ベース）
//  * ※ 主キー扱いはしないが、diff ノイズを避けるため除外
//  */
// const DIFF_IGNORE_COLUMNS = [
//   'SeqNo.'
// ];

// /**
//  * 年月表示とする列（Date → yyyy年M月）
//  */
// const DIFF_YEAR_MONTH_COLUMNS = [
//   '計上月'
// ];

// /**
//  * 月日表示とする列（Date → M/d）
//  */
// const DIFF_MONTH_DAY_COLUMNS = [
//   '入金予定日'
// ];

// /**
//  * パーセント（整数）表示列（##0%）
//  */
// const DIFF_PERCENT_0_COLUMNS = [
//   '予定利益率'
// ];

// /**
//  * パーセント（小数1桁）表示列（##0.0%）
//  */
// const DIFF_PERCENT_1_COLUMNS = [
//   '利益率'
// ];

// /* ============================================================
//  * Slack 通知設定
//  * ============================================================
//  */

// /**
//  * Slack Webhook Script Property Keys
//  * 値はコード上に書かない
//  */
// const SLACK_PROP_WEBHOOK_URL_PROD = 'SLACK_PROP_WEBHOOK_URL_PROD';  // #todo_direction
// const SLACK_PROP_WEBHOOK_URL_TEST = 'SLACK_PROP_WEBHOOK_URL_TEST';  // #times_haga

// /** Slack 内訳の最大採用件数（diff件数ベース） */
// const SLACK_DETAIL_MAX_ITEMS = 30;

// /** Slack投稿の最大行数（安全値） */
// const SLACK_NOTIFY_MAX_LINES = 250;

// /** Slack投稿の最大文字数（安全値。Slackの上限に寄せすぎない） */
// const SLACK_NOTIFY_MAX_CHARS = 35000;
