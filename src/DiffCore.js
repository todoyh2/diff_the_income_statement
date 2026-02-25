/**
 * ============================================================
 * DiffCore.gs
 *
 * @overview
 * diff 判定を行う純ロジック層。
 *
 * - Spreadsheet API を一切使用しない
 * - 行配列とヘッダー配列のみを入力とする
 *
 * @designPolicy
 * - DIFF_USE_GIT_LIKE=true の場合、安定ソート + 同位置比較（Git風）を使用
 * - DIFF_IGNORE_COLUMNS（列名ベース除外）に対応
 * - 判定値は normalizeDiffValue_ により「意味的に同じ」を同一扱いに寄せる
 * - ログ爆発を避けるため、デバッグログは必要な範囲に絞る
 *
 * @dependsOn
 * - Config.gs（DIFF_TYPES / DIFF_IGNORE_COLUMNS / DEBUG_VERBOSE / DIFF_USE_GIT_LIKE / DIFF_GIT_SORT_KEYS）
 * - LoggerUtil.gs
 * - Util.gs（normalizeDiffValue_ / normalizeHeaderName_）
 * ============================================================
 */

/**
 * @namespace DiffCore
 */
const DiffCore = {};

/* ============================================================
 * Global (internal constants)
 * ============================================================
 */

/**
 * @private
 * @constant {string}
 * @description 安定ソート用の区切り文字（比較キーの内部表現で使用する可能性がある）
 */
const DIFFCORE_KEY_SEP = '\u001F'; // Unit Separator

/**
 * @private
 * @constant {number}
 * @description デバッグログを出す場合の最大行数（ログ爆発防止）
 */
const DIFFCORE_DEBUG_ROW_LIMIT = 5;

/* ============================================================
 * Types
 * ============================================================
 */

/**
 * @typedef {Object} DiffResult
 * @property {string} type DIFF_TYPES.*
 * @property {number} rowIndex 0-based（比較後の行インデックス）
 * @property {Array<any>=} prevRow
 * @property {Array<any>=} currRow
 * @property {number[]=} diffCols
 */

/**
 * @typedef {Object} GitSortKeyDef
 * @property {string} col   列名（ヘッダー文字列）
 * @property {'asc'|'desc'} dir   昇順/降順
 * @property {'first'|'last'} nulls 空白・null を先頭/末尾に寄せる
 */

/**
 * @typedef {Object} ResolvedGitSortKey
 * @property {number} index 列インデックス
 * @property {string} headerNorm 正規化済みヘッダー名
 * @property {'asc'|'desc'} dir
 * @property {'first'|'last'} nulls
 */

/* ============================================================
 * Public
 * ============================================================
 */

/**
 * @description
 * 2つの行配列を比較し、diff 情報を生成する。
 *
 * - DIFF_USE_GIT_LIKE=true の場合は Git的差分（安定ソート+同位置比較）を使用
 * - false の場合は従来通り「行番号ベース」比較
 *
 * @param {Array<Array<any>>} prevRows 比較元行配列
 * @param {Array<Array<any>>} currRows 比較先行配列
 * @param {Array<string>} headers ヘッダー行（列名）
 * @returns {DiffResult[]} diff 情報配列
 */
