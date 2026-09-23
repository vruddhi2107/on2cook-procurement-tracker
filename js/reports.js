// ============================================================
// REPORTS  —  PO Master + data extraction
// Reads the v_* reporting views created by migrations/2026_09_workflow_v2.sql,
// filters them, and exports CSV / Excel (or copies a tab-separated block that
// pastes straight into a Smartsheet grid).
//
//   mountReports('containerId', { dataset:'po_master', rowAction:{label,fn(row)} })
//
// Depends on: db (supabase-config.js), showToast/showLoader/escHtml (shared.js).
// Excel export needs SheetJS (window.XLSX); falls back to CSV if it isn't loaded.
// ============================================================

const REPORT_DATASETS = {
  po_master: {
    label: 'PO Master', view: 'v_po_master', file: 'po_master',
    dateCol: 'po_date', dateIsTs: false,
    order: [['po_date', false], ['po_number', false], ['po_id', true]],
    amountCol: 'final_order_value', currencyCol: 'currency',
    filters: { project: 'project', vendor: 'vendor', requestor: 'requestor', status: 'po_status' },
    columns: [
      { k: 'po_number', l: 'PO No.', mono: true }, { k: 'revision_label', l: 'Rev' }, { k: 'pr_label', l: 'PR No.', mono: true },
      { k: 'po_date', l: 'PO Date', t: 'date' }, { k: 'project', l: 'Project' }, { k: 'requestor', l: 'Requestor' },
      { k: 'vendor', l: 'Vendor' }, { k: 'item_description', l: 'Item / Description' }, { k: 'quantity', l: 'Qty', t: 'num' },
      { k: 'unit_price', l: 'Unit Price', t: 'num' }, { k: 'currency', l: 'Cur' }, { k: 'po_value', l: 'PO Value', t: 'num' },
      { k: 'freight', l: 'Freight', t: 'num' }, { k: 'other_charges', l: 'Other Charges', t: 'num' },
      { k: 'final_order_value', l: 'Final Order Value', t: 'num' }, { k: 'payment_terms', l: 'Payment Terms' },
      { k: 'expected_delivery', l: 'Expected Delivery', t: 'date' }, { k: 'po_status', l: 'PO Status', pill: true },
      { k: 'payment_status', l: 'Payment', pill: true }, { k: 'grn_status', l: 'GRN', pill: true },
      { k: 'iqc_status', l: 'IQC', pill: true }, { k: 'closure_status', l: 'Closure', pill: true },
      { k: 'pdf_url', l: 'PO PDF', t: 'link' }
    ]
  },
  pr_register: {
    label: 'Purchase Requests', view: 'v_pr_register', file: 'purchase_requests',
    dateCol: 'created_at', dateIsTs: true,
    order: [['created_at', false], ['pr_id', true]],
    filters: { project: 'project', vendor: 'vendor', requestor: 'requestor', status: 'phase' },
    columns: [
      { k: 'pr_label', l: 'PR No.', mono: true }, { k: 'revision_label', l: 'Rev' }, { k: 'request_category', l: 'Type' },
      { k: 'project', l: 'Project' }, { k: 'project_phase', l: 'Project Phase' }, { k: 'requestor', l: 'Requestor' },
      { k: 'project_manager', l: 'Project Manager' }, { k: 'vendor', l: 'Vendor' }, { k: 'phase', l: 'Status', pill: true },
      { k: 'tech_verification_status', l: 'Tech Verification' }, { k: 'pi_status', l: 'PI Review' },
      { k: 'line_items', l: 'Items', t: 'num' }, { k: 'po_numbers', l: 'PO No(s).' },
      { k: 'created_at', l: 'Created', t: 'dt' }, { k: 'updated_at', l: 'Updated', t: 'dt' }
    ]
  },
  pr_revisions: {
    label: 'PR Revisions', view: 'v_pr_revisions', file: 'pr_revisions',
    dateCol: 'changed_at', dateIsTs: true,
    order: [['changed_at', false], ['pr_id', true]],
    filters: { project: 'project' },
    columns: [
      { k: 'pr_label', l: 'PR No.', mono: true }, { k: 'project', l: 'Project' },
      { k: 'from_revision', l: 'From Rev', t: 'num' }, { k: 'to_revision', l: 'To Rev', t: 'num' },
      { k: 'changes', l: 'What changed' }, { k: 'reason', l: 'Reason' }, { k: 'changed_by', l: 'Changed by' },
      { k: 'changed_at', l: 'Changed at', t: 'dt' }
    ]
  },
  po_revisions: {
    label: 'PO Revisions', view: 'v_po_revisions', file: 'po_revisions',
    dateCol: 'revised_at', dateIsTs: true,
    order: [['revised_at', false], ['po_number', false], ['revision_no', false]],
    filters: {},
    columns: [
      { k: 'po_number', l: 'PO No.', mono: true }, { k: 'revision_label', l: 'Rev' }, { k: 'is_current', l: 'Current', t: 'bool' },
      { k: 'final_order_value', l: 'Final Order Value', t: 'num' }, { k: 'currency', l: 'Cur' },
      { k: 'reason', l: 'Reason' }, { k: 'revised_at', l: 'Date', t: 'dt' }, { k: 'pdf_url', l: 'PDF', t: 'link' }
    ]
  },
  datasheets: {
    label: 'Technical Documents', view: 'v_datasheets', file: 'technical_documents',
    dateCol: 'uploaded_at', dateIsTs: true,
    order: [['uploaded_at', false], ['id', true]],
    filters: { project: 'project', vendor: 'vendor', status: 'status' },
    columns: [
      { k: 'pr_label', l: 'PR No.', mono: true }, { k: 'project', l: 'Project' }, { k: 'submission_no', l: 'Submission', t: 'num' },
      { k: 'doc_type', l: 'Type' }, { k: 'vendor', l: 'Vendor' }, { k: 'file_name', l: 'File' }, { k: 'file_url', l: 'Open', t: 'link' },
      { k: 'status', l: 'Status', pill: true }, { k: 'uploaded_by', l: 'Uploaded by' }, { k: 'uploaded_at', l: 'Uploaded', t: 'dt' },
      { k: 'reviewed_by', l: 'Reviewed by' }, { k: 'reviewed_at', l: 'Reviewed', t: 'dt' }, { k: 'rejection_reason', l: 'Rejection reason' }
    ]
  },
  commercial: {
    label: 'Final Commercial (PI) Reviews', view: 'v_commercial_reviews', file: 'commercial_reviews',
    dateCol: 'submitted_at', dateIsTs: true,
    order: [['submitted_at', false], ['id', true]],
    filters: { project: 'project', status: 'status' },
    columns: [
      { k: 'pr_label', l: 'PR No.', mono: true }, { k: 'project', l: 'Project' }, { k: 'version_no', l: 'Ver', t: 'num' },
      { k: 'pi_number', l: 'PI No.' }, { k: 'currency', l: 'Cur' }, { k: 'quoted_value', l: 'Approved Quote', t: 'num' },
      { k: 'freight', l: 'Freight', t: 'num' }, { k: 'packing_other', l: 'Packing / Other', t: 'num' },
      { k: 'taxes_duties', l: 'Taxes / Duties', t: 'num' }, { k: 'final_value', l: 'Final Value', t: 'num' },
      { k: 'deviation_amount', l: 'Change', t: 'num' }, { k: 'deviation_pct', l: 'Change %', t: 'num' },
      { k: 'outcome', l: 'Outcome' }, { k: 'status', l: 'Status', pill: true }, { k: 'approver_role', l: 'Approver' },
      { k: 'reason', l: 'Reason' }, { k: 'submitted_by', l: 'Submitted by' }, { k: 'submitted_at', l: 'Submitted', t: 'dt' },
      { k: 'decided_by', l: 'Decided by' }, { k: 'decided_at', l: 'Decided', t: 'dt' }, { k: 'pi_file_url', l: 'PI', t: 'link' }
    ]
  },
  payments: {
    label: 'Payments', view: 'v_payments', file: 'payments',
    dateCol: 'requested_at', dateIsTs: true,
    order: [['requested_at', false], ['pr_id', true], ['payment_type', true]],
    amountCol: 'amount', currencyCol: 'currency',
    filters: { project: 'project', vendor: 'vendor', status: 'status' },
    columns: [
      { k: 'payment_type', l: 'Type' }, { k: 'pr_label', l: 'PR No.', mono: true }, { k: 'po_numbers', l: 'PO No(s).' },
      { k: 'project', l: 'Project' }, { k: 'vendor', l: 'Vendor' }, { k: 'amount', l: 'Amount', t: 'num' }, { k: 'currency', l: 'Cur' },
      { k: 'status', l: 'Status', pill: true }, { k: 'smartsheet_payment_id', l: 'Smartsheet ID' },
      { k: 'requested_at', l: 'Requested', t: 'dt' }, { k: 'paid_at', l: 'Paid / confirmed', t: 'dt' }
    ]
  }
};

