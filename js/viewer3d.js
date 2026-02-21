// viewer3d.js — Three.js 3D truck viewer module
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Department color helpers ──
const DEFAULT_COLOR = 0xC0C0C0;

function getDeptColor(dept, departments) {
  if (!dept || !departments || !departments[dept]) return DEFAULT_COLOR;
  const hex = departments[dept].color;
  return parseInt(hex.replace('#', ''), 16);
}

function getDeptHex(dept, departments) {
  const c = getDeptColor(dept, departments);
  return '#' + c.toString(16).padStart(6, '0');
}

// ── Mesh creation ──
function createCaseMesh(item, departments, opacity = 0.82, wireColor = 0x000000, wireOpacity = 0.3) {
  const color = getDeptColor(item.dept || 'AUTRE', departments);
  const geo = new THREE.BoxGeometry(item.width, item.height, item.depth);
  const mat = new THREE.MeshPhongMaterial({
    color, transparent: true, opacity, shininess: 40,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(
    item.x + item.width / 2,
    item.z + item.height / 2,
    item.y + item.depth / 2
  );
  mesh.userData = {
    data: { ...item },
    originalColor: color,
    originalOpacity: opacity,
  };
  const wireGeo = new THREE.EdgesGeometry(geo);
  const wireMat = new THREE.LineBasicMaterial({ color: wireColor, transparent: true, opacity: wireOpacity });
  const wireframe = new THREE.LineSegments(wireGeo, wireMat);
  wireframe.position.copy(mesh.position);
  wireframe.userData.isWireframe = true;
  mesh.userData.wireframe = wireframe;
  return { mesh, wireframe };
}

// ── Text sprite helper ──
function addTextSprite(scene, text, x, y, z, color, size) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 128;
  canvas.height = 64;
  ctx.font = `bold ${size * 3}px sans-serif`;
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z);
  sprite.scale.set(size * 2.5, size * 1.25, 1);
  sprite.userData.isLabel = true;
  scene.add(sprite);
}

/**
 * TruckViewer — manages the 3D scene, camera, controls, and case rendering.
 */
export class TruckViewer {
  constructor(containerEl) {
    this.container = containerEl;
    this.departments = {};
    this.truck = { width: 98, depth: 624, height: 108 };
    this.caseMeshes = [];
    this.placementData = [];
    this.wallOverlays = null; // group for wall section overlays
    this.selectedMesh = null;
    this.hoveredMesh = null;
    this.isPerspective = true;
    this.currentFilter = 'ALL';
    this.truckGroup = null; // group holding truck wireframe/grid/labels

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.editorActive = false; // when true, suppress viewer click/hover

    // Callbacks
    this.onCaseSelect = null;  // (index, data) => {}
    this.onCaseHover = null;   // (data|null, event) => {}

    this._init();
  }

  _init() {
    const container = this.container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);

    const aspect = container.clientWidth / container.clientHeight;

    // Perspective camera
    this.camera = new THREE.PerspectiveCamera(45, aspect, 1, 5000);
    this.camera.position.set(200, 500, 350);

