// ─── Page state ───────────────────────────────────────────────────────────────
var currentUser = null;
var allRequests  = [];
var myRequests   = [];
var currentPR    = null;
var activeTab    = 'action';
var qcSelection  = null;
var deviationTargetId = null;
var allPMsAndDirector = []; // loaded for deviation dropdown
var qcAttachments = []; // attachments added during QC inspection

// ─── Helpers ──────────────────────────────────────────────────────────────────
function addPhaseTimestamp(pr, phaseName) {
  var existing = (pr && pr.phase_timestamps) ? pr.phase_timestamps : {};
  var ts = Object.assign({}, existing);
  ts[phaseName] = new Date().toISOString();
  return ts;
}

// function fmtDate(iso) {
//   if (!iso) return '—';
//   return new Date(iso).toLocaleDateString('en-IN');
// }

// ─── Tab switching ────────────────────────────────────────────────────────────
window.switchTab = function switchTab(t) {
  activeTab = t;
  document.querySelectorAll('.tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === t);
  });
  document.getElementById('tabMain').style.display        = t === 'myrequests' ? 'none' : 'block';
  document.getElementById('tabMyRequests').style.display  = t === 'myrequests' ? 'block' : 'none';
  if (t === 'myrequests') renderMyRequestsTable();
  else renderTable();
};

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  currentUser = Session.require(['qc_inspector']);
  if (!currentUser) return;
  document.getElementById('navbarMount').innerHTML = buildNavbar(currentUser);
  document.getElementById('footerMount').innerHTML = buildFooter();
  initNavbar(currentUser);
  // Load PMs + Director for the deviation dropdown
  var usersRes = await db.from('users').select('id,name,role').in('role',['project_manager','director']).order('name');
  allPMsAndDirector = usersRes.data || [];
  await loadRequests();
}

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadRequests() {
  showLoader(true);
  var results = await Promise.all([
    db.from('procurement_requests').select('*').order('created_at', {ascending: false}),
    db.from('procurement_requests').select('*').eq('created_by', currentUser.id).order('updated_at', {ascending: false})
  ]);
  showLoader(false);

  var allRes = results[0];
  var myRes  = results[1];

  if (allRes.error) { showToast('Error loading requests', 'error'); return; }

  allRequests = allRes.data  || [];
  myRequests  = myRes.data   || [];

  updateStats();
  renderTable();
  renderMyRequestsTable();
}

function updateStats() {
  document.getElementById('sQcPending').textContent = allRequests.filter(function(r){ return ['qc_pending','rework_returned','rework2_pending','rework2_returned'].indexOf(r.phase) !== -1; }).length;
  document.getElementById('sQcPassed').textContent  = allRequests.filter(function(r){ return r.phase === 'qc_passed' || r.phase === 'accepted'; }).length;
  document.getElementById('sRework').textContent    = allRequests.filter(function(r){ return ['rework_store_form','rework_pending'].indexOf(r.phase) !== -1; }).length;

  // update rejected stat (use existing sRework slot or add a new stat if available)
  var rejEl = document.getElementById('sQcRejected');
  if (rejEl) rejEl.textContent = allRequests.filter(function(r){ return r.phase === 'qc_rejected'; }).length;
}

// ─── Tables ───────────────────────────────────────────────────────────────────
function renderTable() {
  var actionPhases = ['qc_pending', 'rework_store_form', 'rework_returned', 'rework2_returned'];
  var rows = activeTab === 'action'
    ? allRequests.filter(function(r){ return actionPhases.indexOf(r.phase) !== -1; })
    : allRequests.filter(function(r){ return ['qc_pending','qc_passed','rework_store_form','rework_pending','rework_returned','rework2_pending','rework2_returned','qc_deviated','deviation_approval','accepted','qc_rejected'].indexOf(r.phase) !== -1; });

  var tbody = document.getElementById('mainTbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No requests</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(r) {
    var grn      = (r.qc_criteria && r.qc_criteria.grn) ? r.qc_criteria.grn : {};
    var parts    = r.parts || [];
    var isAction = actionPhases.indexOf(r.phase) !== -1;
    var btnLabel = r.phase === 'rework2_returned' ? '\uD83D\uDD04 Final Re-QC \u2192' : r.phase === 'rework_returned' ? '\uD83D\uDD04 Post-Rework QC \u2192' : (isAction ? 'Inspect \u2192' : 'View');
    return '<tr' + (isAction ? ' class="row-action"' : '') + '>'
      + '<td><span class="pr-num">PR-' + String(r.request_number).padStart(4,'0') + '</span></td>'
      + '<td><span class="fw-600">' + r.project_name + '</span>'
        + (r.project_phase ? '<br><span class="text-muted" style="font-size:0.75rem">' + r.project_phase + '</span>' : '')
        + '</td>'
      + '<td>' + getPhaseBadge(r.phase) + '</td>'
      + '<td style="font-size:0.78rem">'
        + (grn.grn_number
            ? '<span class="fw-600">' + grn.grn_number + '</span><br>' + (grn.grn_date || '')
            : (r.qc_notes || '—'))
        + '</td>'
      + '<td style="font-size:0.8rem;color:var(--gray-3)">' + parts.length + ' item' + (parts.length !== 1 ? 's' : '') + '</td>'
      + '<td style="font-size:0.78rem;color:var(--gray-4)">' + new Date(r.created_at).toLocaleDateString('en-IN') + '</td>'
      + '<td><button class="btn btn-sm ' + (isAction ? 'btn-primary' : 'btn-secondary') + '" onclick="openPR(\'' + r.id + '\')">'
        + btnLabel + '</button></td>'
      + '</tr>';
  }).join('');
}

function renderMyRequestsTable() {
  var tbody = document.getElementById('myReqTbody');
  if (!myRequests.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state" style="padding:32px;text-align:center;color:var(--gray-4)">No requests submitted yet</td></tr>';
    return;
  }
  tbody.innerHTML = myRequests.map(function(r) {
    return '<tr>'
      + '<td><span class="pr-number">PR-' + String(r.request_number).padStart(4,'0') + '</span></td>'
      + '<td><div style="font-weight:600;font-size:0.82rem">' + r.project_name + '</div>'
        + '<div style="font-size:0.72rem;color:var(--gray-4)">' + (r.project_phase || '') + '</div></td>'
      + '<td>' + getPhaseBadge(r.phase) + '</td>'
      + '<td style="font-size:0.78rem;color:var(--gray-4)">' + fmtDate(r.updated_at || r.created_at) + '</td>'
      + '<td><button class="btn btn-ghost btn-sm" onclick="openPR(\'' + r.id + '\')">View</button></td>'
      + '</tr>';
  }).join('');
}

// ─── Open PR modal ────────────────────────────────────────────────────────────
window.openPR = async function openPR(id) {
  showLoader(true);
  var result = await db.from('procurement_requests').select('*').eq('id', id).single();
  showLoader(false);
  if (result.error) { showToast('Error loading request', 'error'); return; }
  currentPR        = result.data;
  qcSelection      = null;
  reworkQCSelection = null;
  renderModal();
  openModal('prModal');
};

