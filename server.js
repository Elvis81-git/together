const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// 託管靜態檔案
app.use(express.static(path.join(__dirname, 'public')));

// 儲存房間狀態
const rooms = {};

// 隨機生成 4 位數房間代碼
function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[code]);
  return code;
}

// 腦筋急轉彎謎題庫
const RIDDLES = [
  {
    question: '什麼東西有齒卻不能咬？',
    doors: [
      { text: '拉鍊', value: 0 },
      { text: '梳子', value: 1 },
      { text: '鋸子', value: 2 }
    ],
    correctIndex: 1
  },
  {
    question: '什麼雞沒有翅膀？',
    doors: [
      { text: '火雞', value: 0 },
      { text: '田雞', value: 1 },
      { text: '落湯雞', value: 2 }
    ],
    correctIndex: 1
  },
  {
    question: '什麼東西有風吹得動，無風動不得？',
    doors: [
      { text: '扇子', value: 0 },
      { text: '風箏', value: 1 },
      { text: '氣球', value: 2 }
    ],
    correctIndex: 0
  },
  {
    question: '什麼書在書架上買不到？',
    doors: [
      { text: '教科書', value: 0 },
      { text: '秘書', value: 1 },
      { text: '說明書', value: 2 }
    ],
    correctIndex: 1
  }
];

// 數學題庫
const MATHS = [
  {
    equation: '18 x 3 - 27 = ?',
    doors: [
      { text: '27', value: 0 },
      { text: '37', value: 1 },
      { text: '17', value: 2 }
    ],
    correctIndex: 0
  },
  {
    equation: '7 x 8 + 19 = ?',
    doors: [
      { text: '65', value: 0 },
      { text: '75', value: 1 },
      { text: '85', value: 2 }
    ],
    correctIndex: 1
  },
  {
    equation: '(45 - 13) ÷ 4 = ?',
    doors: [
      { text: '6', value: 0 },
      { text: '8', value: 1 },
      { text: '9', value: 2 }
    ],
    correctIndex: 1
  }
];

// Stroop 效應干擾門題目
const STROOPS = [
  {
    instruction: '請通過【文字顏色】為綠色的傳送門',
    doors: [
      { text: '紅色', color: 'blue', value: 0 },
      { text: '綠色', color: 'red', value: 1 },
      { text: '藍色', color: 'green', value: 2 } // 顏色是綠色
    ],
    correctIndex: 2
  },
  {
    instruction: '請通過【文字內容】寫著紅色，且【文字顏色】不為藍色的傳送門',
    doors: [
      { text: '紅色', color: 'blue', value: 0 },
      { text: '紅色', color: 'yellow', value: 1 }, // 寫著紅色，顏色是黃色 (不為藍色)
      { text: '黃色', color: 'red', value: 2 }
    ],
    correctIndex: 1
  },
  {
    instruction: '請通過【文字顏色】為黃色的傳送門',
    doors: [
      { text: '黃色', color: 'green', value: 0 },
      { text: '綠色', color: 'yellow', value: 1 }, // 顏色是黃色
      { text: '藍色', color: 'red', value: 2 }
    ],
    correctIndex: 1
  }
];

// 隨機選取關卡內容
function generateLevelChallenges() {
  const stroop = STROOPS[Math.floor(Math.random() * STROOPS.length)];
  const math = MATHS[Math.floor(Math.random() * MATHS.length)];
  const riddle = RIDDLES[Math.floor(Math.random() * RIDDLES.length)];

  return [
    {
      type: 'stroop',
      x: 1200,
      instruction: stroop.instruction,
      doors: stroop.doors,
      correctIndex: stroop.correctIndex
    },
    {
      type: 'math',
      x: 2300,
      equation: math.equation,
      doors: math.doors,
      correctIndex: math.correctIndex
    },
    {
      type: 'riddle',
      x: 3400,
      question: riddle.question,
      doors: riddle.doors,
      correctIndex: riddle.correctIndex
    }
  ];
}

