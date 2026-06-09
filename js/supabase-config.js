// ============================================================
// SUPABASE CONFIGURATION
// Replace with your actual Supabase project URL and anon key
// ============================================================

const SUPABASE_URL = 'https://jjoipvugyingxhddszcc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqb2lwdnVneWluZ3hoZGRzemNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzgyMDcsImV4cCI6MjA5MzExNDIwN30.n2Eq0m0P5uaKOLlz4648zl3aW2o79Zyt_gkBFB9XnWM';
const { createClient } = supabase;

// _appUserId is set after login. The db client is recreated with the
// user ID in global headers so every PostgREST call carries x-app-user-id,
// which RLS policies read via public.app_user_id().
let _appUserId = null;
let db = _makeClient(null);

function _makeClient(userId) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: userId ? { 'x-app-user-id': userId } : {}
    }
  });
}

// Call after login and on every page load.
function setAppUser(user) {
  if (user && user.id) {
    _appUserId = user.id;
    // Recreate the client with the user ID header baked in.
    // All existing code that uses `db` will automatically use the new client
    // because they reference the module-level `db` variable.
    db = _makeClient(user.id);
  } else {
    _appUserId = null;
    db = _makeClient(null);
  }
}
// ============================================================
// SUPABASE CONFIGURATION — ProcureOps v2
// Replace YOUR_SUPABASE_URL and YOUR_SUPABASE_ANON_KEY below
// ============================================================


// ============================================================
// SESSION
// ============================================================
const Session = {
  set(user) {
    localStorage.setItem('procurement_user', JSON.stringify(user));
    setAppUser(user);
  },
  get() {
    const u = localStorage.getItem('procurement_user');
    const user = u ? JSON.parse(u) : null;
    if (user) setAppUser(user); // restore headers on every page load
    return user;
  },
  clear() { localStorage.removeItem('procurement_user'); },
  require(allowedRoles) {
    const user = this.get();
    if (!user) { window.location.href = '../index.html'; return null; }
    if (allowedRoles && !allowedRoles.includes(user.role)) { alert('Access denied.'); window.location.href = '../index.html'; return null; }
    return user;
  }
};

// ============================================================
// UPDATED PHASES — New workflow
// ============================================================
const PHASES = {
  submitted:                    { label: 'Submitted',                color: '#6366f1', icon: '📋' },
  pending_initial_pm_approval:  { label: 'Awaiting PM Clearance',   color: '#f59e0b', icon: '🔐' },
  procurement_active:           { label: 'Procurement Active',       color: '#3b82f6', icon: '⚙️'  },
  vendor_info_shared:           { label: 'Vendor Info Shared',       color: '#8b5cf6', icon: '🏢' },
  quotations_shared:            { label: 'Quotations Shared',        color: '#8b5cf6', icon: '📨' },
  pending_client_approval:      { label: 'Pending Client Approval',  color: '#ec4899', icon: '👤' },
  pending_pm_final_approval:    { label: 'Pending PM Approval',      color: '#f97316', icon: '✍️'  },
  pending_sandy_approval:        { label: 'Awaiting Director Approval', color: '#7c3aed', icon: '👤' },
  approved:                     { label: 'Approved',                 color: '#10b981', icon: '✅' },
  advance_requested:            { label: 'Advance Requested',        color: '#f59e0b', icon: '💳' },
  advance_approved:             { label: 'Advance Approved',         color: '#22c55e', icon: '💳' },
  advance_rejected:             { label: 'Advance Rejected',         color: '#ef4444', icon: '💳' },
  advance_raised_to_accounts:   { label: 'Advance Raised',           color: '#f59e0b', icon: '📤' },
  advance_payment_received:     { label: 'Advance Received',         color: '#22c55e', icon: '💳' },
  order_placed:                 { label: 'Order Placed',             color: '#14b8a6', icon: '🛒' },
  grn_pending:                  { label: 'GRN / QC Pending',         color: '#f59e0b', icon: '📦' },
  qc_passed:                    { label: 'QC Passed',                color: '#22c55e', icon: '✔️'  },
  payment_requested:            { label: 'Payment Requested',        color: '#8b5cf6', icon: '💰' },
  payment_raised_to_accounts:   { label: 'Payment Raised',           color: '#8b5cf6', icon: '📤' },
  payment_received:             { label: 'Payment Received',         color: '#22c55e', icon: '✅' },
  accepted:                     { label: 'Accepted & Closed',        color: '#22c55e', icon: '✔️'  },
  rejected:                     { label: 'Rejected & Closed',        color: '#ef4444', icon: '✖️'  },
  declined:                     { label: 'Declined & Closed',        color: '#6b7280', icon: '🚫' },
  lp_submitted:                 { label: 'LP Submitted',             color: '#6366f1', icon: '📋' },
  lp_pending_pm_approval:       { label: 'LP — Awaiting PM Approval',  color: '#f59e0b', icon: '⏳' },
  lp_procurement_processing:    { label: 'LP — With Procurement',      color: '#3b82f6', icon: '🛒' },
  lp_payment_pending:           { label: 'LP — Payment Pending',       color: '#f97316', icon: '💳' },
  lp_rejected:                  { label: 'LP Rejected & Closed',    color: '#ef4444', icon: '✖️'  },
  lp_payment_done:              { label: 'LP — Payment Done',          color: '#22c55e', icon: '✅' },
  qc_rejected:                  { label: 'QC Rejected & Closed',     color: '#ef4444', icon: '✖️'  },
  payment_received:             { label: 'Payment Received & Closed',color: '#22c55e', icon: '✅' }
};

