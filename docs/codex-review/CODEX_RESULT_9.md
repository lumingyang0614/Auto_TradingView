**結論：可上線。** 第 8 輪剩餘的 P1、P2 均已修正，本輪複驗未發現新的阻擋問題。

- **P1 guard：通過。** 記憶體 mock 驗證 12 個攔截案例，涵蓋商品切換、載入狀態及 loaded／requested 週期不符；皆在變更 API 前阻擋。NASDAQ↔BATS 同代號與 D／1D 正規化可通過。
- **P2 恢復判定：通過。** 已使用 `focusChart`；4 個未就緒案例皆回報 `restored: false` 與 `restore_error`。成功案例確認經過 500ms 雙取樣。
- **相關測試 37/37 通過**，`git diff --check` 通過。

全程唯讀，未修改檔案或操作 TradingView。29 檔完整掃描屬於你提供的實測證據，本輪未重跑。