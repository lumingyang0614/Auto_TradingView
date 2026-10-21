已完成唯讀驗證，未修改檔案。`node --test tests/levels.test.js`：**11 個全部通過**。另以記憶體內 VM 模擬就緒與清除流程，未操作實際 TradingView。

上一輪六個問題核對如下；嚴重度沿用原評級：

| 問題 | 嚴重度 | 位置 | 驗證結果與建議 |
|---|---|---|---|
| 1. CLI 未提供參數覆蓋預設值 | 高 | `src/core/levels.js:56` | **已解決**。忽略 `undefined`，保留預設值，已有回歸測試。 |
| 2. symbol/timeframe 字串注入 | 高 | `src/core/chart.js:36、49` | **已解決**。兩處均以 `JSON.stringify` 產生完整 literal。建議補含反斜線、引號的回歸測試。 |
| 3. 切換後可能讀到舊資料 | 中 | `src/core/levels.js:189、270` | **部分解決**。加入逾時錯誤、先計算再清線，但就緒條件仍有漏洞，見下方。 |
| 4. CLI 缺少數值驗證 | 中 | `src/core/levels.js:60、119、266` | **主要問題已解決**。有限數值、整數範圍與 boolean 均先驗證；參數間的相容性仍未在操作前檢查，見下方。 |
| 5. MCP `"false"` 啟用 zones | 中 | `src/tools/levels.js:15` | **已解決**。實測字串 `"false"` 被拒絕，boolean `false` 保持為 false。 |
| 6. 四捨五入影響價位選取 | 低 | `src/core/levels.js:150` | **已解決**。完整精度排序、截取後才四捨五入，並依 touches、最近 index 次排序。建議補分數差小於 `0.01` 的案例。 |

尚需修正的問題：

1. **中｜就緒檢查可能接受錯誤商品或週期**

   位置：[src/core/levels.js:194](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:194)、[src/core/levels.js:200](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:200)

   `tickerOf()` 去掉交易所，使要求 `BINANCE:BTCUSDT` 時，`OTHER:BTCUSDT` 也能通過。第二次取樣僅比較 bar 數，不再確認 symbol／resolution；模擬第二次變成其他商品及週期、但仍有 500 根，也直接回傳成功。此外，bar 數不變本身無法證明資料已完成切換。

   **建議：**指定交易所時核對完整商品識別；每次取樣都確認商品與週期，並搭配資料載入完成訊號。讀取 K 線時再次確認圖表身分。

2. **中｜清除失敗會丟失追蹤 ID，文字識別的殘留也未驗證**

   位置：[src/core/levels.js:256](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:256)

   殘留檢查前已將 registry 清空。若已登記的矩形未成功移除且無文字屬性，本次雖會報錯，下次卻失去辨識它的 ID。另外，`left` 只檢查原 registry，漏掉僅由 `AutoSR` 前綴識別的圖形。

   模擬 `removeEntity` 未實際刪除時，已登記圖形報錯但 registry 變空；僅有文字標記的圖形則錯誤回報 `success: true, removed: 1`。

   **建議：**先收集所有待刪 ID，再刪除並核對完整集合；保留仍存在的 ID，確認刪除後才移出 registry。

3. **低｜不可能滿足的 pivot 視窗仍會先操作圖表**

   位置：[src/core/levels.js:72](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:72)、[src/core/levels.js:268](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:268)

   `{ bars: 20, pivot_left: 50, pivot_right: 50 }` 通過 `resolveOptions()`，但計算至少需要 101 根。若同時指定商品或週期，會先切換圖表，讀取後才失敗。既有線不會被清除，但不符合「無效參數先於圖表操作拒絕」的目的。

   **建議：**在 `resolveOptions()` 加入 `bars >= pivot_left + pivot_right + 1`；保留計算階段對實際資料量的檢查。

分群目前確實限制 `max - min <= tolerance`；矩形上下界也包含全部群內 pivot。不過繪圖仍向 `mean ± tolerance/2` 擴張，因此矩形不一定恰等於 `zone_low/zone_high`，其寬度也可能大於 tolerance，應確認是否符合預期。

現有 11 個測試涵蓋純計算與參數驗證，尚未涵蓋上述就緒及清除流程；實際 TradingView 矩形生命週期也尚未驗證。

**結論：需修正。** 優先修正圖表身分確認與清除失敗後的 ID 保留。