let _rp = null; // state of the mounted panel

// ---------- pure helpers (unit-tested) ----------
function reportMonday(dateStr) {
  const d = new Date((dateStr || '').slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return '';
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function reportGroupKey(kind, row, ds) {
  const dv = String(row[ds.dateCol] || '');
  if (kind === 'month') return dv.slice(0, 7) || '(no date)';
  if (kind === 'week') return reportMonday(dv) || '(no date)';
  if (kind === 'project') return row.project || '(none)';
  if (kind === 'vendor') return row.vendor || '(none)';
  if (kind === 'status') return row[ds.filters.status] || '(none)';
  return '';
}
function reportGroup(rows, kind, ds) {
  const m = new Map();
  rows.forEach(r => {
    const g = reportGroupKey(kind, r, ds), cur = ds.currencyCol ? (r[ds.currencyCol] || 'INR') : '';
    const key = g + '\u0000' + cur;
    if (!m.has(key)) m.set(key, { group: g, currency: cur, count: 0, total: 0 });
    const e = m.get(key); e.count++; e.total += parseFloat(r[ds.amountCol]) || 0;
  });
  return [...m.values()].sort((a, b) => (a.group < b.group ? 1 : a.group > b.group ? -1 : a.currency.localeCompare(b.currency)));
}
function reportCellText(col, v) { // plain-text value used by CSV / Excel / TSV
  if (v == null) return '';
  if (col.t === 'bool') return v ? 'Yes' : 'No';
  if (col.t === 'dt') return String(v).slice(0, 16).replace('T', ' ');
  if (col.t === 'date') return String(v).slice(0, 10);
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
function reportToCSV(cols, rows) {
  const q = (s) => { s = String(s); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = cols.map(c => q(c.l)).join(',');
  const body = rows.map(r => cols.map(c => q(c.t === 'num' && r[c.k] != null ? String(r[c.k]) : reportCellText(c, r[c.k]))).join(','));
  return '\uFEFF' + [head, ...body].join('\r\n'); // BOM so Excel opens UTF-8 correctly
}
function reportToTSV(cols, rows) {
  const clean = (s) => String(s).replace(/[\t\r\n]+/g, ' ');
  return [cols.map(c => clean(c.l)).join('\t'), ...rows.map(r => cols.map(c => clean(c.t === 'num' && r[c.k] != null ? r[c.k] : reportCellText(c, r[c.k]))).join('\t'))].join('\n');
}

// ---------- data ----------
async function _rpFetchAll(ds, f) {
  const out = [], PAGE = 1000;
  for (let from = 0; from < 50000; from += PAGE) {
    let q = db.from(ds.view).select('*');
    if (f.from) q = q.gte(ds.dateCol, f.from);
    if (f.to) q = q.lte(ds.dateCol, ds.dateIsTs ? f.to + 'T23:59:59' : f.to);
    if (f.project && ds.filters.project) q = q.ilike(ds.filters.project, '%' + f.project + '%');
    if (f.vendor && ds.filters.vendor) q = q.ilike(ds.filters.vendor, '%' + f.vendor + '%');
    if (f.requestor && ds.filters.requestor) q = q.ilike(ds.filters.requestor, '%' + f.requestor + '%');
    if (f.status && ds.filters.status) q = q.eq(ds.filters.status, f.status);
    ds.order.forEach(([c, asc]) => { q = q.order(c, { ascending: asc }); });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// ---------- UI ----------
function mountReports(containerId, opts = {}) {
  const host = document.getElementById(containerId); if (!host) return;
  _rp = { host, opts, key: opts.dataset || 'po_master', rows: [], shown: [] };
  const sel = Object.entries(REPORT_DATASETS).map(([k, d]) => `<option value="${k}" ${k === _rp.key ? 'selected' : ''}>${d.label}</option>`).join('');
  host.innerHTML = `<div class="card" style="padding:16px">
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div><label class="form-label">Report</label><select class="form-control" id="rpDataset" onchange="reportsSwitch(this.value)">${sel}</select></div>
      <div><label class="form-label">From</label><input class="form-control" type="date" id="rpFrom"/></div>
      <div><label class="form-label">To</label><input class="form-control" type="date" id="rpTo"/></div>
      <div id="rpProjectW"><label class="form-label">Project</label><input class="form-control" id="rpProject" placeholder="contains…" style="width:140px"/></div>
      <div id="rpVendorW"><label class="form-label">Vendor</label><input class="form-control" id="rpVendor" placeholder="contains…" style="width:140px"/></div>
      <div id="rpRequestorW"><label class="form-label">Requestor</label><input class="form-control" id="rpRequestor" placeholder="contains…" style="width:140px"/></div>
      <div id="rpStatusW"><label class="form-label">Status</label><select class="form-control" id="rpStatus" style="width:160px"><option value="">All</option></select></div>
      <button class="btn btn-primary" onclick="reportsLoad()">Run</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px">
      <input class="form-control" id="rpSearch" placeholder="Search within results…" oninput="reportsRender()" style="max-width:260px"/>
      <div id="rpGroupW" style="display:flex;gap:6px;align-items:center"><label class="form-label" style="margin:0">Summarise by</label>
        <select class="form-control" id="rpGroup" onchange="reportsRender()" style="width:140px">
          <option value="">— none —</option><option value="month">Month</option><option value="week">Week</option>
          <option value="project">Project</option><option value="vendor">Vendor</option><option value="status">Status</option></select></div>
      <span style="flex:1"></span>
      <button class="btn btn-secondary btn-sm" onclick="reportsExport('csv')">Export CSV</button>
      <button class="btn btn-secondary btn-sm" onclick="reportsExport('xlsx')">Export Excel</button>
      <button class="btn btn-ghost btn-sm" onclick="reportsExport('tsv')" title="Copies the table; paste it into a Smartsheet grid">Copy for Smartsheet</button>
    </div>
    <div id="rpInfo" style="margin:10px 0 6px;font-size:0.78rem;color:var(--gray-3)"></div>
    <div id="rpSummary"></div>
    <div style="overflow:auto;max-height:62vh;border:1px solid var(--border);border-radius:var(--radius)"><table class="data-table" id="rpTable"></table></div>
  </div>`;
  reportsSwitch(_rp.key, true);
}

function reportsSwitch(key, first) {
  if (!_rp) return;
  _rp.key = key;
  const ds = REPORT_DATASETS[key];
  const show = (id, on) => { const e = document.getElementById(id); if (e) e.style.display = on ? '' : 'none'; };
  show('rpProjectW', !!ds.filters.project); show('rpVendorW', !!ds.filters.vendor);
  show('rpRequestorW', !!ds.filters.requestor); show('rpStatusW', !!ds.filters.status);
  show('rpGroupW', true);
  const g = document.getElementById('rpGroup'); if (g) g.value = '';
  if (!first) { ['rpFrom', 'rpTo', 'rpProject', 'rpVendor', 'rpRequestor', 'rpSearch'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; }); }
  reportsLoad();
}

async function reportsLoad() {
  if (!_rp) return;
  const ds = REPORT_DATASETS[_rp.key], g = (id) => document.getElementById(id)?.value.trim() || '';
  const f = { from: g('rpFrom'), to: g('rpTo'), project: g('rpProject'), vendor: g('rpVendor'), requestor: g('rpRequestor'), status: g('rpStatus') };
  const info = document.getElementById('rpInfo'); if (info) info.textContent = 'Loading…';
  try {
    const rows = await _rpFetchAll(ds, f);
    _rp.rows = rows;
    // status dropdown is filled from the data (keep the current choice)
    if (ds.filters.status) {
      const sel = document.getElementById('rpStatus');
      const vals = [...new Set(rows.map(r => r[ds.filters.status]).filter(Boolean))].sort();
      if (sel && !f.status) sel.innerHTML = '<option value="">All</option>' + vals.map(v => `<option>${escHtml(v)}</option>`).join('');
    }
    reportsRender();
  } catch (e) {
    if (info) info.textContent = '';
    showToast('Could not load report: ' + e.message + ' (has migrations/2026_09_workflow_v2.sql been run?)', 'error');
  }
}

function _rpCell(c, v) {
  if (v == null || v === '') return '<span style="color:var(--gray-4)">—</span>';
  if (c.t === 'link') return `<a href="${escHtml(v)}" target="_blank" rel="noopener" style="color:var(--red)">Open</a>`;
  if (c.t === 'num') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (c.t === 'bool') return v ? 'Yes' : 'No';
  if (c.t === 'date') return escHtml(String(v).slice(0, 10).split('-').reverse().join('/'));
  if (c.t === 'dt') { const d = new Date(v); return isNaN(d) ? escHtml(v) : escHtml(d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })); }
  if (c.pill) return `<span style="font-size:0.7rem;font-weight:600;padding:2px 8px;border-radius:3px;background:var(--off-white);border:1px solid var(--border);white-space:nowrap">${escHtml(String(v).replace(/_/g, ' '))}</span>`;
  return c.mono ? `<span style="font-family:var(--font-mono);font-weight:600">${escHtml(v)}</span>` : escHtml(v);
}

function reportsRender() {
  if (!_rp) return;
  const ds = REPORT_DATASETS[_rp.key];
  const term = (document.getElementById('rpSearch')?.value || '').toLowerCase();
  let rows = _rp.rows;
  if (term) rows = rows.filter(r => ds.columns.some(c => reportCellText(c, r[c.k]).toLowerCase().includes(term)));
  _rp.shown = rows;
  const info = document.getElementById('rpInfo');
  if (info) info.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}${term ? ` (filtered from ${_rp.rows.length})` : ''}`;

  // optional summary
  const sum = document.getElementById('rpSummary'), kind = document.getElementById('rpGroup')?.value;
  if (sum) {
    if (kind && ds.amountCol) {
      const g = reportGroup(rows, kind, ds);
      sum.innerHTML = `<table class="data-table" style="max-width:560px;margin-bottom:12px"><thead><tr><th>${kind[0].toUpperCase() + kind.slice(1)}</th><th>Cur</th><th style="text-align:right">Count</th><th style="text-align:right">Total</th></tr></thead><tbody>${
        g.map(e => `<tr><td>${escHtml(e.group)}</td><td>${escHtml(e.currency)}</td><td style="text-align:right">${e.count}</td><td style="text-align:right;font-family:var(--font-mono)">${e.total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td></tr>`).join('')}</tbody></table>`;
    } else if (kind) {
      const m = new Map(); rows.forEach(r => { const k = reportGroupKey(kind, r, ds); m.set(k, (m.get(k) || 0) + 1); });
      sum.innerHTML = `<table class="data-table" style="max-width:360px;margin-bottom:12px"><thead><tr><th>${kind[0].toUpperCase() + kind.slice(1)}</th><th style="text-align:right">Count</th></tr></thead><tbody>${
        [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, n]) => `<tr><td>${escHtml(k)}</td><td style="text-align:right">${n}</td></tr>`).join('')}</tbody></table>`;
    } else sum.innerHTML = '';
  }

  const act = _rp.opts.rowAction;
  const t = document.getElementById('rpTable'); if (!t) return;
  t.innerHTML = `<thead><tr>${ds.columns.map(c => `<th style="position:sticky;top:0;background:var(--off-white);white-space:nowrap${c.t === 'num' ? ';text-align:right' : ''}">${escHtml(c.l)}</th>`).join('')}${act ? '<th style="position:sticky;top:0;background:var(--off-white)"></th>' : ''}</tr></thead>
    <tbody>${rows.length ? rows.slice(0, 500).map((r, i) => `<tr>${ds.columns.map(c => `<td style="${c.t === 'num' ? 'text-align:right;font-family:var(--font-mono);' : ''}font-size:0.78rem;vertical-align:top">${_rpCell(c, r[c.k])}</td>`).join('')}${act ? `<td><button class="btn btn-ghost btn-sm" onclick="reportsRowAction(${i})">${escHtml(act.label)}</button></td>` : ''}</tr>`).join('')
      : `<tr><td colspan="${ds.columns.length + 1}" style="text-align:center;padding:24px;color:var(--gray-4)">No rows</td></tr>`}</tbody>`;
  if (rows.length > 500 && info) info.textContent += ' — showing the first 500; exports include everything';
}

function reportsRowAction(i) { const r = _rp && _rp.shown[i]; if (r && _rp.opts.rowAction) _rp.opts.rowAction.fn(r); }

async function reportsExport(kind) {
  if (!_rp || !_rp.shown.length) { showToast('Nothing to export', 'error'); return; }
  const ds = REPORT_DATASETS[_rp.key], cols = ds.columns, rows = _rp.shown;
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  if (kind === 'tsv') {
    try { await navigator.clipboard.writeText(reportToTSV(cols, rows)); showToast(`Copied ${rows.length} rows — paste into Smartsheet`, 'success'); }
    catch (e) { showToast('Clipboard blocked by the browser — use Export CSV instead', 'error'); }
    return;
  }
  if (kind === 'xlsx' && window.XLSX) {
    const aoa = [cols.map(c => c.l)].concat(rows.map(r => cols.map(c => (c.t === 'num' && r[c.k] != null) ? Number(r[c.k]) : reportCellText(c, r[c.k]))));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), ds.label.slice(0, 31));
    XLSX.writeFile(wb, `${ds.file}_${stamp}.xlsx`);
    return;
  }
  if (kind === 'xlsx') showToast('Excel library not loaded — exporting CSV instead', 'info');
  const blob = new Blob([reportToCSV(cols, rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${ds.file}_${stamp}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

Object.assign(window, { mountReports, reportsSwitch, reportsLoad, reportsRender, reportsExport, reportsRowAction,
  reportGroup, reportToCSV, reportToTSV, reportMonday, REPORT_DATASETS });
