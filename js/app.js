// app.js — Application initialization, UI wiring, config loading
import { loadTruckConfig, loadBlockConfig, getBlockConfigFiles } from './config-loader.js';
import { TruckViewer } from './viewer3d.js';
import { fetchAndParseCases } from './sheet-loader.js';

let viewer;
let truckConfig;
let blockConfig;
let currentTruckKey;
let parsedCases = []; // cases from last sheet fetch (unplaced)

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

    // Load default block config
    populateBlockSelect();
    blockConfig = await loadBlockConfig(getBlockConfigFiles()[0]);

    // Initialize 3D viewer
    viewer = new TruckViewer(canvasWrap);
    viewer.setDepartments(blockConfig.departments);

    // Set default truck
    currentTruckKey = truckConfig.default || '53ft';
    truckSelect.value = currentTruckKey;
    viewer.setTruck(truckConfig.trucks[currentTruckKey]);

    // Populate dept filter from block config
    populateDeptFilter();

    // Restore sheet URL from localStorage
    const savedUrl = localStorage.getItem('tlp-sheet-url');
    if (savedUrl) sheetUrlInput.value = savedUrl;

    // Wire up events
    wireEvents();

    // Update stats for empty state
    updateStats();
    updateLegend();

    console.log('[TLP] App ready — empty truck loaded');
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
  getBlockConfigFiles().forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    // Derive label from filename: blocks-gb.json → "GB"
    const label = f.replace('blocks-', '').replace('.json', '').toUpperCase();
    opt.textContent = label;
    blockSelect.appendChild(opt);
  });
}

function populateDeptFilter() {
  // Keep "All Departments" as first option
  deptFilter.innerHTML = '<option value="ALL">All Departments</option>';
  if (blockConfig && blockConfig.departments) {
    for (const [code, dept] of Object.entries(blockConfig.departments)) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = `${code} - ${dept.label}`;
      deptFilter.appendChild(opt);
    }
  }
}

// ── Wire UI events ──
function wireEvents() {
  // Truck size change
  truckSelect.addEventListener('change', () => {
    currentTruckKey = truckSelect.value;
    viewer.clearCases();
    viewer.setTruck(truckConfig.trucks[currentTruckKey]);
    updateStats();
    updateLegend();
    updateCaseList();
    console.log(`[TLP] Truck changed to ${currentTruckKey}`);
  });

  // Block config change
  blockSelect.addEventListener('change', async () => {
    const file = blockSelect.value;
    try {
      blockConfig = await loadBlockConfig(file);
      viewer.setDepartments(blockConfig.departments);
      populateDeptFilter();
      viewer.clearCases();
      updateStats();
      updateLegend();
      updateCaseList();
      console.log(`[TLP] Block config changed to ${file}`);
    } catch (err) {
      console.error(`[TLP] Failed to load ${file}:`, err);
    }
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
      <div class="tt-dept" style="background:${viewer.getDeptHex(data.dept)}40;color:${viewer.getDeptHex(data.dept)}">${data.dept} - ${data.subgroup}</div>
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
      <div class="detail-field"><span class="df-label">Block</span><span class="df-value" style="font-size:10px">${data.block_name}</span></div>
      <div class="detail-field"><span class="df-label">Dept</span><span class="df-value"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${viewer.getDeptHex(data.dept)};margin-right:4px;vertical-align:middle"></span>${data.dept}</span></div>
      <div class="detail-field"><span class="df-label">Subgroup</span><span class="df-value">${data.subgroup}</span></div>
      <div class="detail-field"><span class="df-label">Position</span><span class="df-value">X:${data.x}" Y:${data.y}" Z:${data.z}"</span></div>
      <div class="detail-field"><span class="df-label">Dimensions</span><span class="df-value">${data.width}" x ${data.depth}" x ${data.height}"</span></div>
      <div class="detail-field"><span class="df-label">Rotation</span><span class="df-value">${data.rotation || 0}&deg;</span></div>
    `;
    // Highlight in list
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

    // Log to console as required by Phase 2
    console.log(`[TLP] Fetched ${parsedCases.length} cases from sheet`);
    console.table(parsedCases.slice(0, 10));

    // Update sidebar case list (no 3D placement yet — Phase 3)
    updateCaseList();
    updateLegend();
    updateStats();

    const now = new Date().toLocaleTimeString('fr-CA');
    sheetStatus.textContent = `${parsedCases.length} cases loaded — ${now}`;
  } catch (err) {
    console.error('[TLP] Sheet fetch error:', err);
    sheetStatus.textContent = 'Error: ' + err.message;
  } finally {
    loadingOverlay.classList.remove('active');
  }
}

// ── Update stats bar ──
function updateStats() {
  const stats = viewer.getStats();
  // Show parsed case count if no placements yet
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
  if (!blockConfig || !blockConfig.departments) return;

  const cases = getActiveCases();
  const counts = {};
  cases.forEach(p => {
    counts[p.dept] = (counts[p.dept] || 0) + 1;
  });

  for (const [code, dept] of Object.entries(blockConfig.departments)) {
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
    // Only allow click-to-select if cases are placed in 3D
    if (hasPlacement) {
      el.addEventListener('click', () => viewer.selectCase(idx));
    }
    caseList.appendChild(el);
  });
}

// ── Go ──
boot();
