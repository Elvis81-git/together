// 初始化 Socket.io 連線
if (typeof io === 'undefined') {
  alert('【連線錯誤】無法載入 Socket.io！\n\n這通常是因為您直接雙擊打開了 index.html 檔案（網址顯示 file:///...）。\n\n請依循以下步驟：\n1. 在終端機執行 `node server.js` 啟動伺服器。\n2. 在瀏覽器網址列輸入 `http://localhost:3000` 開啟遊戲。');
  window.socket = { on: () => {}, emit: () => {} };
} else {
  window.socket = io();
}
const socket = window.socket;

// 遊戲狀態與變數
let roomCode = null;
let myPlayerNo = 0; // 1 或 2
let playersInfo = [];
let challengesData = [];
let gameHealth = 100;
let activeGate = 0; // 當前解鎖進度 (0, 1, 2, 3)
let gameState = 'lobby'; // lobby, playing, gameover, victory

// Canvas 設定
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// 地圖大小
const MAP_WIDTH = 4000;
const MAP_HEIGHT = 600;
const PLAYABLE_TOP = 100;
const PLAYABLE_BOTTOM = 500;

// 攝影機 X 座標與自動滾動變數
let camX = 0;
let autoScrollSpeed = 0.8;
let baseScrollSpeed = 0.8;
let maxScrollSpeed = 3.5;
let scrollAccel = 0.015; // 每秒速度增加量
let offscreenDamageInterval = 45; // 幾幀判定一次落後扣血
let offscreenDamageAmount = 10;   // 每次扣血數量
let gameStartTime = 0;
let showLeftEdgeWarning = false; // 是否顯示左側邊緣警告
let edgeDamageTimer = 0; // 邊緣扣血計時器

// 畫面晃動效果
let shakeTime = 0;
let shakeIntensity = 0;

// 粒子系統
let particles = [];

// 玩家定義
const player1 = {
  pNo: 1,
  name: '玩家 1',
  x: 150,
  y: 300,
  vx: 0,
  vy: 0,
  radius: 18,
  color: '#00f0ff',
  glowColor: 'rgba(0, 240, 255, 0.4)',
  invulnerableTime: 0,
  trail: []
};

const player2 = {
  pNo: 2,
  name: '玩家 2',
  x: 250,
  y: 300,
  vx: 0,
  vy: 0,
  radius: 18,
  color: '#ff007f',
  glowColor: 'rgba(255, 0, 127, 0.4)',
  invulnerableTime: 0,
  trail: []
};

// 本地玩家與遠端對手參照
let localPlayer = null;
let peerPlayer = null;
let peerTargetX = 0;
let peerTargetY = 0;

// 鍵盤輸入狀態
const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
  ArrowUp: false,
  ArrowLeft: false,
  ArrowDown: false,
  ArrowRight: false
};

// 物理參數
const ACCEL = 0.5;
const FRICTION = 0.88;
const ROPE_REST_LENGTH = 130;
const ROPE_K = 0.04; // 彈力係數
const ROPE_MAX_LENGTH = 280;

// 障礙物定義
let obstacles = [];

// 初始化障礙物
function initObstacles() {
  obstacles = [
    // 鋸齒旋轉器 (x, y, radius, speed, type)
    { x: 600, y: 300, radius: 45, angle: 0, rotSpeed: 0.05, type: 'spinner' },
    { x: 1800, y: 200, radius: 40, angle: 0, rotSpeed: -0.04, type: 'spinner' },
    { x: 1800, y: 400, radius: 40, angle: 0, rotSpeed: 0.04, type: 'spinner' },
    { x: 2900, y: 300, radius: 50, angle: 0, rotSpeed: 0.06, type: 'spinner' },

    // 垂直移動雷射 (x, y, height, width, speed, rangeY, type)
    { x: 900, y: 200, height: 100, width: 8, speed: 2.5, type: 'laser', dir: 1 },
    { x: 1500, y: 400, height: 100, width: 8, speed: 3.5, type: 'laser', dir: -1 },
    { x: 2600, y: 300, height: 120, width: 8, speed: 4, type: 'laser', dir: 1 },
    { x: 3100, y: 200, height: 100, width: 8, speed: 3, type: 'laser', dir: -1 },
  ];
}

// ==========================================
// LOBBY UI 邏輯
// ==========================================

const lobbyDiv = document.getElementById('lobby');
const gameContainer = document.getElementById('game-container');
const lobbyMain = document.getElementById('lobby-main');
const lobbyJoin = document.getElementById('lobby-join');
const lobbyWaiting = document.getElementById('lobby-waiting');

const nameInput = document.getElementById('playerName');
const roomCodeInput = document.getElementById('roomCodeInput');
const roomCodeVal = document.getElementById('roomCodeVal');

const hudRoomCode = document.getElementById('hudRoomCode');
const hudPlayerRole = document.getElementById('hudPlayerRole');
const healthBarFill = document.getElementById('health-bar-fill');
const healthText = document.getElementById('health-text');
const challengePanel = document.getElementById('challenge-panel');
const challengeQuestion = document.getElementById('challengeQuestion');

// Toast 提示
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.classList.add('active');
  setTimeout(() => {
    toast.classList.remove('active');
  }, 3000);
}

// 難度選擇
let selectedDifficulty = 'easy';
const btnDiffEasy = document.getElementById('btnDiffEasy');
const btnDiffHard = document.getElementById('btnDiffHard');

