// VentasSimple — CRM ligero para pequeños negocios. Sin dependencias (Node.js >= 18)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });

const STAGES = ['nuevo', 'contactado', 'propuesta', 'negociacion', 'ganado', 'perdido'];
const OPEN = ['nuevo', 'contactado', 'propuesta', 'negociacion'];
const ACT_TYPES = ['nota', 'llamada', 'whatsapp', 'email', 'reunion', 'sistema'];

// ---------- Base de datos en archivo JSON ----------
const EMPTY_DB = {
  settings: {
    businessName: 'Mi Negocio',
    currency: 'COP',
    locale: 'es-CO',
    timezone: 'America/Bogota',
    formEnabled: true,
    formTitle: 'Cuéntanos qué necesitas',
    formIntro: 'Déjanos tus datos y te contactamos pronto.',
    formThanks: '¡Gracias! Te escribiremos muy pronto.',
    sources: ['WhatsApp', 'Instagram', 'Facebook', 'Referido', 'Sitio web', 'Formulario', 'Llamada', 'Otro']
  },
  auth: null,
  contacts: [],
  deals: [],
  activities: []
};
let db;
function id() { return crypto.randomBytes(8).toString('hex'); }
function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.settings = { ...EMPTY_DB.settings, ...db.settings };
    db.contacts ||= []; db.deals ||= []; db.activities ||= [];
  } catch { db = structuredClone(EMPTY_DB); saveDb(); }
}
function saveDb() { const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2)); fs.renameSync(tmp, DB_FILE); }
loadDb();

