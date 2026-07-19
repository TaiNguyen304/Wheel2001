const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = {};

function initRoomIfNotExist(roomid) {
  if (!rooms[roomid]) {
    rooms[roomid] = {
      passwords: {
        "Player 1": null,
        "Player 2": null,
        "Player 3": null
      },
      allowedPlayer: null,
      wheelState: {
        activeImage: 'wheel-template.png',
        spinMusic: 'spin.mp3',
        rotation: 0,
        velocity: 0,
        baseRotation: 0,
        initVelocity: 0,
        spinStartTime: 0,
        targetSeconds: 20,
        isDraggingSync: false,
        pointerState: { p1: true, p2: true, p3: true, p4: true }
      }
    };
  }
}

io.on('connection', (socket) => {
  let myRoomId = null;

  socket.on('techUpdatePointers', (data) => {
    const roomid = data?.roomid || myRoomId;
    if (!roomid || !rooms[roomid]) return;

    rooms[roomid].wheelState.pointerState = data.pointerState;
    io.to(roomid).emit('syncPointerState', data.pointerState);
  });
  // --- BỔ SUNG: CƠ CHẾ ĐỒNG BỘ ĐỒNG HỒ ĐỊA LÝ TOÀN CẦU ---
  // Lắng nghe và phản hồi ngay lập tức thời gian của server để các máy tự tính độ lệch pha (latency)
  socket.on('serverTimeSync', (clientTimestamp, callback) => {
    if (typeof callback === 'function') {
      callback({
        serverTimestamp: Date.now(),
        clientTimestamp: clientTimestamp
      });
    }
  });

  socket.on('techCreateRoom', (data) => {
    const { roomid, passwords } = data;
    if (!roomid) return;

    initRoomIfNotExist(roomid);
    myRoomId = roomid;
    socket.join(roomid);

    rooms[roomid].passwords = {
      "Player 1": passwords?.["Player 1"] !== undefined ? String(passwords["Player 1"]).trim() : null,
      "Player 2": passwords?.["Player 2"] !== undefined ? String(passwords["Player 2"]).trim() : null,
      "Player 3": passwords?.["Player 3"] !== undefined ? String(passwords["Player 3"]).trim() : null
    };
  });

  socket.on('techChangeSpinMusic', (data) => {
    const roomid = data?.roomid || myRoomId;
    const musicFile = data?.musicFile;
    if (!roomid || !rooms[roomid]) return;

    rooms[roomid].wheelState.spinMusic = musicFile;
    io.to(roomid).emit('syncSpinMusic', musicFile);
  });

  socket.on('controlSlotState', (data) => {
    // data gồm: { id, file, action, angle }
    const roomid = socket.roomid; // Hoặc cách lấy roomid hiện tại của server bạn

    // Phát trực tiếp cập nhật tới mọi client trong phòng bao gồm Player và Viewer
    io.to(roomid).emit('syncSlotState', data);
  });
  socket.on('techChangeImage', (data) => {
    const roomid = data?.roomid || myRoomId;
    const imageName = data?.imageName || data;

    if (!roomid || !rooms[roomid]) return;

    rooms[roomid].wheelState.activeImage = imageName;
    io.to(roomid).emit('playerUpdateImage', imageName);
  });

  socket.on('techResetWheel', (data) => {
    const roomid = data?.roomid || myRoomId;

    if (!roomid || !rooms[roomid]) return;

    const ws = rooms[roomid].wheelState;
    ws.rotation = 0;
    ws.velocity = 0;
    ws.baseRotation = 0;
    ws.initVelocity = 0;
    ws.spinStartTime = 0;
    ws.isDraggingSync = false;

    io.to(roomid).emit('playerSyncPhysics', { rotation: 0, velocity: 0, spinStartTime: 0 });
  });

  socket.on('techSetAllowedPlayer', (data) => {
    const roomid = data?.roomid || myRoomId;
    const player = data && Object.prototype.hasOwnProperty.call(data, 'player') ? data.player : data;

    if (!roomid || !rooms[roomid]) return;

    rooms[roomid].allowedPlayer = player;
    io.to(roomid).emit('syncAllowedPlayer', player);
  });

  socket.on('techPlaySound', (data) => {
    const roomid = data?.roomid || myRoomId;
    const soundName = data?.soundName || data;

    if (!roomid) return;
    io.to(roomid).emit('listenSoundboard', soundName);
  });

  socket.on('techStopSound', (data) => {
    const roomid = data?.roomid || myRoomId;
    if (!roomid) return;
    io.to(roomid).emit('listenStopSound');
  });

  socket.on('joinRoom', (data) => {
    const { roomid, role, password } = data;
    if (!roomid) return;

    if (!rooms[roomid]) {
      socket.emit('loginResult', { success: false, message: 'Phòng thi đấu chưa được Ban Tổ Chức khởi tạo!' });
      return;
    }

    myRoomId = roomid;
    socket.join(roomid);

    const checkRole = String(role).toLowerCase();
    if (checkRole === 'viewer') {
      socket.myRole = 'viewer';
      socket.emit('loginResult', { success: true, role: 'viewer' });
      socket.emit('initGameState', {
        ...rooms[roomid].wheelState,
        allowedPlayer: rooms[roomid].allowedPlayer,
        serverNow: Date.now()
      });
      return;
    }

    let targetRole = role;
    let clientPass = "";

    if (password && typeof password === 'object') {
      targetRole = password.playerRole || role;
      clientPass = password.playerPassword !== undefined ? String(password.playerPassword).trim() : "";
    } else if (password !== undefined) {
      clientPass = String(password).trim();
    }

    const savedPass = rooms[roomid].passwords[targetRole];

    if (savedPass !== null && savedPass !== undefined && String(savedPass).trim() === clientPass) {
      socket.myRole = targetRole;
      socket.emit('loginResult', { success: true, role: 'player', playerRole: targetRole });
      socket.emit('initGameState', {
        ...rooms[roomid].wheelState,
        allowedPlayer: rooms[roomid].allowedPlayer,
        serverNow: Date.now()
      });
    } else {
      socket.emit('loginResult', { success: false, message: 'Xác thực thông tin cấu hình phòng thất bại!' });
    }
  });

  socket.on('playerVerifyLogin', (data, callback) => {
    const roomid = data?.roomid !== undefined ? String(data.roomid).trim() : "";
    const playerRole = data?.playerRole;

    let clientPass = "";
    if (data?.password !== undefined) {
      clientPass = String(data.password).trim();
    } else if (data?.playerPassword !== undefined) {
      clientPass = String(data.playerPassword).trim();
    }

    if (!roomid) {
      if (typeof callback === 'function') callback({ success: false, message: 'Thiếu mã phòng!' });
      return;
    }

    if (!rooms[roomid]) {
      if (typeof callback === 'function') {
        callback({ success: false, message: 'Phòng thi đấu này chưa được Ban Tổ Chức (Tech) khởi tạo trên hệ thống!' });
      }
      return;
    }

    if (playerRole && String(playerRole).toLowerCase() === 'viewer') {
      myRoomId = roomid;
      socket.join(roomid);
      socket.myRole = 'viewer';

      if (typeof callback === 'function') callback({ success: true, playerRole: 'viewer' });

      socket.emit('initGameState', {
        ...rooms[roomid].wheelState,
        allowedPlayer: rooms[roomid].allowedPlayer,
        serverNow: Date.now()
      });
      return;
    }

    const savedPass = rooms[roomid].passwords[playerRole];

    if (savedPass !== null && savedPass !== undefined && String(savedPass).trim() === clientPass) {
      myRoomId = roomid;
      socket.join(roomid);
      socket.myRole = playerRole;

      if (typeof callback === 'function') callback({ success: true, playerRole: playerRole });

      socket.emit('initGameState', {
        ...rooms[roomid].wheelState,
        allowedPlayer: rooms[roomid].allowedPlayer,
        serverNow: Date.now()
      });
    } else {
      if (typeof callback === 'function') {
        callback({ success: false, message: 'Mật khẩu phòng thi đấu không chính xác!' });
      }
    }
  });

  // 1. Trong sự kiện playerUpdatePhysics
  socket.on('playerUpdatePhysics', (data) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    if (socket.myRole === 'viewer') return;

    const ws = rooms[myRoomId].wheelState;
    if (data.spinStartTime) {
      ws.baseRotation = data.baseRotation;
      ws.initVelocity = data.initVelocity;
      ws.spinStartTime = data.spinStartTime;
      let secureTargetSeconds = data.targetSeconds || 20;
      if (secureTargetSeconds < 15) secureTargetSeconds = 15;
      if (secureTargetSeconds > 25) secureTargetSeconds = 25;
      ws.targetSeconds = secureTargetSeconds;
      ws.velocity = data.initVelocity;
      ws.isDraggingSync = false;
      ws.serverSpinStartTime = Date.now(); // <-- THÊM DÒNG NÀY: Lưu mốc thời gian chuẩn của Server
    } else {
      ws.rotation = data.rotation;
      ws.velocity = data.velocity ?? 0;
      ws.spinStartTime = 0;
      ws.isDraggingSync = data.isDraggingSync || false;
    }
    if (data.rotation !== undefined) ws.rotation = data.rotation;

    socket.broadcast.to(myRoomId).emit('playerSyncPhysics', data);
  });

  socket.on('playerStopWheel', (data) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    if (socket.myRole === 'viewer') return;

    const ws = rooms[myRoomId].wheelState;

    ws.rotation = data.rotation;
    ws.velocity = 0;
    ws.baseRotation = 0;
    ws.initVelocity = 0;
    ws.spinStartTime = 0;
    ws.isDraggingSync = false;

    io.to(myRoomId).emit('playerSyncPhysics', { rotation: data.rotation, velocity: 0, spinStartTime: 0 });
  });

  socket.on('debugGetAllRooms', (callback) => {
    const roomsList = {};
    for (const roomid in rooms) {
      roomsList[roomid] = rooms[roomid].passwords;
    }
    if (typeof callback === 'function') callback(roomsList);
  });

  socket.on('disconnect', () => {
    if (myRoomId) {
      socket.leave(myRoomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT);