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

// Hàm khởi tạo phòng nếu chưa tồn tại (Đã sửa lỗi cú pháp ngoặc nhọn và dấu phẩy)
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

  // Khi Tech khởi tạo hoặc nạp cấu hình phòng
  socket.on('techCreateRoom', (data) => {
    const { roomid, passwords } = data;
    if (!roomid) return;
    
    initRoomIfNotExist(roomid);

    rooms[roomid].passwords = {
      "Player 1": passwords?.["Player 1"] !== undefined ? String(passwords["Player 1"]).trim() : null,
      "Player 2": passwords?.["Player 2"] !== undefined ? String(passwords["Player 2"]).trim() : null,
      "Player 3": passwords?.["Player 3"] !== undefined ? String(passwords["Player 3"]).trim() : null
    };

    console.log(`[SERVER] Tech đã thiết lập phòng: ${roomid}`, rooms[roomid].passwords);
  });

  // Khi Tech thay đổi mặt nón trực tuyến
  socket.on('techChangeImage', (data) => {
    const roomid = data?.roomid || myRoomId;
    const imageName = data?.imageName || data;

    if (!roomid || !rooms[roomid]) return;
    
    rooms[roomid].wheelState.activeImage = imageName;
    io.to(roomid).emit('playerUpdateImage', imageName);
    console.log(`[SERVER] Phòng ${roomid} cập nhật mặt nón: ${imageName}`);
  });

  // Khi Tech bấm Reset nón về 0 độ
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

    io.to(roomid).emit('playerSyncPhysics', { rotation: 0, velocity: 0 });
    console.log(`[SERVER] Phòng ${roomid} đã đặt lại vòng quay về góc 0`);
  });

  // Khi Tech điều phối cấp/khóa quyền quay nón của Player
  socket.on('techSetAllowedPlayer', (data) => {
    const roomid = data?.roomid || myRoomId;
    const player = data && Object.prototype.hasOwnProperty.call(data, 'player') ? data.player : data;

    if (!roomid || !rooms[roomid]) return;
    
    rooms[roomid].allowedPlayer = player;
    io.to(roomid).emit('syncAllowedPlayer', player);
    console.log(`[SERVER] Phòng ${roomid} thay đổi quyền quay. Cho phép: ${player}`);
  });

  // Phát âm thanh Soundboard đến phòng tương ứng
  socket.on('techPlaySound', (data) => {
    const roomid = data?.roomid || myRoomId;
    const soundName = data?.soundName || data;

    if (!roomid) return;
    io.to(roomid).emit('listenSoundboard', soundName);
    console.log(`[SERVER] Phòng ${roomid} phát âm thanh mạng: ${soundName}`);
  });

  // Xử lý kiểm tra tài khoản khi Player/Viewer kết nối vào phòng (Dùng cho form cũ của bạn)
  socket.on('joinRoom', (data) => {
    const { roomid, role, password } = data;
    if (!roomid) return;

    initRoomIfNotExist(roomid);
    myRoomId = roomid;
    socket.join(roomid);

    if (role === 'viewer') {
      socket.emit('loginResult', { success: true, role: 'viewer' });
      socket.emit('initGameState', {
        activeImage: rooms[roomid].wheelState.activeImage,
        allowedPlayer: rooms[roomid].allowedPlayer
      });
      return;
    }

    if (role === 'player' && password) {
      const savedPass = rooms[roomid].passwords[password.playerRole];
      const clientPass = password.playerPassword !== undefined ? String(password.playerPassword).trim() : "";

      if (savedPass !== null && savedPass === clientPass) {
        socket.emit('loginResult', { success: true, role: 'player', playerRole: password.playerRole });
        socket.emit('initGameState', {
          activeImage: rooms[roomid].wheelState.activeImage,
          allowedPlayer: rooms[roomid].allowedPlayer
        });
        console.log(`[SERVER] ${password.playerRole} đăng nhập THÀNH CÔNG vào phòng ${roomid}`);
      } else {
        socket.emit('loginResult', { success: false, message: 'Sai thông tin phòng hoặc mật khẩu!' });
        console.log(`[SERVER] ${password.playerRole} đăng nhập THẤT BẠI vào phòng ${roomid}`);
      }
    }
  });

  // Xác thực đăng nhập qua callback (Khuyên dùng phương thức này)
  socket.on('verifyLogin', (data, callback) => {
    const { roomid, playerRole, playerPassword } = data;
    if (!roomid) return callback({ success: false, message: 'Thiếu mã phòng!' });

    initRoomIfNotExist(roomid);

    const savedPass = rooms[roomid].passwords[playerRole];
    const clientPass = playerPassword !== undefined ? String(playerPassword).trim() : "";

    if (savedPass !== null && savedPass === clientPass) {
      myRoomId = roomid;
      socket.join(roomid);
      
      // Phản hồi kết quả ngay lập tức qua callback
      callback({ success: true, playerRole });

      // Gửi cấu hình ban đầu cho client vừa đăng nhập thành công
      socket.emit('initGameState', {
        activeImage: rooms[roomid].wheelState.activeImage,
        allowedPlayer: rooms[roomid].allowedPlayer
      });
      console.log(`[SERVER] ${playerRole} đăng nhập THÀNH CÔNG qua verifyLogin vào phòng ${roomid}`);
    } else {
      callback({ success: false, message: 'Mật khẩu hoặc phòng không chính xác!' });
    }
  });

  // Đồng bộ trạng thái vật lý khi có người kéo và thả nón
  socket.on('playerUpdatePhysics', (data) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    const ws = rooms[myRoomId].wheelState;

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

    // Phát lại cho toàn bộ người chơi khác trong phòng trừ người gửi
    socket.broadcast.to(myRoomId).emit('playerSyncPhysics', data);
  });

  // Khi nón dừng hẳn, ép trạng thái vận tốc về 0 độ để tránh lệch trục giữa các máy
  socket.on('playerStopWheel', (data) => {
    if (!myRoomId || !rooms[myRoomId]) return;
    const ws = rooms[myRoomId].wheelState;
    
    ws.rotation = data.rotation;
    ws.velocity = 0;
    ws.baseRotation = 0;
    ws.initVelocity = 0;
    ws.spinStartTime = 0;
    ws.isDraggingSync = false;
    
    io.to(myRoomId).emit('playerSyncPhysics', { rotation: data.rotation, velocity: 0 });
  });

  // Event debug lấy toàn bộ phòng đang chạy trên server
  socket.on('debugGetAllRooms', (callback) => {
    const roomsList = {};
    for (const roomid in rooms) {
      roomsList[roomid] = rooms[roomid].passwords;
    }
    if (typeof callback === 'function') callback(roomsList);
  });

  // Xử lý khi ngắt kết nối
  socket.on('disconnect', () => {
    if (myRoomId) {
      socket.leave(myRoomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER RUNNING] Máy chủ vận hành mượt mà tại cổng http://localhost:${PORT}`);
});