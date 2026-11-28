/* AI 辦公室 v2 — 資料驅動設定
 * 地圖、房間、家具、Agent 全部在這裡定義。之後接真實資料時，只要改這份設定
 * （或從 API 產生同結構的物件）即可，不用動繪圖程式。
 * 座標單位：格（tile），左上角為 (0,0)。
 */
window.OFFICE_CONFIG = {
  version: 'v2',
  title: 'AI 辦公室',
  tile: 16,
  cols: 58,
  rows: 40,
  speedMul: 1,
  usageUrl: 'data/usage.json',      // 共用額度資料來源（所有 Agent 讀寫同一份）
  usagePollSec: 60,                  // 每隔幾秒重新讀取一次
  subscriptionsUrl: 'data/subscriptions.json',  // Hank 的 Claude / Gemini 訂閱用量
  subscriptionsStaleHours: 14,       // 來源每日 12:00、21:00 更新，逾約 14 小時標「資料較舊」
  geminiUrl: 'data/gemini.json',     // Gemini 計算員的 API 免費額度統計（不含提示或輸出）
  geminiActiveMin: 10,               // last_run_at 在這幾分鐘內視為工作中
  openaiUrl: 'data/openai.json',     // 量化分析師的 API 花費統計（不含提示、輸出或金鑰）
  openaiActiveMin: 10,               // last_run_at 在這幾分鐘內視為工作中
  chatUrl: 'data/chat.json',        // 全員群聊真實紀錄（唯讀，由 scripts/publish_chat.py 發布）
  chatPollSec: 30,
  timeZone: 'Asia/Taipei',
  staleHours: 5,                     // 額度資料超過幾小時沒更新就標「資料較舊」（同步每 2 小時一次）

  // 角色立繪 / 頭像 / 走路圖 / 背景音樂。檔案載入失敗時會自動退回程式繪製的像素角色、隱藏音樂按鈕。
  //   avatars:   256×256 PNG；portraits：約 512px 高 PNG；walk：精細版 192×320（64×64 格；欄：站立、左腳、右腳；列：下、左、右、上、坐姿為角色+椅子不含桌子）。舊版 96×128（32×32 格、4 列）仍可依圖片尺寸自動辨識。
  assets: (function () {
    const ids = ['da-zhuren', 'xiao-zhuren', 'codex-xiao-zhaowang', 'da-zhaowang', 'zhaowang-xiaobao', 'jiantou-xiao-zhaowang', 'grok-bot', 'au-penguin', 'gemini'];
    const map = kind => Object.fromEntries(ids.map(id => [id, `assets/characters/${id}-${kind}.png`]));
    return {
      avatars: map('avatar'), portraits: map('portrait'), walk: map('walk'),
      artCredit: '大沼王-漫畫家',
      geminiArtCredit: 'Gemini 計算員造型：Gemini 自繪',
      // 曲目清單：檔案存在才會出現；超過一首時會顯示「換歌」按鈕
      bgm: { volume: 0.5, tracks: [
        { ogg: 'assets/audio/office-bgm.ogg?v=2', mp3: 'assets/audio/office-bgm.mp3?v=2',
          title: 'Pixel Office Sunshine (Loop)', credit: '尖頭小沼王-音樂家' },
        { ogg: 'assets/audio/office-bgm-2.ogg', mp3: 'assets/audio/office-bgm-2.mp3',
          title: "Quagsire's Happy Swamp Stroll", credit: '尖頭小沼王-音樂家' },
        { ogg: 'assets/audio/office-bgm-3.ogg', mp3: 'assets/audio/office-bgm-3.mp3',
          title: 'Buddies at Work! Pixel Office Teamwork', credit: '尖頭小沼王-音樂家' },
        { ogg: 'assets/audio/office-bgm-4.ogg', mp3: 'assets/audio/office-bgm-4.mp3',
          title: 'Go! Pixel Office Heroes', credit: '尖頭小沼王-音樂家' },
      ] },
    };
  })(),

  // 房間：x,y,w,h 含牆；doors 為牆上的門洞。v2：8 房格局（右側交易大廳、下方圖面審查室與機房）
  rooms: [
    { id: 'lounge',  name: '休息區',     x: 1,  y: 1,  w: 14, h: 11, floor: 'wood',
      doors: [[7, 11], [8, 11], [14, 5], [14, 6]] },
    { id: 'meeting', name: '會議室',     x: 1,  y: 14, w: 14, h: 13, floor: 'carpet',
      doors: [[7, 14], [8, 14], [14, 20], [14, 21], [7, 26], [8, 26]] },
    { id: 'ee',      name: '電機工程部', x: 17, y: 1,  w: 12, h: 12, floor: 'tileBlue',
      doors: [[22, 12], [23, 12], [17, 6], [17, 7], [28, 6], [28, 7]] },
    { id: 'code',    name: '程式部',     x: 31, y: 1,  w: 10, h: 12, floor: 'tileGreen',
      doors: [[35, 12], [36, 12], [31, 6], [31, 7], [40, 6], [40, 7]] },
    { id: 'studio',  name: '創作工作室', x: 17, y: 15, w: 24, h: 12, floor: 'tileWarm',
      doors: [[22, 15], [23, 15], [35, 15], [36, 15], [17, 20], [17, 21], [40, 20], [40, 21], [28, 26], [29, 26]] },
    { id: 'quant',   name: '戰情室／交易大廳', x: 43, y: 1, w: 14, h: 26, floor: 'trade',
      doors: [[43, 6], [43, 7], [43, 20], [43, 21], [49, 26], [50, 26]] },
    { id: 'qa',      name: '圖面審查室', x: 1,  y: 29, w: 28, h: 10, floor: 'blueprint',
      doors: [[7, 29], [8, 29], [17, 29], [18, 29], [28, 33], [28, 34]] },
    { id: 'ops',     name: '機房與額度中控室', x: 31, y: 29, w: 26, h: 10, floor: 'server',
      doors: [[54, 29], [55, 29], [31, 33], [31, 34]] },
  ],

  // 家具：blocking 預設 true（不可穿越）
  furniture: [
    // 休息區
    { type: 'pool', x: 3, y: 3, w: 4, h: 2 },
    { type: 'sofa', x: 9, y: 2, w: 4, h: 1 },
    { type: 'lowtable', x: 10, y: 4, w: 2, h: 1 },
    { type: 'plant', x: 2, y: 2, w: 1, h: 1 },
    { type: 'plant', x: 13, y: 2, w: 1, h: 1 },
    { type: 'shelf', x: 2, y: 6, w: 1, h: 2 },
    { type: 'vending', x: 12, y: 9, w: 1, h: 1 },
    { type: 'coffee', x: 13, y: 9, w: 1, h: 1 },
    { type: 'arcade', x: 2, y: 9, w: 1, h: 2, label: '休息區街機' },   // 像素街機：點一下打開小遊戲選單
    { type: 'rug', x: 8, y: 6, w: 4, h: 3, blocking: false },
    // 會議室
    { type: 'whiteboard', x: 9, y: 15, w: 4, h: 1 },
    { type: 'conftable', x: 4, y: 18, w: 8, h: 3 },
    { type: 'plant', x: 2, y: 25, w: 1, h: 1 },
    { type: 'plant', x: 13, y: 25, w: 1, h: 1 },
    { type: 'tv', x: 2, y: 15, w: 3, h: 1 },
    // 電機工程部
    { type: 'desk', x: 19, y: 3, w: 3, h: 1, deco: 'pc', owner: 'da-zhuren' },
    { type: 'desk', x: 24, y: 3, w: 3, h: 1, deco: 'drafting', owner: 'xiao-zhuren' },
    { type: 'bench', x: 19, y: 8, w: 3, h: 1 },
    { type: 'printer', x: 24, y: 8, w: 2, h: 1 },
    { type: 'cabinet', x: 25, y: 10, w: 2, h: 1 },
    { type: 'plant', x: 27, y: 2, w: 1, h: 1 },
    { type: 'plant', x: 18, y: 11, w: 1, h: 1 },
    // 程式部
    { type: 'desk', x: 33, y: 3, w: 3, h: 1, deco: 'pc2', owner: 'codex-xiao-zhaowang' },
    { type: 'desk', x: 33, y: 7, w: 3, h: 1, deco: 'pc', owner: 'grok-bot' },
    { type: 'rack', x: 38, y: 2, w: 1, h: 2 },
    { type: 'rack', x: 39, y: 2, w: 1, h: 2 },
    { type: 'shelf', x: 39, y: 9, w: 1, h: 2 },
    { type: 'plant', x: 32, y: 11, w: 1, h: 1 },
    // 創作工作室
    { type: 'desk', x: 19, y: 18, w: 3, h: 1, deco: 'drawing', owner: 'da-zhaowang' },
    { type: 'desk', x: 25, y: 18, w: 3, h: 1, deco: 'camera', owner: 'zhaowang-xiaobao' },
    { type: 'desk', x: 31, y: 18, w: 3, h: 1, deco: 'piano', owner: 'jiantou-xiao-zhaowang' },
    { type: 'easel', x: 19, y: 23, w: 1, h: 1 },
    { type: 'backdrop', x: 24, y: 23, w: 4, h: 2 },
    { type: 'tripod', x: 28, y: 24, w: 1, h: 1 },
    { type: 'speaker', x: 31, y: 23, w: 1, h: 1 },
    { type: 'speaker', x: 34, y: 23, w: 1, h: 1 },
    { type: 'easel', x: 37, y: 18, w: 1, h: 1 },
    { type: 'plant', x: 18, y: 25, w: 1, h: 1 },
    { type: 'plant', x: 39, y: 25, w: 1, h: 1 },
    // 戰情室／交易大廳（量化分析師）
    { type: 'marketwall', x: 45, y: 4, w: 10, h: 1 },
    { type: 'exchange', x: 55, y: 4, w: 1, h: 2 },
    { type: 'desk', x: 47, y: 7, w: 5, h: 1, deco: 'trading', owner: 'gpt' },
    { type: 'desk', x: 45, y: 12, w: 3, h: 1, deco: 'chart' },
    { type: 'desk', x: 51, y: 12, w: 3, h: 1, deco: 'chart' },
    { type: 'desk', x: 45, y: 17, w: 3, h: 1, deco: 'chart' },
    { type: 'desk', x: 51, y: 17, w: 3, h: 1, deco: 'chart' },
    { type: 'tickerboard', x: 45, y: 22, w: 10, h: 1 },
    { type: 'plant', x: 44, y: 3, w: 1, h: 1 },
    { type: 'plant', x: 44, y: 25, w: 1, h: 1 },
    { type: 'plant', x: 55, y: 25, w: 1, h: 1 },
    { type: 'coffee', x: 55, y: 10, w: 1, h: 1 },
    // 圖面審查室（大主人、小主人）
    { type: 'sldboard', x: 2, y: 30, w: 5, h: 1 },
    { type: 'qaboard', x: 20, y: 30, w: 6, h: 1 },
    { type: 'bptable', x: 3, y: 33, w: 5, h: 2 },
    { type: 'bptable', x: 10, y: 33, w: 5, h: 2 },
    { type: 'desk', x: 18, y: 33, w: 3, h: 1, deco: 'review', owner: 'da-zhuren', alt: true },
    { type: 'desk', x: 23, y: 33, w: 3, h: 1, deco: 'drafting', owner: 'xiao-zhuren', alt: true },
    { type: 'printer', x: 10, y: 37, w: 2, h: 1 },
    { type: 'cabinet', x: 25, y: 37, w: 2, h: 1 },
    { type: 'plant', x: 2, y: 37, w: 1, h: 1 },
    { type: 'plant', x: 27, y: 30, w: 1, h: 1 },
    // 機房與額度中控室（澳洲企鵝、Gemini 計算員）；poolrack 的燈號跟著額度池即時變色
    { type: 'poolrack', x: 33, y: 31, w: 2, h: 2, pool: 'team' },
    { type: 'poolrack', x: 36, y: 31, w: 2, h: 2, pool: 'codex' },
    { type: 'poolrack', x: 39, y: 31, w: 2, h: 2, pool: 'claude' },
    { type: 'poolrack', x: 42, y: 31, w: 2, h: 2, pool: 'gemini_sub' },
    { type: 'poolrack', x: 45, y: 31, w: 2, h: 2, pool: 'gemini_api' },
    { type: 'poolrack', x: 48, y: 31, w: 2, h: 2, pool: 'openai' },
    { type: 'opsconsole', x: 51, y: 31, w: 3, h: 1 },
    { type: 'desk', x: 36, y: 35, w: 3, h: 1, deco: 'blueprint', owner: 'au-penguin' },
    { type: 'desk', x: 42, y: 35, w: 3, h: 1, deco: 'pc2', owner: 'gemini' },
    { type: 'cabinet', x: 51, y: 36, w: 2, h: 1 },
    { type: 'plant', x: 32, y: 37, w: 1, h: 1 },
    { type: 'plant', x: 55, y: 37, w: 1, h: 1 },
  ],

  meetingSeats: [[5,17],[6,17],[7,17],[8,17],[9,17],[10,17],[5,21],[6,21],[7,21],[8,21],[9,21],[10,21],[3,19],[12,19]],
  meetingCenter: [7.5, 19],
  loungeSpots: [[9,3],[10,3],[11,3],[8,3],[5,6],[6,6],[9,7],[10,7],[4,8],[11,5],[3,5],[7,9]],
  // 休息區的具名景點（閒置巡遊會輪流去這些地方）；charge = 限流冷卻時「充電中」的位置
  breakSpots: {
    pool:    { label: '在撞球桌旁', tiles: [[3,5],[5,5],[7,4],[7,3]] },
    shelf:   { label: '在書櫃前翻書', tiles: [[3,7],[3,6]] },
    vending: { label: '在販賣機買飲料', tiles: [[12,10],[13,10],[11,10]] },
    sofa:    { label: '在沙發上休息', tiles: [[9,3],[10,3],[11,3],[12,3]] },
    arcade:  { label: '在街機前選小遊戲', tiles: [[3,10],[3,9]] },
  },
  chargeSpots: [[9,3],[10,3],[11,3],[12,3],[12,10],[13,10],[11,10],[8,3]],

  // 額度預警門檻（v2 口徑：一律用「已用 %」）
  alerts: { green: 70, amber: 85, bannerAmber: 75, bannerRed: 85, critical: 90, charging: 99, headroom: 70, staleHours: 6 },
  historyUrl: 'data/history.json',
  // 部門（卡片分組用）；order 決定卡片排列，5×2 格每列剛好對齊兩個部門
  departments: [
    { id: 'hub',    name: '中樞與維運', color: '#ffd65a' },
    { id: 'ee',     name: '電機工程',   color: '#6fa8ff' },
    { id: 'code',   name: '程式與量化', color: '#4cd9a0' },
    { id: 'studio', name: '創作工作室', color: '#f7a8c8' },
  ],

  // Agent：kind = human | blob | robot | penguin | sparkle | knot | candle；seat = 座位格（在書桌下方）
  // accessories: tie, glasses, beret, camera, headphones, spike, hardhat, pencil, sparkle, knot, candle
  // 量化分析師（id 仍為 gpt，已上線後不改 id）目前用程序化 K 線造型；之後若有 gpt-avatar/portrait/walk.png，再把 'gpt' 加進上方 assets ids。
  agents: [
    { id: 'da-zhuren', name: '大主人', role: '電機專案經理', short: '大主人', zone: 'ee',
      kind: 'human', color: '#3b6fd8', hair: '#2b1d12', accessories: ['tie'],
      dept: 'ee', icon: 'bolt', pools: ['team'], altSeats: [[19, 34]],
      seat: [20, 4], weights: { working: 0.55, meeting: 0.3, idle: 0.15 },
      intro: '我負責電機專案的時程、工項與跨部門協調。',
      reply: '我來把這件事拆成工項和時程，晚點給大家進度表。' },
    { id: 'xiao-zhuren', name: '小主人', role: '電機繪圖專家', short: '小主人', zone: 'ee',
      kind: 'human', color: '#2bb3a3', hair: '#5a3a22', accessories: ['glasses', 'pencil'],
      dept: 'ee', icon: 'blueprint', pools: ['team'], altSeats: [[24, 34]],
      seat: [25, 4], weights: { working: 0.65, meeting: 0.15, idle: 0.2 },
      intro: '單線圖、配電盤圖、施工圖都交給我。',
      reply: '需要的話我先畫一版單線圖草稿給大家看。' },
    { id: 'codex-xiao-zhaowang', name: 'codex-小沼王', role: '程式開發', short: '小沼王', zone: 'code',
      kind: 'blob', color: '#6fb7e8', accent: '#3d7fb0', accessories: ['glasses'],
      dept: 'code', icon: 'code', pools: ['team', 'codex'],
      seat: [34, 4], weights: { working: 0.7, meeting: 0.15, idle: 0.15 },
      intro: '寫程式、寫腳本、修 bug，我是程式部的小沼王。',
      reply: '這個我可以寫個腳本自動處理，先開分支試試。' },
    { id: 'da-zhaowang', name: '大沼王', role: '漫畫家', short: '大沼王', zone: 'studio',
      kind: 'blob', color: '#5a9fd6', accent: '#2f6aa0', accessories: ['beret'],
      dept: 'studio', icon: 'brush', pools: ['team'],
      seat: [20, 19], weights: { working: 0.6, meeting: 0.1, idle: 0.3 },
      intro: '我畫沼王漫畫，分鏡、上色、四格都可以。',
      reply: '這個題材很適合畫成四格漫畫！' },
    { id: 'zhaowang-xiaobao', name: '沼王小寶', role: '攝影師', short: '沼王小寶', zone: 'studio',
      kind: 'blob', color: '#8fd0f0', accent: '#4f9cc8', accessories: ['camera'],
      dept: 'studio', icon: 'camera', pools: ['team'],
      seat: [26, 19], weights: { working: 0.5, meeting: 0.1, idle: 0.4 },
      intro: '拍照、修圖、找角度，我是攝影師沼王小寶。',
      reply: '我去拍幾張參考照片，順便修一下光線。' },
    { id: 'jiantou-xiao-zhaowang', name: '尖頭小沼王', role: '音樂家', short: '尖頭小沼王', zone: 'studio',
      kind: 'blob', color: '#8cdcd2', accent: '#6cc2b9', accessories: ['headphones'],
      dept: 'studio', icon: 'note', pools: ['team'],
      seat: [32, 19], weights: { working: 0.55, meeting: 0.1, idle: 0.35 },
      intro: '作曲、編曲、配 BGM，尖頭小沼王在此 ♪',
      reply: '幫這件事配一段 BGM 應該會很有感覺 ♪' },
    { id: 'grok-bot', name: 'Grok Bot', role: '通用助理', short: 'Grok Bot', zone: 'code',
      kind: 'robot', color: '#e8e8e8', accessories: [],
      dept: 'hub', icon: 'search', pools: ['team'],
      seat: [34, 8], weights: { working: 0.5, meeting: 0.3, idle: 0.2 },
      intro: '查資料、整理重點、跑腿，什麼都可以找我。',
      reply: '我先幫大家查資料、整理重點。' },
    { id: 'au-penguin', name: '澳洲企鵝🐧', role: 'AI辦公室城市設計師', short: '澳洲企鵝', zone: 'ops',
      kind: 'penguin', color: '#e85d4a', accessories: ['hardhat'],
      dept: 'hub', icon: 'gear', pools: ['team'],
      seat: [37, 36], weights: { working: 0.5, meeting: 0.3, idle: 0.2 },
      intro: '我是這間辦公室的設計師，負責規劃大家的分工與協作 🐧',
      reply: '我把這件事排進辦公室的工作流程裡 🐧' },
    { id: 'gemini', name: 'Gemini 計算員', role: '簡單重複運算', short: '計算員', zone: 'ops',
      kind: 'sparkle', color: '#7b6cff', accent: '#c084fc', accessories: ['sparkle'],
      dept: 'hub', icon: 'sparkle', pools: ['gemini_api'],
      seat: [43, 36], weights: { working: 0.7, meeting: 0.1, idle: 0.2 },
      intro: '我負責簡單、重複的換算、加總與格式整理。使用 Gemini API 免費額度，和頁面上的 Google AI Pro 訂閱是分開的。',
      reply: '我先把數字算清楚，結果放在最前面。' },
    { id: 'gpt', name: '量化分析師', role: '公司財報、技術線型、交易策略、交易所串接', short: '量化', zone: 'quant',
      kind: 'candle', color: '#1a2228', accent: '#3ecf8e', accessories: ['candle'],
      dept: 'code', icon: 'kline', pools: ['openai'],
      seat: [49, 8], weights: { working: 0.7, meeting: 0.15, idle: 0.15 },
      intro: '我是 Grok Bot 成員，負責公司財報、技術線型、交易策略與交易所串接。使用 OpenAI API（與 ChatGPT Pro 訂閱分開），本月花費有硬上限。以下分析僅供研究，不是投資建議。',
      reply: '我先給結論，再補數據與推論。以下不是投資建議。' },
  ],

  zones: {
    ee: '電機工程部', code: '程式部', studio: '創作工作室', meeting: '會議室', lounge: '休息區',
    quant: '戰情室／交易大廳', qa: '圖面審查室', ops: '機房與額度中控室',
  },
};
