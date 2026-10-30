// Application State
let scene, camera, renderer, world;
let playAreaSet = false;
let groundBody, playMatMesh;
let cubes = [];
let activeCube = null;

// Gestures & Tracking State
let isPinching = false;
let lastPinchTime = 0;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// DOM References
const videoElement = document.getElementById('webcam');
const cursorElement = document.getElementById('hand-cursor');
const reticleElement = document.getElementById('center-reticle');
const metricsBar = document.getElementById('metrics-bar');
const instructionBanner = document.getElementById('instruction-banner');
const btnSetArea = document.getElementById('btn-set-area');
const btnDropCube = document.getElementById('btn-drop-cube');
const btnReset = document.getElementById('btn-reset');
const cubeCountLabel = document.getElementById('cube-count');
const towerHeightLabel = document.getElementById('tower-height');

// 1. Initialize 3D Engine & Physics
function initEngine() {
  const container = document.getElementById('canvas-container');

  // Three.js Render Scene Setup
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Realistic Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(0.5, 2, 1);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // Cannon.js Physics Engine Setup
  world = new CANNON.World();
  world.gravity.set(0, -9.82, 0); // Real Earth gravity

  // Material with High Friction & Zero Bounce for Solid Stacking
  const defaultMat = new CANNON.Material('default');
  const contactMat = new CANNON.ContactMaterial(defaultMat, defaultMat, {
    friction: 1.0,
    restitution: 0.0
  });
  world.addContactMaterial(contactMat);

  window.addEventListener('resize', onResize);
  setupUIEvents();
  initHandTracking();
  renderLoop();
}

// 2. Set Up Play Area Surface
function confirmPlayArea() {
  playAreaSet = true;
  reticleElement.classList.add('hidden');
  btnSetArea.classList.add('hidden');
  
  metricsBar.classList.remove('hidden');
  btnDropCube.classList.remove('hidden');
  btnReset.classList.remove('hidden');
  
  instructionBanner.innerText = "Pinch & drag to stack • Double-pinch in mid-air to spawn cube";

  // Desktop Play Mat Mesh (50cm x 50cm)
  const geo = new THREE.PlaneGeometry(0.5, 0.5);
  const mat = new THREE.MeshStandardMaterial({ 
    color: 0x00ff88, 
    transparent: true, 
    opacity: 0.35, 
    side: THREE.DoubleSide 
  });
  playMatMesh = new THREE.Mesh(geo, mat);
  playMatMesh.rotation.x = -Math.PI / 2;
  playMatMesh.position.set(0, -0.25, -0.45); // Positioned 45cm away at desk level
  scene.add(playMatMesh);

  // Immovable Ground Static Physics Collider
  const groundShape = new CANNON.Box(new CANNON.Vec3(0.25, 0.005, 0.25));
  groundBody = new CANNON.Body({ mass: 0 }); // Mass 0 = Fixed ground
  groundBody.addShape(groundShape);
  groundBody.position.set(0, -0.255, -0.45);
  world.addBody(groundBody);
}

// 3. Spawn 6cm Weighted Cube
function spawnCube(x, y, z) {
  const size = 0.06; // 6cm box
  const colors = [0x00ffff, 0x00ff88, 0xffaa00, 0xff0055, 0xaa00ff];
  const chosenColor = colors[Math.floor(Math.random() * colors.length)];

  // Three.js Mesh
  const geo = new THREE.BoxGeometry(size, size, size);
  const mat = new THREE.MeshStandardMaterial({ color: chosenColor, roughness: 0.2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Cannon Physics Rigid Body (1.2 kg heavy feel)
  const shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
  const body = new CANNON.Body({ mass: 1.2 });
  body.addShape(shape);
  body.position.set(x, y, z);
  world.addBody(body);

  cubes.push({ mesh, body });
  updateTowerStats();
}

// 4. MediaPipe Hand Tracking Setup
// 4. MediaPipe Hand Tracking Setup (Configured for Rear Camera)
function initHandTracking() {
  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  hands.onResults(onHandResults);

  const cameraUtils = new Camera(videoElement, {
    onFrame: async () => {
      await hands.send({ image: videoElement });
    },
    width: 1280,
    height: 720,
    facingMode: 'environment' // Forces iPad back camera
  });

  cameraUtils.start();
}

// Process Hand Frames
function onHandResults(results) {
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];

    // Index Tip (#8) and Thumb Tip (#4)
    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];

    // Screen Space Center Point
    const screenX = ((indexTip.x + thumbTip.x) / 2) * window.innerWidth;
    const screenY = ((indexTip.y + thumbTip.y) / 2) * window.innerHeight;

    // Position Hand Cursor Dot
    cursorElement.classList.remove('hidden');
    cursorElement.style.left = `${screenX}px`;
    cursorElement.style.top = `${screenY}px`;

    // Measure Pinch Distance
    const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
    const currentlyPinching = pinchDist < 0.08;

    if (currentlyPinching) {
      cursorElement.classList.add('pinching');
    } else {
      cursorElement.classList.remove('pinching');
    }

    // Double Pinch Gesture (Spawn Cube)
    if (currentlyPinching && !isPinching) {
      const now = Date.now();
      if (now - lastPinchTime < 400 && playAreaSet) {
        spawnCubeAtScreenPoint(screenX, screenY);
      }
      lastPinchTime = now;
    }

    isPinching = currentlyPinching;

    if (playAreaSet) {
      handlePinchInteraction(screenX, screenY, isPinching);
    }
  } else {
    cursorElement.classList.add('hidden');
  }
}

// 5. 3D Hand Grab & Vertical Stacking Interaction
function handlePinchInteraction(screenX, screenY, pinching) {
  mouse.x = (screenX / window.innerWidth) * 2 - 1;
  mouse.y = -(screenY / window.innerHeight) * 2 + 1;

  if (pinching) {
    if (!activeCube) {
      // Pick up closest cube
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(cubes.map(c => c.mesh));

      if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        activeCube = cubes.find(c => c.mesh === hitMesh);
        if (activeCube) {
          activeCube.body.type = CANNON.Body.KINEMATIC; // Freeze physics during hold
          activeCube.body.velocity.set(0, 0, 0);
        }
      }
    } else {
      // Reposition held cube in 3D air along camera ray
      raycaster.setFromCamera(mouse, camera);
      const targetPos = new THREE.Vector3();
      raycaster.ray.at(0.45, targetPos);

      activeCube.body.position.set(targetPos.x, targetPos.y, targetPos.z);
    }
  } else {
    if (activeCube) {
      // Drop cube on gesture release
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
  raycaster.ray.at(0.40, targetPos);

  spawnCube(targetPos.x, targetPos.y, targetPos.z);
}

function updateTowerStats() {
  cubeCountLabel.innerText = cubes.length;
  let maxY = 0;
  cubes.forEach(c => {
    if (c.body.position.y > maxY) {
      maxY = c.body.position.y;
    }
  });
  const heightInMeters = Math.max(0, maxY - (-0.25)).toFixed(2);
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
  btnDropCube.addEventListener('click', () => spawnCube(0, 0.1, -0.45));
  btnReset.addEventListener('click', resetSpace);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function renderLoop() {
  requestAnimationFrame(renderLoop);

  // Step Physics Simulation (60fps)
  world.step(1 / 60);

  // Synchronize 3D Meshes with Physics Rigid Bodies
  cubes.forEach(c => {
    c.mesh.position.copy(c.body.position);
    c.mesh.quaternion.copy(c.body.quaternion);
  });

  renderer.render(scene, camera);
}

// Start Engine
initEngine();
