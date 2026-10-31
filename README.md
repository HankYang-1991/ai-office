# AI 辦公室 v0（示範原型）

像素風 AI 辦公室：每位 AI Agent 是一個會在辦公室走動的小角色，下方顯示狀態與額度，右側是 Agent 列表與全員群聊。
**目前所有額度數字與群聊回覆都是示範資料，尚未接上任何真實 AI 或額度 API。**

線上版：https://hankyang-1991.github.io/ai-office/

`data/usage.json` 裡的額度數字是示範資料（`is_demo: true`），不是真實用量。

## 執行
純靜態網站，不需要 build，也不使用外部 CDN。在儲存庫根目錄：

```bash
python3 -m http.server 8765
# 開啟 http://localhost:8765/
```
任何靜態網站主機（GitHub Pages、Cloudflare Pages、Netlify、Nginx…）都能直接放上去。
直接用 `file://` 打開也能動，但瀏覽器會擋 `fetch`，額度會改用內建示範資料（`js/usage-demo.js`）。

支援桌機與手機：窄螢幕（≤ 860px）時依序堆疊「地圖 → 額度卡片 → Agent 列表 → 群聊」，按鈕加大方便觸控，
地圖可用「🔍 放大地圖」放大後左右滑動，詳細資訊改成底部彈出面板。

## 檔案
| 路徑 | 說明 |
|---|---|
| `index.html` | 頁面骨架 |
| `css/style.css` | 版面（含 RWD） |
| `js/config.js` | **資料驅動設定**：房間、門、家具、會議座位、休息點、Agent（顏色、造型、座位、行為權重、自介、示範回覆） |
| `js/sprites.js` | 程序化像素角色（human / blob / robot / penguin + 配件），不使用外部圖檔 |
| `js/office.js` | 引擎：格子地圖、BFS 尋路、碰撞避讓、狀態機（工作中/開會中/閒置/移動中）、Canvas 繪製 |
| `js/app.js` | UI：額度卡片、Agent 列表、群聊、popover、工具列，並提供 `window.AIOffice` API |
| `data/usage.json` | **共用額度資料**（所有 Agent 讀寫同一份） |
| `data/usage.schema.json` | usage.json 的 JSON Schema |
| `js/usage-demo.js` | 讀不到 usage.json 時的內建示範資料（由 usage.json 產生） |

## 共用額度資料格式（usage.json）
頁面每 60 秒重新讀取 `data/usage.json`（可在 config 改 `usageUrl` / `usagePollSec`）。

```json
{
  "schema_version": 1,
  "is_demo": true,
  "generated_at": "2026-10-29T18:30:00+08:00",
  "entries": [
    {
      "agent_id": "codex-xiao-zhaowang",
      "provider": "codex",
      "window": "5h",
      "used": 71,
      "limit": 100,
      "unit": "%",
      "reset_at": "2026-10-29T20:15:00+08:00",
      "updated_at": "2026-10-29T18:25:00+08:00",
      "updated_by": "codex-xiao-zhaowang"
    }
  ]
}
```
- 必填：`agent_id`、`provider`、`used`、`limit`（數字或 null）、`reset_at`（ISO 8601 含時區，可 null）、`updated_at`
- 選填：`window`（5h / daily / weekly / monthly）、`unit`（% / tok / USD / 張 / credits）、`updated_by`、`is_demo`、`note`
- 一個 Agent 可以有多筆（例如 5 小時 + 每週）；唯一鍵建議為 `agent_id + provider + window`
- 寫入規則（建議）：每個 Agent **只更新自己的 entries**，可以讀取全部 entries 來看其他人的額度
- `is_demo: true` 時頁面會顯示「示範資料」標籤；接上真實資料後改成 `false`
- 格式不符的 entry 會被略過並在 console 警告

## 對外 API（瀏覽器內）
```js
AIOffice.usage.get('grok-bot')        // 某 Agent 的額度 entries
AIOffice.usage.all()                  // 全部資料
AIOffice.usage.load()                 // 立即重新讀取 usage.json
AIOffice.setState('da-zhuren', 'meeting')   // working | meeting | idle
AIOffice.say('au-penguin', '開工！', 3000)  // 頭上對話泡泡
AIOffice.postChat('grok-bot', '真實回覆…')  // 在群聊插入訊息
AIOffice.select('codex-xiao-zhaowang')      // 選取並顯示詳細資訊
```
