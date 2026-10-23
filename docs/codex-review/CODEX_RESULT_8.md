**結論：需修正。** 已唯讀複驗 `70f67bb`、`28076ba` 與目前 diff，未修改檔案。第 1、7 項尚未完整修正，其餘六項通過；未發現其他可確認的新回歸。

| 項目 | 複驗結果 |
|---|---|
| 1. 讀取後切圖 | **部分修正**：已切換完成會攔截，但切換過渡期仍可通過 |
| 2. 未指定商品的一致性 | **已修正**：ready 要求 loaded/requested ticker 相同 |
| 3. 跨商品 registry 遺失 | **已修正**：其他商品紀錄保留；mock 驗證 A→B 清除→A 清除通過 |
| 4. 空週期字串 | **已修正**：core 拒絕空白字串，MCP schema 同步限制 |
| 5. micro pivot 長度 | **已修正**：擴大區間與略過搜尋都使用完整 pivot 視窗門檻 |
| 6. 只清除的批次 | **已修正**：先 focusChart，再依商品驗證清除 |
| 7. 恢復原圖 | **部分修正**：例外會回報，但仍可能誤報 `restored: true` |
| 8. instructions | **已修正**：與目前掃描預設一致 |

仍需處理的問題：

1. **P1：guard 沒有攔截「已請求切圖、主序列仍是舊商品」**

   位置：[autodraw.js:134](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/autodraw.js:134)。

   guard 只檢查主序列的 loaded symbol 與 interval，未檢查圖表目前請求的商品、週期及載入狀態。因此，讀完 AAPL 後切向 MSFT，若主序列仍回報 AAPL，guard 會放行。

   **記憶體 mock 已重現：** `loaded=AAPL`、`requested=MSFT`、`loading=true` 時，`createShape` 與 `clearTagged` 都繼續呼叫變更 API。這證明過渡狀態未被攔截；未宣稱已在 Desktop 重現錯畫。

   建議在同一段頁面程式內，同時驗證 requested/loaded ticker、預期週期及完成／載入旗標。這仍符合「每次變更前驗證」的既定方案，不需要引入並行協調。

2. **P2：恢復判定檢查的是請求值，無法證明主序列已恢復**

   位置：[structure.js:254](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/structure.js:254)、[chart.js:9](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/chart.js:9)。

   `getState()` 讀取 `chart.symbol()`／`chart.resolution()`；這些值可在實際資料載入前更新。恢復流程仍忽略 setter 回傳的 `chart_ready`，所以逾時或尚未載入完成，也可能宣告恢復成功。

   **記憶體 mock 已重現：** 兩個 setter 都回傳 `chart_ready:false`，只要 `getState()` 回傳原本的請求值，結果仍是 `restored:true`，且沒有 `restore_error`。

   建議恢復後使用與 `focusChart` 同等的主序列就緒驗證，保留交易所替代相容性；驗證失敗就回報 `restored:false`。

驗證結果：**37/37 測試通過**、三個 MCP 工具模組匯入與清除 schema 檢查通過、`git diff --check` 通過。以上額外重現皆在記憶體內完成，未連接或操作 TradingView Desktop。