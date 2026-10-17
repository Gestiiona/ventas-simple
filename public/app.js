// VentasSimple — panel
'use strict';
const $app = document.getElementById('app');
let settings = null;
const formData = f => Object.fromEntries(new FormData(f).entries());
const m0 = n => { const c = settings?.currency || 'COP'; try { return new Intl.NumberFormat(settings?.locale || 'es-CO', { style: 'currency', currency: c, maximumFractionDigits: c === 'COP' ? 0 : 2 }).format(n || 0); } catch { return String(n || 0); } };
const ICON = { nota: '📝', llamada: '📞', whatsapp: '💬', email: '✉️', reunion: '🤝', sistema: '⚙️' };
const TYPE = { nota: 'Nota', llamada: 'Llamada', whatsapp: 'WhatsApp', email: 'Email', reunion: 'Reunión' };
let todayStr = '';
async function call(path, opts) {
  try { return await api(path, opts); }
  catch (e) { if (e.status === 401) { location.hash = '#/login'; route(); } throw e; }
}

function shell(active, content) {
  const link = (h, label, key) => `<a href="${h}" class="${active === key ? 'active' : ''}">${label}</a>`;
  $app.innerHTML = `<div class="layout"><nav class="side">
    <div class="brand"><img src="/icon.svg" alt="">VentasSimple</div>
    ${link('#/', 'Hoy', 'home')}${link('#/embudo', 'Embudo', 'embudo')}${link('#/contactos', 'Contactos', 'contactos')}${link('#/resumen', 'Resumen', 'resumen')}${link('#/ajustes', 'Ajustes', 'ajustes')}
    <div class="spacer"></div><a href="#" id="logout">Cerrar sesión</a></nav><main>${content}</main></div>`;
  document.getElementById('logout').onclick = async e => { e.preventDefault(); await api('/api/logout', { method: 'POST', body: {} }); location.hash = '#/login'; route(); };
}

// ---------- Acceso ----------
function viewSetup() {
  $app.innerHTML = `<div class="auth card"><h1>Bienvenido a VentasSimple</h1><p class="muted">Configura tu negocio y crea la contraseña del panel.</p>
    <form id="f"><div class="field"><label>Código de configuración</label><input name="setupCode" required autocomplete="off" placeholder="Aparece en los registros (logs) del servidor"></div>
    <div class="field"><label>Nombre del negocio</label><input name="businessName" required></div>
    <div class="field"><label>Contraseña (mínimo 8 caracteres)</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div>
    <button class="btn primary" style="width:100%">Empezar</button></form></div>`;
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/setup', { method: 'POST', body: formData(e.target) }); location.hash = '#/contactos'; route(); toast('¡Listo! Agrega tu primer contacto.'); } catch (err) { toast(err.message); }
  };
}
function viewLogin() {
  $app.innerHTML = `<div class="auth card"><div class="row" style="margin-bottom:1rem"><img src="/icon.svg" width="36" alt=""><h1 style="margin:0">VentasSimple</h1></div>
    <form id="f"><div class="field"><label>Contraseña</label><input name="password" type="password" required autofocus autocomplete="current-password"></div>
    <button class="btn primary" style="width:100%">Entrar</button></form></div>`;
  document.getElementById('f').onsubmit = async e => { e.preventDefault(); try { await api('/api/login', { method: 'POST', body: formData(e.target) }); location.hash = '#/'; route(); } catch (err) { toast(err.message); } };
}