// ─── Modal rendering ──────────────────────────────────────────────────────────
function renderModal() {
  var pr     = currentPR;
  var parts  = pr.parts || [];
  var grn    = (pr.qc_criteria && pr.qc_criteria.grn) ? pr.qc_criteria.grn : {};
  var prNum  = 'PR-' + String(pr.request_number).padStart(4,'0');

  // ── GRN summary block ────────────────────────────────────────────────────
  var grnSummary = '';
  if (grn.grn_number) {
    var lines    = grn.lines || [];
    var totRcvd  = lines.reduce(function(s,l){ return s + (l.received || 0); }, 0);
    var totAccpt = lines.reduce(function(s,l){ return s + (l.accepted || 0); }, 0);
    var totRejct = lines.reduce(function(s,l){ return s + (l.rejected || 0); }, 0);

    var lineRows = lines.length
      ? '<details style="margin-top:8px"><summary style="font-size:0.78rem;cursor:pointer;color:var(--gray-3)">View item-by-item GRN →</summary>'
        + '<div style="overflow-x:auto;margin-top:8px"><table class="grn-table" style="font-size:0.75rem">'
        + '<thead><tr><th>Sr.</th><th>Code</th><th>Item</th><th>PO Qty</th><th>Received</th><th>Accepted</th><th>Rejected</th><th>Remarks</th></tr></thead>'
        + '<tbody>' + lines.map(function(l) {
            return '<tr>'
              + '<td style="text-align:center">' + l.sr + '</td>'
              + '<td>' + (l.item_code || '—') + '</td>'
              + '<td>' + (l.item_name  || '—') + '</td>'
              + '<td style="text-align:center">' + (l.po_qty   || 0) + '</td>'
              + '<td style="text-align:center">' + (l.received || 0) + '</td>'
              + '<td style="text-align:center;color:#16a34a;font-weight:600">' + (l.accepted || 0) + '</td>'
              + '<td style="text-align:center;color:#dc2626;font-weight:600">' + (l.rejected || 0) + '</td>'
              + '<td>' + (l.notes || '—') + '</td>'
              + '</tr>';
          }).join('') + '</tbody></table></div></details>'
      : '';

    grnSummary = '<div class="grn-summary">'
      + '<div style="font-size:0.8rem;font-weight:700;color:var(--gray-3);margin-bottom:2px">📋 GRN Details — ' + grn.grn_number + '</div>'
      + '<div style="font-size:0.75rem;color:var(--gray-4)">' + (grn.grn_date || '') + ' | Received by: ' + (grn.received_by || '—') + ' | Transporter: ' + (grn.transporter || '—') + '</div>'
      + '<div class="grn-summary-grid">'
        + '<div class="grn-stat"><div class="grn-stat-val">' + totRcvd  + '</div><div class="grn-stat-lbl">Received</div></div>'
        + '<div class="grn-stat" style="border-color:rgba(22,163,74,0.3)"><div class="grn-stat-val" style="color:#16a34a">' + totAccpt + '</div><div class="grn-stat-lbl">Accepted</div></div>'
        + '<div class="grn-stat" style="border-color:rgba(220,38,38,0.3)"><div class="grn-stat-val" style="color:#dc2626">' + totRejct + '</div><div class="grn-stat-lbl">Rejected</div></div>'
      + '</div>'
      + lineRows
      + (grn.remarks ? '<div style="margin-top:6px;font-size:0.78rem;color:var(--gray-3)">Remarks: ' + grn.remarks + '</div>' : '')
      + '</div>';
  }

  // ── Action section ───────────────────────────────────────────────────────
  var actionSection = '';

  if (pr.phase === 'qc_pending') {
    var qcCriteriaHTML = '';
    if (pr.qc_criteria && (pr.qc_criteria.preferred_color || pr.qc_criteria.preferred_material || pr.qc_criteria.custom)) {
      qcCriteriaHTML = '<div style="background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.2);border-radius:var(--radius);padding:10px;margin-bottom:12px">'
        + '<div style="font-size:0.75rem;font-weight:700;color:#6366f1;margin-bottom:4px">🔍 Expected QC Criteria</div>'
        + (pr.qc_criteria.preferred_color    ? '<div style="font-size:0.78rem">Color/Finish: <strong>' + pr.qc_criteria.preferred_color    + '</strong></div>' : '')
        + (pr.qc_criteria.preferred_material ? '<div style="font-size:0.78rem">Material: <strong>'     + pr.qc_criteria.preferred_material + '</strong></div>' : '')
        + (pr.qc_criteria.custom             ? '<div style="font-size:0.78rem">Other: '                + pr.qc_criteria.custom             + '</div>'          : '')
        + '</div>';
    }

    actionSection = '<div class="action-section">'
      + '<div class="action-section-title">🔍 Quality Check <span class="action-badge">ACTION REQUIRED</span></div>'
      + grnSummary
      + qcCriteriaHTML
      + '<div class="qc-result-row" style="grid-template-columns:1fr 1fr 1fr 1fr">'
        + '<div class="qc-option pass" id="optPass" onclick="selectQC(\'pass\')">'
          + '<div class="qc-icon">✅</div><div class="qc-label">QC Passed</div>'
          + '<div class="qc-desc">All goods meet quality specs</div></div>'
        + '<div class="qc-option fail" id="optFail" onclick="selectQC(\'fail\')">'
          + '<div class="qc-icon">🔄</div><div class="qc-label">QC Failed — Jobwork</div>'
          + '<div class="qc-desc">Raise JWC — send for rework</div></div>'
        + '<div class="qc-option reject" id="optReject" onclick="selectQC(\'reject\')">'
          + '<div class="qc-icon">🚫</div><div class="qc-label">QC Rejected</div>'
          + '<div class="qc-desc">Outright rejection — no rework</div></div>'
        + '<div class="qc-option" id="optDeviate" onclick="selectQC(\'deviate\')" style="border-color:rgba(124,58,237,0.3)">'
          + '<div class="qc-icon">↗</div><div class="qc-label" style="color:#7c3aed">Deviate</div>'
          + '<div class="qc-desc">Escalate to Project Manager / Director</div></div>'
      + '</div>'

      + '<div id="deviationSection" style="display:none;margin:10px 0;padding:14px;background:rgba(124,58,237,0.05);border:1px solid rgba(124,58,237,0.2);border-radius:var(--radius)">'
        + '<div style="font-size:0.84rem;font-weight:700;color:#7c3aed;margin-bottom:8px">↗ Deviation — Select Recipient</div>'
        + '<p style="font-size:0.78rem;color:var(--gray-3);margin-bottom:10px">Select who to send this deviation to. They will review and accept or reject it.</p>'
        + '<div class="form-group" style="margin-bottom:10px"><label class="form-label" style="font-size:0.75rem">Send deviation to *</label>'
        + ('<select class="form-control" id="deviationTargetSelect" style="font-size:0.82rem" onchange="onDeviationTargetChange()"><option value="">— Select Project Manager or Director —</option>'          + allPMsAndDirector.map(function(u){ return '<option value="' + u.id + '">' + u.name + ' (' + (u.role==='director'?'Director':'Project Manager') + ')</option>'; }).join('')          + '</select>')        + '</div>'
        + '<div class="form-group"><label class="form-label" style="font-size:0.75rem">Deviation reason *</label>'
        + '<textarea class="form-control" id="deviationReason" rows="2" placeholder="Describe why this is being deviated..." style="font-size:0.82rem"></textarea></div>'
      + '</div>'
      + '<div style="margin:10px 0"><label class="form-label">QC Attachments <span style="font-size:0.72rem;color:var(--gray-4);font-weight:400">(photos, reports — optional)</span></label>'
        + '<div style="border:2px dashed var(--border);border-radius:var(--radius-sm);padding:10px;text-align:center;cursor:pointer;background:rgba(99,102,241,0.02)" id="qcAttachZone" onclick="document.getElementById(\'qcAttachFile\').click()">'
        + '<input type="file" id="qcAttachFile" accept="image/*,.pdf" multiple style="display:none" onchange="handleQCAttach(event)"/>'
        + '<div style="font-size:0.78rem;font-weight:600">📎 Click to attach QC photos / reports</div>'
        + '</div><div id="qcAttachList" style="margin-top:6px;display:flex;flex-direction:column;gap:3px"></div>'
      + '</div>'
      + '<div id="samplesSection" style="display:none" class="samples-section">'
        + '<div style="font-size:0.84rem;font-weight:700;color:var(--gray-2);margin-bottom:6px">📦 Sample Rejection Quantities</div>'
        + '<div style="font-size:0.76rem;color:var(--gray-3);margin-bottom:8px">Enter the number of samples rejected per item. Defaults to GRN rejected qty — edit if only some are being rejected.</div>'
        + '<div style="overflow-x:auto"><table class="samples-table">'
          + '<thead><tr><th>#</th><th style="text-align:left">Item</th><th>Received</th><th>Rejected Qty</th><th>Accepted (auto)</th></tr></thead>'
          + '<tbody id="samplesBody"></tbody>'
        + '</table></div>'
      + '</div>'
      + '<div><label class="form-label">Inspection Notes *</label>'
        + '<textarea class="form-control" id="qcNotes" rows="3" placeholder="Describe findings, defects, measurements checked…"></textarea></div>'
      + '<div id="jwcFormSection" style="display:none" class="jwc-form">'
        + '<div style="font-size:0.84rem;font-weight:700;color:#dc2626;margin-bottom:10px">📄 Job Work Challan Details</div>'
        + '<div class="jwc-form-grid">'
          + '<div><label class="form-label" style="font-size:0.7rem">JWC NUMBER *</label>'
            + '<input class="form-control" id="jwcNumber" placeholder="O2C/JW/00012" style="font-family:var(--font-mono);font-size:0.82rem"/></div>'
          + '<div><label class="form-label" style="font-size:0.7rem">ISSUE DATE</label>'
            + '<input class="form-control" id="jwcDate" value="' + new Date().toISOString().split('T')[0] + '" style="font-family:var(--font-mono);font-size:0.82rem"/></div>'
          + '<div><label class="form-label" style="font-size:0.7rem">EXPECTED DAYS</label>'
            + '<input class="form-control" type="number" id="jwcDays" placeholder="15" style="font-size:0.82rem"/></div>'
          + '<div><label class="form-label" style="font-size:0.7rem">REWORK VENDOR</label>'
            + '<input class="form-control" id="jwcVendor" placeholder="Vendor name &amp; address" style="font-size:0.82rem"/></div>'
          + '<div><label class="form-label" style="font-size:0.7rem">VEHICLE NO</label>'
            + '<input class="form-control" id="jwcVehicle" placeholder="Vehicle number" style="font-size:0.82rem"/></div>'
          + '<div><label class="form-label" style="font-size:0.7rem">NATURE OF PROCESS</label>'
            + '<input class="form-control" id="jwcProcess" placeholder="e.g. For Re-work / Re-coating" style="font-size:0.82rem"/></div>'
        + '</div>'
        + '<div style="margin-bottom:10px">'
          + '<label class="form-label" style="font-size:0.7rem">REWORK ITEMS (quantities from sample table above)</label>'
          + '<div id="jwcItemsGrid" style="overflow-x:auto">'
            + '<table class="jwc-table">'
              + '<thead><tr><th>Sr.</th><th>Description of Goods (Out)</th><th>Issued Qty</th><th>Unit Rate</th><th>Est. Value</th></tr></thead>'
              + '<tbody id="jwcItemsBody"></tbody>'
            + '</table>'
          + '</div>'
        + '</div>'
        + '<div><label class="form-label" style="font-size:0.7rem">ADDITIONAL NOTES</label>'
          + '<textarea class="form-control" id="jwcNotes" rows="2" placeholder="Packing, weight, special instructions…" style="font-size:0.82rem"></textarea></div>'
      + '</div>'
      + '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">'
        + '<button class="btn btn-primary" id="btnSubmitQC" onclick="submitQC()">Submit QC Result →</button>'
      + '</div>'
      + '</div>';

  } else if (pr.phase === 'rework2_returned') {
    var jwcRework2Data = (pr.qc_criteria && pr.qc_criteria.jwc2) ? pr.qc_criteria.jwc2 : (pr.qc_criteria && pr.qc_criteria.jwc ? pr.qc_criteria.jwc : {});
    actionSection = '<div class="action-section">'      + '<div class="action-section-title">🔄 Final Post-Rework QC Inspection <span class="action-badge">ACTION REQUIRED</span></div>'      + grnSummary      + (jwcRework2Data.jwc_number          ? '<div style="margin-bottom:14px;padding:10px 12px;background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-sm);font-size:0.82rem">'            + '<div style="font-weight:700;color:#dc2626;margin-bottom:4px">📄 2nd Rework History — JWC ' + jwcRework2Data.jwc_number + '</div>'            + '<div>Rework Vendor: <strong>' + (jwcRework2Data.rework_vendor || '—') + '</strong></div>'            + (jwcRework2Data.notes ? '<div>Notes: ' + jwcRework2Data.notes + '</div>' : '')            + '</div>'          : '')      + '<div style="background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:14px;font-size:0.82rem">'        + '<strong>⚠️ This is the final rework cycle.</strong> If goods still fail QC, they will be outright rejected.'      + '</div>'      + '<div style="margin-bottom:12px"><label class="form-label">Re-QC Attachments <span style="font-size:0.72rem;color:var(--gray-4);font-weight:400">(optional)</span></label>'        + '<div style="border:2px dashed var(--border);border-radius:var(--radius-sm);padding:12px;text-align:center;cursor:pointer" onclick="document.getElementById(\'finalReQcAttachFile\').click()">'        + '<input type="file" id="finalReQcAttachFile" accept="image/*,.pdf" multiple style="display:none" onchange="handleFinalReQCAttach(event)"/>'        + '<div style="font-size:0.78rem;font-weight:600">📎 Click to attach photos / reports</div>'        + '</div><div id="finalReQcAttachList" style="margin-top:6px"></div></div>'      + '<div class="qc-result-row" style="grid-template-columns:1fr 1fr;max-width:480px">'        + '<div class="qc-option pass" id="rw2OptPass" onclick="selectRework2QC(\'pass\')">'          + '<div class="qc-icon">✅</div><div class="qc-label">QC Passed</div>'          + '<div class="qc-desc">Final rework accepted</div></div>'        + '<div class="qc-option reject" id="rw2OptReject" onclick="selectRework2QC(\'reject\')">'          + '<div class="qc-icon">🚫</div><div class="qc-label">QC Rejected</div>'          + '<div class="qc-desc">Still defective — outright rejection</div></div>'      + '</div>'      + '<div id="rw2SamplesSection" style="display:none" class="samples-section">'        + '<div style="font-size:0.84rem;font-weight:700;color:var(--gray-2);margin-bottom:6px">📦 Final Rejection Quantities</div>'        + '<table class="samples-table"><thead><tr><th>#</th><th style="text-align:left">Item</th><th>Received</th><th>Rejected Qty</th><th>Accepted (auto)</th></tr></thead>'        + '<tbody id="rw2SamplesBody"></tbody></table>'      + '</div>'      + '<div><label class="form-label">Final Post-Rework Inspection Notes *</label>'        + '<textarea class="form-control" id="qcNotesRework2" rows="3" placeholder="Describe final rework quality findings..."></textarea></div>'      + '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">'        + '<button class="btn btn-primary" onclick="submitFinalReworkQC()">Submit Final Re-QC Result →</button>'      + '</div>'      + '</div>';

  } else if (pr.phase === 'deviation_approval') {
    var devTarget = allPMsAndDirector.find(function(u){ return u.id === pr.deviation_target_id; });
    var devTargetName = devTarget ? devTarget.name + ' (' + (devTarget.role === 'director' ? 'Director' : 'Project Manager') + ')' : 'Recipient';
    var devReason = (pr.qc_criteria && pr.qc_criteria.deviation_reason) ? pr.qc_criteria.deviation_reason : 'No reason recorded.';
    actionSection = '<div style="padding:14px;border:1px solid rgba(124,58,237,0.25);border-radius:var(--radius);background:rgba(124,58,237,0.04)">'
      + '<div style="font-weight:700;color:#7c3aed;margin-bottom:6px">↗ Request Deviated — Pending Review by ' + devTargetName + '</div>'
      + '<div style="padding:8px 12px;background:rgba(124,58,237,0.07);border:1px solid rgba(124,58,237,0.15);border-radius:var(--radius-sm);font-size:0.82rem;margin-bottom:8px"><strong>Deviation reason:</strong> ' + devReason + '</div>'
      + '<p style="font-size:0.78rem;color:var(--gray-4);margin:0">Awaiting the recipient\'s decision. No further action required from QC at this stage.</p>'
      + '</div>';

  } else if (pr.phase === 'qc_passed' || pr.phase === 'accepted') {
    actionSection = '<div class="action-section" style="background:rgba(22,163,74,0.04);border:1px solid rgba(22,163,74,0.2);border-radius:var(--radius);padding:14px">'
      + '<div class="action-section-title" style="color:#16a34a">✅ QC Passed</div>'
      + (pr.qc_notes ? '<p style="font-size:0.82rem;color:var(--gray-3)">' + pr.qc_notes + '</p>' : '')
      + '</div>';

  } else if (pr.phase === 'qc_rejected') {
    var rejDetails = (pr.qc_criteria && pr.qc_criteria.rejection_details) ? pr.qc_criteria.rejection_details : [];
    var rejRows = rejDetails.length
      ? '<div style="overflow-x:auto;margin-top:10px"><table class="grn-table" style="font-size:0.78rem">'
        + '<thead><tr><th>Item</th><th>Received</th><th>Rejected</th><th>Accepted</th></tr></thead>'
        + '<tbody>' + rejDetails.map(function(d) {
            return '<tr>'
              + '<td>' + (d.item_name || '—') + '</td>'
              + '<td style="text-align:center">' + (d.received || 0) + '</td>'
              + '<td style="text-align:center;color:#dc2626;font-weight:600">' + (d.rejected || 0) + '</td>'
              + '<td style="text-align:center;color:#16a34a;font-weight:600">' + (d.accepted || 0) + '</td>'
              + '</tr>';
          }).join('') + '</tbody></table></div>'
      : '';
    actionSection = '<div class="action-section" style="background:rgba(124,58,237,0.04);border:1px solid rgba(124,58,237,0.25);border-radius:var(--radius);padding:14px">'
      + '<div class="action-section-title" style="color:#7c3aed">🚫 QC Rejected</div>'
      + '<p style="font-size:0.82rem;color:var(--gray-3);margin:6px 0">' + (pr.qc_notes || '—') + '</p>'
      + (pr.qc_criteria && pr.qc_criteria.qc_inspector ? '<div style="font-size:0.75rem;color:var(--gray-4)">Inspected by: <strong>' + pr.qc_criteria.qc_inspector + '</strong></div>' : '')
      + rejRows
      + '</div>';

  } else if (pr.phase === 'rework_store_form') {
    // QC marked fail → store manager needs to fill dispatch form
    var sfJwcData = (pr.qc_criteria && pr.qc_criteria.jwc) ? pr.qc_criteria.jwc : {};
    actionSection = '<div class="action-section" style="background:rgba(245,158,11,0.04);border:1px solid rgba(245,158,11,0.25);border-radius:var(--radius);padding:14px">'
      + '<div class="action-section-title" style="color:#b45309">🔄 Rework — Awaiting Store Manager Dispatch Form</div>'
      + (sfJwcData.jwc_number
          ? '<div style="margin:10px 0;padding:10px 12px;background:var(--off-white);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.82rem">'
            + '<div style="font-weight:700;color:#b45309;margin-bottom:4px">📄 JWC Details (filled by QC)</div>'
            + '<div>JWC No: <strong>' + sfJwcData.jwc_number + '</strong></div>'
            + (sfJwcData.rework_vendor ? '<div>Rework Vendor: <strong>' + sfJwcData.rework_vendor + '</strong></div>' : '')
            + (sfJwcData.expected_days ? '<div>Expected Duration: <strong>' + sfJwcData.expected_days + ' days</strong></div>' : '')
            + (sfJwcData.notes ? '<div>Notes: ' + sfJwcData.notes + '</div>' : '')
            + '</div>'
          : '')
      + '<p style="font-size:0.82rem;color:var(--gray-3);margin:8px 0">QC has marked this for rework. The Store Manager is filling the dispatch form and will send goods out. This will move to <strong>Rework Pending</strong> once dispatched.</p>'
      + '<button class="btn btn-secondary btn-sm" onclick="previewJWC()">📄 View JWC</button>'
      + '</div>';

  } else if (pr.phase === 'rework_pending') {
    var jwcData = (pr.qc_criteria && pr.qc_criteria.jwc) ? pr.qc_criteria.jwc : {};
    actionSection = '<div class="action-section" style="background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius);padding:14px">'
      + '<div class="action-section-title" style="color:#dc2626">\uD83D\uDD04 Rework Out — JWC Raised — Awaiting Return</div>'
      + (jwcData.jwc_number
          ? '<div style="margin:10px 0;padding:10px 12px;background:var(--off-white);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.82rem">'
            + '<div style="font-weight:600;margin-bottom:4px">JWC Details</div>'
            + '<div>JWC No: <strong>' + jwcData.jwc_number + '</strong></div>'
            + '<div>Vendor: <strong>' + (jwcData.rework_vendor || '—') + '</strong></div>'
            + '<div>Expected Duration: <strong>' + (jwcData.expected_days || '—') + ' days</strong></div>'
            + (jwcData.notes ? '<div>Notes: ' + jwcData.notes + '</div>' : '')
            + '</div>'
          : '')
      + '<p style="font-size:0.82rem;color:var(--gray-3);margin:8px 0">Goods are out for rework. Once the Store Manager confirms goods are returned, this will appear in your Post-Rework QC queue.</p>'
      + '<button class="btn btn-secondary btn-sm" onclick="previewJWC()">\uD83D\uDCC4 View JWC</button>'
      + '</div>';

  } else if (pr.phase === 'rework_returned') {
    var jwcReworkData = (pr.qc_criteria && pr.qc_criteria.jwc) ? pr.qc_criteria.jwc : {};
    actionSection = '<div class="action-section">'
      + '<div class="action-section-title">🔄 Post-Rework QC Inspection <span class="action-badge">ACTION REQUIRED</span></div>'
      + grnSummary
      + (jwcReworkData.jwc_number
          ? '<div style="margin-bottom:14px;padding:10px 12px;background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-sm);font-size:0.82rem">'
            + '<div style="font-weight:700;color:#dc2626;margin-bottom:4px">📄 Rework History — JWC ' + jwcReworkData.jwc_number + '</div>'
            + '<div>Rework Vendor: <strong>' + (jwcReworkData.rework_vendor || '—') + '</strong></div>'
            + '<div>Process: <strong>' + (jwcReworkData.process || '—') + '</strong></div>'
            + (jwcReworkData.notes ? '<div>Rework Notes: ' + jwcReworkData.notes + '</div>' : '')
            + '<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="previewJWC()">📄 View JWC</button>'
            + '</div>'
          : '')
      + '<div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.3);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:14px;font-size:0.82rem">'
        + '<strong>⚠️ Goods returned from rework.</strong> Inspect the reworked items — pass if they now meet specs, or reject if still defective.'
      + '</div>'
      + '<div class="qc-result-row" style="grid-template-columns:1fr 1fr;max-width:480px">'
        + '<div class="qc-option pass" id="rwOptPass" onclick="selectReworkQC(\'pass\')">'
          + '<div class="qc-icon">✅</div><div class="qc-label">QC Passed</div>'
          + '<div class="qc-desc">Rework accepted — meets specs</div></div>'
        + '<div class="qc-option reject" id="rwOptReject" onclick="selectReworkQC(\'reject\')">'
          + '<div class="qc-icon">🚫</div><div class="qc-label">QC Rejected</div>'
          + '<div class="qc-desc">Still defective — outright rejection</div></div>'
      + '</div>'
      + '<div id="rwSamplesSection" style="display:none" class="samples-section">'
        + '<div style="font-size:0.84rem;font-weight:700;color:var(--gray-2);margin-bottom:6px">📦 Sample Rejection Quantities</div>'
        + '<div style="font-size:0.76rem;color:var(--gray-3);margin-bottom:8px">Enter the number of reworked samples still being rejected.</div>'
        + '<div style="overflow-x:auto"><table class="samples-table">'
          + '<thead><tr><th>#</th><th style="text-align:left">Item</th><th>Received</th><th>Rejected Qty</th><th>Accepted (auto)</th></tr></thead>'
          + '<tbody id="rwSamplesBody"></tbody>'
        + '</table></div>'
      + '</div>'
      + '<div style="margin:10px 0"><label class="form-label">Re-QC Attachments <span style="font-size:0.72rem;color:var(--gray-4);font-weight:400">(photos, reports — optional)</span></label>'        + '<div style="border:2px dashed var(--border);border-radius:var(--radius-sm);padding:10px;text-align:center;cursor:pointer;background:rgba(99,102,241,0.02)" onclick="document.getElementById(\'reQcAttachFile\').click()">'        + '<input type="file" id="reQcAttachFile" accept="image/*,.pdf" multiple style="display:none" onchange="handleReQCAttach(event)"/>'        + '<div style="font-size:0.78rem;font-weight:600">📎 Click to attach Re-QC photos / reports</div>'        + '</div><div id="reQcAttachList" style="margin-top:6px"></div></div>'
      + '<div><label class="form-label">Post-Rework Inspection Notes *</label>'
        + '<textarea class="form-control" id="qcNotesRework" rows="3" placeholder="Describe rework quality findings — measurements checked, defects resolved, overall condition…"></textarea></div>'
      + '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">'
        + '<button class="btn btn-primary" id="btnSubmitRework" onclick="submitPostReworkQC()">Submit Post-Rework Result →</button>'
      + '</div>'
      + '</div>';
  }

  document.getElementById('modalTitle').innerHTML = prNum + ' — ' + pr.project_name + ' ' + getPhaseBadge(pr.phase);
  document.getElementById('modalBody').innerHTML  =
    buildPRDetailHTML(pr)
    + actionSection
    + '<div style="margin-top:18px">'
      + '<div style="font-size:0.8rem;font-weight:600;color:var(--gray-3);margin-bottom:8px">Comments</div>'
      + '<div id="commentsList" style="margin-bottom:10px"></div>'
      + '<div style="display:flex;gap:8px">'
        + '<input class="form-control" id="commentInput" placeholder="Add a comment…" style="flex:1;font-size:0.82rem"/>'
        + '<button class="btn btn-secondary btn-sm" onclick="addComment()">Send</button>'
      + '</div>'
    + '</div>';

  loadComments(pr.id).then(function(c) {
    var el = document.getElementById('commentsList');
    if (el) el.innerHTML = renderComments(c);
  });

  if (pr.phase === 'qc_pending') populateJWCItems();
}

