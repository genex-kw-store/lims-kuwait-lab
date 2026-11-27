// server.js - LIMS API + static hosting. Run: npm start
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { db, DB_PATH } = require('./db');
const { seed } = require('./seed');
const U = require('./util');

seed(db);
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));

const PORT = process.env.PORT || 3000;
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const loginAttempts = new Map();
function nextNo(prefix, table, col) {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const c = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${col} LIKE ?`).get(`${prefix}${ymd}-%`).c;
  return `${prefix}${ymd}-${String(c + 1).padStart(3, '0')}`;
}
const getSetting = U.getSetting, audit = U.audit, money = U.round3;

// ---------- AUTH ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip || 'x';
  const att = loginAttempts.get(ip) || { n: 0, until: 0 };
  if (att.until > Date.now()) return res.status(429).json({ error: 'too_many_attempts' });
  const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username || '').trim());
  const ok = user && U.hashPassword(String(password || ''), user.salt) === user.password_hash;
  if (!ok) {
    att.n++; if (att.n >= 5) { att.until = Date.now() + 5 * 60 * 1000; att.n = 0; }
    loginAttempts.set(ip, att);
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (getSetting('maintenance', '0') === '1' && user.role !== 'admin')
    return res.status(503).json({ error: 'maintenance_mode' });
  loginAttempts.delete(ip);
  const token = U.createSession(user.id);
  audit(user, 'login', 'session', user.id, null, { username: user.username });
  res.setHeader('Set-Cookie', `lims_token=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${12 * 3600}`);
  res.json({ ok: true, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});
app.post('/api/logout', (req, res) => {
  const u = U.getSessionUser(req);
  if (u) { db.prepare('DELETE FROM sessions WHERE token=?').run(u.token); audit(u, 'logout', 'session', u.id); }
  res.setHeader('Set-Cookie', 'lims_token=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  const u = U.getSessionUser(req);
  if (!u) return res.status(401).json({ error: 'login_required' });
  res.json({ user: { id: u.id, username: u.username, name: u.name, role: u.role }, maintenance: getSetting('maintenance', '0') === '1' });
});

// ---------- MASTER DATA ----------
app.get('/api/meta', (req, res) => {
  const u = U.requireAuth(req, res); if (!u) return;
  res.json({
    departments: db.prepare('SELECT * FROM departments').all(),
    sampleTypes: db.prepare('SELECT * FROM sample_types').all(),
    tubes: db.prepare('SELECT * FROM tubes').all(),
    tests: db.prepare(`SELECT t.*, d.name_en dept_en, d.name_ar dept_ar, st.name_en sample_en, st.name_ar sample_ar, tb.code tube_code, tb.name_en tube_en, tb.name_ar tube_ar, tb.color tube_color FROM tests t LEFT JOIN departments d ON d.id=t.dept_id LEFT JOIN sample_types st ON st.id=t.sample_type_id LEFT JOIN tubes tb ON tb.id=t.tube_id WHERE t.active=1 ORDER BY d.id, t.code`).all(),
    analytes: db.prepare('SELECT * FROM analytes ORDER BY test_id, position').all(),
    packages: db.prepare('SELECT * FROM packages WHERE active=1').all(),
    packageTests: db.prepare('SELECT * FROM package_tests').all(),
    doctors: db.prepare('SELECT * FROM doctors WHERE active=1').all(),
    insurance: db.prepare('SELECT * FROM insurance_contracts WHERE active=1').all(),
    settings: Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]))
  });
});

// tests CRUD (lab_manager/admin)
app.post('/api/tests', (req, res) => {
  const u = U.requirePerm('tests_admin')(req, res); if (!u) return;
  const b = req.body || {};
  const old = null;
  const r = db.prepare(`INSERT INTO tests(code,name_en,name_ar,dept_id,sample_type_id,tube_id,price,tat_minutes,fasting,prep_note_en,prep_note_ar,kind,formula,outsourced) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.code, b.name_en, b.name_ar || b.name_en, b.dept_id, b.sample_type_id, b.tube_id, b.price || 0, b.tat_minutes || 240, b.fasting ? 1 : 0, b.prep_note_en || null, b.prep_note_ar || null, b.kind || 'numeric', b.formula || null, b.outsourced ? 1 : 0);
  audit(u, 'create', 'test', r.lastInsertRowid, old, b);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/tests/:id', (req, res) => {
  const u = U.requirePerm('tests_admin')(req, res); if (!u) return;
  const b = req.body || {};
  const old = db.prepare('SELECT * FROM tests WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'not_found' });
  if (old.price !== Number(b.price)) audit(u, 'price_change', 'test', old.id, { price: old.price }, { price: b.price });
  db.prepare(`UPDATE tests SET name_en=?, name_ar=?, dept_id=?, sample_type_id=?, tube_id=?, price=?, tat_minutes=?, fasting=?, prep_note_en=?, prep_note_ar=?, kind=?, formula=?, outsourced=?, active=? WHERE id=?`)
    .run(b.name_en, b.name_ar, b.dept_id, b.sample_type_id, b.tube_id, b.price, b.tat_minutes, b.fasting ? 1 : 0, b.prep_note_en, b.prep_note_ar, b.kind, b.formula, b.outsourced ? 1 : 0, b.active ? 1 : 0, old.id);
  audit(u, 'update', 'test', old.id, old, b);
  res.json({ ok: true });
});

