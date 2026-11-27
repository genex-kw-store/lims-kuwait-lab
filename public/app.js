// app.js - LIMS SPA
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtM = n => (Number(n)||0).toFixed(3);
let ME = null, META = null;

async function api(path, opts={}) {
  const o = { headers: {}, ...opts };
  if (o.body && typeof o.body === 'object' && !(o.body instanceof Blob)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  const r = await fetch('/api' + path, o);
  if (r.status === 401) { showLogin(); throw new Error('login'); }
  if (r.status === 503) { alert(t('maintenance')); throw new Error('maint'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
function tubeIcon(color){ return `<span class="tubeicon" style="--cap:${color}"></span>`; }
function flagBadge(f){ if(!f||f==='N')return''; return `<span class="flag${f}">${f}</span>`; }
function statusBadge(s){
  const map={pending:'gray',collected:'info',processing:'warn',awaiting_approval:'purple',approved:'ok',active:'ok',cancelled:'err',entered:'info',scheduled:'info',done:'ok',open:'info',complete:'ok'};
  const lbl={pending:t('pending'),collected:t('collected'),processing:t('processing'),awaiting_approval:t('awaiting'),approved:t('approved'),active:s,cancelled:t('cancelled'),entered:t('enter'),scheduled:t('scheduled'),done:t('done'),open:s,complete:'✓'}[s]||s;
  return `<span class="badge ${map[s]||'gray'}">${lbl}</span>`;
}
function modal(html, wide){
  $('#modalRoot').innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal${wide?' wide':''}">${html}</div></div>`;
}
function closeModal(){ $('#modalRoot').innerHTML=''; }
function refTextOf(a, gender, dob){
  const child = dob && ((Date.now()-new Date(dob))/(365.25*864e5)) < 12;
  let lo,hi;
  if(child && a.ref_low_child!=null){lo=a.ref_low_child;hi=a.ref_high_child;}
  else if(gender==='female'){lo=a.ref_low_female;hi=a.ref_high_female;}
  else {lo=a.ref_low_male;hi=a.ref_high_male;}
  if(lo==null&&hi==null) return a.kind==='text' ? (a.text_hint||'-') : '-';
  return `${lo??''} - ${hi??''}`;
}

// ---------- AUTH ----------
async function boot(){
  applyLang();
  try { const me = await api('/me'); ME = me.user; await enterApp(me.maintenance); }
  catch { showLogin(); }
}
function showLogin(){ $('#loginView').classList.remove('hidden'); $('#mainView').classList.add('hidden'); }
async function enterApp(maint){
  $('#loginView').classList.add('hidden'); $('#mainView').classList.remove('hidden');
  $('#userChip').textContent = `${ME.name} (${ME.role})`;
  $('#maintBadge').classList.toggle('hidden', !maint);
  META = await api('/meta');
  $('#brandName').textContent = LANG==='ar' ? (META.settings.lab_name_ar||'LIMS') : (META.settings.lab_name_en||'LIMS');
  buildNav(); route();
}
$('#loginBtn').onclick = async () => {
  $('#loginErr').classList.add('hidden');
  try {
    const j = await api('/login', { method:'POST', body:{ username:$('#loginUser').value, password:$('#loginPass').value } });
    ME = j.user; await enterApp(false);
  } catch(e){ const el=$('#loginErr'); el.textContent=t('loginFailed'); el.classList.remove('hidden'); }
};
$('#loginPass').addEventListener('keydown', e=>{ if(e.key==='Enter') $('#loginBtn').click(); });
$('#logoutBtn').onclick = async ()=>{ await api('/logout',{method:'POST'}); location.reload(); };
$('#langBtn').onclick = ()=>{ LANG = LANG==='ar'?'en':'ar'; localStorage.setItem('lims_lang',LANG); applyLang(); if(ME) enterApp(false); };

// ---------- NAV / ROUTER ----------
const NAV = [
  ['sec','navMain'],
  ['dashboard','dashboard',U=>true],
  ['reception','reception',U=>['admin','lab_manager','reception'].includes(U.role)],
  ['visits','visits',U=>true],
  ['sec','navLab'],
  ['samples','samples',U=>true],
  ['results','results',U=>['admin','lab_manager','technician'].includes(U.role)],
  ['approvals','approvals',U=>['admin','lab_manager'].includes(U.role)],
  ['qc','qc',U=>['admin','lab_manager','technician'].includes(U.role)],
  ['sec','navAdmin'],
  ['invoices','invoices',U=>['admin','lab_manager','reception','accountant'].includes(U.role)],
  ['inventory','inventory',U=>['admin','lab_manager','technician'].includes(U.role)],
  ['accounting','accounting',U=>['admin','accountant'].includes(U.role)],
  ['homevisits','homevisits',U=>['admin','reception','phlebotomist'].includes(U.role)],
  ['sec','navSystem'],
  ['tests','tests',U=>['admin','lab_manager'].includes(U.role)],
  ['audit','audit',U=>['admin','lab_manager'].includes(U.role)],
  ['users','users',U=>U.role==='admin'],
  ['settings','settings',U=>U.role==='admin'],
];
function buildNav(){
  $('#nav').innerHTML = NAV.map(([k,l,cond])=>{
    if(k==='sec') return `<div class="sec">${t(l)}</div>`;
    if(cond && !cond(ME)) return '';
    return `<a href="#/${k}" data-route="${k}">${t(l)}</a>`;
  }).join('');
}
const ROUTES = {};
function route(){
  const k = (location.hash||'#/dashboard').replace('#/','') || 'dashboard';
  document.querySelectorAll('#nav a').forEach(a=>a.classList.toggle('active',a.dataset.route===k));
  $('#pageTitle').textContent = t(k)||k;
  (ROUTES[k]||ROUTES.dashboard)();
}
window.addEventListener('hashchange', route);

// ---------- DASHBOARD ----------
ROUTES.dashboard = async () => {
  const d = await api('/dashboard');
  $('#view').innerHTML = `
  ${d.maintenance?`<div class="alertbar">⚠ ${t('maintenance')}</div>`:''}
  <div class="grid cols4">
    <div class="card stat"><div class="num">${d.todayVisits}</div><div class="lbl">${t('todayPatients')}</div></div>
    <div class="card stat"><div class="num">${d.pendingSamples}</div><div class="lbl">${t('pendingSamples')}</div></div>
    <div class="card stat"><div class="num">${d.awaitingApproval}</div><div class="lbl">${t('awaitingApproval')}</div></div>
    <div class="card stat"><div class="num" style="color:${d.delayed?'var(--red)':'inherit'}">${d.delayed}</div><div class="lbl">${t('delayed')}</div></div>
    <div class="card stat"><div class="num">${fmtM(d.revToday)}</div><div class="lbl">${t('revenueToday')} (${META.settings.currency})</div></div>
    <div class="card stat"><div class="num">${fmtM(d.expToday)}</div><div class="lbl">${t('expensesToday')}</div></div>
    <div class="card stat"><div class="num" style="color:${d.netToday<0?'var(--red)':'var(--green)'}">${fmtM(d.netToday)}</div><div class="lbl">${t('netToday')}</div></div>
  </div>
  <div class="grid cols2" style="margin-top:14px">
    <div class="card"><h4>${t('last7')}</h4><canvas id="ch7" height="180"></canvas></div>
    <div class="card"><h4>${t('deptMonth')}</h4><canvas id="chD" height="180"></canvas></div>
  </div>`;
  const days=[...Array(7)].map((_,i)=>{const dt=new Date(Date.now()-(6-i)*864e5);return dt.toISOString().slice(0,10);});
  const m7=Object.fromEntries((d.last7||[]).map(r=>[r.d,r.s]));
  new Chart($('#ch7'),{type:'bar',data:{labels:days.map(x=>x.slice(5)),datasets:[{data:days.map(x=>m7[x]||0),backgroundColor:'#0e7490'}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
  new Chart($('#chD'),{type:'doughnut',data:{labels:(d.deptMonth||[]).map(x=>LANG==='ar'?x.name_ar:x.name_en),datasets:[{data:(d.deptMonth||[]).map(x=>x.rev||0),backgroundColor:['#0e7490','#7c3aed','#16a34a','#d97706','#dc2626','#2563eb','#0891b2','#65a30d']}]}});
};

// ---------- RECEPTION ----------
ROUTES.reception = async () => {
  $('#view').innerHTML = `
  <div class="toolbar"><input id="pq" placeholder="${t('search')} (${t('name')} / ${t('phone')} / ${t('civilId')} / ${t('fileNo')})" style="width:340px">
  <button class="btn primary" id="npBtn">${t('newPatient')}</button>
  <button class="btn" id="noBtn">${t('newOrder')}</button></div>
  <div class="card"><table class="tbl" id="ptable"></table></div>`;
  const load = async () => {
    const rows = await api('/patients?q='+encodeURIComponent($('#pq').value));
    $('#ptable').innerHTML = `<thead><tr><th>${t('fileNo')}</th><th>${t('name')}</th><th>${t('gender')}</th><th>${t('dob')}</th><th>${t('phone')}</th><th>${t('civilId')}</th><th>${t('actions')}</th></tr></thead>
    <tbody>${rows.map(p=>`<tr><td>${p.file_no}</td><td><b>${esc(p.name)}</b></td><td>${t(p.gender)}</td><td>${p.dob||'—'}</td><td>${esc(p.phone||'')}</td><td>${esc(p.civil_id||'')}</td>
    <td><button class="btn sm" onclick="patientHistory(${p.id})">${t('view')}</button> <button class="btn sm primary" onclick="orderWizard(${p.id})">${t('newOrder')}</button></td></tr>`).join('')}</tbody>`;
  };
  $('#pq').oninput = load; load();
  $('#npBtn').onclick = () => patientModal(null, load);
  $('#noBtn').onclick = () => orderWizard(null);
};
function patientModal(p, after){
  modal(`<h3>${p? t('edit') : t('newPatient')}</h3>
  <label>${t('name')}</label><input id="pf_name" value="${esc(p?.name||'')}">
  <div class="row"><div><label>${t('gender')}</label><select id="pf_gender"><option value="male" ${p?.gender==='male'?'selected':''}>${t('male')}</option><option value="female" ${p?.gender==='female'?'selected':''}>${t('female')}</option></select></div>
  <div><label>${t('dob')}</label><input id="pf_dob" type="date" value="${p?.dob||''}"></div></div>
  <div class="row"><div><label>${t('phone')}</label><input id="pf_phone" value="${esc(p?.phone||'')}"></div>
  <div><label>${t('civilId')}</label><input id="pf_civil" value="${esc(p?.civil_id||'')}"></div></div>
  <button class="btn primary block" id="pfSave">${t('save')}</button>`);
  $('#pfSave').onclick = async ()=>{
    const body={name:$('#pf_name').value,gender:$('#pf_gender').value,dob:$('#pf_dob').value||null,phone:$('#pf_phone').value,civil_id:$('#pf_civil').value};
    if(!body.name) return alert(t('name')+'?');
    if(p) await api('/patients/'+p.id,{method:'PUT',body});
    else { const j=await api('/patients',{method:'POST',body}); alert(`${t('fileNo')}: ${j.file_no} · ${t('portalCode')}: ${j.portal_code}`); }
    closeModal(); after && after();
  };
}
async function patientHistory(id){
  const j = await api('/patients/'+id);
  modal(`<h3>${esc(j.patient.name)} <span class="muted">${j.patient.file_no}</span></h3>
  <p class="muted small">${t('portalCode')}: <b>${j.patient.portal_code}</b> · ${t('phone')}: ${esc(j.patient.phone||'—')}</p>
  <table class="tbl"><thead><tr><th>#</th><th>${t('date')}</th><th>${t('test')}</th><th>${t('status')}</th><th></th></tr></thead>
  <tbody>${j.visits.map(v=>`<tr><td>${v.visit_no}</td><td>${v.created_at}</td><td>${v.approved_count}/${v.test_count}</td><td>${statusBadge(v.status)}</td>
  <td><a class="btn sm" href="#/visits" onclick="setTimeout(()=>openVisit(${v.id}),50)">${t('view')}</a></td></tr>`).join('')||`<tr><td colspan=5 class="muted">—</td></tr>`}</tbody></table>
  <button class="btn" onclick="closeModal()">${t('close')}</button> <button class="btn primary" onclick="closeModal();orderWizard(${id})">${t('newOrder')}</button>`, true);
}

// ---------- ORDER WIZARD (smart tube guide) ----------
async function orderWizard(patientId){
  let selTests = new Set(), selPkgs = new Set();
  let pid = patientId;
  modal(`<h3>${t('newOrder')}</h3>
  ${pid? '' : `<label>${t('patient')}</label><select id="ow_patient"><option value="">—</option></select>`}
  <div class="row">
    <div><label>${t('doctor')}</label><select id="ow_doctor"><option value="">—</option>${META.doctors.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
    <div><label>${t('insurance')}</label><select id="ow_ins"><option value="">—</option>${META.insurance.map(i=>`<option value="${i.id}">${esc(i.company)} (${i.coverage_percent}%)</option>`).join('')}</select></div>
    <div><label>${t('discount')}</label><input id="ow_disc" type="number" min="0" max="100" value="0"></div>
  </div>
  <label style="margin-top:10px"><input type="checkbox" id="ow_home" style="width:auto"> ${t('homeVisit')}</label>
  <div class="grid cols2" style="margin-top:10px">
    <div>
      <h4>${t('packages')}</h4><div id="ow_pkgs">${META.packages.map(p=>`<div class="testpick" data-pkg="${p.id}">📦 <b>${LANG==='ar'?p.name_ar:p.name_en}</b> <span class="muted" style="margin-inline-start:auto">${fmtM(p.price)}</span></div>`).join('')}</div>
      <h4 style="margin-top:12px">${t('selectTests')}</h4><input id="ow_q" placeholder="${t('search')}" style="margin-bottom:6px">
      <div id="ow_tests" style="max-height:300px;overflow-y:auto"></div>
    </div>
    <div>
      <h4>${t('tubeGuide')}</h4><div id="ow_tubes"></div>
      <div id="ow_fast"></div>
      <div class="card" style="margin-top:10px" id="ow_totals"></div>
      <button class="btn primary block" id="ow_go">${t('createOrder')}</button>
    </div>
  </div>`, true);
  if(!pid){ const ps = await api('/patients?q='); $('#ow_patient').innerHTML += ps.map(p=>`<option value="${p.id}">${esc(p.name)} (${p.file_no})</option>`).join(''); }
  const renderTests = ()=>{
    const q = ($('#ow_q').value||'').toLowerCase();
    $('#ow_tests').innerHTML = META.tests.filter(x=>!q || x.code.toLowerCase().includes(q)||x.name_en.toLowerCase().includes(q)||x.name_ar.includes(q))
      .map(x=>`<div class="testpick ${selTests.has(x.id)?'sel':''}" data-test="${x.id}">${tubeIcon(x.tube_color)}<div><b>${x.code}</b> ${LANG==='ar'?x.name_ar:x.name_en} ${x.fasting?'🍽️':''}<div class="muted small">${x.dept_ar||''} · ${x.tat_minutes}m</div></div><span style="margin-inline-start:auto">${fmtM(x.price)}</span></div>`).join('');
    document.querySelectorAll('[data-test]').forEach(el=>el.onclick=()=>{const id=+el.dataset.test; selTests.has(id)?selTests.delete(id):selTests.add(id); el.classList.toggle('sel'); recalc();});
  };
  document.querySelectorAll('[data-pkg]').forEach(el=>el.onclick=()=>{const id=+el.dataset.pkg; selPkgs.has(id)?selPkgs.delete(id):selPkgs.add(id); el.classList.toggle('sel'); recalc();});
  $('#ow_q').oninput = renderTests; renderTests();
  function recalc(){
    // expand packages
    const testIds = new Set(selTests);
    selPkgs.forEach(pk=>META.packageTests.filter(x=>x.package_id===pk).forEach(x=>testIds.add(x.test_id)));
    const tests = META.tests.filter(x=>testIds.has(x.id));
    // tube consolidation
    const byTube = new Map();
    tests.forEach(x=>{ if(!byTube.has(x.tube_id)) byTube.set(x.tube_id,[]); byTube.get(x.tube_id).push(x.code); });
    const tubes = META.tubes;
    $('#ow_tubes').innerHTML = `<div class="muted small">${t('tubeConsolidation')}</div>` +
      [...byTube.entries()].map(([tid,codes])=>{ const tb=tubes.find(z=>z.id===tid);
        return `<div class="tubebox">${tubeIcon(tb?.color||'#999')}<div><b>${LANG==='ar'?tb?.name_ar:tb?.name_en}</b><div class="muted small">${codes.join(', ')}</div></div></div>`;}).join('')
      + `<div class="badge info">${byTube.size} ${t('tubesNeeded')}</div>`;
    const fast = tests.filter(x=>x.fasting);
    $('#ow_fast').innerHTML = fast.length? `<div class="alertbar">🍽️ ${t('fastingAlert')}: ${fast.map(x=>x.code).join(', ')}${fast[0].prep_note_ar&&LANG==='ar'?' — '+fast[0].prep_note_ar:''}</div>` : '';
    let sub = 0; selTests.forEach(id=>sub += META.tests.find(x=>x.id===id)?.price||0);
    selPkgs.forEach(pk=>sub += META.packages.find(x=>x.id===pk)?.price||0);
    const disc = Number($('#ow_disc').value||0), discAmt = sub*disc/100;
    const insSel = META.insurance.find(i=>i.id===+($('#ow_ins')?.value||0));
    const insAmt = insSel ? (sub-discAmt)*insSel.coverage_percent/100 : 0;
    $('#ow_totals').innerHTML = `<div class="row"><span>${t('subtotal')}</span><b>${fmtM(sub)}</b></div>
    <div class="row"><span>${t('discount')}</span><b>- ${fmtM(discAmt)}</b></div>
    ${insSel?`<div class="row"><span>${t('insCover')} (${insSel.coverage_percent}%)</span><b>- ${fmtM(insAmt)}</b></div>`:''}
    <div class="row" style="font-size:17px"><span>${t('total')} (${META.settings.currency})</span><b>${fmtM(sub-discAmt-insAmt)}</b></div>`;
  }
  ['ow_disc','ow_ins'].forEach(id=>{ const el=$('#'+id); if(el) el.oninput=recalc; });
  recalc();
  $('#ow_go').onclick = async ()=>{
    const patient = pid || +$('#ow_patient')?.value;
    if(!patient) return alert(t('patient')+'?');
    if(!selTests.size && !selPkgs.size) return alert(t('selectTests')+'?');
    const j = await api('/visits',{method:'POST',body:{patient_id:patient,doctor_id:+$('#ow_doctor').value||null,insurance_id:+$('#ow_ins').value||null,discount_percent:+$('#ow_disc').value||0,home_visit:$('#ow_home').checked,tests:[...selTests],packages:[...selPkgs]}});
    closeModal(); alert(`${t('orderCreated')}\n${t('invoiceNo')}: ${j.invoiceNo} · ${t('total')}: ${fmtM(j.total)} ${META.settings.currency}`);
    location.hash='#/visits'; setTimeout(()=>openVisit(j.visitId),150);
  };
}

// ---------- VISITS ----------
ROUTES.visits = async () => {
  const rows = await api('/visits');
  $('#view').innerHTML = `<div class="card"><table class="tbl"><thead><tr><th>#</th><th>${t('patient')}</th><th>${t('test')}</th><th>${t('invoiceNo')}</th><th>${t('total')}</th><th>${t('status')}</th><th>${t('actions')}</th></tr></thead>
  <tbody>${rows.map(v=>`<tr><td>${v.visit_no}</td><td><b>${esc(v.patient_name)}</b><br><span class="muted small">${v.file_no}</span></td>
  <td>${v.approved_count}/${v.test_count}</td><td>${v.invoice_no||'—'}</td><td>${fmtM(v.total)}</td><td>${statusBadge(v.status)}</td>
  <td><button class="btn sm" onclick="openVisit(${v.id})">${t('view')}</button> <a class="btn sm primary" target="_blank" href="/report/${v.id}">${t('report')}</a></td></tr>`).join('')}</tbody></table></div>`;
};
async function openVisit(id){
  const j = await api('/visits/'+id);
  const v=j.visit;
  modal(`<h3>${v.visit_no} — ${esc(v.patient_name)}</h3>
  <p class="muted small">${v.created_at} · ${t(v.gender)} · ${v.dob||''} · ${esc(v.doctor_name||'')} ${v.insurance_company?'· '+esc(v.insurance_company):''} ${v.home_visit?'· 🏠':''}</p>
  <h4>${t('tubeGuide')} (${j.samples.length})</h4>
  ${j.samples.map(s=>`<div class="tubebox">${tubeIcon(s.tube_color)}<div><b>${s.barcode}</b> · ${LANG==='ar'?s.tube_ar:s.tube_en}<div class="muted small">${esc(s.test_codes||'')}</div></div><span style="margin-inline-start:auto">${statusBadge(s.status)}</span></div>`).join('')}
  <h4>${t('test')}</h4>
  <table class="tbl"><tbody>${j.tests.map(x=>`<tr><td>${tubeIcon(x.tube_color)} <b>${x.code}</b> ${LANG==='ar'?x.name_ar:x.name_en}</td><td>${fmtM(x.price)}</td><td>${statusBadge(x.status)}</td></tr>`).join('')}</tbody></table>
  <h4>${t('invoices')}</h4>
  <div class="card" style="background:#f8fafc">${j.invoice?`<div class="row"><span>${t('subtotal')}</span><b>${fmtM(j.invoice.subtotal)}</b></div>
  <div class="row"><span>${t('discount')} ${j.invoice.discount_percent}%</span><b>- ${fmtM(j.invoice.discount_amount)}</b></div>
  <div class="row"><span>${t('insCover')} ${j.invoice.insurance_percent}%</span><b>- ${fmtM(j.invoice.insurance_amount)}</b></div>
  <div class="row" style="font-size:16px"><span>${t('total')}</span><b>${fmtM(j.invoice.total)} ${META.settings.currency}</b></div>
  <div class="row"><span>${t('paid')}</span><b>${fmtM(j.invoice.paid)}</b></div>`:'—'}</div>
  <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><a class="btn primary" target="_blank" href="/report/${v.id}">${t('printReport')}</a>
  <button class="btn" onclick="closeModal()">${t('close')}</button></div>`, true);
}

// ---------- SAMPLES ----------
ROUTES.samples = async () => {
  const rows = await api('/samples');
  const cols = ['pending','collected','processing','awaiting_approval','approved'];
  $('#view').innerHTML = `<div class="kanban">${cols.map(c=>`<div class="kcol"><h4>${statusBadge(c)} (${rows.filter(r=>r.status===c).length})</h4>
    ${rows.filter(r=>r.status===c).map(s=>`<div class="kcard">${tubeIcon(s.tube_color)}<b>${s.barcode}</b><br>${esc(s.patient_name)}<br><span class="muted small">${esc(s.test_codes||'')}</span><br>
    <div style="margin-top:6px">${s.status==='pending'?`<button class="btn sm primary" onclick="collectSample(${s.id})">${t('collect')}</button> `:''}<button class="btn sm" onclick="printLabel(${s.id})">${t('printLabel')}</button></div></div>`).join('')}</div>`).join('')}</div>`;
};
async function collectSample(id){ await api(`/samples/${id}/collect`,{method:'POST'}); ROUTES.samples(); }
async function printLabel(id){
  const rows = await api('/samples'); const s = rows.find(r=>r.id===id); if(!s) return;
  const w = window.open('','_blank','width=420,height=300');
  w.document.write(`<html><head><title>${s.barcode}</title><script src="/vendor/JsBarcode.all.min.js"><\/script></head><body style="font-family:Arial;text-align:center;margin:12px">
  <div style="border:2px dashed #333;padding:10px;display:inline-block">
  <div style="font-weight:700">${esc(s.patient_name)} · ${s.barcode}</div>
  <svg id="bc"></svg>
  <div style="font-size:12px">${new Date().toLocaleString()} · ${esc(s.test_codes||'')}</div>
  <div style="width:16px;height:16px;border-radius:3px;background:${s.tube_color};display:inline-block;border:1px solid #333"></div></div>
  <script>JsBarcode("#bc", "${s.barcode}", {format:"CODE128", width:1.6, height:44, fontSize:12}); window.print();<\/script></body></html>`);
  w.document.close();
}

// ---------- RESULTS ----------
ROUTES.results = async () => {
  const rows = await api('/worksheet');
  $('#view').innerHTML = `<div class="card"><h4>${t('worksheet')}</h4>
  <table class="tbl"><thead><tr><th>#</th><th>${t('patient')}</th><th>${t('test')}</th><th>${t('department')}</th><th>${t('status')}</th><th>${t('actions')}</th></tr></thead>
  <tbody>${rows.map(r=>`<tr><td>${r.visit_no}</td><td><b>${esc(r.patient_name)}</b><br><span class="muted small">${r.file_no} · ${t(r.gender)}</span></td>
  <td><b>${r.code}</b> ${LANG==='ar'?r.name_ar:r.name_en} ${r.kind==='calculated'?'🧮':''}</td><td>${LANG==='ar'?r.dept_ar:r.dept_en}</td>
  <td>${statusBadge(r.status)}</td><td><button class="btn sm primary" onclick="entryModal(${r.visit_test_id})">${t('enter')}</button></td></tr>`).join('')||`<tr><td colspan=6 class="muted">—</td></tr>`}</tbody></table></div>`;
};
async function entryModal(vtid){
  const j = await api('/visit-tests/'+vtid);
  const vt=j.visitTest;
  const vals = Object.fromEntries(j.results.map(r=>[r.analyte_id,r.value]));
  modal(`<h3>${t('enterResults')}: ${vt.code} — ${esc(vt.patient_name)} <span class="muted">(${vt.visit_no})</span></h3>
  ${vt.kind==='calculated'?`<div class="alertbar">🧮 ${t('calculatedAuto')}: <code>${esc(vt.formula||'')}</code></div>`:''}
  <table class="tbl"><thead><tr><th>${t('analyte')}</th><th>${t('value')}</th><th>${t('unit')}</th><th>${t('reference')}</th><th>${t('previous')}</th><th>${t('flag')}</th></tr></thead>
  <tbody>${j.analytes.map(a=>{
    const prev = j.prevMap[a.id];
    return `<tr><td>${esc(a.name)}</td>
    <td>${vt.kind==='calculated'?'<span class="muted">auto</span>':(a.kind==='text'?`<input data-an="${a.id}" value="${esc(vals[a.id]??'')}" placeholder="${esc(a.text_hint||'')}">`:`<input data-an="${a.id}" type="number" step="any" value="${esc(vals[a.id]??'')}">`)}</td>
    <td class="muted">${esc(a.unit||'')}</td><td class="muted">${refTextOf(a, vt.gender, vt.dob)}</td>
    <td class="muted">${prev?esc(prev.value):'—'}</td><td id="fl_${a.id}"></td></tr>`;}).join('')}</tbody></table>
  <button class="btn primary block" id="rsSave">${t('save')}</button>`, true);
  // live flag preview
  document.querySelectorAll('[data-an]').forEach(inp=>inp.oninput=()=>{
    const a = j.analytes.find(x=>x.id===+inp.dataset.an);
    const v = parseFloat(inp.value);
    let f='';
    if(!isNaN(v)&&a.kind==='numeric'){
      const child = vt.dob && ((Date.now()-new Date(vt.dob))/(365.25*864e5))<12;
      let lo,hi; if(child&&a.ref_low_child!=null){lo=a.ref_low_child;hi=a.ref_high_child;}else if(vt.gender==='female'){lo=a.ref_low_female;hi=a.ref_high_female;}else{lo=a.ref_low_male;hi=a.ref_high_male;}
      if(a.critical_low!=null&&v<a.critical_low)f='CL'; else if(a.critical_high!=null&&v>a.critical_high)f='CH';
      else if(lo!=null&&v<lo)f='L'; else if(hi!=null&&v>hi)f='H';
    }
    $('#fl_'+a.id).innerHTML = flagBadge(f);
  });
  $('#rsSave').onclick = async ()=>{
    const results = j.analytes.filter(a=>vt.kind!=='calculated').map(a=>{const el=document.querySelector(`[data-an="${a.id}"]`);return el&&el.value!==''?{analyte_id:a.id,value:el.value}:null;}).filter(Boolean);
    if(!results.length && vt.kind!=='calculated') return alert(t('value')+'?');
    await api(`/visit-tests/${vt.id}/results`,{method:'POST',body:{results}});
    closeModal(); ROUTES.results();
  };
}

// ---------- APPROVALS ----------
ROUTES.approvals = async () => {
  const rows = (await api('/worksheet')).filter(r=>r.status==='entered');
  $('#view').innerHTML = `<div class="card"><h4>${t('approvals')} (${rows.length})</h4>
  <table class="tbl"><thead><tr><th></th><th>#</th><th>${t('patient')}</th><th>${t('test')}</th><th>${t('enteredBy')}</th><th>${t('actions')}</th></tr></thead>
  <tbody>${rows.map(r=>`<tr><td><input type="checkbox" class="apc" value="${r.visit_test_id}" style="width:auto"></td><td>${r.visit_no}</td>
  <td><b>${esc(r.patient_name)}</b></td><td><b>${r.code}</b> ${LANG==='ar'?r.name_ar:r.name_en}</td>
  <td class="muted small">${r.entered_at||''}</td>
  <td><button class="btn sm" onclick="entryModal(${r.visit_test_id})">${t('view')}</button> <button class="btn sm primary" onclick="approveVT(${r.visit_test_id})">${t('approve')}</button></td></tr>`).join('')||`<tr><td colspan=6 class="muted">—</td></tr>`}</tbody></table>
  <button class="btn primary" style="margin-top:10px" onclick="approveSel()">${t('approveSelected')}</button></div>`;
};
async function approveVT(id){ await api(`/visit-tests/${id}/approve`,{method:'POST'}); ROUTES.approvals(); }
async function approveSel(){ for(const c of document.querySelectorAll('.apc:checked')) await approveVT(+c.value); if(!document.querySelectorAll('.apc:checked').length) ROUTES.approvals(); }

// ---------- INVOICES ----------
ROUTES.invoices = async () => {
  const rows = await api('/invoices');
  $('#view').innerHTML = `<div class="card"><table class="tbl"><thead><tr><th>${t('invoiceNo')}</th><th>${t('patient')}</th><th>${t('total')}</th><th>${t('paid')}</th><th>${t('status')}</th><th>${t('date')}</th><th>${t('actions')}</th></tr></thead>
  <tbody>${rows.map(i=>`<tr><td>${i.invoice_no}</td><td><b>${esc(i.patient_name)}</b><br><span class="muted small">${i.visit_no}</span></td>
  <td>${fmtM(i.total)}</td><td>${fmtM(i.paid)}</td><td>${statusBadge(i.status)}</td><td class="muted small">${i.created_at}</td>
  <td>${i.status==='active'?`<button class="btn sm primary" onclick="payModal(${i.id},${i.total},${i.paid})">${t('pay')}</button> <button class="btn sm danger" onclick="cancelInv(${i.id})">${t('cancelInvoice')}</button>`:`<span class="muted small">${esc(i.cancel_reason||'')}</span>`}</td></tr>`).join('')}</tbody></table></div>`;
};
function payModal(id,total,paid){
  modal(`<h3>${t('pay')}</h3><p>${t('total')}: <b>${fmtM(total)}</b> · ${t('paid')}: ${fmtM(paid)} · ${LANG==='ar'?'المتبقي':'Remaining'}: <b>${fmtM(total-paid)}</b></p>
  <label>${t('amount')}</label><input id="pm_amt" type="number" step="0.001" value="${fmtM(total-paid)}">
  <label>${t('method')}</label><select id="pm_m"><option value="cash">${t('cash')}</option><option value="knet">${t('knet')}</option><option value="transfer">${t('transfer')}</option><option value="credit">${t('credit')}</option></select>
  <button class="btn primary block" id="pmGo">${t('confirm')}</button>`);
  $('#pmGo').onclick = async ()=>{ await api(`/invoices/${id}/pay`,{method:'POST',body:{amount:+$('#pm_amt').value,method:$('#pm_m').value}}); closeModal(); ROUTES.invoices(); };
}
async function cancelInv(id){
  const reason = prompt(t('reason')); if(reason===null) return;
  await api(`/invoices/${id}/cancel`,{method:'POST',body:{reason}}); ROUTES.invoices();
}

// ---------- INVENTORY ----------
ROUTES.inventory = async () => {
  const items = await api('/inventory');
  const canEdit = ['admin','lab_manager'].includes(ME.role);
  const alerts = items.filter(i=>i.low_stock||i.expiring_soon||i.expired);
  $('#view').innerHTML = `
  ${alerts.length?`<div class="alertbar">⚠ ${alerts.map(i=>`${esc(LANG==='ar'&&i.name_ar?i.name_ar:i.name)} ${i.expired?'('+t('expired')+')':i.expiring_soon?'('+t('expiringSoon')+' '+i.expiry_date+')':i.low_stock?'('+t('lowStock')+': '+i.quantity+')':''}`).join(' · ')}</div>`:''}
  <div class="toolbar">${canEdit?`<button class="btn primary" onclick="itemModal()">${t('addItem')}</button>`:''}
  <span class="muted small">${t('autoDeduct')}</span></div>
  <div class="card"><table class="tbl"><thead><tr><th>${t('item')}</th><th>${t('category')}</th><th>${t('quantity')}</th><th>${t('minQty')}</th><th>${t('expiry')}</th><th>${t('status')}</th>${canEdit?`<th>${t('actions')}</th>`:''}</tr></thead>
  <tbody>${items.map(i=>`<tr><td><b>${esc(LANG==='ar'&&i.name_ar?i.name_ar:i.name)}</b></td><td class="muted">${esc(i.category||'')}</td>
  <td><b>${Math.round(i.quantity*1000)/1000}</b> ${esc(i.unit||'')}</td><td>${i.min_quantity}</td><td>${i.expiry_date||'—'}</td>
  <td>${i.expired?`<span class="badge err">${t('expired')}</span>`:i.expiring_soon?`<span class="badge warn">${t('expiringSoon')}</span>`:''} ${i.low_stock?`<span class="badge err">${t('lowStock')}</span>`:`<span class="badge ok">OK</span>`}</td>
  ${canEdit?`<td><button class="btn sm" onclick='itemModal(${JSON.stringify(i)})'>${t('edit')}</button></td>`:''}</tr>`).join('')}</tbody></table></div>`;
};
function itemModal(i){
  modal(`<h3>${i?t('edit'):t('addItem')}</h3>
  <div class="row"><div><label>${t('nameEn')}</label><input id="in_n" value="${esc(i?.name||'')}"></div><div><label>${t('nameAr')}</label><input id="in_na" value="${esc(i?.name_ar||'')}"></div></div>
  <div class="row"><div><label>${t('category')}</label><input id="in_c" value="${esc(i?.category||'')}"></div><div><label>${t('unit')}</label><input id="in_u" value="${esc(i?.unit||'pcs')}"></div></div>
  <div class="row"><div><label>${t('quantity')}</label><input id="in_q" type="number" step="any" value="${i?.quantity??0}"></div><div><label>${t('minQty')}</label><input id="in_m" type="number" step="any" value="${i?.min_quantity??0}"></div>
  <div><label>${t('expiry')}</label><input id="in_e" type="date" value="${i?.expiry_date||''}"></div></div>
  <button class="btn primary block" id="inSave">${t('save')}</button>`);
  $('#inSave').onclick=async()=>{
    const body={name:$('#in_n').value,name_ar:$('#in_na').value,category:$('#in_c').value,unit:$('#in_u').value,quantity:+$('#in_q').value,min_quantity:+$('#in_m').value,expiry_date:$('#in_e').value||null,cost:i?.cost||0};
    if(i) await api('/inventory/'+i.id,{method:'PUT',body}); else await api('/inventory',{method:'POST',body});
    closeModal(); ROUTES.inventory();
  };
}

// ---------- ACCOUNTING ----------
ROUTES.accounting = async () => {
  const today = new Date().toISOString().slice(0,10), first = today.slice(0,8)+'01';
  $('#view').innerHTML = `
  <div class="card"><div class="toolbar"><label style="margin:0">${t('from')} <input type="date" id="fn_from" value="${first}" style="width:auto;display:inline-block"></label>
  <label style="margin:0">${t('to')} <input type="date" id="fn_to" value="${today}" style="width:auto;display:inline-block"></label>
  <button class="btn" id="fnGo">${t('view')}</button><a class="btn" href="/api/export/finance.csv" target="_blank">${t('exportCsv')}</a></div>
  <div id="fnOut"></div></div>
  <div class="card" style="margin-top:14px"><div class="toolbar"><h4 style="margin:0;flex:1">${t('expenses')}</h4><button class="btn primary" onclick="expModal()">${t('addExpense')}</button></div><div id="expOut"></div></div>`;
  const loadF = async ()=>{
    const f = await api(`/reports/finance?from=${$('#fn_from').value}&to=${$('#fn_to').value}`);
    $('#fnOut').innerHTML = `<div class="grid cols4">
    <div class="card stat"><div class="num" style="color:var(--green)">${fmtM(f.revenue)}</div><div class="lbl">${t('revenue')}</div></div>
    <div class="card stat"><div class="num" style="color:var(--red)">${fmtM(f.expenses)}</div><div class="lbl">${t('expenses')}</div></div>
    <div class="card stat"><div class="num" style="color:${f.net<0?'var(--red)':'var(--green)'}">${fmtM(f.net)}</div><div class="lbl">${t('net')}</div></div></div>
    <div class="grid cols2" style="margin-top:10px"><div><h4>${t('byDept')}</h4><table class="tbl">${f.byDept.map(d=>`<tr><td>${LANG==='ar'?d.dept_ar||d.dept:d.dept}</td><td>${d.tests}</td><td><b>${fmtM(d.rev)}</b></td></tr>`).join('')}</table></div>
    <div><h4>${t('byMethod')}</h4><table class="tbl">${f.byMethod.map(m=>`<tr><td>${t(m.method)||m.method}</td><td><b>${fmtM(m.s)}</b></td></tr>`).join('')}</table></div></div>`;
  };
  const loadE = async ()=>{
    const rows = await api('/expenses');
    $('#expOut').innerHTML = `<table class="tbl"><thead><tr><th>${t('date')}</th><th>${t('title')}</th><th>${t('category')}</th><th>${t('amount')}</th><th>${t('user')}</th><th></th></tr></thead>
    <tbody>${rows.map(e=>`<tr><td>${e.expense_date}</td><td>${esc(e.title)}</td><td class="muted">${esc(e.category||'')}</td><td><b>${fmtM(e.amount)}</b></td><td class="muted">${e.username||''}</td>
    <td><button class="btn sm danger" onclick="delExp(${e.id})">✕</button></td></tr>`).join('')||`<tr><td colspan=6 class="muted">—</td></tr>`}</tbody></table>`;
  };
  $('#fnGo').onclick = loadF; loadF(); loadE();
};
function expModal(){
  modal(`<h3>${t('addExpense')}</h3>
  <label>${t('title')}</label><input id="ex_t"><div class="row"><div><label>${t('category')}</label><input id="ex_c" value="general"></div>
  <div><label>${t('amount')} (${META.settings.currency})</label><input id="ex_a" type="number" step="0.001"></div>
  <div><label>${t('date')}</label><input id="ex_d" type="date" value="${new Date().toISOString().slice(0,10)}"></div></div>
  <button class="btn primary block" id="exGo">${t('save')}</button>`);
  $('#exGo').onclick=async()=>{ await api('/expenses',{method:'POST',body:{title:$('#ex_t').value,category:$('#ex_c').value,amount:+$('#ex_a').value,expense_date:$('#ex_d').value}}); closeModal(); ROUTES.accounting(); };
}
async function delExp(id){ if(!confirm(t('confirm'))) return; await api('/expenses/'+id,{method:'DELETE'}); ROUTES.accounting(); }

// ---------- HOME VISITS ----------
ROUTES.homevisits = async () => {
  const rows = await api('/homevisits');
  $('#view').innerHTML = `<div class="toolbar"><button class="btn primary" onclick="hvModal()">${t('addHomeVisit')}</button></div>
  <div class="card"><table class="tbl"><thead><tr><th>${t('patient')}</th><th>${t('phone')}</th><th>${t('area')}</th><th>${t('address')}</th><th>${t('scheduledAt')}</th><th>${t('technician')}</th><th>${t('status')}</th><th></th></tr></thead>
  <tbody>${rows.map(h=>`<tr><td><b>${esc(h.patient_name)}</b></td><td>${esc(h.phone||'')}</td><td>${esc(h.area||'')}</td><td class="muted">${esc(h.address||'')}</td>
  <td>${h.scheduled_at}</td><td>${esc(h.technician_name||'—')}</td><td>${statusBadge(h.status)}</td>
  <td>${h.status==='scheduled'?`<button class="btn sm primary" onclick="hvStatus(${h.id},'done')">${t('done')}</button> <button class="btn sm danger" onclick="hvStatus(${h.id},'cancelled')">${t('cancel')}</button>`:''}</td></tr>`).join('')||`<tr><td colspan=8 class="muted">—</td></tr>`}</tbody></table></div>`;
};
async function hvModal(){
  const ps = await api('/patients?q=');
  modal(`<h3>${t('addHomeVisit')}</h3>
  <label>${t('patient')}</label><select id="hv_p">${ps.map(p=>`<option value="${p.id}">${esc(p.name)} (${p.file_no})</option>`).join('')}</select>
  <div class="row"><div><label>${t('area')}</label><input id="hv_area"></div><div><label>${t('scheduledAt')}</label><input id="hv_at" type="datetime-local"></div></div>
  <label>${t('address')}</label><input id="hv_addr">
  <button class="btn primary block" id="hvGo">${t('save')}</button>`);
  $('#hvGo').onclick=async()=>{ await api('/homevisits',{method:'POST',body:{patient_id:+$('#hv_p').value,area:$('#hv_area').value,address:$('#hv_addr').value,scheduled_at:$('#hv_at').value.replace('T',' ')||new Date().toISOString().slice(0,16).replace('T',' ')}}); closeModal(); ROUTES.homevisits(); };
}
async function hvStatus(id,s){ await api(`/homevisits/${id}/status`,{method:'POST',body:{status:s}}); ROUTES.homevisits(); }

// ---------- QC ----------
ROUTES.qc = async () => {
  const rows = await api('/qc');
  $('#view').innerHTML = `<div class="toolbar"><button class="btn primary" onclick="qcModal()">${t('addQc')}</button></div>
  <div class="card"><table class="tbl"><thead><tr><th>${t('date')}</th><th>${t('test')}</th><th>${t('analyte')}</th><th>${t('level')}</th><th>${t('value')}</th><th>${t('target')}</th><th>${t('user')}</th></tr></thead>
  <tbody>${rows.map(q=>{const dev=q.target?((q.value-q.target)/q.target*100):null;const bad=dev!==null&&Math.abs(dev)>10;
  return `<tr><td>${q.entry_date}</td><td><b>${q.test_code}</b></td><td>${esc(q.analyte_name||'—')}</td><td>${q.level}</td>
  <td style="${bad?'color:var(--red);font-weight:700':''}">${q.value}${bad?' ⚠':''}</td><td class="muted">${q.target??'—'}${q.sd?` ±${q.sd}`:''}</td><td class="muted">${q.username||''}</td></tr>`;}).join('')||`<tr><td colspan=7 class="muted">—</td></tr>`}</tbody></table></div>`;
};
function qcModal(){
  modal(`<h3>${t('addQc')}</h3>
  <label>${t('test')}</label><select id="qc_t">${META.tests.filter(x=>x.kind!=='calculated').map(x=>`<option value="${x.id}">${x.code} — ${LANG==='ar'?x.name_ar:x.name_en}</option>`).join('')}</select>
  <div class="row"><div><label>${t('level')}</label><select id="qc_l"><option>normal</option><option>high</option><option>low</option></select></div>
  <div><label>${t('value')}</label><input id="qc_v" type="number" step="any"></div>
  <div><label>${t('target')}</label><input id="qc_tg" type="number" step="any"></div></div>
  <button class="btn primary block" id="qcGo">${t('save')}</button>`);
  $('#qcGo').onclick=async()=>{ await api('/qc',{method:'POST',body:{test_id:+$('#qc_t').value,level:$('#qc_l').value,value:+$('#qc_v').value,target:+$('#qc_tg').value||null}}); closeModal(); ROUTES.qc(); };
}

// ---------- TESTS CATALOG ----------
ROUTES.tests = async () => {
  $('#view').innerHTML = `<div class="toolbar"><button class="btn primary" onclick="testModal()">${t('addTest')}</button>
  <a class="btn" href="/api/export/tests.csv" target="_blank">${t('exportCsv')}</a></div>
  <div class="card"><table class="tbl"><thead><tr><th>${t('code')}</th><th>${t('test')}</th><th>${t('department')}</th><th>${t('tube')}</th><th>${t('price')}</th><th>${t('tat')}</th><th></th><th></th></tr></thead>
  <tbody>${META.tests.map(x=>`<tr><td><b>${x.code}</b></td><td>${LANG==='ar'?x.name_ar:x.name_en}${x.kind==='calculated'?' 🧮':''}${x.outsourced?' 📤':''}</td>
  <td class="muted">${LANG==='ar'?x.dept_ar:x.dept_en}</td><td>${tubeIcon(x.tube_color)} ${x.tube_code}</td><td><b>${fmtM(x.price)}</b></td><td class="muted">${x.tat_minutes}</td><td>${x.fasting?'🍽️':''}</td>
  <td><button class="btn sm" onclick="testModal(${x.id})">${t('edit')}</button></td></tr>`).join('')}</tbody></table></div>`;
};
function testModal(id){
  const x = id ? META.tests.find(z=>z.id===id) : null;
  modal(`<h3>${x?t('edit')+' '+x.code:t('addTest')}</h3>
  ${x?'':`<label>${t('code')}</label><input id="tf_code">`}
  <div class="row"><div><label>${t('nameEn')}</label><input id="tf_ne" value="${esc(x?.name_en||'')}"></div><div><label>${t('nameAr')}</label><input id="tf_na" value="${esc(x?.name_ar||'')}"></div></div>
  <div class="row"><div><label>${t('department')}</label><select id="tf_d">${META.departments.map(d=>`<option value="${d.id}" ${x?.dept_id===d.id?'selected':''}>${LANG==='ar'?d.name_ar:d.name_en}</option>`).join('')}</select></div>
  <div><label>${t('sampleType')}</label><select id="tf_s">${META.sampleTypes.map(s=>`<option value="${s.id}" ${x?.sample_type_id===s.id?'selected':''}>${LANG==='ar'?s.name_ar:s.name_en}</option>`).join('')}</select></div>
  <div><label>${t('tube')}</label><select id="tf_t">${META.tubes.map(tb=>`<option value="${tb.id}" ${x?.tube_id===tb.id?'selected':''}>${LANG==='ar'?tb.name_ar:tb.name_en}</option>`).join('')}</select></div></div>
  <div class="row"><div><label>${t('price')} (${META.settings.currency})</label><input id="tf_p" type="number" step="0.001" value="${x?.price??0}"></div>
  <div><label>${t('tat')}</label><input id="tf_tat" type="number" value="${x?.tat_minutes??240}"></div>
  <div><label>&nbsp;</label><label style="margin:0"><input type="checkbox" id="tf_f" style="width:auto" ${x?.fasting?'checked':''}> ${t('fasting')}</label>
  <label style="margin:0"><input type="checkbox" id="tf_o" style="width:auto" ${x?.outsourced?'checked':''}> ${t('outsourced')}</label></div></div>
  <button class="btn primary block" id="tfGo">${t('save')}</button>`);
  $('#tfGo').onclick=async()=>{
    const body={name_en:$('#tf_ne').value,name_ar:$('#tf_na').value,dept_id:+$('#tf_d').value,sample_type_id:+$('#tf_s').value,tube_id:+$('#tf_t').value,price:+$('#tf_p').value,tat_minutes:+$('#tf_tat').value,fasting:$('#tf_f').checked,outsourced:$('#tf_o').checked,kind:x?.kind||'numeric',formula:x?.formula||null,active:1};
    if(x) await api('/tests/'+x.id,{method:'PUT',body});
    else { body.code=$('#tf_code').value; await api('/tests',{method:'POST',body}); }
    closeModal(); META = await api('/meta'); ROUTES.tests();
  };
}

// ---------- AUDIT ----------
ROUTES.audit = async () => {
  const rows = await api('/audit');
  $('#view').innerHTML = `<div class="card"><table class="tbl"><thead><tr><th>${t('time')}</th><th>${t('user')}</th><th>${t('action')}</th><th>${t('entity')}</th><th>${t('oldVal')}</th><th>${t('newVal')}</th></tr></thead>
  <tbody>${rows.map(a=>`<tr><td class="muted small" style="white-space:nowrap">${a.ts}</td><td><b>${esc(a.username||'')}</b></td>
  <td><span class="badge ${a.action.includes('cancel')||a.action.includes('delete')?'err':a.action.includes('create')?'ok':'info'}">${esc(a.action)}</span></td>
  <td>${esc(a.entity)} #${esc(a.entity_id||'')}</td>
  <td class="muted small" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${esc((a.old_value||'').slice(0,120))}</td>
  <td class="muted small" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${esc((a.new_value||'').slice(0,120))}</td></tr>`).join('')}</tbody></table></div>`;
};

// ---------- USERS ----------
ROUTES.users = async () => {
  const rows = await api('/users');
  $('#view').innerHTML = `<div class="toolbar"><button class="btn primary" onclick="userModal()">${t('addUser')}</button></div>
  <div class="card"><table class="tbl"><thead><tr><th>${t('username')}</th><th>${t('name')}</th><th>${t('role')}</th><th>${t('active')}</th><th></th></tr></thead>
  <tbody>${rows.map(u=>`<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.name)}</td><td><span class="badge info">${u.role}</span></td>
  <td>${u.active?'✅':'⛔'}</td><td><button class="btn sm" onclick="userModal(${u.id})">${t('edit')}</button></td></tr>`).join('')}</tbody></table></div>`;
};
async function userModal(id){
  const rows = await api('/users'); const x = id?rows.find(r=>r.id===id):null;
  modal(`<h3>${x?t('edit')+' '+x.username:t('addUser')}</h3>
  ${x?'':`<label>${t('username')}</label><input id="uf_u">`}
  <label>${t('name')}</label><input id="uf_n" value="${esc(x?.name||'')}">
  <div class="row"><div><label>${t('role')}</label><select id="uf_r">${['admin','lab_manager','reception','phlebotomist','technician','accountant'].map(r=>`<option ${x?.role===r?'selected':''}>${r}</option>`).join('')}</select></div>
  <div><label>${x?t('resetPass'):t('password')}</label><input id="uf_p" type="password"></div></div>
  ${x?`<label><input type="checkbox" id="uf_a" style="width:auto" ${x.active?'checked':''}> ${t('active')}</label>`:''}
  <button class="btn primary block" id="ufGo">${t('save')}</button>`);
  $('#ufGo').onclick=async()=>{
    if(x) await api('/users/'+x.id,{method:'PUT',body:{name:$('#uf_n').value,role:$('#uf_r').value,active:$('#uf_a').checked,password:$('#uf_p').value||undefined}});
    else await api('/users',{method:'POST',body:{username:$('#uf_u').value,name:$('#uf_n').value,role:$('#uf_r').value,password:$('#uf_p').value}});
    closeModal(); ROUTES.users();
  };
}

// ---------- SETTINGS ----------
ROUTES.settings = async () => {
  const s = await api('/settings');
  const notes = await api('/notifications');
  $('#view').innerHTML = `
  <div class="grid cols2">
  <div class="card"><h4>${t('settings')}</h4>
    <div class="row"><div><label>${t('labNameEn')}</label><input id="st_lne" value="${esc(s.lab_name_en||'')}"></div><div><label>${t('labNameAr')}</label><input id="st_lna" value="${esc(s.lab_name_ar||'')}"></div></div>
    <div class="row"><div><label>${t('labPhone')}</label><input id="st_ph" value="${esc(s.lab_phone||'')}"></div><div><label>${t('license')}</label><input id="st_li" value="${esc(s.lab_license||'')}"></div></div>
    <div class="row"><div><label>${t('addressEn')}</label><input id="st_ae" value="${esc(s.lab_address_en||'')}"></div><div><label>${t('addressAr')}</label><input id="st_aa" value="${esc(s.lab_address_ar||'')}"></div></div>
    <div class="row"><div><label>${t('currency')}</label><input id="st_cu" value="${esc(s.currency||'KWD')}"></div><div><label>${t('baseUrl')}</label><input id="st_bu" value="${esc(s.base_url||'')}"></div></div>
    <label>${t('whatsappReady')}</label><input id="st_wa" value="${esc(s.whatsapp_api_key||'')}" placeholder="API key">
    <label style="margin-top:10px"><input type="checkbox" id="st_mm" style="width:auto" ${s.maintenance==='1'?'checked':''}> ${t('maintenanceMode')}</label>
    <button class="btn primary block" id="stGo">${t('saveSettings')}</button></div>
  <div class="card"><h4>${t('backupNow')}</h4>
    <div class="toolbar"><button class="btn primary" id="bkNow">${t('backupNow')}</button>
    <a class="btn" href="/api/backup/download">${t('downloadBackup')}</a>
    <label class="btn" style="margin:0">${t('restoreBackup')}<input type="file" id="bkRestore" accept=".json" style="display:none"></label></div>
    <div class="muted small">${t('portalHint')}</div>
    <div style="margin-top:8px"><a class="btn sm" href="/api/export/patients.csv" target="_blank">${t('exportCsv')}: ${t('patients')||'patients'}</a>
    <a class="btn sm" href="/api/export/tests.csv" target="_blank">${t('exportCsv')}: ${t('tests')}</a></div>
    <h4 style="margin-top:16px">${t('importResults')}</h4>
    <div class="muted small">CSV: barcode,test_code,analyte,value</div>
    <div class="toolbar"><input type="file" id="devCsv" accept=".csv"><button class="btn" id="devGo">${t('importResults')}</button></div>
    <div id="devOut" class="muted small"></div></div>
  <div class="card"><h4>${t('notifications')}</h4>
    <table class="tbl"><tbody>${notes.map(n=>`<tr><td class="muted small">${n.ts}</td><td>${esc(n.channel)}</td><td>${esc(n.recipient||'')}</td><td class="small">${esc((n.message||'').slice(0,90))}</td><td>${n.status==='queued'?`<span class="badge info">${t('queued')}</span>`:`<span class="badge gray">${t('disabled')}</span>`}</td></tr>`).join('')||'<tr><td class="muted">—</td></tr>'}</tbody></table></div>
  </div>`;
  $('#stGo').onclick=async()=>{ await api('/settings',{method:'PUT',body:{lab_name_en:$('#st_lne').value,lab_name_ar:$('#st_lna').value,lab_phone:$('#st_ph').value,lab_license:$('#st_li').value,lab_address_en:$('#st_ae').value,lab_address_ar:$('#st_aa').value,currency:$('#st_cu').value,base_url:$('#st_bu').value,whatsapp_api_key:$('#st_wa').value,maintenance:$('#st_mm').checked?'1':'0'}}); META=await api('/meta'); alert('✓'); };
  $('#bkNow').onclick=async()=>{ const j=await api('/backup/now',{method:'POST'}); alert('✓ '+j.files[0]); };
  $('#bkRestore').onchange=async(e)=>{ const f=e.target.files[0]; if(!f)return; if(!confirm(t('confirm')+'?'))return;
    const j=JSON.parse(await f.text()); await api('/backup/restore',{method:'POST',body:j}); alert('✓'); };
  $('#devGo').onclick=async()=>{ const f=$('#devCsv').files[0]; if(!f)return;
    const r=await fetch('/api/import/results',{method:'POST',headers:{'Content-Type':'text/csv'},body:await f.text()});
    const j=await r.json(); $('#devOut').textContent=JSON.stringify(j); };
};

boot();
