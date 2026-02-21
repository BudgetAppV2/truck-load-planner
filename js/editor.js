// editor.js — Truck Editor: drag & drop, rotation, undo, snap, collision
// Extracted from truck-viewer.html lines ~4494-5794
// Adapted for ES module + TruckViewer class integration

import * as THREE from 'three';

const ED_SNAP_THRESHOLD = 5;

/**
 * TruckEditor — manages interactive case repositioning in the 3D truck.
 * Requires a TruckViewer instance and the current wall sections / placements.
 */
export class TruckEditor {
  constructor(viewer) {
    this.viewer = viewer;
    this.active = false;

    // Editor state
    this.placements = [];          // flat array of all placements (mutable copies)
    this.meshes = [];              // THREE.Mesh for each placement
    this.selected = null;          // currently selected mesh (primary)
    this.selection = new Set();    // multi-select set of meshes
    this.dragMesh = null;          // mesh being dragged
    this.dragStart = null;         // {x,y,z} of primary mesh at drag start
    this.dragGroupStart = new Map(); // mesh → {x,y,z} for group members
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.dragOffset = new THREE.Vector3();
    this.snapLines = [];
    this.undoStack = [];
    this.boxStart = null;          // {x,y} screen coords for box select
    this.boxActive = false;
    this.originalWallSections = null;
    this.axisLock = '';            // '' | 'x' | 'y' | 'z'

    // Callbacks set by app.js
    this.onUpdate = null;          // () => {} — called after moves/rotations/undo
    this.onSelectionChange = null; // (selectedData, selectionSize) => {}

    // Bound event handlers (for add/remove)
    this._onPointerDown = (e) => this._pointerDown(e);
    this._onPointerMove = (e) => this._pointerMove(e);
    this._onPointerUp = (e) => this._pointerUp(e);
    this._onKeyDown = (e) => this._keyDown(e);
  }

  // ── Accessors for viewer internals ──
  get scene() { return this.viewer.scene; }
  get renderer() { return this.viewer.renderer; }
  get controls() { return this.viewer.controls; }
  get activeCamera() { return this.viewer.activeCamera; }
  get truckWidth() { return this.viewer.truck.width; }
  get truckDepth() { return this.viewer.truck.depth; }
  get truckHeight() { return this.viewer.truck.height; }

  // ── Enter editor mode ──
  enter(wallSections) {
    if (this.active) return;
    if (!wallSections || !wallSections.length) {
      console.warn('[Editor] No wall sections to edit.');
      return false;
    }
    this.active = true;
    this.axisLock = '';

    // Backup wallSections for cancel
    this.originalWallSections = JSON.parse(JSON.stringify(wallSections));

    // Flatten all placements
    this.placements = wallSections.flatMap(w =>
      (w.placements || []).map(p => ({ ...p }))
    );

    // Clear main viewer meshes (we manage our own)
    this.viewer.clearCases();

    // Create editor meshes
    this.meshes = [];
    for (const p of this.placements) {
      const { mesh, wireframe } = this._createEditorMesh(p);
      this.scene.add(mesh);
      this.scene.add(wireframe);
      this.meshes.push(mesh);
    }

    // Push initial undo state
    this.undoStack = [];
    this._pushUndo();

    // Bind events
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp);
    document.addEventListener('keydown', this._onKeyDown);

