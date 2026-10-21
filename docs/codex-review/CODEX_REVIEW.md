# Codex 驗證說明：自動支撐/壓力（Auto S/R）功能

請以**唯讀**方式審查以下變更，找出正確性 bug、邊界情況與 TradingView API 使用風險。不要修改檔案，只回報結果。

## 變更範圍（`git status` / `git diff` 可見）
- 新增 `src/core/levels.js`：核心邏輯
  - `atr(bars, period)`：Wilder 之外的簡單平均 True Range
  - `findPivots(bars, left, right)`：嚴格擺動高低點（fractal）
  - `computeLevels(bars, opts)`：純函式。pivot → 依 `tolerance_atr * ATR` 做貪婪分群 → 以近期加權（0.5~1.0）評分 → 依最後收盤價分支撐/壓力 → 每側取分數最高 `max_levels` 個（`min_touches` 過濾），再依價格高到低排序
  - `drawLevels(opts)`：可選切換 symbol / timeframe → 透過 CDP 讀主圖 K 線（上限 2000）→ 先清除舊的自動線 → 以 `horizontal_ray` 畫線（標籤文字以 `AutoSR` 開頭），可選畫 `rectangle` 區間
  - `clearLevels()`：只移除文字以 `AutoSR` 開頭的圖形
- 新增 `src/tools/levels.js`：MCP 工具 `draw_support_resistance`、`draw_sr_clear`
- 新增 `src/cli/commands/levels.js`：CLI `tv levels draw|clear`
- 修改 `src/server.js`、`src/cli/index.js`：註冊上述工具/指令
- 修改 `CLAUDE.md`：工具說明
- 新增 `tests/levels.test.js`：純函式單元測試

## 請重點檢查
1. `computeLevels` 的演算法正確性：pivot 邊界（前 left / 後 right 根不可能成為 pivot）、相等高低點處理、分群使用「目前 cluster 平均」比較是否會造成鏈式漂移、評分與排序。
2. 價位分類：最後收盤價剛好等於價位時的行為。
3. `createShape` 使用 `Promise.resolve(api.createShape(...))` 同時相容回傳 Promise 與直接回傳 id 的 TradingView 版本，是否有問題。
4. `clearLevels` 依 `getShapeById(id).getProperties().text` 判斷；`rectangle` 是否有 `text` 屬性？若沒有，區間矩形會清不掉嗎？
5. 字串注入：`createShape` 用 `JSON.stringify` 組 JS 表達式；`LEVEL_TAG` 為常數。是否還有注入風險？
6. MCP zod schema 與 CLI 參數轉換（`num()`、`zones` boolean，`z.coerce.boolean()` 對字串 "false" 會變 true 的問題）。
7. 與既有程式碼風格是否一致。

## 驗證指令（不需要 TradingView 連線）
```
node --test tests/levels.test.js
node src/cli/index.js levels --help
node src/cli/index.js levels draw --help
node -e "import('./src/tools/levels.js').then(m => console.log(typeof m.registerLevelTools))"
```
已知：`tests/cli.test.js` 的 2 個 `pine check (server compile)` 失敗需要連 TradingView 雲端編譯伺服器，與本次變更無關。

## 實測（以幣安公開 API 的 DOGEUSDT 4H 500 根，離線跑 computeLevels）
```
last close 0.08199, ATR 0.00114, pivots 60
resistance 0.09792  touches=3
resistance 0.09150  touches=5
resistance 0.08394  touches=4
support    0.08015  touches=3
support    0.07068  touches=5
support    0.06904  touches=5
```

## 輸出格式
請用繁體中文回報：每個問題列出 檔案:行號、嚴重度（高/中/低）、問題描述、建議修正。最後給整體結論（可上線 / 需修正）。