// Phases that represent a fully closed/terminal request — no further actions possible
const CLOSED_PHASES = new Set([
  'declined',
  'rejected',
  'lp_payment_done',
  'accepted',
  'qc_rejected',
  'payment_received',
  'lp_rejected',
]);

// ── PIPELINE DEFINITIONS ─────────────────────────────────────
// Each pipeline lists only the phases relevant to that request type.
// Used by the workflow track renderer and the Admin Pipeline Editor.
const PIPELINES = {
  RFQ: {
    label: 'RFQ (Request for Quotation)',
    color: '#6366f1',
    phases: [
      'submitted',
      'pending_initial_pm_approval',
      'procurement_active',
      'quotations_shared',
      'quotes_revision_requested',
      'pending_pm_final_approval',
      'pending_sandy_approval',
      'approved',
      'advance_raised_to_accounts',
      'advance_payment_received',
      'order_placed',
      'grn_initiated',
      'qc_pending',
      'rework_pending',
      'rework_returned',
      'rework2_pending',
      'rework2_returned',
      'qc_deviated',
      'deviation_approval',
      'qc_passed',
      'payment_raised_to_accounts',
      'accepted',
    ],
    terminal: ['accepted', 'rejected', 'declined', 'qc_rejected'],
  },
  local_purchase: {
    label: 'Local Purchase',
    color: '#22c55e',
    phases: [
      'lp_submitted',
      'lp_pending_pm_approval',
      'lp_procurement_processing',
      'lp_payment_pending',
      'lp_payment_done',
    ],
    terminal: ['lp_payment_done', 'lp_rejected'],
  },
  vendor_info: {
    label: 'Vendor Info Request',
    color: '#8b5cf6',
    phases: [
      'submitted',
      'pending_initial_pm_approval',
      'procurement_active',
      'vendor_info_shared',
    ],
    terminal: ['vendor_info_shared', 'rejected', 'declined'],
  },
};

// Returns which pipeline a PR belongs to
function getPRPipeline(pr) {
  if (pr.request_category === 'local_purchase') return PIPELINES.local_purchase;
  if (pr.request_category === 'vendor_info') return PIPELINES.vendor_info;
  return PIPELINES.RFQ;
}

// Resolve pipeline phases for a given request category string
function getPipelinePhases(requestCategory) {
  const key = requestCategory === 'local_purchase' ? 'local_purchase'
             : requestCategory === 'vendor_info'    ? 'vendor_info'
             : 'RFQ';
  return PIPELINES[key]?.phases || PIPELINES.RFQ.phases;
}

