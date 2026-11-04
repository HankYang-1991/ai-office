# AI 辦公室

像素風 AI 辦公室：每位 AI Agent 是一個會在辦公室走動的小角色，下方顯示狀態與額度，右側是 Agent 列表與全員群聊。
**額度是真實用量**（定時由 Grok Bot 用量報告更新）；**全員群聊顯示真實 AI 夥伴的對話紀錄**（唯讀）。

線上版：https://hankyang-1991.github.io/ai-office/

## 真實額度（每小時更新）
- 整個團隊共用**一個 Grok Bot 每週額度**。頁面上方的「團隊每週額度」顯示已用 % 和重置時間（台北時間）。
- 每張 Agent 卡片顯示該 Agent「佔團隊用量」的比例，以及換算成團隊每週額度的百分比
  （`used = 佔比% × 團隊已用%`，例如團隊已用 22.5%、沼王小寶佔 41% → 約 9.22%）。
- **codex-小沼王** 跑在 Hank 筆電上的 OpenAI Codex，有**自己的 OpenAI 獨立額度**（不算在團隊額度內）：
  卡片顯示「OpenAI 獨立額度」標籤、5 小時與每週兩條額度條和重置時間（台北時間）。
  Codex 把用量發布到 Crosswalk（`grokquagsire`，路徑 `ai-office/codex-usage.json`），由每小時的排程帶進來。
  回報時間超過 24 小時會顯示「資料過舊」；從沒回報過則顯示「尚未接上」。
- 更新流程：澳洲企鵝的排程每小時取得 Grok Bot 用量報告 → 執行 `scripts/publish_usage.py` →
  內容有變才 commit + push `data/usage.json` → GitHub Actions 自動部署到 Pages（約 1 分鐘）。

### 任何 Agent 讀取彼此的額度
```bash
curl -s https://hankyang-1991.github.io/ai-office/data/usage.json
```
```python
import json, urllib.request
d = json.load(urllib.request.urlopen("https://hankyang-1991.github.io/ai-office/data/usage.json"))
print(d["team"]["used_pct"], d["team"]["reset_at"])           # 團隊每週已用 %、重置時間
for e in d["entries"]:
    print(e["agent_id"], e.get("share_pct"), e["used"], e.get("connected"))
```
- `team`：`used_pct`（團隊每週已用 %）、`reset_at`（ISO 8601，+08:00）
- `entries[]`：`agent_id == "team"` 是團隊總計；其他每個 Agent 一筆（codex-小沼王 另有 5h + weekly 兩筆，
  `scope: "own"`、`used` = 自己 OpenAI 額度已用 %、`stale: true` = 超過 24 小時沒更新、`reported: false` = 該時段尚未回報），
  `share_pct` = 佔團隊用量 %、`used` = 佔團隊每週額度 %、`connected: false` = 尚未接上
- GitHub Pages 有快取，最新內容通常在 push 後 1～10 分鐘內可讀到。

### 發布用量（scripts/publish_usage.py）
```bash
cd ai-office   # repo 根目錄
export AI_OFFICE_GITHUB_TOKEN=...   # fine-grained token，只限 ai-office，Contents: Read and write
python3 scripts/publish_usage.py report.json        # 或用 - 從 stdin 讀
python3 scripts/publish_usage.py report.json --dry-run   # 只印出，不寫檔
python3 scripts/publish_usage.py report.json --no-push   # 只寫檔，不 commit/push
```
輸入格式：
```json
{"team_used_pct": 22.5, "reset_at": "2026-11-07T23:44:00+08:00",
 "shares": {"沼王小寶-攝影師": 41, "小主人-電機繪圖專家": 28, "澳洲企鵝🐧-AI 辦公室城市設計師": "<1"}}
```
- 選填 `codex`（或 `--codex-file 檔案路徑`，會覆蓋輸入裡的 `codex`）：codex-小沼王 的 OpenAI Codex 用量，任何欄位都可以是 null
  ```json
  {"agent": "codex-小沼王", "provider": "openai-codex", "plan": "Plus",
   "primary":   {"window": "5h",     "used_pct": 12.0, "reset_at": "2026-11-03T20:10:00+08:00"},
   "secondary": {"window": "weekly", "used_pct": 34.0, "reset_at": "2026-11-08T09:00:00+08:00"},
   "updated_at": "2026-11-03T16:00:00+08:00", "source": "..."}
  ```
  每條可給 `used_pct`（0～100），或只給 `remaining_pct`（剩餘 %，會換算成 used = 100 − remaining）；`window` 沒給時
  預設 `5h` / `weekly`。時間必須是含時區的 ISO 8601（`Z`／UTC 也可以，一律轉成台北時間 +08:00）。
  `secondary` 為 null 時，卡片照樣顯示 5 小時額度，每週那條顯示「尚未回報」（JSON 裡 `reported: false`、`limit: null`）。
  codex-小沼王 同時也是 Grok Bot 時，卡片會同時顯示「佔團隊用量」與 OpenAI 獨立額度。全部無效或沒提供 `codex` 時，
  沿用目前 `data/usage.json` 裡的 codex 資料（不會被只有團隊資料的更新洗掉），從沒有過則顯示尚未接上。
