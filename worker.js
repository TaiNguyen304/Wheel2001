// worker.js - Xử lý tính toán logic vật lý ngầm chuẩn hóa toàn cầu
let timer = null;
let currentRotation = 0;
let baseRotation = 0;
let initVelocity = 0;
let spinStartTime = 0;
let isSpinningFree = false;
const friction = 0.995;
const pinAngleStep = 15;
let lastClickAngleIndex = 0;
let targetSeconds = 20; // Sẽ được cập nhật động

self.onmessage = function (e) {
  const data = e.data;

  if (data.type === 'START_PHYSICS') {
    baseRotation = data.baseRotation;
    initVelocity = data.initVelocity;
    spinStartTime = data.spinStartTime;
    // CẬP NHẬT: Nhận cấu hình thời gian quay thực tế từ main thread gửi vào
    if (data.targetSeconds) {
      targetSeconds = data.targetSeconds;
    }
    isSpinningFree = true;
    if (!timer) startLoop();
  } 
  else if (data.type === 'SYNC_STATIC') {
    currentRotation = data.rotation;
    isSpinningFree = false;
    spinStartTime = 0;
    initVelocity = 0;
    if (!timer) startLoop();
  } 
  else if (data.type === 'STOP_WORKER') {
    clearInterval(timer);
    timer = null;
  }
};

function calculatePhysics(serverNow) {
  if (!isSpinningFree || spinStartTime === 0) {
    return { r: currentRotation, v: 0 };
  }

  const t = (serverNow - spinStartTime) / 1000;
  if (t < 0) return { r: baseRotation, v: initVelocity };

  // Kiểm tra nếu thời gian trôi qua vượt quá thời gian thiết lập quay nón
  if (t >= targetSeconds) {
    isSpinningFree = false;
    const finalRotation = baseRotation + (initVelocity * (1 - Math.pow(friction, targetSeconds * 60))) / (1 - friction) / 60;
    return { r: finalRotation, v: 0 };
  }

  const currentVelocity = initVelocity * Math.pow(friction, t * 60);
  
  // Điều kiện dừng an toàn dựa trên vận tốc cận 0
  if (Math.abs(currentVelocity) < 0.1) {
    isSpinningFree = false;
    const targetRotation = baseRotation + (initVelocity / ((1 - friction) * 60));
    return { r: targetRotation, v: 0 };
  }

  const computedRotation = baseRotation + (initVelocity * (1 - Math.pow(friction, t * 60))) / (1 - friction) / 60;
  return { r: computedRotation, v: currentVelocity };
}

function startLoop() {
  timer = setInterval(() => {
    self.postMessage({ type: 'TICK' });
  }, 30);
}

self.addEventListener('message', function(e) {
  if (e.data.type === 'TICK_RESPONSE') {
    const state = calculatePhysics(e.data.serverNow);
    currentRotation = state.r;

    let normalizedRotation = currentRotation % 360;
    if (normalizedRotation < 0) normalizedRotation += 360;
    let currentAngleIndex = Math.floor(normalizedRotation / pinAngleStep);
    let triggerClick = false;

    if (currentAngleIndex !== lastClickAngleIndex) {
      lastClickAngleIndex = currentAngleIndex;
      triggerClick = true;
    }

    self.postMessage({
      type: 'PHYSICS_UPDATE',
      rotation: currentRotation,
      velocity: state.v,
      isSpinningFree: isSpinningFree,
      triggerClick: triggerClick
    });
  }
});