if (btnDiffEasy && btnDiffHard) {
  btnDiffEasy.addEventListener('click', () => {
    selectedDifficulty = 'easy';
    btnDiffEasy.classList.add('active');
    btnDiffHard.classList.remove('active');
  });
  btnDiffHard.addEventListener('click', () => {
    selectedDifficulty = 'hard';
    btnDiffHard.classList.add('active');
    btnDiffEasy.classList.remove('active');
  });
}

// 創建房間
document.getElementById('btnCreateRoom').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    showToast('請輸入您的暱稱！');
    return;
  }
  socket.emit('createRoom', { playerName: name, difficulty: selectedDifficulty });
});

// 顯示加入房間輸入框
document.getElementById('btnShowJoin').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    showToast('請輸入您的暱稱！');
    return;
  }
  lobbyMain.classList.remove('active');
  lobbyJoin.classList.add('active');
});

// 返回大廳主選單
document.getElementById('btnBackToMain').addEventListener('click', () => {
  lobbyJoin.classList.remove('active');
  lobbyMain.classList.add('active');
});

// 送出房號加入連線
document.getElementById('btnJoinRoomSubmit').addEventListener('click', () => {
  const name = nameInput.value.trim();
  const code = roomCodeInput.value.trim();
  if (!name) {
    showToast('請輸入您的暱稱！');
    return;
  }
  if (code.length !== 4) {
    showToast('請輸入 4 位數房號！');
    return;
  }
  socket.emit('joinRoom', { roomCode: code, playerName: name });
});

// 取消等待
document.getElementById('btnCancelWaiting').addEventListener('click', () => {
  // 重新整理頁面或重置 Socket
  window.location.reload();
});

// 返回大廳
document.getElementById('btnReturnToLobby').addEventListener('click', () => {
  window.location.reload();
});

// 重新挑戰 (Game Over)
document.getElementById('btnRestartGameOver').addEventListener('click', () => {
  document.getElementById('game-over-screen').classList.remove('active');
  socket.emit('gameReset', { roomCode });
});

// 再次挑戰 (Victory)
document.getElementById('btnRestartVictory').addEventListener('click', () => {
  document.getElementById('victory-screen').classList.remove('active');
  socket.emit('gameReset', { roomCode });
});

// ==========================================
// SOCKET.IO 事件接聽
// ==========================================

socket.on('roomCreated', (code) => {
  roomCode = code;
  roomCodeVal.innerText = code;
  lobbyMain.classList.remove('active');
  lobbyWaiting.classList.add('active');
});

socket.on('roomError', (msg) => {
  showToast(msg);
});

// 遊戲正式開始
socket.on('gameStart', (data) => {
  roomCode = data.roomCode;
  playersInfo = data.players;
  challengesData = data.challenges;
  gameHealth = data.health;
  activeGate = data.currentGate;

  // 判定自己是玩家 1 還是 玩家 2
  const me = playersInfo.find(p => p.id === socket.id);
  myPlayerNo = me.pNo;

  if (myPlayerNo === 1) {
    localPlayer = player1;
    peerPlayer = player2;
    localPlayer.name = me.name + ' (您)';
    peerPlayer.name = playersInfo[1].name;
  } else {
    localPlayer = player2;
    peerPlayer = player1;
    localPlayer.name = me.name + ' (您)';
    peerPlayer.name = playersInfo[0].name;
  }

  // 初始化位置
  player1.x = playersInfo[0].x;
  player1.y = playersInfo[0].y;
  player2.x = playersInfo[1].x;
  player2.y = playersInfo[1].y;

  peerTargetX = peerPlayer.x;
  peerTargetY = peerPlayer.y;

  localPlayer.vx = 0;
  localPlayer.vy = 0;
  peerPlayer.vx = 0;
  peerPlayer.vy = 0;

  // 更新 HUD
  hudRoomCode.innerText = roomCode;
  hudPlayerRole.innerText = `您是：${myPlayerNo === 1 ? '玩家 1 (青色)' : '玩家 2 (桃紅色)'}`;
  hudPlayerRole.style.color = localPlayer.color;

  updateHUDHealth();
  updateHUDProgress();
  initObstacles();

  // 切換畫面
  lobbyDiv.classList.remove('active');
  gameContainer.classList.add('active');

  // 設定難度物理參數
  const diff = data.difficulty || 'easy';
  if (diff === 'easy') {
    baseScrollSpeed = 0.4;
    maxScrollSpeed = 1.8;
    scrollAccel = 0.006;
    offscreenDamageInterval = 60;
    offscreenDamageAmount = 6;
    hudRoomCode.innerText = `${roomCode} (簡單)`;
  } else {
    baseScrollSpeed = 0.9;
    maxScrollSpeed = 3.5;
    scrollAccel = 0.015;
    offscreenDamageInterval = 40;
    offscreenDamageAmount = 10;
    hudRoomCode.innerText = `${roomCode} (困難)`;
  }

  // 初始化滾動計時與相機位置
  camX = 0;
  gameStartTime = Date.now();
  autoScrollSpeed = baseScrollSpeed;
  showLeftEdgeWarning = false;
  edgeDamageTimer = 0;

  gameState = 'playing';
  console.log('遊戲開始！我是玩家:', myPlayerNo);

  // 開始遊戲循環
  requestAnimationFrame(gameLoop);
});

// 接收遠端玩家更新
socket.on('peerUpdate', (data) => {
  if (!peerPlayer) return;
  peerTargetX = data.x;
  peerTargetY = data.y;
  peerPlayer.vx = data.vx;
  peerPlayer.vy = data.vy;
});

