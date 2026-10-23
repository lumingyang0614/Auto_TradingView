**結論：需修正。** 本輪以目前工作目錄的最終狀態為準，涵蓋 `70f67bb`、`28076ba` 及未提交修改，全程唯讀。

離線驗證全部通過：**35/35 測試**、兩個 CLI help、三個 MCP 工具模組匯入。另以記憶體內 mock 驗證邊界情境，未連接 TradingView。未發現 P0；以下問題仍需處理。

1. **P1：讀取後至清除／繪圖之間，仍可能把 A 的資料畫到 B**

   位置：[structure.js:38](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/structure.js:38)、[autodraw.js:289](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/autodraw.js:289)。

   `sameChart` 的最後檢查在讀 K 線時；後續 `clearAll`、逐條 `createShape` 都重新使用「目前作用中的圖」，沒有驗證預期商品、週期或圖表實例。

   **重現情境：** AAPL 資料讀取完成後，在清除或兩條線的建立之間，使用者或另一個工具切到 MSFT。後續操作會清除 MSFT 的線，並把 AAPL 計算結果畫到 MSFT，回傳仍標示 AAPL。批次的 `switched` 也只代表先前成功過，不能證明執行 `clear_timeframes` 當下仍在該檔。

   應在每次變更圖形的同一段頁面程式內驗證圖表身分，並協調並行的圖表操作。

2. **P1：未指定 symbol 時，就緒判斷接受「請求商品與已載入商品不同」**

   位置：[autodraw.js:134](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/autodraw.js:134)、[autodraw.js:149](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/autodraw.js:149)。

   `wanted` 為空時，兩個 `symbolMatches` 都直接通過。`sameChart` 只確認兩次取樣沒有改變，沒有確認同一次取樣的 `symbol` 與 `requested` 相符。

   **重現情境：** 不帶 `symbol` 呼叫畫線；mock 持續回報 `requested=NASDAQ:MSFT`、`symbol=NASDAQ:AAPL`、completed=true、loading=false、500 根。實際執行 `loadChart` 仍成功回傳 AAPL 資料。這證明穩定但不一致的狀態不會被拒絕；未宣稱已在 Desktop 重現此旗標組合。

   應在未指定商品時也固定目標，並驗證載入商品與請求商品一致，保留交易所替代的相容性。

3. **P1：切換商品後清除，會丟掉其他商品的 registry**

   位置：[autodraw.js:328](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/autodraw.js:328)。

   registry 重建要求每筆 ID 都存在於**目前商品**的 `getAllShapes()`，因此其他商品的紀錄會被刪除，包括不同 kind、不同週期，以及先前刪除失敗而等待重試的 ID。

   **重現情境：** A 有已登記、但 `getProperties()` 不提供文字的圖形；切到 B 執行清除，再切回 A 清除。mock 結果是 A 的 registry 消失，第二次回報 `removed: 0`，圖形仍存在。反覆掃描可能累積無法辨識的舊線。

   registry 應按商品／圖表保存；目前不可見的 ID 不能直接視為已刪除。

4. **P2：空週期字串會擴大為清除所有週期**

   位置：[autodraw.js:303](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/autodraw.js:303)、[tools/structure.js:46](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/tools/structure.js:46)。

   清除入口沒有使用繪圖入口的非空字串驗證，且 `timeframe ? … : null` 把 `""` 當成省略週期。MCP 的 `z.string()` 允許此值。

   **重現情境：** `draw_tl_clear({timeframe:""})` 同時刪除日線與週線；mock 已重現。批次傳入 `clear_timeframes:[""]`，則會對三種圖形執行全週期清除。

   應只讓真正省略參數代表全部，明確拒絕空字串。

