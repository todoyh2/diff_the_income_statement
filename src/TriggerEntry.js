/**
 * @description
 * 毎日Snapshot作成（現行トリガー運用用）
 */
function _triggerDailySnapshotOnly() {
	const fn = "triggerDailySnapshotOnly";
	LoggerUtil.start(fn);

	try {
		// trigger として記録
		SnapshotService.createOrUpdateDailySnapshot("trigger");
		LoggerUtil.info("Snapshot のみ（trigger）実行完了");
	} catch (e) {
		LoggerUtil.error(e);
		throw e; // トリガー失敗検知のため投げ直し
	} finally {
		LoggerUtil.end(fn);
	}
}

/**
 * @description
 * 将来：毎日Snapshot作成 + 直前とDiff + Slack通知
 * バグ払拭後にトリガーをこちらへ付け替える想定
 */
function _triggerDailySnapshotDiffNotify() {
	const fn = "triggerDailySnapshotDiffNotify";
	LoggerUtil.start(fn);

	try {
		// 既存のオーケストレーションを利用
		MainService.runSnapshotAndDiff(DIFF_OUTPUT_MODE.BOTH, true);
		LoggerUtil.info("Snapshot＋Diff＋Slack（trigger）実行完了");
	} catch (e) {
		LoggerUtil.error(e);
		throw e;
	} finally {
		LoggerUtil.end(fn);
	}
}