// ─── QC option selection ──────────────────────────────────────────────────────
window.selectQC = function selectQC(choice) {
  qcSelection = choice;
  var opts = { pass: 'optPass', fail: 'optFail', reject: 'optReject', deviate: 'optDeviate' };
  Object.keys(opts).forEach(function(k) {
    var el = document.getElementById(opts[k]);
    if (el) {
      el.classList.toggle('selected', k === choice);
      // Style deviate option distinctly when selected
      if (k === 'deviate') {
        el.style.borderColor = choice === 'deviate' ? '#7c3aed' : '';
        el.style.background  = choice === 'deviate' ? 'rgba(124,58,237,0.06)' : '';
      }
    }
  });
  var samplesSection = document.getElementById('samplesSection');
  var jwcSec         = document.getElementById('jwcFormSection');
  var deviationSec   = document.getElementById('deviationSection');
  if (samplesSection) {
    samplesSection.style.display = (choice === 'fail' || choice === 'reject') ? 'block' : 'none';
    if (choice === 'fail' || choice === 'reject') populateSamplesTable();
  }
  if (jwcSec) jwcSec.style.display = choice === 'fail' ? 'block' : 'none';
  if (deviationSec) deviationSec.style.display = choice === 'deviate' ? 'block' : 'none';
  if (choice === 'fail') syncJWCFromSamples();
};