// ---------- PATIENTS ----------
app.get('/api/patients', (req, res) => {
  const u = U.requirePerm('patients')(req, res); if (!u) return;
  const q = `%${(req.query.q || '').trim()}%`;
  res.json(db.prepare(`SELECT * FROM patients WHERE name LIKE ? OR phone LIKE ? OR civil_id LIKE ? OR file_no LIKE ? ORDER BY id DESC LIMIT 50`).all(q, q, q, q));
});
app.post('/api/patients', (req, res) => {
  const u = U.requirePerm('patients')(req, res); if (!u) return;
  const b = req.body || {};
  if (!b.name || !b.gender) return res.status(400).json({ error: 'name_and_gender_required' });
  const seq = db.prepare('SELECT COUNT(*) c FROM patients').get().c + 1;
  const fileNo = 'P' + String(seq).padStart(5, '0');
  const portalCode = crypto.randomBytes(3).toString('hex').toUpperCase();
  const r = db.prepare('INSERT INTO patients(file_no,name,gender,dob,phone,civil_id,portal_code,notes) VALUES (?,?,?,?,?,?,?,?)')
    .run(fileNo, b.name, b.gender, b.dob || null, b.phone || null, b.civil_id || null, portalCode, b.notes || null);
  audit(u, 'create', 'patient', r.lastInsertRowid, null, b);
  res.json({ ok: true, id: r.lastInsertRowid, file_no: fileNo, portal_code: portalCode });
});
app.get('/api/patients/:id', (req, res) => {
  const u = U.requirePerm('patients')(req, res); if (!u) return;
  const p = db.prepare('SELECT * FROM patients WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const visits = db.prepare(`SELECT v.*, (SELECT COUNT(*) FROM visit_tests vt WHERE vt.visit_id=v.id) test_count,
    (SELECT COUNT(*) FROM visit_tests vt WHERE vt.visit_id=v.id AND vt.status='approved') approved_count
    FROM visits v WHERE v.patient_id=? ORDER BY v.id DESC`).all(p.id);
  res.json({ patient: p, visits });
});
app.put('/api/patients/:id', (req, res) => {
  const u = U.requirePerm('patients')(req, res); if (!u) return;
  const old = db.prepare('SELECT * FROM patients WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  db.prepare('UPDATE patients SET name=?, gender=?, dob=?, phone=?, civil_id=?, notes=? WHERE id=?')
    .run(b.name, b.gender, b.dob || null, b.phone || null, b.civil_id || null, b.notes || null, old.id);
  audit(u, 'update', 'patient', old.id, old, b);
  res.json({ ok: true });
});

// ---------- VISITS / ORDERS ----------
function createVisitTx(b, u) {
  return db.transaction(() => {
    const visitNo = nextNo('V', 'visits', 'visit_no');
    const token = crypto.randomBytes(12).toString('hex');
    const vr = db.prepare('INSERT INTO visits(visit_no,patient_id,doctor_id,insurance_id,home_visit,report_token,created_by) VALUES (?,?,?,?,?,?,?)')
      .run(visitNo, b.patient_id, b.doctor_id || null, b.insurance_id || null, b.home_visit ? 1 : 0, token, u.id);
    const visitId = vr.lastInsertRowid;
    // expand packages
    const testRows = []; // {test_id, price, package_id}
    for (const pid of (b.packages || [])) {
      const pk = db.prepare('SELECT * FROM packages WHERE id=?').get(pid);
      if (!pk) continue;
      const members = db.prepare('SELECT test_id FROM package_tests WHERE package_id=?').all(pid);
      members.forEach(m => testRows.push({ test_id: m.test_id, price: 0, package_id: pid, pkgPrice: pk.price }));
    }
    const pkgSeen = new Set(testRows.filter(t => t.package_id).map(t => t.package_id));
    for (const tid of (b.tests || [])) {
      const t = db.prepare('SELECT * FROM tests WHERE id=?').get(tid);
      if (!t) continue;
      if (testRows.some(r => r.test_id === tid)) continue; // already in a package
      testRows.push({ test_id: tid, price: t.price, package_id: null });
    }
    const insVT = db.prepare('INSERT INTO visit_tests(visit_id,test_id,package_id,price) VALUES (?,?,?,?)');
    const vtIds = [];
    for (const tr of testRows) vtIds.push({ id: insVT.run(visitId, tr.test_id, tr.package_id, tr.price).lastInsertRowid, test_id: tr.test_id });
    // consolidate samples by tube
    const byTube = new Map();
    vtIds.forEach(vt => {
      const t = db.prepare('SELECT tube_id FROM tests WHERE id=?').get(vt.test_id);
      if (!byTube.has(t.tube_id)) byTube.set(t.tube_id, []);
      byTube.get(t.tube_id).push(vt.id);
    });
    const insS = db.prepare('INSERT INTO samples(visit_id,tube_id,barcode) VALUES (?,?,?)');
    const insSTx = db.prepare('INSERT INTO sample_tests(sample_id,visit_test_id) VALUES (?,?)');
    let ti = 0;
    const samples = [];
    for (const [tubeId, vts] of byTube) {
      ti++;
      const barcode = `${visitNo}-${ti}`;
      const sid = insS.run(visitId, tubeId, barcode).lastInsertRowid;
      vts.forEach(vtid => insSTx.run(sid, vtid));
      samples.push({ id: sid, tube_id: tubeId, barcode });
    }
    // invoice
    const subtotal = testRows.reduce((s, r) => s + r.price, 0)
      + [...pkgSeen].reduce((s, pid) => s + db.prepare('SELECT price FROM packages WHERE id=?').get(pid).price, 0);
    const ins = b.insurance_id ? db.prepare('SELECT * FROM insurance_contracts WHERE id=?').get(b.insurance_id) : null;
    const discPct = Number(b.discount_percent || 0);
    const discAmt = money(subtotal * discPct / 100);
    const insPct = ins ? ins.coverage_percent : 0;
    const insAmt = money((subtotal - discAmt) * insPct / 100);
    const total = money(subtotal - discAmt - insAmt);
    const invNo = nextNo('INV', 'invoices', 'invoice_no');
    const ir = db.prepare(`INSERT INTO invoices(invoice_no,visit_id,subtotal,discount_percent,discount_amount,insurance_percent,insurance_amount,total,created_by) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(invNo, visitId, money(subtotal), discPct, discAmt, insPct, insAmt, total, u.id);
    return { visitId, visitNo, invoiceId: ir.lastInsertRowid, invoiceNo: invNo, samples, total, reportToken: token };
  })();
}

app.post('/api/visits', (req, res) => {
  const u = U.requirePerm('visits')(req, res); if (!u) return;
  const b = req.body || {};
  if (!b.patient_id) return res.status(400).json({ error: 'patient_required' });
  if (!(b.tests || []).length && !(b.packages || []).length) return res.status(400).json({ error: 'tests_required' });
  const out = createVisitTx(b, u);
  audit(u, 'create', 'visit', out.visitId, null, { visit_no: out.visitNo, patient_id: b.patient_id, tests: b.tests, packages: b.packages, total: out.total });
  audit(u, 'create', 'invoice', out.invoiceId, null, { invoice_no: out.invoiceNo, total: out.total });
  db.prepare('INSERT INTO notifications(channel,recipient,message,status) VALUES (?,?,?,?)')
    .run('whatsapp', db.prepare('SELECT phone FROM patients WHERE id=?').get(b.patient_id)?.phone || '',
      `Invoice ${out.invoiceNo} - total ${out.total} ${getSetting('currency', 'KWD')}. Visit ${out.visitNo}.`, getSetting('whatsapp_enabled', '0') === '1' ? 'queued' : 'disabled');
  res.json({ ok: true, ...out });
});

