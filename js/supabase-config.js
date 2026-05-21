// ============================================================
// SUPABASE CONFIGURATION
// Replace with your actual Supabase project URL and anon key
// ============================================================

const SUPABASE_URL = 'https://jjoipvugyingxhddszcc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqb2lwdnVneWluZ3hoZGRzemNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzgyMDcsImV4cCI6MjA5MzExNDIwN30.n2Eq0m0P5uaKOLlz4648zl3aW2o79Zyt_gkBFB9XnWM';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// ============================================================
// SUPABASE CONFIGURATION — ProcureOps v2
// Replace YOUR_SUPABASE_URL and YOUR_SUPABASE_ANON_KEY below
// ============================================================


// ============================================================
// SESSION
// ============================================================
const Session = {
  set(user) { localStorage.setItem('procurement_user', JSON.stringify(user)); },
  get() { const u = localStorage.getItem('procurement_user'); return u ? JSON.parse(u) : null; },
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
  rejected:                     { label: 'Rejected & Closed',        color: '#ef4444', icon: '✖️' }
};

const ORDER_TYPES = {
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
  'pending_pm_final_approval',
  'approved',
  'advance_raised_to_accounts',
  'advance_payment_received',
  'order_placed',
  'grn_pending',
  'qc_passed',
  'payment_raised_to_accounts',
  'payment_received',
  'accepted'
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
  return `<span class="phase-badge" style="background:${p.color}18;color:${p.color};border:1px solid ${p.color}35">${p.icon} ${p.label}</span>`;
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