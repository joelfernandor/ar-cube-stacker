// Application State
let scene, camera, renderer, world;
let playAreaSet = false;
let groundBody, playMatMesh, reticleMesh;
let cubes = [];
let activeCube = null;

// Camera Pitch & Surface Tracking State
let cameraPitch = 0.5; // Default pitch angle (~30 degrees down)
let estimatedSurfaceY = -0.35; // Default desk level (35cm below camera)
let currentReticlePos = new THREE.Vector3(0, -0.35, -0.45);

// Gestures & Tracking State
let isPinching = false;
let lastPinchTime = 0;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(0, 0); // Center screen raycast

// DOM References
const videoElement = document.getElementById('webcam');
const cursorElement = document.getElementById('hand-cursor');
const reticle2DElement = document.getElementById('center-reticle');
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

  // Three.js Render Scene
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(0.5, 2, 1);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // Cannon.js Physics Engine Setup
  world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);

  const defaultMat = new CANNON.Material('default');
  const contactMat = new CANNON.ContactMaterial(defaultMat, defaultMat, {
    friction: 1.0,
    restitution: 0.0 // Zero bounce
  });
  world.addContactMaterial(contactMat);

  setupReticle3D();
  setupDeviceOrientation();

  window.addEventListener('resize', onResize);
  setupUIEvents();
  initHandTracking();
  renderLoop();
}

// 2. Setup Real-time 3D Placement Reticle Ring
function setupReticle3D() {
  const ringGeo = new THREE.RingGeometry(0.08, 0.1, 32);
  const ringMat = new THREE.MeshBasicMaterial({ 
    color: 0x00ffff, 
    side: THREE.DoubleSide, 
    transparent: true, 
    opacity: 0.8 
  });
  reticleMesh = new THREE.Mesh(ringGeo, ringMat);
  reticleMesh.rotation.x = -Math.PI / 2; // Flat horizontal plane
  scene.add(reticleMesh);
}

// Track iPad Gyroscope Pitch Angle
function setupDeviceOrientation() {
  window.addEventListener('deviceorientation', (event) => {
    if (event.beta) {
      // Convert beta angle (degrees tilt) to radians
      let pitchRad = (event.beta - 45) * (Math.PI / 180);
      cameraPitch = Math.max(0.1, Math.min(1.4, pitchRad));
    }
  });
}

// Update Reticle Ring Position dynamically based on Camera Aiming
function updateReticlePosition() {
  if (playAreaSet) return;

  // Perform Raycast from Center Screen
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  
  // Intersect ray with estimated horizontal ground plane (y = estimatedSurfaceY)
  const ray = raycaster.ray;
  if (ray.direction.y < 0) {
    const t = (estimatedSurfaceY - ray.origin.y) / ray.direction.y;
    currentReticlePos.copy(ray.origin).addScaledVector(ray.direction, t);

    // Keep reticle within comfortable distance (0.25m to 0.8m)
    currentReticlePos.z = Math.max(-0.8, Math.min(-0.25, currentReticlePos.z));
    
    reticleMesh.position.copy(currentReticlePos);
    reticleMesh.position.y = estimatedSurfaceY;
  }
}

// 3. Confirm Play Area Surface
function confirmPlayArea() {
  playAreaSet = true;
  reticleMesh.visible = false;
  if (reticle2DElement) reticle2DElement.classList.add('hidden');
  btnSetArea.classList.add('hidden');
  
  metricsBar.classList.remove('hidden');
  btnDropCube.classList.remove('hidden');
  btnReset.classList.remove('hidden');
  
  instructionBanner.innerText = "Pinch & drag to stack • Double-pinch in mid-air to spawn cube";

  // Lock 50cm x 50cm Green Play Mat at Reticle Location
  const geo = new THREE.PlaneGeometry(0.5, 0.5);
  const mat = new THREE.MeshStandardMaterial({ 
    color: 0x00ff88, 
    transparent: true, 
    opacity: 0.35, 
    side: THREE.DoubleSide 
  });
  playMatMesh = new THREE.Mesh(geo, mat);
  playMatMesh.rotation.x = -Math.PI / 2;
  playMatMesh.position.copy(currentReticlePos);
  scene.add(playMatMesh);

  // Lock Static Immovable Physics Body at exact Reticle Location
  const groundShape = new CANNON.Box(new CANNON.Vec3(0.25, 0.005, 0.25));
  groundBody = new CANNON.Body({ mass: 0 }); // Mass 0 = Static floor
  groundBody.addShape(groundShape);
  groundBody.position.set(currentReticlePos.x, currentReticlePos.y - 0.005, currentReticlePos.z);
  world.addBody(groundBody);
}

// 4. Spawn 6cm Weighted Cubes
function spawnCube(x, y, z) {
  const size = 0.06;
  const colors = [0x00ffff, 0x00ff88, 0xffaa00, 0xff0055, 0xaa00ff];
  const chosenColor = colors[Math.floor(Math.random() * colors.length)];

  // Three.js Mesh
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

// 5. MediaPipe Hand Tracking Setup (Rear Camera)
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
    facingMode: 'environment'
  });

  cameraUtils.start();
}

// Process Hand Gesture Frames
function onHandResults(results) {
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];

    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];

    const screenX = ((indexTip.x + thumbTip.x) / 2) * window.innerWidth;
    const screenY = ((indexTip.y + thumbTip.y) / 2) * window.innerHeight;

    cursorElement.classList.remove('hidden');
    cursorElement.style.left = `${screenX}px`;
    cursorElement.style.top = `${screenY}px`;

    const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
    const currentlyPinching = pinchDist < 0.08;

    if (currentlyPinching) {
      cursorElement.classList.add('pinching');
    } else {
      cursorElement.classList.remove('pinching');
    }

    // Double Pinch Gesture Spawning
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

// 6. 3D Hand Grab & Vertical Lift Logic
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
  let maxY = currentReticlePos.y;
  cubes.forEach(c => {
    if (c.body.position.y > maxY) {
      maxY = c.body.position.y;
    }
  });
  const heightInMeters = Math.max(0, maxY - currentReticlePos.y).toFixed(2);
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
    spawnCube(currentReticlePos.x, currentReticlePos.y + 0.35, currentReticlePos.z);
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

  updateReticlePosition();

  // Step Physics Engine (60fps)
  world.step(1 / 60);

  // Sync 3D Meshes to Physics Rigid Bodies
  cubes.forEach(c => {
    c.mesh.position.copy(c.body.position);
    c.mesh.quaternion.copy(c.body.quaternion);
  });

  renderer.render(scene, camera);
}

// Start Engine
initEngine();
