// ============================================================
// WORKFLOW V2  —  shared logic used by several role pages
//   1. Workflow flags (admin_configs 'workflow_flags')
//   2. Editable Purchase Requests with revision history
//   3. Technical datasheet / specification verification stage
//   4. Final commercial (PI) review against the approved quotation
//
// Load AFTER supabase-config.js and shared.js.
// Depends on page globals that every role page already defines:
//   addPhaseTimestamp(pr, phase)   (page-local helper)
// and on these being (re)defined by the page that uses a feature:
//   window.wfAfterAction(prId)     refresh hook run after a state change
// ============================================================

// ------------------------------------------------------------
// 1. FLAGS
// Everything that changes an existing approval sequence is opt-in so it can
// be switched on only after the process owners (Accounts / Jyoti Ma'am) agree.
// ------------------------------------------------------------
const WORKFLOW_FLAG_DEFAULTS = Object.freeze({
  tech_verification_required: false, // datasheet -> engineer verification before quotations
  pi_review_enabled:          false, // PI / final commercial review between quote approval and PO
  po_before_payment:          false, // advance / payment request needs a generated PO first
  pi_tolerance_pct:           0      // PI increases up to this % clear automatically
});

let _wfFlagsCache = null;
async function loadWorkflowFlags(force = false) {
  if (_wfFlagsCache && !force) return _wfFlagsCache;
  let cfg = {};
  try {
    const { data, error } = await db.from('admin_configs').select('config_data').eq('config_type', 'workflow_flags').maybeSingle();
    if (error) throw error;
    cfg = (data && data.config_data) || {};
  } catch (e) {
    console.warn('loadWorkflowFlags failed - using defaults (all off):', e.message);
  }
  _wfFlagsCache = {
    tech_verification_required: cfg.tech_verification_required === true,
    pi_review_enabled:          cfg.pi_review_enabled === true,
    po_before_payment:          cfg.po_before_payment === true,
    pi_tolerance_pct: (typeof cfg.pi_tolerance_pct === 'number' && cfg.pi_tolerance_pct >= 0)
      ? cfg.pi_tolerance_pct : WORKFLOW_FLAG_DEFAULTS.pi_tolerance_pct
  };
  return _wfFlagsCache;
}
function invalidateWorkflowFlags() { _wfFlagsCache = null; }
async function saveWorkflowFlags(flags, userId) {
  const clean = {
    tech_verification_required: !!flags.tech_verification_required,
    pi_review_enabled:          !!flags.pi_review_enabled,
    po_before_payment:          !!flags.po_before_payment,
    pi_tolerance_pct:           Math.max(0, parseFloat(flags.pi_tolerance_pct) || 0)
  };
  const { error } = await db.from('admin_configs').upsert(
    { config_type: 'workflow_flags', config_data: clean, updated_at: new Date().toISOString(), updated_by: userId },
    { onConflict: 'config_type' });
  if (error) return { ok: false, error: error.message };
  invalidateWorkflowFlags();
  return { ok: true };
}

