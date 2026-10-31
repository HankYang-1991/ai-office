/* AI 辦公室 v0 — 資料驅動設定
 * 地圖、房間、家具、Agent 全部在這裡定義。之後接真實資料時，只要改這份設定
 * （或從 API 產生同結構的物件）即可，不用動繪圖程式。
 * 座標單位：格（tile），左上角為 (0,0)。
 */
window.OFFICE_CONFIG = {
  version: 'v0',
  title: 'AI 辦公室',
  tile: 16,
  cols: 42,
  rows: 28,
  speedMul: 1,
  usageUrl: 'data/usage.json',      // 共用額度資料來源（所有 Agent 讀寫同一份）
  usagePollSec: 60,                  // 每隔幾秒重新讀取一次
  timeZone: 'Asia/Taipei',

  // 房間：x,y,w,h 含牆；doors 為牆上的門洞
  rooms: [
    { id: 'lounge',  name: '休息區',     x: 1,  y: 1,  w: 14, h: 11, floor: 'wood',
      doors: [[7, 11], [8, 11], [14, 5], [14, 6]] },
    { id: 'meeting', name: '會議室',     x: 1,  y: 14, w: 14, h: 13, floor: 'carpet',
      doors: [[7, 14], [8, 14], [14, 20], [14, 21]] },
    { id: 'ee',      name: '電機工程部', x: 17, y: 1,  w: 12, h: 12, floor: 'tileBlue',
      doors: [[22, 12], [23, 12], [17, 6], [17, 7]] },
    { id: 'code',    name: '程式部',     x: 31, y: 1,  w: 10, h: 12, floor: 'tileGreen',
      doors: [[35, 12], [36, 12], [31, 6], [31, 7]] },
    { id: 'studio',  name: '創作工作室', x: 17, y: 15, w: 24, h: 12, floor: 'tileWarm',
      doors: [[22, 15], [23, 15], [35, 15], [36, 15], [17, 20], [17, 21]] },
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
    { type: 'cabinet', x: 26, y: 10, w: 2, h: 1 },
    { type: 'plant', x: 27, y: 2, w: 1, h: 1 },
    // 程式部
    { type: 'desk', x: 33, y: 3, w: 3, h: 1, deco: 'pc2', owner: 'codex-xiao-zhaowang' },
    { type: 'desk', x: 33, y: 7, w: 3, h: 1, deco: 'pc', owner: 'grok-bot' },
    { type: 'rack', x: 38, y: 2, w: 1, h: 2 },
    { type: 'rack', x: 39, y: 2, w: 1, h: 2 },
    { type: 'plant', x: 39, y: 11, w: 1, h: 1 },
    // 創作工作室
    { type: 'desk', x: 19, y: 18, w: 3, h: 1, deco: 'drawing', owner: 'da-zhaowang' },
    { type: 'desk', x: 25, y: 18, w: 3, h: 1, deco: 'camera', owner: 'zhaowang-xiaobao' },
    { type: 'desk', x: 31, y: 18, w: 3, h: 1, deco: 'piano', owner: 'jiantou-xiao-zhaowang' },
    { type: 'desk', x: 37, y: 18, w: 3, h: 1, deco: 'blueprint', owner: 'au-penguin' },
    { type: 'easel', x: 19, y: 23, w: 1, h: 1 },
    { type: 'backdrop', x: 24, y: 23, w: 4, h: 2 },
    { type: 'tripod', x: 28, y: 24, w: 1, h: 1 },
    { type: 'speaker', x: 30, y: 23, w: 1, h: 1 },
    { type: 'speaker', x: 34, y: 23, w: 1, h: 1 },
    { type: 'plant', x: 18, y: 25, w: 1, h: 1 },
    { type: 'plant', x: 39, y: 25, w: 1, h: 1 },
  ],

  meetingSeats: [[5,17],[6,17],[7,17],[8,17],[9,17],[10,17],[5,21],[6,21],[7,21],[8,21],[9,21],[10,21],[3,19],[12,19]],
  meetingCenter: [7.5, 19],
  loungeSpots: [[9,3],[10,3],[11,3],[8,3],[5,6],[6,6],[9,7],[10,7],[4,8],[11,5],[3,5],[7,9]],

  // Agent：kind = human | blob | robot | penguin；seat = 座位格（在書桌下方）
  // accessories: tie, glasses, beret, camera, headphones, spike, hardhat, pencil
  agents: [
    { id: 'da-zhuren', name: '大主人', role: '電機專案經理', short: '大主人', zone: 'ee',
      kind: 'human', color: '#3b6fd8', hair: '#2b1d12', accessories: ['tie'],
      seat: [20, 4], weights: { working: 0.55, meeting: 0.3, idle: 0.15 },
      intro: '我負責電機專案的時程、工項與跨部門協調。',
      reply: '我來把這件事拆成工項和時程，晚點給大家進度表。' },
    { id: 'xiao-zhuren', name: '小主人', role: '電機繪圖專家', short: '小主人', zone: 'ee',
      kind: 'human', color: '#2bb3a3', hair: '#5a3a22', accessories: ['glasses', 'pencil'],
      seat: [25, 4], weights: { working: 0.65, meeting: 0.15, idle: 0.2 },
      intro: '單線圖、配電盤圖、施工圖都交給我。',
      reply: '需要的話我先畫一版單線圖草稿給大家看。' },
    { id: 'codex-xiao-zhaowang', name: 'codex-小沼王', role: '程式開發', short: '小沼王', zone: 'code',
      kind: 'blob', color: '#6fb7e8', accent: '#3d7fb0', accessories: ['glasses'],
      seat: [34, 4], weights: { working: 0.7, meeting: 0.15, idle: 0.15 },
      intro: '寫程式、寫腳本、修 bug，我是程式部的小沼王。',
      reply: '這個我可以寫個腳本自動處理，先開分支試試。' },
    { id: 'da-zhaowang', name: '大沼王', role: '漫畫家', short: '大沼王', zone: 'studio',
      kind: 'blob', color: '#5a9fd6', accent: '#2f6aa0', accessories: ['beret'],
      seat: [20, 19], weights: { working: 0.6, meeting: 0.1, idle: 0.3 },
      intro: '我畫沼王漫畫，分鏡、上色、四格都可以。',
      reply: '這個題材很適合畫成四格漫畫！' },
    { id: 'zhaowang-xiaobao', name: '沼王小寶', role: '攝影師', short: '沼王小寶', zone: 'studio',
      kind: 'blob', color: '#8fd0f0', accent: '#4f9cc8', accessories: ['camera'],
      seat: [26, 19], weights: { working: 0.5, meeting: 0.1, idle: 0.4 },
      intro: '拍照、修圖、找角度，我是攝影師沼王小寶。',
      reply: '我去拍幾張參考照片，順便修一下光線。' },
    { id: 'jiantou-xiao-zhaowang', name: '尖頭小沼王', role: '音樂家', short: '尖頭小沼王', zone: 'studio',
      kind: 'blob', color: '#7aa8e0', accent: '#4a72b0', accessories: ['spike', 'headphones'],
      seat: [32, 19], weights: { working: 0.55, meeting: 0.1, idle: 0.35 },
      intro: '作曲、編曲、配 BGM，尖頭小沼王在此 ♪',
      reply: '幫這件事配一段 BGM 應該會很有感覺 ♪' },
    { id: 'grok-bot', name: 'Grok Bot', role: '通用助理', short: 'Grok Bot', zone: 'code',
      kind: 'robot', color: '#e8e8e8', accessories: [],
      seat: [34, 8], weights: { working: 0.5, meeting: 0.3, idle: 0.2 },
      intro: '查資料、整理重點、跑腿，什麼都可以找我。',
      reply: '我先幫大家查資料、整理重點。' },
    { id: 'au-penguin', name: '澳洲企鵝🐧', role: 'AI辦公室城市設計師', short: '澳洲企鵝', zone: 'studio',
      kind: 'penguin', color: '#e85d4a', accessories: ['hardhat'],
      seat: [38, 19], weights: { working: 0.5, meeting: 0.3, idle: 0.2 },
      intro: '我是這間辦公室的設計師，負責規劃大家的分工與協作 🐧',
      reply: '我把這件事排進辦公室的工作流程裡 🐧' },
  ],

  zones: {
    ee: '電機工程部', code: '程式部', studio: '創作工作室', meeting: '會議室', lounge: '休息區',
  },
};