window.onDeviationTargetChange = function onDeviationTargetChange() {
  deviationTargetId = document.getElementById('deviationTargetSelect')?.value || null;
};

// ─── Populate sample rejection table ─────────────────────────────────────────
function getSourceLines() {
  var grn           = (currentPR && currentPR.qc_criteria && currentPR.qc_criteria.grn) ? currentPR.qc_criteria.grn : {};
  var lines         = grn.lines || [];
  var rejectedLines = lines.filter(function(l){ return l.rejected > 0; });
  return rejectedLines.length ? rejectedLines : (currentPR.parts || []);
}

function populateSamplesTable() {
  var sourceLines = getSourceLines();
  var grn         = (currentPR && currentPR.qc_criteria && currentPR.qc_criteria.grn) ? currentPR.qc_criteria.grn : {};
  var hasGRN      = !!(grn.lines && grn.lines.length);
  var tbody       = document.getElementById('samplesBody');
  if (!tbody) return;

  tbody.innerHTML = sourceLines.map(function(l, i) {
    var name     = l.item_name || l.name || '—';
    var received = hasGRN ? (l.received || l.qty || 0) : (l.qty || 0);
    var defRej   = hasGRN ? (l.rejected || 0) : 0;
    var defAcc   = received - defRej;
    return '<tr>'
      + '<td style="text-align:center">' + (i + 1) + '</td>'
      + '<td>' + name + '</td>'
      + '<td style="text-align:center">' + received + '</td>'
      + '<td style="text-align:center"><input class="form-control" type="number" id="smpRej_' + i + '"'
        + ' value="' + defRej + '" min="0" max="' + received + '"'
        + ' style="width:70px;font-size:0.8rem;text-align:center"'
        + ' oninput="onSampleRejChange(' + i + ',' + received + ')" /></td>'
      + '<td id="smpAcc_' + i + '" style="text-align:center;font-weight:600;color:#16a34a">' + defAcc + '</td>'
      + '</tr>';
  }).join('');
}