// 更新血量
socket.on('healthUpdate', (data) => {
  gameHealth = data.health;
  updateHUDHealth();
  triggerScreenShake(12, 18);

  // 血量歸零 -> 遊戲結束
  if (gameHealth <= 0 && gameState === 'playing') {
    gameState = 'gameover';
    document.getElementById('game-over-screen').classList.add('active');
  }
});

// 更新關卡鎖狀態
socket.on('challengeUpdate', (data) => {
  activeGate = data.currentGate;
  updateHUDProgress();
  showToast(`第 ${activeGate} 關解鎖！請繼續前進！`);
  triggerVictorySparks();
});

// 遊戲重置
socket.on('gameReset', (data) => {
  gameHealth = data.health;
  activeGate = data.currentGate;
  challengesData = data.challenges;

  // 重置玩家座標
  player1.x = data.players[0].x;
  player1.y = data.players[0].y;
  player2.x = data.players[1].x;
  player2.y = data.players[1].y;

  peerTargetX = peerPlayer.x;
  peerTargetY = peerPlayer.y;

  localPlayer.vx = 0;
  localPlayer.vy = 0;
  peerPlayer.vx = 0;
  peerPlayer.vy = 0;

  localPlayer.trail = [];
  peerPlayer.trail = [];
  particles = [];

  updateHUDHealth();
  updateHUDProgress();
  initObstacles();
  challengePanel.classList.remove('active');

  // 隱藏失敗與勝利遮罩面板！ (解決雙人同步重置問題)
  document.getElementById('game-over-screen').classList.remove('active');
  document.getElementById('victory-screen').classList.remove('active');

  // 設定難度物理參數
  const diff = data.difficulty || 'easy';
  if (diff === 'easy') {
    baseScrollSpeed = 0.4;
    maxScrollSpeed = 1.8;
    scrollAccel = 0.006;
    offscreenDamageInterval = 60;
    offscreenDamageAmount = 6;
    hudRoomCode.innerText = `${roomCode} (簡單)`;
  } else {
    baseScrollSpeed = 0.9;
    maxScrollSpeed = 3.5;
    scrollAccel = 0.015;
    offscreenDamageInterval = 40;
    offscreenDamageAmount = 10;
    hudRoomCode.innerText = `${roomCode} (困難)`;
  }

  // 重置滾動計時與相機位置
  camX = 0;
  gameStartTime = Date.now();
  autoScrollSpeed = baseScrollSpeed;
  showLeftEdgeWarning = false;
  edgeDamageTimer = 0;

  gameState = 'playing';
  requestAnimationFrame(gameLoop);
});

// 成功通關
socket.on('gameWin', () => {
  gameState = 'victory';
  document.getElementById('victory-screen').classList.add('active');
  // 發射大量勝利煙火粒子
  for (let i = 0; i < 150; i++) {
    createParticle(
      MAP_WIDTH - 150 + Math.random() * 100,
      300 + (Math.random() - 0.5) * 200,
      `hsl(${Math.random() * 360}, 100%, 60%)`,
      (Math.random() - 0.5) * 12,
      (Math.random() - 0.5) * 12,
      Math.random() * 4 + 2,
      Math.random() * 40 + 40
    );
  }
});

// 對手離線
socket.on('playerDisconnected', (peerName) => {
  gameState = 'disconnected';
  document.getElementById('disconnect-screen').classList.add('active');
  document.getElementById('disconnectMessage').innerText = `夥伴 ${peerName} 中斷了連線，遊戲無法繼續。`;
});

// ==========================================
// 鍵盤輸入事件接聽
// ==========================================

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'w' || key === 'arrowup') keys.w = true;
  if (key === 'a' || key === 'arrowleft') keys.a = true;
  if (key === 's' || key === 'arrowdown') keys.s = true;
  if (key === 'd' || key === 'arrowright') keys.d = true;
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'w' || key === 'arrowup') keys.w = false;
  if (key === 'a' || key === 'arrowleft') keys.a = false;
  if (key === 's' || key === 'arrowdown') keys.s = false;
  if (key === 'd' || key === 'arrowright') keys.d = false;
});

// ==========================================
// 輔助 UI 更新函數
// ==========================================

function updateHUDHealth() {
  healthBarFill.style.width = `${gameHealth}%`;
  healthText.innerText = `${gameHealth}%`;

  if (gameHealth < 30) {
    healthBarFill.style.background = 'linear-gradient(90deg, #ff3b30, #ff9500)';
    healthText.style.color = '#ff3b30';
  } else {
    healthBarFill.style.background = 'linear-gradient(90deg, #ff007f, #00f0ff)';
    healthText.style.color = '#ff007f';
  }
}

function updateHUDProgress() {
  for (let i = 1; i <= 5; i++) {
    const dot = document.getElementById(`progress-dot-${i}`);
    dot.className = 'progress-dot'; // 清除

    if (i - 1 < activeGate) {
      dot.classList.add('completed');
    } else if (i - 1 === activeGate) {
      dot.classList.add('active');
    }
  }
}

// ==========================================
// 粒子系統 (視覺效果)
// ==========================================

function createParticle(x, y, color, vx, vy, size, life) {
  particles.push({ x, y, color, vx, vy, size, life, maxLife: life });
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
}