5. **P2：微結構的短區間檢查未包含 pivot 所需根數**

   位置：[structure.js:154](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/structure.js:154)。

   目前只檢查 `min_range_bars`；通過後，內層演算法仍可能因不足 `pivot_left + pivot_right + 1` 根而拋錯，整個微結構結果隨之失敗。

   **重現情境：** 100 根有效、固定 OHLC 的 K 線，設定 `pivot_left=20`、`pivot_right=20`、`recent_bars=30`、`min_range_bars=30`。實際得到 `Need at least 41 bars, got 30`，而非保留支撐壓力並略過型態搜尋。

   短區間門檻應同時考慮 pivot 所需長度。

6. **P2：只清除、不繪圖的批次指令會成功但完全沒做事**

   位置：[structure.js:235](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/structure.js:235)。

   `switched` 只在一次完整繪圖成功後設為 true。兩種繪圖週期都跳過時，不會切換商品，也不會清除。

   **重現情境：** `scan --symbols AAPL --timeframes none --micro none --clear 240`。mock 回傳 `success:true`、`with_errors:0`，但沒有呼叫任何清除操作。

   應支援先切換並驗證商品後清除，或明確拒絕此參數組合。

7. **P2：恢復原圖失敗被吞掉，結果仍宣告成功**

   位置：[structure.js:247](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/core/structure.js:247)。

   恢復區塊使用空 `catch`；也未檢查 `setSymbol`／`setTimeframe` 回傳的 `chart_ready`。

   **重現情境：** 掃描後恢復原商品時讓 `setSymbol` 拋錯。mock 仍得到 `success:true`、`with_errors:0`；使用者無法知道圖表留在其他標的，且週期恢復不會繼續執行。

   應在結果中回報恢復失敗，並驗證最終圖表狀態。

8. **P3：MCP 伺服器操作指南仍描述舊掃描週期**

   位置：[server.js:71](E:/AutoTradingView/Coocolab-Tradingview-MCP/src/server.js:71)。

   伺服器 instructions 仍寫「4H + 1D、15m micro」，實際預設已是「1D + 1W、1H micro」。

   **重現情境：** MCP 客戶端依伺服器 instructions 說明預設行為，會提供錯誤週期資訊。CLI help 與工具 schema 的描述則已更新。

其他重點的審查結果：

- **趨勢線：** 從第一錨點起檢查收盤穿越、漲跌幅至少 tolerance、共用錨點及末根價格距離去重，實作符合需求。
- **三角：** 交點公式正負號正確。正寬度及收斂比例條件會排除平行線；非正交點及過遠交點也會被拒絕。後半段觸碰、分類方向、上下突破價位沒有發現反置。`max_pattern_bars` 使用索引差，與包含首尾的根數相差一根，屬需明確定義的邊界語義。
- **微結構：** 擴大迴圈索引單調前進，且在讀取 `start - 1` 前處理 `start === 0`，未發現無限迴圈或負索引問題。收盤恰為歷史極值時沒有該側後備價位，是目前刻意採用的嚴格條件。
- **原先跨商品資料問題：** 明確傳入 `symbol`／`match_symbol` 的循序掃描，已有主序列商品、完成旗標、500ms 雙取樣及讀取一致性防護；但不能涵蓋上述第 1、2 項。
- **注入與風格：** 審查範圍內的動態商品、週期、文字、圖形參數均經 JSON 序列化；插入的根數來自已驗證選項，未發現直接 CDP 注入入口。純計算與 render 分離、CLI 薄封裝及 MCP 錯誤包裝與既有風格一致。Schema 部分上限比 core 寬鬆，但 core 會再拒絕。

現有測試最需要補的是：跨商品 registry／清除重試、讀取後切圖、無 symbol 的不一致狀態、批次清除與恢復失敗，以及微結構 pivot 長度門檻。演算法另缺下降楔形、第一與第二錨點之間曾突破、交點與觸碰門檻的精確邊界案例。

**最終判定：需修正，優先處理三項 P1。** 目前實測的零錯誤與 35 個通過測試，尚不足以覆蓋上述清除與競態情境。