// ── UTILITY ───────────────────────────────────────────────────
function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ══════════════════════════════════════════════════════════════
// SAFE FILE REGISTRY — eliminates base64-in-HTML-attribute bugs
// All large file URLs are stored here; buttons reference by index only.
// ══════════════════════════════════════════════════════════════
const _fileRegistry = [];

// ── EMAIL NOTIFICATION HELPER ────────────────────────────────
async function notifyPhaseChange(prId, phase, triggerUserId) {
  try {
    await db.functions.invoke('notify-phase', {
      body: { pr_id: prId, phase: phase, trigger_user_id: triggerUserId }
    });
  } catch(e) {
    console.warn('Notification (non-blocking):', e.message);
  }
}

function _regFile(url, name) {
  // Reuse existing slot if same file already registered
  const existing = _fileRegistry.findIndex(f => f.url === url && f.name === name);
  if (existing !== -1) return existing;
  return _fileRegistry.push({url, name}) - 1;
}

function _safeDownload(url, fileName) {
  if (!url) return;
  if (url.startsWith('data:')) {
    try {
      const arr = url.split(','), mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]); let n = bstr.length; const u8 = new Uint8Array(n);
      while(n--) u8[n] = bstr.charCodeAt(n);
      const blob = new Blob([u8], {type: mime});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = fileName || 'file'; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch(e) { window.open(url, '_blank'); }
  } else {
    const a = document.createElement('a'); a.href = url; a.download = fileName || 'file';
    a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove();
  }
}

function _safePreview(url, name) {
  if (!url) return;
  // Use page-level preview if available (procurement/accounts pages inject attPreviewOverlay)
  if (typeof openAttPreview === 'function') { openAttPreview(url, name); return; }
  // Fallback: inline modal (for pages without the full preview engine)
  const isImg = /\.(png|jpe?g|gif|webp)$/i.test(name) || url.startsWith('data:image');
  const isPDF = /\.pdf$/i.test(name) || url.startsWith('data:application/pdf');

  // Browsers block base64 data URIs inside iframes (blank page / CSP violation).
  // Convert to a real Blob URL so the PDF viewer works.
  let pdfSrc = url;
  let blobUrlToRevoke = null;
  if (isPDF && url.startsWith('data:')) {
    try {
      const arr = url.split(','), mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]); let n = bstr.length; const u8 = new Uint8Array(n);
      while (n--) u8[n] = bstr.charCodeAt(n);
      pdfSrc = URL.createObjectURL(new Blob([u8], {type: mime}));
      blobUrlToRevoke = pdfSrc;
    } catch(e) { /* fall back to data URI */ }
  }

  const o = document.createElement('div');
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px';
  const inner = isImg
    ? `<div style="max-width:90vw;max-height:85vh;overflow:auto;border-radius:10px;background:white;padding:4px"><img src="${url}" style="max-width:100%;display:block;border-radius:8px" alt="${name}"/></div>`
    : isPDF
    ? `<div style="width:84vw;height:82vh;border-radius:10px;overflow:hidden;background:white"><iframe src="${pdfSrc}" style="width:100%;height:100%;border:none" title="${name}"></iframe></div>`
    : `<div style="padding:48px;background:white;border-radius:10px;text-align:center;color:#6b7280"><div style="font-size:3rem;margin-bottom:12px">📄</div><div style="font-weight:600">${name}</div><div style="font-size:0.8rem;margin-top:8px">Preview not available</div></div>`;
  o.innerHTML = inner + `<div style="display:flex;gap:10px;margin-top:14px">
    <button style="background:white;border:none;padding:8px 22px;border-radius:6px;font-weight:600;cursor:pointer" id="_previewDlBtn">⬇ Download</button>
    <button style="background:white;border:none;padding:8px 22px;border-radius:6px;font-weight:600;cursor:pointer" onclick="this.closest('[style*=fixed]').remove()">✕ Close</button>
  </div>`;
  // Wire download button via closure — avoids stale registry-index bug
  o.querySelector('#_previewDlBtn').addEventListener('click', () => _safeDownload(url, name));
  o.onclick = e => {
    if (e.target === o) {
      if (blobUrlToRevoke) URL.revokeObjectURL(blobUrlToRevoke);
      o.remove();
    }
  };
  // Revoke blob URL when Close button is clicked too
  o.querySelector('[onclick*="remove"]')?.addEventListener('click', () => {
    if (blobUrlToRevoke) URL.revokeObjectURL(blobUrlToRevoke);
  });
  document.body.appendChild(o);
}