function drawParticles() {
  particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.shadowBlur = 8;
    ctx.shadowColor = p.color;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function triggerVictorySparks() {
  // 當前門解鎖時噴發綠色/青色粒子
  const gateX = challengesData[activeGate - 1]?.x;
  if (!gateX) return;

  for (let i = 0; i < 60; i++) {
    createParticle(
      gateX,
      PLAYABLE_TOP + Math.random() * (PLAYABLE_BOTTOM - PLAYABLE_TOP),
      '#34c759',
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8,
      Math.random() * 3 + 2,
      Math.random() * 30 + 20
    );
  }
}

function triggerDamageSparks(x, y) {
  for (let i = 0; i < 30; i++) {
    createParticle(
      x,
      y,
      '#ff3b30',
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      Math.random() * 4 + 1.5,
      Math.random() * 25 + 15
    );
  }
}

// 畫面晃動觸發
function triggerScreenShake(time, intensity) {
  shakeTime = time;
  shakeIntensity = intensity;
}

// ==========================================
// 遊戲核心邏輯 (物理與碰撞)
// ==========================================

function updatePhysics() {
  if (!localPlayer || !peerPlayer) return;

  // 0. 計算已遊玩時間與目前滾動速度
  const elapsed = (Date.now() - gameStartTime) / 1000;
  autoScrollSpeed = Math.min(maxScrollSpeed, baseScrollSpeed + elapsed * scrollAccel);

  // 地圖自動向前推進 (不因未解鎖大門停下)
  camX += autoScrollSpeed;

  // 如果玩家走得比相機快，推動相機跟上，避免玩家跑出螢幕右側
  const avgX = (player1.x + player2.x) / 2;
  const minCamX = avgX - 600; // 超出相機中心偏右 (60% 寬度)
  if (camX < minCamX) {
    camX = minCamX;
  }
  
  // 限制相機最大邊界
  const maxCamX = MAP_WIDTH - canvas.width;
  if (camX > maxCamX) {
    camX = maxCamX;
  }

  // 1. 本地玩家輸入物理
  if (keys.w) localPlayer.vy -= ACCEL;
  if (keys.s) localPlayer.vy += ACCEL;
  if (keys.a) localPlayer.vx -= ACCEL;
  if (keys.d) localPlayer.vx += ACCEL;

  // 摩擦力
  localPlayer.vx *= FRICTION;
  localPlayer.vy *= FRICTION;

  // 2. 對手位置插值同步 (Lerp)
  peerPlayer.x += (peerTargetX - peerPlayer.x) * 0.25;
  peerPlayer.y += (peerTargetY - peerPlayer.y) * 0.25;

  // 3. 繩索彈力物理
  const dx = peerPlayer.x - localPlayer.x;
  const dy = peerPlayer.y - localPlayer.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > ROPE_REST_LENGTH) {
    const stretch = dist - ROPE_REST_LENGTH;
    const force = stretch * ROPE_K;
    const nx = dx / dist;
    const ny = dy / dist;

    // 施加拉力給本地玩家
    localPlayer.vx += nx * force;
    localPlayer.vy += ny * force;

    // 發射繩索張力粒子
    if (Math.random() < 0.15) {
      const px = localPlayer.x + nx * dist * Math.random();
      const py = localPlayer.y + ny * dist * Math.random();
      createParticle(px, py, 'rgba(255, 255, 255, 0.4)', (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 1.5, 15);
    }
  }

  // 4. 硬性拉力限制 (Rope Max Length Hard Stop)
  // 如果距離超過最大限制，強制將本地玩家拉回
  if (dist > ROPE_MAX_LENGTH) {
    const nx = dx / dist;
    const ny = dy / dist;
    const overshoot = dist - ROPE_MAX_LENGTH;
    
    localPlayer.x += nx * overshoot;
    localPlayer.y += ny * overshoot;
  }

  // 5. 更新本地玩家座標
  localPlayer.x += localPlayer.vx;
  localPlayer.y += localPlayer.vy;

  // 6. 地圖邊界碰撞與滾動邊界推力
  // 右邊界限制
  if (localPlayer.x > MAP_WIDTH - localPlayer.radius) {
    localPlayer.x = MAP_WIDTH - localPlayer.radius;
    localPlayer.vx = 0;
  }

  // 左邊界推動限制 (不可穿過未解鎖的關卡大門)
  let targetLeftBound = camX + localPlayer.radius;
  const currentLockedGate = challengesData.find((gate, idx) => activeGate <= idx);
  if (currentLockedGate && targetLeftBound > currentLockedGate.x - 15 - localPlayer.radius) {
    // 被未解鎖的大門擋住，相機推力不能將玩家推過大門！
    targetLeftBound = currentLockedGate.x - 15 - localPlayer.radius;
  }

  if (localPlayer.x < targetLeftBound) {
    localPlayer.x = targetLeftBound;
    localPlayer.vx = 0;
  }

  // 檢查玩家是否落後於螢幕左邊緣，若是則顯示警告並扣血
  const eitherOffScreen = (player1.x < camX + player1.radius + 15) || (player2.x < camX + player2.radius + 15);
  showLeftEdgeWarning = eitherOffScreen;

  if (localPlayer.x < camX + localPlayer.radius + 15) {
    edgeDamageTimer++;
    // 依據難度設定的幀率間隔扣血，以防扣血過快造成玩家無防備死亡
    if (edgeDamageTimer >= offscreenDamageInterval) {
      edgeDamageTimer = 0;
      socket.emit('playerHit', { roomCode, damage: offscreenDamageAmount });
      showToast('⚠️ 警告：您已落後螢幕！持續受到電磁輻射傷害！');
      triggerDamageSparks(localPlayer.x, localPlayer.y);
    }
  } else {
    if (!eitherOffScreen) {
      edgeDamageTimer = 0;
    }
  }

  // 上下可走區域邊界
  if (localPlayer.y < PLAYABLE_TOP + localPlayer.radius) {
    localPlayer.y = PLAYABLE_TOP + localPlayer.radius;
    localPlayer.vy = 0;
  }
  if (localPlayer.y > PLAYABLE_BOTTOM - localPlayer.radius) {
    localPlayer.y = PLAYABLE_BOTTOM - localPlayer.radius;
    localPlayer.vy = 0;
  }

  // 7. 與門/挑戰點 (Gate) 物理交互
  challengesData.forEach((gate, gateIdx) => {
    // 檢查本地玩家是否進入特定關卡區域，浮現題目 HUD
    const avgX = (player1.x + player2.x) / 2;
    if (Math.abs(avgX - gate.x) < 400 && activeGate === gateIdx) {
      challengePanel.classList.add('active');
      let questionHtml = '';
      if (gate.type === 'stroop') {
        questionHtml = `<span style="color: var(--yellow-neon)">[Stroop 顏色干擾挑戰]</span><br>${gate.instruction}`;
      } else if (gate.type === 'math') {
        questionHtml = `<span style="color: var(--cyan-neon)">[雙人合作心算]</span><br>解開前方的密碼鎖：<b style="font-size:1.4rem; color:var(--yellow-neon); font-family:Orbitron">${gate.equation}</b>`;
      } else if (gate.type === 'riddle') {
        questionHtml = `<span style="color: var(--magenta-neon)">[腦筋急轉彎]</span><br>謎題：${gate.question}`;
      }
      challengeQuestion.innerHTML = questionHtml;
    }

    // 如果關卡未被解鎖，則門會阻擋玩家
    if (activeGate <= gateIdx) {
      const gateX = gate.x;
      const doorWidth = 30;
      const doorHeight = (PLAYABLE_BOTTOM - PLAYABLE_TOP) / 3;

      // 檢查是否碰撞到該關卡的三道傳送門
      for (let doorIdx = 0; doorIdx < 3; doorIdx++) {
        const doorY = PLAYABLE_TOP + doorIdx * doorHeight;
        
        // AABB 碰撞盒檢測 (本地玩家與門)
        const px = localPlayer.x;
        const py = localPlayer.y;
        const r = localPlayer.radius;

        const doorMinX = gateX - doorWidth / 2;
        const doorMaxX = gateX + doorWidth / 2;
        const doorMinY = doorY;
        const doorMaxY = doorY + doorHeight;

        // 尋找圓心到矩形的最短距離點
        const closestX = Math.max(doorMinX, Math.min(px, doorMaxX));
        const closestY = Math.max(doorMinY, Math.min(py, doorMaxY));
        const distToDoor = Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);

        if (distToDoor < r) {
          // 發生碰撞！
          if (gateIdx === activeGate) {
            // 是當前要挑戰的關卡
            if (doorIdx === gate.correctIndex) {
              // 踩對正確門！傳送成功！
              showToast('答案正確！門解鎖了！');
              socket.emit('challengeSuccess', { roomCode, gateIndex: gateIdx });
            } else {
              // 踩錯門！扣血並擊退！
              if (localPlayer.invulnerableTime <= 0) {
                showToast('回答錯誤！傳送門引發了電能衝擊！');
                socket.emit('playerHit', { roomCode, damage: 10 });
                localPlayer.invulnerableTime = 60; // 1秒無敵
                triggerDamageSparks(px, py);
              }
              // 擊退物理
              localPlayer.x = gateX - 45;
              localPlayer.vx = -6;
            }
          } else {
            // 尚未解鎖的前置或後續關卡門：當作一般實體牆壁擋住
            if (px < gateX) {
              localPlayer.x = gateX - doorWidth / 2 - r;
              localPlayer.vx = 0;
            } else {
              localPlayer.x = gateX + doorWidth / 2 + r;
              localPlayer.vx = 0;
            }
          }
        }
      }
    }
  });

  // 當所有關卡解鎖，且本地玩家抵達地圖終點 (x >= MAP_WIDTH - 100)
  if (activeGate >= challengesData.length && localPlayer.x >= MAP_WIDTH - 120) {
    if (gameState === 'playing') {
      socket.emit('gameWin', { roomCode });
    }
  }

  // 8. 障礙物碰撞與更新 (只由本地玩家判定自己是否被撞，維持最精準的手感)
  obstacles.forEach(obs => {
    if (obs.type === 'spinner') {
      obs.angle += obs.rotSpeed; // 旋轉
      
      const dx = localPlayer.x - obs.x;
      const dy = localPlayer.y - obs.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < localPlayer.radius + obs.radius - 5) {
        // 撞到旋轉鋸片
        if (localPlayer.invulnerableTime <= 0) {
          socket.emit('playerHit', { roomCode, damage: 8 });
          localPlayer.invulnerableTime = 60; // 1秒無敵
          triggerDamageSparks(localPlayer.x, localPlayer.y);
          // 稍微擊退
          localPlayer.vx = (dx / dist) * 8;
          localPlayer.vy = (dy / dist) * 8;
        }
      }
    } else if (obs.type === 'laser') {
      // 雷射上下移動
      obs.y += obs.speed * obs.dir;
      if (obs.y < PLAYABLE_TOP + 10 || obs.y + obs.height > PLAYABLE_BOTTOM - 10) {
        obs.dir *= -1; // 彈回
      }

      // 雷射與圓形玩家的碰撞 (線段與圓碰撞)
      const px = localPlayer.x;
      const py = localPlayer.y;
      const r = localPlayer.radius;

      const laserX = obs.x;
      const laserMinY = obs.y;
      const laserMaxY = obs.y + obs.height;

      if (px + r > laserX - obs.width / 2 && px - r < laserX + obs.width / 2) {
        if (py > laserMinY && py < laserMaxY) {
          // 撞到雷射！
          if (localPlayer.invulnerableTime <= 0) {
            socket.emit('playerHit', { roomCode, damage: 15 });
            localPlayer.invulnerableTime = 60; // 1秒無敵
            triggerDamageSparks(px, py);
            // 擊退
            localPlayer.vx = px < laserX ? -7 : 7;
          }
        }
      }
    }
  });

  // 9. 更新無敵閃爍時間
  if (localPlayer.invulnerableTime > 0) localPlayer.invulnerableTime--;
  if (peerPlayer.invulnerableTime > 0) peerPlayer.invulnerableTime--;

  // 10. 更新本地玩家的拖尾特效
  localPlayer.trail.push({ x: localPlayer.x, y: localPlayer.y });
  if (localPlayer.trail.length > 8) localPlayer.trail.shift();

  peerPlayer.trail.push({ x: peerPlayer.x, y: peerPlayer.y });
  if (peerPlayer.trail.length > 8) peerPlayer.trail.shift();

  // 11. 發送最新位置到伺服器
  socket.emit('playerUpdate', {
    roomCode,
    pNo: myPlayerNo,
    x: localPlayer.x,
    y: localPlayer.y,
    vx: localPlayer.vx,
    vy: localPlayer.vy
  });

  // 12. 如果關卡已經通關，隱藏題目 HUD
  const averageX = (player1.x + player2.x) / 2;
  const currentGateX = challengesData[activeGate]?.x;
  if (!currentGateX || Math.abs(averageX - currentGateX) > 400) {
    challengePanel.classList.remove('active');
  }
}

