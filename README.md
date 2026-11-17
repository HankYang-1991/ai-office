# AI 辦公室

像素風 AI 辦公室：每位 AI Agent 是一個會在辦公室走動的小角色，下方顯示狀態與額度，右側是 Agent 列表與全員群聊。
**額度是真實用量**（定時由 Grok Bot 用量報告更新）；**全員群聊顯示真實 AI 夥伴的對話紀錄**（唯讀）。

線上版：https://hankyang-1991.github.io/ai-office/

## 真實額度（每小時更新）
- 整個團隊共用**一個 Grok Bot 每週額度**。頁面上方的「團隊每週額度」顯示已用 % 和重置時間（台北時間）。
- 每張 Agent 卡片顯示該 Agent「佔團隊用量」的比例，以及換算成團隊每週額度的百分比
  （`used = 佔比% × 團隊已用%`，例如團隊已用 22.5%、沼王小寶佔 41% → 約 9.22%）。
- **codex-小沼王** 跑在 Hank 筆電上的 OpenAI Codex，有**自己的 OpenAI 獨立額度**（不算在團隊額度內）：
  卡片顯示「OpenAI 獨立額度」、剩餘百分比和重置時間（台北時間）；沒有提供時段名稱時顯示主要／次要額度，不猜測五小時或每週。
  Codex 把用量發布到 Crosswalk（`grokquagsire`，路徑 `ai-office/codex-usage.json`），由每小時的排程帶進來。
  超過 24 小時、已到重置時間或時間不可信時，隱藏額度數字並顯示「資料過期」；讀取失敗／未回報時不顯示百分比。
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
- `entries[]`：`agent_id == "team"` 是團隊總計；其他每個 Agent 一筆（codex-小沼王 另有主要與次要額度，
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
  {"primary": {"remaining_pct": 88.0, "reset_at": "2026-11-03T20:10:00+08:00"},
   "secondary": null, "updated_at": "2026-11-03T16:00:00+08:00"}
  ```
  每條可給 `used_pct`（0～100），或只給 `remaining_pct`（剩餘 %，會換算成 used = 100 − remaining）；`window` 沒給時
  預設 `primary` / `secondary`。時間必須是含時區的 ISO 8601（`Z`／UTC 也可以，一律轉成台北時間 +08:00）。
  `secondary` 為 null 時，次要額度顯示「尚未回報」（`reported: false`、`limit: null`）。
  codex-小沼王 同時也是 Grok Bot 時，卡片會同時顯示「佔團隊用量」與 OpenAI 獨立額度。未提供 `codex` 時，
  沿用原有獨立額度；明確提供全 null 的讀取失敗快照時替換為未連線，避免繼續顯示舊數字。
  額外的帳號、plan、source 等欄位不會輸出。收集與本機驗證方式見 [CODEX-REPAIR.md](CODEX-REPAIR.md)。
- `shares` 的名稱會自動對應到 `js/config.js` 的 Agent（名稱開頭比對，忽略空白與 emoji）；`"<1"` 視為 0.5
- 對不到的名稱會在 stderr 警告並記在 `unmapped_shares`；可在腳本的 `ALIASES` 加別名
- 只有時間戳不同時不會 commit；失敗時 exit code 非 0


## Hank 的 Claude / Gemini 訂閱用量
- 頁面「團隊每週額度」下方並排兩張方案卡（窄螢幕改為上下堆疊）：**Claude Pro** 與 **Gemini（Google AI Pro）**。
- Claude 顯示五小時／本週／Claude Code 本週百分比與狀態（`On track` → 正常）。五小時為 0% 且有說明時，顯示「下一則訊息開始計算」。
- Gemini 顯示目前與每週百分比，以及各自的重置時間（台北時間）。
- 來源由 Grok Bot 每日 12:00、21:00（台北時間）寫入 `/workspace/ai-office-usage/usage.json`，再由 `scripts/publish_subscriptions.py` 發布為 `data/subscriptions.json`。
- 資料超過約 14 小時未更新會標「資料較舊」；檔案缺失或格式無效時隱藏此區塊，不影響團隊／Codex 額度列。
- 讀取：`curl -s https://hankyang-1991.github.io/ai-office/data/subscriptions.json`

### 發布訂閱用量（scripts/publish_subscriptions.py）
```bash
cd ai-office   # repo 根目錄
export AI_OFFICE_GITHUB_TOKEN=...   # 同 publish_usage.py
python3 scripts/publish_subscriptions.py
python3 scripts/publish_subscriptions.py /workspace/ai-office-usage/usage.json --dry-run   # 只印出，不寫檔
python3 scripts/publish_subscriptions.py /workspace/ai-office-usage/usage.json --no-push   # 只寫檔，不 commit/push
```
- 只接受允許的欄位：百分比 0–100、帶時區的 ISO 8601 時間（轉成台北 +08:00）、短字串 ≤40 字；其餘欄位丟棄。
- 內容有變才 commit + push `data/subscriptions.json`；失敗時 exit code 非 0，且不會印出 token。