io.on('connection', (socket) => {
  console.log(`用戶已連線: ${socket.id}`);

  // 創建房間
  socket.on('createRoom', (playerName) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      code: roomCode,
      state: 'waiting',
      players: [
        {
          id: socket.id,
          name: playerName || 'Player 1',
          pNo: 1,
          x: 150,
          y: 300
        }
      ],
      health: 100,
      currentGate: 0,
      challenges: generateLevelChallenges()
    };

    socket.join(roomCode);
    socket.emit('roomCreated', roomCode);
    console.log(`房間已創建: ${roomCode}，創建者: ${playerName}`);
  });

  // 加入房間
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const room = rooms[roomCode];

    if (!room) {
      socket.emit('roomError', '找不到此房間！請確認房號是否正確。');
      return;
    }

    if (room.state !== 'waiting') {
      socket.emit('roomError', '該房間遊戲已經開始或無法加入。');
      return;
    }

    if (room.players.length >= 2) {
      socket.emit('roomError', '房間人數已滿。');
      return;
    }

    // 加入第二位玩家
    const newPlayer = {
      id: socket.id,
      name: playerName || 'Player 2',
      pNo: 2,
      x: 250,
      y: 300
    };
    room.players.push(newPlayer);
    room.state = 'playing';

    socket.join(roomCode);
    console.log(`玩家 ${playerName} 加入房間: ${roomCode}`);

    // 通知房間內所有人遊戲開始
    io.to(roomCode).emit('gameStart', {
      roomCode: room.code,
      players: room.players,
      challenges: room.challenges,
      health: room.health,
      currentGate: room.currentGate
    });
  });

  // 接收玩家移動更新並廣播給同房另一位玩家
  socket.on('playerUpdate', (data) => {
    const { roomCode, x, y, vx, vy, animFrame } = data;
    const room = rooms[roomCode];
    if (room) {
      // 廣播給同房除了發送者以外的人
      socket.to(roomCode).emit('peerUpdate', {
        pNo: data.pNo,
        x,
        y,
        vx,
        vy,
        animFrame
      });
    }
  });

  // 玩家被障礙物擊中 (扣血)
  socket.on('playerHit', ({ roomCode, damage }) => {
    const room = rooms[roomCode];
    if (room && room.state === 'playing') {
      room.health = Math.max(0, room.health - damage);
      io.to(roomCode).emit('healthUpdate', { health: room.health });
      console.log(`房間 ${roomCode} 扣血！目前血量: ${room.health}`);
    }
  });

  // 順利通過一道門 (解鎖下一關)
  socket.on('challengeSuccess', ({ roomCode, gateIndex }) => {
    const room = rooms[roomCode];
    if (room && room.state === 'playing') {
      if (gateIndex === room.currentGate) {
        room.currentGate++;
        io.to(roomCode).emit('challengeUpdate', { currentGate: room.currentGate });
        console.log(`房間 ${roomCode} 通過關卡 ${gateIndex}，下一關: ${room.currentGate}`);
      }
    }
  });

  // 遊戲重置 (血量為 0 時或手動重置)
  socket.on('gameReset', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (room) {
      room.health = 100;
      room.currentGate = 0;
      room.challenges = generateLevelChallenges(); // 隨機刷新題目，增加可玩性
      
      // 重置玩家座標
      room.players.forEach(p => {
        p.x = p.pNo === 1 ? 150 : 250;
        p.y = 300;
      });

      io.to(roomCode).emit('gameReset', {
        players: room.players,
        challenges: room.challenges,
        health: room.health,
        currentGate: room.currentGate
      });
      console.log(`房間 ${roomCode} 遊戲已重置。`);
    }
  });

  // 抵達終點過關
  socket.on('gameWin', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (room && room.state === 'playing') {
      room.state = 'finished';
      io.to(roomCode).emit('gameWin');
      console.log(`房間 ${roomCode} 玩家成功通關！`);
    }
  });

  // 斷線處理
  socket.on('disconnect', () => {
    console.log(`用戶已中斷連線: ${socket.id}`);
    // 尋找該用戶所在的房間
    for (const code in rooms) {
      const room = rooms[code];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        const disconnectedPlayer = room.players[playerIndex];
        room.players.splice(playerIndex, 1);
        console.log(`玩家 ${disconnectedPlayer.name} 離開了房間 ${code}`);

        if (room.players.length === 0) {
          // 房內無人則刪除房間
          delete rooms[code];
          console.log(`房間 ${code} 已空，予以刪除。`);
        } else {
          // 通知房內另一人對手斷開
          room.state = 'waiting';
          io.to(code).emit('playerDisconnected', disconnectedPlayer.name);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`伺服器正運行在 http://localhost:${PORT}`);
});
