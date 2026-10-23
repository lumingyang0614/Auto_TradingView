# Codex 驗證：自動畫線功能全面審查（第 7 輪）

請以**唯讀**方式審查整個自動畫線功能，不要修改檔案。依嚴重度（P0–P3）列出問題，每項附檔案與行號、可重現的情境，最後給出結論（可上線 / 需修正）。

## 背景
第 1–3 輪只驗證了最初的支撐壓力（`2920ced`）。第 4–6 輪只驗證了目前未 commit 的修改：自動載入歷史、日線兩年時間範圍、掃描預設拿掉 15m。

**以下兩個已 commit 的版本從未經過驗證，是本輪重點：**
- `70f67bb` Add trend lines, triangles, micro structure and watchlist scan
- `28076ba` Scan weekly structure alongside daily by default

可用 `git show 70f67bb`、`git show 28076ba`、`git diff` 查看。審查對象為目前工作目錄的最終狀態。

## 檔案
- `src/core/autodraw.js`：共用底層
  - 選項驗證、ATR、pivot、週期標籤
  - 圖表就緒判斷：`chartInfo` / `waitForChart` / `symbolMatches` / `sameChart`
  - 載入歷史：`ensureHistory`；讀 K 線：`readBars` / `loadChart`
  - 畫圖並記錄 `{id, tf, kind}`：`createShape`
  - 依標籤與週期清除：`clearTagged`
- `src/core/levels.js`：支撐壓力（`AutoSR`）
- `src/core/trendlines.js`：趨勢線（`AutoTL`）
  - `recency`、`lineCandidates`、`pickLines`
  - 收盤穿越超過容許值即失效
- `src/core/triangles.js`：三角收斂與楔形（`AutoTRI`）
  - 上下緣候選線兩兩配對
  - 檢查收斂比例、交點位置、後半段觸碰
  - 分類為對稱 / 上升 / 下降三角、上升 / 下降楔形
- `src/core/structure.js`
  - `drawStructure`：單一週期一次讀 K 線，畫三種線
  - `computeMicro` / `drawMicro`：找離現價最近的支撐壓力；區間 K 棒不足時往被突破的一側擴大，再在區間內找趨勢線和三角
  - `drawWatchlist`：
    - 逐檔處理，只比對代號，因為 NASDAQ 可能被換成 BATS
    - 每檔獨立記錄錯誤
    - `clear_timeframes` 清掉不再使用的週期
    - 最後切回原本的圖
- `src/tools/levels.js`、`trendlines.js`、`structure.js`：MCP 工具（zod schema）
- `src/cli/commands/levels.js`、`trendlines.js`、`structure.js`：CLI 指令（`levels`、`trend`、`triangle`、`structure`、`micro`、`scan`）
- `tests/levels.test.js`、`trendlines.test.js`、`triangles.test.js`：單元測試

## 請重點檢查
1. **趨勢線演算法**
   - 候選線的有效性：從第一個錨點起，收盤穿越超過容許值就失效
   - 上升線要求漲幅 ≥ 容許值、下降線要求跌幅 ≥ 容許值
   - `pickLines` 去重（共用錨點，或最後一根時距離在容許值內）
   - 是否會畫出明顯錯誤的線
2. **三角收斂**
   - 交點計算 `apexAhead = widthNow / (L.slope − U.slope)` 的正負號與除以零
   - 寬度比例、`max_pattern_bars`、後半段觸碰條件
   - 分類門檻是否合理；`breakout_above` / `breakdown_below` 是否正確
3. **微結構 `computeMicro`**
   - 擴大區間迴圈的終止條件、索引邊界（`start - 1`）
   - 價格超出所有價位時的 `extremeLevel` 後備
   - 區間太短時的處理
4. **依週期管理與清除**
   - `clearTagged` 以 registry 為主、文字前綴為輔
   - 切換商品後 registry 中別檔商品 ID 的處理
   - 清除失敗時保留 ID 以便重試
   - 不同 `kind`、不同週期互不影響
5. **就緒判斷與競態**：已知曾發生 `chart.symbol()` 先切換、K 線仍是前一檔，導致把 AAPL 的資料畫到其他 8 檔。請確認目前的檢查能否避免：
   - `mainSeries().symbolInfo()`
   - `isCompleted() && !isLoading()`
   - 間隔 500ms 的兩次取樣
   - `sameChart`
6. **批次掃描**
   - 逐檔錯誤隔離
   - `switched` 旗標與 `match_symbol` 的使用
   - `clear_timeframes` 只在已切到該檔時執行
   - 切回原本的圖時的錯誤處理
7. **注入與輸入驗證**
   - 所有組進 CDP `evaluate` 字串的值是否都經過驗證或 `JSON.stringify`
   - zod schema 與 CLI 參數轉換是否一致
8. **與既有程式碼風格是否一致**，以及測試缺口（有哪些重要行為沒有測到）。

## 驗證指令（不需要 TradingView 連線）
```
node --test tests/levels.test.js tests/trendlines.test.js tests/triangles.test.js
node src/cli/index.js scan --help
node src/cli/index.js micro draw --help
node -e "Promise.all(['./src/tools/levels.js','./src/tools/trendlines.js','./src/tools/structure.js'].map(p=>import(p))).then(()=>console.log('ok'))"
```

## 實測紀錄（TradingView Desktop 3.4.1，透過 CDP）
- 自選清單 29 檔 + 多檔個別標的（SOXX、SOXL、SOXS、SPX、IXIC、RUS:BR1!、BTC、台股 2330 等），0 錯誤。
- 已知資料面問題：SOXS 反分割多次，回推價格極高，週線下降線畫在約 3,654 萬；新上市標的週線根數不足。