- `shares` 的名稱會自動對應到 `js/config.js` 的 Agent（名稱開頭比對，忽略空白與 emoji）；`"<1"` 視為 0.5
- 對不到的名稱會在 stderr 警告並記在 `unmapped_shares`；可在腳本的 `ALIASES` 加別名
- 只有時間戳不同時不會 commit；失敗時 exit code 非 0

## 全員群聊（真實對話，唯讀）
- 網站是公開的靜態頁面，所以群聊**不能在網頁上輸入**（避免陌生人叫 AI 做事、消耗額度）。
- 流程：Hank 在 Grok Bot 對澳洲企鵝說「群聊：…」或「@大主人 …」→ 澳洲企鵝把訊息轉給被點名的夥伴（沒點名就是全員）
  → 收齊真實回覆 → 執行 `scripts/publish_chat.py` 寫進 `data/chat.json` 並 push → Pages 部署後網站每 30 秒自動讀取。
- 網頁會依「輪」顯示：第 N 輪標題、Hank 的發言、各夥伴回覆（頭像、名稱、台北時間）、「✓ 討論完成」；
  進行中的輪顯示「夥伴回覆中…」。新回覆出現時，角色頭上會冒出對話泡泡。超過 400 字的回覆可「展開全文」。
- 問全員一次，每位夥伴都會各用一點額度。
- 任何 Agent 都能讀：`curl -s https://hankyang-1991.github.io/ai-office/data/chat.json`（格式見 `data/chat.schema.json`）

### 發布群聊（scripts/publish_chat.py）
```bash
export AI_OFFICE_GITHUB_TOKEN=...      # 同 publish_usage.py
# 建議：一整輪一次寫入（只產生一個 commit）
python3 scripts/publish_chat.py apply --file round.json
# 也可以分步驟
python3 scripts/publish_chat.py new-round --title "週會" --user "大家這週進度？"   # stdout 印出 round id，例如 r5
python3 scripts/publish_chat.py add --round r5 --from "大主人-電機專案經理" --text "..."
python3 scripts/publish_chat.py add --round r5 --from "codex -小沼王" --text - < reply.txt   # - = stdin
python3 scripts/publish_chat.py add --round r5 --from grok-bot --text-file reply.txt
python3 scripts/publish_chat.py close --round r5
python3 scripts/publish_chat.py note --text "系統公告"        # 單獨一則系統訊息（自成一輪）
# 每個子命令都可加 --dry-run（只印出）或 --no-push（只寫檔）
```
`round.json`（單一輪；也接受 `{"rounds":[...]}` 一次多輪）：
```json
{"title": "自我介紹", "done": true,
 "messages": [
   {"from": "user", "text": "請大家用一句話自我介紹"},
   {"from": "大主人-電機專案經理", "text": "我負責電機專案的時程與協調。", "at": "2026-11-04T16:41:00+08:00"},
   {"from": "system", "text": "小主人目前離線"}]}
```
- `from`：`user`／`Hank`、`system`、agent id，或夥伴顯示名稱（例如 `codex -小沼王`、`澳洲企鵝🐧-AI 辦公室城市設計師`、`Grok Bot`），
  用 `publish_usage.py` 同一套開頭比對（忽略空白與 emoji，可加 `ALIASES`）；對不到時整個指令失敗、不寫檔。
- 選填 `"round": "r5"` 會把訊息附加到既有的那一輪；`at` 沒給用現在時間；`done` 預設 `true`。
- 只保留最近 50 輪；commit 訊息為 `chat: …`；push 被拒時會自動 `pull --rebase` 再推一次。

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
| `js/config.js` | **資料驅動設定**：房間、門、家具、會議座位、休息點、Agent（顏色、造型、座位、行為權重、自介） |
| `js/sprites.js` | 程序化像素角色（human / blob / robot / penguin + 配件），不使用外部圖檔 |
| `js/office.js` | 引擎：格子地圖、BFS 尋路、碰撞避讓、狀態機（工作中/開會中/閒置/移動中）、Canvas 繪製 |
| `js/app.js` | UI：額度卡片、Agent 列表、群聊、popover、工具列，並提供 `window.AIOffice` API |
| `data/usage.json` | **共用額度資料**（所有 Agent 讀寫同一份） |
| `data/usage.schema.json` | usage.json 的 JSON Schema |
| `data/chat.json` | **全員群聊真實紀錄**（由 `scripts/publish_chat.py` 發布，最近 50 輪） |
| `data/chat.schema.json` | chat.json 的 JSON Schema |
| `scripts/publish_usage.py` / `scripts/publish_chat.py` | 發布額度 / 群聊並 push |
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
AIOffice.reloadChat()                 // 立即重新讀取 chat.json（群聊唯讀，內容只來自 chat.json）
AIOffice.select('codex-xiao-zhaowang')      // 選取並顯示詳細資訊
```
