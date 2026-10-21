已完成唯讀審查，未修改檔案。**整體結論：需修正。**

指定驗證全部通過：7 個單元測試、兩個 CLI help 指令，以及 MCP 模組匯入。但目前測試未涵蓋 CLI 預設參數與實際繪圖生命週期。

1. **高｜CLI 未提供的參數覆蓋預設值，預設指令無法運作**
   
   位置：[src/cli/commands/levels.js:25](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/cli/commands/levels.js:25)、[src/core/levels.js:189](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:189)
   
   `num(undefined)` 回傳 `undefined`，但 handler 仍傳入這些屬性；`{ ...DEFAULTS, ...opts }` 因而覆蓋預設值。未指定 `--bars` 時，`Math.min(undefined, 2000)` 為 `NaN`，讀取迴圈不執行，最後回報無法讀取 K 線。只補 `--bars` 仍會因 pivot、touches、max 等參數變成 `undefined` 而得到空結果，甚至清掉既有自動線。
   
   **建議修正：**合併前移除值為 `undefined` 的屬性，或逐項使用 `??` 套用預設值；新增 CLI handler 預設參數測試。

2. **高｜symbol/timeframe 路徑仍存在 JavaScript 注入**
   
   位置：[src/core/levels.js:190](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:190)，來源為 [src/core/chart.js:36](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/chart.js:36)、[src/core/chart.js:49](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/chart.js:49)
   
   `createShape` 本身的 `JSON.stringify` 處理沒有發現注入問題；但新入口呼叫的既有函式僅跳脫單引號，未處理反斜線。輸入 `X\'); globalThis.injected = true; //` 可突破字串邊界，已用隔離的 Node VM 重現，未連線操作 TradingView。
   
   **建議修正：**symbol、timeframe 均以 `JSON.stringify(value)` 產生完整 JS 字串 literal，不再自行加單引號。此為既有缺陷，但新功能也暴露同一路徑。

3. **中｜切換商品／週期後未確認資料就緒，可能使用舊 K 線**
   
   位置：[src/core/levels.js:190](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:190)
   
   `setSymbol`／`setTimeframe` 回傳的 `chart_ready` 被忽略。既有 `waitForChartReady` 逾時會回傳 `false`，且未實際檢查 `expectedTf`。因此載入延遲或切換失敗時，仍可能讀取舊資料、清除舊線，並將計算結果畫到已切換的圖表。
   
   **建議修正：**就緒失敗即停止；讀取資料前確認實際 symbol、resolution 與資料載入狀態，完成確認後才清線。

4. **中｜CLI 數值只有轉型，沒有範圍驗證**
   
   位置：[src/cli/commands/levels.js:4](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/cli/commands/levels.js:4)、[src/core/levels.js:84](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:84)
   
   CLI 繞過 MCP schema。非數字可產生 `NaN`；小數 pivot 可能存取不存在的陣列索引；負數 `max` 會觸發 `slice(0, -1)` 等非預期行為。部分輸入會產生空結果並繼續清線，而不是明確拒絕。
   
   **建議修正：**在核心入口共用參數驗證，檢查有限數值、整數、上下限及 pivot 視窗所需資料量；驗證應先於圖表操作。

5. **中｜MCP 的 `"false"` 會啟用 zones**
   
   位置：[src/tools/levels.js:15](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/tools/levels.js:15)
   
   已直接驗證 `schema.zones.parse('false') === true`。傳入字串的客戶端會得到相反結果；真正的 JSON boolean `false` 正常。
   
   **建議修正：**使用 `z.boolean().optional()`，或只對明確的 `"true"`／`"false"` 做轉換。CLI 的正常 `--zones` 旗標不經過此 schema，沒有相同的 coercion 問題。

6. **低｜評分先四捨五入再選取，可能淘汰較強價位**
   
   位置：[src/core/levels.js:106](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:106)、[src/core/levels.js:117](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:117)
   
   近期權重的差距可能小於 `0.01`，先取兩位小數會讓不同原始分數變成同分。穩定排序保留原本價格遞增的順序，可能優先選到較低價、但原始分數較低的 cluster。
   
   **建議修正：**使用完整精度排序、截取；僅在輸出時四捨五入，並定義同分時的次排序規則。

其餘重點核對如下：

- **Pivot 與 ATR：**對合法正整數參數，前 `left`／後 `right` 根正確排除；相等高點或低點均不成立，符合嚴格 fractal。ATR 為最近 TR 的簡單平均，符合本次定義。
- **分群漂移：**確實可能。例如 tolerance 為 `1`，價格 `10、11、11.5` 會進入同一群，總跨度為 `1.5`。這符合「與目前平均比較」的指定算法，不能直接判定為實作 bug；但不保證群內兩兩距離小於 tolerance。若 tolerance 意指最大群寬，應限制 `max - min`。目前繪製的 `mean ± tolerance/2` 也不保證包含所有群內 pivot。
- **等於最後收盤價：**[src/core/levels.js:104](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:104) 明確歸類為 resistance。不是隨機邊界問題；建議記錄此規則並補測試。
- **Promise 相容性：**`Promise.resolve(createShape(...))` 可同時處理直接 ID 與 Promise；`evaluateAsync` 亦有設定 `awaitPromise: true`。目前官方 API 為 Promise 回傳，這段包裝合理。[官方 API 文件](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.IChartWidgetApi/)
- **矩形清除：**不能斷言 rectangle 沒有文字能力；官方列有 `showLabel`、`textColor` 等設定。但這不足以保證實際桌面版本會將建立時的 `text` 原樣放在 `getProperties().text`。若沒有，[src/core/levels.js:178](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/levels.js:178) 就會漏清，且例外被吞掉。這是**中度、待連線確認的相容性風險**；建議保存射線及矩形 ID，並驗證建立後屬性及清除結果。[矩形官方文件](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.RectangleLineToolOverrides/)
- **程式風格：**core／MCP／CLI 分層、註冊方式與錯誤包裝大致一致。現有「respects min_touches and max_levels」測試實際只驗證 `min_touches`；排序測試每側僅一個價位，也不足以驗證多價位排序。

**上線前應先修正 CLI 預設值、輸入驗證、字串注入與資料就緒檢查，並實測矩形的建立及清除。**