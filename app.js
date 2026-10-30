// Application State
let scene, camera, renderer, world;
let playAreaSet = false;
let groundBody, playMatMesh, reticleMesh;
let cubes = [];
let activeCube = null;

// Ground Plane Baseline (-0.35m below iPad camera level)
const groundY = -0.35;
let playAreaPosition = new THREE.Vector3(0, groundY, -0.45);

// Gestures & Tracking State
let isPinching = false;
let lastPinchTime = 0;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

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
  dirLight.position.set(0.5, 2, 1);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // Physics Engine
  world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);

  const defaultMat = new CANNON.Material('default');
  const contactMat = new CANNON.ContactMaterial(defaultMat, defaultMat, {
    friction: 1.0,
    restitution: 0.0 // Zero bounciness for solid stacking
  });
  world.addContactMaterial(contactMat);

  setupReticle3D();
  setupTouchPlanePicker();

  window.addEventListener('resize', onResize);
  setupUIEvents();
  initHandTracking();
  renderLoop();
}

// 2. Setup 3D Targeting Reticle
function setupReticle3D() {
  const ringGeo = new THREE.RingGeometry(0.06, 0.08, 32);
  const ringMat = new THREE.MeshBasicMaterial({ 
    color: 0x00ffff, 
    side: THREE.DoubleSide, 
    transparent: true, 
    opacity: 0.8 
  });
  reticleMesh = new THREE.Mesh(ringGeo, ringMat);
  reticleMesh.rotation.x = -Math.PI / 2;
  reticleMesh.position.copy(playAreaPosition);
  scene.add(reticleMesh);
}

// 3. Screen Touch Raycaster to Pick Surface Point
function setupTouchPlanePicker() {
  window.addEventListener('pointerdown', (event) => {
    if (playAreaSet) return;
    
    // Ignore button taps
    if (event.target.tagName === 'BUTTON') return;

    // Convert touch/click position to Normalized Device Coordinates (-1 to +1)
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Raycast from camera to fixed horizontal desk plane
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);
    const target = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(plane, target)) {
      playAreaPosition.copy(target);
      reticleMesh.position.copy(playAreaPosition);
    }
  });
}

// 4. Lock Play Area on Selected Touch Location
function confirmPlayArea() {
  playAreaSet = true;
  reticleMesh.visible = false;
  if (reticle2DElement) reticle2DElement.classList.add('hidden');
  btnSetArea.classList.add('hidden');
  
  metricsBar.classList.remove('hidden');
  btnDropCube.classList.remove('hidden');
  btnReset.classList.remove('hidden');
  
  instructionBanner.innerText = "Pinch & drag to stack • Double-pinch in mid-air to spawn cube";

  // Lock 50cm x 50cm Green Table Mat
  const geo = new THREE.PlaneGeometry(0.5, 0.5);
  const mat = new THREE.MeshStandardMaterial({ 
    color: 0x00ff88, 
    transparent: true, 
    opacity: 0.35, 
    side: THREE.DoubleSide 
  });
  playMatMesh = new THREE.Mesh(geo, mat);
  playMatMesh.rotation.x = -Math.PI / 2;
  playMatMesh.position.copy(playAreaPosition);
  scene.add(playMatMesh);

  // Static Immovable Physics Floor
  const groundShape = new CANNON.Box(new CANNON.Vec3(0.25, 0.005, 0.25));
  groundBody = new CANNON.Body({ mass: 0 }); // Mass 0 = Static floor
  groundBody.addShape(groundShape);
  groundBody.position.set(playAreaPosition.x, playAreaPosition.y - 0.005, playAreaPosition.z);
  world.addBody(groundBody);
}

// 5. Spawn Weighted 6cm Cubes
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

// 6. MediaPipe Hand Tracking Setup (Rear Camera)
// MediaPipe Hand Tracking configured for iPad 0.5x Ultra Wide Camera
// Native WebRTC Hand Tracking Engine with Ultra-Wide Rear Lens Selection
async function initHandTracking() {
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

  try {
    // 1. Force initial permission request using REAR camera
    const initialStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }
    });
    initialStream.getTracks().forEach(track => track.stop()); // Close temporary stream

    // 2. Enumerate all connected video input devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');

    // 3. Filter OUT all front/selfie/FaceTime cameras
    const backCameras = videoDevices.filter(d => {
      const label = d.label.toLowerCase();
      return !label.includes('front') && !label.includes('user') && !label.includes('selfie') && !label.includes('facetime');
    });

    // 4. Search for Ultra Wide lens among rear cameras
    let targetDevice = backCameras.find(d => {
      const label = d.label.toLowerCase();
      return label.includes('ultra') || label.includes('0.5') || label.includes('back camera 1') || label.includes('back 1');
    });

    // On dual-camera iPads, the Ultra Wide camera is typically the second rear entry
    if (!targetDevice && backCameras.length > 1) {
      targetDevice = backCameras[1];
    } else if (!targetDevice && backCameras.length > 0) {
      targetDevice = backCameras[0];
    }

    // 5. Build explicit video constraints
    const constraints = {
      video: targetDevice 
        ? { deviceId: { exact: targetDevice.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    };

    // 6. Start video stream directly on videoElement
    const finalStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = finalStream;
    await videoElement.play();

    // 7. Continuous processing loop feeding frames to MediaPipe
    async function processFrame() {
      if (!videoElement.paused && !videoElement.ended) {
        await hands.send({ image: videoElement });
      }
      requestAnimationFrame(processFrame);
    }
    processFrame();

  } catch (err) {
    console.error("Camera setup error, falling back to standard rear camera:", err);
    
    // Safety Fallback: Default directly to environment camera
    try {
      const fallbackStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      });
      videoElement.srcObject = fallbackStream;
      await videoElement.play();

      async function processFallbackFrame() {
        if (!videoElement.paused && !videoElement.ended) {
          await hands.send({ image: videoElement });
        }
        requestAnimationFrame(processFallbackFrame);
      }
      processFallbackFrame();
    } catch (fallbackErr) {
      alert("Could not access camera. Please allow camera permissions in Safari.");
    }
  }
}

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

    // Double Pinch Gesture
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

// 7. Hand Grab & Vertical Lifting Logic
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
  let maxY = playAreaPosition.y;
  cubes.forEach(c => {
    if (c.body.position.y > maxY) {
      maxY = c.body.position.y;
    }
  });
  const heightInMeters = Math.max(0, maxY - playAreaPosition.y).toFixed(2);
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
    spawnCube(playAreaPosition.x, playAreaPosition.y + 0.30, playAreaPosition.z);
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