window.onSampleRejChange = function onSampleRejChange(i, received) {
  var rejEl = document.getElementById('smpRej_' + i);
  var accEl = document.getElementById('smpAcc_' + i);
  if (!rejEl || !accEl) return;
  var rej = Math.min(Math.max(parseInt(rejEl.value || '0', 10) || 0, 0), received);
  rejEl.value = rej;
  accEl.textContent = received - rej;
  accEl.style.color = (received - rej) > 0 ? '#16a34a' : '#dc2626';
  if (qcSelection === 'fail') syncJWCFromSamples();
};

// ─── Read sample rejection inputs ─────────────────────────────────────────────
function readSampleRejections() {
  var sourceLines = getSourceLines();
  var grn         = (currentPR && currentPR.qc_criteria && currentPR.qc_criteria.grn) ? currentPR.qc_criteria.grn : {};
  var hasGRN      = !!(grn.lines && grn.lines.length);
  return sourceLines.map(function(l, i) {
    var rejEl    = document.getElementById('smpRej_' + i);
    var received = hasGRN ? (l.received || l.qty || 0) : (l.qty || 0);
    var rej      = rejEl ? (parseInt(rejEl.value || '0', 10) || 0) : (hasGRN ? (l.rejected || 0) : 0);
    return {
      item_name: l.item_name || l.name || '—',
      received:  received,
      rejected:  rej,
      accepted:  received - rej
    };
  });
}

// ─── Sync JWC items table from samples table ───────────────────────────────────
function syncJWCFromSamples() {
  var rejections  = readSampleRejections();
  var rejOnly     = rejections.filter(function(r){ return r.rejected > 0; });
  var sourceLines = rejOnly.length ? rejOnly : rejections;
  var tbody       = document.getElementById('jwcItemsBody');
  if (!tbody) return;

  // preserve existing rate values if rows already exist
  var prevRates = {};
  sourceLines.forEach(function(_, i) {
    var el = document.getElementById('jwcRate_' + i);
    if (el) prevRates[i] = el.value;
  });

  tbody.innerHTML = sourceLines.map(function(l, i) {
    var qty  = l.rejected || 1;
    var rate = prevRates[i] || '';
    return '<tr>'
      + '<td style="text-align:center">' + (i + 1) + '</td>'
      + '<td>' + l.item_name + '</td>'
      + '<td><input class="form-control" type="number" id="jwcQty_' + i + '" value="' + qty + '" style="font-size:0.8rem;width:70px"/></td>'
      + '<td><input class="form-control" type="number" id="jwcRate_' + i + '" placeholder="0" value="' + rate + '" style="font-size:0.8rem;width:80px" oninput="calcJWCRow(' + i + ')"/></td>'
      + '<td id="jwcVal_' + i + '" style="text-align:center;font-family:var(--font-mono)">—</td>'
      + '</tr>';
  }).join('');
}

// ─── Populate JWC items (initial load for qc_pending) ────────────────────────
function populateJWCItems() {
  syncJWCFromSamples();
}

window.calcJWCRow = function calcJWCRow(i) {
  var qtyEl  = document.getElementById('jwcQty_'  + i);
  var rateEl = document.getElementById('jwcRate_' + i);
  var valEl  = document.getElementById('jwcVal_'  + i);
  if (!qtyEl || !rateEl || !valEl) return;
  var qty  = parseFloat(qtyEl.value  || '0') || 0;
  var rate = parseFloat(rateEl.value || '0') || 0;
  valEl.textContent = (qty && rate) ? (qty * rate).toLocaleString('en-IN') : '—';
};

// ─── Submit QC ────────────────────────────────────────────────────────────────
window.submitQC = async function submitQC() {
  if (!qcSelection) { showToast('Please select Pass, Fail, Reject, or Deviate', 'error'); return; }

  // Handle deviation separately
  if (qcSelection === 'deviate') {
    var devTarget = document.getElementById('deviationTargetSelect')?.value;
    var devReason = document.getElementById('deviationReason')?.value?.trim();
    if (!devTarget) { showToast('Please select who to deviate to', 'error'); return; }
    if (!devReason) { showToast('Please provide a deviation reason', 'error'); return; }
    showLoader(true);
    var devAttachments = qcAttachments.slice();
    var updatedCriteriaDev = Object.assign({}, currentPR.qc_criteria || {}, {
      qc_inspector: currentUser.name,
      qc_date: new Date().toISOString(),
      deviation_target_id: devTarget,
      deviation_reason: devReason,
      qc_attachments: devAttachments
    });
    var devResult = await db.from('procurement_requests').update({
      phase: 'deviation_approval',
      deviation_target_id: devTarget,
      qc_criteria: updatedCriteriaDev,
      updated_at: new Date().toISOString(),
      phase_timestamps: addPhaseTimestamp(currentPR, 'deviation_approval')
    }).eq('id', currentPR.id);
    showLoader(false);
    if (devResult.error) { showToast('Error: ' + devResult.error.message, 'error'); return; }
    notifyPhaseChange(currentPR.id, 'deviation_approval', currentUser.id);
    var devTargetUser = allPMsAndDirector.find(function(u){ return u.id === devTarget; });
    await window.postComment(currentPR.id, currentUser.id, '↗ QC Inspector deviated this request to ' + (devTargetUser ? devTargetUser.name : 'recipient') + '. Reason: ' + devReason);
    showToast('Request deviated successfully. Recipient has been notified.', 'success');
    closeModal('prModal'); await loadRequests();
    return;
  }

  var notesEl = document.getElementById('qcNotes');
  var notes   = notesEl ? notesEl.value.trim() : '';
  if (!notes) { showToast('Please add inspection notes', 'error'); return; }

  var isPassed   = qcSelection === 'pass';
  var isRejected = qcSelection === 'reject';   // outright reject (no rework)
  var isFail     = qcSelection === 'fail';     // fail → rework JWC
  var jwcData    = null;

  // ── Collect per-item rejection details (fail or reject) ──────────────────
  var rejectionDetails = [];
  if (isFail || isRejected) {
    rejectionDetails = readSampleRejections();
    var totalRej = rejectionDetails.reduce(function(s, r){ return s + r.rejected; }, 0);
    if (totalRej === 0) {
      showToast('No samples marked as rejected — please enter rejection quantities', 'error');
      return;
    }
  }

  // ── JWC data (fail only) ──────────────────────────────────────────────────
  if (isFail) {
    var jwcNumberEl = document.getElementById('jwcNumber');
    var jwcNumber   = jwcNumberEl ? jwcNumberEl.value.trim() : '';
    if (!jwcNumber) { showToast('Please enter JWC Number', 'error'); return; }

    var jwcItems = rejectionDetails.filter(function(r){ return r.rejected > 0; }).map(function(l, i) {
      var qtyEl  = document.getElementById('jwcQty_'  + i);
      var rateEl = document.getElementById('jwcRate_' + i);
      var qty    = parseInt((qtyEl  ? qtyEl.value  : String(l.rejected)), 10) || l.rejected;
      var rate   = parseFloat(rateEl ? rateEl.value : '0') || 0;
      return {
        sr:          i + 1,
        description: l.item_name,
        qty:         qty,
        rate:        rate,
        value:       qty * rate
      };
    });

    var jwcDateEl    = document.getElementById('jwcDate');
    var jwcDaysEl    = document.getElementById('jwcDays');
    var jwcVendorEl  = document.getElementById('jwcVendor');
    var jwcVehicleEl = document.getElementById('jwcVehicle');
    var jwcProcessEl = document.getElementById('jwcProcess');
    var jwcNotesEl   = document.getElementById('jwcNotes');

    jwcData = {
      jwc_number:    jwcNumber,
      jwc_date:      jwcDateEl    ? jwcDateEl.value             : new Date().toISOString().split('T')[0],
      expected_days: jwcDaysEl    ? jwcDaysEl.value             : '15',
      rework_vendor: jwcVendorEl  ? jwcVendorEl.value.trim()   : '',
      vehicle_no:    jwcVehicleEl ? jwcVehicleEl.value.trim()  : '',
      process:       jwcProcessEl ? jwcProcessEl.value.trim()  : 'For Re-work',
      notes:         jwcNotesEl   ? jwcNotesEl.value.trim()    : '',
      items:         jwcItems
    };
  }

  showLoader(true);
  var newPhase = isPassed ? 'qc_passed' : isFail ? 'rework_store_form' : 'qc_rejected';
  var qcResult = isPassed ? 'accepted'  : isFail ? 'rejected'       : 'rejected';

  var updatedCriteria = Object.assign({}, currentPR.qc_criteria || {}, {
    qc_inspector: currentUser.name,
    qc_date:      new Date().toISOString(),
    qc_attachments: qcAttachments.slice()  // Change 7: save QC attachments
  });
  if (jwcData)               updatedCriteria.jwc               = jwcData;
  if (rejectionDetails.length) updatedCriteria.rejection_details = rejectionDetails;

  var updateResult = await db.from('procurement_requests').update({
    phase:            newPhase,
    is_closed:        newPhase === 'qc_rejected',
    qc_result:        qcResult,
    qc_notes:         notes,
    qc_criteria:      updatedCriteria,
    updated_at:       new Date().toISOString(),
    phase_timestamps: addPhaseTimestamp(currentPR, newPhase)
  }).eq('id', currentPR.id);

  showLoader(false);
  if (updateResult.error) { showToast('Error: ' + updateResult.error.message, 'error'); return; }

  notifyPhaseChange(currentPR.id, newPhase, currentUser.id);

  var commentText = isPassed
    ? '✅ QC Passed — ' + notes
    : isFail
      ? '❌ QC Failed — Rework noted. Store Manager will fill dispatch form and send goods out.' + (jwcData ? ' JWC: ' + jwcData.jwc_number : '') + ' Notes: ' + notes
      : '🚫 QC Rejected — ' + notes;
  await window.postComment(currentPR.id, currentUser.id, commentText);

  showToast(
    isPassed
      ? '✅ QC Passed — Procurement & Requestor notified!'
      : isFail
        ? '❌ QC Failed — Store Manager notified to dispatch for rework!'
        : '🚫 QC Rejected — Procurement & Requestor notified!',
    'success'
  );

  if (isFail && jwcData) {
    currentPR = Object.assign({}, currentPR, { qc_criteria: updatedCriteria, phase: 'rework_store_form' });
    setTimeout(function(){ previewJWC(); }, 400);
  }

  qcAttachments = [];
  closeModal('prModal');
  await loadRequests();
};

