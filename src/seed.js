// seed.js - master data seeding, runs automatically on first start
const crypto = require('crypto');

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function seed(db) {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count > 0) return false;

  const tx = db.transaction(() => {
    // ---- Settings ----
    const setS = db.prepare('INSERT INTO settings(key,value) VALUES (?,?)');
    const settings = {
      lab_name_en: 'Al-Noor Medical Laboratory', lab_name_ar: 'مختبر النور الطبي',
      lab_phone: '+965 9000 0000', lab_address_en: 'Kuwait - Farwaniya', lab_address_ar: 'الكويت - الفروانية',
      lab_license: 'MOH License No. 0000', currency: 'KWD', decimals: '3',
      maintenance: '0', base_url: 'http://localhost:3000',
      whatsapp_api_key: '', whatsapp_enabled: '0', sms_enabled: '0',
      low_stock_alerts: '1', expiry_alert_days: '60'
    };
    for (const [k, v] of Object.entries(settings)) setS.run(k, v);

    // ---- Users ----
    const insU = db.prepare('INSERT INTO users(username,password_hash,salt,name,role) VALUES (?,?,?,?,?)');
    const addUser = (u, p, n, r) => { const s = crypto.randomBytes(16).toString('hex'); insU.run(u, hashPassword(p, s), s, n, r); };
    addUser('admin', 'Admin@123', 'General Manager / المدير العام', 'admin');
    addUser('manager', 'Manager@123', 'Lab Manager / مدير المعمل', 'lab_manager');
    addUser('recep', 'Recep@123', 'Reception / الاستقبال', 'reception');
    addUser('phlebo', 'Phlebo@123', 'Phlebotomist / فني السحب', 'phlebotomist');
    addUser('tech', 'Tech@123', 'Lab Technologist / أخصائي المختبر', 'technician');
    addUser('acc', 'Acc@123', 'Accountant / المحاسب', 'accountant');

    // ---- Departments ----
    const insD = db.prepare('INSERT INTO departments(name_en,name_ar) VALUES (?,?)');
    const depts = [
      ['Clinical Chemistry', 'الكيمياء الحيوية'],
      ['Hematology', 'أمراض الدم'],
      ['Coagulation', 'السيولة والتجلط'],
      ['Hormones & Tumor Markers', 'الهرمونات ودلالات الأورام'],
      ['Immunology & Serology', 'المناعة والأمصال'],
      ['Microbiology & Cultures', 'الميكروبيولوجي والمزارع'],
      ['Clinical Pathology / Parasitology', 'الطفيليات والتحاليل الإكلينيكية'],
      ['Molecular Biology / PCR', 'البيولوجيا الجزيئية'],
      ['Outsourced / Reference Labs', 'المعامل الخارجية']
    ];
    depts.forEach(d => insD.run(...d));

    // ---- Sample types ----
    const insST = db.prepare('INSERT INTO sample_types(name_en,name_ar) VALUES (?,?)');
    [['Whole Blood','دم كامل'],['Serum','مصل'],['Plasma','بلازما'],['Urine','بول'],['Stool','براز'],['Swab','مسحة'],['Semen','سائل منوي']]
      .forEach(s => insST.run(...s));

    // ---- Tubes ----
    const insT = db.prepare('INSERT INTO tubes(code,name_en,name_ar,color,cap_color,use_en,use_ar) VALUES (?,?,?,?,?,?,?)');
    [
      ['GEL', 'Serum / Gel Tube', 'أنبوبة مصل / جل', '#e8b400', 'red-yellow', 'Chemistry, hormones, serology', 'الكيمياء، الهرمونات، الفيروسات'],
      ['EDTA', 'EDTA Tube', 'أنبوبة إيديتا', '#8e44ad', 'lavender', 'CBC, HbA1c, blood grouping', 'صورة الدم، السكر التراكمي، فصائل الدم'],
      ['CIT', 'Sodium Citrate Tube', 'أنبوبة سيترات', '#3498db', 'light-blue', 'Coagulation: PT, PTT, INR', 'السيولة: PT, PTT, INR'],
      ['FLU', 'Fluoride Oxalate Tube', 'أنبوبة فلورايد', '#7f8c8d', 'grey', 'Fasting / random glucose', 'السكر الصائم والفاطر'],
      ['ESR', 'ESR Tube', 'أنبوبة ترسيب', '#2c3e50', 'black', 'ESR', 'سرعة الترسيب'],
      ['HEP', 'Heparin Tube', 'أنبوبة هيبارين', '#27ae60', 'green', 'Special chemistry', 'كيمياء خاصة'],
      ['CUP', 'Sterile Container', 'عبوة معقمة', '#ffffff', 'sterile', 'Urine, stool, cultures', 'البول، البراز، المزارع']
    ].forEach(t => insT.run(...t));

    // ---- Tests + analytes ----
    const insTest = db.prepare(`INSERT INTO tests(code,name_en,name_ar,dept_id,sample_type_id,tube_id,price,tat_minutes,fasting,prep_note_en,prep_note_ar,kind,formula,outsourced) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insA = db.prepare(`INSERT INTO analytes(test_id,name,unit,position,kind,ref_low_male,ref_high_male,ref_low_female,ref_high_female,ref_low_child,ref_high_child,critical_low,critical_high,text_hint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    // helper: tube ids GEL=1 EDTA=2 CIT=3 FLU=4 ESR=5 HEP=6 CUP=7 ; samples: WB=1 SER=2 PL=3 UR=4 ST=5 SW=6
    const T = (code,en,ar,dept,sample,tube,price,tat,fasting,kind,formula,outsourced,prepEn,prepAr,analytes) => {
      const r = insTest.run(code,en,ar,dept,sample,tube,price,tat,fasting||0,prepEn||null,prepAr||null,kind||'numeric',formula||null,outsourced||0);
      const tid = r.lastInsertRowid;
      (analytes||[]).forEach((a,i)=>insA.run(tid,a[0],a[1]||null,i,a[2]||'numeric',a[3],a[4],a[5],a[6],a[7],a[8],a[9],a[10],a[11]||null));
      return tid;
    };
    // analyte row: [name, unit, kind, mLow,mHigh, fLow,fHigh, cLow,cHigh(child), critLow,critHigh, textHint]
    const tALT = T('ALT','ALT (SGPT)','إنزيم ALT',1,2,1,2.5,240,0,'numeric',null,0,null,null,[['ALT','U/L','numeric',10,49,10,35,null,null,null,null]]);
    const tAST = T('AST','AST (SGOT)','إنزيم AST',1,2,1,2.5,240,0,'numeric',null,0,null,null,[['AST','U/L','numeric',0,40,0,40,null,null,null,null]]);
    const tALP = T('ALP','Alkaline Phosphatase','الفوسفاتاز القلوي',1,2,1,2.5,240,0,'numeric',null,0,null,null,[['ALP','U/L','numeric',40,129,40,129,150,420,null,null]]);
    T('BIL','Bilirubin Total','البيليروبين الكلي',1,2,1,2.0,240,0,'numeric',null,0,null,null,[['Bilirubin Total','mg/dL','numeric',0.1,1.2,0.1,1.2,null,null,null,null]]);
    const tALB = T('ALB','Albumin','الألبيومين',1,2,1,2.0,240,0,'numeric',null,0,null,null,[['Albumin','g/dL','numeric',3.5,5.2,3.5,5.2,null,null,null,null]]);
    const tTP = T('TP','Total Protein','البروتين الكلي',1,2,1,2.0,240,0,'numeric',null,0,null,null,[['Total Protein','g/dL','numeric',6.0,8.3,6.0,8.3,null,null,null,null]]);
    T('AG','A/G Ratio','نسبة الألبيومين/الجلوبيولين',1,2,1,2.0,240,0,'calculated','ALB/(TP-ALB)',0,null,null,[['A/G Ratio','','numeric',1.1,2.2,1.1,2.2,null,null,null,null]]);
    const tCREA = T('CREA','Creatinine','الكرياتينين',1,2,1,2.5,240,0,'numeric',null,0,null,null,[['Creatinine','mg/dL','numeric',0.7,1.3,0.6,1.1,0.3,0.7,null,7.4]]);
    T('UREA','Urea','اليوريا',1,2,1,2.0,240,0,'numeric',null,0,null,null,[['Urea','mg/dL','numeric',17,43,17,43,null,null,null,null]]);
    T('UA','Uric Acid','حمض اليوريك',1,2,1,2.0,240,0,'numeric',null,0,null,null,[['Uric Acid','mg/dL','numeric',3.5,7.2,2.6,6.0,null,null,null,null]]);
    const tGLUF = T('GLUF','Glucose Fasting','سكر صائم',1,2,4,1.5,120,1,'numeric',null,0,'Fasting 8-12 hours required','يلزم صيام ٨-١٢ ساعة',[['Glucose Fasting','mg/dL','numeric',70,100,70,100,70,100,50,400]]);
    T('GLUR','Glucose Random','سكر عشوائي',1,2,4,1.0,60,0,'numeric',null,0,null,null,[['Glucose Random','mg/dL','numeric',70,140,70,140,null,null,50,400]]);
    const tHBA1C = T('HBA1C','HbA1c (Glycated Hemoglobin)','السكر التراكمي',1,1,2,3.0,240,0,'numeric',null,0,null,null,[['HbA1c','%','numeric',4.0,5.6,4.0,5.6,null,null,null,null]]);
    const tCHOL = T('CHOL','Cholesterol Total','الكوليسترول الكلي',1,2,1,2.0,240,1,'numeric',null,0,'Fasting 9-12 hours preferred','يفضل صيام ٩-١٢ ساعة',[['Cholesterol Total','mg/dL','numeric',0,200,0,200,0,170,null,null]]);
    const tTG = T('TG','Triglycerides','الدهون الثلاثية',1,2,1,2.5,240,1,'numeric',null,0,'Fasting 9-12 hours required','يلزم صيام ٩-١٢ ساعة',[['Triglycerides','mg/dL','numeric',0,150,0,150,null,null,null,null]]);
    const tHDL = T('HDL','HDL Cholesterol','الكوليسترول النافع',1,2,1,2.5,240,1,'numeric',null,0,'Fasting 9-12 hours preferred','يفضل صيام ٩-١٢ ساعة',[['HDL','mg/dL','numeric',40,90,50,90,null,null,null,null]]);
    T('LDL','LDL Cholesterol','الكوليسترول الضار',1,2,1,2.5,240,1,'calculated','CHOL-HDL-TG/5',0,'Calculated (Friedewald): needs CHOL, HDL, TG in same visit','يُحسب تلقائياً: يتطلب الكوليسترول والنافع والدهون الثلاثية في نفس الزيارة',[['LDL','mg/dL','numeric',0,100,0,100,null,null,null,null]]);
    T('VLDL','VLDL Cholesterol','VLDL',1,2,1,1.5,240,1,'calculated','TG/5',0,null,null,[['VLDL','mg/dL','numeric',10,40,10,40,null,null,null,null]]);
    T('NA','Sodium (Na)','الصوديوم',1,2,1,2.0,240,0,'numeric',null,0,null,null,[['Sodium','mmol/L','numeric',136,145,136,145,null,null,120,160]]);
    T('K','Potassium (K)','البوتاسيوم',1,2,1,2.0,240,0,'numeric',null,0,null,null,[['Potassium','mmol/L','numeric',3.5,5.1,3.5,5.1,null,null,2.8,6.2]]);
    T('CA','Calcium Total','الكالسيوم',1,2,1,2.0,240,0,'numeric',null,0,null,null,[['Calcium','mg/dL','numeric',8.6,10.3,8.6,10.3,null,null,null,null]]);
    // Hematology
    const tCBC = T('CBC','Complete Blood Count (CBC)','صورة الدم الكاملة',2,1,2,3.0,120,0,'numeric',null,0,null,null,[
      ['WBC','x10³/µL','numeric',4.0,11.0,4.0,11.0,5.0,15.5,2,30],
      ['RBC','x10⁶/µL','numeric',4.5,5.9,4.1,5.1,3.9,5.3,null,null],
      ['Hemoglobin','g/dL','numeric',13,17,12,15.5,11,15,7,20],
      ['Hematocrit','%','numeric',40,50,36,46,32,42,null,null],
      ['MCV','fL','numeric',80,100,80,100,75,95,null,null],
      ['Platelets','x10³/µL','numeric',150,410,150,410,150,450,50,1000]
    ]);
    const tESR = T('ESR','ESR (Sedimentation Rate)','سرعة الترسيب',2,1,5,1.5,60,0,'numeric',null,0,null,null,[['ESR','mm/hr','numeric',0,15,0,20,0,10,null,null]]);
    const tBG = T('BG','Blood Group & Rh','فصيلة الدم',2,1,2,2.0,60,0,'text',null,0,null,null,[['Blood Group','','text',null,null,null,null,null,null,null,null,'A+, A-, B+, B-, O+, O-, AB+, AB-']]);
    // Coagulation
    const tPT = T('PT','Prothrombin Time (PT)','زمن البروثرومبين',3,3,3,3.0,120,0,'numeric',null,0,null,null,[['PT','seconds','numeric',9.4,12.5,9.4,12.5,null,null,null,null]]);
    const tPTT = T('PTT','aPTT','زمن الثرومبوبلاستين الجزئي',3,3,3,3.0,120,0,'numeric',null,0,null,null,[['aPTT','seconds','numeric',25,35,25,35,null,null,null,null]]);
    T('INR','INR','INR',3,3,3,3.0,120,0,'numeric',null,0,null,null,[['INR','','numeric',0.8,1.1,0.8,1.1,null,null,null,5]]);
    // Hormones
    const tTSH = T('TSH','TSH (Thyroid Stimulating Hormone)','هرمون الغدة الدرقية',4,2,1,4.0,360,0,'numeric',null,0,null,null,[['TSH','µIU/mL','numeric',0.27,4.2,0.27,4.2,null,null,null,null]]);
    const tFT3 = T('FT3','Free T3','T3 الحر',4,2,1,4.0,360,0,'numeric',null,0,null,null,[['Free T3','pg/mL','numeric',2.0,4.4,2.0,4.4,null,null,null,null]]);
    const tFT4 = T('FT4','Free T4','T4 الحر',4,2,1,4.0,360,0,'numeric',null,0,null,null,[['Free T4','ng/dL','numeric',0.93,1.7,0.93,1.7,null,null,null,null]]);
    const tVITD = T('VITD','Vitamin D (25-OH)','فيتامين د',4,2,1,8.0,480,0,'numeric',null,0,null,null,[['Vitamin D','ng/mL','numeric',30,100,30,100,null,null,null,null]]);
    const tB12 = T('B12','Vitamin B12','فيتامين ب12',4,2,1,6.0,480,0,'numeric',null,0,null,null,[['Vitamin B12','pg/mL','numeric',200,900,200,900,null,null,null,null]]);
    const tFER = T('FER','Ferritin','الفيريتين (مخزون الحديد)',4,2,1,5.0,480,0,'numeric',null,0,null,null,[['Ferritin','ng/mL','numeric',30,400,13,150,7,140,null,null]]);
    // Immunology & Serology
    const tCRP = T('CRP','CRP (C-Reactive Protein)','بروتين سي التفاعلي',5,2,1,3.0,240,0,'numeric',null,0,null,null,[['CRP','mg/L','numeric',0,5,0,5,null,null,null,null]]);
    const tHBS = T('HBSAG','HBsAg (Hepatitis B Surface Antigen)','مستضد التهاب الكبد ب',5,2,1,4.0,360,0,'text',null,0,null,null,[['HBsAg','','text',null,null,null,null,null,null,null,null,'Negative, Positive']]);
    // Clinical Pathology
    const tUR = T('URINE','Urine Analysis','تحليل بول كامل',7,4,7,2.0,120,0,'text',null,0,null,null,[
      ['Color','','text',null,null,null,null,null,null,null,null,'Yellow'],
      ['pH','','numeric',4.6,8.0,4.6,8.0,null,null,null,null],
      ['Glucose','','text',null,null,null,null,null,null,null,null,'Negative'],
      ['Protein','','text',null,null,null,null,null,null,null,null,'Negative'],
      ['RBCs','/HPF','numeric',0,2,0,2,null,null,null,null],
      ['Pus Cells','/HPF','numeric',0,5,0,5,null,null,null,null]
    ]);
    const tST = T('STOOL','Stool Analysis','تحليل براز',7,5,7,2.0,120,0,'text',null,0,null,null,[
      ['Consistency','','text',null,null,null,null,null,null,null,null,'Formed'],
      ['Ova & Parasites','','text',null,null,null,null,null,null,null,null,'None seen'],
      ['Occult Blood','','text',null,null,null,null,null,null,null,null,'Negative']
    ]);
    // Microbiology
    const tUC = T('UCX','Urine Culture & Sensitivity','مزرعة بول',6,4,7,8.0,2880,0,'text',null,0,'First-morning midstream sample','عينة بول وسطى صباحية',[['Culture Result','','text',null,null,null,null,null,null,null,null,'No growth after 48h']]);
    // Molecular
    const tPCR = T('COVPC','COVID-19 PCR','مسحة كورونا PCR',8,6,7,10.0,1440,0,'text',null,0,null,null,[['SARS-CoV-2 RNA','','text',null,null,null,null,null,null,null,null,'Not Detected, Detected']]);
    // Outsourced
    T('AMH','AMH (Anti-Mullerian Hormone)','هرمون AMH',9,2,1,12.0,4320,0,'numeric',null,1,null,null,[['AMH','ng/mL','numeric',1.0,6.8,1.0,6.8,null,null,null,null]]);

    // ---- Packages ----
    const insP = db.prepare('INSERT INTO packages(code,name_en,name_ar,price) VALUES (?,?,?,?)');
    const insPT = db.prepare('INSERT INTO package_tests(package_id,test_id) VALUES (?,?)');
    const pkg = (code,en,ar,price,ids) => { const r=insP.run(code,en,ar,price); ids.forEach(t=>insPT.run(r.lastInsertRowid,t)); };
    pkg('PKG1','General Health Checkup','باقة الفحص العام',19.900,[tCBC,tGLUF,tCHOL,tTG,tHDL,tCREA,tALT,tAST,tTSH,tUR]);
    pkg('PKG2','Diabetes Follow-up','باقة متابعة السكري',12.500,[tGLUF,tHBA1C,tUR,tCREA]);
    pkg('PKG3','Thyroid Package','باقة الغدة الدرقية',9.900,[tTSH,tFT3,tFT4]);
    pkg('PKG4','Anemia Package','باقة فقر الدم',10.500,[tCBC,tFER,tB12]);

    // ---- Inventory ----
    const insI = db.prepare('INSERT INTO inventory_items(name,name_ar,category,unit,quantity,min_quantity,expiry_date,cost) VALUES (?,?,?,?,?,?,?,?)');
    const items = [
      ['Gel Serum Tubes (Yellow/Red)','أنابيب جل صفراء/حمراء','Tubes','pcs',400,100,'2027-06-30',0.040],
      ['EDTA Tubes (Lavender)','أنابيب إيديتا بنفسجية','Tubes','pcs',350,100,'2027-08-31',0.040],
      ['Citrate Tubes (Blue)','أنابيب سيترات زرقاء','Tubes','pcs',150,40,'2027-05-31',0.045],
      ['Fluoride Tubes (Grey)','أنابيب فلورايد رمادية','Tubes','pcs',120,40,'2027-04-30',0.045],
      ['ESR Tubes (Black)','أنابيب ترسيب سوداء','Tubes','pcs',90,30,'2027-03-31',0.050],
      ['Sterile Containers','عبوات معقمة','Consumables','pcs',200,60,null,0.060],
      ['Needles 21G','إبر سحب 21G','Consumables','pcs',500,150,'2028-01-31',0.030],
      ['Alcohol Swabs','محاليل كحولية','Consumables','pcs',1000,200,null,0.005],
      ['Gloves (Box of 100)','قفازات (علبة ١٠٠)','Consumables','box',45,10,null,1.200],
      ['Chemistry Reagent Kit (LFT/KFT)','كواشف كيمياء (كبد/كلى)','Reagents','kit',20,5,'2027-01-10',18.000],
      ['CBC Diluent & Lyse','محاليل جهاز CBC','Reagents','kit',15,4,'2027-02-15',25.000],
      ['Glucose Reagent','كاشف السكر','Reagents','kit',8,5,'2026-12-20',9.500],
      ['Coagulation Reagent (PT/aPTT)','كواشف السيولة','Reagents','kit',10,3,'2027-03-01',22.000]
    ];
    const itemIds = items.map(i => insI.run(...i).lastInsertRowid);
    const insTM = db.prepare('INSERT INTO test_materials(test_id,item_id,qty) VALUES (?,?,?)');
    // tubes per test by tube_id: GEL->item1, EDTA->2, CIT->3, FLU->4, ESR->5, CUP->6 ; gloves item 9 (0.02 box), needle item7 1, swab item8 2
    const tubeItem = {1:1,2:2,3:3,4:4,5:5,6:6,7:6};
    const allTests = db.prepare('SELECT id,tube_id,dept_id FROM tests').all();
    for (const t of allTests) {
      insTM.run(t.id, tubeItem[t.tube_id]||6, 1);
      insTM.run(t.id, 7, 1); // needle
      insTM.run(t.id, 8, 2); // swabs
      if (t.dept_id===1) insTM.run(t.id, 10, 0.05); // chemistry reagent share
      if (t.dept_id===2 && t.id!==tESR) insTM.run(t.id, 11, 0.05);
      if (t.dept_id===3) insTM.run(t.id, 13, 0.05);
    }
    insTM.run(tGLUF,12,0.05); insTM.run(tHBA1C,11,0.05);

    // ---- Insurance & doctors ----
    const insIns = db.prepare('INSERT INTO insurance_contracts(company,coverage_percent) VALUES (?,?)');
    insIns.run('Gulf Insurance Group', 20);
    insIns.run('Warba Medical Network', 15);
    insIns.run('No Insurance / Cash', 0);
    const insDoc = db.prepare('INSERT INTO doctors(name,phone,specialty,discount_percent) VALUES (?,?,?,?)');
    insDoc.run('Dr. Ahmed Al-Mutairi','+965 9900 1111','Internal Medicine',10);
    insDoc.run('Dr. Sara Nasser','+965 9900 2222','Family Medicine',5);

    // ---- Seed audit entry ----
    db.prepare(`INSERT INTO audit_log(user_id,username,action,entity,entity_id,new_value) VALUES (NULL,'system','seed','database','init','{"note":"Master data seeded"}')`).run();
  });
  tx();
  return true;
}

module.exports = { seed, hashPassword };
if (require.main === module) {
  const { db } = require('./db');
  const done = seed(db);
  console.log(done ? 'Seeded master data.' : 'Already seeded, skipped.');
}
