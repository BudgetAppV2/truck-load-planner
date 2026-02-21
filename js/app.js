// app.js — Application initialization, UI wiring, solver integration
import { loadTruckConfig, loadBlockConfig } from './config-loader.js';
import { TruckViewer } from './viewer3d.js';
import { fetchAndParseCases } from './sheet-loader.js';
import { wallPlannerSolve, buildDeptPriority, buildDeptColors } from './solver.js';

let viewer;
let truckConfig;
let blockConfig = null;  // null = universal mode (no legacy config)
let currentTruckKey;
let parsedCases = [];    // cases from last sheet fetch (unplaced)
let autoDepartments = {};// auto-generated dept colors from cases
let isUniversalMode = true;

// ── DOM refs ──
const truckSelect = document.getElementById('truck-select');
const blockSelect = document.getElementById('block-select');
const sheetUrlInput = document.getElementById('sheet-url');
const btnFetch = document.getElementById('btn-fetch-sheet');
const btnReset = document.getElementById('btn-reset');
const btnTop = document.getElementById('btn-top');
const btnFront = document.getElementById('btn-front');
const btnSide = document.getElementById('btn-side');
const btnPerspective = document.getElementById('btn-perspective');
const deptFilter = document.getElementById('dept-filter');
const tooltip = document.getElementById('tooltip');
const canvasWrap = document.getElementById('canvas-wrap');

// Stats
const statCases = document.getElementById('stat-cases');
const statDepth = document.getElementById('stat-depth');
const statFill = document.getElementById('stat-fill');
const statBarFill = document.getElementById('stat-bar-fill');
const statVolume = document.getElementById('stat-volume');
const sheetStatus = document.getElementById('sheet-status');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

// Sidebar
const legendList = document.getElementById('legend-list');
const caseList = document.getElementById('case-list');
const visibleCount = document.getElementById('visible-count');
const detailPanel = document.getElementById('detail-panel');
const detailContent = document.getElementById('detail-content');
const detailClose = document.getElementById('detail-close');

// ── Boot ──
async function boot() {
  try {
    // Load truck config
    truckConfig = await loadTruckConfig();
    populateTruckSelect();

    // Populate config dropdown (universal default + legacy options)
    populateBlockSelect();

    // Initialize 3D viewer
    viewer = new TruckViewer(canvasWrap);

    // Set default truck
    currentTruckKey = truckConfig.default || '53ft';
    truckSelect.value = currentTruckKey;
    viewer.setTruck(truckConfig.trucks[currentTruckKey]);

    // Restore sheet URL from localStorage
    const savedUrl = localStorage.getItem('tlp-sheet-url');
    if (savedUrl) sheetUrlInput.value = savedUrl;

    // Restore config mode from localStorage
    const savedConfig = localStorage.getItem('tlp-config-mode');
    if (savedConfig) {
      blockSelect.value = savedConfig;
      await switchConfigMode(savedConfig);
    }

    // Wire up events
    wireEvents();

    // Update stats for empty state
    updateStats();
    updateLegend();

    console.log('[TLP] App ready — empty truck loaded (universal mode)');
  } catch (err) {
    console.error('[TLP] Boot failed:', err);
  }
}

// ── Populate dropdowns ──
function populateTruckSelect() {
  truckSelect.innerHTML = '';
  for (const [key, cfg] of Object.entries(truckConfig.trucks)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = cfg.label;
    truckSelect.appendChild(opt);
  }
}

function populateBlockSelect() {
  blockSelect.innerHTML = '';
  // Universal mode (default)
  const uniOpt = document.createElement('option');
  uniOpt.value = 'universal';
  uniOpt.textContent = 'Universal (dimensions in sheet)';
  blockSelect.appendChild(uniOpt);
  // Legacy: Grands Ballets
  const gbOpt = document.createElement('option');
  gbOpt.value = 'blocks-gb.json';
  gbOpt.textContent = 'Grands Ballets (legacy)';
  blockSelect.appendChild(gbOpt);
}

