# Codex 驗證：日線兩年時間範圍（第 6 輪）

請以**唯讀**方式審查 `git diff`（未 commit 變更），不要修改檔案，最後給出結論（可上線 / 需修正）。
`git diff` 同時包含已在第 4、5 輪驗證過的「自動載入歷史 K 線」（見 `docs/codex-review/CODEX_REVIEW_4.md`、`CODEX_RESULT_5.md`）。本輪重點是新增的時間範圍功能。

## 需求
使用者要求日線看兩年的 K 線。用根數不精確：股票一年約 250 根，加密貨幣 365 根。

## 變更（`src/core/autodraw.js` 為主）
- `DAILY_LOOKBACK_DAYS = 730`；新增選項 `days`（1–36500 的整數）。
- `validateOptions` 驗證 `days`，並記錄 `o.bars_explicit`（使用者是否明確給了 `bars`）。
- `historyState()` 多回傳第一根與最後一根 K 線的時間。
- `ensureHistory(count, since)`：有 `since` 時，一直要資料直到第一根時間 ≤ `since`（每次最多 500 根，總量上限 `MAX_BARS = 2000`）；沒有 `since` 時維持原本依根數的邏輯。
- `loadChart(o)`：
  - 採用天數的條件：有 `o.days`，或日線（`normalizeTf(resolution) === '1D'`）且沒有明確給 `bars`（此時用 730 天）。
  - `since` = 最後一根時間 − days × 86400。
  - 讀 `MAX_BARS` 根後，過濾出 `time >= since` 的 K 線。
  - 第一根比 `since` 晚 10 天以上時，回傳 `bars_note`。
- `historyNote` 改為 `historyWhy()`，只回傳原因，並加上 `MAX_BARS` 上限的情況。
- MCP 工具（`src/tools/levels.js`、`trendlines.js`、`structure.js`）與 CLI（`--days`）新增 `days` 參數。
- `tests/levels.test.js`：`days` 驗證與 `bars_explicit` 測試。

## 請重點檢查
1. `bars_explicit` 的傳遞：`drawStructure` 用 `levels.resolveOptions(opts)` 的結果呼叫 `loadChart`，`computeLevels` 等會對已解析的選項再次 resolve，是否有路徑讓 `bars_explicit` 判斷錯誤。`drawMicro` 是否受影響。
2. `since` 的計算，以及過濾後 K 線太少（新上市）時，下游 `computeLevels` / `computeTrendlines` / `computeTriangles` 的行為。
3. `ensureHistory` 在時間模式下的終止條件。
4. `bars_note` 的 10 天緩衝是否合理（週末、長假）。
5. `validateOptions` 在 `days` 只給一部分選項、或與 `bars` 並存時的行為。
6. 週線、日內週期不應受影響。

## 驗證指令（不需要 TradingView 連線）
```
node --test tests/levels.test.js tests/trendlines.test.js tests/triangles.test.js
node src/cli/index.js levels draw --help
```

## 另一項小變更（同一份 diff）
- 自選清單掃描（`drawWatchlist` / `draw_watchlist_structure` / CLI `scan`）的 `micro_timeframes` 預設從 `['15', '60']` 改為 `['60']`（使用者不再要 15m）。`draw_micro_structure` 單獨使用時預設仍為 15m。

## 實測（本輪）
- NASDAQ:AAOI 1D：502 根（約兩年股票交易日）；BINANCE:BTCUSDT 1D：731 根。
- 自選清單 29 檔 `scan --clear 15`：0 錯誤，日線 501–502 根（股票）、731 根（BTC）；上市不足兩年的標的有 `bars_note`。
