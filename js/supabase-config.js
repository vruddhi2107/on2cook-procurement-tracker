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
  submitted:                    { label: 'Submitted',                color: '#6366f1', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <path d="M12 11h4" /> <path d="M12 16h4" /> <path d="M8 11h.01" /> <path d="M8 16h.01" /></svg>' },
  pending_master_reassignment:  { label: 'Awaiting Approver Assignment', color: '#dc2626', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" /></svg>' },
  pending_initial_pm_approval:  { label: 'Awaiting PM Clearance',   color: '#f59e0b', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="16" r="1" /> <rect x="3" y="10" width="18" height="12" rx="2" /> <path d="M7 10V7a5 5 0 0 1 10 0v3" /></svg>' },
  procurement_active:           { label: 'Procurement Active',       color: '#3b82f6', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /> <circle cx="12" cy="12" r="3" /></svg>'  },
  vendor_info_shared:           { label: 'Vendor Info Shared',       color: '#8b5cf6', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12h4" /> <path d="M10 8h4" /> <path d="M14 21v-3a2 2 0 0 0-4 0v3" /> <path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" /> <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /></svg>' },
  quotations_shared:            { label: 'Quotations Shared',        color: '#8b5cf6', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /> <path d="m21.854 2.147-10.94 10.939" /></svg>' },
  pending_client_approval:      { label: 'Pending Client Approval',  color: '#ec4899', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /> <circle cx="12" cy="7" r="4" /></svg>' },
  pending_pm_final_approval:    { label: 'Pending PM Approval',      color: '#f97316', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 21h8" /> <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /></svg>'  },
  pending_sandy_approval:        { label: 'Awaiting Director Approval', color: '#7c3aed', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /> <circle cx="12" cy="7" r="4" /></svg>' },
  approved:                     { label: 'Approved',                 color: '#10b981', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /> <path d="m9 12 2 2 4-4" /></svg>' },
  advance_requested:            { label: 'Advance Requested',        color: '#f59e0b', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2" /> <line x1="2" x2="22" y1="10" y2="10" /></svg>' },
  advance_approved:             { label: 'Advance Approved',         color: '#22c55e', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2" /> <line x1="2" x2="22" y1="10" y2="10" /></svg>' },
  advance_rejected:             { label: 'Advance Rejected',         color: '#ef4444', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2" /> <line x1="2" x2="22" y1="10" y2="10" /></svg>' },
  advance_raised_to_accounts:   { label: 'Advance Raised',           color: '#f59e0b', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12" /> <path d="m17 8-5-5-5 5" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></svg>' },
  advance_payment_received:     { label: 'Advance Received',         color: '#22c55e', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2" /> <line x1="2" x2="22" y1="10" y2="10" /></svg>' },
  order_placed:                 { label: 'Order Placed',             color: '#14b8a6', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1" /> <circle cx="19" cy="21" r="1" /> <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>' },
  grn_pending:                  { label: 'GRN / QC Pending',         color: '#f59e0b', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /> <path d="M12 22V12" /> <polyline points="3.29 7 12 12 20.71 7" /> <path d="m7.5 4.27 9 5.15" /></svg>' },
  qc_passed:                    { label: 'QC Passed',                color: '#22c55e', icon: '✔️'  },
  payment_requested:            { label: 'Payment Requested',        color: '#8b5cf6', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12" /> <path d="M6 8h12" /> <path d="m6 13 8.5 8" /> <path d="M6 13h3" /> <path d="M9 13c6.667 0 6.667-10 0-10" /></svg>' },
  payment_raised_to_accounts:   { label: 'Payment Raised',           color: '#8b5cf6', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12" /> <path d="m17 8-5-5-5 5" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></svg>' },
  payment_received:             { label: 'Payment Received',         color: '#22c55e', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /> <path d="m9 12 2 2 4-4" /></svg>' },
  accepted:                     { label: 'Accepted & Closed',        color: '#22c55e', icon: '✔️'  },
  rejected:                     { label: 'Rejected & Closed',        color: '#ef4444', icon: '✖️'  },
  declined:                     { label: 'Declined & Closed',        color: '#6b7280', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M4.929 4.929 19.07 19.071" /></svg>' },
  lp_submitted:                 { label: 'LP Submitted',             color: '#6366f1', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <path d="M12 11h4" /> <path d="M12 16h4" /> <path d="M8 11h.01" /> <path d="M8 16h.01" /></svg>' },
  lp_pending_pm_approval:       { label: 'LP — Awaiting PM Approval',  color: '#f59e0b', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14" /> <path d="M5 2h14" /> <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" /> <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" /></svg>' },
  lp_procurement_processing:    { label: 'LP — With Procurement',      color: '#3b82f6', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1" /> <circle cx="19" cy="21" r="1" /> <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>' },
  lp_payment_pending:           { label: 'LP — Payment Pending',       color: '#f97316', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2" /> <line x1="2" x2="22" y1="10" y2="10" /></svg>' },
  lp_rejected:                  { label: 'LP Rejected & Closed',    color: '#ef4444', icon: '✖️'  },
  lp_payment_done:              { label: 'LP — Payment Done',          color: '#22c55e', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /> <path d="m9 12 2 2 4-4" /></svg>' },
  qc_rejected:                  { label: 'QC Rejected & Closed',     color: '#ef4444', icon: '✖️'  },
  payment_received:             { label: 'Payment Received & Closed',color: '#22c55e', icon: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /> <path d="m9 12 2 2 4-4" /></svg>' }
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
      'pending_master_reassignment',
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

// Elec / Mechanical split, combined with request_for (npd/production) to give
// 4 routing categories: npd-elec, npd-mechanical, production-elec, production-mechanical
const DISCIPLINES = {
  elec:       'Electronics',
  mechanical: 'Mechanical'
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
  'pending_master_reassignment',
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
// Column list for LIST/dashboard views of procurement_requests.
// Excludes attachments, client_approval_screenshot, pm_approval_screenshot,
// lp_bill_url — these can carry multi-MB base64 blobs (legacy rows) or
// growing Storage-URL arrays, and are only ever read off a single fetched
// PR in detail modals, never off list rows. Use select('*') only for
// single-PR detail queries (.eq('id', id).single()).
const PR_LIST_COLUMNS = 'id,request_number,request_category,department,order_type,project_name,project_phase,project_manager_name,team_member_name,assigned_pm_id,vendor_suggestion,assigned_vendor_id,selected_quotation_id,sourcing,description,product_link,parts,phase,initial_pm_approval,approval_path,client_approval_notes,pm_final_approval_status,pm_final_approval_notes,rejection_reason,needs_more_vendors,vendor_info_details,is_modification,parent_request_id,modification_note,order_notes,advance_option,qc_result,qc_notes,qc_criteria,phase_timestamps,created_by,created_at,updated_at,urgency,lp_bill_name,deviation_target_id,deviation_approval_status,is_closed,closed_at,item_note,request_for,discipline,initial_approver_id';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 5 * 1024 * 1024) { reject(new Error('File too large. Max 5MB.')); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

// File → Supabase Storage upload helper.
// Uploads to the shared 'attachments' bucket and returns {name, type, url}.
// Use this instead of fileToBase64() for anything saved into a jsonb/text
// column — base64 in the DB is what bloated procurement_requests to 34MB
// on 77 rows. Storage + a URL string keeps row size trivial.
async function uploadFileToStorage(file, folder) {
  if (file.size > 5 * 1024 * 1024) throw new Error('File too large. Max 5MB.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${Date.now()}_${safeName}`;
  const { error: uploadErr } = await db.storage
    .from('attachments')
    .upload(path, file, { contentType: file.type, upsert: true });
  if (uploadErr) throw new Error('Upload failed: ' + uploadErr.message);
  const { data: urlData } = db.storage.from('attachments').getPublicUrl(path);
  return { name: file.name, type: file.type, url: urlData?.publicUrl };
}

function getFileType(file) {
  if (!file) return 'url';
  const t = file.type;
  if (t === 'image/png') return 'image/png';
  if (t === 'image/jpeg' || t === 'image/jpg') return 'image/jpeg';
  if (t === 'application/pdf') return 'application/pdf';
  return 'url';
}