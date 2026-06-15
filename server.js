const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let rooms = {};

function initRoomIfNotExist(roomid) {
  if (!rooms[roomid]) {
    rooms[roomid] = {
      passwords: { "Player 1": null, "Player 2": null, "Player 3": null },
      allowedPlayer: null,
      wheelState: {
        activeImage: 'wheel-template.png',
        rotation: 0,
        velocity: 0,
        baseRotation: 0,
        initVelocity: 0,
        spinStartTime: 0,
        isDraggingSync: false
      }
    };
  }
}

io.on('connection', (socket) => {
  let myRoomId = null;

  // Khi Tech khởi tạo hoặc nạp cấu hình phòng
  socket.on('techCreateRoom', (data) => {
    const { roomid, passwords } = data;
    initRoomIfNotExist(roomid);
    
    rooms[roomid].passwords = {
      "Player 1": passwords["Player 1"] ? String(passwords["Player 1"]).trim() : null,
      "Player 2": passwords["Player 2"] ? String(passwords["Player 2"]).trim() : null,
      "Player 3": passwords["Player 3"] ? String(passwords["Player 3"]).trim() : null
    };
    
    socket.join(roomid);
    myRoomId = roomid; // Lưu lại phòng cho socket này đề phòng trường hợp cần thiết
    console.log(`[TECH CREATE ROOM] Phòng ${roomid} - Mật khẩu:`, rooms[roomid].passwords);
  });

  // Khi Player hoặc Viewer chủ động join vào room bằng ID
  socket.on('joinRoom', (roomid) => {
    initRoomIfNotExist(roomid);
    socket.join(roomid);
    myRoomId = roomid;
    socket.emit('initGameState', {
      ...rooms[roomid].wheelState,
      allowedPlayer: rooms[roomid].allowedPlayer
    });
  });

  // Xác thực đăng nhập cho Player
  socket.on('verifyLogin', (data, callback) => {
    const { roomid, player, password } = data;
    
    console.log(`[VERIFY LOGIN] === YÊU CẦU MỚI ===`);
    console.log(`[VERIFY LOGIN] Phòng: ${roomid}`);
    console.log(`[VERIFY LOGIN] Player: ${player}`);
    
    if (!rooms[roomid]) {
      const failResponse = { success: false, msg: "Mã phòng này chưa được khởi tạo trên hệ thống máy chủ!" };
      return callback(failResponse);
    }
    
    const expectedPass = rooms[roomid].passwords[player];
    const clientPass = password ? String(password).trim() : "";

    if (expectedPass === null || expectedPass === undefined) {
      const failResponse = { success: false, msg: `Chưa thiết lập mật khẩu cho ${player}!` };
      return callback(failResponse);
    }

    if (expectedPass === clientPass) {
      socket.join(roomid);
      myRoomId = roomid;
      console.log(`[VERIFY LOGIN] ✓ SUCCESS: ${player} đăng nhập thành công phòng ${roomid}`);
      callback({ success: true });
    } else {
      callback({ success: false, msg: "Mật khẩu xác thực người chơi nhập vào chưa chính xác!" });
    }
  });

  // SỬA ĐỔI: Nhận data dạng Object { roomid, imageName } từ bản cập nhật tech.html mới
  socket.on('techChangeImage', (data) => {
    const roomid = data && data.roomid ? data.roomid : myRoomId;
    const imageName = data && data.imageName ? data.imageName : data;

    if (!roomid || !rooms[roomid]) return;
    rooms[roomid].wheelState.activeImage = imageName;
    io.to(roomid).emit('playerUpdateImage', imageName);
    console.log(`[TECH] Đổi mặt nón phòng ${roomid} -> ${imageName}`);
  });

  // SỬA ĐỔI: Đưa nón về góc 0 dựa trên roomid truyền lên trực tiếp
  socket.on('techResetWheel', (data) => {
    const roomid = data && data.roomid ? data.roomid : myRoomId;

    if (!roomid || !rooms[roomid]) return;
    let ws = rooms[roomid].wheelState;
    ws.rotation = 0; ws.velocity = 0; ws.baseRotation = 0;
    ws.initVelocity = 0; ws.spinStartTime = 0; ws.isDraggingSync = false;
    io.to(roomid).emit('playerSyncPhysics', { rotation: 0, velocity: 0 });
    console.log(`[TECH] Đã reset nón phòng ${roomid} về 0 độ`);
  });

  // SỬA ĐỔI: Phân quyền quay dựa trên roomid truyền lên trực tiếp { roomid, player }
  socket.on('techSetAllowedPlayer', (data) => {
    const roomid = data && data.roomid ? data.roomid : myRoomId;
    const player = data && data.hasOwnProperty('player') ? data.player : data;

    if (!roomid || !rooms[roomid]) return;
    rooms[roomid].allowedPlayer = player;
    io.to(roomid).emit('syncAllowedPlayer', player);
    console.log(`[TECH] Phòng ${roomid} cấp quyền quay cho: ${player}`);
  });

  // SỬA ĐỔI: Phát âm thanh dựa trên roomid truyền lên trực tiếp { roomid, soundName }
  socket.on('techPlaySound', (data) => {
    const roomid = data && data.roomid ? data.roomid : myRoomId;
    const soundName = data && data.soundName ? data.soundName : data;

    if (!roomid) return;
    io.to(roomid).emit('listenSoundboard', soundName);
  });

  // Đồng bộ chuyển động xoay nón (Giữ nguyên logic gốc của bạn)
  socket.on('playerMoveWheel', (data) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    let ws = rooms[myRoomId].wheelState;
    
    if (data.spinStartTime) {
      ws.baseRotation = data.baseRotation;
      ws.initVelocity = data.initVelocity;
      ws.spinStartTime = data.spinStartTime;
      ws.velocity = data.initVelocity;
      ws.isDraggingSync = false;
    } else {
      ws.rotation = data.rotation;
      ws.velocity = data.velocity ?? 0;
      ws.spinStartTime = 0;
      ws.isDraggingSync = data.isDraggingSync || false;
    }
    if (data.rotation !== undefined) ws.rotation = data.rotation;
    
    socket.broadcast.to(myRoomId).emit('playerSyncPhysics', data);
  });

  // Đồng bộ dừng nón (Giữ nguyên logic gốc của bạn)
  socket.on('playerStopWheel', (data) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    let ws = rooms[myRoomId].wheelState;
    ws.rotation = data.rotation;
    ws.velocity = 0; ws.baseRotation = 0; ws.initVelocity = 0; ws.spinStartTime = 0; ws.isDraggingSync = false;
    io.to(myRoomId).emit('playerSyncPhysics', { rotation: data.rotation, velocity: 0 });
  });

  // Debug kiểm tra danh sách phòng
  socket.on('debugGetAllRooms', (callback) => {
    const roomsList = {};
    for (let roomid in rooms) {
      roomsList[roomid] = rooms[roomid].passwords;
    }
    console.log('[DEBUG] === TẤT CẢ PHÒNG ===', roomsList);
    if (callback && typeof callback === 'function') {
      callback(roomsList);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] Socket ${socket.id} đã ngắt kết nối`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[Hệ thống] Đang chạy tại cổng: ${PORT}`));