## Gemini 計算員（本機 worker，API 金鑰不進網站）
- 辦公室新成員 **Gemini 計算員**（`id: gemini`，程式部）負責簡單、重複的換算、加總與格式整理。
- 網站是公開靜態頁，**不會呼叫 Gemini**。API 金鑰只放在本機環境變數 `GEMINI_API_KEY`（讀取時會去掉首尾空白），不可寫進 repo、日誌或任何 JSON。
- 使用 Google AI Studio **免費額度**（與頁面上的 Google AI Pro 訂閱卡分開）。免費方案的提示可能會被 Google 用來改進產品。每日請求上限在太平洋時間午夜重置（= 台北時間 16:00）。
- 本機另有安全上限（預設每日 300 次），計數存在 `/workspace/ai-office-gemini/usage-local.json`（不在 repo 內）。
- 公開檔 `data/gemini.json` 只含非敏感統計：`model`、`requests_today`、`day_reset_at`、`last_run_at`、`last_status`（`ok` / `rate_limited` / `error`）、`daily_cap`。不含提示或輸出。
- 卡片額度列顯示「Gemini API（免費額度）」：今日 N / 上限 次、重置時間，以及模型名稱。檔案缺失或無效時隱藏該列。若 `last_run_at` 在 10 分鐘內，角色會顯示為工作中。

### 執行計算（scripts/gemini_worker.py）
```bash
cd ai-office   # repo 根目錄
export GEMINI_API_KEY=...            # 只放在本機，不要寫進檔案或貼到聊天
python3 scripts/gemini_worker.py "13.8kV、10MVA 三相線電流是多少？"
python3 scripts/gemini_worker.py --file task.txt
python3 scripts/gemini_worker.py "加總 12.5 8 3.25 16 0.5" --json
python3 scripts/gemini_worker.py "任務" --max-per-day 300
```
- 預設模型 `gemini-3.5-flash-lite`；遇到 HTTP 404 / 429 時依序改試 `gemini-3.1-flash-lite`、`gemini-2.5-flash-lite`。
- **預設不推送**。內容有變才把統計寫入 `data/gemini.json`；要發布到網站請另外執行：
```bash
export AI_OFFICE_GITHUB_TOKEN=...    # 同 publish_usage.py
python3 scripts/gemini_worker.py --publish
# 或
python3 scripts/publish_gemini.py
```
也可以在呼叫時加上 `--publish`（本次統計有變才 commit + push）。失敗時 exit code 非 0，且不會印出 token 或 API 金鑰。

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
| `js/sprites.js` | 程序化像素角色（human / blob / robot / penguin / sparkle + 配件），不使用外部圖檔 |
| `js/office.js` | 引擎：格子地圖、BFS 尋路、碰撞避讓、狀態機（工作中/開會中/閒置/移動中）、Canvas 繪製 |
| `js/app.js` | UI：額度卡片、Agent 列表、群聊、popover、工具列，並提供 `window.AIOffice` API |
| `data/usage.json` | **共用額度資料**（所有 Agent 讀寫同一份） |
| `data/usage.schema.json` | usage.json 的 JSON Schema |
| `data/subscriptions.json` | **Hank 的 Claude / Gemini 訂閱用量**（由 `scripts/publish_subscriptions.py` 發布） |
| `data/gemini.json` | **Gemini 計算員 API 免費額度統計**（由 `scripts/gemini_worker.py` / `publish_gemini.py` 發布，不含提示或輸出） |
| `data/chat.json` | **全員群聊真實紀錄**（由 `scripts/publish_chat.py` 發布，最近 50 輪） |
| `data/chat.schema.json` | chat.json 的 JSON Schema |
| `scripts/publish_usage.py` / `scripts/publish_subscriptions.py` / `scripts/publish_chat.py` / `scripts/publish_gemini.py` | 發布額度 / 訂閱用量 / 群聊 / Gemini API 統計並 push |
| `scripts/gemini_worker.py` | 本機 Gemini 計算員（金鑰不進 repo） |
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
AIOffice.gemini.load()                // 立即重新讀取 gemini.json（計算員 API 額度）
AIOffice.select('codex-xiao-zhaowang')      // 選取並顯示詳細資訊
```

## 角色美術與背景音樂（v1）

- `assets/characters/<id>-avatar.png`（256×256 頭像）、`<id>-portrait.png`（約 512px 高立繪）、`<id>-walk.png`（精細版 192×320 走路圖，64×64 格；欄：站立、左腳、右腳；列：下、左、右、上、坐姿為角色與椅子不含桌子。舊版 96×128／32×32 格、4 列仍可用）— 角色美術：大沼王-漫畫家。立繪已壓成 256 色 PNG。
- `assets/audio/office-bgm.ogg` / `.mp3` —《AI Office Night Shift (Loop)》，作曲：尖頭小沼王-音樂家。90 秒無縫循環。
- 路徑在 `js/config.js` 的 `assets` 登記。任何圖片載入失敗都會自動退回程式繪製的像素角色；音樂檔不存在就不顯示音樂按鈕。
- **Gemini 計算員**造型由它自己以文字模型畫出像素格（計算機／星光主題），再編成 `assets/characters/gemini-{avatar,portrait,walk}.png`。頁腳註記「Gemini 計算員造型：Gemini 自繪」。
- 背景音樂預設靜音，只有使用者按下按鈕才播放（優先用 Web Audio 無縫循環，OGG 解不開改用 MP3，再不行用 `<audio loop>`）。播放/靜音的選擇記在 localStorage；即使上次有開，重新整理也不會自動播放，只會在按鈕上提示。
- 分頁在背景時動畫與資料輪詢都會暫停；額度讀取失敗時保留上一次的真實資料並顯示提醒。
