// Application State
let scene, camera, renderer, world;
let playAreaSet = false;
let groundBody, playMatMesh;
let cubes = [];
let activeCube = null;

// Two-Hand Surface Placement State
let leftHandPos = new THREE.Vector3(-0.15, -0.2, -0.45);
let rightHandPos = new THREE.Vector3(0.15, -0.2, -0.45);
let dynamicSurfacePos = new THREE.Vector3(0, -0.2, -0.45);
let dynamicSurfaceWidth = 0.5;

// Gestures & Tracking State
let isPinching = false;
let lastPinchTime = 0;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// DOM References
const videoElement = document.getElementById('webcam');
const cursor0 = document.getElementById('hand-cursor-0');
const cursor1 = document.getElementById('hand-cursor-1');
const metricsBar = document.getElementById('metrics-bar');
const instructionBanner = document.getElementById('instruction-banner');
const btnSetArea = document.getElementById('btn-set-area');
const btnDropCube = document.getElementById('btn-drop-cube');
const btnReset = document.getElementById('btn-reset');
const cubeCountLabel = document.getElementById('cube-count');
const towerHeightLabel = document.getElementById('tower-height');

// 1. Initialize Engine & Canvas
function initEngine() {
  const container = document.getElementById('canvas-container');

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(0, 2, 1);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // Physics World
  world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);

  const defaultMat = new CANNON.Material('default');
  const contactMat = new CANNON.ContactMaterial(defaultMat, defaultMat, {
    friction: 1.0,
    restitution: 0.0 // Zero bounciness
  });
  world.addContactMaterial(contactMat);

  setupDynamicSurfacePreview();

  window.addEventListener('resize', onResize);
  setupUIEvents();
  initHandTracking();
  renderLoop();
}

// 2. Setup Glowing Preview Surface for Two-Hand Placement
function setupDynamicSurfacePreview() {
  const geo = new THREE.PlaneGeometry(0.5, 0.3);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide
  });
  playMatMesh = new THREE.Mesh(geo, mat);
  playMatMesh.rotation.x = -Math.PI / 2;
  playMatMesh.position.copy(dynamicSurfacePos);
  scene.add(playMatMesh);
}

// Update Surface Position & Width in real time based on 2 Hands
function updateSurfaceFromTwoHands(h1, h2) {
  if (playAreaSet) return;

  // Convert normalized hand points to 3D camera space
  const ray1 = getRayFromNormalizedScreen(h1.x, h1.y);
  const ray2 = getRayFromNormalizedScreen(h2.x, h2.y);

  ray1.at(0.45, leftHandPos);
  ray2.at(0.45, rightHandPos);

  // Midpoint between hands becomes surface center
  dynamicSurfacePos.addVectors(leftHandPos, rightHandPos).multiplyScalar(0.5);

  // Distance between hands defines surface width
  dynamicSurfaceWidth = Math.max(0.25, Math.min(0.8, leftHandPos.distanceTo(rightHandPos)));

  playMatMesh.position.copy(dynamicSurfacePos);
  playMatMesh.scale.set(dynamicSurfaceWidth / 0.5, 1, 1);
}

function getRayFromNormalizedScreen(nx, ny) {
  // Mirror X coordinate because front camera video is mirrored (scaleX(-1))
  const mirroredX = 1.0 - nx;
  mouse.x = mirroredX * 2 - 1;
  mouse.y = -ny * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  return raycaster.ray;
}

// 3. Lock Virtual Surface in 3D Space
function confirmPlayArea() {
  playAreaSet = true;
  btnSetArea.classList.add('hidden');

  metricsBar.classList.remove('hidden');
  btnDropCube.classList.remove('hidden');
  btnReset.classList.remove('hidden');

  instructionBanner.innerText = "Pinch & drag to stack • Double-pinch in mid-air to spawn cube";

  // Lock Surface Appearance
  playMatMesh.material.color.setHex(0x00ff88);
  playMatMesh.material.opacity = 0.35;

  // Lock Static Immovable Cannon Physics Floor at Virtual Surface position
  const groundShape = new CANNON.Box(new CANNON.Vec3(dynamicSurfaceWidth / 2, 0.005, 0.2));
  groundBody = new CANNON.Body({ mass: 0 }); // Mass 0 = Fixed floor
  groundBody.addShape(groundShape);
  groundBody.position.set(dynamicSurfacePos.x, dynamicSurfacePos.y - 0.005, dynamicSurfacePos.z);
  world.addBody(groundBody);
}

// 4. Spawn Heavy 6cm Cubes
function spawnCube(x, y, z) {
  const size = 0.06;
  const colors = [0x00ffff, 0x00ff88, 0xffaa00, 0xff0055, 0xaa00ff];
  const chosenColor = colors[Math.floor(Math.random() * colors.length)];

  const geo = new THREE.BoxGeometry(size, size, size);
  const mat = new THREE.MeshStandardMaterial({ color: chosenColor, roughness: 0.2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Cannon Rigid Body (1.2 kg heavy feel)
  const shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
  const body = new CANNON.Body({ mass: 1.2 });
  body.addShape(shape);
  body.position.set(x, y, z);
  world.addBody(body);

  cubes.push({ mesh, body });
  updateTowerStats();
}

// 5. MediaPipe Hand Tracking Setup (Front Selfie Camera, 2 Hands)
async function initHandTracking() {
  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 2, // Track up to 2 hands simultaneously
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  hands.onResults(onHandResults);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });

    videoElement.srcObject = stream;
    await videoElement.play();

    async function processFrame() {
      if (!videoElement.paused && !videoElement.ended) {
        await hands.send({ image: videoElement });
      }
      requestAnimationFrame(processFrame);
    }
    processFrame();

  } catch (err) {
    console.error("Front camera error:", err);
    alert("Please allow front camera permissions in Safari.");
  }
}

