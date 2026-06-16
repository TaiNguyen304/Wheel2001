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

// Lưu trữ trạng thái các phòng
const rooms = {};

// Hàm khởi tạo phòng nếu chưa tồn tại
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
  let myRole = null; // Lưu lại role của socket này để kiểm soát quyền hạn

  // Khi Tech khởi tạo hoặc nạp cấu hình phòng
  socket.on('techSetupRoom', (data, callback) => {
    myRoomId = data.roomid;
    myRole = 'Tech';
    initRoomIfNotExist(myRoomId);
    socket.join(myRoomId);

    if (data.passwords) {
      rooms[myRoomId].passwords = { ...data.passwords };
    }
    
    // Gửi cập nhật toàn bộ trạng thái nón cho phòng nếu có cấu hình mới
    io.to(myRoomId).emit('initGameState', rooms[myRoomId].wheelState);
    
    if (callback) callback({ success: true });
  });

  // Khi một client (Player hoặc Viewer) đăng ký vào phòng
  socket.on('playerRegisterRoom', (data, callback) => {
    const { roomid, role, password } = data;
    
    // Khởi tạo phòng nếu chưa có cấu hình trước đó
    initRoomIfNotExist(roomid);
    myRoomId = roomid;
    myRole = role; // Lưu role: 'Player 1', 'Player 2', 'Player 3', hoặc 'Viewer'

    // Xử lý riêng cho Viewer công khai không cần mật khẩu
    if (role === 'Viewer') {
      socket.join(myRoomId);
      console.log(`[SERVER] Thêm thành công một Viewer vào phòng: ${myRoomId}`);
      if (callback) {
        return callback({ 
          success: true, 
          state: rooms[myRoomId].wheelState,
          allowedPlayer: rooms[myRoomId].allowedPlayer
        });
      }
      return;
    }

    // Xác thực mật khẩu đối với các máy Player
    if (rooms[myRoomId].passwords[role] === password) {
      socket.join(myRoomId);
      if (callback) {
        callback({ 
          success: true, 
          state: rooms[myRoomId].wheelState,
          allowedPlayer: rooms[myRoomId].allowedPlayer
        });
      }
    } else {
      if (callback) callback({ success: false, message: "Sai mật khẩu phòng!" });
    }
  });

  // Khi Tech cấp quyền xoay nón cho một Player cụ thể
  socket.on('techAllowPlayer', (playerRole) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    rooms[myRoomId].allowedPlayer = playerRole;
    io.to(myRoomId).emit('syncAllowedPlayer', playerRole);
  });

  // Khi Tech phát âm thanh Soundboard
  socket.on('techTriggerSound', (soundName) => {
    if (!myRoomId) return;
    io.to(myRoomId).emit('listenSoundboard', soundName);
  });

  // Khi Tech thay đổi ảnh mặt nón (Mọi thành viên trong phòng bao gồm Viewer đều sẽ nhận được)
  socket.on('techUpdateImage', (data) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    rooms[myRoomId].wheelState.activeImage = data.imageName;
    
    // Dùng io.to thay vì broadcast để đảm bảo gửi trọn vẹn không sót một ai trong phòng
    io.to(myRoomId).emit('playerUpdateImage', data.imageName);
  });

  // Đồng bộ vật lý vòng quay realtime
  socket.on('playerSyncPhysics', (data) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    
    // CHẶN TUYỆT ĐỐI: Nếu role là Viewer mà cố phát tín hiệu quay, server sẽ từ chối xử lý
    if (myRole === 'Viewer') {
      console.log(`[SECURITY] Chặn hành vi cố tình tác động vòng quay từ Viewer!`);
      return;
    }

    const ws = rooms[myRoomId].wheelState;
    if (data.spinStartTime) {
      ws.baseRotation = data.baseRotation;
      ws.initVelocity = data.initVelocity;
      ws.spinStartTime = data.spinStartTime;
      ws.isDraggingSync = false;
    } else {
      ws.rotation = data.rotation;
      ws.velocity = data.velocity ?? 0;
      ws.spinStartTime = 0;
      ws.isDraggingSync = data.isDraggingSync || false;
    }
    if (data.rotation !== undefined) ws.rotation = data.rotation;

    // Phát lại cho toàn bộ mọi người trong phòng ngoại trừ người quay
    socket.broadcast.to(myRoomId).emit('playerSyncPhysics', data);
  });

  // Khi nón dừng hẳn
  socket.on('playerStopWheel', (data) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    
    // CHẶN TUYỆT ĐỐI tác động dừng nón từ Viewer
    if (myRole === 'Viewer') return;

    const ws = rooms[myRoomId].wheelState;
    ws.rotation = data.rotation;
    ws.velocity = 0;
    ws.baseRotation = 0;
    ws.initVelocity = 0;
    ws.spinStartTime = 0;
    ws.isDraggingSync = false;
    
    io.to(myRoomId).emit('playerSyncPhysics', { rotation: data.rotation, velocity: 0 });
  });

  // Lấy toàn bộ danh sách phòng (Debug)
  socket.on('debugGetAllRooms', (callback) => {
    const roomsList = {};
    for (const roomid in rooms) {
      roomsList[roomid] = rooms[roomid].passwords;
    }
    if (callback) callback(roomsList);
  });

  socket.on('disconnect', () => {
    console.log(`Một kết nối rời khỏi hệ thống.`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server đang chạy tại port ${PORT}`);
});