app.get('/api/visits', (req, res) => {
  const u = U.requireAuth(req, res); if (!u) return;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT v.*, p.name patient_name, p.file_no, p.gender, p.dob, i.invoice_no, i.total, i.status inv_status,
    (SELECT COUNT(*) FROM visit_tests vt WHERE vt.visit_id=v.id) test_count,
    (SELECT COUNT(*) FROM visit_tests vt WHERE vt.visit_id=v.id AND vt.status='approved') approved_count
    FROM visits v JOIN patients p ON p.id=v.patient_id LEFT JOIN invoices i ON i.visit_id=v.id
    WHERE date(v.created_at)=? ORDER BY v.id DESC LIMIT 100`).all(date);
  res.json(rows);
});

app.get('/api/visits/:id', (req, res) => {
  const u = U.requireAuth(req, res); if (!u) return;
  const v = db.prepare(`SELECT v.*, p.name patient_name, p.file_no, p.gender, p.dob, p.phone, p.portal_code,
    d.name doctor_name, ic.company insurance_company
    FROM visits v JOIN patients p ON p.id=v.patient_id LEFT JOIN doctors d ON d.id=v.doctor_id LEFT JOIN insurance_contracts ic ON ic.id=v.insurance_id WHERE v.id=?`).get(req.params.id);
  if (!v) return res.status(404).json({ error: 'not_found' });
  const tests = db.prepare(`SELECT vt.id visit_test_id, vt.status, vt.price, vt.package_id, t.*, tb.code tube_code, tb.color tube_color, tb.name_en tube_en, tb.name_ar tube_ar, d.name_en dept_en, d.name_ar dept_ar
    FROM visit_tests vt JOIN tests t ON t.id=vt.test_id LEFT JOIN tubes tb ON tb.id=t.tube_id LEFT JOIN departments d ON d.id=t.dept_id WHERE vt.visit_id=?`).all(v.id);
  const samples = db.prepare(`SELECT s.*, tb.code tube_code, tb.color tube_color, tb.name_en tube_en, tb.name_ar tube_ar,
    (SELECT GROUP_CONCAT(t2.code, ', ') FROM sample_tests st2 JOIN visit_tests vt2 ON vt2.id=st2.visit_test_id JOIN tests t2 ON t2.id=vt2.test_id WHERE st2.sample_id=s.id) test_codes
    FROM samples s JOIN tubes tb ON tb.id=s.tube_id WHERE s.visit_id=?`).all(v.id);
  const invoice = db.prepare('SELECT * FROM invoices WHERE visit_id=?').get(v.id);
  res.json({ visit: v, tests, samples, invoice });
});

// ---------- SAMPLES ----------
app.get('/api/samples', (req, res) => {
  const u = U.requirePerm('samples')(req, res); if (!u) return;
  const status = req.query.status;
  let sql = `SELECT s.*, tb.code tube_code, tb.color tube_color, tb.name_en tube_en, tb.name_ar tube_ar,
    p.name patient_name, p.file_no, v.visit_no, v.created_at visit_at,
    (SELECT GROUP_CONCAT(t2.code, ', ') FROM sample_tests st2 JOIN visit_tests vt2 ON vt2.id=st2.visit_test_id JOIN tests t2 ON t2.id=vt2.test_id WHERE st2.sample_id=s.id) test_codes
    FROM samples s JOIN tubes tb ON tb.id=s.tube_id JOIN visits v ON v.id=s.visit_id JOIN patients p ON p.id=v.patient_id`;
  if (status) { sql += ' WHERE s.status=? ORDER BY s.id DESC LIMIT 200'; return res.json(db.prepare(sql).all(status)); }
  res.json(db.prepare(sql + ' ORDER BY s.id DESC LIMIT 200').all());
});
app.post('/api/samples/:id/collect', (req, res) => {
  const u = U.requirePerm('samples_write')(req, res); if (!u) return;
  const s = db.prepare('SELECT * FROM samples WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  db.prepare(`UPDATE samples SET status='collected', collected_by=?, collected_at=datetime('now','localtime') WHERE id=?`).run(u.id, s.id);
  audit(u, 'collect', 'sample', s.id, { status: s.status }, { status: 'collected', barcode: s.barcode });
  res.json({ ok: true });
});

// ---------- RESULTS ----------
app.get('/api/worksheet', (req, res) => {
  const u = U.requirePerm('results')(req, res); if (!u) return;
  const rows = db.prepare(`SELECT vt.id visit_test_id, vt.status, t.code, t.name_en, t.name_ar, t.kind, t.formula, t.tat_minutes,
    v.id visit_id, v.visit_no, v.created_at visit_at, p.name patient_name, p.file_no, p.gender, p.dob, d.name_en dept_en, d.name_ar dept_ar
    FROM visit_tests vt JOIN tests t ON t.id=vt.test_id JOIN visits v ON v.id=vt.visit_id JOIN patients p ON p.id=v.patient_id
    LEFT JOIN departments d ON d.id=t.dept_id
    WHERE vt.status IN ('pending','entered') AND EXISTS (SELECT 1 FROM samples s JOIN sample_tests st ON st.sample_id=s.id WHERE st.visit_test_id=vt.id AND s.status IN ('collected','processing','awaiting_approval'))
    ORDER BY v.id`).all();
  res.json(rows);
});
app.get('/api/visit-tests/:id', (req, res) => {
  const u = U.requirePerm('results')(req, res); if (!u) return;
  const vt = db.prepare(`SELECT vt.*, t.code, t.name_en, t.name_ar, t.kind, t.formula, v.visit_no, v.patient_id, p.gender, p.dob, p.name patient_name
    FROM visit_tests vt JOIN tests t ON t.id=vt.test_id JOIN visits v ON v.id=vt.visit_id JOIN patients p ON p.id=v.patient_id WHERE vt.id=?`).get(req.params.id);
  if (!vt) return res.status(404).json({ error: 'not_found' });
  const analytes = db.prepare('SELECT * FROM analytes WHERE test_id=? ORDER BY position').all(vt.test_id);
  const results = db.prepare('SELECT * FROM results WHERE visit_test_id=?').all(vt.id);
  // previous results for same patient (older approved visits)
  const prev = db.prepare(`SELECT r.analyte_id, r.value, v2.created_at FROM results r
    JOIN visit_tests vt2 ON vt2.id=r.visit_test_id JOIN visits v2 ON v2.id=vt2.visit_id
    WHERE v2.patient_id=? AND v2.id < ? AND vt2.status='approved' AND vt2.test_id=?
    ORDER BY v2.id DESC`).all(vt.patient_id, vt.visit_id, vt.test_id);
  const prevMap = {};
  prev.forEach(r => { if (!(r.analyte_id in prevMap)) prevMap[r.analyte_id] = { value: r.value, at: r.created_at }; });
  res.json({ visitTest: vt, analytes, results, prevMap });
});
function recomputeCalculated(visitId, patient, u) {
  const calcTests = db.prepare(`SELECT vt.id vtid, vt.test_id, t.formula, t.code FROM visit_tests vt JOIN tests t ON t.id=vt.test_id WHERE vt.visit_id=? AND t.kind='calculated' AND vt.status != 'approved'`).all(visitId);
  if (!calcTests.length) return;
  const vals = db.prepare(`SELECT t.code, r.value FROM visit_tests vt JOIN tests t ON t.id=vt.test_id
    JOIN results r ON r.visit_test_id=vt.id JOIN analytes a ON a.id=r.analyte_id AND a.position=0
    WHERE vt.visit_id=? AND t.kind='numeric'`).all(visitId);
  const map = {}; vals.forEach(r => { const v = parseFloat(r.value); if (!isNaN(v)) map[r.code] = v; });
  for (const ct of calcTests) {
    const val = U.evalFormula(ct.formula, map);
    if (val == null) continue;
    const analyte = db.prepare('SELECT * FROM analytes WHERE test_id=? ORDER BY position LIMIT 1').get(ct.test_id);
    if (!analyte) continue;
    const flag = U.flagFor(analyte, val, patient.gender, patient.dob);
    db.prepare('INSERT INTO results(visit_test_id,analyte_id,value,flag) VALUES (?,?,?,?) ON CONFLICT(visit_test_id,analyte_id) DO UPDATE SET value=excluded.value, flag=excluded.flag')
      .run(ct.vtid, analyte.id, String(val), flag);
    db.prepare(`UPDATE visit_tests SET status=CASE WHEN status='pending' THEN 'entered' ELSE status END, entered_by=COALESCE(entered_by,?), entered_at=COALESCE(entered_at,datetime('now','localtime')) WHERE id=?`).run(u.id, ct.vtid);
  }
}
function updateSampleStatuses(visitId) {
  const samples = db.prepare('SELECT * FROM samples WHERE visit_id=?').all(visitId);
  for (const s of samples) {
    const sts = db.prepare(`SELECT vt.status FROM sample_tests st JOIN visit_tests vt ON vt.id=st.visit_test_id WHERE st.sample_id=?`).all(s.id).map(r => r.status);
    let ns = s.status;
    if (sts.every(x => x === 'approved')) ns = 'approved';
    else if (sts.every(x => x === 'entered' || x === 'approved')) ns = 'awaiting_approval';
    else if (sts.some(x => x === 'entered' || x === 'approved')) ns = 'processing';
    else if (s.status === 'pending') ns = 'pending'; else ns = 'collected';
    if (ns !== s.status && !(s.status === 'pending' && ns === 'collected')) db.prepare('UPDATE samples SET status=? WHERE id=?').run(ns, s.id);
  }
}
app.post('/api/visit-tests/:id/results', (req, res) => {
  const u = U.requirePerm('results')(req, res); if (!u) return;
  const vt = db.prepare(`SELECT vt.*, v.patient_id, v.id vid, p.gender, p.dob FROM visit_tests vt JOIN visits v ON v.id=vt.visit_id JOIN patients p ON p.id=v.patient_id WHERE vt.id=?`).get(req.params.id);
  if (!vt) return res.status(404).json({ error: 'not_found' });
  if (vt.status === 'approved') return res.status(409).json({ error: 'already_approved' });
  const b = req.body || {};
  const patient = { gender: vt.gender, dob: vt.dob };
  const old = db.prepare('SELECT * FROM results WHERE visit_test_id=?').all(vt.id);
  const up = db.prepare('INSERT INTO results(visit_test_id,analyte_id,value,flag) VALUES (?,?,?,?) ON CONFLICT(visit_test_id,analyte_id) DO UPDATE SET value=excluded.value, flag=excluded.flag');
  db.transaction(() => {
    for (const r of (b.results || [])) {
      const an = db.prepare('SELECT * FROM analytes WHERE id=?').get(r.analyte_id);
      if (!an || an.test_id !== vt.test_id) continue; // analyte must belong to this test
      const flag = U.flagFor(an, r.value, patient.gender, patient.dob);
      up.run(vt.id, r.analyte_id, String(r.value ?? ''), flag);
    }
    db.prepare(`UPDATE visit_tests SET status='entered', entered_by=?, entered_at=datetime('now','localtime') WHERE id=?`).run(u.id, vt.id);
    recomputeCalculated(vt.vid, patient, u);
    updateSampleStatuses(vt.vid);
  })();
  audit(u, 'enter_results', 'visit_test', vt.id, old, b.results);
  res.json({ ok: true });
});
app.post('/api/visit-tests/:id/approve', (req, res) => {
  const u = U.requirePerm('approve')(req, res); if (!u) return;
  const vt = db.prepare('SELECT * FROM visit_tests WHERE id=?').get(req.params.id);
  if (!vt) return res.status(404).json({ error: 'not_found' });
  if (vt.status !== 'entered') return res.status(409).json({ error: 'must_be_entered_first' });
  db.transaction(() => {
    db.prepare(`UPDATE visit_tests SET status='approved', approved_by=?, approved_at=datetime('now','localtime') WHERE id=?`).run(u.id, vt.id);
    // smart inventory deduction (once)
    if (!vt.deducted) {
      const mats = db.prepare('SELECT * FROM test_materials WHERE test_id=?').all(vt.test_id);
      const updI = db.prepare('UPDATE inventory_items SET quantity = ROUND(quantity - ?, 3) WHERE id=?');
      const insTx = db.prepare(`INSERT INTO inventory_txns(item_id,change,reason,ref,user_id) VALUES (?,?,?,?,?)`);
      for (const m of mats) {
        updI.run(m.qty, m.item_id);
        insTx.run(m.item_id, -m.qty, 'test_approved', `vt:${vt.id}`, u.id);
      }
      db.prepare('UPDATE visit_tests SET deducted=1 WHERE id=?').run(vt.id);
    }
    updateSampleStatuses(vt.visit_id);
    // visit complete? -> notify
    const left = db.prepare(`SELECT COUNT(*) c FROM visit_tests WHERE visit_id=? AND status != 'approved'`).get(vt.visit_id).c;
    if (left === 0) {
      db.prepare(`UPDATE visits SET status='complete' WHERE id=?`).run(vt.visit_id);
      const v = db.prepare('SELECT v.*, p.phone, p.name FROM visits v JOIN patients p ON p.id=v.patient_id WHERE v.id=?').get(vt.visit_id);
      db.prepare('INSERT INTO notifications(channel,recipient,message,status) VALUES (?,?,?,?)')
        .run('whatsapp', v.phone || '', `Report ready for ${v.name} - visit ${v.visit_no}: ${getSetting('base_url')}/report/${v.id}?token=${v.report_token}`, getSetting('whatsapp_enabled', '0') === '1' ? 'queued' : 'disabled');
    }
  })();
  audit(u, 'approve', 'visit_test', vt.id, { status: 'entered' }, { status: 'approved' });
  res.json({ ok: true });
});
// device interfacing readiness: CSV import barcode,test_code,analyte,value
app.post('/api/import/results', (req, res) => {
  const u = U.requirePerm('device_import')(req, res); if (!u) return;
  const text = String(req.body || '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  let n = 0, errors = [];
  for (const line of lines) {
    const [barcode, code, analyteName, value] = line.split(',').map(s => (s || '').trim());
    if (!barcode || !code || value === undefined || value === '') continue;
    const sample = db.prepare('SELECT * FROM samples WHERE barcode=?').get(barcode);
    if (!sample) { errors.push(`no sample ${barcode}`); continue; }
    const vt = db.prepare(`SELECT vt.*, p.gender, p.dob, v.id vid, v.patient_id FROM sample_tests st JOIN visit_tests vt ON vt.id=st.visit_test_id JOIN tests t ON t.id=vt.test_id JOIN visits v ON v.id=vt.visit_id JOIN patients p ON p.id=v.patient_id WHERE st.sample_id=? AND t.code=?`).get(sample.id, code);
    if (!vt) { errors.push(`no test ${code} in ${barcode}`); continue; }
    if (vt.status === 'approved') { errors.push(`${code} approved, skipped`); continue; }
    let an = db.prepare('SELECT * FROM analytes WHERE test_id=? AND name LIKE ?').get(vt.test_id, `%${analyteName || ''}%`);
    if (!an) an = db.prepare('SELECT * FROM analytes WHERE test_id=? ORDER BY position LIMIT 1').get(vt.test_id);
    if (!an) continue;
    const flag = U.flagFor(an, value, vt.gender, vt.dob);
    db.prepare('INSERT INTO results(visit_test_id,analyte_id,value,flag) VALUES (?,?,?,?) ON CONFLICT(visit_test_id,analyte_id) DO UPDATE SET value=excluded.value, flag=excluded.flag').run(vt.id, an.id, value, flag);
    db.prepare(`UPDATE visit_tests SET status='entered', entered_by=?, entered_at=datetime('now','localtime') WHERE id=?`).run(u.id, vt.id);
    recomputeCalculated(vt.vid, { gender: vt.gender, dob: vt.dob }, u);
    n++;
  }
  db.prepare('INSERT INTO device_imports(filename,rows_imported,user_id) VALUES (?,?,?)').run('api-upload', n, u.id);
  audit(u, 'device_import', 'results', null, null, { rows: n, errors: errors.length });
  res.json({ ok: true, imported: n, errors });
});

// ---------- INVOICES / PAYMENTS ----------
app.get('/api/invoices', (req, res) => {
  const u = U.requirePerm('invoices')(req, res); if (!u) return;
  const date = req.query.date;
  let sql = `SELECT i.*, v.visit_no, p.name patient_name, p.file_no FROM invoices i JOIN visits v ON v.id=i.visit_id JOIN patients p ON p.id=v.patient_id`;
  if (date) sql += ` WHERE date(i.created_at)=?`;
  res.json(db.prepare(sql + ' ORDER BY i.id DESC LIMIT 200').all(...(date ? [date] : [])));
});
app.post('/api/invoices/:id/pay', (req, res) => {
  const u = U.requirePerm('invoices')(req, res); if (!u) return;
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (inv.status !== 'active') return res.status(409).json({ error: 'invoice_cancelled' });
  const { amount, method } = req.body || {};
  const amt = money(Number(amount || 0));
  if (!(amt > 0) || !['cash', 'knet', 'transfer', 'credit'].includes(method)) return res.status(400).json({ error: 'invalid_payment' });
  db.transaction(() => {
    db.prepare('INSERT INTO payments(invoice_id,amount,method,created_by) VALUES (?,?,?,?)').run(inv.id, amt, method, u.id);
    db.prepare('UPDATE invoices SET paid = paid + ?, payment_method=? WHERE id=?').run(amt, method, inv.id);
  })();
  audit(u, 'payment', 'invoice', inv.id, { paid: inv.paid }, { paid: money(inv.paid + amt), method, amount: amt });
  res.json({ ok: true, paid: money(inv.paid + amt) });
});
app.post('/api/invoices/:id/cancel', (req, res) => {
  const u = U.requirePerm('invoices')(req, res); if (!u) return;
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (inv.status !== 'active') return res.status(409).json({ error: 'already_cancelled' });
  const reason = (req.body || {}).reason || '';
  db.prepare(`UPDATE invoices SET status='cancelled', cancelled_by=?, cancelled_at=datetime('now','localtime'), cancel_reason=? WHERE id=?`).run(u.id, reason, inv.id);
  audit(u, 'cancel_invoice', 'invoice', inv.id, { status: 'active', total: inv.total }, { status: 'cancelled', reason });
  res.json({ ok: true });
});

// ---------- INVENTORY ----------
app.get('/api/inventory', (req, res) => {
  const u = U.requirePerm('inventory_view')(req, res); if (!u) return;
  const days = Number(getSetting('expiry_alert_days', '60'));
  const cutoff = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  const items = db.prepare('SELECT * FROM inventory_items ORDER BY name').all();
  items.forEach(i => {
    i.low_stock = i.quantity <= i.min_quantity;
    i.expiring_soon = i.expiry_date && i.expiry_date <= cutoff;
    i.expired = i.expiry_date && i.expiry_date < new Date().toISOString().slice(0, 10);
  });
  res.json(items);
});
app.post('/api/inventory', (req, res) => {
  const u = U.requirePerm('inventory')(req, res); if (!u) return;
  const b = req.body || {};
  const r = db.prepare('INSERT INTO inventory_items(name,name_ar,category,unit,quantity,min_quantity,expiry_date,cost) VALUES (?,?,?,?,?,?,?,?)')
    .run(b.name, b.name_ar || null, b.category || null, b.unit || 'pcs', b.quantity || 0, b.min_quantity || 0, b.expiry_date || null, b.cost || 0);
  audit(u, 'create', 'inventory_item', r.lastInsertRowid, null, b);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/inventory/:id', (req, res) => {
  const u = U.requirePerm('inventory')(req, res); if (!u) return;
  const old = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  db.transaction(() => {
    db.prepare('UPDATE inventory_items SET name=?, name_ar=?, category=?, unit=?, quantity=ROUND(?,3), min_quantity=?, expiry_date=?, cost=? WHERE id=?')
      .run(b.name, b.name_ar, b.category, b.unit, b.quantity, b.min_quantity, b.expiry_date || null, b.cost, old.id);
    if (Number(b.quantity) !== old.quantity)
      db.prepare('INSERT INTO inventory_txns(item_id,change,reason,user_id) VALUES (?,?,?,?)').run(old.id, Number(b.quantity) - old.quantity, 'manual_adjust', u.id);
  })();
  audit(u, 'update', 'inventory_item', old.id, old, b);
  res.json({ ok: true });
});
app.get('/api/inventory/txns', (req, res) => {
  const u = U.requirePerm('inventory_view')(req, res); if (!u) return;
  res.json(db.prepare(`SELECT t.*, i.name item_name, u.username FROM inventory_txns t JOIN inventory_items i ON i.id=t.item_id LEFT JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 100`).all());
});

// ---------- EXPENSES ----------
app.get('/api/expenses', (req, res) => {
  const u = U.requirePerm('expenses')(req, res); if (!u) return;
  res.json(db.prepare(`SELECT e.*, us.username FROM expenses e LEFT JOIN users us ON us.id=e.created_by ORDER BY e.expense_date DESC, e.id DESC LIMIT 200`).all());
});
app.post('/api/expenses', (req, res) => {
  const u = U.requirePerm('expenses')(req, res); if (!u) return;
  const b = req.body || {};
  if (!b.title || !(Number(b.amount) > 0)) return res.status(400).json({ error: 'title_and_amount_required' });
  const r = db.prepare('INSERT INTO expenses(title,category,amount,expense_date,notes,created_by) VALUES (?,?,?,?,?,?)')
    .run(b.title, b.category || 'general', money(b.amount), b.expense_date || new Date().toISOString().slice(0, 10), b.notes || null, u.id);
  audit(u, 'create', 'expense', r.lastInsertRowid, null, b);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.delete('/api/expenses/:id', (req, res) => {
  const u = U.requirePerm('expenses')(req, res); if (!u) return;
  const old = db.prepare('SELECT * FROM expenses WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM expenses WHERE id=?').run(old.id);
  audit(u, 'delete', 'expense', old.id, old, null);
  res.json({ ok: true });
});

// ---------- QC ----------
app.get('/api/qc', (req, res) => {
  const u = U.requirePerm('qc')(req, res); if (!u) return;
  res.json(db.prepare(`SELECT q.*, t.code test_code, t.name_en test_name, a.name analyte_name, us.username FROM qc_entries q JOIN tests t ON t.id=q.test_id LEFT JOIN analytes a ON a.id=q.analyte_id LEFT JOIN users us ON us.id=q.entered_by ORDER BY q.id DESC LIMIT 100`).all());
});
app.post('/api/qc', (req, res) => {
  const u = U.requirePerm('qc')(req, res); if (!u) return;
  const b = req.body || {};
  const r = db.prepare('INSERT INTO qc_entries(test_id,analyte_id,level,value,target,sd,entry_date,entered_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(b.test_id, b.analyte_id || null, b.level || 'normal', b.value, b.target || null, b.sd || null, b.entry_date || new Date().toISOString().slice(0, 10), u.id);
  audit(u, 'create', 'qc_entry', r.lastInsertRowid, null, b);
  res.json({ ok: true, id: r.lastInsertRowid });
});

// ---------- HOME VISITS ----------
app.get('/api/homevisits', (req, res) => {
  const u = U.requirePerm('homevisits')(req, res); if (!u) return;
  res.json(db.prepare(`SELECT h.*, p.name patient_name, p.phone, us.name technician_name FROM home_visits h JOIN patients p ON p.id=h.patient_id LEFT JOIN users us ON us.id=h.technician_id ORDER BY h.scheduled_at`).all());
});
app.post('/api/homevisits', (req, res) => {
  const u = U.requirePerm('homevisits')(req, res); if (!u) return;
  const b = req.body || {};
  const r = db.prepare('INSERT INTO home_visits(patient_id,address,area,scheduled_at,technician_id,notes) VALUES (?,?,?,?,?,?)')
    .run(b.patient_id, b.address || '', b.area || '', b.scheduled_at, b.technician_id || null, b.notes || null);
  audit(u, 'create', 'home_visit', r.lastInsertRowid, null, b);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.post('/api/homevisits/:id/status', (req, res) => {
  const u = U.requirePerm('homevisits')(req, res); if (!u) return;
  const old = db.prepare('SELECT * FROM home_visits WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'not_found' });
  const st = (req.body || {}).status;
  if (!['scheduled', 'done', 'cancelled'].includes(st)) return res.status(400).json({ error: 'bad_status' });
  db.prepare('UPDATE home_visits SET status=? WHERE id=?').run(st, old.id);
  audit(u, 'update', 'home_visit', old.id, { status: old.status }, { status: st });
  res.json({ ok: true });
});

// ---------- DASHBOARD & FINANCE ----------
app.get('/api/dashboard', (req, res) => {
  const u = U.requirePerm('dashboard')(req, res); if (!u) return;
  const today = new Date().toISOString().slice(0, 10);
  const g = (sql, ...a) => db.prepare(sql).get(...a);
  const todayVisits = g(`SELECT COUNT(*) c FROM visits WHERE date(created_at)=?`, today).c;
  const pendingSamples = g(`SELECT COUNT(*) c FROM samples WHERE status IN ('pending','collected','processing')`).c;
  const awaitingApproval = g(`SELECT COUNT(*) c FROM visit_tests WHERE status='entered'`).c;
  const delayed = db.prepare(`SELECT s.id FROM samples s JOIN sample_tests st ON st.sample_id=s.id JOIN visit_tests vt ON vt.id=st.visit_test_id JOIN tests t ON t.id=vt.test_id JOIN visits v ON v.id=s.visit_id
    WHERE s.status NOT IN ('approved') AND datetime(v.created_at, '+' || t.tat_minutes || ' minutes') < datetime('now','localtime')`).all().length;
  const revToday = g(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE date(created_at)=?`, today).s;
  const expToday = g(`SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE expense_date=?`, today).s;
  const last7 = db.prepare(`SELECT date(created_at) d, SUM(amount) s FROM payments WHERE date(created_at) >= date('now','-6 day') GROUP BY date(created_at) ORDER BY d`).all();
  const deptMonth = db.prepare(`SELECT d.name_en, d.name_ar, SUM(vt.price + CASE WHEN vt.package_id IS NOT NULL THEN 0 ELSE 0 END) rev
    FROM visit_tests vt JOIN tests t ON t.id=vt.test_id LEFT JOIN departments d ON d.id=t.dept_id
    WHERE strftime('%Y-%m', vt.entered_at)=strftime('%Y-%m','now') OR strftime('%Y-%m',(SELECT created_at FROM visits WHERE id=vt.visit_id))=strftime('%Y-%m','now')
    GROUP BY d.id ORDER BY rev DESC LIMIT 8`).all();
  res.json({ todayVisits, pendingSamples, awaitingApproval, delayed, revToday: money(revToday), expToday: money(expToday), netToday: money(revToday - expToday), last7, deptMonth, maintenance: getSetting('maintenance', '0') === '1' });
});
app.get('/api/reports/finance', (req, res) => {
  const u = U.requirePerm('reports_view')(req, res); if (!u) return;
  const from = req.query.from || new Date().toISOString().slice(0, 8) + '01';
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const revenue = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE date(created_at) BETWEEN ? AND ?`).get(from, to).s;
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE expense_date BETWEEN ? AND ?`).get(from, to).s;
  const byDept = db.prepare(`SELECT COALESCE(d.name_en,'?') dept, COALESCE(d.name_ar,'') dept_ar, COUNT(*) tests, SUM(CASE WHEN vt.package_id IS NULL THEN vt.price ELSE 0 END) rev
    FROM visit_tests vt JOIN tests t ON t.id=vt.test_id LEFT JOIN departments d ON d.id=t.dept_id JOIN visits v ON v.id=vt.visit_id
    WHERE date(v.created_at) BETWEEN ? AND ? GROUP BY d.id ORDER BY rev DESC`).all(from, to);
  const byMethod = db.prepare(`SELECT method, SUM(amount) s FROM payments WHERE date(created_at) BETWEEN ? AND ? GROUP BY method`).all(from, to);
  res.json({ from, to, revenue: money(revenue), expenses: money(expenses), net: money(revenue - expenses), byDept, byMethod });
});