function populateDeptFilter() {
  deptFilter.innerHTML = '<option value="ALL">All Departments</option>';
  const depts = getActiveDepartments();
  for (const [code, dept] of Object.entries(depts)) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${code} - ${dept.label}`;
    deptFilter.appendChild(opt);
  }
}

// Get the active department map (legacy blockConfig or auto-generated)
function getActiveDepartments() {
  if (!isUniversalMode && blockConfig && blockConfig.departments) {
    return blockConfig.departments;
  }
  return autoDepartments;
}

// Switch between universal and legacy config modes
async function switchConfigMode(value) {
  localStorage.setItem('tlp-config-mode', value);
  if (value === 'universal') {
    isUniversalMode = true;
    blockConfig = null;
    console.log('[TLP] Switched to universal mode');
  } else {
    isUniversalMode = false;
    try {
      blockConfig = await loadBlockConfig(value);
      console.log(`[TLP] Loaded legacy config: ${value}`);
    } catch (err) {
      console.error(`[TLP] Failed to load ${value}:`, err);
      blockConfig = null;
      isUniversalMode = true;
    }
  }
  viewer.setDepartments(getActiveDepartments());
  populateDeptFilter();
  viewer.clearCases();
  parsedCases = [];
  updateStats();
  updateLegend();
  updateCaseList();
}

// ── Wire UI events ──
function wireEvents() {
  // Truck size change
  truckSelect.addEventListener('change', () => {
    currentTruckKey = truckSelect.value;
    viewer.clearCases();
    viewer.setTruck(truckConfig.trucks[currentTruckKey]);
    // Re-run solver if we have cases
    if (parsedCases.length > 0) {
      runSolver();
    } else {
      updateStats();
      updateLegend();
      updateCaseList();
    }
    console.log(`[TLP] Truck changed to ${currentTruckKey}`);
  });

  // Config mode change
  blockSelect.addEventListener('change', async () => {
    await switchConfigMode(blockSelect.value);
  });

  // Save sheet URL
  sheetUrlInput.addEventListener('change', () => {
    localStorage.setItem('tlp-sheet-url', sheetUrlInput.value);
  });

  // Fetch sheet
  btnFetch.addEventListener('click', () => fetchSheet());

  // Also fetch on Enter key in the sheet URL input
  sheetUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchSheet();
  });

  // Camera buttons
  btnReset.addEventListener('click', () => viewer.resetView());
  btnTop.addEventListener('click', () => viewer.topView());
  btnFront.addEventListener('click', () => viewer.frontView());
  btnSide.addEventListener('click', () => viewer.sideView());
  btnPerspective.addEventListener('click', () => {
    const isPerspective = viewer.togglePerspective();
    btnPerspective.textContent = isPerspective ? 'Perspective' : 'Orthographic';
  });

  // Department filter
  deptFilter.addEventListener('change', (e) => {
    viewer.applyFilter(e.target.value);
    updateCaseList();
  });

  // Case hover → tooltip
  viewer.onCaseHover = (data, event) => {
    if (!data) {
      tooltip.style.display = 'none';
      return;
    }
    tooltip.style.display = 'block';
    tooltip.innerHTML = `
      <div class="tt-name">${data.name}</div>
      <div class="tt-dept" style="background:${viewer.getDeptHex(data.dept)}40;color:${viewer.getDeptHex(data.dept)}">${data.dept} - ${data.subgroup || data.group || ''}</div>
      <div class="tt-row"><span class="tt-label">Position</span><span>X:${data.x}" Y:${data.y}" Z:${data.z}"</span></div>
      <div class="tt-row"><span class="tt-label">Size</span><span>${data.width}" x ${data.depth}" x ${data.height}"</span></div>
    `;
    const rect = canvasWrap.getBoundingClientRect();
    let tx = event.clientX - rect.left + 16;
    let ty = event.clientY - rect.top + 16;
    if (tx + 260 > rect.width) tx = event.clientX - rect.left - 270;
    if (ty + 120 > rect.height) ty = event.clientY - rect.top - 130;
    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';
  };

  // Case select → detail panel
  viewer.onCaseSelect = (index, data) => {
    detailPanel.classList.add('active');
    detailContent.innerHTML = `
      <div class="detail-field"><span class="df-label">Name</span><span class="df-value">${data.name}</span></div>
      <div class="detail-field"><span class="df-label">Dept</span><span class="df-value"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${viewer.getDeptHex(data.dept)};margin-right:4px;vertical-align:middle"></span>${data.dept}</span></div>
      <div class="detail-field"><span class="df-label">Group</span><span class="df-value">${data.subgroup || data.group || ''}</span></div>
      <div class="detail-field"><span class="df-label">Position</span><span class="df-value">X:${data.x}" Y:${data.y}" Z:${data.z}"</span></div>
      <div class="detail-field"><span class="df-label">Dimensions</span><span class="df-value">${data.width}" x ${data.depth}" x ${data.height}"</span></div>
      <div class="detail-field"><span class="df-label">Rotation</span><span class="df-value">${data.rotation || 0}&deg;</span></div>
    `;
    document.querySelectorAll('.case-item').forEach(el => {
      el.classList.toggle('selected', parseInt(el.dataset.index) === index);
    });
  };

  // Close detail panel
  detailClose.addEventListener('click', () => {
    detailPanel.classList.remove('active');
    viewer.deselectCase();
    document.querySelectorAll('.case-item.selected').forEach(el => el.classList.remove('selected'));
  });
}

// ── Fetch and parse Google Sheet ──
async function fetchSheet() {
  const input = sheetUrlInput.value.trim();
  if (!input) {
    sheetStatus.textContent = 'Enter a Google Sheet URL or ID';
    return;
  }
  localStorage.setItem('tlp-sheet-url', input);

  loadingOverlay.classList.add('active');
  loadingText.textContent = 'Lecture du Google Sheet...';

  try {
    loadingText.textContent = 'Parsing inventaire...';
    parsedCases = await fetchAndParseCases(input, blockConfig);

    console.log(`[TLP] Fetched ${parsedCases.length} cases from sheet`);
    console.table(parsedCases.slice(0, 10));

    // Auto-generate dept colors from cases (for universal mode or fallback)
    autoDepartments = buildDeptColors(parsedCases);
    viewer.setDepartments(getActiveDepartments());
    populateDeptFilter();

    // Run solver
    loadingText.textContent = 'Placement en cours...';
    runSolver();

    const now = new Date().toLocaleTimeString('fr-CA');
    sheetStatus.textContent = `${parsedCases.length} cases loaded — ${now}`;
  } catch (err) {
    console.error('[TLP] Sheet fetch error:', err);
    sheetStatus.textContent = 'Error: ' + err.message;
  } finally {
    loadingOverlay.classList.remove('active');
  }
}

// ── Run solver and display results ──
function runSolver() {
  if (parsedCases.length === 0) return;

  const truck = truckConfig.trucks[currentTruckKey];
  const deptPriority = buildDeptPriority(parsedCases);

  const config = {
    truckWidth: truck.width,
    truckLength: truck.length,
    truckHeight: truck.height,
    deptPriority,
    kbPatterns: [],  // No knowledge base in universal mode
  };

  console.log('[TLP] Running WallPlanner solver...', config);
  const result = wallPlannerSolve(parsedCases, config);

  console.log(`[TLP] Solver done: ${result.placements.length} placed, ${result.wallSections.length} walls`);

  // Load placements into 3D viewer
  viewer.loadData(result.placements);

  // Update all UI
  updateStats();
  updateLegend();
  updateCaseList();
}

// ── Update stats bar ──
function updateStats() {
  const stats = viewer.getStats();
  const caseCount = stats.caseCount || parsedCases.length;
  statCases.textContent = caseCount;
  statDepth.textContent = `${stats.maxDepth}" / ${stats.truckDepth}"`;
  statBarFill.style.width = stats.depthPct + '%';
  statBarFill.style.background = stats.depthPct > 90 ? '#e94560' : stats.depthPct > 70 ? '#f0a030' : '#4CAF50';
  statFill.textContent = stats.depthPct + '%';
  statVolume.textContent = stats.volumePct + '%';
}

// ── Get active case data (placed cases if available, else parsed cases) ──
function getActiveCases() {
  return viewer.placementData.length > 0 ? viewer.placementData : parsedCases;
}

// ── Update legend ──
function updateLegend() {
  legendList.innerHTML = '';
  const depts = getActiveDepartments();
  if (!depts || Object.keys(depts).length === 0) return;

  const cases = getActiveCases();
  const counts = {};
  cases.forEach(p => {
    const d = p.dept || 'GENERAL';
    counts[d] = (counts[d] || 0) + 1;
  });

  for (const [code, dept] of Object.entries(depts)) {
    if (!counts[code]) continue; // Only show depts that have cases
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <div class="legend-swatch" style="background:${dept.color}"></div>
      <span>${code} - ${dept.label}</span>
      <span class="legend-count">${counts[code] || 0}</span>
    `;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
      deptFilter.value = code;
      viewer.applyFilter(code);
      updateCaseList();
    });
    legendList.appendChild(item);
  }
}

// ── Update case list ──
function updateCaseList() {
  caseList.innerHTML = '';
  const cases = getActiveCases();
  const filter = deptFilter.value;
  const filtered = filter === 'ALL'
    ? cases
    : cases.filter(p => p.dept === filter);

  visibleCount.textContent = filtered.length;

  const hasPlacement = viewer.placementData.length > 0;

  filtered.forEach((item, fi) => {
    const idx = cases.indexOf(item);
    const el = document.createElement('div');
    el.className = 'case-item';
    el.dataset.index = idx;
    el.innerHTML = `
      <div class="case-dot" style="background:${viewer.getDeptHex(item.dept)}"></div>
      <span class="case-name" title="${item.name || item.nom}">${item.name || item.nom}</span>
      <span class="case-dims">${item.width}x${item.depth}x${item.height}</span>
    `;
    if (hasPlacement) {
      el.addEventListener('click', () => viewer.selectCase(idx));
    }
    caseList.appendChild(el);
  });
}

// ── Go ──
boot();
