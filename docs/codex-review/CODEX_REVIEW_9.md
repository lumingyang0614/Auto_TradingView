# Codex 驗證：第 8 輪剩餘問題複驗（第 9 輪）

請以**唯讀**方式複驗目前工作目錄。上一輪結果見 `docs/codex-review/CODEX_RESULT_8.md`。不要修改檔案，最後給出結論（可上線 / 需修正）。

## 修正
1. **P1 切換過渡期 guard 放行**：`autodraw.js` 的 `chartGuard` 在頁面內同時要求：
   - 主序列 loaded symbol === 預期
   - `chartApi.symbol()` 的代號 === 預期代號（只比代號，保留 NASDAQ↔BATS 替代）
   - `isCompleted() && !isLoading()`
   - 有預期週期時，`ms.interval()` 與 `chartApi.resolution()` 正規化後都等於預期
2. **P2 恢復判定**：`drawWatchlist` 恢復原圖改用 `focusChart({ symbol, match_symbol: ticker, timeframe })`。它與繪圖前相同，會等待主序列就緒，並驗證 loaded/requested 一致、週期相符、500ms 雙取樣。失敗（逾時）就 `restored: false` 並附上 `restore_error`。

## 實測
- `scan --symbols NASDAQ:SOXX,NASDAQ:NVDA`：0 錯誤，`restored: true`。NVDA 自動線 17 條無重複，registry 依商品分開（SOXX 16、NVDA 17）。
- guard：圖在 NVDA 時，預期 AAPL 的 `createShape` / `clearTagged` 都被擋下，圖形數不變。
  - 錯誤訊息顯示 loaded `NASDAQ:NVDA`、requested `BATS:NVDA`，證實兩者交易所可以不同，所以必須只比代號。
- 37/37 測試通過。

## 追加實測（本輪）
- 完整自選清單掃描（29 檔，1D 兩年 + 1W + 1H 微觀）：0 錯誤，`restored: true`。