// ---------- Formulario de oportunidad (crear / editar) ----------
async function dealForm(container, deal, presetContactId, onDone) {
  const contacts = await call('/api/contacts');
  deal ||= { title: '', contactId: presetContactId || '', value: 0, stage: 'nuevo', expectedClose: '', nextAction: '', nextDate: todayStr, lostReason: '' };
  container.innerHTML = `<form class="card" id="df"><h2>${deal.id ? 'Editar oportunidad' : 'Nueva oportunidad'}</h2>
    ${!contacts.length ? '<p>Primero crea un contacto en <a href="#/contactos">Contactos</a>.</p>' : `<div class="grid cols-2">
      <div class="field"><label>¿Qué le vas a vender? *</label><input name="title" required value="${esc(deal.title)}" placeholder="Ej: Plan anual, remodelación cocina…"></div>
      <div class="field"><label>Contacto *</label><select name="contactId" required><option value="">— Elige —</option>${contacts.map(c => `<option value="${c.id}" ${c.id === deal.contactId ? 'selected' : ''}>${esc(c.name)}${c.company ? ' · ' + esc(c.company) : ''}</option>`).join('')}</select></div>
      <div class="field"><label>Valor estimado</label><input name="value" type="number" min="0" step="any" value="${deal.value}"></div>
      <div class="field"><label>Etapa</label><select name="stage">${STAGES.map(s => `<option value="${s}" ${s === deal.stage ? 'selected' : ''}>${STAGE[s]}</option>`).join('')}</select></div>
      <div class="field"><label>Próximo paso</label><input name="nextAction" value="${esc(deal.nextAction)}" placeholder="Ej: Enviar cotización"></div>
      <div class="field"><label>Fecha del próximo paso</label><input name="nextDate" type="date" value="${esc(deal.nextDate)}"></div>
      <div class="field"><label>Cierre esperado</label><input name="expectedClose" type="date" value="${esc(deal.expectedClose)}"></div>
      <div class="field"><label>Motivo de pérdida (si aplica)</label><input name="lostReason" value="${esc(deal.lostReason)}" placeholder="Precio, eligió a otro, no respondió…"></div></div>
    <div class="row between"><div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" id="dcx">Cancelar</button></div>
      ${deal.id ? '<button type="button" class="btn danger" id="ddel">Eliminar</button>' : ''}</div>`}</form>`;
  const f = container.querySelector('#df');
  const cx = container.querySelector('#dcx'); if (cx) cx.onclick = () => { container.innerHTML = ''; };
  const del = container.querySelector('#ddel');
  if (del) del.onclick = async () => { if (!confirm('¿Eliminar esta oportunidad?')) return; await call('/api/deals/' + deal.id, { method: 'DELETE' }); toast('Oportunidad eliminada'); container.innerHTML = ''; onDone(); };
  f.onsubmit = async e => {
    e.preventDefault();
    try { await call(deal.id ? '/api/deals/' + deal.id : '/api/deals', { method: deal.id ? 'PUT' : 'POST', body: formData(f) }); toast('Oportunidad guardada'); container.innerHTML = ''; onDone(); }
    catch (err) { toast(err.message); }
  };
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Hoy ----------
function taskRow(d, late) {
  const c = d.contact || {};
  const msg = `Hola ${c.name || ''}, te escribo de ${settings.businessName} sobre ${d.title}.`;
  return `<div class="task"><div><a href="#/contacto/${c.id}"><strong>${esc(c.name || '—')}</strong></a> · ${esc(d.title)} ${badge(d.stage)}
      <div class="meta">${esc(d.nextAction || 'Sin próximo paso')}${d.nextDate ? ` · <span style="${late ? 'color:var(--danger);font-weight:600' : ''}">${esc(fmtDay(d.nextDate, { day: 'numeric', month: 'short' }))}</span>` : ''}${d.value ? ' · ' + esc(m0(d.value)) : ''}</div></div>
    <div class="row">${c.phone ? `<a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(c.phone, msg)}">WhatsApp</a>` : ''}<button class="btn sm" data-done="${d.id}">Hecho</button></div></div>`;
}
async function viewHome() {
  const t = await call('/api/today');
  todayStr = t.today;
  const all = [...t.overdue, ...t.dueToday];
  shell('home', `<div class="row between"><h1>Seguimientos de hoy</h1><button class="btn primary" id="nd">+ Oportunidad</button></div>
    <div id="dealBox"></div><div id="doneBox"></div>
    <div class="card"><h2>${t.overdue.length ? `Atrasados (${t.overdue.length})` : 'Sin atrasos 🎉'}</h2>${t.overdue.map(d => taskRow(d, true)).join('')}</div>
    <div class="card"><h2>Para hoy (${t.dueToday.length})</h2>${t.dueToday.length ? t.dueToday.map(d => taskRow(d, false)).join('') : '<p class="muted">Nada programado para hoy.</p>'}</div>
    ${t.noNext.length ? `<div class="card"><h2>Oportunidades sin próximo paso</h2><p class="muted">Un negocio sin próximo paso suele enfriarse. Decide qué sigue.</p>${t.noNext.map(d => taskRow(d, false)).join('')}</div>` : ''}`);
  document.getElementById('nd').onclick = () => dealForm(document.getElementById('dealBox'), null, null, viewHome);
  document.querySelectorAll('[data-done]').forEach(b => b.onclick = () => {
    const d = [...all, ...t.noNext].find(x => x.id === b.dataset.done);
    const box = document.getElementById('doneBox');
    const in3 = new Date(t.today + 'T12:00:00Z'); in3.setUTCDate(in3.getUTCDate() + 3);
    box.innerHTML = `<form class="card" id="dn"><h2>¿Qué pasó con ${esc(d.contact?.name || '')}?</h2>
      <div class="grid cols-2"><div class="field"><label>Tipo</label><select name="type">${Object.entries(TYPE).map(([k, v]) => `<option value="${k}" ${k === 'whatsapp' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Etapa</label><select name="stage">${STAGES.map(s => `<option value="${s}" ${s === d.stage ? 'selected' : ''}>${STAGE[s]}</option>`).join('')}</select></div></div>
      <div class="field"><label>Resumen *</label><textarea name="text" required placeholder="Ej: Le envié la cotización, quedó de responder el viernes."></textarea></div>
      <div class="grid cols-2"><div class="field"><label>Siguiente paso</label><input name="nextAction" value="${esc(d.nextAction)}"></div>
      <div class="field"><label>Fecha</label><input name="nextDate" type="date" value="${in3.toISOString().slice(0, 10)}"></div></div>
      <div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" id="dncx">Cancelar</button></div></form>`;
    document.getElementById('dncx').onclick = () => { box.innerHTML = ''; };
    document.getElementById('dn').onsubmit = async e => {
      e.preventDefault(); const f = formData(e.target);
      try {
        await call('/api/activities', { method: 'POST', body: { type: f.type, text: f.text, contactId: d.contactId, dealId: d.id } });
        await call('/api/deals/' + d.id, { method: 'PUT', body: { stage: f.stage, nextAction: f.nextAction, nextDate: f.nextDate } });
        toast('Seguimiento registrado'); viewHome();
      } catch (err) { toast(err.message); }
    };
    box.scrollIntoView({ behavior: 'smooth' });
  });
}

// ---------- Embudo (tablero) ----------
async function viewBoard() {
  const deals = await call('/api/deals');
  const showClosed = (() => { try { return localStorage.getItem('vs_closed') !== '0'; } catch { return true; } })();
  const stages = showClosed ? STAGES : OPEN;
  shell('embudo', `<div class="row between"><h1>Embudo de ventas</h1><div class="row">
      <label style="display:flex;gap:.4rem;align-items:center;margin:0;color:var(--text)"><input type="checkbox" id="sc" ${showClosed ? 'checked' : ''} style="width:auto"> Ver ganadas y perdidas</label>
      <button class="btn primary" id="nd">+ Oportunidad</button></div></div>
    <p class="muted">Arrastra las tarjetas para cambiarlas de etapa. En el celular, usa el selector de cada tarjeta.</p>
    <div id="dealBox"></div>
    <div class="board" style="grid-template-columns:repeat(${stages.length}, minmax(165px, 1fr))">${stages.map(s => {
      const list = deals.filter(d => d.stage === s).sort((a, b) => (a.nextDate || '9999').localeCompare(b.nextDate || '9999'));
      return `<div class="col" data-stage="${s}"><h3>${STAGE[s]} <span class="muted">${list.length}</span></h3><div class="sum">${esc(m0(list.reduce((t, d) => t + d.value, 0)))}</div>
        ${list.map(d => `<div class="deal" draggable="true" data-id="${d.id}"><div class="t">${esc(d.title)}</div><div class="c">${esc(d.contact?.name || '—')}</div>
          ${d.value ? `<div class="v">${esc(m0(d.value))}</div>` : ''}
          ${OPEN.includes(d.stage) && d.nextDate ? `<div class="n ${d.nextDate < todayStr ? 'late' : ''}">→ ${esc(d.nextAction || 'Seguimiento')} · ${esc(fmtDay(d.nextDate, { day: 'numeric', month: 'short' }))}</div>` : ''}
          <select aria-label="Mover a etapa" data-move="${d.id}">${STAGES.map(x => `<option value="${x}" ${x === d.stage ? 'selected' : ''}>${STAGE[x]}</option>`).join('')}</select></div>`).join('')}</div>`;
    }).join('')}</div>`);
  document.getElementById('sc').onchange = e => { try { localStorage.setItem('vs_closed', e.target.checked ? '1' : '0'); } catch {} viewBoard(); };
  document.getElementById('nd').onclick = () => dealForm(document.getElementById('dealBox'), null, null, viewBoard);
  const move = async (id, stage) => { try { await call('/api/deals/' + id, { method: 'PUT', body: { stage } }); toast('Movida a ' + STAGE[stage]); viewBoard(); } catch (err) { toast(err.message); } };
  document.querySelectorAll('.deal').forEach(el => {
    el.ondragstart = e => { e.dataTransfer.setData('text/plain', el.dataset.id); };
    el.onclick = e => { if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return; dealForm(document.getElementById('dealBox'), deals.find(d => d.id === el.dataset.id), null, viewBoard); };
  });
  document.querySelectorAll('[data-move]').forEach(s => s.onchange = () => move(s.dataset.move, s.value));
  document.querySelectorAll('.col').forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = e => {
      e.preventDefault(); col.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain'); const d = deals.find(x => x.id === id);
      if (d && d.stage !== col.dataset.stage) move(id, col.dataset.stage);
    };
  });
}