// ---------- AUDIT ----------
app.get('/api/audit', (req, res) => {
  const u = U.requirePerm('audit')(req, res); if (!u) return;
  const entity = req.query.entity;
  let sql = 'SELECT * FROM audit_log';
  if (entity) sql += ' WHERE entity=?';
  res.json(db.prepare(sql + ' ORDER BY id DESC LIMIT 300').all(...(entity ? [entity] : [])));
});
app.get('/api/notifications', (req, res) => {
  const u = U.requirePerm('dashboard')(req, res); if (!u) return;
  res.json(db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 50').all());
});

// ---------- USERS & SETTINGS ----------
app.get('/api/users', (req, res) => {
  const u = U.requirePerm('users')(req, res); if (!u) return;
  res.json(db.prepare('SELECT id,username,name,role,active,created_at FROM users').all());
});
app.post('/api/users', (req, res) => {
  const u = U.requirePerm('users')(req, res); if (!u) return;
  const b = req.body || {};
  if (!b.username || !b.password || !b.role) return res.status(400).json({ error: 'missing_fields' });
  if (!U.PERMS.dashboard.includes(b.role)) return res.status(400).json({ error: 'bad_role' });
  const salt = crypto.randomBytes(16).toString('hex');
  const r = db.prepare('INSERT INTO users(username,password_hash,salt,name,role) VALUES (?,?,?,?,?)')
    .run(b.username, U.hashPassword(b.password, salt), salt, b.name || b.username, b.role);
  audit(u, 'create', 'user', r.lastInsertRowid, null, { username: b.username, role: b.role });
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/users/:id', (req, res) => {
  const u = U.requirePerm('users')(req, res); if (!u) return;
  const old = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  db.prepare('UPDATE users SET name=?, role=?, active=? WHERE id=?').run(b.name ?? old.name, b.role ?? old.role, b.active === undefined ? old.active : (b.active ? 1 : 0), old.id);
  if (b.password) { const salt = crypto.randomBytes(16).toString('hex'); db.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?').run(U.hashPassword(b.password, salt), salt, old.id); }
  audit(u, 'update', 'user', old.id, { username: old.username, role: old.role, active: old.active }, { role: b.role, active: b.active, password_changed: !!b.password });
  res.json({ ok: true });
});
app.get('/api/settings', (req, res) => {
  const u = U.requirePerm('settings')(req, res); if (!u) return;
  res.json(Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value])));
});
app.put('/api/settings', (req, res) => {
  const u = U.requirePerm('settings')(req, res); if (!u) return;
  const b = req.body || {};
  for (const [k, v] of Object.entries(b)) {
    if (k === 'maintenance' && u.role !== 'admin') continue;
    U.setSetting(k, v);
  }
  audit(u, 'update', 'settings', null, null, b);
  res.json({ ok: true });
});

