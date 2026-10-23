# Codex 驗證說明：自動載入歷史 K 線（第 4 輪）

請以**唯讀**方式審查目前未 commit 的變更（`git diff`），找出正確性 bug、邊界情況與 TradingView API 使用風險。不要修改檔案，只回報結果，最後給出結論（可上線 / 需修正）。

## 問題背景
TradingView 切換商品或週期後，主圖一開始只載入約 300 根 K 線。自動畫線工具預設 `bars: 500`，但 `readBars` 只能讀到已載入的 300 根，而且沒有任何提示（日線只涵蓋約 14 個月）。使用者要求至少讀滿 365 根。

## 變更內容
- `src/core/autodraw.js`
  - 新增 `historyState()`：讀 `mainSeries().bars().size()`、`endOfData()`、`_lastCompleteFlags.data_completed`
  - 新增 `ensureHistory(count)`：呼叫 `mainSeries().requestMoreData(count - size)` 要更舊的資料，直到：
    - 根數 ≥ `count`
    - `endOfData()` 為真（`data_completed` 為 `"limit"` 表示方案上限，其他值表示上市起點）
    - 一次請求後 3 秒內根數沒增加（停滯）
    - 總時間超過 20 秒
    不足時回傳說明字串。
  - `loadChart(o)`：`waitForChart` → `ensureHistory(o.bars)` → 再 `waitForChart`（確認舊資料穩定、仍是同一張圖）→ `readBars`。讀到的根數不足 `o.bars` 時回傳 `bars_note`。
- `src/core/levels.js`、`trendlines.js`、`triangles.js`、`structure.js`：把 `bars_note` 帶進結果；批次掃描的 `summarize()` 多回傳 `bars` 與 `bars_note`。
- `CLAUDE.md`：說明。

## 實測（TradingView Desktop 3.4.1，透過 CDP）
- `requestMoreData(200)`：300 → 500 根，約 0.3 秒內完成。
- 持續要求：BINGX:ADAUSDT.P 4H 載到 6151 根後 `endOfData()` 變 true，`_lastCompleteFlags = {"rt_update_period":5,"data_completed":"limit"}`。
- `requestMoreData` 原始碼開頭：`if(!seriesReadyStatuses.has(status))return; if(timeScale().isEmpty())return; const t=timeScale().visibleBarsStrictRange(); if(null===t)return; if(0===bars().size())return; ...`
- `scan --symbols NASDAQ:META,NASDAQ:AAOI`：1D、1W、15m、1H 全部 500 根，0 錯誤。
- NYSE:CRCL 日線（2025-06 上市）：347 根，`bars_note: "Only 347 of 500 bars available (start of history)"`，約 13 秒。

## 請重點檢查
1. `ensureHistory` 的迴圈：停滯判斷、`endOfData` 判斷、總逾時是否正確；`requestMoreData` 在前置條件不成立時會靜默返回，是否會導致不必要的等待或誤判。
2. 第二次 `waitForChart` 與 `sameChart(info, first)` 能否正確偵測載入期間被切換商品；`bar_count` 會變大，`sameChart` 不比對根數是否合理。
3. `bars_note` 的設定邏輯（`ensureHistory` 回傳的說明與 `readBars` 實際根數不一致時）。
4. 多請求的資料是否可能讓 `readBars` 讀到不連續或尚未完成的 K 線。
5. 使用私有欄位 `_lastCompleteFlags` 的風險（目前只用來顯示原因）。

## 驗證指令（不需要 TradingView 連線）
```
node --test tests/levels.test.js tests/trendlines.test.js tests/triangles.test.js
node -e "import('./src/core/structure.js').then(m => console.log(typeof m.drawWatchlist))"
```