// ==========================================
// CANVAS 渲染邏輯
// ==========================================

function drawGame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. 攝影機位置已在物理引擎中依據滾動速度與玩家位置計算，此處直接使用


  // 處理畫面晃動
  let offsetX = 0;
  let offsetY = 0;
  if (shakeTime > 0) {
    offsetX = (Math.random() - 0.5) * shakeIntensity;
    offsetY = (Math.random() - 0.5) * shakeIntensity;
    shakeTime--;
  }

  ctx.save();
  ctx.translate(-camX + offsetX, offsetY);

  // 2. 繪製背景裝飾 (滾動網格)
  drawBackgroundGrid();

  // 3. 繪製賽道邊界 (Top/Bottom glowing bounds)
  drawTrackBounds();

  // 4. 繪製起點與終點區域
  drawStartAndFinish();

  // 5. 繪製關卡傳送門與題目門
  drawGates();

  // 6. 繪製障礙物
  drawObstacles();

  // 7. 繪製玩家之間的彈性繩索
  drawRope();

  // 8. 繪製粒子效果
  drawParticles();

  // 9. 繪製玩家角色
  drawPlayer(player1);
  drawPlayer(player2);

  ctx.restore();

  // 10. 繪製螢幕左邊邊緣警告特效 (在 screen space 繪製，不受 camX 偏移影響)
  if (showLeftEdgeWarning) {
    ctx.save();
    // 繪製左側紅色發光漸層
    let warningGrad = ctx.createLinearGradient(0, 0, 150, 0);
    // 閃爍效果
    const alpha = 0.3 + 0.2 * Math.sin(Date.now() / 120);
    warningGrad.addColorStop(0, `rgba(255, 59, 48, ${alpha})`);
    warningGrad.addColorStop(1, 'rgba(255, 59, 48, 0)');
    ctx.fillStyle = warningGrad;
    ctx.fillRect(0, PLAYABLE_TOP, 150, PLAYABLE_BOTTOM - PLAYABLE_TOP);

    // 繪製「⚠️ 快跟上！」警告文字
    ctx.fillStyle = '#ff3b30';
    ctx.font = 'bold 22px var(--font-family)';
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(255, 59, 48, 0.8)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚠️ 快跟上！ KEEP UP!', 40, PLAYABLE_TOP + 30);
    ctx.restore();
  }
}

