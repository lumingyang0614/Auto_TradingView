# Codex 驗證：自動載入歷史 K 線（第 5 輪，複驗）

請以**唯讀**方式複驗 `git diff`（未 commit 變更）。背景與變更說明見 `docs/codex-review/CODEX_REVIEW_4.md`，上一輪結果見 `docs/codex-review/CODEX_RESULT_4.md`。不要修改檔案，最後給出結論（可上線 / 需修正）。

## 針對第 4 輪的修正
1. **`bars_note` 過時**：`ensureHistory()` 不再回傳說明。`loadChart()` 在 `readBars()` 之後，若實際根數 < `o.bars`，才呼叫 `historyNote(count, got)`。它當下重讀 `historyState()`，以實際讀到的根數與當下的終止狀態組成說明。
2. **總逾時未約束內層等待**：內層停滯期限改為 `Math.min(Date.now() + HISTORY_STALL, deadline)`。
3. **私有欄位說明誤報**：`data_completed` 不是 `"limit"` 時，改顯示中性的 `end of history`；`endOfData` 不存在時視為未到終點。

## 實測
- NYSE:CRCL 1D：347 根，`Only 347 of 500 bars available (end of history)`。
- NASDAQ:META 1W：500 根（自 2017-03-27），無 note。
- 計時：`setSymbol` 本身約 10.6 秒（既有行為，非本次變更）；`requestMoreData(200)` 在 0.3 秒內完成。
- 單元測試 34/34 通過。

## 請確認
- 上述兩個 P2 是否已修正，修正是否引入新問題。
- 其餘第 4 輪提到的已知限制（單次停滯即停止、無法偵測切走再切回）是否可接受上線。