// ─── Post-Rework QC option selection ─────────────────────────────────────────
var reworkQCSelection = null;

window.selectReworkQC = function selectReworkQC(choice) {
  reworkQCSelection = choice;
  var passEl    = document.getElementById('rwOptPass');
  var rejectEl  = document.getElementById('rwOptReject');
  var samplesEl = document.getElementById('rwSamplesSection');
  if (passEl)   passEl.classList.toggle('selected',   choice === 'pass');
  if (rejectEl) rejectEl.classList.toggle('selected', choice === 'reject');
  if (samplesEl) {
    samplesEl.style.display = choice === 'reject' ? 'block' : 'none';
    if (choice === 'reject') populateReworkSamplesTable();
  }
};

function populateReworkSamplesTable() {
  var grn      = (currentPR && currentPR.qc_criteria && currentPR.qc_criteria.grn) ? currentPR.qc_criteria.grn : {};
  var lines    = grn.lines || [];
  var hasGRN   = lines.length > 0;
  var srcLines = hasGRN ? lines : (currentPR.parts || []);
  var tbody    = document.getElementById('rwSamplesBody');
  if (!tbody) return;

  tbody.innerHTML = srcLines.map(function(l, i) {
    var name     = l.item_name || l.name || '—';
    var received = hasGRN ? (l.received || l.qty || 0) : (l.qty || 0);
    var defRej   = hasGRN ? (l.rejected || 0) : 0;
    return '<tr>'
      + '<td style="text-align:center">' + (i + 1) + '</td>'
      + '<td>' + name + '</td>'
      + '<td style="text-align:center">' + received + '</td>'
      + '<td style="text-align:center"><input class="form-control" type="number" id="rwRej_' + i + '"'
        + ' value="' + defRej + '" min="0" max="' + received + '"'
        + ' style="width:70px;font-size:0.8rem;text-align:center"'
        + ' oninput="onReworkSampleChange(' + i + ',' + received + ')" /></td>'
      + '<td id="rwAcc_' + i + '" style="text-align:center;font-weight:600;color:#16a34a">' + (received - defRej) + '</td>'
      + '</tr>';
  }).join('');
}

window.onReworkSampleChange = function onReworkSampleChange(i, received) {
  var rejEl = document.getElementById('rwRej_' + i);
  var accEl = document.getElementById('rwAcc_' + i);
  if (!rejEl || !accEl) return;
  var rej = Math.min(Math.max(parseInt(rejEl.value || '0', 10) || 0, 0), received);
  rejEl.value = rej;
  accEl.textContent = received - rej;
  accEl.style.color = (received - rej) > 0 ? '#16a34a' : '#dc2626';
};

function readReworkSampleRejections() {
  var grn      = (currentPR && currentPR.qc_criteria && currentPR.qc_criteria.grn) ? currentPR.qc_criteria.grn : {};
  var lines    = grn.lines || [];
  var hasGRN   = lines.length > 0;
  var srcLines = hasGRN ? lines : (currentPR.parts || []);
  return srcLines.map(function(l, i) {
    var rejEl    = document.getElementById('rwRej_' + i);
    var received = hasGRN ? (l.received || l.qty || 0) : (l.qty || 0);
    var rej      = rejEl ? (parseInt(rejEl.value || '0', 10) || 0) : 0;
    return { item_name: l.item_name || l.name || '—', received: received, rejected: rej, accepted: received - rej };
  });
}

// ─── Submit Post-Rework QC (pass or reject) ───────────────────────────────────
window.submitPostReworkQC = async function submitPostReworkQC() {
  if (!reworkQCSelection) { showToast('Please select Pass or Reject', 'error'); return; }

  var notesEl = document.getElementById('qcNotesRework');
  var notes   = notesEl ? notesEl.value.trim() : '';
  if (!notes) { showToast('Please add post-rework inspection notes', 'error'); return; }

  var isPassed = reworkQCSelection === 'pass';
  var rejectionDetails = [];

  if (!isPassed) {
    rejectionDetails = readReworkSampleRejections();
    var totalRej = rejectionDetails.reduce(function(s, r){ return s + r.rejected; }, 0);
    if (totalRej === 0) {
      showToast('No samples marked as rejected — please enter rejection quantities', 'error');
      return;
    }
  }

  // Change 7: After 1st rework fails QC, go to rework2_pending (2nd rework cycle) instead of qc_rejected
  showLoader(true);
  var newPhase;
  var qcResult;
  if (isPassed) {
    newPhase = 'qc_passed';
    qcResult = 'qc_passed';
  } else {
    // First rework failed — allow one more rework cycle
    newPhase = 'rework2_pending';
    qcResult = 'rejected';
  }

  var reQcAttachments = [];
  var reQcInput = document.getElementById('reQcAttachFile');
  // attachments already collected in reQcAttachFiles array (global)
  reQcAttachments = window._reQcAttachFiles || [];

  var updatedCriteria = Object.assign({}, currentPR.qc_criteria || {}, {
    post_rework_qc_inspector: currentUser.name,
    post_rework_qc_date:      new Date().toISOString(),
    post_rework_notes:        notes,
    re_qc_attachments:        reQcAttachments
  });
  if (rejectionDetails.length) updatedCriteria.post_rework_rejection_details = rejectionDetails;

  // If heading to rework2, generate a new JWC slot
  if (!isPassed) {
    // JWC for 2nd rework will be raised by QC inspector via rework2_pending flow
    // Copy original JWC data as jwc1 for history
    if (updatedCriteria.jwc) updatedCriteria.jwc1 = updatedCriteria.jwc;
  }

  var updateResult = await db.from('procurement_requests').update({
    phase:            newPhase,
    is_closed:        newPhase === 'qc_rejected',
    qc_result:        qcResult,
    qc_notes:         notes,
    qc_criteria:      updatedCriteria,
    updated_at:       new Date().toISOString(),
    phase_timestamps: addPhaseTimestamp(currentPR, newPhase)
  }).eq('id', currentPR.id);

  showLoader(false);
  if (updateResult.error) { showToast('Error: ' + updateResult.error.message, 'error'); return; }

  window._reQcAttachFiles = [];
  notifyPhaseChange(currentPR.id, newPhase, currentUser.id);
  var commentText = isPassed
    ? '✅ Post-Rework QC Passed — ' + notes
    : '🔄 Post-Rework QC Failed — sending for 2nd rework cycle. ' + notes;
  await window.postComment(currentPR.id, currentUser.id, commentText);
  showToast(
    isPassed
      ? '✅ Post-Rework QC Passed — Procurement Manager notified!'
      : '🔄 2nd Rework cycle initiated — Store Manager notified!',
    'success'
  );
  closeModal('prModal');
  await loadRequests();
};