// 繪製滾動背景格線
function drawBackgroundGrid() {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.lineWidth = 1.5;

  const gridSize = 50;
  const startX = Math.floor(camX / gridSize) * gridSize;
  const endX = startX + canvas.width + gridSize;

  for (let x = startX; x < endX; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, PLAYABLE_TOP);
    ctx.lineTo(x, PLAYABLE_BOTTOM);
    ctx.stroke();
  }

  for (let y = PLAYABLE_TOP; y <= PLAYABLE_BOTTOM; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(camX, y);
    ctx.lineTo(camX + canvas.width, y);
    ctx.stroke();
  }
}

// 繪製上下護欄
function drawTrackBounds() {
  ctx.save();
  ctx.lineWidth = 4;
  
  // 上邊界 (霓虹藍)
  ctx.strokeStyle = '#00f0ff';
  ctx.shadowColor = 'rgba(0, 240, 255, 0.5)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(camX, PLAYABLE_TOP);
  ctx.lineTo(camX + canvas.width, PLAYABLE_TOP);
  ctx.stroke();

  // 下邊界 (霓虹紅)
  ctx.strokeStyle = '#ff007f';
  ctx.shadowColor = 'rgba(255, 0, 127, 0.5)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(camX, PLAYABLE_BOTTOM);
  ctx.lineTo(camX + canvas.width, PLAYABLE_BOTTOM);
  ctx.stroke();

  ctx.restore();
}

