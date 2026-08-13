// ══════════════════════════════════════════════════════════════
// ADMIN CUSTOMIZATION ENGINE
// Backs the Master Admin → "Customize" panel. Everything is stored
// as JSON blobs in a single `admin_configs` table (one row per
// config_type), loaded once per page load and cached in AdminConfig.
//
// Design principle: this NEVER changes the underlying workflow state
// machine (which phase a request moves to next, who approves what).
// It only controls DISPLAY — which filters/columns/stat-cards show,
// what labels/colors things use, which nav links are visible, and
// a small set of admin-defined extra fields on requests. That keeps
// a live procurement system safe while still being fully admin-editable.
// ══════════════════════════════════════════════════════════════

const ADMIN_CONFIG_TYPES = [
  'filters', 'columns', 'stat_cards', 'custom_fields',
  'departments', 'phase_display', 'export_columns', 'nav_visibility'
];

// Sensible defaults that reproduce today's hardcoded UI exactly, so
// nothing changes for anyone until Master Admin actually edits something.
const ADMIN_CONFIG_DEFAULTS = {
  filters: [
    { id: 'f_phase', field: 'phase', label: 'Phase', type: 'single', visible: true, order: 1 },
    { id: 'f_dept', field: 'department', label: 'Department', type: 'single', visible: true, order: 2 },
  ],
  columns: [
    { field: 'request_number', order: 1, visible: true },
    { field: 'project_name', order: 2, visible: true },
    { field: 'request_category', order: 3, visible: true },
    { field: 'department', order: 4, visible: true },
    { field: 'vendor', order: 5, visible: true },
    { field: 'phase', order: 6, visible: true },
    { field: 'lead_time', order: 7, visible: true },
    { field: 'updated_at', order: 8, visible: true },
    { field: 'requester', order: 9, visible: true },
  ],
  stat_cards: [
    { id: 'sc_total', source: 'builtin', key: 'total', order: 1, visible: true },
    { id: 'sc_active', source: 'builtin', key: 'active', order: 2, visible: true },
    { id: 'sc_closed', source: 'builtin', key: 'closed', order: 3, visible: true },
    { id: 'sc_users', source: 'builtin', key: 'users', order: 4, visible: true },
    { id: 'sc_vendors', source: 'builtin', key: 'vendors', order: 5, visible: true },
    { id: 'sc_rejected', source: 'builtin', key: 'rejected', order: 6, visible: true },
    { id: 'sc_onhold', source: 'builtin', key: 'onhold', order: 7, visible: true },
  ],
  custom_fields: [],
  departments: [],
  phase_display: {},
  export_columns: ['request_number', 'project_name', 'project_phase', 'request_category', 'department', 'vendor', 'phase', 'updated_at', 'requester'],
  nav_visibility: {},
};

const AdminConfig = {};
ADMIN_CONFIG_TYPES.forEach(t => { AdminConfig[t] = JSON.parse(JSON.stringify(ADMIN_CONFIG_DEFAULTS[t])); });

// Fields every filter/column/export builder can offer out of the box.
const BUILTIN_FIELD_DEFS = [
  { field: 'phase', label: 'Phase', kind: 'enum' },
  { field: 'department', label: 'Department', kind: 'enum' },
  { field: 'request_category', label: 'Category', kind: 'enum' },
  { field: 'urgency', label: 'Urgency', kind: 'enum' },
  { field: 'request_for', label: 'Request For', kind: 'enum' },
  { field: 'discipline', label: 'Discipline', kind: 'enum' },
  { field: 'is_on_hold', label: 'On Hold', kind: 'enum' },
  { field: 'created_at', label: 'Created Date', kind: 'date' },
  { field: 'updated_at', label: 'Updated Date', kind: 'date' },
  { field: 'project_name', label: 'Project Name', kind: 'text' },
  { field: 'item_note', label: 'Item Note', kind: 'text' },
];