// ---------- Contactos ----------
function contactFormHtml(c) {
  c ||= {};
  return `<form class="card" id="cf"><h2>${c.id ? 'Editar contacto' : 'Nuevo contacto'}</h2><div class="grid cols-2">
    <div class="field"><label>Nombre *</label><input name="name" required value="${esc(c.name)}"></div>
    <div class="field"><label>Empresa</label><input name="company" value="${esc(c.company)}"></div>
    <div class="field"><label>WhatsApp / teléfono</label><input name="phone" value="${esc(c.phone)}" inputmode="tel" placeholder="+57 300 000 0000"></div>
    <div class="field"><label>Email</label><input name="email" type="email" value="${esc(c.email)}"></div>
    <div class="field"><label>¿Cómo llegó?</label><select name="source"><option value="">—</option>${settings.sources.map(s => `<option ${s === c.source ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
    <div class="field"><label>Etiquetas (separadas por coma)</label><input name="tags" value="${esc((c.tags || []).join(', '))}" placeholder="vip, mayorista"></div></div>
    <div class="field"><label>Notas</label><textarea name="notes">${esc(c.notes)}</textarea></div>
    <div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" id="ccx">Cancelar</button></div></form>`;
}
async function viewContacts() {
  const list = await call('/api/contacts');
  shell('contactos', `<div class="row between"><h1>Contactos</h1><div class="row"><a class="btn" href="/api/contacts.csv">Exportar CSV</a><button class="btn primary" id="add">+ Nuevo contacto</button></div></div>
    <div id="formBox"></div>
    <div class="card"><div class="row" style="margin-bottom:.75rem"><input id="q" placeholder="Buscar por nombre, empresa, teléfono o etiqueta…" style="flex:1;min-width:200px">
      <select id="src" style="width:auto"><option value="">Todos los orígenes</option>${settings.sources.map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
      <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Teléfono</th><th>Origen</th><th>Abiertas</th><th>Último contacto</th></tr></thead><tbody id="rows"></tbody></table></div></div>`);
  const render = () => {
    const q = document.getElementById('q').value.toLowerCase(), src = document.getElementById('src').value;
    const f = list.filter(c => (!src || c.source === src) && (!q || [c.name, c.company, c.phone, c.email, ...c.tags].join(' ').toLowerCase().includes(q)));
    document.getElementById('rows').innerHTML = f.length ? f.map(c => `<tr class="click" data-id="${c.id}"><td><strong>${esc(c.name)}</strong>${c.company ? `<div class="muted" style="font-size:.85rem">${esc(c.company)}</div>` : ''}${c.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td>
      <td>${esc(c.phone)}</td><td>${esc(c.source)}</td><td>${c.openDeals || ''}</td><td>${c.lastContact ? esc(fmtDay(c.lastContact, { day: 'numeric', month: 'short', year: 'numeric' })) : '<span class="muted">—</span>'}</td></tr>`).join('')
      : `<tr><td colspan="5" class="empty">${list.length ? 'Ningún contacto coincide.' : 'Agrega tu primer cliente o prospecto.'}</td></tr>`;
    document.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/contacto/' + tr.dataset.id; });
  };
  render();
  document.getElementById('q').oninput = render; document.getElementById('src').onchange = render;
  document.getElementById('add').onclick = () => {
    const box = document.getElementById('formBox'); box.innerHTML = contactFormHtml(null);
    document.getElementById('ccx').onclick = () => { box.innerHTML = ''; };
    document.getElementById('cf').onsubmit = async e => {
      e.preventDefault();
      try { const c = await call('/api/contacts', { method: 'POST', body: formData(e.target) }); toast('Contacto creado'); location.hash = '#/contacto/' + c.id; } catch (err) { toast(err.message); }
    };
    box.querySelector('input').focus();
  };
}

async function viewContact(cid) {
  const c = await call('/api/contacts/' + cid);
  const msg = `Hola ${c.name}, te escribo de ${settings.businessName}.`;
  shell('contactos', `<p><a href="#/contactos">← Contactos</a></p>
    <div class="card"><div class="row between"><div><h1 style="margin:0">${esc(c.name)}</h1>${c.company ? `<div class="muted">${esc(c.company)}</div>` : ''}</div>
      <div class="row">${c.phone ? `<a class="btn wa" target="_blank" rel="noopener" href="${waLink(c.phone, msg)}">WhatsApp</a>` : ''}${c.email ? `<a class="btn" href="mailto:${esc(c.email)}">Email</a>` : ''}<button class="btn" id="edit">Editar</button></div></div>
      <p style="margin:.75rem 0 0">${c.phone ? '📞 ' + esc(c.phone) + ' ' : ''}${c.email ? '· ✉️ ' + esc(c.email) : ''}${c.source ? ' · Llegó por ' + esc(c.source) : ''}</p>
      ${c.tags.length ? `<p style="margin:.4rem 0 0">${c.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</p>` : ''}
      ${c.notes ? `<p class="muted" style="white-space:pre-line">${esc(c.notes)}</p>` : ''}</div>
    <div id="formBox"></div>
    <div class="card"><div class="row between"><h2 style="margin:0">Oportunidades</h2><button class="btn sm" id="nd">+ Oportunidad</button></div><div id="dealBox"></div>
      ${c.deals.length ? `<table style="margin-top:.5rem">${c.deals.map(d => `<tr class="click" data-deal="${d.id}"><td><strong>${esc(d.title)}</strong>${OPEN.includes(d.stage) && d.nextAction ? `<div class="muted" style="font-size:.85rem">→ ${esc(d.nextAction)}${d.nextDate ? ' · ' + esc(fmtDay(d.nextDate, { day: 'numeric', month: 'short' })) : ''}</div>` : ''}</td><td>${badge(d.stage)}</td><td class="num">${esc(m0(d.value))}</td></tr>`).join('')}</table>` : '<p class="muted">Sin oportunidades todavía.</p>'}</div>
    <div class="card"><h2>Historial</h2>
      <form id="af" class="actform">
        <div><label>Tipo</label><select name="type">${Object.entries(TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div><label>¿Qué pasó?</label><input name="text" required placeholder="Ej: Llamé, pidió precios del plan anual"></div>
        <div><label>Fecha</label><input name="date" type="date" value="${todayStr}"></div>
        <button class="btn primary">Agregar</button></form>
      ${c.activities.length ? `<ul class="timeline">${c.activities.map(a => `<li><span class="ic" title="${esc(TYPE[a.type] || 'Sistema')}">${ICON[a.type] || '•'}</span>
        <div><div class="tx">${esc(a.text)}</div><div class="dt">${esc(fmtDay(a.date, { day: 'numeric', month: 'long', year: 'numeric' }))}${a.dealId ? ' · ' + esc(c.deals.find(d => d.id === a.dealId)?.title || '') : ''}</div></div>
        ${a.type !== 'sistema' ? `<button class="btn sm" data-del-act="${a.id}" aria-label="Borrar">✕</button>` : '<span></span>'}</li>`).join('')}</ul>` : '<p class="muted">Registra llamadas, mensajes y reuniones para no olvidar nada.</p>'}</div>
    <p><button class="btn danger" id="delc">Eliminar contacto</button></p>`);
  const reload = () => viewContact(cid);
  document.getElementById('edit').onclick = () => {
    const box = document.getElementById('formBox'); box.innerHTML = contactFormHtml(c);
    document.getElementById('ccx').onclick = () => { box.innerHTML = ''; };
    document.getElementById('cf').onsubmit = async e => { e.preventDefault(); try { await call('/api/contacts/' + c.id, { method: 'PUT', body: formData(e.target) }); toast('Contacto guardado'); reload(); } catch (err) { toast(err.message); } };
  };
  document.getElementById('nd').onclick = () => dealForm(document.getElementById('dealBox'), null, c.id, reload);
  document.querySelectorAll('[data-deal]').forEach(tr => tr.onclick = () => dealForm(document.getElementById('dealBox'), { ...c.deals.find(d => d.id === tr.dataset.deal) }, null, reload));
  document.getElementById('af').onsubmit = async e => {
    e.preventDefault();
    try { await call('/api/activities', { method: 'POST', body: { ...formData(e.target), contactId: c.id } }); toast('Agregado al historial'); reload(); } catch (err) { toast(err.message); }
  };
  document.querySelectorAll('[data-del-act]').forEach(b => b.onclick = async () => { if (!confirm('¿Borrar esta entrada?')) return; await call('/api/activities/' + b.dataset.delAct, { method: 'DELETE' }); reload(); });
  document.getElementById('delc').onclick = async () => {
    if (!confirm(`¿Eliminar a ${c.name} con sus oportunidades e historial? No se puede deshacer.`)) return;
    await call('/api/contacts/' + c.id, { method: 'DELETE' }); toast('Contacto eliminado'); location.hash = '#/contactos';
  };
}

// ---------- Resumen ----------
async function viewSummary() {
  const d = await call('/api/dashboard');
  const maxV = Math.max(1, ...OPEN.map(s => d.byStage[s].value));
  const maxS = Math.max(1, ...Object.values(d.sources));
  shell('resumen', `<h1>Resumen</h1>
    <div class="grid stats">
      <div class="card stat"><div class="label">En el embudo</div><div class="value">${esc(m0(d.openValue))}</div></div>
      <div class="card stat"><div class="label">Ganado este mes (${d.wonMonthCount})</div><div class="value" style="color:var(--ok)">${esc(m0(d.wonMonthValue))}</div></div>
      <div class="card stat"><div class="label">Tasa de cierre</div><div class="value">${d.winRate === null ? '—' : d.winRate + '%'}</div></div>
      <div class="card stat"><div class="label">Contactos nuevos este mes</div><div class="value">${d.newContactsMonth}</div></div></div>
    <div class="grid cols-2">
      <div class="card"><h2>Valor por etapa</h2>${OPEN.map(s => `<div class="hbar"><span>${STAGE[s]} (${d.byStage[s].count})</span><div class="track"><div class="fill" style="width:${100 * d.byStage[s].value / maxV}%"></div></div><span class="val">${esc(m0(d.byStage[s].value))}</span></div>`).join('')}</div>
      <div class="card"><h2>¿De dónde llegan tus contactos?</h2>${Object.keys(d.sources).length ? Object.entries(d.sources).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${100 * v / maxS}%"></div></div><span class="val">${v}</span></div>`).join('') : '<p class="muted">Sin datos todavía.</p>'}</div></div>`);
}

// ---------- Ajustes ----------
async function viewSettings() {
  const s = settings = await call('/api/settings');
  const formUrl = location.origin + '/formulario';
  const embed = `<iframe src="${formUrl}" style="width:100%;max-width:560px;height:640px;border:0" title="Contáctanos"></iframe>`;
  shell('ajustes', `<h1>Ajustes</h1>
    <form id="f" class="card"><h2>Tu negocio</h2><div class="grid cols-2">
      <div class="field"><label>Nombre del negocio</label><input name="businessName" value="${esc(s.businessName)}" required></div>
      <div class="field"><label>Moneda</label><select name="currency">${['COP', 'MXN', 'USD', 'EUR', 'PEN', 'CLP', 'ARS', 'GTQ', 'DOP', 'CRC', 'BOB', 'UYU', 'PYG'].map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Zona horaria</label><select name="timezone">${['America/Bogota', 'America/Mexico_City', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Caracas', 'America/Guayaquil', 'America/Panama', 'America/Santo_Domingo', 'America/Guatemala', 'America/Costa_Rica', 'America/Montevideo', 'America/Asuncion', 'America/La_Paz', 'America/New_York', 'Europe/Madrid'].map(v => `<option ${v === s.timezone ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Orígenes de contactos (separados por coma)</label><input name="sources" value="${esc(s.sources.join(', '))}"></div></div>
      <h2 style="margin-top:1rem">Formulario de contacto público</h2>
      <label style="display:flex;gap:.5rem;align-items:center;color:var(--text);margin-bottom:.75rem"><input type="checkbox" name="formEnabled" ${s.formEnabled ? 'checked' : ''} style="width:auto"> Activado: los que lo llenen entran solos al embudo como "Nuevo"</label>
      <div class="grid cols-2"><div class="field"><label>Título</label><input name="formTitle" value="${esc(s.formTitle)}"></div>
      <div class="field"><label>Texto de introducción</label><input name="formIntro" value="${esc(s.formIntro)}"></div>
      <div class="field"><label>Mensaje de gracias</label><input name="formThanks" value="${esc(s.formThanks)}"></div></div>
      <button class="btn primary">Guardar ajustes</button></form>
    <div class="card"><h2>Comparte tu formulario</h2><p class="muted">Enlace directo, para tu Instagram o tu WhatsApp:</p>
      <div class="row"><input readonly value="${esc(formUrl)}" style="flex:1;min-width:220px"><a class="btn" href="/formulario" target="_blank" rel="noopener">Abrir ↗</a></div>
      <p class="muted" style="margin-top:1rem">O pégalo dentro de tu página web con este código:</p><pre class="code">${esc(embed)}</pre></div>
    <form id="pw" class="card"><h2>Cambiar contraseña</h2><div class="grid cols-2">
      <div class="field"><label>Contraseña actual</label><input name="current" type="password" required autocomplete="current-password"></div>
      <div class="field"><label>Nueva contraseña</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div></div>
      <button class="btn">Actualizar contraseña</button></form>
    <div class="card"><h2>Copia de seguridad</h2><p class="muted">Descarga contactos, oportunidades e historial. Hazlo antes de actualizar o mover la app.</p>
      <div class="row"><a class="btn" href="/api/backup">Descargar copia</a><a class="btn" href="/api/contacts.csv">Contactos en CSV (Excel)</a>
      <label class="btn" style="margin:0;color:var(--text)">Restaurar desde archivo…<input type="file" id="restore" accept="application/json,.json" hidden></label></div></div>`);
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    try { settings = await call('/api/settings', { method: 'PUT', body: { ...formData(e.target), formEnabled: e.target.formEnabled.checked } }); toast('Ajustes guardados'); } catch (err) { toast(err.message); }
  };
  document.getElementById('pw').onsubmit = async e => { e.preventDefault(); try { await call('/api/password', { method: 'PUT', body: formData(e.target) }); e.target.reset(); toast('Contraseña actualizada'); } catch (err) { toast(err.message); } };
  document.getElementById('restore').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    if (!confirm('Esto reemplazará contactos, oportunidades e historial por los del archivo. Se guardará una copia del estado actual en el servidor. ¿Continuar?')) { e.target.value = ''; return; }
    try { const r = await call('/api/restore', { method: 'POST', body: JSON.parse(await file.text()) }); toast(`Restaurado: ${r.contacts} contactos, ${r.deals} oportunidades`); settings = null; setTimeout(route, 800); }
    catch (err) { toast(err.message.includes('JSON') ? 'El archivo no es válido' : err.message); e.target.value = ''; }
  };
}

// ---------- Router ----------
async function route() {
  const st = await fetch('/api/status').then(r => r.json());
  if (st.setup) return viewSetup();
  if (!st.authed) return viewLogin();
  const h = location.hash.slice(1) || '/';
  if (h === '/login') { location.hash = '#/'; return; }
  try {
    if (!settings) settings = await call('/api/settings');
    if (!todayStr) todayStr = (await call('/api/today')).today;
    let m;
    if (h === '/') return await viewHome();
    if (h === '/embudo') return await viewBoard();
    if (h === '/contactos') return await viewContacts();
    if ((m = h.match(/^\/contacto\/([a-f0-9]+)$/))) return await viewContact(m[1]);
    if (h === '/resumen') return await viewSummary();
    if (h === '/ajustes') return await viewSettings();
    location.hash = '#/';
  } catch (err) { if (err.status !== 401) toast(err.message); }
}
window.addEventListener('hashchange', route);
route();