// ---------- Autenticación ----------
function hashPassword(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }
function setPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.auth = { salt, hash: hashPassword(pw, salt), secret: crypto.randomBytes(32).toString('hex') };
  saveDb();
}
if (!db.auth && process.env.ADMIN_PASSWORD) {
  if (process.env.ADMIN_PASSWORD.length < 8) console.warn('ADMIN_PASSWORD debe tener al menos 8 caracteres; se ignora.');
  else setPassword(process.env.ADMIN_PASSWORD);
}
const SETUP_CODE = db.auth ? null : (process.env.SETUP_CODE || crypto.randomBytes(4).toString('hex'));
if (SETUP_CODE) {
  console.log('==============================================');
  console.log(' Código de configuración inicial: ' + SETUP_CODE);
  console.log(' (o define la variable ADMIN_PASSWORD)');
  console.log('==============================================');
}
const sign = v => crypto.createHmac('sha256', db.auth.secret).update(v).digest('hex');
function makeSession() { const p = String(Date.now() + 30 * 864e5); return p + '.' + sign(p); }
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function isAuthed(req) {
  if (!db.auth) return false;
  const [payload, sig] = String(parseCookies(req).vs_session || '').split('.');
  if (!payload || !sig) return false;
  const exp = sign(payload);
  return sig.length === exp.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp)) && Number(payload) > Date.now();
}
function cookieHeader(req, value, maxAge = 30 * 86400) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `vs_session=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}
const safeEqual = (a, b) => { a = String(a); b = String(b); return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); };
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : req.socket.remoteAddress;
}
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter(t => now - t < windowMs);
  buckets.set(key, list);
  return list.length >= max;
}
const hit = key => buckets.get(key)?.push(Date.now());

// ---------- Utilidades ----------
function send(res, status, data, headers = {}) {
  const isText = typeof data === 'string';
  res.writeHead(status, { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(isText ? data : JSON.stringify(data));
}
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('JSON inválido')); } });
  });
}
const str = (v, max = 500) => String(v ?? '').slice(0, max).trim();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v, fallback = '') => DATE_RE.test(String(v ?? '')) ? String(v) : fallback;
const cleanPhone = p => str(p, 30).replace(/[^\d+]/g, '');
function today() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: db.settings.timezone || 'America/Bogota' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
// Fecha local (zona del negocio) de una marca de tiempo ISO
function localDate(iso) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: db.settings.timezone || 'America/Bogota' }).format(new Date(iso)); }
  catch { return String(iso).slice(0, 10); }
}
function addActivity(fields) {
  const a = { id: id(), type: ACT_TYPES.includes(fields.type) ? fields.type : 'nota', text: str(fields.text, 3000), contactId: fields.contactId || '', dealId: fields.dealId || '', date: date(fields.date, today()), createdAt: new Date().toISOString() };
  db.activities.push(a);
  if (a.contactId) { const c = db.contacts.find(x => x.id === a.contactId); if (c && a.type !== 'sistema' && a.date > (c.lastContact || '')) c.lastContact = a.date; }
  return a;
}
function contactFields(b, existing = {}) {
  const tags = Array.isArray(b.tags) ? b.tags : typeof b.tags === 'string' ? b.tags.split(',') : (existing.tags || []);
  return {
    name: 'name' in b ? str(b.name, 150) : existing.name,
    company: 'company' in b ? str(b.company, 150) : (existing.company || ''),
    phone: 'phone' in b ? cleanPhone(b.phone) : (existing.phone || ''),
    email: 'email' in b ? str(b.email, 200) : (existing.email || ''),
    source: 'source' in b ? str(b.source, 60) : (existing.source || ''),
    tags: tags.map(t => str(t, 40)).filter(Boolean).slice(0, 20),
    notes: 'notes' in b ? str(b.notes, 3000) : (existing.notes || '')
  };
}
function dealFields(b, existing = {}) {
  return {
    title: 'title' in b ? str(b.title, 200) : existing.title,
    contactId: 'contactId' in b ? str(b.contactId, 40) : existing.contactId,
    value: 'value' in b ? Math.max(0, num(b.value)) : (existing.value || 0),
    expectedClose: 'expectedClose' in b ? date(b.expectedClose) : (existing.expectedClose || ''),
    nextAction: 'nextAction' in b ? str(b.nextAction, 300) : (existing.nextAction || ''),
    nextDate: 'nextDate' in b ? date(b.nextDate) : (existing.nextDate || ''),
    lostReason: 'lostReason' in b ? str(b.lostReason, 300) : (existing.lostReason || '')
  };
}
const withContact = d => ({ ...d, contact: db.contacts.find(c => c.id === d.contactId) || null });
// Celdas CSV seguras: neutraliza fórmulas (=, +, -, @) excepto teléfonos como +573001234567
const csvCell = v => {
  const s = String(v ?? '');
  const formula = /^[=+\-@\t\r]/.test(s) && !/^\+\d{6,15}$/.test(s);
  const out = formula ? "'" + s : s;
  return formula || /[",\n;]/.test(out) ? '"' + out.replace(/"/g, '""') + '"' : out;
};

// ---------- API pública: formulario de contacto ----------
async function publicApi(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/public/form' && m === 'GET') {
    const s = db.settings;
    if (!s.formEnabled) return send(res, 404, { error: 'Formulario desactivado' });
    return send(res, 200, { businessName: s.businessName, formTitle: s.formTitle, formIntro: s.formIntro, formThanks: s.formThanks });
  }
  if (p === '/api/public/lead' && m === 'POST') {
    if (!db.settings.formEnabled) return send(res, 404, { error: 'Formulario desactivado' });
    const ip = clientIp(req);
    if (limited('lead:' + ip, 10, 60 * 60 * 1000)) return send(res, 429, { error: 'Demasiados envíos desde esta conexión. Intenta más tarde.' });
    const b = await readBody(req, 20000);
    if (b.website) return send(res, 201, { ok: true }); // campo trampa para bots
    const name = str(b.name, 150), phone = cleanPhone(b.phone), email = str(b.email, 200);
    if (!name) return send(res, 400, { error: 'Escribe tu nombre' });
    if (phone.replace(/\D/g, '').length < 7 && !/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Escribe un teléfono o un email para poder contactarte' });
    hit('lead:' + ip);
    // Si el contacto ya existe (mismo teléfono o email), se reutiliza
    const digits = phone.replace(/\D/g, '').slice(-10);
    let c = db.contacts.find(x => (digits && x.phone.replace(/\D/g, '').slice(-10) === digits) || (email && x.email.toLowerCase() === email.toLowerCase()));
    if (!c) {
      c = { id: id(), ...contactFields({ name, phone, email, company: b.company, source: 'Formulario' }), createdAt: new Date().toISOString(), lastContact: '' };
      db.contacts.push(c);
    }
    const message = str(b.message, 2000);
    const deal = { id: id(), ...dealFields({ title: str(b.interest, 120) || 'Solicitud desde el formulario', contactId: c.id, nextAction: 'Responder solicitud del formulario', nextDate: today() }), stage: 'nuevo', createdAt: new Date().toISOString(), stageChangedAt: new Date().toISOString() };
    db.deals.push(deal);
    addActivity({ type: 'sistema', text: 'Llegó por el formulario web.' + (message ? '\nMensaje: ' + message : ''), contactId: c.id, dealId: deal.id });
    saveDb();
    return send(res, 201, { ok: true });
  }
  return send(res, 404, { error: 'Ruta no encontrada' });
}

// ---------- API de administración ----------
async function adminApi(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/status' && m === 'GET') return send(res, 200, { setup: !db.auth, authed: isAuthed(req) });
  if (p === '/api/setup' && m === 'POST') {
    if (db.auth) return send(res, 400, { error: 'Ya está configurado' });
    const ip = clientIp(req);
    if (limited('login:' + ip, 10, 15 * 60 * 1000)) return send(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
    const b = await readBody(req);
    if (!safeEqual(String(b.setupCode || '').trim(), SETUP_CODE)) { hit('login:' + ip); return send(res, 401, { error: 'Código de configuración incorrecto. Búscalo en los registros (logs) del servidor.' }); }
    if (!b.password || String(b.password).length < 8) return send(res, 400, { error: 'La contraseña debe tener al menos 8 caracteres' });
    setPassword(String(b.password));
    if (b.businessName) { db.settings.businessName = str(b.businessName, 200); saveDb(); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, makeSession()) });
  }
  if (p === '/api/login' && m === 'POST') {
    const ip = clientIp(req);
    if (limited('login:' + ip, 10, 15 * 60 * 1000)) return send(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
    const b = await readBody(req);
    if (!db.auth) return send(res, 400, { error: 'Primero configura la app' });
    if (!safeEqual(hashPassword(String(b.password || ''), db.auth.salt), db.auth.hash)) { hit('login:' + ip); return send(res, 401, { error: 'Contraseña incorrecta' }); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, makeSession()) });
  }
  if (p === '/api/logout' && m === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });

  if (!isAuthed(req)) return send(res, 401, { error: 'No autorizado' });

  // Ajustes
  if (p === '/api/settings' && m === 'GET') return send(res, 200, db.settings);
  if (p === '/api/settings' && m === 'PUT') {
    const b = await readBody(req), s = db.settings;
    for (const k of ['businessName', 'currency', 'locale', 'formTitle', 'formIntro', 'formThanks']) if (k in b) s[k] = str(b[k], 1000);
    if ('formEnabled' in b) s.formEnabled = !!b.formEnabled;
    if ('timezone' in b) { try { new Intl.DateTimeFormat('en', { timeZone: String(b.timezone) }); s.timezone = String(b.timezone); } catch { return send(res, 400, { error: 'Zona horaria no válida' }); } }
    if ('sources' in b) s.sources = String(b.sources).split(',').map(x => str(x, 40)).filter(Boolean).slice(0, 30);
    saveDb(); return send(res, 200, s);
  }
  if (p === '/api/password' && m === 'PUT') {
    const b = await readBody(req);
    if (!safeEqual(hashPassword(String(b.current || ''), db.auth.salt), db.auth.hash)) return send(res, 400, { error: 'La contraseña actual no es correcta' });
    if (!b.password || String(b.password).length < 8) return send(res, 400, { error: 'Mínimo 8 caracteres' });
    setPassword(String(b.password));
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, makeSession()) });
  }

  // Contactos
  if (p === '/api/contacts' && m === 'GET') {
    const list = db.contacts.map(c => {
      const deals = db.deals.filter(d => d.contactId === c.id);
      return { ...c, openDeals: deals.filter(d => OPEN.includes(d.stage)).length, wonValue: deals.filter(d => d.stage === 'ganado').reduce((s, d) => s + d.value, 0) };
    }).sort((a, b) => (b.lastContact || b.createdAt).localeCompare(a.lastContact || a.createdAt));
    return send(res, 200, list);
  }
  if (p === '/api/contacts' && m === 'POST') {
    const b = await readBody(req);
    const f = contactFields(b);
    if (!f.name) return send(res, 400, { error: 'El nombre es obligatorio' });
    const c = { id: id(), ...f, createdAt: new Date().toISOString(), lastContact: '' };
    db.contacts.push(c); saveDb(); return send(res, 201, c);
  }
  if (p === '/api/contacts.csv' && m === 'GET') {
    const rows = [['Nombre', 'Empresa', 'Teléfono', 'Email', 'Origen', 'Etiquetas', 'Último contacto', 'Creado'], ...db.contacts.map(c => [c.name, c.company, c.phone, c.email, c.source, c.tags.join(', '), c.lastContact, localDate(c.createdAt)])];
    return send(res, 200, '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="contactos-${today()}.csv"` });
  }
  let mt = p.match(/^\/api\/contacts\/([a-f0-9]+)$/);
  if (mt) {
    const c = db.contacts.find(x => x.id === mt[1]);
    if (!c) return send(res, 404, { error: 'Contacto no encontrado' });
    if (m === 'GET') {
      return send(res, 200, { ...c, deals: db.deals.filter(d => d.contactId === c.id), activities: db.activities.filter(a => a.contactId === c.id).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)) });
    }
    if (m === 'PUT') {
      const f = contactFields(await readBody(req), c);
      if (!f.name) return send(res, 400, { error: 'El nombre es obligatorio' });
      Object.assign(c, f); saveDb(); return send(res, 200, c);
    }
    if (m === 'DELETE') {
      const dealIds = new Set(db.deals.filter(d => d.contactId === c.id).map(d => d.id));
      db.contacts = db.contacts.filter(x => x.id !== c.id);
      db.deals = db.deals.filter(d => !dealIds.has(d.id));
      db.activities = db.activities.filter(a => a.contactId !== c.id && !dealIds.has(a.dealId));
      saveDb(); return send(res, 200, { ok: true });
    }
  }

  // Oportunidades (negocios)
  if (p === '/api/deals' && m === 'GET') return send(res, 200, db.deals.map(withContact));
  if (p === '/api/deals' && m === 'POST') {
    const b = await readBody(req);
    const f = dealFields(b);
    if (!f.title) return send(res, 400, { error: 'Escribe un nombre para la oportunidad' });
    if (!db.contacts.some(c => c.id === f.contactId)) return send(res, 400, { error: 'Elige un contacto' });
    const stage = STAGES.includes(b.stage) ? b.stage : 'nuevo';
    const d = { id: id(), ...f, stage, createdAt: new Date().toISOString(), stageChangedAt: new Date().toISOString() };
    db.deals.push(d);
    addActivity({ type: 'sistema', text: `Oportunidad creada: ${d.title}`, contactId: d.contactId, dealId: d.id });
    saveDb(); return send(res, 201, withContact(d));
  }
  mt = p.match(/^\/api\/deals\/([a-f0-9]+)$/);
  if (mt) {
    const d = db.deals.find(x => x.id === mt[1]);
    if (!d) return send(res, 404, { error: 'Oportunidad no encontrada' });
    if (m === 'PUT') {
      const b = await readBody(req);
      const f = dealFields(b, d);
      if (!f.title) return send(res, 400, { error: 'Escribe un nombre para la oportunidad' });
      if (!db.contacts.some(c => c.id === f.contactId)) return send(res, 400, { error: 'Elige un contacto' });
      if ('stage' in b && b.stage !== d.stage) {
        if (!STAGES.includes(b.stage)) return send(res, 400, { error: 'Etapa inválida' });
        addActivity({ type: 'sistema', text: `Etapa: ${STAGE_LABEL[d.stage]} → ${STAGE_LABEL[b.stage]}`, contactId: d.contactId, dealId: d.id });
        d.stage = b.stage; d.stageChangedAt = new Date().toISOString();
        if (b.stage === 'ganado' || b.stage === 'perdido') { d.closedAt = today(); f.nextDate = ''; f.nextAction = ''; }
        else delete d.closedAt;
      }
      Object.assign(d, f); saveDb(); return send(res, 200, withContact(d));
    }
    if (m === 'DELETE') {
      db.deals = db.deals.filter(x => x.id !== d.id);
      db.activities = db.activities.filter(a => a.dealId !== d.id || a.type !== 'sistema');
      saveDb(); return send(res, 200, { ok: true });
    }
  }

  // Actividades (historial)
  if (p === '/api/activities' && m === 'POST') {
    const b = await readBody(req);
    if (!str(b.text)) return send(res, 400, { error: 'Escribe qué pasó' });
    if (!db.contacts.some(c => c.id === b.contactId)) return send(res, 400, { error: 'Contacto no encontrado' });
    if (b.dealId && !db.deals.some(d => d.id === b.dealId && d.contactId === b.contactId)) return send(res, 400, { error: 'Oportunidad no encontrada' });
    const a = addActivity({ ...b, type: b.type === 'sistema' ? 'nota' : b.type });
    saveDb(); return send(res, 201, a);
  }
  mt = p.match(/^\/api\/activities\/([a-f0-9]+)$/);
  if (mt && m === 'DELETE') { db.activities = db.activities.filter(a => a.id !== mt[1]); saveDb(); return send(res, 200, { ok: true }); }

  // Hoy: seguimientos pendientes
  if (p === '/api/today' && m === 'GET') {
    const t = today();
    const open = db.deals.filter(d => OPEN.includes(d.stage)).map(withContact);
    return send(res, 200, {
      today: t,
      overdue: open.filter(d => d.nextDate && d.nextDate < t).sort((a, b) => a.nextDate.localeCompare(b.nextDate)),
      dueToday: open.filter(d => d.nextDate === t),
      noNext: open.filter(d => !d.nextDate).sort((a, b) => a.stageChangedAt.localeCompare(b.stageChangedAt)).slice(0, 10)
    });
  }
  if (p === '/api/dashboard' && m === 'GET') {
    const t = today(), month = t.slice(0, 7);
    const byStage = Object.fromEntries(STAGES.map(s => [s, { count: 0, value: 0 }]));
    db.deals.forEach(d => { byStage[d.stage].count++; byStage[d.stage].value += d.value; });
    const closedMonth = db.deals.filter(d => d.closedAt?.startsWith(month));
    const wonMonth = closedMonth.filter(d => d.stage === 'ganado');
    const closedAll = db.deals.filter(d => d.stage === 'ganado' || d.stage === 'perdido');
    const sources = {};
    db.contacts.forEach(c => { const k = c.source || 'Sin origen'; sources[k] = (sources[k] || 0) + 1; });
    return send(res, 200, {
      byStage,
      openValue: OPEN.reduce((s, k) => s + byStage[k].value, 0),
      wonMonthValue: wonMonth.reduce((s, d) => s + d.value, 0),
      wonMonthCount: wonMonth.length,
      winRate: closedAll.length ? Math.round(100 * closedAll.filter(d => d.stage === 'ganado').length / closedAll.length) : null,
      newContactsMonth: db.contacts.filter(c => localDate(c.createdAt).slice(0, 7) === month).length,
      sources
    });
  }

  if (p === '/api/backup' && m === 'GET') {
    const { auth, ...data } = db;
    return send(res, 200, data, { 'Content-Disposition': `attachment; filename="ventassimple-${today()}.json"` });
  }
  if (p === '/api/restore' && m === 'POST') {
    const b = await readBody(req, 30e6);
    if (!b || typeof b.settings !== 'object' || !Array.isArray(b.contacts) || !Array.isArray(b.deals)) return send(res, 400, { error: 'El archivo no es una copia de seguridad válida' });
    fs.writeFileSync(path.join(DATA_DIR, `antes-de-restaurar-${Date.now()}.json`), JSON.stringify(db));
    db.settings = { ...EMPTY_DB.settings, ...b.settings };
    db.contacts = b.contacts; db.deals = b.deals; db.activities = Array.isArray(b.activities) ? b.activities : [];
    saveDb();
    return send(res, 200, { ok: true, contacts: db.contacts.length, deals: db.deals.length });
  }
  return send(res, 404, { error: 'Ruta no encontrada' });
}
const STAGE_LABEL = { nuevo: 'Nuevo', contactado: 'Contactado', propuesta: 'Propuesta', negociacion: 'Negociación', ganado: 'Ganado', perdido: 'Perdido' };

// ---------- Archivos estáticos ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/formulario' || rel === '/formulario/') rel = '/form.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Prohibido'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    // El panel no se puede incrustar en otros sitios; el formulario sí (para pegarlo en tu web)
    if (rel !== '/form.html') headers['X-Frame-Options'] = 'DENY';
    res.writeHead(200, headers); res.end(buf);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Se esperaba JSON' });
      if (url.pathname.startsWith('/api/public/')) return await publicApi(req, res, url);
      return await adminApi(req, res, url);
    }
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 400, { error: e.message || 'Error' });
  }
}).listen(PORT, () => console.log(`VentasSimple escuchando en http://localhost:${PORT}  (formulario público: /formulario)`));