// 起點與終點繪製
function drawStartAndFinish() {
  // 起點 (x=100)
  ctx.save();
  ctx.fillStyle = 'rgba(0, 240, 255, 0.15)';
  ctx.fillRect(0, PLAYABLE_TOP, 200, PLAYABLE_BOTTOM - PLAYABLE_TOP);
  
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, PLAYABLE_TOP, 200, PLAYABLE_BOTTOM - PLAYABLE_TOP);

  ctx.fillStyle = '#00f0ff';
  ctx.font = 'bold 20px Montserrat';
  ctx.fillText('起點 START', 30, PLAYABLE_TOP + 40);
  ctx.restore();

  // 終點 (x=MAP_WIDTH-200)
  ctx.save();
  const finishX = MAP_WIDTH - 200;
  ctx.fillStyle = 'rgba(255, 215, 0, 0.15)';
  ctx.fillRect(finishX, PLAYABLE_TOP, 200, PLAYABLE_BOTTOM - PLAYABLE_TOP);
  
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 3;
  ctx.strokeRect(finishX, PLAYABLE_TOP, 200, PLAYABLE_BOTTOM - PLAYABLE_TOP);
  
  ctx.shadowColor = 'rgba(255, 215, 0, 0.6)';
  ctx.shadowBlur = 15;

  // 繪製棋盤終點格線
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 24px Montserrat';
  ctx.fillText('終點 GOAL', finishX + 40, PLAYABLE_TOP + 40);

  // 終點傳送門效果
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(finishX + 100, 300, 80, 0, Math.PI * 2);
  ctx.stroke();

  // 緩緩旋轉終點環
  const angle = (Date.now() / 1000) % (Math.PI * 2);
  ctx.translate(finishX + 100, 300);
  ctx.rotate(angle);
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.moveTo(60, 0);
    ctx.lineTo(95, 0);
  }
  ctx.stroke();
  ctx.restore();
}

// 繪製玩家角色
function drawPlayer(player) {
  const isInv = player.invulnerableTime > 0;
  
  // 無敵狀態閃爍
  if (isInv && Math.floor(Date.now() / 80) % 2 === 0) {
    return;
  }

  ctx.save();
  
  // 1. 繪製拖尾效果 (Trail)
  if (player.trail.length > 1) {
    ctx.beginPath();
    ctx.moveTo(player.trail[0].x, player.trail[0].y);
    for (let i = 1; i < player.trail.length; i++) {
      ctx.lineTo(player.trail[i].x, player.trail[i].y);
    }
    ctx.strokeStyle = player.color;
    ctx.lineWidth = player.radius * 0.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.25;
    ctx.stroke();
  }

  // 2. 圓球本體發光
  ctx.shadowBlur = 18;
  ctx.shadowColor = player.color;
  ctx.fillStyle = player.color;
  
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();

  // 3. 內圈核心 (白色)
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius * 0.5, 0, Math.PI * 2);
  ctx.fill();

  // 4. 繪製玩家暱稱標題
  ctx.fillStyle = '#f8fafc';
  ctx.font = '12px var(--font-family)';
  ctx.textAlign = 'center';
  ctx.fillText(player.name, player.x, player.y - player.radius - 8);

  ctx.restore();
}

// 繪製發光彈性繩索
function drawRope() {
  const dx = player2.x - player1.x;
  const dy = player2.y - player1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  ctx.save();

  // 繩索發光效果
  ctx.shadowBlur = 12;
  
  // 繩索顏色根據張力變化 (越接近極限越紅，平常為青/粉漸變)
  let ropeGrad = ctx.createLinearGradient(player1.x, player1.y, player2.x, player2.y);
  if (dist > ROPE_MAX_LENGTH - 40) {
    // 高張力：發出紅色警告光
    ctx.strokeStyle = '#ff3b30';
    ctx.shadowColor = '#ff3b30';
    ctx.lineWidth = 4.5;
  } else {
    // 正常張力：漸層霓虹
    ropeGrad.addColorStop(0, '#00f0ff');
    ropeGrad.addColorStop(0.5, '#ffffff');
    ropeGrad.addColorStop(1, '#ff007f');
    ctx.strokeStyle = ropeGrad;
    ctx.shadowColor = '#00f0ff';
    ctx.lineWidth = 3.5;
  }

  // 繪製略帶彈性抖動的繩子
  ctx.beginPath();
  ctx.moveTo(player1.x, player1.y);

  // 當距離小於繩子自然長度，繩子呈波浪鬆弛狀態
  if (dist < ROPE_REST_LENGTH) {
    const segments = 10;
    const midX = (player1.x + player2.x) / 2;
    const midY = (player1.y + player2.y) / 2;
    
    // 計算繩子垂直向量
    const nx = -dy / dist;
    const ny = dx / dist;
    
    // 鬆弛下垂幅度
    const sag = (ROPE_REST_LENGTH - dist) * 0.4 * Math.sin(Date.now() / 150);

    ctx.quadraticCurveTo(
      midX + nx * sag,
      midY + ny * sag,
      player2.x,
      player2.y
    );
  } else {
    // 緊繃狀態，直線繪製
    ctx.lineTo(player2.x, player2.y);
  }

  ctx.stroke();
  ctx.restore();
}

