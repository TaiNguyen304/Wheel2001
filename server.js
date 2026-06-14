const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Phục vụ các file tĩnh như html, hình ảnh, âm thanh nếu bạn bỏ chung vào thư mục public
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// CẤU TRÚC LẠI TRẠNG THÁI NÓN ĐỂ ĐỒNG BỘ THEO MỐC THỜI GIAN THỰC TOÀN CỤC
let wheelState = {
  activeImage: 'wheel-template.png', // Mặt nón mặc định ban đầu
  rotation: 0,
  velocity: 0,
  baseRotation: 0,
  initVelocity: 0,
  spinStartTime: 0,      // Mốc thời gian thực toàn cầu (Unix Timestamp) lúc bắt đầu văng
  isDraggingSync: false  // Trạng thái đang bị một tab nào đó giữ và kéo rê
};

io.on('connection', (socket) => {
  // 1. Khi có bất kỳ tab nào kết nối (hoặc reload), gửi ngay trạng thái thực tế gần nhất
  socket.emit('initGameState', wheelState);

  // 2. Lắng nghe sự kiện đổi mặt nón từ Tech
  socket.on('techChangeImage', (imageName) => {
    wheelState.activeImage = imageName;
    io.emit('playerUpdateImage', imageName);
  });

  // 3. Lắng nghe sự kiện reset nón về góc 0 từ Tech
  socket.on('techResetWheel', () => {
    wheelState.rotation = 0;
    wheelState.velocity = 0;
    wheelState.baseRotation = 0;
    wheelState.initVelocity = 0;
    wheelState.spinStartTime = 0;
    wheelState.isDraggingSync = false;
    io.emit('playerSyncPhysics', { rotation: 0, velocity: 0 });
  });

  // 4. Lắng nghe dữ liệu dịch chuyển vật lý thời gian thực từ Player đang tương tác
  socket.on('playerMoveWheel', (data) => {
    // Lưu trữ trạng thái động vào bộ nhớ Server dựa trên gói tin Client gửi lên
    if (data.spinStartTime) {
      // Trường hợp Nón đang tự văng tự do liên tab (Sử dụng mốc thời gian thực toán học)
      wheelState.baseRotation = data.baseRotation;
      wheelState.initVelocity = data.initVelocity;
      wheelState.spinStartTime = data.spinStartTime;
      wheelState.velocity = data.initVelocity;
      wheelState.isDraggingSync = false;
    } else {
      // Trường hợp Nón đang tĩnh hoặc đang bị kéo rê bằng tay chuột
      wheelState.rotation = data.rotation;
      wheelState.velocity = data.velocity ?? 0;
      wheelState.spinStartTime = 0; // Reset mốc văng tự do
      wheelState.isDraggingSync = data.isDraggingSync || false;
    }
    
    // Lưu trữ dự phòng biến rotation chung
    if (data.rotation !== undefined) {
      wheelState.rotation = data.rotation;
    }

    // Phát tán mốc trạng thái này cho TẤT CẢ các máy khác, bất kể ẩn hay hiện tab để đồng bộ tức thì
    socket.broadcast.emit('playerSyncPhysics', data);
  });

  // 5. Cập nhật trạng thái tĩnh khi nón đã dừng hẳn (đảm bảo đồng bộ tuyệt đối khi reload)
  socket.on('playerStopWheel', (data) => {
    wheelState.rotation = data.rotation;
    wheelState.velocity = 0;
    wheelState.baseRotation = 0;
    wheelState.initVelocity = 0;
    wheelState.spinStartTime = 0;
    wheelState.isDraggingSync = false;
    
    // Phát lệnh dừng đồng bộ cứng đến toàn bộ các tab
    io.emit('playerSyncPhysics', { rotation: data.rotation, velocity: 0 });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server đang chạy tại port: ${PORT}`);
});