// ── WORKFLOW STEP DEFINITIONS (used by renderWorkflowTrack + admin pipeline editor) ──
// Defined here so admin.html (which doesn't load shared.js) can access it too.
const PIPELINE_WF_STEPS = {
  RFQ: [
    {key:'submitted',label:'Submitted'},
    {key:'pending_initial_pm_approval',label:'PM Clearance',optional:true},
    {key:'procurement_active',label:'Procurement'},
    {key:'quotations_shared',label:'Quotations'},
    {key:'quotes_revision_requested',label:'Quote Revision',optional:true},
    {key:'pending_pm_final_approval',label:'PM Approval'},
    {key:'pending_decline_approval',label:'Decline → PM',optional:true},
    {key:'pending_sandy_approval',label:'Director Approval',optional:true},
    {key:'approved',label:'Approved'},
    {key:'advance_raised_to_accounts',label:'Adv. Raised',optional:true},
    {key:'advance_payment_received',label:'Adv. Received',optional:true},
    {key:'order_placed',label:'Ordered'},
    {key:'grn_initiated',label:'GRN → Store'},
    {key:'qc_pending',label:'QC Check'},
    {key:'rework_pending',label:'Rework',optional:true},
    {key:'rework_returned',label:'Rework Return',optional:true},
    {key:'rework2_pending',label:'2nd Rework',optional:true},
    {key:'rework2_returned',label:'2nd Return',optional:true},
    {key:'qc_deviated',label:'Deviated',optional:true},
    {key:'deviation_approval',label:'Deviation Review',optional:true},
    {key:'qc_passed',label:'QC Passed'},
    {key:'payment_raised_to_accounts',label:'Pay. Raised'},
    {key:'accepted',label:'Complete'}
  ],
  local_purchase: [
    {key:'lp_submitted',label:'Submitted'},
    {key:'lp_pending_pm_approval',label:'PM Approval'},
    {key:'lp_procurement_processing',label:'Processing'},
    {key:'lp_payment_pending',label:'Payment Pending'},
    {key:'lp_payment_done',label:'Done'}
  ],
  vendor_info: [
    {key:'submitted',label:'Submitted'},
    {key:'pending_initial_pm_approval',label:'PM Clearance',optional:true},
    {key:'procurement_active',label:'Procurement'},
    {key:'vendor_info_shared',label:'Info Shared'}
  ]
};

const ORDER_TYPES = {
  new:          'New Order (Not Previously Requested)',
  repeat:       'Repeat Order (Previously Requested)',
  custom:       'Custom Order (Vendor Customization)',
  modification: 'Modification Request (Change to Previous)',
  inventory:    'Inventory Item (Available in Inventory)'
};

const DEPARTMENTS = {
  // Legacy keys (backward-compat for existing records)
  mech:        'Mechanical Design Engineering',
  id:          'Industrial Design',
  electronics: 'Production & Operations - Electronics',
  npd:          'Production & Operations - NPD',
  assembly:     'Production & Operations - Assembly',
  scm_stores:   'SCM - Stores & Logistics',
  service:      'Production & Operations - Service',
  machine_shop: 'Production & Operations - Machine Shop',
  quality:      'Production & Operations - Quality',
  mech_design:  'Mechanical Design Engineering',
  other:        'Other'
};

// Ordered for workflow timeline
const PHASE_ORDER = [
  'submitted',
  'pending_initial_pm_approval',
  'procurement_active',
  'quotations_shared',
  'quotes_revision_requested',
  'pending_pm_final_approval',
  'approved',
  'advance_raised_to_accounts',
  'advance_payment_received',
  'order_placed',
  'grn_pending',
  'qc_passed',
  'payment_raised_to_accounts',
  'payment_received',
  'accepted',
  'lp_submitted',
  'lp_pending_pm_approval',
  'lp_procurement_processing',
  'lp_payment_pending',
  'lp_payment_done'
];

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

// Short-name aliases used throughout the app
const fmtDate = formatDate;
const fmtDateTime = formatDateTime;

function getPhaseBadge(phase) {
  const p = PHASES[phase] || { label: phase, color: '#6b7280', icon: '•' };
  const closedPill = CLOSED_PHASES.has(phase)
    ? `<span style="background:#6b728018;color:#6b7280;border:1px solid #6b728035;border-radius:3px;font-size:0.6rem;font-family:var(--font-mono);font-weight:700;padding:1px 5px;margin-left:4px;vertical-align:middle">CLOSED</span>`
    : '';
  return `<span class="phase-badge" style="background:${p.color}18;color:${p.color};border:1px solid ${p.color}35">${p.icon} ${p.label}</span>${closedPill}`;
}

function starRating(rating, count) {
  const r = Math.round(rating * 2) / 2;
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    if (i <= r) stars += `<span style="color:#f59e0b;font-size:0.85rem">★</span>`;
    else if (i - 0.5 === r) stars += `<span style="color:#f59e0b;font-size:0.85rem">⯨</span>`;
    else stars += `<span style="color:#d1d5db;font-size:0.85rem">★</span>`;
  }
  return `<span style="display:inline-flex;align-items:center;gap:3px">${stars} <span style="font-family:var(--font-mono);font-size:0.72rem;color:var(--gray-4)">(${count})</span></span>`;
}

// File → base64 helper
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 5 * 1024 * 1024) { reject(new Error('File too large. Max 5MB.')); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

function getFileType(file) {
  if (!file) return 'url';
  const t = file.type;
  if (t === 'image/png') return 'image/png';
  if (t === 'image/jpeg' || t === 'image/jpg') return 'image/jpeg';
  if (t === 'application/pdf') return 'application/pdf';
  return 'url';
}