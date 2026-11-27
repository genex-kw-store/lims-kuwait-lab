// util.js - auth, sessions, RBAC, audit log, helpers
const crypto = require('crypto');
const { db } = require('./db');
const { hashPassword } = require('./seed');

const PERMS = {
  dashboard:   ['admin','lab_manager','reception','phlebotomist','technician','accountant'],
  patients:    ['admin','lab_manager','reception'],
  visits:      ['admin','lab_manager','reception'],
  samples:     ['admin','lab_manager','phlebotomist','technician','reception'],
  samples_write:['admin','lab_manager','phlebotomist','technician'],
  results:     ['admin','lab_manager','technician'],
  approve:     ['admin','lab_manager'],
  invoices:    ['admin','lab_manager','reception','accountant'],
  inventory:   ['admin','lab_manager'],
  inventory_view:['admin','lab_manager','technician'],
  expenses:    ['admin','accountant'],
  qc:          ['admin','lab_manager','technician'],
  tests_admin: ['admin','lab_manager'],
  audit:       ['admin','lab_manager'],
  users:       ['admin'],
  settings:    ['admin'],
  backup:      ['admin'],
  homevisits:  ['admin','reception','phlebotomist'],
  reports_view:['admin','lab_manager','accountant'],
  device_import:['admin','lab_manager','technician']
};

function getSetting(key, fallback) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : (fallback !== undefined ? fallback : null);
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
function audit(user, action, entity, entityId, oldVal, newVal) {
  db.prepare('INSERT INTO audit_log(user_id,username,action,entity,entity_id,old_value,new_value) VALUES (?,?,?,?,?,?,?)')
    .run(user ? user.id : null, user ? user.username : 'system', action, entity, String(entityId ?? ''),
      oldVal !== undefined ? JSON.stringify(oldVal) : null, newVal !== undefined ? JSON.stringify(newVal) : null);
}
function parseCookies(req) {
  const h = req.headers.cookie || '';
  const out = {};
  h.split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function getSessionUser(req) {
  const token = parseCookies(req)['lims_token'];
  if (!token) return null;
  const s = db.prepare(`SELECT s.token, s.expires_at, u.id, u.username, u.name, u.role, u.active
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`).get(token);
  if (!s || !s.active) return null;
  if (new Date(s.expires_at.replace(' ', 'T') + 'Z') < new Date()) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); return null; }
  return { id: s.id, username: s.username, name: s.name, role: s.role, token: s.token };
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + 12 * 3600 * 1000);
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)')
    .run(token, userId, exp.toISOString().replace('T', ' ').slice(0, 19));
  return token;
}
function requireAuth(req, res) {
  const user = getSessionUser(req);
  if (!user) { res.status(401).json({ error: 'login_required' }); return null; }
  // maintenance mode: admins only
  if (getSetting('maintenance', '0') === '1' && user.role !== 'admin') {
    res.status(503).json({ error: 'maintenance_mode' }); return null;
  }
  return user;
}
function requirePerm(section) {
  return (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return null;
    if (!PERMS[section].includes(user.role)) { res.status(403).json({ error: 'forbidden', section }); return null; }
    return user;
  };
}
function round3(n) { return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000; }
function money(n) { return round3(n); }
function ageGroup(dob) {
  if (!dob) return 'adult';
  const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000);
  return age < 12 ? 'child' : 'adult';
}
function flagFor(analyte, value, gender, dob) {
  const v = parseFloat(value);
  if (isNaN(v) || analyte.kind === 'text') return 'N';
  if (analyte.critical_low != null && v < analyte.critical_low) return 'CL';
  if (analyte.critical_high != null && v > analyte.critical_high) return 'CH';
  const grp = ageGroup(dob);
  let lo, hi;
  if (grp === 'child' && analyte.ref_low_child != null) { lo = analyte.ref_low_child; hi = analyte.ref_high_child; }
  else if (gender === 'female') { lo = analyte.ref_low_female; hi = analyte.ref_high_female; }
  else { lo = analyte.ref_low_male; hi = analyte.ref_high_male; }
  if (lo == null && hi == null) return 'N';
  if (lo != null && v < lo) return 'L';
  if (hi != null && v > hi) return 'H';
  return 'N';
}
function evalFormula(formula, valuesByCode) {
  // tokens = test codes; values numeric. Missing token -> null
  const replaced = formula.replace(/[A-Za-z_][A-Za-z0-9_]*/g, tok => {
    if (!(tok in valuesByCode)) return '#MISSING#';
    return String(valuesByCode[tok]);
  });
  if (replaced.includes('#MISSING#')) return null;
  if (!/^[0-9+\-*/().\s]+$/.test(replaced)) return null;
  try { const r = Function('"use strict"; return (' + replaced + ')')(); return isFinite(r) ? Math.round(r * 100) / 100 : null; }
  catch { return null; }
}
module.exports = { PERMS, getSetting, setSetting, audit, getSessionUser, createSession, requireAuth, requirePerm, round3, money, flagFor, ageGroup, evalFormula, hashPassword };