    console.log(`[Editor] Entered with ${this.placements.length} placements`);
    return true;
  }

  // ── Exit editor mode ──
  exit(cancel) {
    if (!this.active) return null;

    // Remove events
    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this._onPointerUp);
    document.removeEventListener('keydown', this._onKeyDown);

    // Cleanup editor meshes
    this.meshes.forEach(m => {
      this.scene.remove(m);
      if (m.userData.wireframe) this.scene.remove(m.userData.wireframe);
      m.geometry.dispose();
      m.material.dispose();
    });
    this.meshes = [];
    this._clearSnapLines();

    let wallSections;
    if (cancel) {
      wallSections = this.originalWallSections;
    } else {
      wallSections = this._autoGroupWalls(this.placements);
    }

    // Reset state
    this.active = false;
    this.selected = null;
    this.selection.clear();
    this.dragMesh = null;
    this.placements = [];
    this.undoStack = [];
    this.originalWallSections = null;

    console.log(`[Editor] Exited (${cancel ? 'cancelled' : 'saved'})`);
    return wallSections;
  }

  // ── Public: get current placement state ──
  getPlacements() {
    return this.placements.map(p => ({ ...p }));
  }

  // ── Public: get info for UI display ──
  getInfo() {
    const totalCases = this.placements.length;
    const maxDepth = totalCases
      ? Math.max(...this.placements.map(p => p.y + p.depth))
      : 0;
    const usagePct = Math.round((maxDepth / this.truckDepth) * 100);
    return {
      totalCases,
      maxDepth: Math.round(maxDepth),
      truckDepth: this.truckDepth,
      usagePct,
      undoSteps: this.undoStack.length - 1,
      selectionSize: this.selection.size,
    };
  }

  // ── Public: get selected case data ──
  getSelectedData() {
    if (!this.selected) return null;
    return { ...this.selected.userData.data };
  }

  getSelectionData() {
    return [...this.selection].map(m => ({ ...m.userData.data }));
  }

  // ── Public: rotate selected ──
  rotate() {
    if (!this.selected) return;
    this._pushUndo();

    if (this.selection.size > 1) {
      this._rotateGroup();
    } else {
      this._rotateSingle();
    }
    this._notifyUpdate();
    this._notifySelection();
  }

  // ── Public: undo ──
  undo() {
    if (this.undoStack.length <= 1) return;
    this.undoStack.pop();
    const prev = this.undoStack[this.undoStack.length - 1];
    this.placements = prev.map(p => ({ ...p }));
    this._rebuildMeshes();
    this._notifyUpdate();
    console.log(`[Editor] Undo (${this.undoStack.length} states left)`);
  }

  // ── Public: delete selected ──
  deleteSelected() {
    const toDelete = this.selection.size > 0
      ? [...this.selection]
      : (this.selected ? [this.selected] : []);
    if (!toDelete.length) return;
    this._pushUndo();
    for (const m of toDelete) {
      const idx = this.meshes.indexOf(m);
      if (idx >= 0) {
        this.meshes.splice(idx, 1);
        this.placements.splice(idx, 1);
      }
      this.scene.remove(m);
      if (m.userData.wireframe) this.scene.remove(m.userData.wireframe);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.selection.clear();
    this.selected = null;
    this._notifyUpdate();
    this._notifySelection();
    console.log(`[Editor] Deleted ${toDelete.length} cases`);
  }

  // ── Public: select all ──
  selectAll() {
    this._deselectAll();
    for (const m of this.meshes) {
      this.selection.add(m);
      this._highlightMesh(m, true);
    }
    this.selected = this.meshes[this.meshes.length - 1] || null;
    this._notifySelection();
  }

  // ── Public: deselect all ──
  deselectAll() {
    this._deselectAll();
  }

  // ── Public: set axis lock ──
  setAxisLock(axis) {
    this.axisLock = (this.axisLock === axis) ? '' : axis;
    return this.axisLock;
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Mesh creation
  // ════════════════════════════════════════════════════

  _createEditorMesh(placement) {
    const color = this._getDeptColor(placement.dept);
    const geo = new THREE.BoxGeometry(placement.width, placement.height, placement.depth);
    const mat = new THREE.MeshPhongMaterial({
      color, transparent: true, opacity: 0.85, shininess: 40,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      placement.x + placement.width / 2,
      placement.z + placement.height / 2,
      placement.y + placement.depth / 2
    );
    mesh.userData = {
      data: { ...placement },
      originalColor: color,
      originalOpacity: 0.85,
    };

    const wireGeo = new THREE.EdgesGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.4,
    });
    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
    wireframe.position.copy(mesh.position);
    wireframe.userData.isWireframe = true;
    mesh.userData.wireframe = wireframe;

    return { mesh, wireframe };
  }

  _getDeptColor(dept) {
    if (!dept || !this.viewer.departments[dept]) return 0xC0C0C0;
    return parseInt(this.viewer.departments[dept].color.replace('#', ''), 16);
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Undo
  // ════════════════════════════════════════════════════

  _pushUndo() {
    this.undoStack.push(this.placements.map(p => ({ ...p })));
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  _rebuildMeshes() {
    this.meshes.forEach(m => {
      this.scene.remove(m);
      if (m.userData.wireframe) this.scene.remove(m.userData.wireframe);
      m.geometry.dispose();
      m.material.dispose();
    });
    this.meshes = [];
    for (const p of this.placements) {
      const { mesh, wireframe } = this._createEditorMesh(p);
      this.scene.add(mesh);
      this.scene.add(wireframe);
      this.meshes.push(mesh);
    }
    this.selected = null;
    this.selection.clear();
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Rotation
  // ════════════════════════════════════════════════════

  _rotateSingle() {
    const d = this.selected.userData.data;
    const tmp = d.width;
    d.width = d.depth;
    d.depth = tmp;
    d.rotation = d.rotation === 90 ? 0 : 90;
    // Clamp to truck bounds
    if (d.x + d.width > this.truckWidth) d.x = Math.max(0, this.truckWidth - d.width);
    if (d.y + d.depth > this.truckDepth) d.y = Math.max(0, this.truckDepth - d.depth);
    const idx = this.meshes.indexOf(this.selected);
    if (idx >= 0) Object.assign(this.placements[idx], d);
    this._rotateGeometry(this.selected, d);
  }

  _rotateGroup() {
    const meshes = [...this.selection];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const m of meshes) {
      const dd = m.userData.data;
      minX = Math.min(minX, dd.x);
      maxX = Math.max(maxX, dd.x + dd.width);
      minY = Math.min(minY, dd.y);
      maxY = Math.max(maxY, dd.y + dd.depth);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    for (const m of meshes) {
      const dd = m.userData.data;
      const icx = dd.x + dd.width / 2 - cx;
      const icy = dd.y + dd.depth / 2 - cy;
      // Rotate 90° CW: (x,y) → (y, -x)
      const newCx = icy;
      const newCy = -icx;
      const tmp = dd.width;
      dd.width = dd.depth;
      dd.depth = tmp;
      dd.rotation = dd.rotation === 90 ? 0 : 90;
      dd.x = Math.round(cx + newCx - dd.width / 2);
      dd.y = Math.round(cy + newCy - dd.depth / 2);
      const idx = this.meshes.indexOf(m);
      if (idx >= 0) Object.assign(this.placements[idx], dd);
      this._rotateGeometry(m, dd);
    }
  }

  _rotateGeometry(mesh, d) {
    const oldWire = mesh.userData.wireframe;
    this.scene.remove(oldWire);
    oldWire.geometry.dispose();
    oldWire.material.dispose();
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BoxGeometry(d.width, d.height, d.depth);
    mesh.position.set(d.x + d.width / 2, d.z + d.height / 2, d.y + d.depth / 2);
    const wireGeo = new THREE.EdgesGeometry(mesh.geometry);
    const isSelected = this.selection.has(mesh);
    const wireMat = new THREE.LineBasicMaterial({
      color: isSelected ? 0xFFD700 : 0xffffff,
      transparent: true,
      opacity: isSelected ? 0.8 : 0.4,
    });
    const newWire = new THREE.LineSegments(wireGeo, wireMat);
    newWire.position.copy(mesh.position);
    mesh.userData.wireframe = newWire;
    newWire.userData.isWireframe = true;
    this.scene.add(newWire);
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Selection
  // ════════════════════════════════════════════════════

  _highlightMesh(mesh, selected) {
    const wire = mesh.userData.wireframe;
    if (wire) {
      wire.material.color.setHex(selected ? 0xFFD700 : 0xffffff);
      wire.material.opacity = selected ? 0.8 : 0.4;
    }
    mesh.material.emissive.setHex(selected ? 0x222200 : 0x000000);
  }

  _selectMesh(mesh) {
    for (const m of this.selection) this._highlightMesh(m, false);
    this.selection.clear();
    this.selected = mesh;
    this.selection.add(mesh);
    this._highlightMesh(mesh, true);
    this.renderer.domElement.style.cursor = 'grab';
    this._notifySelection();
  }

  _toggleSelect(mesh) {
    if (this.selection.has(mesh)) {
      this.selection.delete(mesh);
      this._highlightMesh(mesh, false);
      if (this.selected === mesh) {
        this.selected = this.selection.size > 0
          ? [...this.selection][this.selection.size - 1]
          : null;
      }
    } else {
      this.selection.add(mesh);
      this._highlightMesh(mesh, true);
      this.selected = mesh;
    }
    this.renderer.domElement.style.cursor = this.selection.size > 0 ? 'grab' : 'default';
    this._notifySelection();
  }

  _deselectAll() {
    for (const m of this.selection) this._highlightMesh(m, false);
    this.selection.clear();
    this.selected = null;
    this.renderer.domElement.style.cursor = 'default';
    this._notifySelection();
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Collision detection
  // ════════════════════════════════════════════════════

  _checkCollision(mesh) {
    const d = mesh.userData.data;
    for (const m of this.meshes) {
      if (m === mesh || this.selection.has(m)) continue;
      const od = m.userData.data;
      const overlapX = d.x < od.x + od.width && d.x + d.width > od.x;
      const overlapY = d.y < od.y + od.depth && d.y + d.depth > od.y;
      const overlapZ = d.z < od.z + od.height && d.z + d.height > od.z;
      if (overlapX && overlapY && overlapZ) return true;
    }
    return false;
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Snap computation
  // ════════════════════════════════════════════════════

  _computeSnap(rawX, rawY, rawZ, draggedMesh) {
    const d = draggedMesh.userData.data;
    let snapX = rawX, snapY = rawY, snapZ = rawZ;
    let snappedX = false, snappedY = false, snappedZ = false;
    let snapLabelX = '', snapLabelY = '', snapLabelZ = '';
    let guidesX = [], guidesY = [], guidesZ = [];

    const TW = this.truckWidth;
    const TD = this.truckDepth;
    const TH = this.truckHeight;

    // X candidates (width axis)
    const xCandidates = [
      { val: 0, label: 'left wall' },
      { val: TW - d.width, label: 'right wall' },
    ];
    // Y candidates (depth axis)
    const yCandidates = [
      { val: 0, label: 'back (cab)' },
    ];
    // Z candidates (height axis)
    const zCandidates = [
      { val: 0, label: 'floor' },
    ];

    // Add candidates from other editor meshes (skip selected)
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i];
      if (m === draggedMesh || this.selection.has(m)) continue;
      const od = m.userData.data;
      const oName = (od.name || od.group || 'case').substring(0, 12);

      // X snap: cases at similar depth/height
      const yOverlap = Math.min(rawY + d.depth, od.y + od.depth) - Math.max(rawY, od.y);
      const zOverlap = Math.min(rawZ + d.height, od.z + od.height) - Math.max(rawZ, od.z);
      if (yOverlap > 2 || zOverlap > 2) {
        xCandidates.push({ val: od.x + od.width, label: 'right of ' + oName });
        xCandidates.push({ val: od.x - d.width, label: 'left of ' + oName });
        xCandidates.push({ val: od.x, label: 'align left ' + oName });
        if (Math.abs(d.width - od.width) > 1) {
          xCandidates.push({ val: od.x + od.width - d.width, label: 'align right ' + oName });
        }
      }

      // Y snap (depth)
      const xOverlap = Math.min(rawX + d.width, od.x + od.width) - Math.max(rawX, od.x);
      if (xOverlap > 2) {
        yCandidates.push({ val: od.y + od.depth, label: 'behind ' + oName });
        yCandidates.push({ val: od.y - d.depth, label: 'in front of ' + oName });
        yCandidates.push({ val: od.y, label: 'align front ' + oName });
        if (Math.abs(d.depth - od.depth) > 1) {
          yCandidates.push({ val: od.y + od.depth - d.depth, label: 'align back ' + oName });
        }
      }

      // Z snap (stacking)
      const xOverlapS = Math.min(rawX + d.width, od.x + od.width) - Math.max(rawX, od.x);
      const yOverlapS = Math.min(rawY + d.depth, od.y + od.depth) - Math.max(rawY, od.y);
      if (xOverlapS > 2 && yOverlapS > 2) {
        // Use case data directly (universal mode — dims on the case object)
        if (od.stackable && (od.maxStack || od.max_stack || 1) >= 2) {
          const stackZ = od.z + od.height;
          if (stackZ + d.height <= TH) {
            zCandidates.push({ val: stackZ, label: 'on ' + oName });
          }
        }
      }
    }

    // Find best X snap
    let bestDistX = ED_SNAP_THRESHOLD + 1;
    for (const c of xCandidates) {
      const dist = Math.abs(rawX - c.val);
      if (dist <= ED_SNAP_THRESHOLD && dist < bestDistX) {
        bestDistX = dist;
        snapX = c.val; snappedX = true; snapLabelX = c.label; guidesX = [c.val];
      }
    }

    // Find best Y snap
    let bestDistY = ED_SNAP_THRESHOLD + 1;
    for (const c of yCandidates) {
      const dist = Math.abs(rawY - c.val);
      if (dist <= ED_SNAP_THRESHOLD && dist < bestDistY) {
        bestDistY = dist;
        snapY = c.val; snappedY = true; snapLabelY = c.label; guidesY = [c.val];
      }
    }

    // Find best Z snap
    let bestDistZ = ED_SNAP_THRESHOLD + 1;
    for (const c of zCandidates) {
      const dist = Math.abs(rawZ - c.val);
      if (dist <= ED_SNAP_THRESHOLD && dist < bestDistZ) {
        bestDistZ = dist;
        snapZ = c.val; snappedZ = true; snapLabelZ = c.label; guidesZ = [c.val];
      }
    }

    // Clamp Z (can't go below floor)
    snapZ = Math.max(0, snapZ);

    // Collision push: if snapped position overlaps, try next-best candidate
    const self = this;
    function hasCollisionAt(tx, ty, tz) {
      const TOL = 0.5;
      for (let i = 0; i < self.meshes.length; i++) {
        const m = self.meshes[i];
        if (m === draggedMesh || self.selection.has(m)) continue;
        const od = m.userData.data;
        if (tx + TOL < od.x + od.width && tx + d.width - TOL > od.x &&
            ty + TOL < od.y + od.depth && ty + d.depth - TOL > od.y &&
            tz + TOL < od.z + od.height && tz + d.height - TOL > od.z) {
          return true;
        }
      }
      return false;
    }

    if (hasCollisionAt(snapX, snapY, snapZ)) {
      const sortedX = xCandidates.slice().sort((a, b) => Math.abs(rawX - a.val) - Math.abs(rawX - b.val));
      for (const cx of sortedX) {
        if (Math.abs(rawX - cx.val) > ED_SNAP_THRESHOLD * 3) break;
        if (!hasCollisionAt(cx.val, snapY, snapZ)) {
          snapX = cx.val; snappedX = true; snapLabelX = cx.label; guidesX = [cx.val];
          break;
        }
      }
      if (hasCollisionAt(snapX, snapY, snapZ)) {
        const sortedY = yCandidates.slice().sort((a, b) => Math.abs(rawY - a.val) - Math.abs(rawY - b.val));
        for (const cy of sortedY) {
          if (Math.abs(rawY - cy.val) > ED_SNAP_THRESHOLD * 3) break;
          if (!hasCollisionAt(snapX, cy.val, snapZ)) {
            snapY = cy.val; snappedY = true; snapLabelY = cy.label; guidesY = [cy.val];
            break;
          }
        }
      }
    }

    return { x: snapX, y: snapY, z: snapZ, snappedX, snappedY, snappedZ, snapLabelX, snapLabelY, snapLabelZ, guidesX, guidesY, guidesZ };
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Snap guide lines
  // ════════════════════════════════════════════════════

  _drawSnapLines(snap) {
    this._clearSnapLines();
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.6 });

    if (snap.snappedX && snap.guidesX.length) {
      const xVal = snap.guidesX[0];
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xVal, 0, 0),
        new THREE.Vector3(xVal, 0, this.truckDepth),
      ]);
      const line = new THREE.LineSegments(geo, lineMat.clone());
      this.scene.add(line);
      this.snapLines.push(line);
    }
    if (snap.snappedY && snap.guidesY.length) {
      const yVal = snap.guidesY[0];
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, yVal),
        new THREE.Vector3(this.truckWidth, 0, yVal),
      ]);
      const line = new THREE.LineSegments(geo, lineMat.clone());
      this.scene.add(line);
      this.snapLines.push(line);
    }
    if (snap.snappedZ && snap.guidesZ.length) {
      const zVal = snap.guidesZ[0];
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, zVal, 0),
        new THREE.Vector3(this.truckWidth, zVal, 0),
      ]);
      const line = new THREE.LineSegments(geo, lineMat.clone());
      this.scene.add(line);
      this.snapLines.push(line);
    }
  }

  _clearSnapLines() {
    this.snapLines.forEach(l => {
      this.scene.remove(l);
      l.geometry.dispose();
      l.material.dispose();
    });
    this.snapLines = [];
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Pointer events
  // ════════════════════════════════════════════════════

  _getIntersects(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.activeCamera);
    return { hits: raycaster.intersectObjects(this.meshes), raycaster };
  }

  _pointerDown(event) {
    if (!this.active) return;
    const { hits, raycaster } = this._getIntersects(event);

    if (hits.length > 0) {
      const mesh = hits[0].object;

      // Multi-select with Shift
      if (event.shiftKey) {
        this._toggleSelect(mesh);
      } else {
        if (!this.selection.has(mesh)) {
          this._deselectAll();
          this._selectMesh(mesh);
        }
      }

      // Start drag
      this.dragMesh = mesh;
      this.controls.enabled = false;
      this.renderer.domElement.style.cursor = 'grabbing';

      // Save start positions for delta computation
      const dd = mesh.userData.data;
      this.dragStart = { x: dd.x, y: dd.y, z: dd.z };
      this.dragGroupStart.clear();
      if (this.selection.size > 1) {
        for (const m of this.selection) {
          if (m === mesh) continue;
          const md = m.userData.data;
          this.dragGroupStart.set(m, { x: md.x, y: md.y, z: md.z });
        }
      }

      // Set drag plane at mesh's current height
      this.dragPlane.constant = -mesh.position.y;

      // Compute offset
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(this.dragPlane, intersection);
      if (intersection) {
        this.dragOffset.set(
          intersection.x - mesh.position.x,
          0,
          intersection.z - mesh.position.z
        );
      }
      // Vertical offset for Z-lock
      if (this.axisLock === 'z') {
        const camDir = new THREE.Vector3();
        this.activeCamera.getWorldDirection(camDir);
        camDir.y = 0; camDir.normalize();
        const vertPlane = new THREE.Plane();
        vertPlane.setFromNormalAndCoplanarPoint(camDir, mesh.position);
        const vertHit = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(vertPlane, vertHit)) {
          this.dragOffset.y = vertHit.y - mesh.position.y;
        }
      }
      event.preventDefault();
    } else {
      // Empty space
      if (event.shiftKey) {
        this.boxStart = { x: event.clientX, y: event.clientY };
        this.boxActive = false;
      }
    }
  }

  _pointerMove(event) {
    if (!this.active) return;

    // Box selection mode
    if (this.boxStart && !this.dragMesh) {
      const dx = event.clientX - this.boxStart.x;
      const dy = event.clientY - this.boxStart.y;
      if (!this.boxActive && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        this.boxActive = true;
        this.controls.enabled = false;
      }
      if (this.boxActive) {
        const boxEl = document.getElementById('ed-box-select');
        if (boxEl) {
          const rect = this.viewer.container.getBoundingClientRect();
          boxEl.style.display = 'block';
          boxEl.style.left = (Math.min(this.boxStart.x, event.clientX) - rect.left) + 'px';
          boxEl.style.top = (Math.min(this.boxStart.y, event.clientY) - rect.top) + 'px';
          boxEl.style.width = Math.abs(dx) + 'px';
          boxEl.style.height = Math.abs(dy) + 'px';
        }
      }
      return;
    }

    if (!this.dragMesh) return;
    const { raycaster } = this._getIntersects(event);

    const intersection = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(this.dragPlane, intersection);
    if (!hit) return;

    const d = this.dragMesh.userData.data;
    let rawX = intersection.x - this.dragOffset.x - d.width / 2;
    let rawY = intersection.z - this.dragOffset.z - d.depth / 2;
    let rawZ = d.z;

    // Axis lock
    if (this.axisLock === 'x' && this.dragStart) rawY = this.dragStart.y;
    if (this.axisLock === 'y' && this.dragStart) rawX = this.dragStart.x;
    if (this.axisLock === 'z' && this.dragStart) {
      const camDir = new THREE.Vector3();
      this.activeCamera.getWorldDirection(camDir);
      camDir.y = 0; camDir.normalize();
      const vertPlane = new THREE.Plane();
      vertPlane.setFromNormalAndCoplanarPoint(camDir, this.dragMesh.position);
      const vertHit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(vertPlane, vertHit)) {
        rawZ = vertHit.y - this.dragOffset.y - d.height / 2;
      }
      rawX = this.dragStart.x;
      rawY = this.dragStart.y;
    }

    // Snap
    const snap = this._computeSnap(rawX, rawY, rawZ, this.dragMesh);

    // Delta from start
    const deltaX = snap.x - this.dragStart.x;
    const deltaY = snap.y - this.dragStart.y;
    const deltaZ = snap.z - this.dragStart.z;

    // Update primary mesh
    this.dragMesh.position.x = snap.x + d.width / 2;
    this.dragMesh.position.z = snap.y + d.depth / 2;
    this.dragMesh.position.y = snap.z + d.height / 2;
    const wire = this.dragMesh.userData.wireframe;
    if (wire) wire.position.copy(this.dragMesh.position);

    // Group drag
    if (this.selection.size > 1 && this.dragGroupStart.size > 0) {
      for (const [m, startPos] of this.dragGroupStart) {
        const md = m.userData.data;
        m.position.x = startPos.x + deltaX + md.width / 2;
        m.position.z = startPos.y + deltaY + md.depth / 2;
        m.position.y = startPos.z + deltaZ + md.height / 2;
        if (m.userData.wireframe) m.userData.wireframe.position.copy(m.position);
      }
    }

    // Snap guides
    this._drawSnapLines(snap);

    // Collision visual feedback
    this.dragMesh.userData.data.x = snap.x;
    this.dragMesh.userData.data.y = snap.y;
    this.dragMesh.userData.data.z = snap.z;
    const collides = this._checkCollision(this.dragMesh);
    this.dragMesh.material.emissive.setHex(collides ? 0x330000 : 0x222200);
  }

  _pointerUp(event) {
    if (!this.active) return;

    // Box selection finalization
    if (this.boxStart) {
      const boxEl = document.getElementById('ed-box-select');
      if (boxEl) boxEl.style.display = 'none';

      if (this.boxActive) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x1 = Math.min(this.boxStart.x, event.clientX) - rect.left;
        const y1 = Math.min(this.boxStart.y, event.clientY) - rect.top;
        const x2 = Math.max(this.boxStart.x, event.clientX) - rect.left;
        const y2 = Math.max(this.boxStart.y, event.clientY) - rect.top;

        if (!event.shiftKey) this._deselectAll();
        for (const m of this.meshes) {
          const screenPos = m.position.clone().project(this.activeCamera);
          const sx = (screenPos.x * 0.5 + 0.5) * rect.width;
          const sy = (-screenPos.y * 0.5 + 0.5) * rect.height;
          if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
            this.selection.add(m);
            this._highlightMesh(m, true);
            this.selected = m;
          }
        }
        this._notifySelection();
      }

      this.boxStart = null;
      this.boxActive = false;
      this.controls.enabled = true;
      return;
    }

    // Drag finalization
    if (!this.dragMesh) return;

    const meshesToFinalize = this.selection.size > 1
      ? [...this.selection]
      : [this.dragMesh];

    for (const m of meshesToFinalize) {
      const md = m.userData.data;
      md.x = Math.round(m.position.x - md.width / 2);
      md.y = Math.round(m.position.z - md.depth / 2);
      md.z = Math.max(0, Math.round(m.position.y - md.height / 2));
      m.position.set(md.x + md.width / 2, md.z + md.height / 2, md.y + md.depth / 2);
      if (m.userData.wireframe) m.userData.wireframe.position.copy(m.position);
      const idx = this.meshes.indexOf(m);
      if (idx >= 0) Object.assign(this.placements[idx], md);
    }

    this._pushUndo();
    this.dragMesh = null;
    this.controls.enabled = true;
    this.renderer.domElement.style.cursor = 'grab';
    this._clearSnapLines();
    this._notifyUpdate();
    this._notifySelection();
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Keyboard
  // ════════════════════════════════════════════════════

  _keyDown(event) {
    if (!this.active) return;
    if (event.key === 'r' || event.key === 'R') {
      this.rotate();
      event.preventDefault();
    } else if (event.key === 'z' && (event.ctrlKey || event.metaKey)) {
      this.undo();
      event.preventDefault();
    } else if (event.key === 'Escape') {
      this._deselectAll();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      this.deleteSelected();
      event.preventDefault();
    } else if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
      this.selectAll();
      event.preventDefault();
    } else if (event.key === 'x' || event.key === 'X') {
      if (!event.ctrlKey && !event.metaKey) {
        this.setAxisLock('x');
        this._notifyUpdate();
        event.preventDefault();
      }
    } else if (event.key === 'y' || event.key === 'Y') {
      this.setAxisLock('y');
      this._notifyUpdate();
      event.preventDefault();
    } else if ((event.key === 'z' || event.key === 'Z') && !event.ctrlKey && !event.metaKey) {
      this.setAxisLock('z');
      this._notifyUpdate();
      event.preventDefault();
    }
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Auto-group placements into wall sections
  // ════════════════════════════════════════════════════

  _autoGroupWalls(placements) {
    if (!placements.length) return [];

    const sorted = [...placements].sort((a, b) => a.y - b.y);
    const walls = [];
    let curWall = {
      placements: [sorted[0]],
      yStart: sorted[0].y,
      yEnd: sorted[0].y + sorted[0].depth,
    };

    for (let i = 1; i < sorted.length; i++) {
      const p = sorted[i];
      const pEnd = p.y + p.depth;
      if (p.y < curWall.yEnd + 2) {
        curWall.placements.push(p);
        curWall.yEnd = Math.max(curWall.yEnd, pEnd);
      } else {
        walls.push(curWall);
        curWall = { placements: [p], yStart: p.y, yEnd: pEnd };
      }
    }
    walls.push(curWall);

    const TW = this.truckWidth;
    const wallSections = [];
    let wallIdx = 0;
    for (const w of walls) {
      const groups = [...new Set(w.placements.map(p => p.group || p.subgroup || p.name))];
      const label = groups.length <= 2
        ? groups.join(' + ')
        : groups[0] + ' +' + (groups.length - 1);
      const maxRight = Math.max(...w.placements.map(p => p.x + p.width));
      const wallWidth = Math.round(Math.min(maxRight, TW));
      const fillPct = Math.round((wallWidth / TW) * 100);
      wallSections.push({
        id: 'wall_' + wallIdx,
        label,
        section: 'EDITOR',
        patternId: null,
        yStart: Math.round(w.yStart),
        yEnd: Math.round(w.yEnd),
        wallWidth: Math.round(wallWidth),
        fillPct,
        placements: w.placements,
        status: 'approved',
        caseCount: w.placements.length,
        depth: Math.round(w.yEnd - w.yStart),
      });
      wallIdx++;
    }
    console.log(`[Editor] Auto-grouped into ${wallSections.length} walls`);
    return wallSections;
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Notification callbacks
  // ════════════════════════════════════════════════════

  _notifyUpdate() {
    if (this.onUpdate) this.onUpdate();
  }

  _notifySelection() {
    if (this.onSelectionChange) {
      this.onSelectionChange(this.getSelectedData(), this.selection.size);
    }
  }
}
