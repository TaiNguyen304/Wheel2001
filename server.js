const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(express.static('.'));

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
  let myPlayer = null;

  // Xác thực từ query string khi player kết nối
  const roomid = socket.handshake.query.roomid;
  const password = socket.handshake.query.password;
  const player = socket.handshake.query.player;

  if (roomid && password && player) {
    console.log(`[PLAYER CONNECT] Phòng: ${roomid}, Player: ${player}`);
    initRoomIfNotExist(roomid);
    
    const expectedPass = rooms[roomid].passwords[player];
    const clientPass = password ? String(password).trim() : "";
    
    if (expectedPass === clientPass) {
      socket.join(roomid);
      myRoomId = roomid;
      myPlayer = player;
      console.log(`[PLAYER CONNECT] ✓ ${player} tham gia phòng ${roomid} thành công`);
      socket.emit('initGameState', {
        ...rooms[roomid].wheelState,
        allowedPlayer: rooms[roomid].allowedPlayer
      });
    } else {
      console.log(`[PLAYER CONNECT] ✗ Xác thực thất bại cho ${player}`);
    }
  }

  socket.on('techCreateRoom', (data) => {
    const { roomid, passwords } = data;
    initRoomIfNotExist(roomid);
    
    // Đồng bộ ép toàn bộ mật khẩu lưu trữ về dạng chuỗi kí tự (String)
    rooms[roomid].passwords = {
      "Player 1": passwords["Player 1"] ? String(passwords["Player 1"]).trim() : null,
      "Player 2": passwords["Player 2"] ? String(passwords["Player 2"]).trim() : null,
      "Player 3": passwords["Player 3"] ? String(passwords["Player 3"]).trim() : null
    };
    
    socket.join(roomid);
    myRoomId = roomid;
    console.log(`[TECH CREATE ROOM] Phòng ${roomid} - Mật khẩu:`, rooms[roomid].passwords);
  });

  socket.on('joinRoom', (roomid) => {
    initRoomIfNotExist(roomid);
    socket.join(roomid);
    myRoomId = roomid;
    socket.emit('initGameState', {
      ...rooms[roomid].wheelState,
      allowedPlayer: rooms[roomid].allowedPlayer
    });
  });

  socket.on('verifyLogin', (data, callback) => {
    const { roomid, player, password } = data;
    
    console.log(`[VERIFY LOGIN] === YÊU CẦU MỚI ===`);
    console.log(`[VERIFY LOGIN] Phòng: ${roomid}`);
    console.log(`[VERIFY LOGIN] Player: ${player}`);
    console.log(`[VERIFY LOGIN] Password nhập vào: "${password}"`);
    console.log(`[VERIFY LOGIN] Loại callback:`, typeof callback);
    
    if (!rooms[roomid]) {
      console.log(`[VERIFY LOGIN] ✗ FAIL: Phòng ${roomid} không tồn tại`);
      console.log(`[VERIFY LOGIN] Phòng có sẵn:`, Object.keys(rooms));
      const failResponse = { success: false, msg: "Mã phòng này chưa được khởi tạo trên hệ thống máy chủ!" };
      console.log(`[VERIFY LOGIN] Gửi callback:`, failResponse);
      return callback(failResponse);
    }
    
    const expectedPass = rooms[roomid].passwords[player];
    const clientPass = password ? String(password).trim() : "";
    
    console.log(`[VERIFY LOGIN] Expected password: "${expectedPass}"`);
    console.log(`[VERIFY LOGIN] Client password: "${clientPass}"`);
    console.log(`[VERIFY LOGIN] Có khớp không?: ${expectedPass === clientPass}`);

    if (expectedPass === null || expectedPass === undefined) {
      console.log(`[VERIFY LOGIN] ✗ FAIL: ${player} chưa có mật khẩu`);
      const failResponse = { success: false, msg: `Chưa thiết lập mật khẩu cho ${player}!` };
      console.log(`[VERIFY LOGIN] Gửi callback:`, failResponse);
      return callback(failResponse);
    }

    if (expectedPass === clientPass) {
      socket.join(roomid);
      myRoomId = roomid;
      console.log(`[VERIFY LOGIN] ✓ SUCCESS: ${player} đăng nhập thành công phòng ${roomid}`);
      const successResponse = { success: true };
      console.log(`[VERIFY LOGIN] Gửi callback:`, successResponse);
      callback(successResponse);
    } else {
      console.log(`[VERIFY LOGIN] ✗ FAIL: Mật khẩu không khớp`);
      const failResponse = { success: false, msg: "Mật khẩu xác thực người chơi nhập vào chưa chính xác!" };
      console.log(`[VERIFY LOGIN] Gửi callback:`, failResponse);
      callback(failResponse);
    }
  });

  socket.on('techChangeImage', (imageName) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    rooms[myRoomId].wheelState.activeImage = imageName;
    io.to(myRoomId).emit('playerUpdateImage', imageName);
  });

  socket.on('techResetWheel', () => {
    if (!myRoomId || !rooms[myRoomId]) return;
    let ws = rooms[myRoomId].wheelState;
    ws.rotation = 0; ws.velocity = 0; ws.baseRotation = 0;
    ws.initVelocity = 0; ws.spinStartTime = 0; ws.isDraggingSync = false;
    io.to(myRoomId).emit('playerSyncPhysics', { rotation: 0, velocity: 0 });
  });

  socket.on('techSetAllowedPlayer', (player) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    rooms[myRoomId].allowedPlayer = player;
    io.to(myRoomId).emit('syncAllowedPlayer', player);
  });

  socket.on('techPlaySound', (soundName) => {
    if (!myRoomId) return;
    io.to(myRoomId).emit('listenSoundboard', soundName);
  });

  socket.on('playerUpdatePhysics', (data) => {
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
      if (!data.isDraggingSync) {
        ws.spinStartTime = 0;
      }
      ws.isDraggingSync = data.isDraggingSync || false;
    }
    if (data.rotation !== undefined) ws.rotation = data.rotation;
     
    io.to(myRoomId).emit('playerSyncPhysics', data);
  });

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

  socket.on('playerStopWheel', (data) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    let ws = rooms[myRoomId].wheelState;
    ws.rotation = data.rotation;
    ws.velocity = 0; ws.baseRotation = 0; ws.initVelocity = 0; ws.spinStartTime = 0; ws.isDraggingSync = false;
    io.to(myRoomId).emit('playerSyncPhysics', { rotation: data.rotation, velocity: 0 });
  });

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