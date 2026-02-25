/**
 * ============================================================
 * Config.gs
 *
 * @overview
 * アプリ全体で使用する定数・設定値を集約する。
 * ロジックは禁止。定義のみを記載する。
 *
 * @policy
 * - 処理を書かない
 * - 依存関係を持たせない
 * - ここを見れば全体仕様が把握できる状態にする
 * ============================================================
 */

/** 実行環境 ⇒ 本番：prod | テスト：test */
const EXEC_ENV = 'test';

/** デバッグログ（詳細）を出すか ⇒ NO（本番運用時）：false | YES（テスト運用時）：true*/
const DEBUG_VERBOSE = false;

/* ============================================================
 * 原本シート設定
 * ============================================================
 */

/** 原本シート名 */
const SOURCE_SHEET_NAME = '収支見込表第15期';

/** 原本ヘッダー行 */
const SOURCE_HEADER_ROW = 4;

/** 原本データ開始行 */
const SOURCE_DATA_START_ROW = 5;

/* ============================================================
 * Snapshot 設定
 * ============================================================
 */

/** Snapshot メタ情報行数 */
const SNAPSHOT_META_ROWS = 1;

/** Snapshot ヘッダー行 */
const SNAPSHOT_HEADER_ROW = SOURCE_HEADER_ROW + SNAPSHOT_META_ROWS;

/** Snapshot データ開始行 */
const SNAPSHOT_DATA_START_ROW = SOURCE_DATA_START_ROW + SNAPSHOT_META_ROWS;

/** Snapshot メタ行 背景色 */
const META_BG_COLOR = '#eeeeee';

/* ============================================================
 * Snapshot Archive 設定
 * ============================================================
 */

/** 古い Snapshot をアーカイブする保持日数（日） */
const SNAPSHOT_ARCHIVE_RETENTION_DAYS = 40;

/** アーカイブ保存先フォルダ名（Google Drive） */
const SNAPSHOT_ARCHIVE_FOLDER_NAME = 'snapshot_archive';

/** アーカイブ後に元シートを削除するか（運用安定化までは false に） */
const SNAPSHOT_ARCHIVE_DELETE_ENABLED = false;

/* ============================================================
 * diff 設定
 * ============================================================
 */

/** diff 種別 */
const DIFF_TYPES = {
  ADD   : 'ADD'   ,
  DELETE: 'DELETE',
  MODIFY: 'MODIFY'
};

/** diff 出力モード */
const DIFF_OUTPUT_MODE = {
  VISUAL: { visual: true, detail: false },
  DETAIL: { visual: false, detail: true },
  BOTH:   { visual: true, detail: true }
};

/** diff 背景色 */
const DIFF_COLORS = {
  ADD   : '#e6f4ea',
  DELETE: '#fce8e6',
  MODIFY: '#fff4cc'
};

/* ============================================================
 * diff 表示正規化設定
 * ============================================================
 */

/**
 * diff 判定時に無視する列（列名ベース）
 * ※ 主キー扱いはしないが、diff ノイズを避けるため除外
 */
const DIFF_IGNORE_COLUMNS = [
  'SecNO'
];

/**
 * 年月表示とする列（Date → yyyy年M月）
 */
const DIFF_YEAR_MONTH_COLUMNS = [
  '計上月'
];

/**
 * 月日表示とする列（Date → M/d）
 */
const DIFF_MONTH_DAY_COLUMNS = [
  '入金予定日'
];

/**
 * パーセント（整数）表示列（##0%）
 */
const DIFF_PERCENT_0_COLUMNS = [
  '予定利益率'
];

/**
 * パーセント（小数1桁）表示列（##0.0%）
 */
const DIFF_PERCENT_1_COLUMNS = [
  '利益率'
];

/* ============================================================
 * Slack 通知設定
 * ============================================================
 */

/**
 * Slack Webhook Script Property Keys
 * 値はコード上に書かない
 */
const SLACK_PROP_WEBHOOK_URL_PROD = 'SLACK_PROP_WEBHOOK_URL_PROD';  // #todo_direction
const SLACK_PROP_WEBHOOK_URL_TEST = 'SLACK_PROP_WEBHOOK_URL_TEST';  // #times_haga

/** Slack 内訳の最大採用件数（diff件数ベース） */
const SLACK_DETAIL_MAX_ITEMS = 30;

/** Slack投稿の最大行数（安全値） */
const SLACK_NOTIFY_MAX_LINES = 250;

/** Slack投稿の最大文字数（安全値。Slackの上限に寄せすぎない） */
const SLACK_NOTIFY_MAX_CHARS = 35000;

/* ============================================================
 * Git的差分（安定ソート + 同位置比較）
 * ============================================================
 */

/**
 * Git的差分を使うかどうか
 * - true: 安定ソート後に同位置比較（Git風）
 * - false: 従来ロジック（主キー寄り等）
 */
const DIFF_USE_GIT_LIKE = true;

/** 安定ソートのキー列（列名ベース） */
// const DIFF_GIT_SORT_KEYS = [
//   '計上月',
//   '種別',
//   'クライアント',
//   '案件名',
//   // 'Board 案件No.',
//   // 'ZAC JOB.No',
//   'SecNO',
//   '金額'
// ];
/**
 * Git的diffの安定ソートキー定義（列名＋昇降順＋null/空白の並び）
 *
 * - col   : 列名（ヘッダー文字列）
 * - dir   : 'asc' | 'desc'
 * - nulls : 'first' | 'last' ←空白や null を最後に寄せたい.
 *
 * nulls の対象は、実装側で以下を「空」と判定する想定：
 * - null / undefined
 * - ''（空文字）
 * - 例: '{空白}' のような表示用文字列を空扱いするかは実装方針次第
 */
const DIFF_GIT_SORT_KEYS = [
  { col: '計上月',        dir: 'asc',  nulls: 'last' },
  { col: '種別',          dir: 'desc',  nulls: 'last' },
  { col: 'クライアント',  dir: 'asc',  nulls: 'last' },
  { col: '案件名',        dir: 'asc',  nulls: 'last' },
  { col: 'SecNO',     dir: 'asc',  nulls: 'last' },
  { col: '金額',          dir: 'desc', nulls: 'last' }
];

/** 代表情報に使う列（Slackの先頭行に出す） */
const DIFF_GIT_REP_COLUMNS = [
  '案件名',
  'クライアント'
];