    // Orthographic camera
    const frustum = 400;
    this.orthoCamera = new THREE.OrthographicCamera(
      -frustum * aspect, frustum * aspect, frustum, -frustum, 1, 5000
    );
    this.orthoCamera.position.copy(this.camera.position);
    this.activeCamera = this.camera;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.activeCamera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(this.truck.width / 2, 0, this.truck.depth / 3);
    this.controls.minDistance = 50;
    this.controls.maxDistance = 2500;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.update();

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(200, 400, 300);
    this.scene.add(dirLight);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-100, 200, -200);
    this.scene.add(dirLight2);

    this._buildTruck();
    this.setDefaultView();

    // Events
    this.renderer.domElement.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.renderer.domElement.addEventListener('click', (e) => this._onMouseClick(e));
    window.addEventListener('resize', () => this._onResize());

    this._animate();
  }

  // ── Build truck wireframe + transparent walls + floor grid + scale marks ──
  _buildTruck() {
    // Remove old truck group if rebuilding
    if (this.truckGroup) {
      this.scene.remove(this.truckGroup);
    }
    this.truckGroup = new THREE.Group();
    this.truckGroup.userData.isTruck = true;

    const w = this.truck.width, d = this.truck.depth, h = this.truck.height;

    // Wireframe box edges
    const edgeGeo = new THREE.BufferGeometry();
    const verts = [
      0,0,0, w,0,0, w,0,0, w,0,d, w,0,d, 0,0,d, 0,0,d, 0,0,0,
      0,h,0, w,h,0, w,h,0, w,h,d, w,h,d, 0,h,d, 0,h,d, 0,h,0,
      0,0,0, 0,h,0, w,0,0, w,h,0, w,0,d, w,h,d, 0,0,d, 0,h,d,
    ];
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x4488cc, linewidth: 1 });
    this.truckGroup.add(new THREE.LineSegments(edgeGeo, edgeMat));

    // Transparent walls
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0x1a3a5c, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false
    });

    // Floor
    const floorGeo = new THREE.PlaneGeometry(w, d);
    const floor = new THREE.Mesh(floorGeo, wallMat.clone());
    floor.material.opacity = 0.1;
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(w / 2, 0.01, d / 2);
    this.truckGroup.add(floor);

    // Back wall (cab side, z=0)
    const backGeo = new THREE.PlaneGeometry(w, h);
    const backWall = new THREE.Mesh(backGeo, wallMat);
    backWall.position.set(w / 2, h / 2, 0);
    this.truckGroup.add(backWall);

    // Left wall (x=0)
    const sideGeo = new THREE.PlaneGeometry(d, h);
    const leftWall = new THREE.Mesh(sideGeo, wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(0, h / 2, d / 2);
    this.truckGroup.add(leftWall);

    // Right wall (x=w)
    const rightWall = new THREE.Mesh(sideGeo, wallMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(w, h / 2, d / 2);
    this.truckGroup.add(rightWall);

    // Ceiling
    const ceiling = new THREE.Mesh(floorGeo.clone(), wallMat.clone());
    ceiling.material.opacity = 0.04;
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(w / 2, h, d / 2);
    this.truckGroup.add(ceiling);

    // Floor grid
    this._buildFloorGrid(w, d);

    // Scale marks
    this._buildScaleMarks(w, d, h);

    // Door opening indicator (at z = d)
    const doorGeo = new THREE.BufferGeometry();
    const doorVerts = [
      0, 0, d, w, 0, d,
      w, 0, d, w, h, d,
      0, 0, d, 0, h, d,
    ];
    doorGeo.setAttribute('position', new THREE.Float32BufferAttribute(doorVerts, 3));
    const doorMat = new THREE.LineBasicMaterial({ color: 0xe94560, linewidth: 2 });
    this.truckGroup.add(new THREE.LineSegments(doorGeo, doorMat));

    // Labels
    addTextSprite(this.truckGroup, 'CAB', w / 2, h + 8, -10, 0x4488cc, 14);
    addTextSprite(this.truckGroup, 'DOOR', w / 2, h + 8, d + 10, 0xe94560, 14);

    this.scene.add(this.truckGroup);
  }

  _buildFloorGrid(w, d) {
    const gridLines = [];
    const step = 12;
    for (let x = 0; x <= w; x += step) {
      gridLines.push(x, 0.05, 0, x, 0.05, d);
    }
    for (let z = 0; z <= d; z += step) {
      gridLines.push(0, 0.05, z, w, 0.05, z);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridLines, 3));
    const gridMat = new THREE.LineBasicMaterial({ color: 0x1a3050, transparent: true, opacity: 0.4 });
    this.truckGroup.add(new THREE.LineSegments(gridGeo, gridMat));
  }

  _buildScaleMarks(w, d, h) {
    const step = 12;
    // X axis (width)
    for (let x = 0; x <= w; x += step) {
      const ft = Math.round(x / 12);
      if (ft % 2 === 0) {
        addTextSprite(this.truckGroup, `${ft}'`, x, -8, -6, 0x5588aa, 9);
      }
      const tickGeo = new THREE.BufferGeometry();
      tickGeo.setAttribute('position', new THREE.Float32BufferAttribute([x, 0, -2, x, 0, 0], 3));
      this.truckGroup.add(new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({ color: 0x4488cc })));
    }
    // Z axis (depth)
    for (let z = 0; z <= d; z += step) {
      const ft = Math.round(z / 12);
      if (ft % 5 === 0) {
        addTextSprite(this.truckGroup, `${ft}'`, -14, -8, z, 0x5588aa, 9);
      }
      const tickGeo = new THREE.BufferGeometry();
      tickGeo.setAttribute('position', new THREE.Float32BufferAttribute([-2, 0, z, 0, 0, z], 3));
      this.truckGroup.add(new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({ color: 0x4488cc })));
    }
    // Y axis (height)
    for (let y = 0; y <= h; y += step) {
      const ft = Math.round(y / 12);
      if (ft % 2 === 0) {
        addTextSprite(this.truckGroup, `${ft}'`, -14, y, -6, 0x5588aa, 9);
      }
    }
  }

  // ── Public: set truck dimensions and rebuild ──
  setTruck(truckConfig) {
    this.truck.width = truckConfig.interiorWidth;
    this.truck.depth = truckConfig.interiorLength;
    this.truck.height = truckConfig.interiorHeight;
    this._buildTruck();
    this.controls.target.set(this.truck.width / 2, 0, this.truck.depth / 3);
    this.controls.update();
    this.setDefaultView();
  }

  // ── Public: set departments (for colors) ──
  setDepartments(departments) {
    this.departments = departments;
  }

  // ── Public: load placement data and create meshes ──
  loadData(data) {
    // Clear existing case meshes
    this.caseMeshes.forEach(m => {
      this.scene.remove(m);
      this.scene.remove(m.userData.wireframe);
    });
    this.caseMeshes = [];
    this.placementData = data;

    data.forEach((item, i) => {
      const isKB = item._fromKnowledge || false;
      const wireColor = isKB ? 0x4CAF50 : 0x000000;
      const wireOpacity = isKB ? 0.6 : 0.3;
      const { mesh, wireframe } = createCaseMesh(item, this.departments, 0.82, wireColor, wireOpacity);
      mesh.userData.index = i;
      mesh.userData._fromKnowledge = isKB;
      this.scene.add(mesh);
      this.scene.add(wireframe);
      this.caseMeshes.push(mesh);
    });
  }

  // ── Public: show wall section overlays on the floor ──
  showWallSections(wallSections) {
    this.clearWallSections();
    if (!wallSections || wallSections.length === 0) return;

    this.wallOverlays = new THREE.Group();
    this.wallOverlays.userData.isWallOverlay = true;

    // Alternating stripe colors for visibility
    const stripeColors = [0x4488cc, 0x44cc88];
    const w = this.truck.width;

    wallSections.forEach((ws, i) => {
      const depth = ws.yEnd - ws.yStart;
      if (depth <= 0) return;

      // Floor band (thin plane just above the floor)
      const bandGeo = new THREE.PlaneGeometry(w, depth);
      const bandMat = new THREE.MeshBasicMaterial({
        color: stripeColors[i % 2],
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.rotation.x = -Math.PI / 2;
      band.position.set(w / 2, 0.15, ws.yStart + depth / 2);
      this.wallOverlays.add(band);

      // Wall boundary line at yStart
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0.2, ws.yStart, w, 0.2, ws.yStart,
      ], 3));
      const lineMat = new THREE.LineBasicMaterial({
        color: stripeColors[i % 2], transparent: true, opacity: 0.5,
      });
      this.wallOverlays.add(new THREE.LineSegments(lineGeo, lineMat));

      // Side edge markers (vertical lines at truck walls)
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, 0, ws.yStart, -0.5, ws.caseCount > 0 ? Math.min(ws.yEnd - ws.yStart, 108) : 24, ws.yStart,
        w + 0.5, 0, ws.yStart, w + 0.5, ws.caseCount > 0 ? Math.min(ws.yEnd - ws.yStart, 108) : 24, ws.yStart,
      ], 3));
      const edgeMat = new THREE.LineBasicMaterial({
        color: stripeColors[i % 2], transparent: true, opacity: 0.3,
      });
      this.wallOverlays.add(new THREE.LineSegments(edgeGeo, edgeMat));

      // Label: wall name + fill %
      const label = ws.label.length > 20 ? ws.label.substring(0, 18) + '..' : ws.label;
      const labelText = `${label} ${ws.fillPct}%`;
      addTextSprite(this.wallOverlays, labelText, w / 2, -6, ws.yStart + depth / 2, stripeColors[i % 2], 8);
    });

    this.scene.add(this.wallOverlays);
  }

  // ── Public: clear wall section overlays ──
  clearWallSections() {
    if (this.wallOverlays) {
      this.scene.remove(this.wallOverlays);
      // Dispose geometries and materials
      this.wallOverlays.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
      this.wallOverlays = null;
    }
  }

  // ── Public: clear all cases ──
  clearCases() {
    this.caseMeshes.forEach(m => {
      this.scene.remove(m);
      this.scene.remove(m.userData.wireframe);
    });
    this.caseMeshes = [];
    this.placementData = [];
    this.clearWallSections();
    this.selectedMesh = null;
    this.hoveredMesh = null;
  }

  // ── Public: get computed stats ──
  getStats() {
    let maxDepth = 0;
    let totalVolume = 0;
    this.placementData.forEach(p => {
      const d = p.y + p.depth;
      if (d > maxDepth) maxDepth = d;
      totalVolume += p.width * p.depth * p.height;
    });
    const truckVolume = this.truck.width * this.truck.depth * this.truck.height;
    return {
      caseCount: this.placementData.length,
      maxDepth,
      truckDepth: this.truck.depth,
      depthPct: ((maxDepth / this.truck.depth) * 100).toFixed(1),
      volumePct: ((totalVolume / truckVolume) * 100).toFixed(1),
    };
  }

  // ── Public: select case by index ──
  selectCase(index) {
    if (this.selectedMesh) {
      this.selectedMesh.material.emissive.setHex(0x000000);
      this.selectedMesh.userData.wireframe.material.color.setHex(0x000000);
      this.selectedMesh.userData.wireframe.material.opacity = 0.3;
    }
    const mesh = this.caseMeshes[index];
    if (!mesh) return;
    this.selectedMesh = mesh;
    mesh.material.emissive.setHex(0x333333);
    mesh.userData.wireframe.material.color.setHex(0xffffff);
    mesh.userData.wireframe.material.opacity = 1.0;

    // Smooth camera look-at
    this._animateCameraTarget(mesh.position.clone());

    if (this.onCaseSelect) {
      this.onCaseSelect(index, mesh.userData.data);
    }
  }

  // ── Public: deselect current case ──
  deselectCase() {
    if (this.selectedMesh) {
      this.selectedMesh.material.emissive.setHex(0x000000);
      this.selectedMesh.userData.wireframe.material.color.setHex(0x000000);
      this.selectedMesh.userData.wireframe.material.opacity = 0.3;
      this.selectedMesh = null;
    }
  }

  // ── Public: filter by department ──
  applyFilter(dept) {
    this.currentFilter = dept;
    this.caseMeshes.forEach(m => {
      const d = m.userData.data;
      const visible = dept === 'ALL' || d.dept === dept;
      m.visible = visible;
      m.userData.wireframe.visible = visible;
      m.material.opacity = visible ? m.userData.originalOpacity : 0;
    });
  }

  // ── Public: get department hex color ──
  getDeptHex(dept) {
    return getDeptHex(dept, this.departments);
  }

  // ── Camera views ──
  setDefaultView() {
    const target = new THREE.Vector3(this.truck.width / 2, this.truck.height / 3, this.truck.depth / 3);
    this.activeCamera.position.set(250, 250, -100);
    this.controls.target.copy(target);
    this.controls.update();
  }

  resetView() {
    const target = new THREE.Vector3(this.truck.width / 2, this.truck.height / 3, this.truck.depth / 3);
    this._animateCamera(new THREE.Vector3(250, 250, -100), target);
  }

  topView() {
    const center = new THREE.Vector3(this.truck.width / 2, 0, this.truck.depth / 3);
    this._animateCamera(new THREE.Vector3(this.truck.width / 2, 500, this.truck.depth / 3), center);
  }

  frontView() {
    const center = new THREE.Vector3(this.truck.width / 2, this.truck.height / 2, this.truck.depth / 2);
    this._animateCamera(new THREE.Vector3(this.truck.width / 2, this.truck.height / 2, this.truck.depth + 300), center);
  }

  sideView() {
    const center = new THREE.Vector3(this.truck.width / 2, this.truck.height / 2, this.truck.depth / 3);
    this._animateCamera(new THREE.Vector3(this.truck.width + 350, this.truck.height / 2, this.truck.depth / 3), center);
  }

  togglePerspective() {
    this.isPerspective = !this.isPerspective;
    if (this.isPerspective) {
      this.camera.position.copy(this.orthoCamera.position);
      this.activeCamera = this.camera;
    } else {
      this.orthoCamera.position.copy(this.camera.position);
      const aspect = this.container.clientWidth / this.container.clientHeight;
      const dist = this.camera.position.distanceTo(this.controls.target);
      const frustum = dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      this.orthoCamera.left = -frustum * aspect;
      this.orthoCamera.right = frustum * aspect;
      this.orthoCamera.top = frustum;
      this.orthoCamera.bottom = -frustum;
      this.orthoCamera.updateProjectionMatrix();
      this.activeCamera = this.orthoCamera;
    }
    this.controls.object = this.activeCamera;
    this.controls.update();
    return this.isPerspective;
  }

  // ── Private: camera animation helpers ──
  _animateCameraTarget(target) {
    const start = this.controls.target.clone();
    const duration = 400;
    const startTime = performance.now();
    const step = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = t * (2 - t);
      this.controls.target.lerpVectors(start, target, ease);
      this.controls.update();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  _animateCamera(pos, target) {
    const startPos = this.activeCamera.position.clone();
    const startTarget = this.controls.target.clone();
    const duration = 500;
    const startTime = performance.now();
    const step = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = t * (2 - t);
      this.activeCamera.position.lerpVectors(startPos, pos, ease);
      this.controls.target.lerpVectors(startTarget, target, ease);
      this.controls.update();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ── Private: mouse events ──
  _getIntersects(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.activeCamera);
    return this.raycaster.intersectObjects(this.caseMeshes.filter(m => m.visible));
  }

  _onMouseMove(event) {
    if (this.editorActive) return;
    const intersects = this._getIntersects(event);

    // Unhover previous
    if (this.hoveredMesh && this.hoveredMesh !== this.selectedMesh) {
      this.hoveredMesh.material.emissive.setHex(0x000000);
    }

    if (intersects.length > 0) {
      const mesh = intersects[0].object;
      this.hoveredMesh = mesh;
      if (mesh !== this.selectedMesh) {
        mesh.material.emissive.setHex(0x1a1a1a);
      }
      this.renderer.domElement.style.cursor = 'pointer';

      if (this.onCaseHover) {
        this.onCaseHover(mesh.userData.data, event);
      }
    } else {
      this.hoveredMesh = null;
      this.renderer.domElement.style.cursor = 'default';
      if (this.onCaseHover) {
        this.onCaseHover(null, event);
      }
    }
  }

  _onMouseClick(event) {
    if (this.editorActive) return;
    const intersects = this._getIntersects(event);
    if (intersects.length > 0) {
      const mesh = intersects[0].object;
      this.selectCase(mesh.userData.index);
    }
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const aspect = w / h;

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    const frustum = 400;
    this.orthoCamera.left = -frustum * aspect;
    this.orthoCamera.right = frustum * aspect;
    this.orthoCamera.updateProjectionMatrix();

    this.renderer.setSize(w, h);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.activeCamera);
  }
}