// 繪製障礙物
function drawObstacles() {
  obstacles.forEach(obs => {
    ctx.save();
    if (obs.type === 'spinner') {
      // 繪製旋轉鋸齒
      ctx.translate(obs.x, obs.y);
      ctx.rotate(obs.angle);
      
      // 鋸齒中心發光
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#ff3b30';
      ctx.fillStyle = '#1e1b29';
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 3;

      ctx.beginPath();
      ctx.arc(0, 0, obs.radius * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 繪製鋸齒利刃
      const numTeeth = 8;
      ctx.fillStyle = '#ff3b30';
      for (let i = 0; i < numTeeth; i++) {
        ctx.rotate((Math.PI * 2) / numTeeth);
        ctx.beginPath();
        ctx.moveTo(obs.radius * 0.6, -10);
        ctx.lineTo(obs.radius, 0);
        ctx.lineTo(obs.radius * 0.6, 10);
        ctx.closePath();
        ctx.fill();
      }
      
      // 繪製中間核心
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      
    } else if (obs.type === 'laser') {
      // 繪製上下激光發射器
      ctx.fillStyle = '#334155';
      ctx.fillRect(obs.x - 12, PLAYABLE_TOP, 24, 15);
      ctx.fillRect(obs.x - 12, PLAYABLE_BOTTOM - 15, 24, 15);

      // 繪製激光光束
      ctx.shadowBlur = 18;
      ctx.shadowColor = '#ff3b30';
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = obs.width;
      
      ctx.beginPath();
      ctx.moveTo(obs.x, obs.y);
      ctx.lineTo(obs.x, obs.y + obs.height);
      ctx.stroke();

      // 激光核心白色線
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = obs.width * 0.4;
      ctx.beginPath();
      ctx.moveTo(obs.x, obs.y);
      ctx.lineTo(obs.x, obs.y + obs.height);
      ctx.stroke();
    }
    ctx.restore();
  });
}

// 繪製三道傳送門關卡與文字
function drawGates() {
  challengesData.forEach((gate, gateIdx) => {
    const gateX = gate.x;
    const doorWidth = 30;
    const doorHeight = (PLAYABLE_BOTTOM - PLAYABLE_TOP) / 3;
    const isUnlocked = activeGate > gateIdx;

    // 繪製支撐立柱
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(gateX - 10, PLAYABLE_TOP, 20, PLAYABLE_BOTTOM - PLAYABLE_TOP);

    for (let doorIdx = 0; doorIdx < 3; doorIdx++) {
      const doorY = PLAYABLE_TOP + doorIdx * doorHeight;
      ctx.save();

      if (isUnlocked) {
        // 已解開：呈現淡綠色半透明，表示可通過
        ctx.fillStyle = 'rgba(52, 199, 89, 0.05)';
        ctx.fillRect(gateX - doorWidth / 2, doorY + 5, doorWidth, doorHeight - 10);
        
        ctx.strokeStyle = 'rgba(52, 199, 89, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(gateX - doorWidth / 2, doorY + 5, doorWidth, doorHeight - 10);
      } else {
        // 未解開：呈現發光力場
        let doorColor = '#7b2cbf'; // 所有未解鎖的大門都採用統一的霓虹紫色防禦力場
        let glowColor = 'rgba(123, 44, 191, 0.5)';


        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(gateX - doorWidth / 2, doorY + 5, doorWidth, doorHeight - 10);

        ctx.shadowBlur = 12;
        ctx.shadowColor = glowColor;
        ctx.strokeStyle = doorColor;
        ctx.lineWidth = 3;
        ctx.strokeRect(gateX - doorWidth / 2, doorY + 5, doorWidth, doorHeight - 10);

        // 繪製力場網狀干擾線
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let l = doorY + 15; l < doorY + doorHeight - 15; l += 15) {
          ctx.moveTo(gateX - doorWidth / 2, l);
          ctx.lineTo(gateX + doorWidth / 2, l + 5);
        }
        ctx.stroke();
      }

      // 繪製門上的字體選項 (文字)
      const doorData = gate.doors[doorIdx];
      let textColor = '#ffffff';
      let fontColor = '#ffffff';

      // 只有當前進行中的題目門顯示字，方便辨認
      if (activeGate === gateIdx) {
        if (gate.type === 'stroop') {
          // Stroop 關卡：字跟字體顏色不一樣
          textColor = doorData.text; // "紅色"、"綠色"等
          const cName = doorData.color; // color 屬性
          if (cName === 'blue') fontColor = '#00f0ff';
          else if (cName === 'red') fontColor = '#ff3b30';
          else if (cName === 'green') fontColor = '#34c759';
          else if (cName === 'yellow') fontColor = '#ffd700';
        } else {
          // 數學與謎題關卡：一般白字即可
          textColor = doorData.text;
          fontColor = '#ffffff';
        }

        ctx.restore();
        ctx.save();
        
        // 繪製門邊上的選項指示牌 (避免在窄窄的門內擠壓文字，我們把牌子畫在門的左側)
        ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
        ctx.strokeStyle = fontColor;
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 8;
        ctx.shadowColor = fontColor;
        
        const labelWidth = 70;
        const labelHeight = 30;
        const lx = gateX - doorWidth/2 - labelWidth - 10;
        const ly = doorY + doorHeight/2 - labelHeight/2;
        
        ctx.beginPath();
        ctx.roundRect(lx, ly, labelWidth, labelHeight, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = fontColor;
        ctx.shadowBlur = 0;
        ctx.font = 'bold 13px var(--font-family)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(textColor, lx + labelWidth / 2, ly + labelHeight / 2);
      }

      ctx.restore();
    }
  });
}

// ==========================================
// 遊戲主循環 (Game Loop)
// ==========================================

function gameLoop() {
  if (gameState !== 'playing') return;

  // 1. 物理更新
  updatePhysics();
  
  // 2. 粒子更新
  updateParticles();

  // 3. Canvas 繪製
  drawGame();

  // 繼續循環
  requestAnimationFrame(gameLoop);
}