// Small shared helpers ---------------------------------------------------
const _wfEsc = (v) => (typeof escHtml === 'function' ? escHtml(v) : String(v == null ? '' : v));
const _wfNorm = (v) => (v == null ? '' : String(v)).trim();
const _wfPRLabel = (pr) => 'PR-' + String(pr.request_number).padStart(4, '0');
const _wfMoney = (n, cur) => (cur ? cur + ' ' : '') + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
function _wfTs(pr, phase) {
  return (typeof addPhaseTimestamp === 'function') ? addPhaseTimestamp(pr, phase) : (pr && pr.phase_timestamps) || {};
}
async function _wfAfter(prId) {
  if (typeof window.wfAfterAction === 'function') { try { await window.wfAfterAction(prId); } catch (e) { console.warn('wfAfterAction:', e); } }
}
async function _wfUploadDoc(file, folder, maxMB = 15) {
  if (file.size > maxMB * 1024 * 1024) throw new Error(`"${file.name}" is larger than ${maxMB} MB.`);
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${Date.now()}_${safe}`;
  const { error } = await db.storage.from('attachments').upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (error) throw new Error('Upload failed: ' + error.message);
  const { data } = db.storage.from('attachments').getPublicUrl(path);
  return { name: file.name, type: file.type, url: data && data.publicUrl };
}

// ------------------------------------------------------------
// 2. PURCHASE REQUEST EDITING + REVISION HISTORY
// ------------------------------------------------------------
// The requester (engineer) may edit until the quotations have been shared for
// approval. Once a quotation is approved the commercial commitment is set, so
// from then on only Procurement / Master can change the request (and the PO
// has its own revision flow).
const PR_EDITABLE_PHASES = [
  'submitted', 'pending_master_reassignment', 'pending_initial_pm_approval',
  'procurement_active', 'pending_tech_verification', 'quotes_revision_requested', 'quotations_shared'
];
const PR_NEVER_EDITABLE = new Set([
  'accepted', 'rejected', 'declined', 'qc_rejected', 'lp_payment_done', 'lp_rejected',
  'vendor_info_received', 'closed_full_advance', 'payment_received'
]);
function canEditPR(pr, user) {
  if (!pr || !user) return false;
  if (PR_NEVER_EDITABLE.has(pr.phase) || pr.is_closed) return false;
  if (user.role === 'master' || user.role === 'procurement_manager') return true;
  if (pr.request_category === 'local_purchase') return false; // LP has its own pipeline
  return pr.created_by === user.id && PR_EDITABLE_PHASES.includes(pr.phase);
}

const PR_REV_FIELDS = [
  ['project_name', 'Project'], ['project_phase', 'Phase'], ['project_manager_name', 'Project Manager'],
  ['team_member_name', 'Team Member'], ['department', 'Department'], ['order_type', 'Order Type'],
  ['product_link', 'Product Link'], ['item_note', 'Item Tag / Note'], ['description', 'Description']
];

function _wfSourcingArr(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function _wfPartKey(p) { return _wfNorm(p.part_number || p.name).toLowerCase(); }
function _wfPartLabel(p) { return `${_wfNorm(p.name) || _wfNorm(p.part_number) || 'Item'} × ${p.qty || 0}`; }

function diffPRParts(oldParts, newParts) {
  const out = [];
  const oldList = (oldParts || []).map(p => ({ p, used: false }));
  const pool = new Map(); // key -> [entries]
  oldList.forEach(e => { const k = _wfPartKey(e.p); if (!pool.has(k)) pool.set(k, []); pool.get(k).push(e); });
  (newParts || []).forEach(np => {
    const k = _wfPartKey(np);
    const cand = (pool.get(k) || []).find(e => !e.used);
    if (!cand) { out.push({ field: 'part_added', label: 'Item added', from: null, to: _wfPartLabel(np) }); return; }
    cand.used = true;
    const op = cand.p, nm = _wfNorm(np.name) || _wfNorm(np.part_number);
    if ((op.qty || 0) !== (np.qty || 0)) out.push({ field: 'part_qty', label: `Qty (${nm})`, from: String(op.qty || 0), to: String(np.qty || 0) });
    if (_wfNorm(op.spec) !== _wfNorm(np.spec)) out.push({ field: 'part_spec', label: `Spec (${nm})`, from: _wfNorm(op.spec) || null, to: _wfNorm(np.spec) || null });
    if (_wfNorm(op.uom) !== _wfNorm(np.uom)) out.push({ field: 'part_uom', label: `UOM (${nm})`, from: _wfNorm(op.uom) || null, to: _wfNorm(np.uom) || null });
    if (_wfNorm(op.name) !== _wfNorm(np.name) && _wfNorm(op.part_number) && _wfNorm(op.part_number).toLowerCase() === _wfNorm(np.part_number).toLowerCase())
      out.push({ field: 'part_name', label: `Name (${_wfNorm(op.part_number)})`, from: _wfNorm(op.name) || null, to: _wfNorm(np.name) || null });
  });
  oldList.filter(e => !e.used).forEach(e => out.push({ field: 'part_removed', label: 'Item removed', from: _wfPartLabel(e.p), to: null }));
  return out;
}

function diffPRFields(oldPR, newVals) {
  const out = [];
  const show = (field, v) => {
    if (field === 'department') return (typeof DEPARTMENTS !== 'undefined' && DEPARTMENTS[v]) || v;
    if (field === 'order_type') return (typeof ORDER_TYPES !== 'undefined' && ORDER_TYPES[v]) || v;
    return v;
  };
  PR_REV_FIELDS.forEach(([k, label]) => {
    if (!(k in newVals)) return;
    const a = _wfNorm(oldPR[k]), b = _wfNorm(newVals[k]);
    if (a !== b) out.push({ field: k, label, from: a ? show(k, a) : null, to: b ? show(k, b) : null });
  });
  if ('sourcing' in newVals) {
    const a = _wfSourcingArr(oldPR.sourcing).slice().sort().join(', '), b = _wfSourcingArr(newVals.sourcing).slice().sort().join(', ');
    if (a !== b) out.push({ field: 'sourcing', label: 'Sourcing', from: a || null, to: b || null });
  }
  return out;
}

// Reads the edit form produced by buildPRDetailEditableHTML() + buildPREditReasonHTML().
function collectPREditValues() {
  const g = (id) => document.getElementById(id);
  const projectName = g('editReqProject')?.value.trim();
  if (!projectName) return { error: 'Project name is required' };
  const parts = (typeof getPartsFromEditor === 'function') ? getPartsFromEditor() : [];
  const sourcing = [];
  if (g('editReqSourcingDomestic')?.checked) sourcing.push('domestic');
  if (g('editReqSourcingIntl')?.checked) sourcing.push('international');
  // project_manager_name, team_member_name and department are NOT NULL in the database
  const pm = g('editReqPM')?.value.trim(), member = g('editReqTeamMember')?.value.trim(), dept = g('editReqDept')?.value;
  if (!pm) return { error: 'Project manager is required' };
  if (!member) return { error: 'Team member is required' };
  if (!dept) return { error: 'Department is required' };
  const vals = {
    project_name: projectName,
    project_phase: g('editReqPhase')?.value.trim() || null,
    project_manager_name: pm,
    team_member_name: member,
    department: dept,
    order_type: g('editReqOrderType')?.value || null,
    product_link: g('editReqProductLink')?.value.trim() || null,
    sourcing,
    item_note: g('editReqItemNote')?.value.trim() || null,
    description: g('editReqDescription')?.value.trim() || null,
    parts
  };
  return { vals, reason: g('editReqReason')?.value.trim() || '' };
}

function buildPREditReasonHTML() {
  return `<div class="form-group" style="margin-top:14px">
    <label class="form-label">Reason for change *</label>
    <input class="form-control" id="editReqReason" placeholder="e.g. requirement reduced from 10 to 8 units"/>
    <div style="font-size:0.72rem;color:var(--gray-4);margin-top:4px">The previous version is kept. Everyone working on this request sees the new revision and what changed.</div>
  </div>`;
}

async function savePRRevision(pr, newVals, reason, user) {
  const oldRev = pr.revision_no || 0;
  const changes = diffPRFields(pr, newVals).concat(diffPRParts(pr.parts || [], newVals.parts || []));
  if (!changes.length) return { ok: false, noChange: true };

  const snapshot = {};
  PR_REV_FIELDS.forEach(([k]) => { snapshot[k] = pr[k] == null ? null : pr[k]; });
  snapshot.sourcing = _wfSourcingArr(pr.sourcing);
  snapshot.parts = pr.parts || [];

  // 1) claim the revision slot (unique pr_id+revision_no doubles as an edit lock)
  const ins = await db.from('pr_revisions').insert({
    pr_id: pr.id, revision_no: oldRev, snapshot, changes, reason, changed_by: user.id
  });
  if (ins.error) {
    return { ok: false, error: ins.error.code === '23505'
      ? 'Someone else just revised this request - reload and try again.' : ins.error.message };
  }
  // 2) apply, but only if nobody moved the revision in the meantime
  const upd = await db.from('procurement_requests')
    .update({ ...newVals, revision_no: oldRev + 1, updated_at: new Date().toISOString() })
    .eq('id', pr.id).eq('revision_no', oldRev).select('id');
  if (upd.error || !upd.data || !upd.data.length) {
    await db.from('pr_revisions').delete().eq('pr_id', pr.id).eq('revision_no', oldRev);
    return { ok: false, error: upd.error ? upd.error.message : 'The request changed while you were editing - reload and try again.' };
  }
  const postApproval = !PR_EDITABLE_PHASES.includes(pr.phase);
  const lines = changes.slice(0, 8).map(c => `• ${c.label}: ${c.from == null ? '—' : c.from} → ${c.to == null ? '—' : c.to}`);
  if (changes.length > 8) lines.push(`• …and ${changes.length - 8} more`);
  try {
    await window.postComment(pr.id, user.id,
      ` ${_wfPRLabel(pr)} revised Rev.${oldRev} → Rev.${oldRev + 1}. Reason: ${reason}\n${lines.join('\n')}`
      + (postApproval ? '\n Changed after the quotation was approved — check whether the quotation / PO needs revising.' : ''));
  } catch (e) { console.warn('revision comment failed', e); }
  return { ok: true, changes, revision: oldRev + 1 };
}

function revBadgeHTML(rev) {
  return rev > 0 ? `<span style="font-family:var(--font-mono);font-size:0.62rem;font-weight:700;padding:1px 6px;margin-left:5px;border-radius:3px;background:#6366f114;color:#4f46e5;border:1px solid #6366f130;vertical-align:middle">Rev.${rev}</span>` : '';
}

// Placeholder emitted by buildPRDetailHTML; filled in when the modal opens.
async function hydrateRevisionHistory() {
  const els = document.querySelectorAll('[data-rev-history]:not([data-loaded])');
  for (const el of els) {
    el.setAttribute('data-loaded', '1');
    const prId = el.getAttribute('data-rev-history');
    const { data, error } = await db.from('pr_revisions').select('*').eq('pr_id', prId).order('revision_no', { ascending: false });
    if (error || !data || !data.length) { el.innerHTML = ''; continue; }
    const names = {};
    for (const r of data) if (r.changed_by && !(r.changed_by in names)) names[r.changed_by] = (typeof getUserName === 'function') ? await getUserName(r.changed_by) : '';
    el.innerHTML = `<div style="margin-top:14px;border:1px solid rgba(99,102,241,0.25);border-radius:var(--radius);overflow:hidden">
      <div style="padding:9px 14px;background:rgba(99,102,241,0.07);font-weight:700;font-size:0.82rem;color:#4f46e5"> Revision History (${data.length})</div>
      <div style="padding:10px 14px;background:white;display:flex;flex-direction:column;gap:10px">
      ${data.map(r => {
        const ch = (r.changes || []).map(c => `<li><strong>${_wfEsc(c.label)}</strong>: <span style="color:var(--gray-4)">${_wfEsc(c.from == null ? '—' : c.from)}</span> → <strong>${_wfEsc(c.to == null ? '—' : c.to)}</strong></li>`).join('');
        const snap = r.snapshot || {};
        const snapParts = (snap.parts || []).map(p => `<tr><td>${_wfEsc(p.name)}</td><td style="text-align:center">${_wfEsc(p.qty)}</td><td>${_wfEsc(p.spec || '')}</td></tr>`).join('');
        return `<div style="font-size:0.8rem">
          <div><span style="font-family:var(--font-mono);font-weight:700">Rev.${r.revision_no} → Rev.${r.revision_no + 1}</span>
            <span style="color:var(--gray-4)"> · ${typeof fmtDateTime === 'function' ? fmtDateTime(r.changed_at) : r.changed_at} · ${_wfEsc(names[r.changed_by] || '')}</span></div>
          ${r.reason ? `<div style="color:var(--gray-3);margin:2px 0">${_wfEsc(r.reason)}</div>` : ''}
          <ul style="margin:4px 0 4px 18px;padding:0">${ch}</ul>
          <details style="margin-top:2px"><summary style="cursor:pointer;font-size:0.74rem;color:#4f46e5">View Rev.${r.revision_no} as it was</summary>
            <div style="margin-top:6px;padding:8px 10px;background:var(--off-white);border:1px solid var(--border);border-radius:6px">
              <div style="font-size:0.74rem;color:var(--gray-3);margin-bottom:4px">${_wfEsc(snap.project_name || '')}${snap.description ? ' — ' + _wfEsc(snap.description) : ''}</div>
              ${snapParts ? `<table class="parts-table" style="width:100%"><thead><tr><th>Item</th><th style="width:60px">Qty</th><th>Spec</th></tr></thead><tbody>${snapParts}</tbody></table>` : ''}
            </div></details>
        </div>`;
      }).join('')}
      </div></div>`;
  }
}
window.hydrateRevisionHistory = hydrateRevisionHistory;

// ------------------------------------------------------------
// 3. TECHNICAL DATASHEET / SPECIFICATION VERIFICATION
//    Procurement uploads datasheets -> Engineer verifies -> back to Procurement
//    who can then upload quotations (which go straight to commercial approval).
// ------------------------------------------------------------
const DATASHEET_DOC_TYPES = {
  datasheet: 'Datasheet', technical_spec: 'Technical specification', drawing: 'Drawing',
  product_spec: 'Product specification', compliance: 'Compliance / certification', other: 'Other'
};
let _dsPending = []; // [{file, doc_type, vendor_id}]

async function getDatasheets(prId) {
  const { data } = await db.from('pr_datasheets').select('*').eq('pr_id', prId).order('submission_no').order('uploaded_at');
  return data || [];
}

function _dsVendorOptions() {
  const list = (typeof allVendors !== 'undefined' && Array.isArray(allVendors)) ? allVendors : [];
  return '<option value="">Vendor (optional)</option>' + list.filter(v => v.is_active !== false)
    .map(v => `<option value="${v.id}" data-name="${_wfEsc(v.name)}">${_wfEsc(v.name)}</option>`).join('');
}

function _dsRenderPending() {
  const el = document.getElementById('dsUploadList'); if (!el) return;
  el.innerHTML = _dsPending.map((d, i) => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:7px 10px;background:var(--off-white);border:1px solid var(--border);border-radius:6px;margin-top:6px">
      <span style="flex:1;min-width:140px;font-size:0.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"> ${_wfEsc(d.file.name)}</span>
      <select class="form-control" style="width:180px;font-size:0.76rem" onchange="dsUpdate(${i},'doc_type',this.value)">
        ${Object.entries(DATASHEET_DOC_TYPES).map(([k, l]) => `<option value="${k}" ${d.doc_type === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select class="form-control" style="width:170px;font-size:0.76rem" onchange="dsUpdate(${i},'vendor_id',this.value)">${_dsVendorOptions().replace(`value="${d.vendor_id}"`, `value="${d.vendor_id}" selected`)}</select>
      <button class="btn btn-danger btn-sm" onclick="dsRemove(${i})"></button>
    </div>`).join('');
}
function dsUpdate(i, k, v) { if (_dsPending[i]) _dsPending[i][k] = v; }
function dsRemove(i) { _dsPending.splice(i, 1); _dsRenderPending(); }
function handleDatasheetFiles(ev) {
  const files = Array.from((ev.target && ev.target.files) || ev.dataTransfer?.files || []);
  files.forEach(f => _dsPending.push({ file: f, doc_type: 'datasheet', vendor_id: '' }));
  if (ev.target && ev.target.value !== undefined) ev.target.value = '';
  _dsRenderPending();
}

// Procurement: upload panel (phase procurement_active, flag on, not yet verified)
function buildDatasheetUploadSection(pr, rows) {
  _dsPending = [];
  const rejected = rows.filter(r => r.status === 'rejected');
  const lastSub = rows.length ? Math.max(...rows.map(r => r.submission_no)) : 0;
  const lastRejected = rejected.filter(r => r.submission_no === lastSub);
  const banner = (pr.tech_verification_status === 'rejected' && lastRejected.length) ? `
    <div style="margin-bottom:12px;padding:10px 12px;border:1px solid rgba(220,38,38,0.3);background:rgba(220,38,38,0.05);border-radius:var(--radius-sm);font-size:0.8rem">
      <strong style="color:#b91c1c"> Engineer rejected the last submission — upload corrected documents.</strong>
      <ul style="margin:6px 0 0 18px;padding:0">${lastRejected.map(r => `<li>${_wfEsc(r.file_name)} — ${_wfEsc(r.review_notes || 'no reason given')}</li>`).join('')}</ul>
    </div>` : '';
  return `<div class="action-section" style="border:1px solid rgba(99,102,241,0.3);background:rgba(99,102,241,0.03)">
    <div class="action-section-title"> Technical Verification — Upload Datasheets <span class="action-badge">ACTION REQUIRED</span></div>
    <p style="font-size:0.82rem;color:var(--gray-3);margin-bottom:12px">Before quotations can be uploaded, attach the supplier's datasheet / specifications / drawings. The requesting engineer confirms the product meets the technical requirement; then you upload the quotation, which goes straight to the approver.</p>
    ${banner}
    <div class="drop-zone" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="event.preventDefault();this.classList.remove('dragover');handleDatasheetFiles(event)">
      <input type="file" id="dsFileInput" multiple onchange="handleDatasheetFiles(event)"/>
      <div class="drop-zone-icon"></div>
      <div class="drop-zone-label">Drag &amp; drop or click to upload datasheets / specs / drawings</div>
      <div class="drop-zone-hint">Any file type · max 15 MB each</div>
    </div>
    <div id="dsUploadList"></div>
    <div style="margin-top:14px"><button class="btn btn-primary" onclick="submitDatasheetsForVerification()">Send to Engineer for Technical Verification →</button></div>
  </div>`;
}

async function submitDatasheetsForVerification() {
  const pr = currentPR, user = currentUser;
  if (!pr) return;
  if (!_dsPending.length) { showToast('Upload at least one document', 'error'); return; }
  showLoader(true);
  try {
    const existing = await getDatasheets(pr.id);
    const sub = (existing.length ? Math.max(...existing.map(r => r.submission_no)) : 0) + 1;
    const vendors = (typeof allVendors !== 'undefined') ? allVendors : [];
    for (const d of _dsPending) {
      const up = await _wfUploadDoc(d.file, `datasheets/${pr.id}`);
      const v = vendors.find(x => x.id === d.vendor_id);
      const { error } = await db.from('pr_datasheets').insert({
        pr_id: pr.id, submission_no: sub, doc_type: d.doc_type,
        vendor_id: d.vendor_id || null, vendor_name: v ? v.name : null,
        file_name: up.name, file_url: up.url, uploaded_by: user.id, status: 'pending'
      });
      if (error) throw new Error(error.message);
    }
    const { error } = await db.from('procurement_requests').update({
      phase: 'pending_tech_verification', tech_verification_status: 'pending',
      updated_at: new Date().toISOString(), phase_timestamps: _wfTs(pr, 'pending_tech_verification')
    }).eq('id', pr.id);
    if (error) throw new Error(error.message);
    await window.postComment(pr.id, user.id, ` ${_dsPending.length} technical document${_dsPending.length > 1 ? 's' : ''} uploaded (submission #${sub}) — sent to the engineer for technical verification.`);
    notifyPhaseChange(pr.id, 'pending_tech_verification', user.id);
    _dsPending = [];
    showLoader(false);
    showToast('Sent to engineer for technical verification', 'success');
    closeModal('prModal');
    await _wfAfter(pr.id);
  } catch (e) { showLoader(false); showToast(e.message, 'error'); }
}

function _dsFileList(rows) {
  return rows.map(r => `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-bottom:1px dashed var(--border);font-size:0.8rem">
      <span style="flex:1;min-width:150px"> <a href="${_wfEsc(r.file_url)}" target="_blank" rel="noopener" style="color:var(--red)">${_wfEsc(r.file_name)}</a></span>
      <span style="font-size:0.7rem;color:var(--gray-3)">${_wfEsc(DATASHEET_DOC_TYPES[r.doc_type] || r.doc_type)}${r.vendor_name ? ' · ' + _wfEsc(r.vendor_name) : ''}</span>
      ${r.status === 'approved' ? '<span class="badge badge-green">Verified</span>' : r.status === 'rejected' ? '<span class="badge badge-red">Rejected</span>' : '<span class="badge badge-orange">Pending</span>'}
      ${r.review_notes ? `<span style="flex-basis:100%;font-size:0.72rem;color:var(--gray-3)">↳ ${_wfEsc(r.review_notes)}</span>` : ''}
    </div>`).join('');
}

// Read-only summary (procurement waiting / anyone viewing history)
function buildDatasheetSummarySection(pr, rows, title) {
  if (!rows.length) return '';
  return `<div style="margin-top:14px;border:1px solid rgba(99,102,241,0.25);border-radius:var(--radius);overflow:hidden">
    <div style="padding:9px 14px;background:rgba(99,102,241,0.07);font-weight:700;font-size:0.82rem;color:#4f46e5">${title || ' Technical Documents'}</div>
    <div style="padding:6px 14px 10px;background:white">${_dsFileList(rows)}</div></div>`;
}

// Engineer: verification panel (phase pending_tech_verification)
function buildDatasheetReviewSection(pr, rows) {
  const lastSub = rows.length ? Math.max(...rows.map(r => r.submission_no)) : 0;
  const cur = rows.filter(r => r.submission_no === lastSub && r.status === 'pending');
  const history = rows.filter(r => !(r.submission_no === lastSub && r.status === 'pending'));
  if (!cur.length) return `<div class="action-section"><p style="font-size:0.82rem;color:var(--gray-4)">No documents awaiting verification.</p></div>`;
  window._dsReviewIds = cur.map(r => r.id);
  return `<div class="action-section" style="border:1px solid rgba(99,102,241,0.3);background:rgba(99,102,241,0.03)">
    <div class="action-section-title"> Verify Technical Specifications <span class="action-badge">ACTION REQUIRED</span></div>
    <p style="font-size:0.82rem;color:var(--gray-3);margin-bottom:12px">Check that the proposed product meets the technical requirement. You are approving <strong>specifications only</strong> — commercial approval is done separately by the Project Manager / Director.</p>
    ${cur.map(r => `<div style="padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:white;margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="flex:1;min-width:160px;font-size:0.82rem"> <a href="${_wfEsc(r.file_url)}" target="_blank" rel="noopener" style="color:var(--red)">${_wfEsc(r.file_name)}</a>
            <span style="font-size:0.7rem;color:var(--gray-3)"> · ${_wfEsc(DATASHEET_DOC_TYPES[r.doc_type] || r.doc_type)}${r.vendor_name ? ' · ' + _wfEsc(r.vendor_name) : ''}</span></span>
          <select class="form-control" id="dsDec-${r.id}" style="width:150px;font-size:0.78rem" onchange="document.getElementById('dsNote-${r.id}').style.display=this.value==='rejected'?'':'none'">
            <option value="approved"> Meets spec</option><option value="rejected"> Does not meet</option></select>
        </div>
        <input class="form-control" id="dsNote-${r.id}" placeholder="Reason for rejection *" style="display:none;margin-top:8px;font-size:0.8rem"/>
      </div>`).join('')}
    <div class="form-group" style="margin-top:10px"><label class="form-label">Comments (optional)</label>
      <textarea class="form-control" id="dsOverallNote" rows="2" placeholder="Anything Procurement should know"></textarea></div>
    <button class="btn btn-primary" style="width:100%" onclick="submitDatasheetReview()">Submit Technical Verification</button>
    ${history.length ? `<div style="margin-top:12px"><div class="detail-key" style="margin-bottom:4px">Earlier documents</div>${_dsFileList(history)}</div>` : ''}
  </div>`;
}

async function submitDatasheetReview() {
  const pr = currentPR, user = currentUser;
  const ids = window._dsReviewIds || [];
  if (!pr || !ids.length) return;
  const decisions = ids.map(id => ({
    id, status: document.getElementById('dsDec-' + id)?.value || 'approved',
    notes: document.getElementById('dsNote-' + id)?.value.trim() || ''
  }));
  const missing = decisions.find(d => d.status === 'rejected' && !d.notes);
  if (missing) { showToast('Give a reason for every rejected document', 'error'); return; }
  const anyApproved = decisions.some(d => d.status === 'approved');
  const overall = document.getElementById('dsOverallNote')?.value.trim() || '';
  showLoader(true);
  try {
    const now = new Date().toISOString();
    for (const d of decisions) {
      const { error } = await db.from('pr_datasheets').update({
        status: d.status, review_notes: d.notes || overall || null, reviewed_by: user.id, reviewed_at: now
      }).eq('id', d.id).eq('status', 'pending');
      if (error) throw new Error(error.message);
    }
    const techStatus = anyApproved ? 'approved' : 'rejected';
    const { error } = await db.from('procurement_requests').update({
      phase: 'procurement_active', tech_verification_status: techStatus,
      updated_at: now, phase_timestamps: _wfTs(pr, 'procurement_active')
    }).eq('id', pr.id);
    if (error) throw new Error(error.message);
    const rej = decisions.filter(d => d.status === 'rejected').length;
    await window.postComment(pr.id, user.id, anyApproved
      ? ` Technical verification complete — ${decisions.length - rej} document${decisions.length - rej !== 1 ? 's' : ''} approved${rej ? `, ${rej} rejected` : ''}. Procurement can now upload quotations.${overall ? ' Note: ' + overall : ''}`
      : ` Technical verification failed — all documents rejected. Procurement must upload corrected documents.${overall ? ' Note: ' + overall : ''}`);
    notifyPhaseChange(pr.id, 'procurement_active', user.id);
    showLoader(false);
    showToast(anyApproved ? 'Verified — returned to Procurement' : 'Rejected — returned to Procurement', anyApproved ? 'success' : 'warning');
    closeModal('prModal');
    await _wfAfter(pr.id);
  } catch (e) { showLoader(false); showToast(e.message, 'error'); }
}

// Route a set of quotations to PM or Director by INR value (same rule the engineer's
// "Validate & Forward" step uses). Used when the engineer step is replaced by the
// technical verification stage.
async function routeQuotationsForApproval(quotations) {
  const cfg = await _loadQuoteAmountRouting();
  let maxInr = 0;
  for (const q of quotations) {
    const fx = quoteFxRate(q) || 1;
    const inr = (q.currency && q.currency !== 'INR' && q.inr_amount) ? parseFloat(q.inr_amount) : parseFloat(q.amount || 0) * fx;
    if (inr > maxInr) maxInr = inr;
  }
  const needsDirector = maxInr >= cfg.threshold_inr;
  return { phase: needsDirector ? 'pending_sandy_approval' : 'pending_pm_final_approval', needsDirector, maxInr, threshold: cfg.threshold_inr };
}

// ------------------------------------------------------------
// 4. FINAL COMMERCIAL (PI) REVIEW
//    Quoted value + adjustments + freight + packing/other + taxes/duties
//    = final commercial value; compare with what was approved.
// ------------------------------------------------------------
function quoteFxRate(q) {
  if (!q) return 1;
  if (!q.currency || q.currency === 'INR') return 1;
  if (parseFloat(q.fx_rate) > 0) return parseFloat(q.fx_rate);
  if (parseFloat(q.inr_amount) > 0 && parseFloat(q.amount) > 0) return parseFloat(q.inr_amount) / parseFloat(q.amount);
  const m = q.notes && q.notes.match(/[\s×x*]\s*([\d.]+)\s*=/);
  return m ? parseFloat(m[1]) : 0; // 0 = unknown
}

// Pure function — unit-tested.
function computeFinalCommercial({ quoted, priceAdjustment = 0, freight = 0, packingOther = 0, taxesDuties = 0, fx = 1, tolerancePct = 0, thresholdInr = 5000 }) {
  const n = (v) => parseFloat(v) || 0;
  const quotedV = n(quoted);
  const finalValue = Math.round((quotedV + n(priceAdjustment) + n(freight) + n(packingOther) + n(taxesDuties)) * 100) / 100;
  const delta = Math.round((finalValue - quotedV) * 100) / 100;
  const rate = fx > 0 ? fx : 1;
  const finalInr = Math.round(finalValue * rate * 100) / 100;
  const quotedInr = Math.round(quotedV * rate * 100) / 100;
  const pct = quotedV > 0 ? Math.round((delta / quotedV) * 10000) / 100 : (delta > 0 ? 100 : 0);
  let outcome;
  if (Math.abs(delta) < 0.005) outcome = 'no_change';
  else if (delta < 0 || pct <= tolerancePct) outcome = 'within_tolerance'; // decreases never need re-approval
  else outcome = 'needs_approval';
  return {
    finalValue, delta, pct, finalInr, quotedInr, outcome,
    approverRole: finalInr >= thresholdInr ? 'director' : 'pm'
  };
}

const PI_CLEARED = ['auto_cleared', 'approved'];
const piIsCleared = (row) => !!row && PI_CLEARED.includes(row.status);

async function getFinalCommercialRows(prId) {
  const { data } = await db.from('pr_final_commercial').select('*').eq('pr_id', prId).order('version_no');
  return data || [];
}
// latest row per quotation
function latestPIByQuotation(rows) {
  const m = {};
  rows.forEach(r => { const k = r.quotation_id || '_'; if (!m[k] || r.version_no > m[k].version_no) m[k] = r; });
  return m;
}

// What the PO screen needs to know before it lets a PO be generated.
async function piGateFor(prId, quotationId, flags) {
  if (!flags.pi_review_enabled) return { required: false, cleared: true, row: null };
  const rows = await getFinalCommercialRows(prId);
  const map = latestPIByQuotation(rows);
  const row = map[quotationId || '_'] || (quotationId ? null : Object.values(map)[0]) || null;
  return { required: true, cleared: piIsCleared(row), row };
}

function piStatusPill(row) {
  if (!row) return '';
  const m = {
    auto_cleared: ['#15803d', row.outcome === 'no_change' ? 'No commercial change' : 'Within tolerance'],
    approved: ['#15803d', 'Re-approved'], pending_approval: ['#b45309', `Awaiting ${row.approver_role === 'director' ? 'Director' : 'PM'}`],
    rejected: ['#b91c1c', 'Rejected'], superseded: ['#6b7280', 'Superseded']
  }[row.status] || ['#6b7280', row.status];
  return `<span style="font-size:0.68rem;font-weight:700;padding:2px 8px;border-radius:3px;background:${m[0]}18;color:${m[0]};border:1px solid ${m[0]}35">${m[1]}</span>`;
}

function _piBreakdownTable(row) {
  const c = row.currency;
  const line = (l, v) => `<tr><td style="padding:3px 10px 3px 0;color:var(--gray-3)">${l}</td><td style="text-align:right;font-family:var(--font-mono)">${_wfMoney(v, c)}</td></tr>`;
  return `<table style="font-size:0.8rem;border-collapse:collapse">
    ${line('Approved quotation', row.quoted_value)}
    ${parseFloat(row.price_adjustment) ? line('Price / quantity revision', row.price_adjustment) : ''}
    ${line('Freight', row.freight)}${line('Packing / other', row.packing_other)}${line('Taxes / duties', row.taxes_duties)}
    <tr style="border-top:1px solid var(--border)"><td style="padding:4px 10px 0 0;font-weight:700">Final commercial value</td><td style="text-align:right;font-family:var(--font-mono);font-weight:700">${_wfMoney(row.final_value, c)}</td></tr>
    ${parseFloat(row.deviation_amount) ? `<tr><td style="color:#b45309;padding-top:2px">Change vs quotation</td><td style="text-align:right;color:#b45309;font-family:var(--font-mono)">${row.deviation_amount > 0 ? '+' : ''}${_wfMoney(row.deviation_amount, c)} (${row.deviation_pct > 0 ? '+' : ''}${row.deviation_pct}%)</td></tr>` : ''}
  </table>`;
}

// Procurement: one card per approved quotation
function buildPIReviewCard(pr, q, row, flags) {
  const cur = q.currency || 'INR';
  const head = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px">
      <div style="font-weight:700;font-size:0.82rem"> Final Commercial Review — ${_wfEsc(q.vendor_name || 'Vendor')}</div>${piStatusPill(row)}</div>`;
  if (piIsCleared(row)) {
    return `<div style="border:1px solid rgba(22,163,74,0.3);background:rgba(22,163,74,0.04);border-radius:var(--radius);padding:12px 14px;margin-bottom:10px">${head}
      ${_piBreakdownTable(row)}
      <div style="font-size:0.72rem;color:var(--gray-3);margin-top:6px">${row.pi_number ? 'PI ' + _wfEsc(row.pi_number) + ' · ' : ''}${row.pi_file_url ? `<a href="${_wfEsc(row.pi_file_url)}" target="_blank" rel="noopener" style="color:var(--red)">View PI</a>` : ''}</div></div>`;
  }
  if (row && row.status === 'pending_approval') {
    return `<div style="border:1px solid rgba(245,158,11,0.35);background:rgba(245,158,11,0.05);border-radius:var(--radius);padding:12px 14px;margin-bottom:10px">${head}
      ${_piBreakdownTable(row)}<div style="font-size:0.76rem;color:#92400e;margin-top:6px">Reason: ${_wfEsc(row.reason || '—')}. Waiting for ${row.approver_role === 'director' ? 'the Director' : 'the Project Manager'} to approve the revised value.</div></div>`;
  }
  window._piQuotes = window._piQuotes || {};
  window._piQuotes[q.id] = { q, flags };
  const k = q.id;
  const inp = (id, label, ph) => `<div class="form-group"><label class="form-label">${label} (${cur})</label>
      <input class="form-control" type="number" step="any" min="0" id="pi-${k}-${id}" value="0" placeholder="${ph || '0.00'}" oninput="piRecalc('${k}')"/></div>`;
  const fx = quoteFxRate(q);
  return `<div style="border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:10px;background:white">${head}
    ${row && row.status === 'rejected' ? `<div style="margin-bottom:10px;padding:8px 10px;border:1px solid rgba(220,38,38,0.3);background:rgba(220,38,38,0.05);border-radius:6px;font-size:0.78rem;color:#b91c1c"> Last PI (v${row.version_no}) was rejected${row.decision_notes ? ': ' + _wfEsc(row.decision_notes) : ''}. Negotiate / obtain a revised PI and resubmit.</div>` : ''}
    <p style="font-size:0.78rem;color:var(--gray-3);margin:0 0 10px">Upload the supplier's PI / commercial invoice and enter the charges it adds on top of the approved quotation of <strong>${_wfMoney(q.amount, cur)}</strong>. Identical values continue automatically; a material change goes back for approval.</p>
    <div class="form-grid">
      <div class="form-group"><label class="form-label">PI / Invoice No. *</label><input class="form-control" id="pi-${k}-number" placeholder="e.g. PI-2026-0142"/></div>
      <div class="form-group"><label class="form-label">PI / Invoice file *</label><input class="form-control" type="file" id="pi-${k}-file"/></div>
      ${inp('adj', 'Price / qty revision (+/−)', '0.00').replace('min="0" ', '')}
      ${inp('freight', 'Freight')}${inp('packing', 'Packing / insurance / tooling / other')}${inp('taxes', 'Taxes / duties')}
      <div class="form-group full"><label class="form-label">Reason for change <span style="color:var(--gray-4);font-weight:400">(required if the value differs)</span></label>
        <input class="form-control" id="pi-${k}-reason" placeholder="e.g. supplier added air freight"/></div>
    </div>
    <div id="pi-${k}-summary" style="margin:8px 0;padding:9px 12px;background:var(--off-white);border:1px solid var(--border);border-radius:6px;font-size:0.8rem"></div>
    ${fx === 0 && cur !== 'INR' ? `<div style="font-size:0.72rem;color:#b45309;margin-bottom:6px"> No INR rate stored on this quotation — approval level will be judged on the raw ${cur} amount.</div>` : ''}
    <button class="btn btn-primary" onclick="submitFinalCommercial('${k}')">Submit for Final Commercial Review →</button>
  </div>`;
}

async function piRecalc(qid) {
  const ctx = (window._piQuotes || {})[qid]; if (!ctx) return;
  const g = (s) => parseFloat(document.getElementById(`pi-${qid}-${s}`)?.value) || 0;
  const cfg = await _loadQuoteAmountRouting();
  const r = computeFinalCommercial({
    quoted: ctx.q.amount, priceAdjustment: g('adj'), freight: g('freight'), packingOther: g('packing'), taxesDuties: g('taxes'),
    fx: quoteFxRate(ctx.q) || 1, tolerancePct: ctx.flags.pi_tolerance_pct, thresholdInr: cfg.threshold_inr
  });
  const cur = ctx.q.currency || 'INR';
  const el = document.getElementById(`pi-${qid}-summary`); if (!el) return;
  const msg = r.outcome === 'no_change' ? '<span style="color:#15803d">No commercial change — will continue without another approval.</span>'
    : r.outcome === 'within_tolerance' ? `<span style="color:#15803d">${r.delta < 0 ? 'Lower than approved' : 'Within the ' + ctx.flags.pi_tolerance_pct + '% tolerance'} — will continue automatically.</span>`
    : `<span style="color:#b45309">Material change — will be sent to the ${r.approverRole === 'director' ? 'Director' : 'Project Manager'} for approval (final value ₹${r.finalInr.toLocaleString('en-IN')}).</span>`;
  el.innerHTML = `Final commercial value: <strong style="font-family:var(--font-mono)">${_wfMoney(r.finalValue, cur)}</strong>
    ${r.delta ? ` <span style="color:var(--gray-3)">(${r.delta > 0 ? '+' : ''}${_wfMoney(r.delta, cur)}, ${r.pct > 0 ? '+' : ''}${r.pct}%)</span>` : ''}<br/>${msg}`;
}

async function submitFinalCommercial(qid) {
  const pr = currentPR, user = currentUser;
  const ctx = (window._piQuotes || {})[qid]; if (!pr || !ctx) return;
  const q = ctx.q, g = (s) => parseFloat(document.getElementById(`pi-${qid}-${s}`)?.value) || 0;
  const piNumber = document.getElementById(`pi-${qid}-number`)?.value.trim();
  const file = document.getElementById(`pi-${qid}-file`)?.files?.[0];
  const reason = document.getElementById(`pi-${qid}-reason`)?.value.trim() || '';
  if (!piNumber) { showToast('Enter the PI / invoice number', 'error'); return; }
  if (!file) { showToast('Attach the PI / commercial invoice', 'error'); return; }
  const cfg = await _loadQuoteAmountRouting();
  const flags = ctx.flags;
  const r = computeFinalCommercial({
    quoted: q.amount, priceAdjustment: g('adj'), freight: g('freight'), packingOther: g('packing'), taxesDuties: g('taxes'),
    fx: quoteFxRate(q) || 1, tolerancePct: flags.pi_tolerance_pct, thresholdInr: cfg.threshold_inr
  });
  if (r.outcome !== 'no_change' && !reason) { showToast('Give the reason the value differs from the quotation', 'error'); return; }
  let role = r.approverRole;
  if (r.outcome === 'needs_approval' && role === 'pm' && !pr.assigned_pm_id) role = 'director';

  showLoader(true);
  try {
    const rows = await getFinalCommercialRows(pr.id);
    // version_no is unique per PR, so number across the whole PR
    const versionNo = (rows.reduce((m, x) => Math.max(m, x.version_no), 0)) + 1;
    const up = await _wfUploadDoc(file, `pi/${pr.id}`);
    const cleared = r.outcome !== 'needs_approval';
    const { error } = await db.from('pr_final_commercial').insert({
      pr_id: pr.id, version_no: versionNo, quotation_id: q.id, pi_number: piNumber, pi_file_name: up.name, pi_file_url: up.url,
      currency: q.currency || 'INR', fx_rate: quoteFxRate(q) || null,
      quoted_value: parseFloat(q.amount) || 0, price_adjustment: g('adj'), freight: g('freight'), packing_other: g('packing'), taxes_duties: g('taxes'),
      final_value: r.finalValue, quoted_value_inr: r.quotedInr, final_value_inr: r.finalInr,
      deviation_amount: r.delta, deviation_pct: r.pct, outcome: r.outcome,
      status: cleared ? 'auto_cleared' : 'pending_approval', approver_role: cleared ? null : role,
      reason: reason || null, submitted_by: user.id
    });
    if (error) throw new Error(error.message);
    const upd = cleared
      ? { pi_status: 'auto_cleared', pi_approver_role: null, updated_at: new Date().toISOString() }
      : { pi_status: 'pending_approval', pi_approver_role: role, phase: 'pending_pi_approval', updated_at: new Date().toISOString(), phase_timestamps: _wfTs(pr, 'pending_pi_approval') };
    const u = await db.from('procurement_requests').update(upd).eq('id', pr.id);
    if (u.error) throw new Error(u.error.message);
    await window.postComment(pr.id, user.id, cleared
      ? ` PI ${piNumber} checked against the approved quotation — ${r.outcome === 'no_change' ? 'no commercial change' : 'within tolerance'} (${_wfMoney(r.finalValue, q.currency)}). PO can now be generated.`
      : ` PI ${piNumber}: final commercial value ${_wfMoney(r.finalValue, q.currency)} vs approved ${_wfMoney(q.amount, q.currency)} (${r.delta > 0 ? '+' : ''}${_wfMoney(r.delta, q.currency)}, ${r.pct}%). Reason: ${reason}. Sent to the ${role === 'director' ? 'Director' : 'Project Manager'} for re-approval.`);
    if (!cleared) notifyPhaseChange(pr.id, 'pending_pi_approval', user.id);
    showLoader(false);
    showToast(cleared ? 'PI cleared — you can generate the PO' : 'Sent for re-approval', cleared ? 'success' : 'warning');
    await _wfAfter(pr.id);
  } catch (e) { showLoader(false); showToast(e.message, 'error'); }
}

// Approver panel (PM page for role 'pm', Master/Director page for role 'director')
function canDecidePI(pr, user) {
  if (!pr || !user) return false;
  if (user.role === 'master') return true;
  if (pr.pi_approver_role === 'director') return user.role === 'director';
  return pr.assigned_pm_id === user.id;
}

async function buildPIApprovalPanel(pr, user) {
  const rows = await getFinalCommercialRows(pr.id);
  const pending = rows.filter(r => r.status === 'pending_approval');
  if (!pending.length) return `<div class="action-section"><p style="font-size:0.82rem;color:var(--gray-4)">No commercial change awaiting approval.</p></div>`;
  window._piCtx = { pr, user, rowIds: pending.map(r => r.id) };
  const can = canDecidePI(pr, user);
  return `<div class="action-section" style="border-color:#f59e0b55;background:rgba(245,158,11,0.04)">
    <div class="action-section-title" style="color:#b45309"> Final Commercial Change — Re-approval ${can ? '<span class="action-badge">ACTION REQUIRED</span>' : ''}</div>
    <p style="font-size:0.82rem;color:var(--gray-3);margin-bottom:12px">The supplier's PI / final invoice differs from the quotation that was approved. Approving lets Procurement generate the PO at the final value.</p>
    ${pending.map(r => `<div style="padding:10px 12px;background:white;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px">
        <div style="font-size:0.8rem;margin-bottom:6px"><strong>PI ${_wfEsc(r.pi_number || '')}</strong>
          ${r.pi_file_url ? ` · <a href="${_wfEsc(r.pi_file_url)}" target="_blank" rel="noopener" style="color:var(--red)">View PI</a>` : ''}</div>
        ${_piBreakdownTable(r)}
        <div style="font-size:0.78rem;margin-top:6px"><strong>Reason:</strong> ${_wfEsc(r.reason || '—')}</div>
        <div style="font-size:0.72rem;color:var(--gray-4);margin-top:2px">Final value in INR: ₹${Number(r.final_value_inr || 0).toLocaleString('en-IN')} · approver level: ${r.approver_role === 'director' ? 'Director' : 'Project Manager'}</div>
      </div>`).join('')}
    ${can ? `<div class="form-group" style="margin-top:8px"><label class="form-label">Decision notes *</label>
        <textarea class="form-control" id="piDecisionNotes" rows="2" placeholder="Rationale for approving / rejecting the revised value"></textarea></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-success" style="flex:1" onclick="decidePI('approved')"> Approve revised value</button>
        <button class="btn btn-danger" style="flex:1" onclick="decidePI('rejected')"> Reject</button></div>`
      : `<div style="font-size:0.78rem;color:var(--gray-3)">Waiting for ${pr.pi_approver_role === 'director' ? 'the Director' : 'the assigned Project Manager'}.</div>`}
  </div>`;
}

async function decidePI(decision) {
  const ctx = window._piCtx; if (!ctx) return;
  const { pr, user, rowIds } = ctx;
  if (!canDecidePI(pr, user)) { showToast('You are not the approver for this change', 'error'); return; }
  const notes = document.getElementById('piDecisionNotes')?.value.trim();
  if (!notes) { showToast('Add decision notes', 'error'); return; }
  showLoader(true);
  try {
    const now = new Date().toISOString();
    for (const id of rowIds) {
      const { data, error } = await db.from('pr_final_commercial').update({
        status: decision, decided_by: user.id, decided_at: now, decision_notes: notes
      }).eq('id', id).eq('status', 'pending_approval').select('id');
      if (error) throw new Error(error.message);
      if (!data || !data.length) throw new Error('This change was already decided by someone else.');
    }
    const { error } = await db.from('procurement_requests').update({
      phase: 'approved', pi_status: decision, updated_at: now, phase_timestamps: _wfTs(pr, 'approved')
    }).eq('id', pr.id);
    if (error) throw new Error(error.message);
    await window.postComment(pr.id, user.id, decision === 'approved'
      ? ` Revised commercial value approved. ${notes}` : ` Revised commercial value rejected — Procurement to renegotiate / resubmit. ${notes}`);
    notifyPhaseChange(pr.id, 'approved', user.id);
    showLoader(false);
    showToast(decision === 'approved' ? 'Approved' : 'Rejected', decision === 'approved' ? 'success' : 'warning');
    ['prModal', 'mainModal'].forEach(id => { if (document.getElementById(id)) closeModal(id); });
    await _wfAfter(pr.id);
  } catch (e) { showLoader(false); showToast(e.message, 'error'); }
}

// expose inline-handler entry points
Object.assign(window, {
  loadWorkflowFlags, invalidateWorkflowFlags, saveWorkflowFlags, canEditPR, collectPREditValues, buildPREditReasonHTML,
  savePRRevision, revBadgeHTML, diffPRParts, diffPRFields,
  handleDatasheetFiles, dsUpdate, dsRemove, submitDatasheetsForVerification, submitDatasheetReview,
  buildDatasheetUploadSection, buildDatasheetReviewSection, buildDatasheetSummarySection, getDatasheets, routeQuotationsForApproval,
  computeFinalCommercial, quoteFxRate, piGateFor, piIsCleared, getFinalCommercialRows, latestPIByQuotation,
  buildPIReviewCard, piRecalc, submitFinalCommercial, buildPIApprovalPanel, decidePI, canDecidePI
});