// ─── JWC Preview ──────────────────────────────────────────────────────────────
window.previewJWC = function previewJWC() {
  var jwc = currentPR && currentPR.qc_criteria ? currentPR.qc_criteria.jwc : null;
  if (!jwc) { showToast('No JWC data found', 'error'); return; }

  var pr       = currentPR;
  var prNum    = 'PR-' + String(pr.request_number).padStart(4,'0');
  var items    = jwc.items || [];
  var totalQty = items.reduce(function(s,i){ return s + (i.qty   || 0); }, 0);
  var totalVal = items.reduce(function(s,i){ return s + (i.value || 0); }, 0);

  var itemRows = items.map(function(it, i) {
    return '<tr>'
      + '<td style="text-align:center">'  + (i + 1) + '</td>'
      + '<td>'                            + (it.description || '—') + '</td>'
      + '<td style="text-align:center">'  + (it.qty   || 0) + '</td>'
      + '<td style="text-align:right">'   + (it.rate  ? it.rate.toLocaleString('en-IN')  : '—') + '</td>'
      + '<td style="text-align:right">'   + (it.value ? it.value.toLocaleString('en-IN') : '—') + '</td>'
      + '</tr>';
  }).join('');

  var inRows = items.map(function(it) {
    return '<tr>'
      + '<td>' + (it.description || '—') + ' (reworked)</td>'
      + '<td style="text-align:center">' + (it.qty   || 0) + '</td>'
      + '<td style="text-align:right">'  + (it.value ? it.value.toLocaleString('en-IN') : '—') + '</td>'
      + '</tr>';
  }).join('');

  document.getElementById('jwcPreviewBody').innerHTML =
    '<div class="jwc-preview" id="jwcPrintArea">'
      + '<div style="text-align:right;font-size:0.72rem;color:#555;margin-bottom:4px">Original / Duplicate / Triplicate</div>'
      + '<div class="jwc-preview-header">'
        + '<div>'
          + '<div style="font-size:1rem;font-weight:800">On2cook India Pvt. Ltd.</div>'
          + '<div style="font-size:0.72rem;color:#555">Crest house 3, Adani inspire business park, Adani shanti gram,</div>'
          + '<div style="font-size:0.72rem;color:#555">Vaishnodevi circle, Gandhinagar, Gujarat, India - 382421</div>'
        + '</div>'
        + '<div style="text-align:right;font-size:0.72rem">'
          + '<div><strong>GST NO:</strong> 24AADCO8527A1ZR</div>'
          + '<div><strong>STATE CODE/NAME:</strong> 24 - GUJARAT</div>'
        + '</div>'
      + '</div>'
      + '<div class="jwc-preview-title">RETURNABLE JOB WORK CHALLAN</div>'
      + '<table class="jwc-preview-table" style="margin-bottom:10px">'
        + '<tr>'
          + '<td style="width:50%"><strong>Issued To:</strong><br>' + (jwc.rework_vendor || '—') + '</td>'
          + '<td>'
            + '<strong>Issue Date:</strong> '   + (jwc.jwc_date      || '—') + '<br>'
            + '<strong>Challan No.:</strong> '  + (jwc.jwc_number    || '—') + '<br>'
            + '<strong>From Department:</strong> Store<br>'
            + '<strong>P.O #:</strong> '        + prNum + ' — ' + pr.project_name
          + '</td>'
        + '</tr>'
        + '<tr>'
          + '<td><strong>Nature of Process:</strong> ' + (jwc.process || 'For Re-work') + '</td>'
          + '<td>'
            + '<strong>For Process:</strong> '           + (jwc.process        || 'For Re-work') + '<br>'
            + '<strong>Expected Duration:</strong> '     + (jwc.expected_days  || '—') + ' Days<br>'
            + '<strong>Vehicle No.:</strong> '           + (jwc.vehicle_no     || '—')
          + '</td>'
        + '</tr>'
      + '</table>'
      + '<div class="jwc-preview-title">(continued)</div>'
      + '<table class="jwc-preview-table">'
        + '<thead><tr>'
          + '<th style="width:5%">Sr.</th><th>Description of Goods</th>'
          + '<th style="width:12%">Issued Qty.</th><th style="width:15%">Unit Rate</th><th style="width:15%">Est. Value</th>'
        + '</tr></thead>'
        + '<tbody>'
          + itemRows
          + '<tr style="font-weight:700;background:#f5f5f5">'
            + '<td colspan="2" style="text-align:right">Total Qty. Issued</td>'
            + '<td style="text-align:center">' + totalQty + '</td>'
            + '<td></td>'
            + '<td style="text-align:right">' + totalVal.toLocaleString('en-IN') + '</td>'
          + '</tr>'
        + '</tbody>'
      + '</table>'
      + '<div style="font-weight:700;margin:10px 0 4px;font-size:0.8rem;background:#eee;padding:5px 7px;border:1px solid #aaa">Goods In Details</div>'
      + '<table class="jwc-preview-table">'
        + '<thead><tr><th>Description of Goods (to receive)</th><th style="width:15%">Qty to Receive</th><th style="width:15%">Amount</th></tr></thead>'
        + '<tbody>' + inRows + '</tbody>'
      + '</table>'
      + (jwc.notes ? '<div style="margin-top:10px;font-size:0.78rem"><strong>Remarks:</strong> ' + jwc.notes + '</div>' : '')
      + '<div class="jwc-sig-row">'
        + '<div class="jwc-sig-box">'
          + '<div class="jwc-sig-label">Approved / Checked By</div>'
          + '<div style="border-top:1px solid #aaa;padding-top:4px;font-size:0.7rem;color:#555">' + (currentUser ? currentUser.name : 'QC Inspector') + '</div>'
        + '</div>'
        + '<div class="jwc-sig-box">'
          + '<div class="jwc-sig-label">Issued By</div>'
          + '<div style="border-top:1px solid #aaa;padding-top:4px;font-size:0.7rem;color:#555">Store Manager</div>'
        + '</div>'
        + '<div class="jwc-sig-box">'
          + '<div class="jwc-sig-label">Received By</div>'
          + '<div style="border-top:1px solid #aaa;padding-top:4px;font-size:0.7rem;color:#555">&nbsp;</div>'
        + '</div>'
        + '<div class="jwc-sig-box">'
          + '<div class="jwc-sig-label">Authorised Signatory</div>'
          + '<div class="jwc-stamp"><div class="jwc-stamp-inner">AUTHORISED</div></div>'
          + '<div style="border-top:1px solid #aaa;padding-top:4px;font-size:0.7rem;color:#555;margin-top:4px">&nbsp;</div>'
        + '</div>'
      + '</div>'
      + '<div style="text-align:center;font-size:0.7rem;color:#888;margin-top:14px;border-top:1px solid #ddd;padding-top:8px">This is a computer generated copy — ProcureX | On2Cook India Pvt. Ltd.</div>'
    + '</div>';

  closeModal('prModal');
  openModal('jwcModal');
};

// ─── Print JWC ────────────────────────────────────────────────────────────────
window.printJWC = function printJWC() {
  var printArea = document.getElementById('jwcPrintArea');
  if (!printArea) return;
  var content = printArea.innerHTML;

  var w = window.open('', '_blank');
  if (!w) { showToast('Unable to open print window', 'error'); return; }

  var html = '<!DOCTYPE html><html><head><title>JWC</title>'
    + '<style>'
      + 'body{font-family:Arial,sans-serif;font-size:11px;margin:20px;color:#000}'
      + 'table{width:100%;border-collapse:collapse}'
      + 'th,td{border:1px solid #888;padding:5px 7px;font-size:11px}'
      + 'th{background:#eee;font-weight:700;text-align:center}'
      + '.jwc-preview-title{text-align:center;font-weight:800;font-size:14px;letter-spacing:1px;text-transform:uppercase;margin:8px 0}'
      + '.jwc-preview-header{display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:8px}'
      + '.jwc-sig-row{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:20px;border-top:1px solid #aaa;padding-top:12px}'
      + '.jwc-sig-box{text-align:center}'
      + '.jwc-sig-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#555;margin-bottom:30px}'
      + '.jwc-stamp{width:70px;height:70px;border:2.5px solid #0038a8;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;margin:4px auto;position:relative;font-size:6px;color:#0038a8;font-weight:700;text-align:center;padding:4px}'
      + '.jwc-stamp::before{content:"ON2COOK INDIA PVT. LTD.";position:absolute;top:6px;font-size:5.5px;letter-spacing:0.5px;font-weight:800}'
      + '.jwc-stamp::after{content:"STORE DEPT.";position:absolute;bottom:6px;font-size:5.5px;letter-spacing:0.5px}'
      + '.jwc-stamp-inner{font-size:7px;font-weight:800;letter-spacing:0.5px;margin-top:10px}'
      + '@media print{body{margin:10px}}'
    + '</style></head><body>'
    + content
    + '</body></html>';

  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(function(){ w.print(); }, 500);
};