function _downloadByIdx(i) { const f=_fileRegistry[i]; if(f) _safeDownload(f.url,f.name); }
function _previewByIdx(i)  { const f=_fileRegistry[i]; if(f) _safePreview(f.url,f.name); }
// ══════════════════════════════════════════════════════════════
// ── DOUBLE-LOAD GUARD ───────────────────────────────────────
if (!window._procureSharedLoaded) {
window._procureSharedLoaded = true;

// ── TOAST / LOADER / MODAL ──────────────────────────────────
function showToast(msg, type='info') {
  const c=document.getElementById('toast-container'); if(!c)return;
  const t=document.createElement('div'); t.className=`toast ${type}`;
  t.innerHTML=`<span>${{success:'✓',error:'✗',info:'ℹ'}[type]||'ℹ'}</span><span>${msg}</span>`;
  c.appendChild(t); setTimeout(()=>t.remove(),4000);
}
function showLoader(s){ const e=document.getElementById('loadingOverlay'); if(e)e.classList.toggle('active',s); }
function openModal(id){ const m=document.getElementById(id); if(m){m.classList.add('active');document.body.style.overflow='hidden';} }
function closeModal(id){ const m=document.getElementById(id); if(m){m.classList.remove('active');document.body.style.overflow='';} }

// ── CONSTANTS ────────────────────────────────────────────────
var CURRENCIES = typeof CURRENCIES !== 'undefined' ? CURRENCIES : ['USD','EUR','INR','RMB'];
var SOURCING_OPTIONS = typeof SOURCING_OPTIONS !== 'undefined' ? SOURCING_OPTIONS : [{value:'domestic',label:'🏠 Domestic'},{value:'international',label:'🌍 International'}];
var PAYMENT_TERMS_OPTIONS = typeof PAYMENT_TERMS_OPTIONS !== 'undefined' ? PAYMENT_TERMS_OPTIONS : [
  {value:'50_50',label:'50% Advance — 50% Post Delivery'},
  {value:'full_advance',label:'100% Full Advance'},
  {value:'full_on_delivery',label:'100% On Delivery'},
  {value:'30_70',label:'30% Advance — 70% Post Delivery'},
  {value:'no_advance',label:'No Advance (Net 30/60/90)'},
  {value:'custom',label:'Custom Terms'}
];
// Legacy phase compat: map old keys to new
const PHASE_LEGACY_MAP = {
  'advance_requested':  'advance_raised_to_accounts',
  'advance_approved':   'advance_payment_received',
  'advance_rejected':   'advance_raised_to_accounts',
  'payment_requested':  'payment_raised_to_accounts',
};

function getPhaseBadge(phase){
  const map={
    submitted:['Submitted','badge-gray'],
    pending_initial_pm_approval:['Project Manager Clearance','badge-orange'],
    lp_pending_pm_approval:['LP — Awaiting Project Manager','badge-orange'],
    pending_decline_approval:['Decline — Awaiting Project Manager','badge-red'],
    procurement_active:['Procurement Active','badge-blue'],
    vendor_info_shared:['Vendor Info Shared','badge-purple'],
    quotations_shared:['Engineer Verification','badge-purple'],
    quotes_revision_requested:['Quote Revision Requested','badge-orange'],
    pending_pm_final_approval:['Project Manager Final Approval','badge-orange'],
    pending_sandy_approval:['Director Approval','badge-purple'],
    approved:['Approved','badge-green'],
    order_placed:['Order Placed','badge-blue'],
    grn_pending:['GRN / QC','badge-orange'],
    grn_initiated:['GRN — Store','badge-orange'],
    qc_pending:['QC Inspection','badge-orange'],
    rework_store_form:['Rework — Store Dispatch','badge-orange'],
    rework_pending:['Rework / JWC','badge-orange'],
    rework_returned:['Rework Returned — Re-QC','badge-yellow'],
    rework2_pending:['2nd Rework / JWC','badge-orange'],
    rework2_returned:['2nd Rework Returned — Re-QC','badge-yellow'],
    qc_deviated:['QC Deviated','badge-purple'],
    deviation_approval:['Deviation — Pending Review','badge-purple'],
    qc_passed:['QC Passed','badge-green'],
    qc_rejected:['QC Rejected','badge-red'],
    accepted:['Closed','badge-green'],
    rejected:['Rejected','badge-red'],
    payment_requested:['Payment Requested','badge-purple'],
    advance_requested:['Advance Requested','badge-orange'],
    advance_approved:['Advance Approved','badge-green'],
    advance_rejected:['Advance Rejected','badge-red'],
    declined:['Declined by Procurement Manager','badge-red'],
    lp_procurement_processing:['LP — Processing','badge-blue'],
    lp_payment_pending:['LP — Payment Pending','badge-orange'],
    lp_payment_done:['LP — Payment Done','badge-green'],
  };
  const[label,cls]=map[phase]||[phase,'badge-gray'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function getUrgencyBadge(urgency){
  if(!urgency||urgency==='normal') return '';
  const map={
    urgent:['⚡ Within 24 hours','background:rgba(245,158,11,0.12);color:#b45309;border:1px solid rgba(245,158,11,0.35)'],
    critical:['🔴 Within 48 hours','background:rgba(214,43,43,0.12);color:#b91c1c;border:1px solid rgba(214,43,43,0.35)'],
  };
  const[label,style]=map[urgency]||['',''];
  if(!label) return '';
  return `<span style="font-size:0.68rem;font-weight:700;padding:2px 7px;border-radius:3px;${style};white-space:nowrap">${label}</span>`;
}

// ── NAVBAR / FOOTER ─────────────────────────────────────────
function initNavbar(user) {
  const g=id=>document.getElementById(id);
  if(g('navUserName')) g('navUserName').textContent=user.name;
  if(g('navUserDept')) g('navUserDept').textContent=user.department?DEPARTMENTS[user.department]:roleLabel(user.role);
  if(g('navUserAvatar')) g('navUserAvatar').textContent=user.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  if(g('navRoleBadge')) g('navRoleBadge').textContent=roleLabel(user.role);
  // Inject shared modals (password change, etc.)
  injectSharedModals();
  // Close user menu on outside click
  document.addEventListener('click', e => {
    const menu = document.getElementById('userNavMenu');
    const wrap = document.getElementById('navUserWrap');
    if (menu && wrap && !wrap.contains(e.target)) {
      menu.style.display = 'none';
    }
  });
}
function roleLabel(r){return{master:'Master Admin',procurement_manager:'Procurement Manager',engineer:'Engineer',project_manager:'Project Manager',accounts:'Accounts',director:'Director',store_manager:'Store Manager',qc_inspector:'QC Inspector'}[r]||r;}
function logout(){Session.clear();window.location.href='../index.html';}

window.toggleUserMenu = function toggleUserMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('userNavMenu');
  if (!menu) return;
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function buildNavbar(user) {
  const navLinks = {
    master: [
      {href:'master.html',label:'Dashboard'},
      {href:'projects.html',label:'Projects'},
      {href:'pm.html',label:'PM Portal'},
      {href:'accounts.html',label:'Accounts'},
      {href:'admin.html',label:'⚙ Admin'}
    ],
    project_manager: [
      {href:'pm.html',label:'My Requests'},
      {href:'projects.html',label:'Manage Projects'},
    ],
    procurement_manager: [
      {href:'procurement.html',label:'Procurement'},
    ],
    accounts: [
      {href:'accounts.html',label:'Payments'},
    ],
    engineer: [
      {href:'engineer.html',label:'My Requests'},
    ],
    director: [
      {href:'master.html',label:'Dashboard'},
      {href:'projects.html',label:'Projects'},
      {href:'pm.html',label:'PM Portal'},
    ],
  };
  const links = navLinks[user.role]||[];
  return `<nav class="navbar">
    <a class="nav-logo" href="#">
      <div class="nav-logo-mark">
        <img src="../on2cooklogo-bg.png" alt="Logo" width="60" height="20">
      </div>
      <div><div class="nav-logo-text">Procure<span>X</span></div></div>
    </a>
    <div class="nav-links" style="display:flex;gap:4px;margin-left:18px">
      ${links.map(l=>`<a href="${l.href}" class="nav-link ${window.location.pathname.includes(l.href)?'active':''}" style="font-size:0.78rem;padding:5px 12px;border-radius:5px;color:rgba(255,255,255,0.8);text-decoration:none;transition:background 0.15s;${window.location.pathname.includes(l.href)?'background:rgba(255,255,255,0.15);color:white':''}" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='${window.location.pathname.includes(l.href)?'rgba(255,255,255,0.15)':'transparent'}'">${l.label}</a>`).join('')}
    </div>
    <div class="nav-spacer"></div>
    <span class="nav-role-badge" id="navRoleBadge"></span>

    <!-- User Menu Wrap -->
    <div id="navUserWrap" style="position:relative">
      <div class="nav-user" style="cursor:pointer;user-select:none" onclick="toggleUserMenu(event)" title="Account options">
        <div class="nav-user-avatar" id="navUserAvatar"></div>
        <div>
          <div class="nav-user-name" id="navUserName"></div>
          <div class="nav-user-dept" id="navUserDept"></div>
        </div>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style="margin-left:6px;opacity:0.6;flex-shrink:0"><path d="M1 1l4 4 4-4" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <!-- Dropdown -->
      <div id="userNavMenu" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:white;border:1px solid #e5e7eb;border-radius:10px;padding:6px;min-width:190px;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.14)">
        <div style="padding:8px 10px 10px;border-bottom:1px solid #f3f4f6;margin-bottom:4px">
          <div style="font-weight:700;font-size:0.82rem;color:#111">${user.name}</div>
          <div style="font-size:0.72rem;color:#6b7280">${roleLabel(user.role)}</div>
        </div>
        <button onclick="openChangePasswordModal()" style="width:100%;text-align:left;padding:8px 10px;border:none;background:none;cursor:pointer;font-size:0.8rem;color:#374151;border-radius:6px;display:flex;align-items:center;gap:8px" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='none'">
          🔑 <span>Change Password</span>
        </button>
        <div style="height:1px;background:#f3f4f6;margin:4px 0"></div>
        <button onclick="logout()" style="width:100%;text-align:left;padding:8px 10px;border:none;background:none;cursor:pointer;font-size:0.8rem;color:#dc2626;border-radius:6px;display:flex;align-items:center;gap:8px" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='none'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span>Logout</span>
        </button>
      </div>
    </div>
  </nav>`;
}

function buildFooter() {
  return `<footer>
    <div class="footer-logo">
      <div class="footer-logo-mark">
      <img src="../on2cook no bg.png" alt="Logo" width="50" height="20">
      </div>
      <div class="footer-logo-text">Procure<span>X</span></div>
    </div>
    <div class="footer-copy">© ${new Date().getFullYear()} ProcureX</div>
    <div class="footer-links"><a href="#">Support</a><a href="#">Docs</a><a href="change-password.html">Change Password</a></div>
  </footer>`;
}


// ── PASSWORD CHANGE MODAL (injected once per page) ───────────
function injectSharedModals() {
  if (document.getElementById('_sharedChangePasswordModal')) return;
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="modal-overlay" id="_sharedChangePasswordModal" onclick="event.target===this&&closeChangePasswordModal()">
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <div><div class="modal-title">🔑 Change Password</div><div class="modal-title-sub">Update your account password</div></div>
          <button class="modal-close" onclick="closeChangePasswordModal()">✕</button>
        </div>
        <div class="modal-body">
          <div id="_cpError" style="display:none;padding:9px 12px;background:rgba(214,43,43,0.08);border:1px solid rgba(214,43,43,0.22);border-radius:6px;color:var(--red);font-size:0.8rem;margin-bottom:14px"></div>
          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label">Current Password *</label>
            <input class="form-control" id="_cpOld" type="password" placeholder="Enter your current password" autocomplete="current-password"/>
          </div>
          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label">New Password *</label>
            <input class="form-control" id="_cpNew" type="password" placeholder="At least 6 characters" autocomplete="new-password"/>
          </div>
          <div class="form-group">
            <label class="form-label">Confirm New Password *</label>
            <input class="form-control" id="_cpConfirm" type="password" placeholder="Repeat new password" autocomplete="new-password" onkeydown="if(event.key==='Enter')submitPasswordChange()"/>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeChangePasswordModal()">Cancel</button>
          <button class="btn btn-primary" onclick="submitPasswordChange()">Update Password</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el.firstElementChild);
}

window.openChangePasswordModal = function openChangePasswordModal() {
  const menu = document.getElementById('userNavMenu');
  if (menu) menu.style.display = 'none';
  const m = document.getElementById('_sharedChangePasswordModal');
  if (!m) { injectSharedModals(); }
  ['_cpOld','_cpNew','_cpConfirm'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  const err = document.getElementById('_cpError');
  if (err) { err.style.display='none'; err.textContent=''; }
  const modal = document.getElementById('_sharedChangePasswordModal');
  if (modal) { modal.classList.add('active'); document.body.style.overflow='hidden'; }
}

window.closeChangePasswordModal = function closeChangePasswordModal() {
  const m = document.getElementById('_sharedChangePasswordModal');
  if (m) { m.classList.remove('active'); document.body.style.overflow=''; }
}

window.submitPasswordChange = async function submitPasswordChange() {
  const oldPw = document.getElementById('_cpOld')?.value || '';
  const newPw = document.getElementById('_cpNew')?.value || '';
  const confirmPw = document.getElementById('_cpConfirm')?.value || '';
  const errEl = document.getElementById('_cpError');

  const showErr = msg => { if(errEl){errEl.textContent=msg;errEl.style.display='block';} };
  errEl.style.display = 'none';

  if (!oldPw || !newPw || !confirmPw) { showErr('All fields are required.'); return; }
  if (newPw.length < 6) { showErr('New password must be at least 6 characters.'); return; }
  if (newPw !== confirmPw) { showErr('New passwords do not match.'); return; }

  const user = Session.get();
  if (!user) { showErr('Session expired. Please log in again.'); return; }

  showLoader(true);
  // Verify current password
  const { data: userRec, error: fetchErr } = await db.from('users').select('id,password').eq('id', user.id).single();
  if (fetchErr || !userRec) { showLoader(false); showErr('Could not verify identity. Try logging out and in.'); return; }
  if (userRec.password !== oldPw) { showLoader(false); showErr('Current password is incorrect.'); return; }

  // Update password
  const { error: updateErr } = await db.from('users').update({ password: newPw }).eq('id', user.id);
  showLoader(false);
  if (updateErr) { showErr('Update failed: ' + updateErr.message); return; }

  closeChangePasswordModal();
  showToast('Password updated successfully!', 'success');
}

// ── WORKFLOW TRACK ──────────────────────────────────────────
// PIPELINE_WF_STEPS is defined in supabase-config.js so it's
// available to both shared.js and pages that don't load shared.js (e.g. admin.html)
// Legacy flat alias kept for backward compat
const WF_STEPS = PIPELINE_WF_STEPS.RFQ;

function renderWorkflowTrack(phase, phaseTimestamps, createdAt, requestCategory) {
  var ts = Object.assign({}, phaseTimestamps || {});
  // Fall back to created_at for submitted timestamp
  if (!ts.submitted && createdAt) ts.submitted = createdAt;
  var phaseToStep = {
    'advance_approved': 'advance_payment_received',
    'advance_rejected': 'advance_raised_to_accounts',
    // legacy compat
    'advance_requested': 'advance_raised_to_accounts',
    'payment_requested': 'payment_raised_to_accounts'
  };
  // Pick the right step set for this pipeline — MUST come before indexOf usage
  var pipelineKey = requestCategory === 'local_purchase' ? 'local_purchase'
                  : requestCategory === 'vendor_info'    ? 'vendor_info'
                  : 'RFQ';
  var _pwf = typeof PIPELINE_WF_STEPS !== 'undefined' ? PIPELINE_WF_STEPS : null;
  var steps = (_pwf && _pwf[pipelineKey]) || (_pwf && _pwf.RFQ) || WF_STEPS || [];
  var pipelinePhaseOrder = steps.map(function(s){ return s.key; });

  var effectivePhase = phaseToStep[phase] || phase;
  var idx = pipelinePhaseOrder.indexOf(effectivePhase);
  if (idx === -1) idx = PHASE_ORDER.indexOf(effectivePhase); // fallback
  var isRej = phase === 'rejected';

  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short'});
  }
  function shortTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
  }

  return '<div class="workflow-track">' + steps.map(function(s, i) {
    var si = pipelinePhaseOrder.indexOf(s.key);
    if (si === -1) si = PHASE_ORDER.indexOf(s.key);
    var isCurrent = effectivePhase === s.key;
    var isDone = si < idx;
    var hasTs = !!ts[s.key];
    // Optional phases (advance) shown as skipped if done but no timestamp
    var isSkipped = isDone && !hasTs && s.optional;
    var cls = isCurrent ? 'current' : (isDone && !isSkipped) ? 'done' : isSkipped ? 'skipped' : '';

    // Email notification indicator
    var emailKey = s.key + '_email_sent';
    var emailTs = ts[emailKey];
    var emailHtml = emailTs
      ? '<div class="wf-email-tag">✉ ' + shortDate(emailTs) + '</div>'
      : (isCurrent || isDone) && !isSkipped ? '<div class="wf-email-tag wf-email-pending"></div>' : '';

    var nodeStyle = '', labelStyle = '', nodeContent = isDone && !isSkipped ? '✓' : i + 1;
    var nodeLabel = s.label;
    if (isSkipped) { nodeStyle = 'style="background:var(--off-white);border-color:var(--border);color:var(--gray-4)"'; labelStyle = 'style="color:var(--gray-4)"'; nodeContent = '—'; }

    // Date: show for all done/current phases even if timestamp missing (show '—' placeholder)
    var dateStr = (isDone || isCurrent) && !isSkipped ? (shortDate(ts[s.key]) || '') : '';
    var dateHtml = '<div class="wf-date">' + dateStr + '</div>';

    return '<div class="wf-step ' + cls + '">' +
      '<div class="wf-node" ' + nodeStyle + '>' + nodeContent + '</div>' +
      '<div class="wf-label" ' + labelStyle + '>' + nodeLabel + '</div>' +
      dateHtml +
      '</div>';
  }).join('') +
  (isRej ? '<div class="wf-step current"><div class="wf-node" style="background:var(--red);border-color:var(--red);color:white">✗</div><div class="wf-label" style="color:var(--red)">Rejected</div><div class="wf-date">' + shortDate(ts['rejected']) + '</div></div>' : '') +
  '</div>';
}

// ── LEAD TIME HELPERS ────────────────────────────────────────
function calcLeadTimeDays(createdAt, closedAt) {
  if (!createdAt) return null;
  var endTime = closedAt ? new Date(closedAt) : Date.now();
  return Math.floor((endTime - new Date(createdAt)) / 86400000);
}
function leadTimeBadge(createdAt, closedAt) {
  var days = calcLeadTimeDays(createdAt, closedAt);
  if (days === null) return '';
  var isClosed = !!closedAt;
  var color = isClosed ? '#6b7280' : (days <= 7 ? '#22c55e' : days <= 21 ? '#f59e0b' : '#ef4444');
  var suffix = isClosed ? 'd ✓' : 'd';
  return '<span style="font-family:var(--font-mono);font-size:0.7rem;padding:1px 7px;border-radius:10px;background:'+color+'15;color:'+color+';border:1px solid '+color+'35">'+days+suffix+'</span>';
}



// ── PARTS TABLE RENDER (read-only) ──────────────────────────
function renderPartsTable(parts) {
  if(!parts||!parts.length) return '';
  return `<div style="margin-top:14px">
    <div class="detail-key" style="margin-bottom:8px">Parts / Items (BOM)</div>
    <div style="overflow-x:auto">
    <table class="parts-table">
      <thead><tr><th style="width:28px">#</th><th>Part Name</th><th style="width:80px">Qty</th><th>Specification</th></tr></thead>
      <tbody>${parts.map((p,i)=>`<tr><td style="color:var(--gray-4);text-align:center;font-family:var(--font-mono);font-size:0.72rem">${i+1}</td>
        <td>${p.name||'—'}</td>
        <td style="text-align:center;font-family:var(--font-mono)">${p.qty||0}</td>
        <td style="color:var(--gray-3)">${p.spec||'—'}</td></tr>`).join('')}
      </tbody>
    </table></div>
  </div>`;
}

// ── PR DETAIL HTML ──────────────────────────────────────────
function buildPRDetailHTML(pr, quotations=[], vendorName='', pmName='', extras={}) {
  // extras: { poData, advPayRec, payRec }
  // poData       = purchase_orders row (or null)
  // advPayRec    = advance_payment_requests row (or null)
  // payRec       = payment_requests row (or null)
  const parts = pr.parts||[];
  return `
    <div class="detail-grid">
      <div class="detail-item"><div class="detail-key">Request #</div>
        <div class="detail-value"><span class="pr-number${pr.is_modification?' modified':''}">PR-${String(pr.request_number).padStart(4,'0')}</span>
        ${pr.is_modification?`<span class="mod-badge" style="margin-left:6px">↺ Modified</span>`:''}
        </div></div>
      <div class="detail-item"><div class="detail-key">Category</div><div class="detail-value">${pr.request_category==='vendor_info'?'Vendor Info Request':'RFQ'}</div></div>
      <div class="detail-item"><div class="detail-key">Project</div><div class="detail-value">${pr.project_name}</div></div>
      <div class="detail-item"><div class="detail-key">Phase</div><div class="detail-value">${pr.project_phase}</div></div>
      <div class="detail-item"><div class="detail-key">Project Manager</div><div class="detail-value">${pmName||pr.project_manager_name||'—'}</div></div>
      <div class="detail-item"><div class="detail-key">Team Member</div><div class="detail-value">${pr.team_member_name}</div></div>
      <div class="detail-item"><div class="detail-key">Department</div><div class="detail-value">${DEPARTMENTS[pr.department]||pr.department}</div></div>
      ${pr.order_type?`<div class="detail-item"><div class="detail-key">Order Type</div><div class="detail-value">${ORDER_TYPES[pr.order_type]||pr.order_type}</div></div>`:''}
      ${pr.product_link?`<div class="detail-item"><div class="detail-key">Product Link</div><div class="detail-value"><a href="${pr.product_link}" target="_blank" style="color:var(--red)">🔗 View Product</a></div></div>`:''}
      ${pr.sourcing?`<div class="detail-item"><div class="detail-key">Sourcing</div><div class="detail-value">${(Array.isArray(pr.sourcing)?pr.sourcing:JSON.parse(pr.sourcing||'[]')).map(s=>s==='domestic'?'🏠 Domestic':'🌍 International').join(', ')}</div></div>`:''}
      <div class="detail-item"><div class="detail-key">Assigned Vendor</div><div class="detail-value">${vendorName||'—'}</div></div>
      <div class="detail-item"><div class="detail-key">Submitted</div><div class="detail-value">${fmtDate(pr.created_at)}</div></div>
      ${pr.description?`<div class="detail-item" style="grid-column:1/-1"><div class="detail-key">Description / Notes</div><div class="detail-value" style="line-height:1.5">${pr.description}</div></div>`:''}
      ${pr.modification_note?`<div class="detail-item" style="grid-column:1/-1"><div class="detail-key" style="color:#6366f1">Modification Note</div><div class="detail-value">${pr.modification_note}</div></div>`:''}
    </div>

    ${pr.qc_criteria&&(pr.qc_criteria.preferred_color||pr.qc_criteria.preferred_material||pr.qc_criteria.custom)?`
    <div style="margin-top:14px;padding:12px 14px;background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.18);border-radius:var(--radius)">
      <div class="detail-key" style="color:#6366f1;margin-bottom:8px">🔍 QC Criteria</div>
      <div class="detail-grid" style="gap:8px">
        ${pr.qc_criteria.preferred_color?`<div class="detail-item"><div class="detail-key">Preferred Color</div><div class="detail-value">${pr.qc_criteria.preferred_color}</div></div>`:''}
        ${pr.qc_criteria.preferred_material?`<div class="detail-item"><div class="detail-key">Preferred Material</div><div class="detail-value">${pr.qc_criteria.preferred_material}</div></div>`:''}
        ${pr.qc_criteria.custom?`<div class="detail-item" style="grid-column:1/-1"><div class="detail-key">Additional Criteria</div><div class="detail-value">${pr.qc_criteria.custom}</div></div>`:''}
      </div>
    </div>`:''}

    ${renderPartsTable(parts)}
    <div style="margin-top:12px;display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--off-white);border:1px solid var(--border);border-radius:var(--radius)">
      <span style="font-size:0.8rem;color:var(--gray-3)">Total Lead Time:</span>
      <strong style="font-family:var(--font-mono);font-size:0.88rem">${calcLeadTimeDays(pr.created_at, pr.closed_at)} days${pr.closed_at ? ' (final)' : ''}</strong>
      <span style="font-size:0.75rem;color:var(--gray-4)">(from ${fmtDate(pr.created_at)}${pr.closed_at ? ' to ' + fmtDate(pr.closed_at) : ' to today'})</span>
    </div>
    <div style="margin-top:16px">${renderWorkflowTrack(pr.phase, pr.phase_timestamps, pr.created_at, pr.request_category)}</div>

    ${(pr.phase==='advance_requested'||pr.phase==='advance_approved'||pr.phase==='advance_rejected')?`<div style="margin-top:14px;padding:12px 14px;background:${pr.phase==='advance_approved'?'rgba(22,163,74,0.06)':pr.phase==='advance_rejected'?'rgba(214,43,43,0.06)':'rgba(245,158,11,0.06)'};border:1px solid ${pr.phase==='advance_approved'?'rgba(22,163,74,0.25)':pr.phase==='advance_rejected'?'rgba(214,43,43,0.25)':'rgba(245,158,11,0.25)'};border-radius:var(--radius)">
      <div class="detail-key" style="color:${pr.phase==='advance_approved'?'#16a34a':pr.phase==='advance_rejected'?'var(--red)':'#b45309'};margin-bottom:6px">
        ${{advance_approved:' Advance Payment Approved',advance_rejected:' Advance Payment Rejected',advance_requested:'⏳ Advance Payment Pending'}[pr.phase]||'💳 Advance Payment'}
      </div>
    </div>`:''}
    ${quotations.length?`<div style="margin-top:14px">
      <div class="detail-key" style="margin-bottom:8px">Quotations (${quotations.length})</div>
      <div style="display:flex;flex-direction:column;gap:8px">${quotations.map(q=>renderQuotationCard(q,false,pr.selected_quotation_id)).join('')}</div>
    </div>`:''}

    ${pr.vendor_info_details?`<div style="margin-top:14px;padding:14px;background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.2);border-radius:var(--radius)">
      <div class="detail-key" style="color:#7c3aed;margin-bottom:6px">🏢 Vendor Information (from Procurement)</div>
      <p style="font-size:0.83rem;line-height:1.5;white-space:pre-wrap">${pr.vendor_info_details}</p>
    </div>`:''}

    ${pr.client_approval_screenshot?`<div style="margin-top:14px;padding:12px;background:rgba(22,163,74,0.06);border:1px solid rgba(22,163,74,0.2);border-radius:var(--radius)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div class="detail-key" style="color:#16a34a">✓ Client Approval</div>
        <button class="btn btn-secondary btn-sm" onclick="_previewByIdx(${_regFile(pr.client_approval_screenshot,'client_approval')})">👁 Preview</button>
        <button class="btn btn-secondary btn-sm" onclick="_downloadByIdx(${_regFile(pr.client_approval_screenshot,'client_approval')})">⬇ Download</button>
      </div>
      <img src="${pr.client_approval_screenshot}" style="max-width:100%;max-height:240px;object-fit:contain;border-radius:6px;border:1px solid var(--border)" onerror="this.style.display='none'"/>
      ${pr.client_approval_notes?`<p style="font-size:0.8rem;color:var(--gray-3);margin-top:6px">${pr.client_approval_notes}</p>`:''}
    </div>`:''}

    ${pr.pm_final_approval_notes?`<div style="margin-top:14px;padding:12px;background:${pr.pm_final_approval_status==='approved'?'rgba(22,163,74,0.06)':'rgba(214,43,43,0.06)'};border:1px solid ${pr.pm_final_approval_status==='approved'?'rgba(22,163,74,0.2)':'rgba(214,43,43,0.2)'};border-radius:var(--radius)">
      <div class="detail-key" style="color:${pr.pm_final_approval_status==='approved'?'#16a34a':'var(--red)'};margin-bottom:4px">Project Manager ${pr.pm_final_approval_status==='approved'?'Approved':'Rejected'}</div>
      <p style="font-size:0.83rem">${pr.pm_final_approval_notes}</p>
    </div>`:''}

    ${pr.rejection_reason?`<div style="margin-top:14px;padding:12px;background:rgba(214,43,43,0.06);border:1px solid rgba(214,43,43,0.18);border-radius:var(--radius)">
      <div class="detail-key" style="color:var(--red);margin-bottom:4px">Rejection Reason</div>
      <p style="font-size:0.83rem">${pr.rejection_reason}</p>
    </div>`:''}

    ${pr.qc_notes?`<div style="margin-top:14px;padding:12px;background:${pr.qc_result==='qc_passed'||pr.qc_result==='accepted'?'rgba(22,163,74,0.06)':pr.phase==='qc_rejected'?'rgba(124,58,237,0.06)':'rgba(214,43,43,0.06)'};border:1px solid ${pr.qc_result==='qc_passed'||pr.qc_result==='accepted'?'rgba(22,163,74,0.2)':pr.phase==='qc_rejected'?'rgba(124,58,237,0.25)':'rgba(214,43,43,0.2)'};border-radius:var(--radius)">
      <div class="detail-key" style="color:${pr.qc_result==='qc_passed'||pr.qc_result==='accepted'?'#16a34a':pr.phase==='qc_rejected'?'#7c3aed':'var(--red)'};margin-bottom:4px">QC — ${pr.qc_result==='qc_passed'||pr.qc_result==='accepted'?'Passed ✓':pr.phase==='qc_rejected'?'Rejected 🚫':'Failed ✗'}</div>
      <p style="font-size:0.83rem">${pr.qc_notes}</p>
    </div>`:''}

    ${(()=>{
      /* ── GRN / QC FORM (stored in qc_criteria.grn after engineer submits) ── */
      const grn = pr.qc_criteria?.grn;
      if (!grn) return '';
      const lines = grn.lines||[];
      const resultVal = pr.qc_result;
      const isPassed = resultVal==='accepted'||resultVal==='qc_passed';
      return `<div style="margin-top:16px;border:1px solid ${isPassed?'rgba(22,163,74,0.25)':'rgba(214,43,43,0.25)'};border-radius:var(--radius);overflow:hidden">
        <div style="padding:10px 14px;background:${isPassed?'rgba(22,163,74,0.08)':'rgba(214,43,43,0.08)'};display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
          <div style="font-weight:700;font-size:0.85rem;color:${isPassed?'#16a34a':'var(--red)'}">📋 GRN / QC Form — ${isPassed?'Passed ✓':'Rejected ✗'}</div>
          <span style="font-family:var(--font-mono);font-size:0.72rem;font-weight:600;padding:2px 8px;border-radius:3px;background:${isPassed?'rgba(22,163,74,0.12)':'rgba(214,43,43,0.12)'};color:${isPassed?'#16a34a':'var(--red)'}">GRN# ${grn.grn_number||'—'}</span>
        </div>
        <div style="padding:12px 14px;background:white">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px 14px;margin-bottom:12px">
            ${grn.grn_date?`<div><div class="detail-key">GRN Date</div><div class="detail-value" style="font-family:var(--font-mono);font-size:0.82rem">${grn.grn_date}</div></div>`:''}
            ${grn.invoice_no?`<div><div class="detail-key">Invoice No</div><div class="detail-value" style="font-family:var(--font-mono);font-size:0.82rem">${grn.invoice_no}</div></div>`:''}
            ${grn.transporter?`<div><div class="detail-key">Transporter</div><div class="detail-value" style="font-size:0.82rem">${grn.transporter}</div></div>`:''}
            ${grn.gate_inward_no?`<div><div class="detail-key">Gate Inward No</div><div class="detail-value" style="font-family:var(--font-mono);font-size:0.82rem">${grn.gate_inward_no}</div></div>`:''}
            ${grn.gate_inward_date?`<div><div class="detail-key">Gate Inward Date</div><div class="detail-value" style="font-family:var(--font-mono);font-size:0.82rem">${grn.gate_inward_date}</div></div>`:''}
            ${grn.received_by?`<div><div class="detail-key">Received By</div><div class="detail-value" style="font-size:0.82rem">${grn.received_by}</div></div>`:''}
            ${grn.qc_checked_by?`<div><div class="detail-key">QC Checked By</div><div class="detail-value" style="font-size:0.82rem">${grn.qc_checked_by}</div></div>`:''}
          </div>
          ${lines.length?`<div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:0.78rem">
              <thead><tr style="background:var(--gray-6)">
                <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:0.68rem">SR#</th>
                <th style="padding:5px 8px;border:1px solid var(--border);font-size:0.68rem">ITEM CODE</th>
                <th style="padding:5px 8px;border:1px solid var(--border);font-size:0.68rem">ITEM NAME</th>
                <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:0.68rem">UOM</th>
                <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:0.68rem;background:rgba(99,102,241,0.06)">PO QTY</th>
                <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:0.68rem">RCVD</th>
                <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:0.68rem;background:rgba(34,197,94,0.06)">ACCEPTED</th>
                <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:0.68rem;background:rgba(239,68,68,0.06)">REJECTED</th>
              </tr></thead>
              <tbody>${lines.map(l=>`<tr>
                <td style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-family:var(--font-mono);font-size:0.72rem">${l.sr}</td>
                <td style="padding:5px 8px;border:1px solid var(--border);font-family:var(--font-mono);font-size:0.72rem">${l.item_code||'—'}</td>
                <td style="padding:5px 8px;border:1px solid var(--border);font-size:0.78rem;font-weight:500">${l.item_name||'—'}</td>
                <td style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-family:var(--font-mono);font-size:0.72rem">${l.uom||'pcs'}</td>
                <td style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-family:var(--font-mono);font-weight:700;color:#6366f1">${l.po_qty}</td>
                <td style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-family:var(--font-mono)">${l.received}</td>
                <td style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-family:var(--font-mono);color:#16a34a;font-weight:600">${l.accepted}</td>
                <td style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-family:var(--font-mono);color:var(--red);font-weight:600">${l.rejected}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>`:''}
        </div>
      </div>`;
    })()}

    ${(()=>{
      /* ── GENERATED PURCHASE ORDER ── */
      const po = extras.poData;
      if (!po) return '';
      return `<div style="margin-top:16px;border:1px solid rgba(99,102,241,0.25);border-radius:var(--radius);overflow:hidden">
        <div style="padding:10px 14px;background:rgba(99,102,241,0.07);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
          <div style="font-weight:700;font-size:0.85rem;color:#4f46e5">📄 Purchase Order</div>
          <span style="font-family:var(--font-mono);font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:3px;background:rgba(99,102,241,0.12);color:#4f46e5">${po.po_number}</span>
        </div>
        <div style="padding:12px 14px;background:white;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 14px">
          <div><div class="detail-key">PO Date</div><div class="detail-value" style="font-family:var(--font-mono);font-size:0.82rem">${fmtDate(po.po_date||po.created_at)}</div></div>
          <div><div class="detail-key">Total Amount</div><div class="detail-value" style="font-family:var(--font-mono);font-weight:700;font-size:0.9rem">${po.currency||'AED'} ${Number(po.total_amount||0).toLocaleString()}</div></div>
          ${po.ship_to?`<div style="grid-column:1/-1"><div class="detail-key">Ship To</div><div class="detail-value" style="font-size:0.82rem">${po.ship_to}</div></div>`:''}
        </div>
      </div>`;
    })()}

    ${(()=>{
      /* ── SMARTSHEET PAYMENT SCREENSHOTS ── */
      const adv = extras.advPayRec;
      const pay = extras.payRec;
      if (!adv && !pay) return '';
      let html = `<div style="margin-top:16px">`;
      if (adv && (adv.smartsheet_screenshot || adv.smartsheet_payment_id)) {
        html += `<div style="margin-bottom:10px;border:1px solid rgba(245,158,11,0.3);border-radius:var(--radius);overflow:hidden">
          <div style="padding:9px 14px;background:rgba(245,158,11,0.07);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
            <div style="font-weight:700;font-size:0.83rem;color:#b45309">🧾 Advance Payment — Smartsheet</div>
            ${adv.smartsheet_payment_id?`<span style="font-family:var(--font-mono);font-size:0.72rem;font-weight:700;padding:2px 8px;background:rgba(245,158,11,0.12);color:#b45309;border-radius:3px">ID: ${adv.smartsheet_payment_id}</span>`:''}
          </div>
          <div style="padding:10px 14px;background:white">
            <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:${adv.smartsheet_screenshot?'10px':'0'}">
              <div><div class="detail-key">Amount</div><div class="detail-value" style="font-family:var(--font-mono);font-weight:700">${adv.currency||'AED'} ${Number(adv.amount||0).toLocaleString()}</div></div>
              <div><div class="detail-key">Raised On</div><div class="detail-value" style="font-size:0.82rem">${fmtDate(adv.raised_at||adv.created_at)}</div></div>
              <div><div class="detail-key">Status</div><div class="detail-value"><span style="font-size:0.72rem;font-weight:600;padding:2px 8px;border-radius:3px;background:${adv.status==='payment_received'?'rgba(22,163,74,0.1)':'rgba(245,158,11,0.1)'};color:${adv.status==='payment_received'?'#16a34a':'#b45309'}">${(adv.status||'').replace(/_/g,' ').toUpperCase()}</span></div></div>
            </div>
            ${adv.smartsheet_screenshot?`<div>
              <div class="detail-key" style="margin-bottom:6px">Screenshot</div>
              <img src="${adv.smartsheet_screenshot}" style="max-width:100%;max-height:220px;object-fit:contain;border-radius:6px;border:1px solid var(--border);display:block" onerror="this.style.display='none'"/>
              <div style="margin-top:6px;display:flex;gap:6px">
                <button class="btn btn-secondary btn-sm" onclick="_previewByIdx(${_regFile(adv.smartsheet_screenshot,'adv_smartsheet_screenshot')})">👁 Preview</button>
                <button class="btn btn-secondary btn-sm" onclick="_downloadByIdx(${_regFile(adv.smartsheet_screenshot,'adv_smartsheet_screenshot')})">⬇ Download</button>
              </div>
            </div>`:''}
            ${adv.notes?`<p style="font-size:0.78rem;color:var(--gray-3);margin-top:6px">${adv.notes}</p>`:''}
          </div>
        </div>`;
      }
      if (pay && (pay.smartsheet_screenshot || pay.smartsheet_payment_id)) {
        html += `<div style="border:1px solid rgba(139,92,246,0.3);border-radius:var(--radius);overflow:hidden">
          <div style="padding:9px 14px;background:rgba(139,92,246,0.07);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
            <div style="font-weight:700;font-size:0.83rem;color:#7c3aed">💰 Full Payment — Smartsheet</div>
            ${pay.smartsheet_payment_id?`<span style="font-family:var(--font-mono);font-size:0.72rem;font-weight:700;padding:2px 8px;background:rgba(139,92,246,0.12);color:#7c3aed;border-radius:3px">ID: ${pay.smartsheet_payment_id}</span>`:''}
          </div>
          <div style="padding:10px 14px;background:white">
            <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:${pay.smartsheet_screenshot?'10px':'0'}">
              <div><div class="detail-key">Invoice Amount</div><div class="detail-value" style="font-family:var(--font-mono);font-weight:700">${pay.currency||'AED'} ${Number(pay.invoice_amount||0).toLocaleString()}</div></div>
              <div><div class="detail-key">Raised On</div><div class="detail-value" style="font-size:0.82rem">${fmtDate(pay.raised_at||pay.request_date)}</div></div>
              <div><div class="detail-key">Status</div><div class="detail-value"><span style="font-size:0.72rem;font-weight:600;padding:2px 8px;border-radius:3px;background:${pay.status==='paid'?'rgba(22,163,74,0.1)':'rgba(139,92,246,0.1)'};color:${pay.status==='paid'?'#16a34a':'#7c3aed'}">${(pay.status||'').replace(/_/g,' ').toUpperCase()}</span></div></div>
            </div>
            ${pay.smartsheet_screenshot?`<div>
              <div class="detail-key" style="margin-bottom:6px">Screenshot</div>
              <img src="${pay.smartsheet_screenshot}" style="max-width:100%;max-height:220px;object-fit:contain;border-radius:6px;border:1px solid var(--border);display:block" onerror="this.style.display='none'"/>
              <div style="margin-top:6px;display:flex;gap:6px">
                <button class="btn btn-secondary btn-sm" onclick="_previewByIdx(${_regFile(pay.smartsheet_screenshot,'pay_smartsheet_screenshot')})">👁 Preview</button>
                <button class="btn btn-secondary btn-sm" onclick="_downloadByIdx(${_regFile(pay.smartsheet_screenshot,'pay_smartsheet_screenshot')})">⬇ Download</button>
              </div>
            </div>`:''}
            ${pay.notes||pay.payment_notes?`<p style="font-size:0.78rem;color:var(--gray-3);margin-top:6px">${pay.notes||pay.payment_notes}</p>`:''}
          </div>
        </div>`;
      }
      html += `</div>`;
      return html;
    })()}`;
}

// ── QUOTATION CARD ──────────────────────────────────────────
function renderQuotationCard(q, showSelectBtn=false, selectedId=null) {
  const isSelected = q.id===selectedId||q.is_selected;
  const isImg = q.file_type?.includes('image');
  const isPDF = q.file_type==='application/pdf'||q.file_name?.toLowerCase().includes('.pdf');
  const currency = q.currency||'AED';
  const fi = _regFile(q.file_url, q.file_name||'quotation');
  return `<div class="quotation-card ${isSelected?'selected':''}" id="qcard-${q.id}">
    <div class="quotation-card-header">
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
        <span style="font-size:1.1rem;flex-shrink:0">${isPDF?'📄':isImg?'🖼️':'🔗'}</span>
        <div style="min-width:0">
          <div style="font-weight:600;font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${q.file_name}</div>
          <div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--gray-4)">${q.vendor_name||'—'} · ${fmtDate(q.created_at)}</div>
        </div>
      </div>
      ${isSelected?`<span style="background:#22c55e14;color:#16a34a;border:1px solid #22c55e30;padding:2px 8px;border-radius:3px;font-family:var(--font-mono);font-size:0.62rem;font-weight:600;white-space:nowrap">✓ SELECTED</span>`:''}
    </div>
    <div class="quotation-card-body">
      ${q.amount?`<div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:8px">
        <div><div class="detail-key">Amount</div><div style="font-family:var(--font-mono);font-size:0.95rem;font-weight:700">${currency} ${Number(q.amount).toLocaleString()}</div></div>
        ${q.lead_time_days?`<div><div class="detail-key">Lead Time</div><div style="font-family:var(--font-mono);font-weight:600">${q.lead_time_days}d</div></div>`:''}
      </div>`:''}
      ${q.notes?`<p style="font-size:0.78rem;color:var(--gray-3);margin-bottom:8px">${q.notes}</p>`:''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-secondary btn-sm" onclick="_previewByIdx(${fi})">👁 Preview</button>
        <button class="btn btn-secondary btn-sm" onclick="_downloadByIdx(${fi})">⬇ Download</button>
        ${showSelectBtn&&!isSelected?`<button class="btn btn-primary btn-sm" onclick="selectQuotation('${q.id}')">✓ Select as Final</button>`:''}
        ${showSelectBtn&&isSelected?`<button class="btn btn-danger btn-sm" onclick="selectQuotation(null)">Deselect</button>`:''}
      </div>
    </div>
  </div>`;
}

function previewImage(url, name) { _safePreview(url, name); }

// ── VENDOR VIEW ─────────────────────────────────────────────
async function loadAndRenderVendors(gridId, searchId) {
  const {data} = await db.from('vendors').select('*').order('name');
  const allVendors = data||[];
  renderVendorCards(allVendors, gridId);
  if(searchId) {
    document.getElementById(searchId)?.addEventListener('input', e=>{
      const s=e.target.value.toLowerCase();
      renderVendorCards(allVendors.filter(v=>!s||v.name.toLowerCase().includes(s)||(v.specialization||'').toLowerCase().includes(s)), gridId);
    });
  }
  return allVendors;
}

function renderVendorCards(vendors, gridId, canEdit=false) {
  const grid=document.getElementById(gridId);
  if(!grid) return;
  if(!vendors.length){grid.innerHTML=`<div style="grid-column:1/-1;color:var(--gray-4);padding:32px;text-align:center">No vendors found.</div>`;return;}
  grid.innerHTML=vendors.map(v=>{
    const pt = PAYMENT_TERMS_OPTIONS.find(p=>p.value===v.payment_terms);
    return `
    <div class="vendor-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:7px">
        <div><div class="vendor-name">${v.name}</div><div class="vendor-spec">${v.specialization||'—'}</div></div>
        <span style="font-size:0.62rem;font-family:var(--font-mono);padding:2px 6px;border-radius:3px;white-space:nowrap;flex-shrink:0;${v.is_active?'background:rgba(5,150,105,0.08);color:#047857;border:1px solid rgba(5,150,105,0.2)':'background:var(--off-white);color:var(--gray-4);border:1px solid var(--border)'}">
          ${v.is_active?'Active':'Inactive'}
        </span>
      </div>
      <div style="margin-bottom:6px">${starRating(v.avg_rating,v.rating_count)}</div>
      ${pt?`<div style="font-size:0.7rem;margin-bottom:8px;padding:3px 7px;background:rgba(99,102,241,0.07);border:1px solid rgba(99,102,241,0.18);border-radius:3px;color:#6366f1">💳 ${pt.label}</div>`:''}
      <div style="display:flex;flex-direction:column;gap:2px;margin-bottom:9px">
      ${v.contact_person?`<div style="font-size:0.75rem;color:var(--gray-3)">👤 ${v.contact_person}</div>`:''}
      ${v.email?`<div style="font-size:0.75rem">✉ <a href="mailto:${v.email}" style="color:var(--red);text-decoration:none">${v.email}</a></div>`:''}
      ${v.phone?`<div style="font-size:0.75rem;color:var(--gray-3)">📞 ${v.phone}</div>`:''}

      ${(v.gstin||v.GSTIN)?`<div style="font-size:0.75rem;color:var(--gray-3)">🧾 GSTIN: ${v.gstin||v.GSTIN}</div>`:''}
        ${v.country?`<div style="font-size:0.75rem;color:var(--gray-3)">🌍 ${v.country}</div>`:''}
        ${v.vendor_type?`<div style="font-size:0.75rem;color:var(--gray-3)">🏷 ${v.vendor_type}</div>`:''}
    </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        ${canEdit?`
          <button class="btn btn-secondary btn-sm" onclick="editVendor('${v.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="toggleVendorActive('${v.id}',${v.is_active})">${v.is_active?'Deactivate':'Activate'}</button>
          <button class="btn btn-ghost btn-sm" onclick="openVendorHistory('${v.id}')">📋 History</button>
          <button class="btn btn-ghost btn-sm" onclick="openVendorPartsModal('${v.id}','${v.name.replace(/'/g,'\\\'')}')" style="color:#6366f1;border-color:rgba(99,102,241,0.3)">🔩 Parts</button>
        `:`
          <button class="btn btn-secondary btn-sm" onclick="openVendorEnquiry(${JSON.stringify(v).split('"').join('&quot;')})">📬 Enquire</button>
          <button class="btn btn-ghost btn-sm" onclick="openVendorHistory('${v.id}')">📋 History</button>
        `}
      </div>
    </div>`;
  }).join('');
}

// ── VENDOR HISTORY MODAL ─────────────────────────────────────
async function openVendorHistory(vendorId) {
  let ov=document.getElementById('_vendorHistoryModal');
  if(!ov){
    ov=document.createElement('div');ov.id='_vendorHistoryModal';ov.className='modal-overlay';
    ov.onclick=e=>{if(e.target===ov)ov.classList.remove('active');};
    document.body.appendChild(ov);
  }
  ov.innerHTML=`<div class="modal" style="max-width:960px"><div class="modal-header"><div class="modal-title">Vendor History</div><button class="modal-close" onclick="document.getElementById('_vendorHistoryModal').classList.remove('active')">✕</button></div><div class="modal-body" id="_vhBody"><div style="text-align:center;padding:24px;color:var(--gray-4)">Loading...</div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById('_vendorHistoryModal').classList.remove('active')">Close</button></div></div>`;
  ov.classList.add('active');

  const [vendorRes, ratingsRes, ordersRes] = await Promise.all([
    db.from('vendors').select('*').eq('id',vendorId).single(),
    db.from('vendor_ratings').select('*,users(name),procurement_requests(project_name,request_number)').eq('vendor_id',vendorId).order('created_at',{ascending:false}),
    db.from('procurement_requests').select('*').eq('assigned_vendor_id',vendorId).order('created_at',{ascending:false})
  ]);

  const v = vendorRes.data||{};
  const ratings = ratingsRes.data||[];
  const orders = ordersRes.data||[];
  const pt = PAYMENT_TERMS_OPTIONS.find(p=>p.value===v.payment_terms);

  document.getElementById('_vhBody').innerHTML=`
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)">
      <div style="width:48px;height:48px;border-radius:10px;background:var(--off-white);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:1.4rem">🏢</div>
      <div>
        <div style="font-weight:700;font-size:1rem">${v.name}</div>
        <div style="font-size:0.78rem;color:var(--gray-3)">${v.specialization||''}</div>
        <div style="margin-top:3px">${starRating(v.avg_rating,v.rating_count)}</div>
      </div>
      ${v.email?`<div style="font-size:0.76rem;color:var(--gray-3);margin-left:8px">${v.email}${v.phone?' · '+v.phone:''}</div>`:''}
      ${pt?`<div style="margin-left:auto;font-size:0.72rem;padding:4px 10px;background:rgba(99,102,241,0.07);border:1px solid rgba(99,102,241,0.18);border-radius:5px;color:#6366f1;white-space:nowrap">💳 ${pt.label}</div>`:''}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
      <div>
        <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--gray-4);margin-bottom:10px;display:flex;align-items:center;gap:6px">
          📦 Orders <span style="background:var(--off-white);border:1px solid var(--border);border-radius:10px;padding:1px 7px;font-size:0.68rem">${orders.length}</span>
        </div>
        ${orders.length?`<div style="display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto">
          ${orders.map(o=>`<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--off-white);border:1px solid var(--border);border-radius:6px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:0.78rem">PR-${String(o.request_number).padStart(4,'0')}</div>
              <div style="font-size:0.7rem;color:var(--gray-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.project_name}</div>
              <div style="font-size:0.65rem;color:var(--gray-4)">${fmtDate(o.created_at)}</div>
            </div>
            ${getPhaseBadge(o.phase)}
          </div>`).join('')}
        </div>`:`<div style="padding:20px;text-align:center;background:var(--off-white);border:1px solid var(--border);border-radius:6px"><div style="font-size:1.5rem;margin-bottom:4px">📭</div><p style="color:var(--gray-4);font-size:0.78rem">No orders yet</p></div>`}
      </div>
      <div>
        <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--gray-4);margin-bottom:10px;display:flex;align-items:center;gap:6px">
          ⭐ Ratings <span style="background:var(--off-white);border:1px solid var(--border);border-radius:10px;padding:1px 7px;font-size:0.68rem">${ratings.length}</span>
        </div>
        ${ratings.length?`<div style="display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto">
          ${ratings.map(r=>{
            let tatR=0,qualR=0,noteText='';
            try{ const p=JSON.parse(r.comment||'{}'); tatR=p.tat||0; qualR=p.quality||0; noteText=p.note||''; }catch(e){ noteText=r.comment||''; }
            const hasDual = tatR>0 && qualR>0;
            function miniStars(n){ return [1,2,3,4,5].map(i=>`<span style="color:${i<=n?'#f59e0b':'#d1d5db'};font-size:0.75rem">★</span>`).join(''); }
            return `<div style="padding:9px 10px;background:var(--off-white);border:1px solid var(--border);border-radius:6px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px">
                <span style="color:#f59e0b;letter-spacing:1px;font-size:0.82rem">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}<span style="color:var(--gray-4);font-size:0.65rem;margin-left:4px">(overall)</span></span>
                <span style="font-size:0.65rem;color:var(--gray-4)">${fmtDate(r.created_at)}</span>
              </div>
              ${hasDual?`<div style="display:flex;gap:12px;padding:6px 8px;background:white;border:1px solid var(--border);border-radius:4px;margin-bottom:5px">
                <div><div style="font-size:0.6rem;color:var(--gray-4);font-weight:600;margin-bottom:2px">⏱ TAT</div><div>${miniStars(tatR)}</div></div>
                <div style="width:1px;background:var(--border)"></div>
                <div><div style="font-size:0.6rem;color:var(--gray-4);font-weight:600;margin-bottom:2px">✅ Quality</div><div>${miniStars(qualR)}</div></div>
              </div>`:''}
              <div style="font-size:0.7rem;color:var(--gray-4);margin-bottom:3px">${r.users?.name||'Unknown'}${r.procurement_requests?.project_name?' · '+r.procurement_requests.project_name:''}</div>
              ${noteText?`<p style="font-size:0.76rem;color:var(--gray-3);line-height:1.4">${noteText}</p>`:(!hasDual&&r.comment?`<p style="font-size:0.76rem;color:var(--gray-3);line-height:1.4">${r.comment}</p>`:'<p style="font-size:0.7rem;color:var(--gray-4);font-style:italic">No comment</p>')}
            </div>`;
          }).join('')}
        </div>`:`<div style="padding:20px;text-align:center;background:var(--off-white);border:1px solid var(--border);border-radius:6px"><div style="font-size:1.5rem;margin-bottom:4px">⭐</div><p style="color:var(--gray-4);font-size:0.78rem">No ratings yet</p></div>`}
      </div>
    </div>`;
}

// ── VENDOR ENQUIRY ───────────────────────────────────────────
function openVendorEnquiry(vendor) {
  if(typeof vendor === 'string') {
    try { vendor = JSON.parse(vendor.split('&quot;').join('"')); } catch(e) { return; }
  }
  let ov=document.getElementById('_vendorEnquiryModal');
  if(!ov){ov=document.createElement('div');ov.id='_vendorEnquiryModal';ov.className='modal-overlay';ov.onclick=e=>{if(e.target===ov)ov.classList.remove('active');};document.body.appendChild(ov);}
  const pt = PAYMENT_TERMS_OPTIONS.find(p=>p.value===vendor.payment_terms);
  ov.innerHTML=`<div class="modal" style="max-width:500px">
    <div class="modal-header"><div><div class="modal-title">${vendor.name}</div><div class="modal-title-sub">${vendor.specialization||'General Supplier'}</div></div><button class="modal-close" onclick="document.getElementById('_vendorEnquiryModal').classList.remove('active')">✕</button></div>
    <div class="modal-body">
      <div class="enquiry-contact-grid">
        <div><div class="enquiry-contact-label">Contact Person</div><div class="enquiry-contact-value">${vendor.contact_person||'—'}</div></div>
        <div><div class="enquiry-contact-label">Specialization</div><div class="enquiry-contact-value">${vendor.specialization||'—'}</div></div>
        <div><div class="enquiry-contact-label">Email</div><div class="enquiry-contact-value">${vendor.email?`<a href="mailto:${vendor.email}">${vendor.email}</a>`:'—'}</div></div>
        <div><div class="enquiry-contact-label">Phone</div><div class="enquiry-contact-value">${vendor.phone||'—'}</div></div>
        ${pt?`<div style="grid-column:1/-1"><div class="enquiry-contact-label">Payment Terms</div><div class="enquiry-contact-value" style="color:#6366f1">💳 ${pt.label}</div></div>`:''}
      </div>
      ${vendor.notes?`<div style="border-top:1px solid var(--border);padding-top:12px"><div class="detail-key" style="margin-bottom:5px">Notes</div><p style="font-size:0.8rem;color:var(--gray-3);line-height:1.5">${vendor.notes}</p></div>`:''}
      <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:13px"><div class="detail-key" style="margin-bottom:5px">Rating</div><div>${starRating(vendor.avg_rating,vendor.rating_count)}</div></div>
    </div>
    <div class="modal-footer">
      ${vendor.email?`<a href="mailto:${vendor.email}?subject=Enquiry%20from%20ProcureOps" class="btn btn-primary">✉ Send Email</a>`:''}
      <button class="btn btn-secondary" onclick="document.getElementById('_vendorEnquiryModal').classList.remove('active')">Close</button>
    </div>
  </div>`;
  ov.classList.add('active');
}

// ── COMMENTS  
// Cache of all users for @mention autocomplete
var _allUsersCache = null;
async function _loadAllUsers() {
  if (_allUsersCache && _allUsersCache.length) return _allUsersCache;
  const { data, error } = await db.from('users').select('id,name,email').order('name');
  if (error) { console.warn('_loadAllUsers failed:', error.message); return _allUsersCache || []; }
  _allUsersCache = data || [];
  return _allUsersCache;
}
window._loadAllUsers = _loadAllUsers;

window.loadComments = async function (prId) {
  const { data, error } = await db.from('pr_comments').select('*,users(name)').eq('pr_id', prId).order('created_at');
  if (error) { console.error("Load comments error:", error); return []; }
  return data || [];
};

window.postComment = async function(prId, userId, text) {
  if (!text?.trim()) return;
  const { error } = await db.from('pr_comments').insert({ pr_id: prId, user_id: userId, comment: text.trim() });
  if (error) throw error;
  // Extract @mentions and notify tagged users (matched against real user list)
  const targets = await resolveMentionedUsers(text, userId);
  if (targets.length > 0) {
    await sendMentionNotifications(prId, userId, text, targets);
  }
};

// Finds every "@..." occurrence in the text and matches it against the real
// user list, preferring the longest name match so multi-word names aren't
// cut short and single-word names don't swallow the next sentence word
// (e.g. "@Sandy please approve" must resolve to "Sandy", not "Sandy please").
async function resolveMentionedUsers(text, actorId) {
  const users = await _loadAllUsers();
  if (!users.length) return [];

  // Build every possible match string per user: the full name, plus each
  // leading-word prefix (e.g. "Sandy Mehta" -> ["sandy mehta", "sandy"]).
  // This lets "@Sandy please approve" resolve to "Sandy Mehta" using just
  // the first name, while "@Rajesh Kumar Patel" still prefers the fullest
  // match available for that user.
  const candidates = [];
  for (const u of users) {
    const words = u.name.toLowerCase().split(/\s+/).filter(Boolean);
    for (let i = words.length; i >= 1; i--) {
      candidates.push({ user: u, text: words.slice(0, i).join(' ') });
    }
  }
  // Longest candidate strings first, so fuller names win over shorter ones.
  candidates.sort((a, b) => b.text.length - a.text.length);

  const found = new Map(); // id -> user
  const atRe = /@/g;
  let m;
  while ((m = atRe.exec(text)) !== null) {
    const startIdx = m.index + 1;
    // Only consider the start of a mention (not mid-word, e.g. an email address)
    if (m.index > 0 && /\S/.test(text[m.index - 1])) continue;

    const rest = text.slice(startIdx);
    const restLower = rest.toLowerCase();

    for (const c of candidates) {
      if (restLower.startsWith(c.text)) {
        // Require the match to end at a word boundary (end of string,
        // whitespace, or punctuation) so "Sam" doesn't match inside "Samuel".
        const nextChar = rest[c.text.length];
        if (nextChar === undefined || /[^A-Za-z]/.test(nextChar)) {
          if (c.user.id !== actorId) found.set(c.user.id, c.user);
          break; // longest match already found for this @, stop here
        }
      }
    }
  }
  return [...found.values()];
}

async function sendMentionNotifications(prId, actorId, commentText, targets) {
  try {
    if (!targets?.length) return;
    const mentionedUserIds = targets.map(u => u.id);

    // Delegate to edge function — it handles both DB notification insert AND email.
    // NOTE: supabase-js functions.invoke() resolves with {data, error} on a
    // non-2xx response, it does NOT throw — so the error must be checked
    // explicitly or failures (and missing notification rows) go unnoticed.
    const { data, error } = await db.functions.invoke('notify-mention', {
      body: {
        pr_id:               prId,
        actor_id:            actorId,
        comment_text:        commentText,
        mentioned_user_ids:  mentionedUserIds,
      },
    });
    if (error) {
      console.error('notify-mention failed:', error.message || error, error.context || '');
    } else {
      console.log('notify-mention ok:', data);
    }
  } catch(e) {
    // Non-blocking — log but don't surface to user
    console.warn('Mention notification failed (non-blocking):', e?.message || e);
  }
}
window.sendMentionNotifications = sendMentionNotifications;
window.resolveMentionedUsers = resolveMentionedUsers;

function renderComments(comments) {
  if(!comments.length) return '<p style="color:var(--gray-4);font-size:0.78rem;text-align:center;padding:14px 0">No comments yet</p>';
  return `<div class="comment-list">${comments.map(c=>`
    <div class="comment-item">
      <div class="comment-avatar">${(c.users?.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
      <div class="comment-bubble">
        <div class="comment-meta">${c.users?.name||'Unknown'} · ${fmtDateTime(c.created_at)}</div>
        <div class="comment-text">${highlightMentions(c.comment)}</div>
      </div>
    </div>`).join('')}</div>`;
}

function highlightMentions(text) {
  if (!text) return '';
  // Escape HTML first
  const safe = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Highlight @mentions
  return safe.replace(/@([A-Za-z]+(?:\s+[A-Za-z]+)?)/g,
    '<span style="color:#6366f1;font-weight:600;background:rgba(99,102,241,0.08);border-radius:3px;padding:0 3px">@$1</span>'
  );
}

// ── BOM PARSER (CSV + XLSX) ─────────────────────────────────────────────
// Exact BOM Template Columns (positions A→I):
//   A: Sr. No.
//   B: Part Number
//   C: Part Name  ← REQUIRED
//   D: Material Specifications
//   E: Department  (Electronics / ID / Mechanical / General Hardware / Others)
//   F: Quantity (per Set)
//   G: Unit of Measurement  (per-set unit)
//   H: Total Qty
//   I: Unit of Measurement  (total unit)

function parseBOMRows(rows) {
  if (!rows || rows.length < 2) throw new Error('File has no data rows');

  // Normalize header (handles merged headers, extra rows, etc.)
  // Try up to row 3 to find the header row (some templates have title rows above)
  var headerRowIdx = 0;
  for (var h = 0; h < Math.min(3, rows.length); h++) {
    var testH = rows[h].map(function(c){ return String(c||'').toLowerCase().trim(); });
    if (testH.some(function(c){ return c.includes('part name') || c.includes('item name') || c.includes('part number'); })) {
      headerRowIdx = h;
      break;
    }
  }

  var header = rows[headerRowIdx].map(function(h){ return String(h||'').toLowerCase().trim(); });

  // Map exact template positions — fall back to flexible detection
  function col(tests, exactPos) {
    if (exactPos !== undefined && !header[exactPos]?.includes('uom') && !header[exactPos]?.includes('unit')) {
      // exact positional match — check it's roughly right
    }
    for (var t of tests) {
      var i = header.findIndex(function(c){ return c.includes(t); });
      if (i >= 0) return i;
    }
    return -1;
  }

  // Template: A=Sr.No B=PartNo C=PartName D=MatSpec E=Dept F=QtyPerSet G=UOM H=TotalQty I=TotalUOM
  var snoIdx    = col(['sr. no','sr no','s.no','sno','#','sl no','serial']);
  var partNoIdx = col(['part number','part no','pn','code','item code']);
  var nameIdx   = col(['part name','item name','name','description']); // Col C
  var specIdx   = col(['material spec','specification','spec','material description','material']); // Col D
  var deptIdx   = col(['department','dept']); // Col E
  var qtySetIdx = col(['quantity (per','qty (per','per set','quantity per set']); // Col F
  var uomSetIdx = -1; // Col G — first "unit of measurement" that isn't col I
  var totalQtyIdx = col(['total qty','total quantity']); // Col H
  var totalUomIdx = -1; // Col I — second "unit of measurement"

  // Find the two UOM columns (G and I)
  var uomPositions = [];
  header.forEach(function(h, i) {
    if (h === 'unit of measurement' || h === 'uom' || h === 'unit') uomPositions.push(i);
  });
  if (uomPositions.length >= 1) uomSetIdx   = uomPositions[0];
  if (uomPositions.length >= 2) totalUomIdx = uomPositions[1];

  if (nameIdx < 0) throw new Error('Could not find "Part Name" column. Please use the official BOM template.');

  var parts = [];
  for (var r = headerRowIdx + 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row || row.every(function(c){ return !String(c||'').trim(); })) continue;

    var rawName = String(row[nameIdx] || '').trim();
    if (!rawName || rawName.toLowerCase() === 'nan' || rawName.toLowerCase() === 'example') continue;

    var partNo   = partNoIdx >= 0 ? String(row[partNoIdx] || '').trim() : '';
    var matSpec  = specIdx   >= 0 ? String(row[specIdx]   || '').trim() : '';
    var dept     = deptIdx   >= 0 ? String(row[deptIdx]   || '').trim() : '';
    // Normalize dept to allowed values
    var deptNorm = '';
    if (dept) {
      var dl = dept.toLowerCase();
      if (dl.includes('electron'))       deptNorm = 'Electronics';
      else if (dl.includes('id')||dl.includes('industrial')) deptNorm = 'ID';
      else if (dl.includes('mech'))      deptNorm = 'Mechanical';
      else if (dl.includes('hardware'))  deptNorm = 'General Hardware';
      else if (dl.includes('other'))     deptNorm = 'Others';
      else                               deptNorm = dept; // keep as-is
    }

    // Qty: prefer Total Qty (col H) if available and non-zero, else Qty per Set (col F)
    var totalQtyRaw = totalQtyIdx >= 0 ? String(row[totalQtyIdx] || '').replace(/[^0-9.]/g, '') : '';
    var qtySetRaw   = qtySetIdx   >= 0 ? String(row[qtySetIdx]   || '').replace(/[^0-9.]/g, '') : '';
    var qty = parseInt(totalQtyRaw) || parseInt(qtySetRaw) || 1;

    // UOM: prefer total UOM (col I) if available, else per-set UOM (col G)
    var totalUom = totalUomIdx >= 0 ? String(row[totalUomIdx] || '').trim() : '';
    var setUom   = uomSetIdx   >= 0 ? String(row[uomSetIdx]   || '').trim() : '';
    var uom = totalUom || setUom || 'pcs';

    // Part Number enrichment
    var partNoStr = (partNo && partNo !== 'NA' && partNo !== 'na') ? partNo : '';

    parts.push({
      name:       rawName,
      qty:        qty,
      uom:        uom,
      department: deptNorm,
      spec:       matSpec,
      part_number: partNoStr,
    });
  }

  if (!parts.length) throw new Error('No valid parts found. Please check your BOM file.');
  return parts;
}

function parseCSVToRows(text) {
  var lines = text.split(/\r?\n/);
  return lines.map(function(line){
    var result=[], cur='', inQ=false;
    for(var i=0;i<line.length;i++){
      if(line[i]==='"'){inQ=!inQ;}
      else if(line[i]===','&&!inQ){result.push(cur.trim());cur='';}
      else{cur+=line[i];}
    }
    result.push(cur.trim());
    return result.map(function(c){ return c.replace(/^"|"$/g,''); });
  }).filter(function(r){ return r.length > 1 || (r.length===1 && r[0]); });
}

function parseBOMFile(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    var isCSV  = /\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv';
    var isXLSX = /\.(xlsx|xls|xlsm|ods)$/i.test(file.name) || file.type.includes('spreadsheet') || file.type.includes('excel');

    if (isCSV) {
      reader.onload = function(e) {
        try { resolve(parseBOMRows(parseCSVToRows(e.target.result))); }
        catch(err) { reject(err); }
      };
      reader.readAsText(file);
    } else if (isXLSX) {
      if (typeof XLSX === 'undefined') { reject(new Error('XLSX library not loaded — please refresh.')); return; }
      reader.onload = function(e) {
        try {
          var wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
          // Prefer "BoM" sheet, then first sheet
          var sheetName = wb.SheetNames.find(function(n){ return n.toLowerCase().replace(/\s/g,'').includes('bom'); }) || wb.SheetNames[0];
          var ws = wb.Sheets[sheetName];
          var rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
          resolve(parseBOMRows(rows));
        } catch(err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reject(new Error('Unsupported file type. Please upload a CSV or Excel (.xlsx) file.'));
    }
  });
}

// ── PARTS EDITOR ─────────────────────────────────────────────
var _partsEditorRows = _partsEditorRows || [];
var _partsEditorProductionMode = false; // true when project phase is "Production"
var _partsCatalogCache = null; // in-memory cache to avoid re-fetching

function initPartsEditor(containerId, initialParts=[], productionMode=false) {
  _partsEditorRows = initialParts.map((p,i)=>({...p,_id:p._id||i}));
  _partsEditorProductionMode = productionMode;
  renderPartsEditor(containerId);
  if (productionMode && !_partsCatalogCache) _preloadPartsCatalog();
}
window.initPartsEditor = initPartsEditor;

// Pre-fetch parts catalog so autocomplete feels instant
async function _preloadPartsCatalog() {
  try {
    const { data } = await db.from('parts_catalog')
      .select('id,part_number,part_name,category,unit,description')
      .order('part_number');
    _partsCatalogCache = data || [];
  } catch(e) { _partsCatalogCache = []; }
}
const DEPT_OPTIONS = [
  {val:'',label:'— Dept —'},
  {val:'npd',label:'Production & Operations - NPD'},
  {val:'electronics',label:'Production & Operations - Electronics'},
  {val:'id',label:'Industrial Design'},
  {val:'assembly',label:'Production & Operations - Assembly'},
  {val:'scm_stores',label:'SCM - Stores & Logistics'},
  {val:'service',label:'Production & Operations - Service'},
  {val:'machine_shop',label:'Production & Operations - Machine Shop'},
  {val:'quality',label:'Production & Operations - Quality'},
  {val:'mech_design',label:'Mechanical Design Engineering'},
  {val:'other',label:'Other'},
];
function renderPartsEditor(containerId) {
  const c=document.getElementById(containerId); if(!c) return;
  const pm = _partsEditorProductionMode;
  c.innerHTML=`
    ${pm ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px 12px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.2);border-radius:6px;font-size:0.78rem;color:#6366f1">
      🔩 <strong>Production mode</strong> — Part numbers are required. Use the search to auto-fill from catalog.
    </div>` : ''}
    <div style="overflow-x:auto">
    <table class="parts-table" style="width:100%;min-width:${pm?'720':'600'}px">
      <thead><tr>
        <th style="width:28px">#</th>
        ${pm ? `<th style="width:120px">Part Number *</th>` : ''}
        <th>Part Name *</th>
        <th style="width:65px">Qty *</th>
        <th style="width:50px">UOM</th>
        <th style="width:110px">Department</th>
        <th>Material Spec</th>
        <th style="width:36px"></th>
      </tr></thead>
      <tbody id="partsRows">${_partsEditorRows.map((p,i)=>partsRowHTML(i,p)).join('')}</tbody>
    </table>
    </div>
    <button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px;border:1px dashed var(--border-strong)" onclick="addPartsRow('${containerId}')">+ Add Part</button>
  `;
}
function partsRowHTML(i, p={}) {
  const deptOpts = DEPT_OPTIONS.map(d=>`<option value="${d.val}" ${(p.department||'')==d.val?'selected':''}>${d.label}</option>`).join('');
  const pm = _partsEditorProductionMode;
  const rid = p._id??i;
  const partNumCell = pm ? `<td style="position:relative">
    <input type="text" class="parts-table part-num-input" id="pnum-${rid}"
      placeholder="Search #…" value="${p.part_number||''}"
      autocomplete="off"
      oninput="onPartNumInput(${rid}, this.value, 'partsEditorContainer')"
      onchange="updatePartField(${rid},'part_number',this.value)"
      style="width:100%;border:1px solid var(--border);border-radius:4px;font-family:var(--font-mono);font-size:0.75rem;padding:3px 6px;background:white"/>
    <div id="pnum-dropdown-${rid}" style="display:none;position:absolute;z-index:9999;left:0;top:100%;min-width:260px;max-height:200px;overflow-y:auto;background:white;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.12)"></div>
  </td>` : '';
  return `<tr id="prow-${rid}">
    <td style="color:var(--gray-4);text-align:center;font-family:var(--font-mono);font-size:0.72rem">${i+1}</td>
    ${partNumCell}
    <td><input type="text" class="parts-table" id="pname-${rid}" placeholder="e.g. M8 Bolt" value="${p.name||''}" onchange="updatePartField(${rid},'name',this.value)" style="width:100%;border:none;outline:none;font-family:var(--font-body);font-size:0.82rem;padding:2px 4px;background:transparent"/></td>
    <td><div class="qty-cell">
      <button type="button" class="qty-btn" onclick="changeQty(${rid},-1)">−</button>
      <input type="number" class="qty-input" value="${p.qty||1}" min="1" onchange="updatePartField(${rid},'qty',+this.value||1)"/>
      <button type="button" class="qty-btn" onclick="changeQty(${rid},1)">+</button>
    </div></td>
    <td><input type="text" id="puom-${rid}" placeholder="pcs" value="${p.uom||''}" onchange="updatePartField(${rid},'uom',this.value)" style="width:100%;border:none;outline:none;font-size:0.78rem;padding:2px 4px;background:transparent;text-align:center"/></td>
    <td><select onchange="updatePartField(${rid},'department',this.value)" style="width:100%;border:1px solid var(--border);border-radius:4px;font-size:0.75rem;padding:2px 4px;background:white">${deptOpts}</select></td>
    <td><input type="text" id="pspec-${rid}" placeholder="Material, grade, dimensions..." value="${p.spec||''}" onchange="updatePartField(${rid},'spec',this.value)" style="width:100%;border:none;outline:none;font-family:var(--font-body);font-size:0.82rem;padding:2px 4px;background:transparent"/></td>
    <td><button type="button" class="btn btn-danger btn-sm" style="padding:3px 7px" onclick="removePartsRow(${rid},'partsEditorContainer')">✕</button></td>
  </tr>`;
}

// ── Catalog autocomplete for production mode ──────────────────
async function onPartNumInput(rowId, query, containerId) {
  updatePartField(rowId, 'part_number', query);
  const dd = document.getElementById(`pnum-dropdown-${rowId}`);
  if (!dd) return;
  if (!query || query.length < 1) { dd.style.display='none'; return; }

  // Ensure catalog is loaded
  if (!_partsCatalogCache) await _preloadPartsCatalog();

  const q = query.toLowerCase();
  const matches = (_partsCatalogCache||[]).filter(p =>
    p.part_number.toLowerCase().includes(q) ||
    p.part_name.toLowerCase().includes(q)
  ).slice(0, 10);

  if (!matches.length) { dd.style.display='none'; return; }

  // Store matches in a temporary lookup so onclick can reference by index (avoids HTML-attribute JSON escaping issues)
  dd._catalogMatches = matches;

  dd.style.display = 'block';
  dd.innerHTML = matches.map((p, idx) => `
    <div data-catalog-idx="${idx}"
         style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;transition:background 0.1s"
         onmouseover="this.style.background='rgba(99,102,241,0.06)'"
         onmouseout="this.style.background='white'">
      <span style="font-family:var(--font-mono);font-size:0.75rem;font-weight:700;color:#6366f1;min-width:80px">${p.part_number}</span>
      <div>
        <div style="font-size:0.8rem;font-weight:600">${p.part_name}</div>
        ${p.category ? `<div style="font-size:0.7rem;color:var(--gray-4)">${p.category}${p.unit?' · '+p.unit:''}</div>` : ''}
      </div>
    </div>
  `).join('');

  // Attach click handlers via JS (not inline onclick) to avoid HTML-attribute JSON escaping issues
  dd.querySelectorAll('[data-catalog-idx]').forEach(el => {
    el.addEventListener('mousedown', function(e) {
      e.preventDefault(); // prevent input blur before we can read value
      const part = dd._catalogMatches[+el.dataset.catalogIdx];
      if (part) selectCatalogPart(rowId, part, containerId);
    });
  });

  // Close on outside click
  document.addEventListener('click', function _closer(e){
    if(!dd.contains(e.target) && e.target.id !== `pnum-${rowId}`){
      dd.style.display='none';
      document.removeEventListener('click',_closer);
    }
  });
}

function selectCatalogPart(rowId, partOrJson, containerId) {
  const part = (typeof partOrJson === 'string') ? JSON.parse(partOrJson) : partOrJson;
  const r = _partsEditorRows.find(r => r._id === rowId);
  if (r) {
    r.part_number = part.part_number;
    r.name        = part.part_name;
    r.uom         = part.unit || r.uom || 'pcs';
    r.spec        = part.description || r.spec || '';
    r.catalog_id  = part.id;
  }
  // Update DOM fields directly (avoid full re-render which loses focus)
  const pnum = document.getElementById(`pnum-${rowId}`);
  if (pnum) pnum.value = part.part_number;
  const pname = document.getElementById(`pname-${rowId}`);
  if (pname) pname.value = part.part_name;
  const puom = document.getElementById(`puom-${rowId}`);
  if (puom) puom.value = part.unit || 'pcs';
  const pspec = document.getElementById(`pspec-${rowId}`);
  if (pspec) pspec.value = part.description || '';
  const dd = document.getElementById(`pnum-dropdown-${rowId}`);
  if (dd) dd.style.display = 'none';
}
function addPartsRow(containerId) {
  const id=Date.now();
  _partsEditorRows.push({_id:id,part_number:'',name:'',qty:1,uom:'pcs',department:'',spec:''});
  renderPartsEditor(containerId);
}
function removePartsRow(rowId, containerId) {
  _partsEditorRows=_partsEditorRows.filter(r=>r._id!==rowId);
  renderPartsEditor(containerId||'partsEditorContainer');
}
function updatePartField(rowId, field, value) {
  const r=_partsEditorRows.find(r=>r._id===rowId); if(r) r[field]=value;
}
function changeQty(rowId, delta) {
  const r=_partsEditorRows.find(r=>r._id===rowId); if(!r) return;
  r.qty=Math.max(1,(r.qty||1)+delta);
  const input=document.querySelector(`#prow-${rowId} .qty-input`); if(input) input.value=r.qty;
}
function getPartsFromEditor() {
  _partsEditorRows.forEach(r=>{
    const row=document.getElementById(`prow-${r._id}`); if(!row) return;
    const inputs=row.querySelectorAll('input');
    const selects=row.querySelectorAll('select');
    if(_partsEditorProductionMode){
      // In production mode columns: part_number(0), name(1), qty(2), uom(3), spec(4)
      if(inputs[0]) r.part_number=inputs[0].value.trim();
      if(inputs[1]) r.name=inputs[1].value.trim();
      if(inputs[2]) r.qty=+inputs[2].value||1;
      if(inputs[3]) r.uom=inputs[3].value.trim();
      if(selects[0]) r.department=selects[0].value;
      if(inputs[4]) r.spec=inputs[4].value.trim();
    } else {
      if(inputs[0]) r.name=inputs[0].value.trim();
      if(inputs[1]) r.qty=+inputs[1].value||1;
      if(inputs[2]) r.uom=inputs[2].value.trim();
      if(selects[0]) r.department=selects[0].value;
      if(inputs[3]) r.spec=inputs[3].value.trim();
    }
  });
  return _partsEditorRows.filter(r=>r.name).map(({part_number,catalog_id,name,qty,uom,department,spec})=>({
    part_number: part_number||'', catalog_id: catalog_id||null,
    name, qty:qty||1, uom:uom||'pcs', department:department||'', spec:spec||''
  }));
}

// Expose parts-editor functions called from inline HTML attributes
window.addPartsRow        = addPartsRow;
window.removePartsRow     = removePartsRow;
window.updatePartField    = updatePartField;
window.changeQty          = changeQty;
window.getPartsFromEditor = getPartsFromEditor;
window.onPartNumInput     = onPartNumInput;
window.selectCatalogPart  = selectCatalogPart;

}
// ── SHARED NOTIFICATION BELL ─────────────────────────────────────────────
// Call window.initNotifBell(currentUser, openPRCallback) once after login.
window.initNotifBell = function(currentUser, openPRFn) {
  if (!currentUser) return;

  async function loadAndRender() {
    try {
      const { data } = await db.from('notifications')
        .select('*').eq('user_id', currentUser.id).eq('is_read', false)
        .order('created_at', { ascending: false }).limit(30);
      _renderBell(data || []);
    } catch(e) { console.warn('Notif load failed', e); }
  }

  function _renderBell(items) {
    let bell = document.getElementById('notifBell');
    if (!bell) {
      const anchor = document.querySelector('.page-header, .topbar, nav, header');
      if (!anchor) return;
      bell = document.createElement('div');
      bell.id = 'notifBell';
      bell.style.cssText = 'position:relative;display:inline-flex;align-items:center;cursor:pointer;margin-left:10px;vertical-align:middle';
      bell.innerHTML = [
        '<button id="notifBellBtn" style="background:none;border:none;cursor:pointer;font-size:1.25rem;position:relative;padding:4px 6px;line-height:1" title="Notifications">',
        '  \uD83D\uDD14',
        '  <span id="notifDot" style="display:none;position:absolute;top:3px;right:3px;width:8px;height:8px;background:#ef4444;border-radius:50%;border:2px solid white"></span>',
        '</button>',
        '<div id="notifPanel" style="display:none;position:absolute;top:calc(100% + 6px);right:0;width:330px;max-height:400px;overflow-y:auto;background:white;border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,0.16);z-index:10000">',
        '  <div style="padding:11px 14px;border-bottom:1px solid var(--border);font-weight:600;font-size:0.85rem;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:white;z-index:1">',
        '    \uD83D\uDD14 Notifications',
        '    <button id="notifMarkAll" style="font-size:0.72rem;color:#6366f1;background:none;border:none;cursor:pointer;font-weight:500">Mark all read</button>',
        '  </div>',
        '  <div id="notifList"></div>',
        '</div>'
      ].join('');
      anchor.appendChild(bell);

      document.getElementById('notifBellBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        var p = document.getElementById('notifPanel');
        var isOpen = p.style.display !== 'none';
        p.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) {
          setTimeout(function() {
            document.addEventListener('click', function _nc(e2) {
              if (!bell.contains(e2.target)) {
                p.style.display = 'none';
                document.removeEventListener('click', _nc);
              }
            });
          }, 0);
        }
      });

      document.getElementById('notifMarkAll').addEventListener('click', async function() {
        try { await db.from('notifications').update({ is_read: true }).eq('user_id', currentUser.id).eq('is_read', false); } catch(e) {}
        await loadAndRender();
      });
    }

    var dot = document.getElementById('notifDot');
    if (dot) dot.style.display = items.length ? 'block' : 'none';

    var list = document.getElementById('notifList');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div style="padding:28px 16px;text-align:center;color:var(--gray-4);font-size:0.8rem">\u2705 You\'re all caught up!</div>';
      return;
    }

    list.innerHTML = items.map(function(n) {
      var msg = (n.message||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      var ts  = typeof fmtDateTime === 'function' ? fmtDateTime(n.created_at) : n.created_at;
      return '<div class="_notif-item" data-id="'+n.id+'" data-pr="'+(n.pr_id||'')+'" '+
        'style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.12s" '+
        'onmouseover="this.style.background=\'rgba(99,102,241,0.05)\'" onmouseout="this.style.background=\'white\'">'+
        '<div style="font-size:0.79rem;color:var(--gray-1);line-height:1.45">'+msg+'</div>'+
        '<div style="font-size:0.68rem;color:var(--gray-4);margin-top:3px">'+ts+'</div>'+
        '</div>';
    }).join('');

    list.querySelectorAll('._notif-item').forEach(function(el) {
      el.addEventListener('click', async function() {
        var nid = el.dataset.id, prId = el.dataset.pr;
        try { await db.from('notifications').update({ is_read: true }).eq('id', nid); } catch(e) {}
        var p = document.getElementById('notifPanel');
        if (p) p.style.display = 'none';
        if (prId && typeof openPRFn === 'function') openPRFn(prId);
        await loadAndRender();
      });
    });
  }

  loadAndRender();
  setInterval(loadAndRender, 60000);
};

// ── SHARED COMMENT BOX WITH @MENTION ─────────────────────────────────────
// Call window.initCommentBox(inputId, dropdownId) after the modal renders.
window.initCommentBox = function(inputId, dropdownId) {
  var _mentionStart = -1;
  var input = document.getElementById(inputId);
  var dd    = document.getElementById(dropdownId);
  if (!input || !dd) return;

  input.addEventListener('input', async function() {
    var text   = input.value;
    var cursor = input.selectionStart;
    var before = text.slice(0, cursor);
    var atIdx  = before.lastIndexOf('@');

    if (atIdx === -1 || (atIdx > 0 && /\S/.test(before[atIdx - 1]))) {
      dd.style.display = 'none'; _mentionStart = -1; return;
    }
    var query = before.slice(atIdx + 1);
    if (query.length > 25 || /\s{2}/.test(query)) { dd.style.display = 'none'; return; }
    _mentionStart = atIdx;

    var users = await window._loadAllUsers();
    var q = query.toLowerCase();
    var matches = users.filter(function(u) { return u.name.toLowerCase().includes(q); }).slice(0, 8);
    if (!matches.length) { dd.style.display = 'none'; return; }

    dd.style.display = 'block';
    dd.innerHTML = matches.map(function(u) {
      var initials = u.name.split(' ').map(function(n){ return n[0]; }).join('').slice(0,2);
      var safeName = u.name.replace(/</g,'&lt;').replace(/"/g,'&quot;');
      return '<div data-name="'+safeName+'" '+
        'style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)" '+
        'onmouseover="this.style.background=\'rgba(99,102,241,0.07)\'" onmouseout="this.style.background=\'white\'">'+
        '<div style="width:27px;height:27px;border-radius:50%;background:rgba(99,102,241,0.14);display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;color:#6366f1;flex-shrink:0">'+initials+'</div>'+
        '<span style="font-size:0.82rem;font-weight:500">'+u.name.replace(/</g,'&lt;')+'</span>'+
        '</div>';
    }).join('');

    dd.querySelectorAll('[data-name]').forEach(function(el) {
      el.addEventListener('mousedown', function(e) {
        e.preventDefault();
        var name = el.dataset.name;
        var t    = input.value;
        var bef  = t.slice(0, _mentionStart);
        var aft  = t.slice(input.selectionStart);
        input.value = bef + '@' + name + ' ' + aft;
        var pos = bef.length + name.length + 2;
        input.setSelectionRange(pos, pos);
        dd.style.display = 'none';
        _mentionStart = -1;
        input.focus();
      });
    });
  });
};

// Shared renderComments exposed for all pages
window.renderComments = window.renderComments || function(comments) {
  if (!comments || !comments.length)
    return '<p style="color:var(--gray-4);font-size:0.78rem;text-align:center;padding:14px 0">No comments yet</p>';
  function _hlMention(text) {
    if (!text) return '';
    var safe = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return safe.replace(/@([A-Za-z]+(?:\s+[A-Za-z]+)?)/g,
      '<span style="color:#6366f1;font-weight:600;background:rgba(99,102,241,0.08);border-radius:3px;padding:0 3px">@$1</span>'
    );
  }
  return '<div class="comment-list">'+comments.map(function(c) {
    var initials = (c.users&&c.users.name?c.users.name:'?').split(' ').map(function(n){return n[0];}).join('').slice(0,2);
    var name     = c.users&&c.users.name ? c.users.name : 'Unknown';
    var ts       = typeof fmtDateTime==='function' ? fmtDateTime(c.created_at) : c.created_at;
    return '<div class="comment-item">'+
      '<div class="comment-avatar">'+initials+'</div>'+
      '<div class="comment-bubble">'+
        '<div class="comment-meta">'+name+' \u00B7 '+ts+'</div>'+
        '<div class="comment-text">'+_hlMention(c.comment)+'</div>'+
      '</div>'+
      '</div>';
  }).join('')+'</div>';
};
