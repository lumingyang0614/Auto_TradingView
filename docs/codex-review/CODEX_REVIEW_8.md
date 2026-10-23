# Codex 驗證：第 7 輪問題修正複驗（第 8 輪）

請以**唯讀**方式複驗目前工作目錄（`git diff` 加上 `70f67bb`、`28076ba` 的內容）。上一輪的問題見 `docs/codex-review/CODEX_RESULT_7.md`。不要修改檔案，確認每一項是否已修正、是否引入新問題，最後給出結論（可上線 / 需修正）。

## 修正對照
1. **P1 讀取後圖被切走**
   - `autodraw.js` 新增 `chartGuard(expect)`，在頁面內比對 `mainSeries().symbolInfo()` 的 pro_name 與 `interval()`，不符就 throw。
   - `createShape` 在同一個 `evaluateAsync` 裡先執行 guard，再建立圖形並寫入 registry。
   - `clearTagged` 在同一個 `evaluate` 裡先執行 guard，再刪除。
   - `loadChart` 回傳 `chart = { symbol, resolution }`，所有 draw / render / clear 都帶入。
   - 批次掃描的 `clear_timeframes` 用 `{ symbol: entry.chart_symbol }` 驗證。
2. **P1 未指定商品時，請求與載入不一致**：`waitForChart` 的 `ready` 一律要求 `ticker(i.symbol) === ticker(i.requested)`。只比對代號，以保留 NASDAQ→BATS 的替代。
3. **P1 registry 跨商品遺失**
   - registry 項目多記 `symbol`（建立時頁面內的 loaded symbol）。
   - `clearTagged` 只處理目前商品的項目（`mine`）。其他商品的項目原樣保留（`others`）。
   - 沒有 symbol 的舊項目：目前可見就視為本商品，否則保留。
4. **P2 空週期字串**
   - `clearTagged` 拒絕空白或非字串的 `timeframe`。
   - MCP schema 改為 `z.string().trim().min(1)`，`clear_timeframes` 的元素也一樣。
5. **P2 微結構 pivot 長度**：`computeMicro` 用 `minRange = max(min_range_bars, pivot_left + pivot_right + 1)` 判斷擴大區間與略過型態搜尋。
6. **P2 只清除的批次**：沒有成功畫過時，先 `focusChart({symbol, match_symbol})`（新的 export：切換並等待就緒）再清除。
7. **P2 恢復原圖**：恢復後以 `chart.getState()` 比對原本的 symbol / resolution，結果多回傳 `restored`，失敗時附 `restore_error`。
8. **P3**：`server.js` instructions 更新為「1D（兩年）+ 1W、1H micro」。

## 新增測試（37/37 通過）
- `computeMicro`：range 小於 pivot 視窗時略過型態搜尋（Codex 第 7 輪的重現案例）
- `clearLevels({ timeframe: '' })` / `'  '` 會被拒絕

## 實測（TradingView Desktop）
- `scan --symbols NASDAQ:SOXX,NASDAQ:NVDA` 連跑兩次：0 錯誤，`restored: true`。
  - NVDA 圖上自動線 17 條，按標籤與週期計數無重複，與 registry 中 NVDA 的 17 筆一致。
  - registry 依商品分開保存：SOXX 16、NVDA 17。
- guard：圖在 NVDA 時，以 `chart: {symbol: 'NASDAQ:AAPL'}` 呼叫 `createShape` 與 `clearTagged` 皆被擋下，圖形數 23 → 23。
- `scan --symbols NASDAQ:NVDA --timeframes none --micro none --clear 15`：正常切換並清除，`restored: true`。

## 已知、刻意不處理
- 並行的圖表操作（使用者手動切圖）無法真正協調。現在的作法是每次變更前驗證，發現被切走就中止，而不是畫錯。