// Handle Hand Landmarks
function onHandResults(results) {
  const numHands = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;

  cursor0.classList.add('hidden');
  cursor1.classList.add('hidden');

  if (numHands === 2 && !playAreaSet) {
    // Mode 1: Surface Creation with 2 Hands
    const h0 = results.multiHandLandmarks[0][8]; // Index tip hand 0
    const h1 = results.multiHandLandmarks[1][8]; // Index tip hand 1

    positionCursor(cursor0, h0);
    positionCursor(cursor1, h1);

    updateSurfaceFromTwoHands(h0, h1);
    instructionBanner.innerText = "Table aligned with hands! Tap LOCK VIRTUAL TABLE";

  } else if (numHands >= 1) {
    // Mode 2: Cube Stacking & Pinch Control
    const landmarks = results.multiHandLandmarks[0];
    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];

    positionCursor(cursor0, indexTip);

    const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
    const currentlyPinching = pinchDist < 0.08;

    if (currentlyPinching) {
      cursor0.classList.add('pinching');
    } else {
      cursor0.classList.remove('pinching');
    }

    // Double Pinch Gesture (Spawn Cube)
    if (currentlyPinching && !isPinching) {
      const now = Date.now();
      if (now - lastPinchTime < 400 && playAreaSet) {
        const screenX = (1.0 - (indexTip.x + thumbTip.x) / 2) * window.innerWidth;
        const screenY = ((indexTip.y + thumbTip.y) / 2) * window.innerHeight;
        spawnCubeAtScreenPoint(screenX, screenY);
      }
      lastPinchTime = now;
    }

    isPinching = currentlyPinching;

    if (playAreaSet) {
      const screenX = (1.0 - (indexTip.x + thumbTip.x) / 2) * window.innerWidth;
      const screenY = ((indexTip.y + thumbTip.y) / 2) * window.innerHeight;
      handlePinchInteraction(screenX, screenY, isPinching);
    }
  } else if (!playAreaSet) {
    instructionBanner.innerText = "Hold out BOTH hands to span your virtual table surface";
  }
}

function positionCursor(element, landmark) {
  element.classList.remove('hidden');
  // Mirror X coordinate to match video mirror scaleX(-1)
  const screenX = (1.0 - landmark.x) * window.innerWidth;
  const screenY = landmark.y * window.innerHeight;
  element.style.left = `${screenX}px`;
  element.style.top = `${screenY}px`;
}

// 6. Pinch Grab & Vertical Lift Logic
function handlePinchInteraction(screenX, screenY, pinching) {
  mouse.x = (screenX / window.innerWidth) * 2 - 1;
  mouse.y = -(screenY / window.innerHeight) * 2 + 1;

  if (pinching) {
    if (!activeCube) {
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(cubes.map(c => c.mesh));

      if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        activeCube = cubes.find(c => c.mesh === hitMesh);
        if (activeCube) {
          activeCube.body.type = CANNON.Body.KINEMATIC;
          activeCube.body.velocity.set(0, 0, 0);
        }
      }
    } else {
      raycaster.setFromCamera(mouse, camera);
      const targetPos = new THREE.Vector3();
      raycaster.ray.at(0.40, targetPos);

      activeCube.body.position.set(targetPos.x, targetPos.y, targetPos.z);
    }
  } else {
    if (activeCube) {
      activeCube.body.type = CANNON.Body.DYNAMIC;
      activeCube.body.wakeUp();
      activeCube = null;
      updateTowerStats();
    }
  }
}

function spawnCubeAtScreenPoint(screenX, screenY) {
  mouse.x = (screenX / window.innerWidth) * 2 - 1;
  mouse.y = -(screenY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const targetPos = new THREE.Vector3();
  raycaster.ray.at(0.35, targetPos);

  spawnCube(targetPos.x, targetPos.y, targetPos.z);
}

function updateTowerStats() {
  cubeCountLabel.innerText = cubes.length;
  let maxY = dynamicSurfacePos.y;
  cubes.forEach(c => {
    if (c.body.position.y > maxY) {
      maxY = c.body.position.y;
    }
  });
  const heightInMeters = Math.max(0, maxY - dynamicSurfacePos.y).toFixed(2);
  towerHeightLabel.innerText = `${heightInMeters} m`;
}

function resetSpace() {
  cubes.forEach(c => {
    scene.remove(c.mesh);
    world.remove(c.body);
  });
  cubes = [];
  updateTowerStats();
}

function setupUIEvents() {
  btnSetArea.addEventListener('click', confirmPlayArea);
  btnDropCube.addEventListener('click', () => {
    spawnCube(dynamicSurfacePos.x, dynamicSurfacePos.y + 0.30, dynamicSurfacePos.z);
  });
  btnReset.addEventListener('click', resetSpace);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function renderLoop() {
  requestAnimationFrame(renderLoop);

  world.step(1 / 60);

  cubes.forEach(c => {
    c.mesh.position.copy(c.body.position);
    c.mesh.quaternion.copy(c.body.quaternion);
  });

  renderer.render(scene, camera);
}

initEngine();
