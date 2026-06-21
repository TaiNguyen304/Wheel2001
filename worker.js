// worker.js - Xử lý tính toán logic vật lý ngầm không phụ thuộc vào Tab ẩn/hiện
let timer = null;
let currentRotation = 0;
let baseRotation = 0;
let initVelocity = 0;
let spinStartTime = 0;
let isSpinningFree = false;
const friction = 0.995;
const pinAngleStep = 15;
let lastClickAngleIndex = 0;
let targetSeconds = 20;

self.onmessage = function (e) {
  const data = e.data;

  if (data.type === 'START_PHYSICS') {
    baseRotation = data.baseRotation;
    initVelocity = data.initVelocity;
    spinStartTime = data.spinStartTime;
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

  const targetRotation = baseRotation + (initVelocity / ((1 - friction) * 60));
  const currentVelocity = initVelocity * Math.pow(friction, t * 60);

  if (Math.abs(currentVelocity) < 0.2) {
    isSpinningFree = false;
    return { r: targetRotation, v: 0 };
  }

  const computedRotation = baseRotation + (initVelocity * (1 - Math.pow(friction, t * 60))) / (1 - friction) / 60;
  return { r: computedRotation, v: currentVelocity };
}

function startLoop() {
  timer = setInterval(() => {
    // Kích hoạt Main Thread đẩy dữ liệu thời gian đã đồng bộ về để tính toán
    self.postMessage({
      type: 'TICK'
    });
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