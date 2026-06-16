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

  // Xử lý kiểm tra tài khoản khi Player/Viewer kết nối vào phòng (Form cũ)
  socket.on('joinRoom', (data) => {
    const { roomid, role, password } = data;
    if (!roomid) return;

    initRoomIfNotExist(roomid);
    myRoomId = roomid;
    socket.join(roomid);

    if (role === 'viewer') {
      socket.myRole = 'viewer'; // Gắn nhãn phân quyền bảo mật cho kết nối này
      socket.emit('loginResult', { success: true, role: 'viewer' });
      socket.emit('initGameState', {
        activeImage: rooms[roomid].wheelState.activeImage,
        allowedPlayer: rooms[roomid].allowedPlayer,
        rotation: rooms[roomid].wheelState.rotation
      });
      return;
    }

    if (role === 'player' && password) {
      const savedPass = rooms[roomid].passwords[password.playerRole];
      const clientPass = password.playerPassword !== undefined ? String(password.playerPassword).trim() : "";

      if (savedPass !== null && savedPass === clientPass) {
        socket.myRole = password.playerRole;
        socket.emit('loginResult', { success: true, role: 'player', playerRole: password.playerRole });
        socket.emit('initGameState', {
          activeImage: rooms[roomid].wheelState.activeImage,
          allowedPlayer: rooms[roomid].allowedPlayer,
          rotation: rooms[roomid].wheelState.rotation
        });
        console.log(`[SERVER] ${password.playerRole} đăng nhập THÀNH CÔNG vào phòng ${roomid}`);
      } else {
        socket.emit('loginResult', { success: false, message: 'Sai thông tin phòng hoặc mật khẩu!' });
        console.log(`[SERVER] ${password.playerRole} đăng nhập THẤT BẠI vào phòng ${roomid}`);
      }
    }
  });

  // Xác thực đăng nhập qua callback (Hỗ trợ mở rộng tính năng đăng nhập Viewer trực tiếp)
  socket.on('playerVerifyLogin', (data, callback) => {
    const roomid = data?.roomid !== undefined ? String(data.roomid).trim() : "";
    const playerRole = data?.playerRole;
    const clientPass = data?.password !== undefined ? String(data.password).trim() : 
                       (data?.playerPassword !== undefined ? String(data.playerPassword).trim() : "");

    if (!roomid) {
      if (typeof callback === 'function') callback({ success: false, message: 'Thiếu mã phòng!' });
      return;
    }

    initRoomIfNotExist(roomid);

    // THÊM MỚI: Tiếp nhận luồng xử lý đăng ký Viewer chính quy thông qua cổng callback công khai
    if (playerRole === 'viewer') {
      myRoomId = roomid;
      socket.join(roomid);
      socket.myRole = 'viewer'; // Khóa phân quyền hệ thống bảo vệ vòng quay

      if (typeof callback === 'function') {
        callback({ success: true, playerRole: 'viewer' });
      }

      socket.emit('initGameState', {
        activeImage: rooms[roomid].wheelState.activeImage,
        allowedPlayer: rooms[roomid].allowedPlayer,
        rotation: rooms[roomid].wheelState.rotation
      });
      
      console.log(`[SERVER] Viewer đăng nhập thành công vào luồng quan sát phòng [${roomid}]`);
      return;
    }

    const savedPass = rooms[roomid].passwords[playerRole];

    // Tiến hành so khớp nghiêm ngặt sau khi đã đồng bộ về kiểu dữ liệu Chuỗi (String)
    if (savedPass !== null && savedPass !== undefined && String(savedPass).trim() === clientPass) {
      myRoomId = roomid;
      socket.join(roomid);
      socket.myRole = playerRole;
      
      if (typeof callback === 'function') {
        callback({ success: true, playerRole: playerRole });
      }

      socket.emit('initGameState', {
        activeImage: rooms[roomid].wheelState.activeImage,
        allowedPlayer: rooms[roomid].allowedPlayer,
        rotation: rooms[roomid].wheelState.rotation
      });
      
      console.log(`[SERVER] Người chơi [${playerRole}] đăng nhập THÀNH CÔNG vào phòng [${roomid}]`);
    } else {
      console.log(`[SERVER] Người chơi [${playerRole}] đăng nhập THẤT BẠI vào phòng [${roomid}] (Nhập: "${clientPass}" | Đúng: "${savedPass}")`);
      if (typeof callback === 'function') {
        callback({ success: false, message: 'Mật khẩu hoặc mã phòng không chính xác!' });
      }
    }
  });

  // Đồng bộ trạng thái vật lý khi có người kéo và thả nón
  socket.on('playerUpdatePhysics', (data) => {
    if (!myRoomId || !rooms[myRoomId]) return;

    // BẢO VỆ AN TOÀN: Từ chối xử lý tất cả các yêu cầu thay đổi dịch chuyển từ phía Viewer gửi lên
    if (socket.myRole === 'viewer') {
      console.warn(`[SECURITY WARN] Chặn đứng gói tin playerUpdatePhysics từ luồng Viewer ở phòng: ${myRoomId}`);
      return;
    }

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

    // BẢO VỆ AN TOÀN: Chặn đứng hành vi ép dừng nón từ phía Viewer gửi lên
    if (socket.myRole === 'viewer') {
      console.warn(`[SECURITY WARN] Chặn đứng gói tin playerStopWheel từ luồng Viewer ở phòng: ${myRoomId}`);
      return;
    }

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