// Fields that exist on a request but are never useful as a filter/column
// (ids, foreign keys, big JSON blobs, long free text, internal bookkeeping).
const FIELD_DISCOVERY_EXCLUDE = new Set([
  'id', 'created_by', 'assigned_pm_id', 'assigned_vendor_id', 'selected_quotation_id',
  'initial_approver_id', 'deviation_target_id', 'parent_request_id', 'request_number',
  'parts', 'attachments', 'phase_timestamps', 'qc_criteria', 'approval_path',
  'description', 'product_link', 'rejection_reason', 'client_approval_notes',
  'pm_final_approval_notes', 'modification_note', 'order_notes', 'hold_reason',
  'vendor_info_details', 'qc_notes', 'custom_field_values', 'sourcing',
  'is_modification', 'is_closed', 'closed_at', 'hold_started_at', 'total_hold_seconds',
]);

function humanizeFieldName(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// "Whatever is written in the request" → scan real request records so any
// field actually used in the data (not just a hand-picked shortlist) shows
// up as an available filter/column, with type auto-detected from the values.
function discoverRequestFields(sampleRequests) {
  const seen = new Map(); // field -> Set of sample values
  (sampleRequests || []).slice(0, 300).forEach(r => {
    Object.keys(r).forEach(k => {
      if (FIELD_DISCOVERY_EXCLUDE.has(k)) return;
      const v = r[k];
      if (v === null || v === undefined) return;
      if (typeof v === 'object') return; // skip nested objects/arrays (e.g. users, vendors joins)
      if (!seen.has(k)) seen.set(k, new Set());
      if (seen.get(k).size < 25) seen.get(k).add(String(v));
    });
  });
  const out = [];
  seen.forEach((vals, key) => {
    if (BUILTIN_FIELD_DEFS.some(f => f.field === key)) return; // already covered, avoid dupes
    let kind = 'text';
    if (/_at$|_date$/.test(key)) kind = 'date';
    else if (vals.size > 0 && vals.size <= 12) kind = 'enum';
    out.push({ field: key, label: humanizeFieldName(key), kind, sampleValues: [...vals] });
  });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function allFilterableFields(sampleRequests) {
  const custom = (AdminConfig.custom_fields || []).map(c => ({ field: 'custom:' + c.key, label: c.label, kind: c.type === 'select' ? 'enum' : (c.type === 'date' ? 'date' : 'text') }));
  const discovered = sampleRequests ? discoverRequestFields(sampleRequests) : (AdminConfig._discovered || []);
  return [...BUILTIN_FIELD_DEFS, ...discovered, ...custom];
}

// Call once after requests are loaded on any page that uses the filter/column
// builders, so fieldOptionsFor() can offer real values for discovered fields.
function refreshFieldCatalog(sampleRequests) {
  AdminConfig._discovered = discoverRequestFields(sampleRequests);
}

// ── LOAD / SAVE ──────────────────────────────────────────────
let _adminConfigLoaded = false;

async function applyAdminConfigOverrides() {
  const rows = await dbFetch(() => db.from('admin_configs').select('*'), 'customization config', { retries: 1 });
  const map = {};
  (rows || []).forEach(r => { map[r.config_type] = r.config_data; });
  ADMIN_CONFIG_TYPES.forEach(t => {
    AdminConfig[t] = (map[t] !== undefined && map[t] !== null) ? map[t] : JSON.parse(JSON.stringify(ADMIN_CONFIG_DEFAULTS[t]));
  });

  // Merge admin-added departments into the global DEPARTMENTS dict used
  // throughout the app (master.html, engineer.html, etc all read this
  // same global object by key, so this one merge propagates everywhere).
  if (typeof DEPARTMENTS !== 'undefined') {
    (AdminConfig.departments || []).forEach(d => { if (d.key && d.label) DEPARTMENTS[d.key] = d.label; });
  }

  // Merge phase label/color/icon overrides into the global PHASES dict.
  // Only touches existing phase keys — never adds/removes a phase, since
  // phase transitions elsewhere in the app are keyed to these exact strings.
  if (typeof PHASES !== 'undefined' && AdminConfig.phase_display) {
    Object.keys(AdminConfig.phase_display).forEach(k => {
      if (PHASES[k]) Object.assign(PHASES[k], AdminConfig.phase_display[k]);
    });
  }

  applyNavVisibility();
  _adminConfigLoaded = true;
  return AdminConfig;
}

async function saveAdminConfigType(type, data, currentUser) {
  const { error } = await db.from('admin_configs').upsert(
    { config_type: type, config_data: data, updated_at: new Date().toISOString(), updated_by: currentUser?.id || null },
    { onConflict: 'config_type' }
  );
  if (error) { showToast('Save failed: ' + error.message, 'error'); return false; }
  AdminConfig[type] = data;
  if (type === 'departments' && typeof DEPARTMENTS !== 'undefined') {
    (data || []).forEach(d => { if (d.key && d.label) DEPARTMENTS[d.key] = d.label; });
  }
  if (type === 'phase_display' && typeof PHASES !== 'undefined') {
    Object.keys(data || {}).forEach(k => { if (PHASES[k]) Object.assign(PHASES[k], data[k]); });
  }
  if (type === 'nav_visibility') applyNavVisibility();
  showToast('Saved', 'success');
  return true;
}

// ── NAV VISIBILITY (UI-only — does not change page access/RLS) ──
function applyNavVisibility() {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  const roleCfg = (AdminConfig.nav_visibility || {})[currentUser.role];
  if (!roleCfg) return;
  document.querySelectorAll('.nav-links a.nav-link').forEach(a => {
    const href = a.getAttribute('href');
    if (Object.prototype.hasOwnProperty.call(roleCfg, href) && roleCfg[href] === false) {
      a.style.display = 'none';
    }
  });
}

// ── FIELD VALUE / OPTION HELPERS (used by filters, columns, export) ──
function fieldOptionsFor(field) {
  switch (field) {
    case 'phase': return Object.entries(PHASES).map(([k, v]) => ({ value: k, label: `${v.icon} ${v.label}` }));
    case 'department': return Object.entries(DEPARTMENTS).map(([k, v]) => ({ value: k, label: v }));
    case 'request_category': return [{ value: 'RFQ', label: 'RFQ' }, { value: 'local_purchase', label: 'Local Purchase' }, { value: 'vendor_info', label: 'Vendor Info' }];
    case 'urgency': return [{ value: 'normal', label: 'Normal' }, { value: 'urgent', label: 'Urgent (24h)' }, { value: 'critical', label: 'Critical (48h)' }];
    case 'request_for': return [{ value: 'npd', label: 'NPD' }, { value: 'production', label: 'Production' }];
    case 'discipline': return [{ value: 'elec', label: 'Electronics' }, { value: 'mechanical', label: 'Mechanical' }];
    case 'is_on_hold': return [{ value: 'true', label: 'On Hold' }, { value: 'false', label: 'Not On Hold' }];
    default:
      if (field.startsWith('custom:')) {
        const cf = (AdminConfig.custom_fields || []).find(c => c.key === field.slice(7));
        if (cf && Array.isArray(cf.options)) return cf.options.map(o => ({ value: o, label: o }));
      }
      // Fall back to real sampled values discovered from the live data.
      const disc = (AdminConfig._discovered || []).find(f => f.field === field);
      if (disc && disc.sampleValues) return disc.sampleValues.sort().map(v => ({ value: v, label: humanizeFieldName(v) }));
      return [];
  }
}

function fieldValueGetter(r, field) {
  if (field === 'is_on_hold') return String(!!r.is_on_hold);
  if (field.startsWith('custom:')) return (r.custom_field_values || {})[field.slice(7)];
  return r[field];
}

function fieldLabelFor(field) {
  const b = BUILTIN_FIELD_DEFS.find(f => f.field === field);
  if (b) return b.label;
  if (field.startsWith('custom:')) {
    const cf = (AdminConfig.custom_fields || []).find(c => c.key === field.slice(7));
    return cf ? cf.label : field;
  }
  const disc = (AdminConfig._discovered || []).find(f => f.field === field);
  if (disc) return disc.label;
  return humanizeFieldName(field);
}

// ── ROLE-SCOPED FILTER VISIBILITY ──────────────────────────────
// A filter with no visibleToRoles (undefined/empty) is Master-only, matching
// the original behaviour. Add roles to also surface it on their dashboards.
function filterVisibleForRole(f, role) {
  if (!role || role === 'master') return true;
  return Array.isArray(f.visibleToRoles) && f.visibleToRoles.includes(role);
}
function filtersForRole(role) {
  return (AdminConfig.filters || []).filter(f => f.visible !== false && filterVisibleForRole(f, role)).sort((a, b) => (a.order || 0) - (b.order || 0));
}
window.filtersForRole = filtersForRole;
window.filterVisibleForRole = filterVisibleForRole;
window.refreshFieldCatalog = refreshFieldCatalog;
window.discoverRequestFields = discoverRequestFields;
window.humanizeFieldName = humanizeFieldName;

// ── CUSTOM FIELDS: render inputs on a create-request form, collect values ──
function renderCustomFieldInputs(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const fields = AdminConfig.custom_fields || [];
  if (!fields.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div style="margin-top:16px"><label class="form-label" style="margin-bottom:8px;display:block">Additional Fields</label>
    <div class="form-grid">
    ${fields.map(f => {
      const id = 'cf_' + f.key;
      if (f.type === 'select') {
        return `<div class="form-group"><label class="form-label">${escHtml(f.label)}${f.required ? ' *' : ''}</label>
          <select class="form-control" id="${id}"><option value="">— Select —</option>${(f.options || []).map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('')}</select></div>`;
      }
      if (f.type === 'date') {
        return `<div class="form-group"><label class="form-label">${escHtml(f.label)}${f.required ? ' *' : ''}</label><input type="date" class="form-control" id="${id}"/></div>`;
      }
      if (f.type === 'number') {
        return `<div class="form-group"><label class="form-label">${escHtml(f.label)}${f.required ? ' *' : ''}</label><input type="number" class="form-control" id="${id}"/></div>`;
      }
      return `<div class="form-group"><label class="form-label">${escHtml(f.label)}${f.required ? ' *' : ''}</label><input type="text" class="form-control" id="${id}"/></div>`;
    }).join('')}
    </div></div>`;
}

function collectCustomFieldValues() {
  const out = {};
  let missingRequired = null;
  (AdminConfig.custom_fields || []).forEach(f => {
    const el = document.getElementById('cf_' + f.key);
    if (!el) return;
    const v = el.value?.trim ? el.value.trim() : el.value;
    if (f.required && !v && !missingRequired) missingRequired = f.label;
    if (v) out[f.key] = v;
  });
  return { values: out, missingRequired };
}

window.AdminConfig = AdminConfig;
window.applyAdminConfigOverrides = applyAdminConfigOverrides;
window.saveAdminConfigType = saveAdminConfigType;
window.fieldOptionsFor = fieldOptionsFor;
window.fieldValueGetter = fieldValueGetter;
window.fieldLabelFor = fieldLabelFor;
window.allFilterableFields = allFilterableFields;
window.renderCustomFieldInputs = renderCustomFieldInputs;
window.collectCustomFieldValues = collectCustomFieldValues;

// ══════════════════════════════════════════════════════════════
// SHARED DYNAMIC FILTER BAR — used by master.html and (per Filter
// Builder role-visibility settings) any other role dashboard.
// ══════════════════════════════════════════════════════════════
function renderDynamicFilterBar(containerId, role, onChange, opts) {
  opts = opts || {};
  const includeSearch = opts.includeSearch !== false;
  const includeClear = opts.includeClear !== false;
  const bar = document.getElementById(containerId); if (!bar) return;
  const defs = filtersForRole(role);
  let html = includeSearch ? `<input type="text" id="${containerId}_search" placeholder="Search by project, PR #, team member, item note..." oninput="${onChange}()"/>` : '';
  defs.forEach(f => {
    const opts = fieldOptionsFor(f.field);
    const domId = containerId + '_' + f.id;
    if (f.type === 'multi') {
      html += `<div class="ms-filter" data-field="${f.field}">
        <button type="button" class="form-control ms-filter-btn" onclick="toggleMsFilter(event,'${domId}')">${escHtml(f.label)} <span class="ms-filter-count" id="${domId}_count"></span></button>
        <div class="ms-filter-panel" id="${domId}_panel" style="display:none">
          ${opts.map(o => `<label class="ms-filter-opt"><input type="checkbox" value="${escHtml(o.value)}" onchange="${onChange}()"/> ${escHtml(o.label)}</label>`).join('') || '<div style="font-size:0.78rem;color:var(--gray-4);padding:4px">No options</div>'}
        </div></div>`;
    } else if (f.type === 'date_range') {
      html += `<input type="date" id="${domId}_from" onchange="${onChange}()" title="${escHtml(f.label)} from" style="max-width:140px"/>
              <input type="date" id="${domId}_to" onchange="${onChange}()" title="${escHtml(f.label)} to" style="max-width:140px"/>`;
    } else if (f.type === 'search') {
      html += `<input type="text" id="${domId}" placeholder="${escHtml(f.label)}" oninput="${onChange}()" style="max-width:160px"/>`;
    } else {
      html += `<select id="${domId}" onchange="${onChange}()"><option value="">All ${escHtml(f.label)}</option>${opts.map(o => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join('')}</select>`;
    }
  });
  html += includeClear ? `<button class="btn btn-ghost btn-sm" onclick="clearDynamicFilters('${containerId}','${role}','${onChange}')">✕ Clear</button>` : '';
  bar.innerHTML = html;
}
function toggleMsFilter(e, domId) {
  e.stopPropagation();
  document.querySelectorAll('.ms-filter-panel').forEach(p => { if (p.id !== domId + '_panel') p.style.display = 'none'; });
  const p = document.getElementById(domId + '_panel'); if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}
document.addEventListener('click', e => {
  document.querySelectorAll('.ms-filter').forEach(el => { if (!el.contains(e.target)) { const p = el.querySelector('.ms-filter-panel'); if (p) p.style.display = 'none'; } });
});
function applyDynamicFilters(reqs, containerId, role, searchFields) {
  const s = (document.getElementById(containerId + '_search')?.value || '').toLowerCase();
  if (s) {
    reqs = reqs.filter(r => (searchFields || ['project_name']).some(sf => String(fieldValueGetter(r, sf) || '').toLowerCase().includes(s))
      || String(r.request_number).includes(s) || (r.team_member_name || '').toLowerCase().includes(s) || (r.users?.name || '').toLowerCase().includes(s) || (r.item_note || '').toLowerCase().includes(s));
  }
  const defs = filtersForRole(role);
  defs.forEach(f => {
    const domId = containerId + '_' + f.id;
    if (f.type === 'multi') {
      const p = document.getElementById(domId + '_panel');
      const vals = p ? [...p.querySelectorAll('input:checked')].map(i => i.value) : [];
      const cnt = document.getElementById(domId + '_count'); if (cnt) cnt.textContent = vals.length ? `(${vals.length})` : '';
      if (vals.length) reqs = reqs.filter(r => vals.includes(String(fieldValueGetter(r, f.field))));
    } else if (f.type === 'date_range') {
      const from = document.getElementById(domId + '_from')?.value;
      const to = document.getElementById(domId + '_to')?.value;
      if (from) reqs = reqs.filter(r => new Date(fieldValueGetter(r, f.field) || r.created_at) >= new Date(from));
      if (to) reqs = reqs.filter(r => new Date(fieldValueGetter(r, f.field) || r.created_at) <= new Date(to + 'T23:59:59'));
    } else if (f.type === 'search') {
      const v = (document.getElementById(domId)?.value || '').toLowerCase();
      if (v) reqs = reqs.filter(r => String(fieldValueGetter(r, f.field) || '').toLowerCase().includes(v));
    } else {
      const v = document.getElementById(domId)?.value;
      if (v) reqs = reqs.filter(r => String(fieldValueGetter(r, f.field)) === v);
    }
  });
  return reqs;
}
function clearDynamicFilters(containerId, role, onChange) {
  const bar = document.getElementById(containerId); if (!bar) return;
  bar.querySelectorAll('select').forEach(s => s.value = '');
  bar.querySelectorAll('input[type=text],input[type=date]').forEach(i => i.value = '');
  bar.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = false);
  bar.querySelectorAll('.ms-filter-count').forEach(c => c.textContent = '');
  if (typeof window[onChange] === 'function') window[onChange]();
}
window.renderDynamicFilterBar = renderDynamicFilterBar;
window.applyDynamicFilters = applyDynamicFilters;
window.clearDynamicFilters = clearDynamicFilters;
window.toggleMsFilter = toggleMsFilter;