// ---------- BACKUP / EXPORT ----------
const BACKUP_TABLES = ['users','settings','departments','sample_types','tubes','tests','analytes','packages','package_tests','patients','doctors','insurance_contracts','visits','visit_tests','samples','sample_tests','results','invoices','payments','inventory_items','test_materials','inventory_txns','expenses','home_visits','qc_entries','audit_log','notifications'];
function jsonBackup() {
  const out = { version: 1, created_at: new Date().toISOString(), tables: {} };
  for (const t of BACKUP_TABLES) out.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return out;
}
function dailyBackup() {
  try {
    db.pragma('wal_checkpoint(FULL)');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    fs.writeFileSync(path.join(BACKUP_DIR, `lims-${stamp}.json`), JSON.stringify(jsonBackup()));
    fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, `lims-${stamp}.db`));
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort();
    files.slice(0, Math.max(0, files.length - 14)).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
    console.log('[backup] daily backup written', stamp);
  } catch (e) { console.error('[backup] failed', e.message); }
}
setInterval(() => { const h = new Date().getHours(); if (h === 2) dailyBackup(); }, 3600 * 1000);
app.get('/api/backup/download', (req, res) => {
  const u = U.requirePerm('backup')(req, res); if (!u) return;
  audit(u, 'backup_download', 'database', null, null, null);
  res.setHeader('Content-Disposition', `attachment; filename=lims-backup-${new Date().toISOString().slice(0, 10)}.json`);
  res.json(jsonBackup());
});
app.post('/api/backup/now', (req, res) => {
  const u = U.requirePerm('backup')(req, res); if (!u) return;
  dailyBackup();
  audit(u, 'backup_now', 'database', null, null, null);
  res.json({ ok: true, files: fs.readdirSync(BACKUP_DIR).sort().reverse().slice(0, 10) });
});
app.post('/api/backup/restore', (req, res) => {
  const u = U.requirePerm('backup')(req, res); if (!u) return;
  const data = req.body;
  if (!data || !data.tables) return res.status(400).json({ error: 'bad_backup_file' });
  const partial = Array.isArray(req.query.tables) ? req.query.tables : (req.query.tables ? String(req.query.tables).split(',') : null);
  const tables = partial || BACKUP_TABLES;
  db.transaction(() => {
    for (const t of tables) {
      if (!BACKUP_TABLES.includes(t) || !data.tables[t]) continue;
      if (t === 'audit_log') continue; // audit log is immutable - never restored over
      db.prepare(`DELETE FROM ${t}`).run();
      const rows = data.tables[t];
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const ins = db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const r of rows) ins.run(...cols.map(c => r[c]));
    }
    audit(u, partial ? 'restore_partial' : 'restore_full', 'database', null, null, { tables });
  })();
  res.json({ ok: true, tables });
});
// CSV exports
function sendCsv(res, name, rows) {
  if (!rows.length) { res.setHeader('Content-Type', 'text/csv'); return res.send('empty\n'); }
  const cols = Object.keys(rows[0]);
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${name}.csv`);
  res.send('﻿' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'));
}
app.get('/api/export/:what.csv', (req, res) => {
  const u = U.requireAuth(req, res); if (!u) return;
  const w = req.params.what;
  if (w === 'tests') sendCsv(res, 'tests', db.prepare(`SELECT t.code,t.name_en,t.name_ar,d.name_en department,t.price,t.tat_minutes,t.fasting,t.kind FROM tests t LEFT JOIN departments d ON d.id=t.dept_id`).all());
  else if (w === 'patients') sendCsv(res, 'patients', db.prepare('SELECT file_no,name,gender,dob,phone,civil_id FROM patients').all());
  else if (w === 'finance') sendCsv(res, 'finance', db.prepare(`SELECT i.invoice_no,p.name patient,i.subtotal,i.discount_amount,i.insurance_amount,i.total,i.paid,i.status,i.created_at FROM invoices i JOIN visits v ON v.id=i.visit_id JOIN patients p ON p.id=v.patient_id ORDER BY i.id DESC`).all());
  else return res.status(404).json({ error: 'unknown_export' });
});

// ---------- REPORT (print view, QR, verify) ----------
function reportData(visitId) {
  const v = db.prepare(`SELECT v.*, p.name patient_name, p.file_no, p.gender, p.dob, p.phone, d.name doctor_name, ic.company insurance_company
    FROM visits v JOIN patients p ON p.id=v.patient_id LEFT JOIN doctors d ON d.id=v.doctor_id LEFT JOIN insurance_contracts ic ON ic.id=v.insurance_id WHERE v.id=?`).get(visitId);
  if (!v) return null;
  const tests = db.prepare(`SELECT vt.id vtid, vt.status, vt.approved_at, t.code, t.name_en, t.kind, d.name_en dept, ap.name approver
    FROM visit_tests vt JOIN tests t ON t.id=vt.test_id LEFT JOIN departments d ON d.id=t.dept_id LEFT JOIN users ap ON ap.id=vt.approved_by WHERE vt.visit_id=? ORDER BY d.id, t.code`).all(visitId);
  for (const t of tests) {
    t.rows = db.prepare(`SELECT a.name, a.unit, a.kind, a.ref_low_male, a.ref_high_male, a.ref_low_female, a.ref_high_female, a.ref_low_child, a.ref_high_child, r.value, r.flag
      FROM results r JOIN analytes a ON a.id=r.analyte_id WHERE r.visit_test_id=? ORDER BY a.position`).all(t.vtid);
    const prev = db.prepare(`SELECT r.analyte_id, r.value FROM results r JOIN visit_tests vt2 ON vt2.id=r.visit_test_id JOIN visits v2 ON v2.id=vt2.visit_id
      WHERE v2.patient_id=? AND v2.id<? AND vt2.status='approved' AND vt2.test_id=(SELECT test_id FROM visit_tests WHERE id=?) ORDER BY v2.id DESC`).all(v.patient_id, visitId, t.vtid);
    const pm = {}; prev.forEach(r => { if (!(r.analyte_id in pm)) pm[r.analyte_id] = r.value; });
    const aids = db.prepare('SELECT id FROM analytes WHERE test_id=(SELECT test_id FROM visit_tests WHERE id=?) ORDER BY position').all(t.vtid);
    t.rows.forEach((row, i) => { row.prev = aids[i] ? (pm[aids[i].id] ?? null) : null; });
  }
  return { v, tests };
}
const FLAG_LABEL = { L: 'Low', H: 'High', CL: 'CRITICAL LOW', CH: 'CRITICAL HIGH', N: '' };
const FLAG_COLOR = { L: '#2563eb', H: '#dc2626', CL: '#7c3aed', CH: '#7c3aed', N: '#111' };
function refText(row, gender, dob) {
  const grp = U.ageGroup(dob);
  let lo, hi;
  if (grp === 'child' && row.ref_low_child != null) { lo = row.ref_low_child; hi = row.ref_high_child; }
  else if (gender === 'female') { lo = row.ref_low_female; hi = row.ref_high_female; }
  else { lo = row.ref_low_male; hi = row.ref_high_male; }
  if (lo == null && hi == null) return '-';
  return `${lo ?? ''} - ${hi ?? ''}`;
}
function reportHtml(rd, qrDataUrl, verifyUrl) {
  const { v, tests } = rd;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sections = tests.map(t => `
    <div class="tsec"><div class="thead2"><b>${esc(t.name_en)}</b> <span class="muted">(${esc(t.dept || '')} · ${esc(t.code)})</span></div>
    <table><thead><tr><th>Test</th><th>Result</th><th>Flag</th><th>Unit</th><th>Reference Range</th><th>Previous</th></tr></thead><tbody>
    ${t.rows.map(r => `<tr><td>${esc(r.name)}</td>
      <td style="font-weight:700;color:${FLAG_COLOR[r.flag] || '#111'}">${esc(r.value)}</td>
      <td style="color:${FLAG_COLOR[r.flag] || '#111'}">${FLAG_LABEL[r.flag] || ''}</td>
      <td>${esc(r.unit || '')}</td><td>${refText(r, v.gender, v.dob)}</td><td>${r.prev ?? '—'}</td></tr>`).join('')}
    </tbody></table>
    <div class="muted small">Approved by: ${esc(t.approver || '—')} · ${esc(t.approved_at || '')}</div></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Lab Report ${esc(v.visit_no)}</title><style>
  body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111;direction:ltr}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0e7490;padding-bottom:10px}
  .lab{font-size:22px;font-weight:800;color:#0e7490}.muted{color:#666}.small{font-size:11px}
  table{width:100%;border-collapse:collapse;margin:6px 0 14px}th,td{border:1px solid #ccc;padding:5px 8px;font-size:12.5px;text-align:left}th{background:#f0f9ff}
  .pinfo{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px 16px;margin:12px 0;font-size:13px}
  .tsec{page-break-inside:avoid;margin-top:8px}.thead2{font-size:14px;margin-top:10px}
  .foot{display:flex;justify-content:space-between;align-items:center;margin-top:18px;border-top:2px solid #0e7490;padding-top:10px}
  @media print {.noprint{display:none} body{margin:8mm}}
  .btn{background:#0e7490;color:#fff;border:0;padding:10px 18px;border-radius:8px;font-size:14px;cursor:pointer}
  </style></head><body>
  <div class="noprint" style="margin-bottom:10px"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
  <div class="hdr"><div><div class="lab">${esc(getSetting('lab_name_en'))}</div><div>${esc(getSetting('lab_name_ar'))}</div>
    <div class="muted small">${esc(getSetting('lab_address_en'))} · ${esc(getSetting('lab_phone'))} · ${esc(getSetting('lab_license'))}</div></div>
    <div style="text-align:right"><b>LABORATORY REPORT</b><br><span class="muted small">${esc(v.visit_no)} · ${esc(v.created_at)}</span></div></div>
  <div class="pinfo"><div><b>Patient:</b> ${esc(v.patient_name)}</div><div><b>File No:</b> ${esc(v.file_no)}</div><div><b>Gender:</b> ${esc(v.gender)}</div>
  <div><b>DOB:</b> ${esc(v.dob || '—')}</div><div><b>Doctor:</b> ${esc(v.doctor_name || '—')}</div><div><b>Sample date:</b> ${esc(v.created_at.slice(0, 10))}</div></div>
  ${sections}
  <div class="foot"><div class="small muted">This report is electronically approved. Verify authenticity by scanning the QR code.<br>${esc(verifyUrl)}</div>
  <img src="${qrDataUrl}" width="86" height="86" alt="QR"></div>
  </body></html>`;
}
app.get('/report/:id', async (req, res) => {
  const v = db.prepare('SELECT * FROM visits WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).send('Not found');
  const staff = U.getSessionUser(req);
  const byToken = req.query.token && req.query.token === v.report_token;
  if (!staff && !byToken) return res.status(403).send('Forbidden');
  const pending = db.prepare(`SELECT COUNT(*) c FROM visit_tests WHERE visit_id=? AND status != 'approved'`).get(v.id).c;
  if (pending > 0) {
    const manager = staff && ['admin', 'lab_manager'].includes(staff.role);
    if (!manager) return res.status(403).send(`<h3 style="font-family:Arial">Report not ready — ${pending} test(s) pending approval. يُمنع طباعة أي نتيجة غير معتمدة.</h3>`);
  }
  const rd = reportData(v.id);
  const verifyUrl = `${getSetting('base_url', `http://localhost:${PORT}`)}/verify/${v.report_token}`;
  const qr = await QRCode.toDataURL(verifyUrl, { margin: 1 });
  if (staff) audit(staff, 'print_report', 'visit', v.id, null, { visit_no: v.visit_no });
  res.send(reportHtml(rd, qr, verifyUrl));
});
app.get('/verify/:token', (req, res) => {
  const v = db.prepare(`SELECT v.*, p.name patient_name, p.file_no FROM visits v JOIN patients p ON p.id=v.patient_id WHERE v.report_token=?`).get(req.params.token);
  if (!v) return res.status(404).send('<h3 style="font-family:Arial">Invalid or unknown report token.</h3>');
  const approved = db.prepare(`SELECT COUNT(*) c FROM visit_tests WHERE visit_id=? AND status='approved'`).get(v.id).c;
  const total = db.prepare(`SELECT COUNT(*) c FROM visit_tests WHERE visit_id=?`).get(v.id).c;
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report Verification</title>
  <style>body{font-family:Arial;margin:0;background:#f0f9ff;display:flex;justify-content:center;padding:24px}.card{background:#fff;border-radius:12px;padding:24px;max-width:420px;box-shadow:0 4px 16px #0001}h2{color:#0e7490;margin:0 0 12px}</style></head>
  <body><div class="card"><h2>✓ Authentic Report</h2>
  <p><b>${getSetting('lab_name_en')}</b></p>
  <p>Patient: <b>${v.patient_name}</b><br>File: ${v.file_no}<br>Visit: ${v.visit_no}<br>Date: ${v.created_at}</p>
  <p>${approved} of ${total} tests approved.${approved === total && total > 0 ? ' <b style="color:green">Report complete.</b>' : ' <b style="color:#b45309">Partial — some tests pending.</b>'}</p>
  <p><a href="/report/${v.id}?token=${v.report_token}">View full report</a></p></div></body></html>`);
});
// patient portal: file number + portal code
app.get('/api/portal', (req, res) => {
  const { file_no, code } = req.query;
  const p = db.prepare('SELECT * FROM patients WHERE file_no=? AND portal_code=?').get(String(file_no || '').toUpperCase(), String(code || '').toUpperCase());
  if (!p) return res.status(401).json({ error: 'invalid_credentials' });
  const visits = db.prepare(`SELECT v.id, v.visit_no, v.created_at, v.report_token,
    (SELECT COUNT(*) FROM visit_tests vt WHERE vt.visit_id=v.id AND vt.status='approved') approved,
    (SELECT COUNT(*) FROM visit_tests vt WHERE vt.visit_id=v.id) total
    FROM visits v WHERE v.patient_id=? ORDER BY v.id DESC`).all(p.id);
  res.json({ patient: { name: p.name, file_no: p.file_no }, visits });
});

// ---------- STATIC ----------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/portal', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'portal.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`LIMS running: http://localhost:${PORT}  (LAN: http://<this-pc-ip>:${PORT})`);
  console.log('Default logins: admin/Admin@123, manager/Manager@123, recep/Recep@123, phlebo/Phlebo@123, tech/Tech@123, acc/Acc@123');
});
