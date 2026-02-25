/**
 * ============================================================
 * Menu.gs
 *
 * @overview
 * スプレッドシートのカスタムメニュー定義（完全版）。
 *
 * @designPolicy
 * - 既存メニュー機能を勝手に削らない（後方互換を最優先）
 * - UI（Menu.gs）と業務ロジック（MainService / SnapshotService 等）を分離する
 * - try-catch と logging を必ず行い、原因特定可能なログを残す
 *
 * @dependsOn
 * - Config.gs
 * - LoggerUtil.gs
 * - SnapshotService.gs
 * - MainService.gs
 * ============================================================
 */

/**
 * @description
 * スプレッドシート起動時にカスタムメニューを追加する。
 */
function onOpen() {
  const fn = 'onOpen';
  LoggerUtil.start(fn);

  try {
    const ui = SpreadsheetApp.getUi();

    ui.createMenu('収支管理')

      // --- Snapshot ---
      .addItem('Snapshotのみ', 'menuSnapshotOnly')

      // --- Snapshot + Diff ---
      .addItem('Snapshot＋Diff（差分比較のみ）', 'menuSnapshotAndDiffVisual')
      .addItem('Snapshot＋Diff（差分比較＋変更一覧）', 'menuSnapshotAndDiffBoth')
      .addItem('Snapshot＋Diff（差分比較＋変更一覧＋Slack）', 'menuSnapshotAndDiffBothWithSlack')

      .addSeparator()

      // --- Diff: Latest Two ---
      .addItem('Diff（最新2シート・差分比較のみ）', 'menuDiffLatestVisual')
      .addItem('Diff（最新2シート・差分比較＋変更一覧）', 'menuDiffLatestBoth')
      .addItem('Diff（最新2シート・差分比較＋変更一覧＋Slack）', 'menuDiffLatestBothWithSlack')

      .addSeparator()

      // --- Diff: Manual ---
      .addItem('任意2シートDiff（差分比較のみ）', 'menuDiffManualVisual')
      .addItem('任意2シートDiff（差分比較＋変更一覧）', 'menuDiffManualBoth')
      .addItem('任意2シートDiff（差分比較＋変更一覧＋Slack）', 'menuDiffManualBothWithSlack')

      .addSeparator()

      // --- Slack Only ---
      .addItem('Slack通知（任意2シートDiff・sheet出力なし）', 'menuSlackNotifyManualDiffOnly')

      .addSeparator()
      // --- Archive ---
      .addItem('古いSnapshotをアーカイブ（CSV出力）', 'menuArchiveOldSnapshots')
      .addItem('アーカイブから復元（CSV -> 新規シート）', 'menuRestoreFromArchive')

      .addToUi();

    LoggerUtil.info('カスタムメニューを追加しました');

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/**
 * @description
 * 手動で古い Snapshot をアーカイブ（CSV 出力）するメニューハンドラ
 */
function menuArchiveOldSnapshots() {
  const fn = 'menuArchiveOldSnapshots';
  LoggerUtil.start(fn);

  try {
    // dryRun=false で本実行（削除は Config のフラグに従う）
    SnapshotArchiveService.archiveOldSnapshots({ dryRun: false });
    LoggerUtil.info('古いSnapshotのアーカイブ処理を実行しました');
  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/**
 * @description
 * アーカイブから CSV を選んで復元するメニューハンドラ
 */
function menuRestoreFromArchive() {
  const fn = 'menuRestoreFromArchive';
  LoggerUtil.start(fn);

  try {
    SnapshotArchiveService.restoreFromArchivePrompt();
  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/* ============================================================
 * Snapshot
 * ============================================================
 */

/**
 * @description
 * Snapshot のみ実行する。
 */
function menuSnapshotOnly() {
  const fn = 'menuSnapshotOnly';
  LoggerUtil.start(fn);

  try {
    SnapshotService.createOrUpdateDailySnapshot('manual');
    LoggerUtil.info('Snapshot のみ実行完了');
  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/* ============================================================
 * Snapshot + Diff
 * ============================================================
 */

/**
 * @description
 * Snapshot を作成し、直前 Snapshot と diff（差分比較のみ）を実行する。
 */
function menuSnapshotAndDiffVisual() {
  const fn = 'menuSnapshotAndDiffVisual';
  LoggerUtil.start(fn);

  try {
    MainService.runSnapshotAndDiff(DIFF_OUTPUT_MODE.VISUAL, false);
    LoggerUtil.info('Snapshot＋Diff（差分比較のみ）完了');
  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/**
 * @description
 * Snapshot を作成し、直前 Snapshot と diff（差分比較＋変更一覧）を実行する。
 */
function menuSnapshotAndDiffBoth() {
  const fn = 'menuSnapshotAndDiffBoth';
  LoggerUtil.start(fn);

  try {
    MainService.runSnapshotAndDiff(DIFF_OUTPUT_MODE.BOTH, false);
    LoggerUtil.info('Snapshot＋Diff（差分比較＋変更一覧）完了');
  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/**
 * @description
 * Snapshot を作成し、直前 Snapshot と diff（差分比較＋変更一覧）を実行し Slack 通知する。
 */
function menuSnapshotAndDiffBothWithSlack() {
  const fn = 'menuSnapshotAndDiffBothWithSlack';
  LoggerUtil.start(fn);

  try {
    MainService.runSnapshotAndDiff(DIFF_OUTPUT_MODE.BOTH, true);
    LoggerUtil.info('Snapshot＋Diff（差分比較＋変更一覧＋Slack）完了');
  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/* ============================================================
 * Diff: Latest Two
 * ============================================================
 */

/**
 * @description
 * 最新2シートで diff（差分比較のみ）を実行する。
 */
function menuDiffLatestVisual() {
  const fn = 'menuDiffLatestVisual';
  LoggerUtil.start(fn);

  try {
    MainService.runDiffLatest(DIFF_OUTPUT_MODE.VISUAL, false);
    LoggerUtil.info('Diff（最新2シート・差分比較のみ）完了');
  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/**
 * @description
 * 最新2シートで diff（差分比較＋変更一覧）を実行する。
 */
function menuDiffLatestBoth() {
  const fn = 'menuDiffLatestBoth';
  LoggerUtil.start(fn);

  try {
    MainService.runDiffLatest(DIFF_OUTPUT_MODE.BOTH, false);
    LoggerUtil.info('Diff（最新2シート・差分比較＋変更一覧）完了');
  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/**
 * @description
 * 最新2シートで diff（差分比較＋変更一覧）を実行し Slack 通知する。
 */
function menuDiffLatestBothWithSlack() {
  const fn = 'menuDiffLatestBothWithSlack';
  LoggerUtil.start(fn);

  try {
    MainService.runDiffLatest(DIFF_OUTPUT_MODE.BOTH, true);
    LoggerUtil.info('Diff（最新2シート・差分比較＋変更一覧＋Slack）完了');
  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/* ============================================================
 * Diff: Manual
 * ============================================================
 */

/**
 * @description
 * 任意2シート diff（差分比較のみ）を実行する。
 */
function menuDiffManualVisual() {
  const fn = 'menuDiffManualVisual';
  LoggerUtil.start(fn);

  try {
    runManualDiff_(DIFF_OUTPUT_MODE.VISUAL, false, false);
    LoggerUtil.info('任意2シートDiff（差分比較のみ）完了');
  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/**
 * @description
 * 任意2シート diff（差分比較＋変更一覧）を実行する。
 */
function menuDiffManualBoth() {
  const fn = 'menuDiffManualBoth';
  LoggerUtil.start(fn);

  try {
    runManualDiff_(DIFF_OUTPUT_MODE.BOTH, false, false);
    LoggerUtil.info('任意2シートDiff（差分比較＋変更一覧）完了');
  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/**
 * @description
 * 任意2シート diff（差分比較＋変更一覧）を実行し Slack 通知する（sheet出力あり）。
 */
function menuDiffManualBothWithSlack() {
  const fn = 'menuDiffManualBothWithSlack';
  LoggerUtil.start(fn);

  try {
    runManualDiff_(DIFF_OUTPUT_MODE.BOTH, true, false);
    LoggerUtil.info('任意2シートDiff（差分比較＋変更一覧＋Slack）完了');
  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/* ============================================================
 * Slack Only (No Sheet Output)
 * ============================================================
 */

/**
 * @description
 * 任意2シートを指定して diff を計算し、Sheet 出力せず Slack にのみ通知する。
 */
function menuSlackNotifyManualDiffOnly() {
  const fn = 'menuSlackNotifyManualDiffOnly';
  LoggerUtil.start(fn);

  try {
    const pair = promptSheetPair_('Slack通知（sheet出力なし）用に、比較元/比較先シートを指定します。');
    if (!pair) {
      LoggerUtil.info('ユーザーキャンセルにより中断');
      return;
    }

    const channel = '';
    MainService.runDiffForSlackOnlyManual(pair.prev, pair.curr, channel);

    LoggerUtil.info('Slack通知（sheet出力なし）完了');

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/* ============================================================
 * Private UI Helpers
 * ============================================================
 */

/**
 * @private
 * @description
 * 任意2シート diff の共通UI処理。
 *
 * @param {{visual:boolean,detail:boolean}} outputMode diff 出力モード
 * @param {boolean} notifySlack Slack 通知有無（sheet出力ありルート）
 * @param {boolean} isSlackOnly この関数から SlackOnly を呼ぶか（拡張余地）
 */
function runManualDiff_(outputMode, notifySlack, isSlackOnly) {
  const fn = 'runManualDiff_';
  LoggerUtil.start(fn, { outputMode, notifySlack, isSlackOnly });

  try {
    const pair = promptSheetPair_('比較元/比較先のシート名を指定してください。');
    if (!pair) return;

    MainService.runDiffManual(pair.prev, pair.curr, outputMode, notifySlack);

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}

/**
 * @private
 * @description
 * 比較元/比較先のシート名を UI.prompt で取得する。
 *
 * @param {string} message 先頭説明文
 * @returns {{prev:string,curr:string}|null}
 */
function promptSheetPair_(message) {
  const fn = 'promptSheetPair_';
  LoggerUtil.start(fn, { message });

  try {
    const ui = SpreadsheetApp.getUi();

    const from = ui.prompt(
      '比較元シート名 （exp.「15_260203」）',
      message + '\n\n比較元として実在する Snapshot シート名を入力してください。',
      ui.ButtonSet.OK_CANCEL
    );
    if (from.getSelectedButton() !== ui.Button.OK) return null;

    const to = ui.prompt(
      '比較先シート名 （exp.「15_260228」）',
      '比較先として実在する Snapshot シート名を入力してください。',
      ui.ButtonSet.OK_CANCEL
    );
    if (to.getSelectedButton() !== ui.Button.OK) return null;

    const prev = (from.getResponseText() || '').trim();
    const curr = (to.getResponseText() || '').trim();

    if (!prev || !curr) {
      throw new Error('比較元/比較先のシート名が空です');
    }

    return { prev: prev, curr: curr };

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
}