DiffCore.buildDiff = function (prevRows, currRows, headers) {
  const fn = 'DiffCore.buildDiff';
  LoggerUtil.start(fn, {
    mode: (typeof DIFF_USE_GIT_LIKE === 'boolean' ? DIFF_USE_GIT_LIKE : false) ? 'git-like' : 'row-index',
    prevRows: prevRows ? prevRows.length : 0,
    currRows: currRows ? currRows.length : 0,
    headers: headers ? headers.length : 0
  });

  try {
    const useGitLike = (typeof DIFF_USE_GIT_LIKE === 'boolean') ? DIFF_USE_GIT_LIKE : false;

    if (useGitLike) {
      const sortDefs = (typeof DIFF_GIT_SORT_KEYS !== 'undefined') ? DIFF_GIT_SORT_KEYS : [];
      return DiffCore.buildDiffGitLike(prevRows || [], currRows || [], headers || [], {
        sortKeyDefs: sortDefs
      });
    }

    // 従来の行番号ベース差分
    return DiffCore.buildDiffRowIndex_(prevRows || [], currRows || [], headers || []);

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
};

/**
 * @description
 * Git的差分（安定ソート + 同位置比較）で diff を生成する。
 *
 * 目的：
 * - 行の途中挿入/並び替えによる「ズレ」を緩和し、比較の納得度を上げる
 *
 * 特徴：
 * - sortKeyDefs（dir/nulls対応）に基づき、安定ソートを行う
 * - ソート後、同じインデックス同士を比較して ADD/DELETE/MODIFY を判定する
 *
 * 注意：
 * - 完全な“移動検出”はしない（Git同様、同位置比較を基本にする）
 *
 * @param {Array<Array<any>>} prevRows
 * @param {Array<Array<any>>} currRows
 * @param {Array<string>} headers
 * @param {{sortKeyDefs: GitSortKeyDef[]}} opt
 * @returns {DiffResult[]}
 */
DiffCore.buildDiffGitLike = function (prevRows, currRows, headers, opt) {
  const fn = 'DiffCore.buildDiffGitLike';
  LoggerUtil.start(fn, {
    prev: prevRows ? prevRows.length : 0,
    curr: currRows ? currRows.length : 0,
    headers: headers ? headers.length : 0,
    sortKeyDefs: opt && opt.sortKeyDefs ? opt.sortKeyDefs.length : 0
  });

  try {
    if (!Array.isArray(prevRows)) throw new Error('prevRows が配列ではありません');
    if (!Array.isArray(currRows)) throw new Error('currRows が配列ではありません');
    if (!Array.isArray(headers)) throw new Error('headers が配列ではありません');

    // ソートキー定義を解決（列名→インデックス）
    const resolvedKeys = DiffCore.resolveGitSortKeys_(headers, (opt && opt.sortKeyDefs) ? opt.sortKeyDefs : []);
    LoggerUtil.info(`GitLike sort keys resolved: ${resolvedKeys.length}`);

    // 安定ソート
    const prevSorted = DiffCore.sortRowsStableByKeys_(prevRows, headers, resolvedKeys);
    const currSorted = DiffCore.sortRowsStableByKeys_(currRows, headers, resolvedKeys);

    const maxLen = Math.max(prevSorted.length, currSorted.length);
    /** @type {DiffResult[]} */
    const diffs = [];

    for (let i = 0; i < maxLen; i++) {
      const a = (i < prevSorted.length) ? prevSorted[i] : null;
      const b = (i < currSorted.length) ? currSorted[i] : null;

      // DELETE
      if (a && !b) {
        diffs.push({
          type: DIFF_TYPES.DELETE,
          rowIndex: i,
          prevRow: a,
          currRow: null,
          diffCols: []
        });
        continue;
      }

      // ADD
      if (!a && b) {
        diffs.push({
          type: DIFF_TYPES.ADD,
          rowIndex: i,
          prevRow: null,
          currRow: b,
          diffCols: []
        });
        continue;
      }

      // 両方なし
      if (!a && !b) continue;

      // MODIFY（列単位）
      const diffCols = DiffCore.diffCols_(a, b, headers);

      if (diffCols.length > 0) {
        diffs.push({
          type: DIFF_TYPES.MODIFY,
          rowIndex: i,
          prevRow: a,
          currRow: b,
          diffCols: diffCols
        });

        // デバッグログ（先頭のみ）
        if (DEBUG_VERBOSE && i < DIFFCORE_DEBUG_ROW_LIMIT) {
          LoggerUtil.info(`[DIFF_GIT_DEBUG] idx=${i} diffCols=${diffCols.join(',')}`);
        }
      }
    }

    LoggerUtil.info(`GitLike diff completed: diffs=${diffs.length}`);
    return diffs;

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
};

/* ============================================================
 * Private: Row-index diff (legacy)
 * ============================================================
 */

/**
 * @private
 * @description
 * 従来の「行番号ベース比較」による差分生成。
 *
 * @param {Array<Array<any>>} prevRows
 * @param {Array<Array<any>>} currRows
 * @param {Array<string>} headers
 * @returns {DiffResult[]}
 */
DiffCore.buildDiffRowIndex_ = function (prevRows, currRows, headers) {
  const fn = 'DiffCore.buildDiffRowIndex_';
  LoggerUtil.start(fn, {
    prevRows: prevRows ? prevRows.length : 0,
    currRows: currRows ? currRows.length : 0,
    headers: headers ? headers.length : 0
  });

  try {
    /** @type {DiffResult[]} */
    const diffs = [];

    const safePrev = prevRows || [];
    const safeCurr = currRows || [];
    const safeHeaders = headers || [];

    const maxLen = Math.max(safePrev.length, safeCurr.length);

    for (let rowIndex = 0; rowIndex < maxLen; rowIndex++) {
      const prevRow = safePrev[rowIndex];
      const currRow = safeCurr[rowIndex];

      // ADD
      if (!prevRow && currRow) {
        diffs.push({ type: DIFF_TYPES.ADD, rowIndex, currRow });
        continue;
      }

      // DELETE
      if (prevRow && !currRow) {
        diffs.push({ type: DIFF_TYPES.DELETE, rowIndex, prevRow });
        continue;
      }

      // MODIFY
      if (prevRow && currRow) {
        const diffCols = [];

        safeHeaders.forEach((header, colIndex) => {
          const headerNorm = normalizeHeaderName_(header);

          // 除外列（列名ベース）
          if (DiffCore.isIgnoredColumn_(headerNorm)) return;

          const prevVal = normalizeDiffValue_(prevRow[colIndex], headerNorm);
          const currVal = normalizeDiffValue_(currRow[colIndex], headerNorm);

          if (prevVal !== currVal) {
            diffCols.push(colIndex);

            if (DEBUG_VERBOSE && rowIndex < DIFFCORE_DEBUG_ROW_LIMIT) {
              LoggerUtil.info(
                `[DIFF_DEBUG] rowIndex=${rowIndex} col=${colIndex} header=${headerNorm} prev=${String(prevVal)} curr=${String(currVal)}`
              );
            }
          }
        });

        if (diffCols.length > 0) {
          diffs.push({
            type: DIFF_TYPES.MODIFY,
            rowIndex,
            prevRow,
            currRow,
            diffCols
          });
        }
      }
    }

    LoggerUtil.info(`RowIndex diff completed: diffs=${diffs.length}`);
    return diffs;

  } catch (e) {
    LoggerUtil.error(e);
    throw e;
  } finally {
    LoggerUtil.end(fn);
  }
};

/* ============================================================
 * Private: Git-like sorting
 * ============================================================
 */

/**
 * @private
 * @description
 * DIFF_GIT_SORT_KEYS（オブジェクト配列）を、列インデックスへ解決する。
 *
 * - headers は normalizeHeaderName_ を通した正規化比較でマッチさせる
 * - 見つからない列はスキップする（ログで知らせる）
 *
 * @param {string[]} headers
 * @param {GitSortKeyDef[]} sortKeyDefs
 * @returns {ResolvedGitSortKey[]}
 */
DiffCore.resolveGitSortKeys_ = function (headers, sortKeyDefs) {
  const fn = 'DiffCore.resolveGitSortKeys_';
  LoggerUtil.start(fn, {
    headers: headers ? headers.length : 0,
    defs: sortKeyDefs ? sortKeyDefs.length : 0
  });

  try {
    const headerNormToIndex = {};
    (headers || []).forEach((h, i) => {
      const hn = normalizeHeaderName_(h);
      headerNormToIndex[hn] = i;
    });

    /** @type {ResolvedGitSortKey[]} */
    const resolved = [];

    (sortKeyDefs || []).forEach((def, idx) => {
      if (!def || !def.col) return;

      const colNorm = normalizeHeaderName_(def.col);
      const hitIndex = Object.prototype.hasOwnProperty.call(headerNormToIndex, colNorm)
        ? headerNormToIndex[colNorm]
        : -1;

      if (hitIndex < 0) {
        LoggerUtil.info(`[GitSortKey] not found: def[${idx}] col=${String(def.col)}`);
        return;
      }

      const dir = (def.dir === 'desc') ? 'desc' : 'asc';
      const nulls = (def.nulls === 'first') ? 'first' : 'last';

      resolved.push({
        index: hitIndex,
        headerNorm: colNorm,
        dir: dir,
        nulls: nulls
      });
    });

    // キーが0件でも動かせるが、GitLikeの意味が薄いのでログで注意
    if (resolved.length === 0) {
      LoggerUtil.info('Git sort keys resolved=0（DIFF_GIT_SORT_KEYS が未設定/不一致の可能性）');
    }

    return resolved;

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
 * ResolvedGitSortKey に従って行配列を安定ソートする。
 *
 * 安定ソート保証：
 * - compareが0の場合は originalIndex を比較して元順序を維持する
 *
 * @param {Array<Array<any>>} rows
 * @param {string[]} headers
 * @param {ResolvedGitSortKey[]} keys
 * @returns {Array<Array<any>>}
 */
DiffCore.sortRowsStableByKeys_ = function (rows, headers, keys) {
  const fn = 'DiffCore.sortRowsStableByKeys_';
  LoggerUtil.start(fn, {
    rows: rows ? rows.length : 0,
    keys: keys ? keys.length : 0
  });

  try {
    const decorated = (rows || []).map((r, originalIndex) => {
      return { row: r, originalIndex: originalIndex };
    });

    decorated.sort((a, b) => {
      const cmp = DiffCore.compareRowsByKeys_(a.row, b.row, headers, keys);
      if (cmp !== 0) return cmp;
      return a.originalIndex - b.originalIndex; // stable
    });

    return decorated.map(d => d.row);

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
 * 2行を keys（dir/nulls対応）で比較する。
 *
 * @param {Array<any>} rowA
 * @param {Array<any>} rowB
 * @param {string[]} headers
 * @param {ResolvedGitSortKey[]} keys
 * @returns {number} -1/0/1
 */
DiffCore.compareRowsByKeys_ = function (rowA, rowB, headers, keys) {
  // 例外は上位で握る（sort comparator 内で throw すると全体が壊れるため）
  try {
    const a = rowA || [];
    const b = rowB || [];
    const safeKeys = keys || [];

    for (let k = 0; k < safeKeys.length; k++) {
      const key = safeKeys[k];
      const idx = key.index;
      const headerNorm = key.headerNorm;

      const avRaw = (idx < a.length) ? a[idx] : null;
      const bvRaw = (idx < b.length) ? b[idx] : null;

      const av = DiffCore.normalizeForSort_(avRaw, headerNorm);
      const bv = DiffCore.normalizeForSort_(bvRaw, headerNorm);

      const aEmpty = DiffCore.isNullishOrBlank_(av);
      const bEmpty = DiffCore.isNullishOrBlank_(bv);

      // nulls first/last
      if (aEmpty || bEmpty) {
        if (aEmpty && bEmpty) {
          // 同じ扱い：次キーへ
        } else {
          const emptyFirst = (key.nulls === 'first');
          // aが空・bが非空の場合：
          // - nulls=first なら aが先 => -1
          // - nulls=last  なら aが後 =>  1
          const aBefore = emptyFirst ? aEmpty : !aEmpty;
          return aBefore ? -1 : 1;
        }
        continue;
      }

      // non-empty compare
      const c = DiffCore.compareValues_(av, bv);

      if (c !== 0) {
        return (key.dir === 'desc') ? -c : c;
      }
    }

    return 0;

  } catch (e) {
    // comparator で例外を投げない（並び替え全体が落ちる）
    LoggerUtil.error(e);
    return 0;
  }
};

/**
 * @private
 * @description
 * ソート用に値を正規化する。
 *
 * - normalizeDiffValue_(value, headerNorm) があればそれを優先して使用
 * - 最終的に「比較可能な文字列」へ寄せる
 *
 * @param {any} value
 * @param {string} headerNorm
 * @returns {string}
 */
DiffCore.normalizeForSort_ = function (value, headerNorm) {
  // normalizeDiffValue_ の存在を前提にしつつ、防御的に扱う
  try {
    if (typeof normalizeDiffValue_ === 'function') {
      const v = normalizeDiffValue_(value, headerNorm);
      return (v === null || typeof v === 'undefined') ? '' : String(v);
    }
    return (value === null || typeof value === 'undefined') ? '' : String(value);

  } catch (e) {
    LoggerUtil.error(e);
    return (value === null || typeof value === 'undefined') ? '' : String(value);
  }
};

/**
 * @private
 * @description
 * 2つの値を比較する（文字列比較を基本に、数値っぽい場合は numeric 寄りに比較）。
 *
 * 方針：
 * - まず完全一致なら 0
 * - numeric比較が妥当そうなら numeric
 * - それ以外は localeCompare（numeric:true）で比較
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
DiffCore.compareValues_ = function (a, b) {
  const sa = String(a);
  const sb = String(b);

  if (sa === sb) return 0;

  // 数値として比較できそうなら numeric
  const na = DiffCore.tryParseNumber_(sa);
  const nb = DiffCore.tryParseNumber_(sb);

  if (na !== null && nb !== null) {
    if (na < nb) return -1;
    if (na > nb) return 1;
    return 0;
  }

  // 文字列として比較（数値的並びもある程度効く）
  const c = sa.localeCompare(sb, 'ja', { numeric: true, sensitivity: 'base' });
  if (c < 0) return -1;
  if (c > 0) return 1;
  return 0;
};

/**
 * @private
 * @description
 * "null/undefined/空文字" を空扱いにする（nulls制御に使う）。
 *
 * @param {any} v
 * @returns {boolean}
 */
DiffCore.isNullishOrBlank_ = function (v) {
  if (v === null || typeof v === 'undefined') return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  return false;
};

/**
 * @private
 * @description
 * 数値として解釈可能なら number を返す。不可能なら null。
 *
 * - "1,234" のようなカンマ付きにも対応
 *
 * @param {string} s
 * @returns {number|null}
 */
DiffCore.tryParseNumber_ = function (s) {
  if (typeof s !== 'string') return null;

  const t = s.replace(/,/g, '').trim();
  if (!t) return null;

  // 数値としての厳密性はほどほど（業務データ向け）
  const n = Number(t);
  if (!isFinite(n)) return null;
  return n;
};

/* ============================================================
 * Private: Diff columns
 * ============================================================
 */

/**
 * @private
 * @description
 * 2行の差分列インデックスを返す（DIFF_IGNORE_COLUMNS を反映）。
 *
 * @param {Array<any>} prevRow
 * @param {Array<any>} currRow
 * @param {string[]} headers
 * @returns {number[]}
 */
DiffCore.diffCols_ = function (prevRow, currRow, headers) {
  const fn = 'DiffCore.diffCols_';
  LoggerUtil.start(fn);

  try {
    const a = prevRow || [];
    const b = currRow || [];
    const hs = headers || [];

    const cols = Math.max(a.length, b.length, hs.length);
    const out = [];

    for (let i = 0; i < cols; i++) {
      const headerNorm = (i < hs.length) ? normalizeHeaderName_(hs[i]) : '';

      // 除外列
      if (DiffCore.isIgnoredColumn_(headerNorm)) continue;

      const av = (typeof normalizeDiffValue_ === 'function') ? normalizeDiffValue_(a[i], headerNorm) : a[i];
      const bv = (typeof normalizeDiffValue_ === 'function') ? normalizeDiffValue_(b[i], headerNorm) : b[i];

      // normalizeDiffValue_ の返値で比較（意味的同一を寄せる）
      if (String(av) !== String(bv)) {
        out.push(i);
      }
    }

    return out;

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
 * DIFF_IGNORE_COLUMNS に含まれるかを判定する（正規化済み列名で比較）。
 *
 * @param {string} headerNorm
 * @returns {boolean}
 */
DiffCore.isIgnoredColumn_ = function (headerNorm) {
  try {
    const hn = String(headerNorm || '');
    const ignores = Array.isArray(DIFF_IGNORE_COLUMNS) ? DIFF_IGNORE_COLUMNS : [];
    // DIFF_IGNORE_COLUMNS 側も normalizeHeaderName_ 済みを想定だが、防御的に normalize して比較する
    for (let i = 0; i < ignores.length; i++) {
      if (normalizeHeaderName_(ignores[i]) === hn) return true;
    }
    return false;
  } catch (e) {
    LoggerUtil.error(e);
    return false;
  }
};