// ─── Comments ─────────────────────────────────────────────────────────────────
window.addComment = async function addComment() {
  var input = document.getElementById('commentInput');
  var text  = input ? input.value.trim() : '';
  if (!text || !currentPR) return;
  try {
    await postComment(currentPR.id, currentUser.id, text);
    input.value = '';
    var c  = await loadComments(currentPR.id);
    var el = document.getElementById('commentsList');
    if (el) el.innerHTML = renderComments(c);
  } catch(e) {
    showToast('Comment failed', 'error');
  }
};

// ─── Logout (page-level override, shared.js also defines this) ────────────────
window.logout = function logout() {
  Session.clear();
  window.location.href = '../index.html';
};

// ─── QC Attachment handlers ───────────────────────────────────────────────────
window._reQcAttachFiles = [];
window._finalReQcAttachFiles = [];

window.handleQCAttach = async function handleQCAttach(e) {
  for (var i = 0; i < e.target.files.length; i++) {
    var file = e.target.files[i];
    if (file.size > 5*1024*1024) { showToast(file.name + ' too large (max 5MB)', 'error'); continue; }
    var b64 = await fileToBase64(file);
    qcAttachments.push({ name: file.name, type: file.type, data: b64 });
  }
  e.target.value = '';
  renderQCAttachList();
};

function renderQCAttachList() {
  var el = document.getElementById('qcAttachList');
  if (!el) return;
  el.innerHTML = qcAttachments.map(function(f, i) {
    return '<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--off-white);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.75rem">'
      + (f.type.includes('image') ? '🖼️' : '📄') + ' <span style="flex:1">' + f.name + '</span>'
      + '<button onclick="removeQCAttach(' + i + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:0.75rem">✕</button></div>';
  }).join('');
}

window.removeQCAttach = function(i) { qcAttachments.splice(i, 1); renderQCAttachList(); };

window.handleReQCAttach = async function handleReQCAttach(e) {
  for (var i = 0; i < e.target.files.length; i++) {
    var file = e.target.files[i];
    if (file.size > 5*1024*1024) { showToast(file.name + ' too large', 'error'); continue; }
    var b64 = await fileToBase64(file);
    window._reQcAttachFiles.push({ name: file.name, type: file.type, data: b64 });
  }
  e.target.value = '';
  var el = document.getElementById('reQcAttachList');
  if (el) el.innerHTML = window._reQcAttachFiles.map(function(f, i) {
    return '<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--off-white);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.75rem">'
      + (f.type.includes('image') ? '🖼️' : '📄') + ' <span style="flex:1">' + f.name + '</span></div>';
  }).join('');
};

window.handleFinalReQCAttach = async function handleFinalReQCAttach(e) {
  for (var i = 0; i < e.target.files.length; i++) {
    var file = e.target.files[i];
    if (file.size > 5*1024*1024) { showToast(file.name + ' too large', 'error'); continue; }
    var b64 = await fileToBase64(file);
    window._finalReQcAttachFiles.push({ name: file.name, type: file.type, data: b64 });
  }
  e.target.value = '';
  var el = document.getElementById('finalReQcAttachList');
  if (el) el.innerHTML = window._finalReQcAttachFiles.map(function(f) {
    return '<div style="font-size:0.75rem;padding:2px 0">' + (f.type.includes('image') ? '🖼️' : '📄') + ' ' + f.name + '</div>';
  }).join('');
};

// ─── Rework2 QC option selection ──────────────────────────────────────────────
var rework2QCSelection = null;

window.selectRework2QC = function selectRework2QC(choice) {
  rework2QCSelection = choice;
  var passEl    = document.getElementById('rw2OptPass');
  var rejectEl  = document.getElementById('rw2OptReject');
  var samplesEl = document.getElementById('rw2SamplesSection');
  if (passEl)   passEl.classList.toggle('selected',   choice === 'pass');
  if (rejectEl) rejectEl.classList.toggle('selected', choice === 'reject');
  if (samplesEl) {
    samplesEl.style.display = choice === 'reject' ? 'block' : 'none';
    if (choice === 'reject') populateRework2SamplesTable();
  }
};

function populateRework2SamplesTable() {
  var grn      = (currentPR && currentPR.qc_criteria && currentPR.qc_criteria.grn) ? currentPR.qc_criteria.grn : {};
  var lines    = grn.lines || [];
  var hasGRN   = lines.length > 0;
  var srcLines = hasGRN ? lines : (currentPR.parts || []);
  var tbody    = document.getElementById('rw2SamplesBody');
  if (!tbody) return;
  tbody.innerHTML = srcLines.map(function(l, i) {
    var name     = l.item_name || l.name || '—';
    var received = hasGRN ? (l.received || l.qty || 0) : (l.qty || 0);
    return '<tr><td style="text-align:center">' + (i + 1) + '</td><td>' + name + '</td>'
      + '<td style="text-align:center">' + received + '</td>'
      + '<td style="text-align:center"><input class="form-control" type="number" id="rw2Rej_' + i + '"'
      + ' value="0" min="0" max="' + received + '" style="width:70px;font-size:0.8rem;text-align:center"'
      + ' oninput="onRw2SampleChange(' + i + ',' + received + ')"/></td>'
      + '<td id="rw2Acc_' + i + '" style="text-align:center;font-weight:600;color:#16a34a">' + received + '</td></tr>';
  }).join('');
}

window.onRw2SampleChange = function(i, received) {
  var rejEl = document.getElementById('rw2Rej_' + i);
  var accEl = document.getElementById('rw2Acc_' + i);
  if (!rejEl || !accEl) return;
  var rej = Math.min(Math.max(parseInt(rejEl.value||'0',10)||0, 0), received);
  rejEl.value = rej;
  accEl.textContent = received - rej;
  accEl.style.color = (received - rej) > 0 ? '#16a34a' : '#dc2626';
};

// ─── Submit Final Post-Rework QC (rework2_returned) ──────────────────────────
window.submitFinalReworkQC = async function submitFinalReworkQC() {
  if (!rework2QCSelection) { showToast('Please select Pass or Reject', 'error'); return; }
  var notes = document.getElementById('qcNotesRework2')?.value.trim();
  if (!notes) { showToast('Please add inspection notes', 'error'); return; }

  var isPassed = rework2QCSelection === 'pass';

  var finalAttachments = window._finalReQcAttachFiles || [];
  var updatedCriteria = Object.assign({}, currentPR.qc_criteria || {}, {
    final_rework_qc_inspector: currentUser.name,
    final_rework_qc_date:      new Date().toISOString(),
    final_rework_notes:        notes,
    final_rework_attachments:  finalAttachments
  });

  var newPhase = isPassed ? 'qc_passed' : 'qc_rejected';
  showLoader(true);
  var result = await db.from('procurement_requests').update({
    phase:            newPhase,
    is_closed:        !isPassed,
    qc_result:        isPassed ? 'qc_passed' : 'rejected',
    qc_notes:         notes,
    qc_criteria:      updatedCriteria,
    updated_at:       new Date().toISOString(),
    phase_timestamps: addPhaseTimestamp(currentPR, newPhase)
  }).eq('id', currentPR.id);
  showLoader(false);
  if (result.error) { showToast('Error: ' + result.error.message, 'error'); return; }
  window._finalReQcAttachFiles = [];
  rework2QCSelection = null;
  notifyPhaseChange(currentPR.id, newPhase, currentUser.id);
  await window.postComment(currentPR.id, currentUser.id,
    isPassed ? '✅ Final Post-Rework QC Passed — ' + notes : '🚫 Final Post-Rework QC Rejected (2nd rework cycle). ' + notes);
  showToast(isPassed ? '✅ Final QC Passed — Procurement Manager notified!' : '🚫 QC Rejected after 2nd rework.', 'success');
  closeModal('prModal');
  await loadRequests();
};

// ─── Deviation approval handling (for Project Manager / Director in deviation_approval phase) ──
// Note: This is handled in pm.html for Project Manager and master.html/director views.
// The QC page shows read-only status for deviation_approval phase.

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
