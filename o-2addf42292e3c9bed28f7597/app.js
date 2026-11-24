/* ---------- app ---------- */
(() => {
const app = document.getElementById('app');
const S = {orders: [], expenses: [], db: null, ready: {o: false, e: false}, stale: false, failed: false, year: null, ym: null, q: '', status: 'Active', open: null, dirty: false, downloads: null, uc: null};
const STATUSES = ['Confirmed', 'In progress', 'Ready', 'Completed', 'Cancelled'];
const CATS = ['Ingredients', 'Packaging', 'Equipment', 'Delivery and travel', 'Marketing', 'Fees', 'Other'];
const UC_TYPE = {Ingredients: 'Goods and materials', Packaging: 'Goods and materials', Equipment: 'Office and equipment costs', Marketing: 'Marketing and advertising'};
const DRAFT = 'tina-order-draft';
const CAL_ID = '00000000-0000-4000-8000-0000000ca1e0', CAL_LAST = 'tina-cal-synced', PAY_ID = '00000000-0000-4000-8000-0000000a1d00';
const CAL_SCRIPT = "// Tina's Order Book -> Google Calendar. Paste all of this into a new Apps Script project.\nconst SECRET = '__SECRET__';\nconst CAL_NAME = \"Tina's Orders\";\nconst TZ = 'Europe/London';\n\nfunction doGet() { return out_({ok: true, name: CAL_NAME}); }\n\nfunction doPost(e) {\n  let body;\n  try { body = JSON.parse(e.postData.contents); } catch (x) { return out_({ok: false, error: 'bad request'}); }\n  if (body.secret !== SECRET) return out_({ok: false, error: 'wrong secret'});\n  const lock = LockService.getScriptLock();\n  lock.waitLock(60000);\n  try {\n    const cal = calendar_(), byOrder = {};\n    cal.getEvents(new Date(2020, 0, 1), new Date(2040, 0, 1)).forEach(function (ev) {\n      const id = ev.getTag('tbOrder');\n      if (id) (byOrder[id] = byOrder[id] || []).push(ev);\n    });\n    const seen = {};\n    let changed = 0;\n    (body.orders || []).forEach(function (o) {\n      seen[o.id] = true;\n      const old = byOrder[o.id] || [], events = o.events || [];\n      if (old.length === events.length && old.every(function (ev) { return ev.getTag('tbSig') === o.sig; })) return;\n      old.forEach(function (ev) { ev.deleteEvent(); });\n      events.forEach(function (x) {\n        const start = Utilities.parseDate(x.date + ' ' + x.time, TZ, 'yyyy-MM-dd HH:mm');\n        const ev = cal.createEvent(x.title, start, new Date(start.getTime() + x.mins * 60000), {description: x.details || '', location: x.location || ''});\n        ev.setTag('tbOrder', o.id); ev.setTag('tbSig', o.sig);\n        ev.removeAllReminders();\n        (x.reminders || []).forEach(function (m) { ev.addPopupReminder(m); });\n      });\n      changed++;\n    });\n    if (body.full) Object.keys(byOrder).forEach(function (id) {\n      if (!seen[id]) { byOrder[id].forEach(function (ev) { ev.deleteEvent(); }); changed++; }\n    });\n    return out_({ok: true, changed: changed});\n  } catch (x) {\n    return out_({ok: false, error: String(x && x.message || x)});\n  } finally {\n    lock.releaseLock();\n  }\n}\n\nfunction calendar_() {\n  const found = CalendarApp.getCalendarsByName(CAL_NAME)[0];\n  return found || CalendarApp.createCalendar(CAL_NAME, {color: CalendarApp.Color.PINK, timeZone: TZ});\n}\n\n// Press Run on this once in the editor so Google asks for permission to use your calendar.\nfunction setUp() { calendar_(); }\n\nfunction out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }\n";
const today = () => iso(new Date());
S.ym = today().slice(0, 7); S.year = today().slice(0, 4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = (s, o = {day: 'numeric', month: 'short', year: 'numeric'}) => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-GB', o) : '';
const toast = m => { const t = document.getElementById('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200); };
const what = o => o.orderType === 'sample' ? 'Sample box (' + (o.biscuitQty || PRICING.sample.qty) + ' biscuits)' : [o.biscuits && (o.biscuitQty || '?') + ' biscuits', o.cupcakes && (o.cupcakeQty || '?') + ' cupcakes'].filter(Boolean).join(' + ') || 'Items not set';
const dateTab = (s, cls = '') => s ? `<div class="tab ${cls}"><span>${fmt(s, {month: 'short'})}</span><b>${fmt(s, {day: 'numeric'})}</b><span>${fmt(s, {weekday: 'short'})}</span></div>` : '<div class="tab"><b>?</b></div>';
const route = () => (location.hash || '#coming-up').slice(1);
const hasExamples = () => S.orders.some(o => o.example) || S.expenses.some(e => e.example);

function dataNote() {
  if (S.failed) return `<div class="notice bad"><span>Your saved orders can't be reached right now. Reload the page to try again. Nothing new can be saved until they load.</span></div>`;
  if (!S.db) return `<div class="notice bad"><span>You're signed out. Reload the page to sign in again.</span></div>`;
  if (S.stale) return `<div class="notice warn"><span>Still connecting. What you see may be out of date.</span></div>`;
  if (hasExamples()) return `<div class="notice"><span>The orders marked Example are made up to show how this works. They count in the totals until you remove them.</span><button id="clearEx">Remove examples</button></div>`;
  return '';
}

function render() {
  const r = route();
  document.querySelectorAll('nav a').forEach(a => a.dataset.r === (r.startsWith('order-') ? 'orders' : r.startsWith('enquir') ? 'enquiries' : r) ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  navBadge();
  if (r === 'new-order' || r === 'edit' || r === 'price' || r === 'enquiry-new') return; // forms are drawn once by go()
  if (r === 'enquiries') return viewEnquiries();
  if (r.startsWith('enquiry/')) { const id = r.slice(8); if (S.enqOpen === id && S.enqTyping && app.querySelector('#eMsg')) return; S.enqOpen = id; return viewEnquiry(); }
  if (r === 'calendar' && app.querySelector('#calPage')) return;
  if (r === 'orders') viewOrders(); else if (r === 'calendar') viewCalendar(); else if (r === 'money') viewMoney(); else if (r === 'order') viewOrder(); else viewHome();
}

const MAX_IMAGES = 10, signedCache = {};
async function signedUrls(paths) {
  const need = paths.filter(p => !signedCache[p] || signedCache[p].t < Date.now() - 45 * 60000);
  if (need.length) { const m = await TB.signed(need); Object.entries(m).forEach(([p, url]) => signedCache[p] = {url, t: Date.now()}); }
  return Object.fromEntries(paths.filter(p => signedCache[p]).map(p => [p, signedCache[p].url]));
}
async function shrink(file) {
  const bmp = await createImageBitmap(file), k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  return new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('image')), 'image/jpeg', .84));
}
function lightbox(url) {
  const d = document.createElement('div'); d.className = 'lightbox'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Image');
  const i = new Image(); i.src = url; i.alt = 'Order image'; const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Close'; d.append(b, i);
  d.onclick = () => d.remove(); document.body.append(d); b.focus();
}

function viewHome() {
  const t = today(), all = S.orders.flatMap(jobs), week = addDays(t, 7), horizon = addDays(t, 45);
  const overdue = all.filter(j => j.date < t && j.kind === 'pay');
  const missed = all.filter(j => j.date < t && j.kind !== 'pay' && j.kind !== 'event');
  const soon = all.filter(j => j.date >= t && j.date <= horizon).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const owed = S.orders.filter(o => o.status !== 'Cancelled').reduce((n, o) => n + sums(o).outstanding, 0);
  const m = month(t.slice(0, 7), S.orders, S.expenses);
  const noMake = S.orders.filter(o => !['Cancelled', 'Completed'].includes(o.status) && !o.makeDate);
  const days = {}; soon.forEach(j => (days[j.date] ||= []).push(j));
  const job = j => `<button class="job" data-open="${esc(j.o.id)}"><span class="pill ${j.kind}">${esc(j.label)}</span><strong>${esc(j.o.customerName)}</strong><span class="muted">${esc(what(j.o))}${j.time ? ' at ' + esc(j.time) : ''}</span>${j.o.example ? '<span class="pill">Example</span>' : ''}${j.o.allergies ? `<span class="allergy small">Allergy: ${esc(j.o.allergies)}</span>` : ''}</button>`;
  app.innerHTML = `${dataNote()}${calNote()}
  <div class="stats">
    <div class="stat"><b>${all.filter(j => j.date >= t && j.date <= week && j.kind !== 'event').length}</b><span>Jobs in the next 7 days</span></div>
    <div class="stat"><b>${gbp(owed)}</b><span>Still to be paid to you</span></div>
    <div class="stat"><b class="${m.profit < 0 ? 'neg' : ''}">${gbp(m.profit)}</b><span>Profit for ${fmt(t, {month: 'long'})} so far</span></div>
  </div>
  ${overdue.length ? `<section class="stack"><h2>Payments overdue</h2><div>${overdue.map(j => `<div class="row">${job(j).replace('class="job"', 'class="job" style="width:auto"').replace('pill pay', 'pill over')}<span class="small muted">was due ${fmt(j.date)}</span></div>`).join('')}</div></section>` : ''}
  ${missed.length ? `<div class="notice warn"><span>${missed.length} past job${missed.length > 1 ? 's are' : ' is'} on orders not marked Completed. Open them in Orders to update the status.</span></div>` : ''}
  ${noMake.length ? `<div class="notice warn"><span>${noMake.length} order${noMake.length > 1 ? 's have' : ' has'} no make date, so ${noMake.length > 1 ? 'they' : 'it'} won't appear as a baking day: ${noMake.slice(0, 3).map(o => esc(o.customerName)).join(', ')}.</span></div>` : ''}
  <section><div class="row between" style="margin-bottom:8px"><h2>Coming up</h2><span class="small muted">Next 45 days</span></div>
  ${soon.length ? Object.entries(days).map(([d, js]) => `<div class="day">${dateTab(d, d === t ? 'today' : '')}<div>${js.map(job).join('')}</div></div>`).join('') : `<div class="empty">Nothing in the next 45 days. Add an order and its make day, hand-over and payment date will show here.<br><br><a class="btn" href="#new-order">Add an order</a></div>`}
  </section>`;
}

function viewOrders() {
  const q = S.q.toLowerCase();
  const list = S.orders.filter(o => S.status === 'All' || (S.status === 'Active' ? !['Completed', 'Cancelled'].includes(o.status) : o.status === S.status))
    .filter(o => !q || [o.customerName, o.email, o.instagram, o.phone, o.details, o.colourScheme, o.dietary].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (a.eventDate || '').localeCompare(b.eventDate || ''));
  app.innerHTML = `${dataNote()}<div class="row between"><h2>Orders</h2><a class="btn" href="#new-order">Add an order</a></div>
  <div class="row"><input type="search" id="q" aria-label="Search orders" placeholder="Search name, theme, colour…" value="${esc(S.q)}" style="flex:1 1 200px">
  <select id="fs" aria-label="Show" style="flex:0 1 170px">${['Active', ...STATUSES, 'All'].map(s => `<option ${s === S.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
  <div class="stack" id="list">${list.length ? list.map(o => { const s = sums(o); return `<button class="docket" data-open="${esc(o.id)}">${dateTab(o.eventDate)}<div style="min-width:0"><strong>${esc(o.customerName)}</strong> ${o.example ? '<span class="pill">Example</span>' : ''}<div class="muted small">${esc(what(o))} · ${esc({delivery: 'Hand delivery', post: 'Postage', collection: 'Collection'}[o.fulfilment] || 'Delivery not set')}</div>${o.allergies ? `<div class="allergy small">Allergy: ${esc(o.allergies)}</div>` : ''}</div><div class="sum"><strong>${gbp(s.income)}</strong><br>${s.outstanding ? `<span class="pill pay">${gbp(s.outstanding)} to pay</span>` : '<span class="pill done">Paid</span>'}</div></button>`; }).join('') : `<div class="empty">No orders match. Try "All" or add a new order.</div>`}</div>`;
}

function viewOrder() {
  const o = S.orders.find(x => x.id === S.open);
  if (!o) { location.hash = '#orders'; return; }
  const s = sums(o), h = handover(o), note = [what(o), o.details, o.colourScheme && 'Colours: ' + o.colourScheme, o.allergies && 'ALLERGIES: ' + o.allergies, o.phone && 'Phone: ' + o.phone].filter(Boolean).join('\n');
  const cal = [o.makeDate && ['Make day', calUrl('🍪 Make: ' + o.customerName + ' (' + what(o) + ')', note, o.makeDate)], oldPostDate(o) && ['Post day', calUrl('Post: ' + o.customerName + ' (' + what(o) + ')', note, o.postDate)], h.date && [h.label === 'Post' ? 'Post day' : h.label, calUrl(h.label + ': ' + o.customerName, note + (o.deliveryAddress ? '\nAddress: ' + o.deliveryAddress : ''), h.date, h.time)], s.outstanding && dueDate(o) && ['Payment due', calUrl('Payment due ' + gbp(s.outstanding) + ': ' + o.customerName, note, dueDate(o))]].filter(Boolean);
  const item = (k, v) => v ? `<div><h3>${k}</h3>${esc(v)}</div>` : '';
  app.innerHTML = `<div class="row between"><div><h2>${esc(o.customerName)}</h2><span class="muted">${esc(what(o))} for ${fmt(o.eventDate) || 'date not set'}</span></div>
  <div class="row"><label class="lab" for="st">Status</label><select id="st" style="width:auto">${STATUSES.map(x => `<option ${x === o.status ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
  ${o.example ? '<div class="notice"><span>This is an example order.</span></div>' : ''}
  ${o.orderType === 'sample' ? `<div class="notice"><span><b>Sample box.</b> If they book a full order, take ${gbp(PRICING.sample.price)} off it.</span></div>` : ''}
  ${o.allergies ? `<div class="notice bad"><span class="allergy">Allergies: ${esc(o.allergies)}</span></div>` : ''}
  <div class="total"><div><span>Treats</span><span>${gbp(s.treats)}</span></div>${sendsOut(o) ? `<div><span>${o.fulfilment === 'post' ? 'Postage' : 'Delivery'}</span><span>${gbp(s.delivery)}</span></div>` : ''}<div class="big"><span>Order income</span><span>${gbp(s.income)}</span></div><div><span>Expenses on this order</span><span>${gbp(s.costs)}</span></div><div><span>Profit</span><span class="${s.profit < 0 ? 'neg' : ''}">${gbp(s.profit)}</span></div><div><span>Deposit received</span><span>${gbp(s.deposit)}</span></div><div class="big"><span>Payment outstanding</span><span>${gbp(s.outstanding)}</span></div></div>
  <div class="row">${s.outstanding ? `<button class="primary" id="paid">Mark balance as paid</button>` : o.balancePaid ? '<button id="unpaid">Undo balance paid</button>' : ''}<button id="edit">Edit order</button></div>
  ${S.cal ? `<section class="card"><h3>Google Calendar</h3><span>${calEvents(o).length ? `This order's ${calEvents(o).map(x => ({make: 'make day', post: 'post day', hand: h.label === 'Deliver' ? 'delivery' : h.label.toLowerCase()})[x.key]).join(', ').replace(/, ([^,]*)$/, ' and $1')} ${calEvents(o).length > 1 ? 'are' : 'is'} in your Google Calendar, with reminders 5 days before and on the day. Changes you make here update it by themselves.` : o.example ? 'Example orders are not put in your calendar.' : o.status === 'Cancelled' ? 'Cancelled, so it has been taken out of your calendar.' : 'Add a make, post, delivery or collection date and it will go in your calendar.'}</span></section>`
  : `<section class="card"><h3>Add to Google Calendar</h3><div class="row">${cal.length ? cal.map(([l, u]) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('') : '<span class="muted">Add dates to the order to use this.</span>'}</div><a href="#calendar" class="small">Put every order in your calendar automatically, with reminders</a></section>`}
  <section class="card detail">
    ${item('Email', o.email)}${item('Instagram', o.instagram)}${item('Phone', o.phone)}${item('Make on', fmt(o.makeDate))}${item('Post on', fmt(oldPostDate(o)))}${item(h.label === 'Post' ? 'Post on' : h.label === 'Deliver' ? 'Hand delivery' : h.label, [fmt(h.date), h.time].filter(Boolean).join(' at '))}
    ${item(o.fulfilment === 'post' ? 'Postal address' : 'Delivery address', sendsOut(o) && o.deliveryAddress)}${item('Delivery location', o.fulfilment === 'delivery' && o.deliveryLocation)}${o.trackingNumber ? `<div><h3>Tracking number</h3>${esc(o.trackingNumber)}<br><a class="small" href="https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(o.trackingNumber.replace(/\s+/g, ''))}" target="_blank" rel="noopener">Track on Royal Mail</a></div>` : ''}
    ${item('Dietary preference', o.dietary)}${item('Colour scheme', o.colourScheme)}${item('Packaging', [o.cellophane ? 'Wrapped in cellophane' : 'No cellophane', o.bow === 'with' ? 'with a ' + (o.bowColour || '') + ' bow' : o.bow === 'without' ? 'without a bow' : ''].filter(Boolean).join(', '))}
    ${item('Deposit paid on', s.deposit ? fmt(o.depositDate) : '')}${item('Paid in full on', o.balancePaid ? fmt(o.balancePaidDate) : '')}${item('Balance due on', s.outstanding ? fmt(dueDate(o)) : '')}
    <div class="full" style="grid-column:1/-1"><h3>Theme, design and ideas</h3>${esc(o.details) || '<span class="muted">Nothing added.</span>'}</div>
    ${(o.costs || []).length ? `<div style="grid-column:1/-1"><h3>Expenses on this order</h3>${o.costs.map(c => esc(c.item) + ': ' + gbp(P(c.amount))).join('\n')}</div>` : ''}
  </section>
  ${(o.images || []).length ? `<section class="card"><h3>Images</h3><div class="thumbs" id="orderImgs"></div></section>` : ''}
  <div class="row" id="delrow"><button class="danger" id="del">Delete order</button></div>`;
  const box = app.querySelector('#orderImgs');
  if (box) { const shown = o.images.map(() => { const w = document.createElement('div'); w.className = 'thumb'; const i = new Image(); i.alt = 'Order image'; i.onclick = () => i.src && lightbox(i.src); w.append(i); box.append(w); return i; });
    signedUrls(o.images).then(m => o.images.forEach((p, n) => { if (m[p]) shown[n].src = m[p]; })).catch(() => toast("Images couldn't load. Check your connection.")); }
  const upd = async (patch, msg) => { try { await S.db.doc('orders/' + o.id).update({...patch, updatedAt: new Date().toISOString()}); toast(msg); calSync([S.orders.find(x => x.id === o.id)]); } catch (e) { toast("That didn't save. Check your connection and try again."); } };
  app.querySelector('#st').onchange = e => upd({status: e.target.value}, 'Status changed to ' + e.target.value);
  app.querySelector('#paid')?.addEventListener('click', () => upd({balancePaid: true, balancePaidDate: today()}, 'Balance marked as paid'));
  app.querySelector('#unpaid')?.addEventListener('click', () => upd({balancePaid: false, balancePaidDate: ''}, 'Balance marked as unpaid'));
  app.querySelector('#edit').onclick = () => { location.hash = '#edit'; };
  app.querySelector('#del').onclick = () => { document.getElementById('delrow').innerHTML = `<span>Delete this order for good?</span><button class="danger" id="delyes">Yes, delete it</button><button id="delno">Keep it</button>`;
    document.getElementById('delno').onclick = viewOrder;
    document.getElementById('delyes').onclick = async () => { try { await S.db.doc('orders/' + o.id).delete(); TB.removeFiles(o.images || []).catch(() => {}); calSync([{id: o.id, status: 'Cancelled'}]); location.hash = '#orders'; toast('Order deleted'); } catch (e) { toast("That didn't delete. Try again."); } }; };
}

/* ---------- enquiries ---------- */
// Enquiries from the website quote form, plus ones Tina adds herself from Instagram, WhatsApp, email or phone.
const ENQ_BUCKET = 'enquiry-uploads', FROM_ENQ = 'tina-from-enquiry';
const ENQ_STATUS = {new: 'New', quoted: 'Quoted', changed: 'Changed', confirmed: 'Confirmed', lost: 'Lost'};
const ENQ_OPEN = ['new', 'changed', 'quoted'];
const ENQ_SOURCES = {website: 'Website', instagram: 'Instagram', whatsapp: 'WhatsApp', email: 'Email', phone: 'Phone', facebook: 'Facebook', 'in-person': 'In person', other: 'Other'};
const ENQ_PRODUCTS = ['Custom biscuits', 'Branded biscuits', 'Edible logo or artwork biscuits', 'Edible image (photo) biscuits', 'Biscuit decorating activity box', 'Something else'];
S.enquiries = []; S.enqFilter = 'Open'; S.enqQ = ''; S.enqOpen = null; S.enqMissing = false; S.enqQuoting = null; S.enqTyping = false;
const enqSt = e => e.status && ENQ_STATUS[e.status] ? e.status : 'new';
const ago = ts => { const d = Math.floor((Date.now() - new Date(ts)) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; };
const rawOf = e => e.raw || {};
const firstName = e => (e.name || '').trim().split(/\s+/)[0] || 'there';
const enqAddress = r => [r.addr1, r.addr2, r.town, r.postcode && r.postcode.toUpperCase()].filter(Boolean).join(', ');
function enqQty(e) {
  const r = rawOf(e), key = {custom: 'c_qty', branded: 'b_qty', logo: 'l_qty', image: 'i_qty'}[r.product];
  if (key && r[key]) return r[key];
  if (r.product === 'box' && r.x_people && r.x_each) return String(r.x_people * r.x_each);
  return '';
}
async function loadEnquiries() {
  try { S.enquiries = (await TB.query('enquiries?select=*&order=created_at.desc')) || []; S.enqMissing = false; }
  catch (x) { if (x.status === 401) throw x; S.enqMissing = true; }
  S.enqLoaded = true;
}
async function enqSave(id, patch, msg) {
  try {
    await TB.patchRow('enquiries', id, {...patch, updated_at: new Date().toISOString()});
    const e = S.enquiries.find(x => x.id === id); if (e) Object.assign(e, patch);
    if (msg) toast(msg); navBadge(); return true;
  } catch (x) { toast("That didn't save. Check your connection and try again."); return false; }
}
function navBadge() {
  const a = document.querySelector('nav a[data-r="enquiries"]'); if (!a) return;
  const n = S.enquiries.filter(e => enqSt(e) === 'new').length;
  a.innerHTML = 'Enquiries' + (n ? ` <span class="nbadge" aria-label="${n} new">${n}</span>` : '');
}

function viewEnquiries() {
  navBadge();
  if (S.enqMissing) { app.innerHTML = `${dataNote()}<h2>Enquiries</h2><div class="notice warn"><span>Enquiries can't be loaded yet. Check your connection and reload the page.</span></div>`; return; }
  const q = S.enqQ.toLowerCase(), rank = e => ({new: 0, changed: 1, quoted: 2}[enqSt(e)] ?? 3);
  const list = S.enquiries
    .filter(e => S.enqFilter === 'All' || (S.enqFilter === 'Open' ? ENQ_OPEN.includes(enqSt(e)) : ENQ_STATUS[enqSt(e)] === S.enqFilter))
    .filter(e => !q || [e.name, e.email, e.phone, e.product, e.event, e.notes, JSON.stringify(e.answers || '')].join(' ').toLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b) || (rank(a) < 3 ? (a.updated_at || a.created_at).localeCompare(b.updated_at || b.created_at) : b.created_at.localeCompare(a.created_at)));
  const counts = Object.keys(ENQ_STATUS).map(k => [k, S.enquiries.filter(e => enqSt(e) === k).length]);
  app.innerHTML = `${dataNote()}<div class="row between"><h2>Enquiries</h2><a class="btn" href="#enquiry-new">Quick add</a></div>
  <p class="hint">Every enquiry in one place. Ones from your website arrive here by themselves. Use <b>Quick add</b> for Instagram, WhatsApp, email or phone enquiries.</p>
  <div class="row"><input type="search" id="eq" aria-label="Search enquiries" placeholder="Search name, product, theme…" value="${esc(S.enqQ)}" style="flex:1 1 200px">
  <select id="ef" aria-label="Show" style="flex:0 1 190px">${['Open', ...Object.values(ENQ_STATUS), 'All'].map(s => `<option ${s === S.enqFilter ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
  <p class="muted small">${counts.filter(([, n]) => n).map(([k, n]) => `${n} ${ENQ_STATUS[k].toLowerCase()}`).join(' · ') || 'No enquiries yet.'}</p>
  <div class="stack" id="elist">${list.length ? list.map(e => { const qs = e.quotes || [], last = qs[qs.length - 1], st = enqSt(e);
    return `<button class="docket" data-enq="${esc(e.id)}">${dateTab(e.date_needed)}<div style="min-width:0"><strong>${esc(e.name || 'No name')}</strong> <span class="pill st-${st}">${ENQ_STATUS[st]}</span>
      <div class="muted small">${esc(e.product || 'Product not given')} · ${esc(ENQ_SOURCES[e.source] || 'Website')} · ${st === 'new' ? '<b>waiting ' + ago(e.created_at).replace(' ago', '') + '</b>' : 'received ' + ago(e.created_at)}</div></div>
      <div class="sum">${last ? `<strong>${gbp(P(last.price))}</strong><br><span class="muted small">quoted</span>` : '<span class="muted small">No quote yet</span>'}</div></button>`; }).join('')
    : `<div class="empty">${S.enquiries.length ? 'No enquiries match. Try "All".' : 'No enquiries yet. They will appear here as soon as someone fills in your quote form, or press Quick add to add one from Instagram or WhatsApp.'}</div>`}</div>`;
  const qi = app.querySelector('#eq'); qi.oninput = () => { S.enqQ = qi.value; const at = qi.selectionStart; viewEnquiries(); const n = app.querySelector('#eq'); n.focus(); n.setSelectionRange(at, at); };
  app.querySelector('#ef').onchange = ev => { S.enqFilter = ev.target.value; viewEnquiries(); };
}

function enqMessage(e) {
  const qs = e.quotes || [], q = qs.filter(x => x.accepted).pop() || qs[qs.length - 1], when = e.date_needed ? ' for ' + fmt(e.date_needed, {day: 'numeric', month: 'long'}) : '';
  const sign = '\n\nChristina\nTina\'s Bespoke Treats';
  if (!q) return `Hi ${firstName(e)},\n\nThank you so much for your enquiry${when}! I'm looking through your details now and will send you a personalised quote very soon.${sign}`;
  return `Hi ${firstName(e)},\n\nThank you for your enquiry${when}! Here is your personalised quote:\n\n${q.includes}\n\nTotal: ${gbp(P(q.price))}${P(q.delivery) ? ' (including ' + gbp(P(q.delivery)) + ' delivery)' : ''}${q.note ? '\n\n' + q.note : ''}\n\nFull payment of ${gbp(P(q.price))} confirms your order and secures your date.${S.payImage ? ' My payment details are in the picture attached.' : ''} Just let me know if you'd like to go ahead, or if you'd like to change anything and I'll update your quote.${sign}`;
}
const waNumber = p => { let d = String(p || '').replace(/[^\d+]/g, ''); if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = '44' + d.slice(1); return d.length >= 10 ? d : ''; };

function viewEnquiry() {
  const e = S.enquiries.find(x => x.id === S.enqOpen);
  if (!e) { if (S.enqLoaded) location.hash = '#enquiries'; else app.innerHTML = '<p class="muted">Loading the enquiry…</p>'; return; }
  S.enqTyping = false;
  const r = rawOf(e), qs = e.quotes || [], st = enqSt(e), files = e.files || [];
  const allergy = r.allergy === 'yes' ? [r.allergyDetails, r.mayContain].filter(Boolean).join(' · ') : '';
  const insta = (e.answers || []).flatMap(g => g.rows || []).find(x => x[0] === 'Instagram');
  const linkedOrder = e.order_id && S.orders.find(o => o.id === e.order_id);
  app.innerHTML = `<p><a href="#enquiries">&larr; All enquiries</a></p>
  <div class="row between"><div><h2>${esc(e.name || 'No name')}</h2><span class="muted">${esc(e.product || 'Product not given')}${e.date_needed ? ' for ' + fmt(e.date_needed) : ''} · ${esc(ENQ_SOURCES[e.source] || 'Website')}, received ${fmt(e.created_at.slice(0, 10))}</span></div>
  <div class="row"><label class="lab" for="est">Status</label><select id="est" style="width:auto">${Object.entries(ENQ_STATUS).map(([k, v]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
  ${allergy ? `<div class="notice bad"><span class="allergy">Allergies: ${esc(allergy)}</span></div>` : ''}
  <section class="card detail">
    ${e.email ? `<div><h3>Email</h3><a href="mailto:${esc(e.email)}">${esc(e.email)}</a></div>` : ''}${e.phone ? `<div><h3>Phone</h3><a href="tel:${esc(e.phone.replace(/\s+/g, ''))}">${esc(e.phone)}</a></div>` : ''}${insta ? `<div><h3>Instagram</h3>${esc(insta[1])}</div>` : ''}
    ${e.event ? `<div><h3>Event</h3>${esc(e.event)}</div>` : ''}${e.budget ? `<div><h3>Budget</h3>${esc(e.budget)}</div>` : ''}${enqQty(e) ? `<div><h3>Quantity asked for</h3>${esc(enqQty(e))}</div>` : ''}
  </section>

  <section class="card"><h3>Quotes</h3>
    ${qs.length ? `<div class="stack">${qs.map((q, i) => `<div class="quote ${q.accepted ? 'ok' : ''}"><div class="row between"><b>${fmt(q.date)} · ${gbp(P(q.price))}</b>${q.accepted ? '<span class="pill done">Accepted</span>' : `<button class="link" data-acc="${i}">Customer accepted this</button>`}</div><div>${esc(q.includes)}</div>${P(q.delivery) ? `<div class="muted small">Includes ${gbp(P(q.delivery))} delivery</div>` : ''}${q.note ? `<div class="muted small">${esc(q.note)}</div>` : ''}<button class="link small" data-delq="${i}">Remove</button></div>`).join('')}</div>`
      : '<p class="muted">No quote yet. Work one out with Price it, or type one in below.</p>'}
    <div class="row"><button class="primary" id="ePrice">Work out a price with Price it</button></div>
    <details class="howto" id="qAdd"><summary>Type a quote in yourself</summary><form id="qf" class="grid" novalidate>
      ${moneyInput('qPrice', '', 'Total price')}${moneyInput('qDel', '', 'Of which delivery', 'Leave blank if collection')}
      <div class="f" style="grid-column:1/-1"><label for="qInc">What's included</label><textarea id="qInc" rows="3" placeholder="e.g. 30 hand-piped biscuits, individually wrapped with gold bows, collection">${esc(enqQty(e) ? enqQty(e) + ' × ' + (e.product || 'biscuits').toLowerCase() : '')}</textarea></div>
      <div class="f" style="grid-column:1/-1"><label for="qNote">Note to the customer (optional)</label><input id="qNote" placeholder="e.g. A simpler design would bring this down to £70"></div>
      <p class="err" id="qErr" role="alert" hidden></p><div><button class="primary" type="submit">Save quote</button></div></form></details>
  </section>

  <section class="card"><h3>Reply to ${esc(firstName(e))}</h3>
    <p class="hint">Check the message, change anything you like, then send it the way they contacted you.</p>
    <textarea id="eMsg" rows="11" aria-label="Message to the customer">${esc(enqMessage(e))}</textarea>
    <div class="row">${e.email ? '<button id="eGmail">Send from Gmail</button><button id="eMail">Send from email app</button>' : ''}${waNumber(e.phone) ? '<button id="eWa">Send on WhatsApp</button>' : ''}<button id="eCopy">Copy for Instagram</button></div>
    <div class="paybox"><h3>Payment details picture</h3>
      ${S.payImage ? `<div class="row" style="align-items:center"><div class="thumb" style="width:88px"><img id="payImg" alt="Your payment details"></div>
        <div class="stack" style="gap:6px;flex:1"><span class="hint">Send this with your quote so the customer knows how to pay.</span>
        <div class="row"><button class="primary" id="payShare">Share message and picture</button><button id="payDl">Save picture</button><label class="link small" for="payPick" tabindex="0">Change picture</label></div></div></div>`
      : `<p class="hint">Add the picture with your bank details once, and you can send it with every quote.</p><label class="btn" for="payPick" tabindex="0">Add payment details picture</label>`}
      <input type="file" id="payPick" accept="image/*" hidden>
    </div>
  </section>

  <div class="row">${linkedOrder ? `<button class="primary big-btn" id="eOrderOpen">Open the order</button>` : `<button class="primary big-btn" id="eOrder">Turn into an order</button>`}</div>

  <section class="card"><h3>What they asked for</h3>${(e.answers || []).map(g => `<div class="ans-group"><h4>${esc(g.title === 'Check and send' ? 'Other details' : g.title)}</h4><dl>${(g.rows || []).filter(x => !/accurate|consent|Agreed to allergy|postage notice/i.test(x[0])).map(x => `<dt>${esc(x[0])}</dt><dd>${esc(x[1])}</dd>`).join('')}</dl></div>`).join('') || '<p class="muted">No details.</p>'}</section>
  ${files.length ? `<section class="card"><h3>Photos and files (${files.length})</h3><div class="thumbs" id="eImgs"></div></section>` : ''}
  <section class="card"><h3>Your notes</h3><textarea id="eNotes" rows="4" placeholder="Anything to remember, e.g. called her on Tuesday, she'll confirm by Friday">${esc(e.notes || '')}</textarea><span class="hint" id="eNoteSaved"></span></section>
  <div class="row" id="edelrow"><button class="danger" id="eDel">Delete enquiry</button></div>`;

  const box = app.querySelector('#eImgs');
  if (box) {
    const els = files.map(f => { const w = document.createElement('div'); w.className = 'thumb'; if (/\.(pdf|svg)$/i.test(f.path)) { const a = document.createElement('a'); a.textContent = f.name || 'File'; a.target = '_blank'; a.rel = 'noopener'; w.append(a); box.append(w); return a; } const i = new Image(); i.alt = f.label || 'Customer photo'; i.onclick = () => i.src && lightbox(i.src); w.append(i); box.append(w); return i; });
    TB.signedFrom(ENQ_BUCKET, files.map(f => f.path)).then(m => files.forEach((f, n) => { if (!m[f.path]) return; if (els[n].tagName === 'A') els[n].href = m[f.path]; else els[n].src = m[f.path]; })).catch(() => toast("Photos couldn't load. Check your connection."));
  }
  app.querySelectorAll('#qf input, #qf textarea, #eMsg, #eNotes').forEach(el => el.addEventListener('input', () => { S.enqTyping = true; }));
  app.querySelector('#est').onchange = ev => enqSave(e.id, {status: ev.target.value}, 'Status changed to ' + ENQ_STATUS[ev.target.value]);
  const notes = app.querySelector('#eNotes');
  notes.onchange = async () => { if (await enqSave(e.id, {notes: notes.value})) app.querySelector('#eNoteSaved').textContent = 'Notes saved'; };
  const saveQuotes = async (list, patch, msg) => { if (await enqSave(e.id, {quotes: list, ...patch}, msg)) viewEnquiry(); };
  app.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => saveQuotes(qs.map((q, i) => ({...q, accepted: i === +b.dataset.acc})), {status: 'confirmed'}, 'Marked as accepted'));
  app.querySelectorAll('[data-delq]').forEach(b => b.onclick = () => saveQuotes(qs.filter((_, i) => i !== +b.dataset.delq), qs.length === 1 ? {status: 'new'} : {}, 'Quote removed'));
  app.querySelector('#qf').onsubmit = ev => {
    ev.preventDefault();
    const price = app.querySelector('#qPrice').value, inc = app.querySelector('#qInc').value.trim(), err = app.querySelector('#qErr');
    if (!(P(price) > 0)) { err.textContent = 'Add the total price.'; err.hidden = false; return; }
    if (!inc) { err.textContent = "Add what's included."; err.hidden = false; return; }
    saveQuotes([...qs, {date: today(), price: (P(price) / 100).toFixed(2), delivery: P(app.querySelector('#qDel').value) ? (P(app.querySelector('#qDel').value) / 100).toFixed(2) : '', includes: inc, note: app.querySelector('#qNote').value.trim(), qty: enqQty(e)}], {status: 'quoted'}, 'Quote saved. The reply message has been updated.');
  };
  app.querySelector('#ePrice').onclick = () => {
    const style = ['logo', 'image'].includes(r.product) ? 'Logo / photo topper' : r.product === 'box' ? 'Simple fondant' : 'Hand-piped design';
    S.pq = {...S.pq, lines: [{style, qty: enqQty(e), topper: style === 'Logo / photo topper' ? 'Toppers 12 x 7cm' : 'No toppers'}], wrapped: r.wrap === 'yes',
      delivery: r.receive === 'deliver' ? 'Personal delivery' : r.receive === 'post' ? 'Royal Mail – small' : 'Collection', postcode: r.receive === 'deliver' ? (r.postcode || '') : '', miles: '', driveMins: '', congestion: false, shapes: '', customCutter: r.b_stamp === 'Yes'};
    S.enqQuoting = e.id; location.hash = '#price';
  };
  const msg = () => app.querySelector('#eMsg').value;
  app.querySelector('#eMail')?.addEventListener('click', () => { location.href = 'mailto:' + encodeURIComponent(e.email) + '?subject=' + encodeURIComponent("Your quote from Tina's Bespoke Treats") + '&body=' + encodeURIComponent(msg()); if (st === 'new' && qs.length) enqSave(e.id, {status: 'quoted'}); });
  app.querySelector('#eGmail')?.addEventListener('click', () => { window.open('https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(e.email) + '&su=' + encodeURIComponent("Your quote from Tina's Bespoke Treats") + '&body=' + encodeURIComponent(msg()), '_blank', 'noopener'); if (st === 'new' && qs.length) enqSave(e.id, {status: 'quoted'}); });
  app.querySelector('#eWa')?.addEventListener('click', () => { window.open('https://wa.me/' + waNumber(e.phone) + '?text=' + encodeURIComponent(msg()), '_blank', 'noopener'); if (st === 'new' && qs.length) enqSave(e.id, {status: 'quoted'}); });
  app.querySelector('#eCopy').onclick = async () => { try { await navigator.clipboard.writeText(msg()); toast('Message copied. Paste it into their Instagram messages.'); } catch (x) { const t = app.querySelector('#eMsg'); t.select(); toast('Select the message and copy it.'); } };
  const payPick = app.querySelector('#payPick');
  payPick.onchange = async () => {
    const f = payPick.files[0]; if (!f) return;
    try { const blob = await shrink(f), path = 'settings/payment-details-' + crypto.randomUUID() + '.jpg'; await TB.uploadTo(ENQ_BUCKET, path, blob);
      const old = S.payImage; await TB.put('expenses', PAY_ID, {path}); S.payImage = path; if (old) TB.removeFrom(ENQ_BUCKET, [old]).catch(() => {}); toast('Payment details picture saved'); viewEnquiry(); }
    catch (x) { toast("The picture didn't save. Check your connection and try again."); }
  };
  if (S.payImage) {
    let payBlob = null;
    TB.signedFrom(ENQ_BUCKET, [S.payImage]).then(async m => { const u = m[S.payImage]; if (!u) return; app.querySelector('#payImg').src = u; payBlob = await (await fetch(u)).blob(); }).catch(() => {});
    const payFile = () => payBlob && new File([payBlob], "Tina's Bespoke Treats payment details.jpg", {type: 'image/jpeg'});
    app.querySelector('#payImg').onclick = ev => ev.target.src && lightbox(ev.target.src);
    app.querySelector('#payDl').onclick = () => { const f = payFile(); if (!f) return toast('The picture is still loading. Try again in a moment.'); const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    app.querySelector('#payShare').onclick = async () => {
      const f = payFile(); if (!f) return toast('The picture is still loading. Try again in a moment.');
      const data = {text: msg(), files: [f]};
      if (navigator.canShare && navigator.canShare(data)) { try { await navigator.share(data); if (st === 'new' && qs.length) enqSave(e.id, {status: 'quoted'}); } catch (x) {} }
      else toast("Sharing a picture works on your phone. On a laptop, press Save picture and attach it to your email.");
    };
  }
  app.querySelector('#eOrderOpen')?.addEventListener('click', () => { S.open = e.order_id; location.hash = '#order'; });
  app.querySelector('#eOrder')?.addEventListener('click', () => {
    const q = qs.filter(x => x.accepted).pop() || qs[qs.length - 1];
    const ful = {collect: 'collection', post: 'post', deliver: 'delivery'}[r.receive] || '';
    const deliveryFee = q && P(q.delivery) ? (P(q.delivery) / 100).toFixed(2) : '';
    const d = {
      customerName: e.name || '', email: e.email || '', phone: e.phone || '', instagram: insta ? insta[1] : '', eventDate: e.date_needed || '',
      biscuits: true, biscuitQty: (q && q.qty) || enqQty(e), price: q ? ((P(q.price) - P(q.delivery)) / 100).toFixed(2) : '',
      details: [e.product, q && 'Quote: ' + q.includes, r.c_theme && 'Theme: ' + r.c_theme, r.x_theme && 'Theme: ' + r.x_theme, r.c_persText && 'Personalisation: ' + r.c_persText, r.b_details, r.l_shape && 'Shape: ' + r.l_shape + (r.l_custom ? ' (' + r.l_custom + ')' : ''), r.i_shape && 'Shape: ' + r.i_shape, r.i_pipe && 'Piping: ' + r.i_pipe, r.bpackText && 'Packaging: ' + r.bpackText, r.c_more || r.l_more || r.i_more || r.x_more, r.extra].filter(Boolean).join('\n'),
      colourScheme: r.c_colours || r.x_pref || '', allergies: allergy, cellophane: r.wrap === 'yes', bow: r.wrap === 'yes' ? (r.bow === 'yes' ? 'with' : 'without') : '', bowColour: r.bowColour || '',
      fulfilment: ful, deliveryFee, deliveryAddress: ful === 'post' || ful === 'delivery' ? enqAddress(r) : '',
      deliveryDate: ful === 'delivery' ? (r.deliverDate || '') : '', collectionDate: ful === 'collection' ? (r.collectDate || '') : ''};
    try { localStorage.setItem(DRAFT, JSON.stringify(d)); localStorage.setItem(FROM_ENQ, e.id); } catch (x) {}
    location.hash = '#new-order'; toast('Customer and quote added. Check the details, then save the order.');
  });
  app.querySelector('#eDel').onclick = () => { app.querySelector('#edelrow').innerHTML = `<span>Delete this enquiry and its photos for good?</span><button class="danger" id="edelyes">Yes, delete it</button><button id="edelno">Keep it</button>`;
    app.querySelector('#edelno').onclick = viewEnquiry;
    app.querySelector('#edelyes').onclick = async () => { try { await TB.del('enquiries', e.id); TB.removeFrom(ENQ_BUCKET, files.map(f => f.path)).catch(() => {}); S.enquiries = S.enquiries.filter(x => x.id !== e.id); location.hash = '#enquiries'; toast('Enquiry deleted'); } catch (x) { toast("That didn't delete. Try again."); } }; };
}

function viewEnquiryNew() {
  const pics = [];
  app.innerHTML = `<p><a href="#enquiries">&larr; All enquiries</a></p><h2>Quick add an enquiry</h2>
  <p class="hint">For enquiries from Instagram, WhatsApp, email or phone. Paste their message and add screenshots, so everything is in one place.</p>
  <form id="nf" class="grid" novalidate>
    ${field('nName', '', 'Customer name')}
    <div class="f"><label for="nSrc">How did they get in touch?</label><select id="nSrc">${Object.entries(ENQ_SOURCES).filter(([k]) => k !== 'website').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    ${field('nInsta', '', 'Instagram name (optional)')}${field('nPhone', '', 'Phone or WhatsApp number (optional)', 'tel')}${field('nEmail', '', 'Email (optional)', 'email')}
    <div class="f"><label for="nProd">What do they want?</label><select id="nProd">${ENQ_PRODUCTS.map(p => `<option>${p}</option>`).join('')}</select></div>
    ${field('nDate', '', 'Date they need it (optional)', 'date')}${field('nQty', '', 'How many (optional)', 'number')}
    <div class="f" style="grid-column:1/-1"><label for="nMsg">Their message</label><textarea id="nMsg" rows="6" placeholder="Paste or type what they asked for"></textarea></div>
    <div class="f" style="grid-column:1/-1"><span class="lbl">Screenshots or inspiration photos (optional)</span><div class="row"><label class="btn" for="nPick" tabindex="0">Add photos</label><input type="file" id="nPick" accept="image/*" multiple hidden><span class="muted small" id="nCount"></span></div><div class="thumbs" id="nThumbs"></div></div>
    <p class="err" id="nErr" role="alert" hidden></p>
    <div class="row"><button class="primary" type="submit" id="nSave">Save enquiry</button><a class="btn" href="#enquiries">Cancel</a></div>
  </form>`;
  const pick = app.querySelector('#nPick'), th = app.querySelector('#nThumbs');
  const draw = () => { th.innerHTML = ''; pics.forEach((f, i) => { const w = document.createElement('div'); w.className = 'thumb'; const im = new Image(); im.src = URL.createObjectURL(f); im.alt = ''; const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.className = 'qx'; x.setAttribute('aria-label', 'Remove photo'); x.onclick = () => { pics.splice(i, 1); draw(); }; w.append(im, x); th.append(w); }); app.querySelector('#nCount').textContent = pics.length ? pics.length + ' added' : ''; };
  pick.onchange = () => { [...pick.files].slice(0, 10 - pics.length).forEach(f => pics.push(f)); pick.value = ''; draw(); };
  app.querySelector('#nf').onsubmit = async ev => {
    ev.preventDefault();
    const v = id => app.querySelector('#' + id).value.trim(), err = app.querySelector('#nErr'), btn = app.querySelector('#nSave');
    if (!v('nName')) { err.textContent = "Add the customer's name."; err.hidden = false; return; }
    if (!S.db || S.failed) { err.textContent = "This can't save right now. Check your connection."; err.hidden = false; return; }
    btn.disabled = true; err.hidden = true;
    const id = crypto.randomUUID(), files = [];
    try {
      for (let i = 0; i < pics.length; i++) { btn.textContent = `Uploading photo ${i + 1} of ${pics.length}…`; const blob = await shrink(pics[i]); const path = `${id}/${i + 1}.jpg`; await TB.uploadTo(ENQ_BUCKET, path, blob); files.push({path, name: pics[i].name, label: 'Screenshot'}); }
      const src = v('nSrc'), rows = [['How they got in touch', ENQ_SOURCES[src]], v('nInsta') && ['Instagram', v('nInsta')], v('nQty') && ['Quantity', v('nQty')], v('nMsg') && ['Message', v('nMsg')]].filter(Boolean);
      await TB.insertRow('enquiries', {id, source: src, status: 'new', name: v('nName'), email: v('nEmail') || null, phone: v('nPhone') || null, product: v('nProd'), date_needed: v('nDate') || null, event: '', answers: [{title: 'Their enquiry', rows}], files, raw: {product: {'Custom biscuits': 'custom', 'Branded biscuits': 'branded', 'Edible logo or artwork biscuits': 'logo', 'Edible image (photo) biscuits': 'image', 'Biscuit decorating activity box': 'box'}[v('nProd')] || '', c_qty: v('nQty'), b_qty: v('nQty'), l_qty: v('nQty'), i_qty: v('nQty')}, quotes: []});
      await loadEnquiries(); S.enqOpen = id; toast('Enquiry saved'); location.hash = '#enquiry/' + id;
    } catch (x) { btn.disabled = false; btn.textContent = 'Save enquiry'; err.textContent = "That didn't save. Check your connection and press Save again."; err.hidden = false; }
  };
}

/* price an order */
S.pq = {lines: [{style: 'Logo / photo topper', qty: '', topper: 'Toppers 12 x 7cm'}], wrapped: false, delivery: 'Collection', shapes: '', customCutter: false, postcode: '', miles: '', driveMins: '', congestion: false, petrol: PRICING.car.petrol, mpg: PRICING.car.mpg};
const CAR = 'tina-car';
try { const c = JSON.parse(localStorage.getItem(CAR)) || {}; if (c.petrol > 0) S.pq.petrol = c.petrol; if (c.mpg > 0) S.pq.mpg = c.mpg; } catch (e) {}
const homeAt = {};
async function postcodeAt(p) {
  const r = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(p.replace(/\s+/g, '')));
  if (r.status === 404) { const e = new Error('not found'); e.code = 'nf'; throw e; }
  if (!r.ok) throw new Error('lookup');
  const d = (await r.json()).result; return {lat: d.latitude, lon: d.longitude, postcode: d.postcode};
}
const mapsUrl = pc => 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(PRICING.car.home) + '&destination=' + encodeURIComponent(PRICING.car.home) + '&waypoints=' + encodeURIComponent(pc);
const TIER_NAMES = ['6–49', '50–99', '100–199', '200+'];
function viewPrice() {
  const q = S.pq, opt = (list, v) => list.map(x => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc(x === 'Personal delivery' ? 'Personal delivery (from ' + gbp(PRICING.car.minCharge).replace('.00', '') + ')' : x)}</option>`).join('');
  const styles = Object.keys(PRICING.styles), toppers = ['No toppers', ...Object.keys(PRICING.toppers)];
  app.innerHTML = `<h2>Price an order</h2>
  <p class="hint">Fill in the boxes below. The answer appears underneath — no maths needed.</p>
  <form id="pf" novalidate>
  <fieldset><legend>Biscuits</legend>
    <div class="full lines" id="qlines"></div>
    <div class="full"><button type="button" id="qadd">Add another style</button></div>
  </fieldset>
  <fieldset><legend>Extras</legend>
    <label class="tick full"><input type="checkbox" id="qwrap" ${q.wrapped ? 'checked' : ''}>Individually wrapped with a bow (${gbp(PRICING.wrap)} each)</label>
    <div class="f"><label for="qdel">Delivery</label><select id="qdel">${opt(Object.keys(PRICING.delivery), q.delivery)}</select></div>
    <div id="qcar" class="full qcar" ${q.delivery === 'Personal delivery' ? '' : 'hidden'}>
      <div class="f"><label for="qpc">Delivery postcode</label><div class="row" style="flex-wrap:nowrap"><input type="text" id="qpc" autocomplete="off" autocapitalize="characters" placeholder="e.g. EN1 3PL" value="${esc(q.postcode)}" style="flex:1 1 auto"><button type="button" id="qfind">Work out miles</button></div></div>
      <div class="f"><label for="qmiles">Miles there and back</label><input type="number" id="qmiles" min="0" step="0.1" inputmode="decimal" value="${esc(q.miles)}"><span class="hint" id="qmhint">From ${esc(PRICING.car.home)} to the customer and back. You can type your own miles.</span></div>
      <div class="f"><label for="qmins">Minutes driving there</label><input type="number" id="qmins" min="0" step="1" inputmode="numeric" value="${esc(q.driveMins)}"><span class="hint">One way. The customer pays ${gbp(PRICING.car.perHour)} an hour for the drive there, plus ${PRICING.car.perMile}p a mile there and back. You can type your own time.</span></div>
      <label class="tick full"><input type="checkbox" id="qcc" ${q.congestion ? 'checked' : ''}>Add the London Congestion Charge (${gbp(PRICING.car.congestion)}). Weekdays 7am to 6pm, weekends and bank holidays 12pm to 6pm.</label>
      <p class="err" id="qcarErr" role="alert" hidden></p>
      <div class="f"><label for="qpetrol">Petrol price per litre</label><div class="money"><input type="number" id="qpetrol" min="0" step="0.01" inputmode="decimal" value="${(q.petrol / 100).toFixed(2)}"></div></div>
      <div class="f"><label for="qmpg">Your car's miles per gallon</label><input type="number" id="qmpg" min="1" step="1" inputmode="numeric" value="${esc(q.mpg)}"><span class="hint">Remembered on this device.</span></div>
    </div>
    <div class="f"><label for="qshapes">Shapes you don't have a cutter for</label><input type="number" id="qshapes" min="0" step="1" inputmode="numeric" value="${esc(q.shapes)}"><span class="hint">${gbp(PRICING.firstCutter)} for the first, ${gbp(PRICING.extraCutter)} each after</span></div>
    <label class="tick full"><input type="checkbox" id="qcustom" ${q.customCutter ? 'checked' : ''}>Custom cutter or stamp (${gbp(PRICING.customCutter)})</label>
  </fieldset>
  </form>
  <div id="qres" class="stack"></div>`;
  const box = app.querySelector('#qlines');
  const drawLines = () => {
    box.innerHTML = q.lines.map((l, i) => `<div class="qline" data-i="${i}">
      <div class="f"><label for="qs${i}">Style</label><select id="qs${i}" data-k="style">${opt(styles, l.style)}</select></div>
      <div class="f"><label for="qn${i}">How many</label><input type="number" id="qn${i}" data-k="qty" min="0" step="1" inputmode="numeric" value="${esc(l.qty)}"></div>
      <div class="f"><label for="qt${i}">Toppers</label><select id="qt${i}" data-k="topper">${opt(toppers, l.topper)}</select></div>
      ${q.lines.length > 1 ? `<button type="button" class="qx" data-x="${i}" aria-label="Remove this style">✕</button>` : '<span></span>'}</div>`).join('');
  };
  drawLines(); showQuote();
  const f = app.querySelector('#pf');
  f.addEventListener('input', e => { const ln = e.target.closest('.qline');
    if (ln) q.lines[ln.dataset.i][e.target.dataset.k] = e.target.value;
    q.wrapped = f.querySelector('#qwrap').checked; q.delivery = f.querySelector('#qdel').value; q.shapes = f.querySelector('#qshapes').value; q.customCutter = f.querySelector('#qcustom').checked;
    f.querySelector('#qcar').hidden = q.delivery !== 'Personal delivery';
    q.postcode = f.querySelector('#qpc').value; q.miles = f.querySelector('#qmiles').value; q.driveMins = f.querySelector('#qmins').value; q.congestion = f.querySelector('#qcc').checked;
    const pt = Math.round(parseFloat(f.querySelector('#qpetrol').value) * 100), mg = parseFloat(f.querySelector('#qmpg').value);
    q.petrol = pt > 0 ? pt : PRICING.car.petrol; q.mpg = mg > 0 ? mg : PRICING.car.mpg;
    if (e.target.id === 'qpetrol' || e.target.id === 'qmpg') { try { localStorage.setItem(CAR, JSON.stringify({petrol: q.petrol, mpg: q.mpg})); } catch (x) {} }
    showQuote(); });
  f.addEventListener('change', e => { if (e.target.type !== 'number') f.dispatchEvent(new Event('input')); });
  const findMiles = async () => {
    const err = f.querySelector('#qcarErr'), btn = f.querySelector('#qfind'), pc = f.querySelector('#qpc').value.trim(); err.hidden = true;
    if (!pc) { err.textContent = 'Type the delivery postcode first.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Working it out…';
    try {
      homeAt.v ||= await postcodeAt(PRICING.car.home);
      const dest = await postcodeAt(pc), miles = roundTripMiles(homeAt.v, dest), inZone = inCongestionZone(dest);
      f.querySelector('#qpc').value = dest.postcode; f.querySelector('#qmiles').value = miles;
      f.querySelector('#qmins').value = driveMinsThere(homeAt.v, dest); f.querySelector('#qcc').checked = inZone;
      f.querySelector('#qmhint').innerHTML = `About ${miles} miles from ${esc(PRICING.car.home)} to ${esc(dest.postcode)} and back. <a href="${esc(mapsUrl(dest.postcode))}" target="_blank" rel="noopener">Check the route on Google Maps</a> and type the exact miles if you like.${inZone ? ' <b>This address is in the Congestion Charge zone</b>, so the charge has been ticked. Untick it if you deliver outside charging hours.' : ''}`;
      f.dispatchEvent(new Event('input'));
    } catch (x) { err.textContent = x.code === 'nf' ? "That postcode wasn't found. Check it and try again." : "The miles couldn't be worked out. Check your connection, or type the miles yourself."; err.hidden = false; }
    btn.disabled = false; btn.textContent = 'Work out miles';
  };
  f.querySelector('#qfind').onclick = findMiles;
  if (S.enqQuoting && q.postcode && !q.miles) findMiles();
  f.querySelector('#qpc').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findMiles(); } });
  f.querySelector('#qadd').onclick = () => { q.lines.push({style: 'Simple fondant', qty: '', topper: 'No toppers'}); drawLines(); showQuote(); box.querySelector(`#qn${q.lines.length - 1}`).focus(); };
  box.addEventListener('click', e => { const x = e.target.closest('[data-x]'); if (!x) return; q.lines.splice(+x.dataset.x, 1); drawLines(); showQuote(); });
}
function showQuote() {
  const q = S.pq, r = quote(q), out = app.querySelector('#qres'), key = JSON.stringify(q); if (!out || out.dataset.key === key) return; out.dataset.key = key;
  const wasOpen = !!out.querySelector('details.howto[open]');
  if (!r.n) { out.innerHTML = `<div class="empty">Type how many biscuits to see the price.</div>`; return; }
  const row = (k, v, cls = '') => `<div class="${cls}"><span>${k}</span><span>${v}</span></div>`;
  const timeTxt = mins => { const m = Math.max(5, Math.round(mins / 5) * 5), h = Math.floor(m / 60), r = m % 60; return [h && h + (h === 1 ? ' hour' : ' hours'), r && r + ' mins'].filter(Boolean).join(' '); };
  const pounds0 = p => '£' + Math.round(p / 100);
  const verdict = {min: ['bad', `The smallest order you take is ${PRICING.minOrder} biscuits.`],
    good: ['good', `✓ This is a good price.`],
    low: ['warn', `⚠ This price is too low for the work. Try charging more.`]}[r.verdict];
  const boxTxt = [r.boxes.big && r.boxes.big + ' big', r.boxes.large && r.boxes.large + ' large', r.boxes.small && r.boxes.small + ' small'].filter(Boolean).join(', ');
  const sheetTxt = r.sheets.map(s => s.sheets + ' × ' + s.topper.replace('Toppers ', '')).join(', ');
  out.innerHTML = `${r.drive && !r.drive.miles ? '<div class="notice warn"><span>Type the delivery postcode and press <b>Work out miles</b> to add the delivery.</span></div>' : ''}
  <section class="answer" aria-label="The answer">
    <div class="ans-main"><span>Charge the customer</span><b id="ansCharge">${gbp(r.charge.total)}</b></div>
    <div class="ans-row"><span>Payment to confirm the order</span><b id="ansDeposit">${gbp(r.charge.total)}</b></div>
    <div class="ans-row"><span>It costs you</span><b id="ansCost">${gbp(r.cost.total)}</b></div>
    <div class="ans-row keep"><span>You keep</span><b id="ansKeep" class="${r.profit < 0 ? 'neg' : ''}">${gbp(r.profit)}</b></div>
    <div class="ans-row"><span>Time it will take</span><b id="ansTime">${timeTxt(r.minutes)}</b></div>
    <p class="notice ${verdict[0]}"><span><b>${verdict[1]}</b>${r.verdict === 'min' ? '' : ` You earn about ${pounds0(r.perHour)} for every hour you work.`}</span></p>
  </section>
  <div class="row">${S.enqQuoting ? `<button class="primary big-btn" id="qsaveq" type="button">Save as a quote for ${esc((S.enquiries.find(x => x.id === S.enqQuoting) || {}).name || 'this enquiry')}</button>` : ''}<button class="${S.enqQuoting ? '' : 'primary '}big-btn" id="qorder" type="button">Start an order with these figures</button></div>
  <details class="howto"><summary>Show how this was worked out</summary><div class="stack">
  <section class="card"><h3>What the customer pays</h3><div class="total">
    ${r.lines.map(l => row(`${l.qty} × ${esc(l.style)} at ${gbp(l.price)}`, gbp(l.total))).join('')}
    ${r.charge.wrapping ? row('Individual wrapping', gbp(r.charge.wrapping)) : ''}${r.charge.cutters ? row('Cutters', gbp(r.charge.cutters)) : ''}${r.charge.delivery ? row(r.drive ? `Personal delivery (${r.drive.mins} mins each way, ${r.drive.miles} miles there and back${r.drive.congestion ? ', including ' + gbp(PRICING.car.congestion) + ' Congestion Charge' : ''})` : esc(q.delivery), gbp(r.charge.delivery)) : ''}
    ${row('Total to charge', gbp(r.charge.total), 'big')}${row('Paid in full to confirm', gbp(r.charge.total))}</div>
    <p class="hint">${r.n} biscuits, so the ${TIER_NAMES[r.tier]} biscuits price is used.</p></section>
  <section class="card"><h3>What it costs you</h3><div class="total">
    ${row('Ingredients (biscuit and icing)', gbp(r.cost.ingredients))}${r.cost.toppers ? row(`Toppers (buy ${esc(sheetTxt)})`, gbp(r.cost.toppers)) : ''}
    ${row(`Boxes (${boxTxt})`, gbp(r.cost.boxes))}${r.cost.bagsBows ? row('Bows', gbp(r.cost.bagsBows)) : ''}
    ${r.cost.cutters ? row('Cutters', gbp(r.cost.cutters)) : ''}${r.cost.postage ? row(r.drive ? `Petrol (${r.drive.miles} miles at ${(r.drive.perMile).toFixed(1)}p a mile)${r.drive.congestion ? ' and Congestion Charge' : ''}` : 'Postage', gbp(r.cost.postage)) : ''}
    ${row('Total costs', gbp(r.cost.total), 'big')}${row('Profit (money you keep)', `<span class="${r.profit < 0 ? 'neg' : ''}">${gbp(r.profit)}</span>`, 'big')}</div></section>
  </div></details>`;
  if (wasOpen) out.querySelector('details.howto').open = true;
  out.querySelector('#qsaveq')?.addEventListener('click', async () => {
    const id = S.enqQuoting, e = S.enquiries.find(x => x.id === id); if (!e) return;
    const pounds = p => (p / 100).toFixed(2);
    const how = r.drive ? 'hand delivery' + (r.drive.congestion ? ' (including the Congestion Charge)' : '') : q.delivery === 'Collection' ? 'collection from Edmonton' : q.delivery.startsWith('Royal Mail') ? 'Royal Mail Tracked 24 postage' : q.delivery.toLowerCase();
    const includes = [r.lines.map(l => `${l.qty} × ${l.style.toLowerCase()} biscuits`).join(', ') + (q.wrapped ? ', individually wrapped with a bow' : ''), r.charge.cutters ? 'custom cutters' : '', how].filter(Boolean).join(', ');
    const quote = {date: today(), price: pounds(r.charge.total), delivery: r.charge.delivery ? pounds(r.charge.delivery) : '', includes: includes.charAt(0).toUpperCase() + includes.slice(1), note: '', qty: String(r.n)};
    if (await enqSave(id, {quotes: [...(e.quotes || []), quote], status: 'quoted'}, 'Quote saved. Check the reply message, then send it.')) { S.enqQuoting = null; location.hash = '#enquiry/' + id; }
  });
  out.querySelector('#qorder').onclick = () => {
    let d = {}; try { d = JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch (e) {}
    const pounds = p => (p / 100).toFixed(2), post = r.charge.delivery > 0;
    Object.assign(d, {biscuits: true, biscuitQty: String(r.n), price: pounds(r.charge.total - r.charge.delivery),
      details: [r.lines.map(l => `${l.qty} × ${l.style}${PRICING.toppers[l.topper] ? ' (' + l.topper + ')' : ''}`).join('\n'), d.details].filter(Boolean).join('\n\n'),
      cellophane: !!q.wrapped, bow: q.wrapped ? 'with' : (d.bow || ''),
      fulfilment: post ? (r.drive ? 'delivery' : 'post') : (d.fulfilment || 'collection'), deliveryFee: post ? pounds(r.charge.delivery) : '',
      deliveryAddress: d.deliveryAddress || (r.drive && q.postcode ? q.postcode.toUpperCase() : ''),
      costs: [['Ingredients', r.cost.ingredients], ['Toppers' + (sheetTxt ? ' (' + sheetTxt + ')' : ''), r.cost.toppers], ['Boxes (' + boxTxt + ')', r.cost.boxes], ['Bows', r.cost.bagsBows], ['Cutters', r.cost.cutters], [r.drive ? `Petrol (${r.drive.miles} miles)` : 'Postage', r.cost.postage]]
        .filter(([, a]) => a).map(([item, a]) => ({item, amount: pounds(a)}))});
    try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch (e) {}
    location.hash = '#new-order'; toast('Prices added. Fill in the customer and dates.');
  };
}

function moneyInput(id, v, label, hint = '') { return `<div class="f"><label for="${id}">${label}</label><div class="money"><input type="number" inputmode="decimal" step="0.01" min="0" id="${id}" name="${id}" value="${esc(v)}"></div>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`; }
function field(id, v, label, type = 'text', hint = '') { return `<div class="f"><label for="${id}">${label}</label><input type="${type}" id="${id}" name="${id}" value="${esc(v)}">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`; }

function viewForm(o) {
  const editing = !!o.id, pay = o.balancePaid ? 'paid' : P(o.deposit) > 0 ? 'deposit' : 'none';
  // Older orders kept the post date apart from delivery: show those as Postage.
  const ful = o.postDate && (!o.fulfilment || (o.fulfilment === 'delivery' && !o.deliveryDate && !o.deliveryTime)) ? 'post' : o.fulfilment;
  S.dirty = false;
  app.innerHTML = `${dataNote().includes('bad') ? dataNote() : ''}<h2>${editing ? 'Edit ' + esc(o.customerName) : 'New order'}</h2>
  <form id="f" novalidate>
  <fieldset><legend>Type of order</legend>
    <div class="f full"><div class="choices"><label class="tick"><input type="radio" name="orderType" id="otOrder" value="order" ${o.orderType !== 'sample' ? 'checked' : ''}>Normal order</label><label class="tick"><input type="radio" name="orderType" id="otSample" value="sample" ${o.orderType === 'sample' ? 'checked' : ''}>Sample box only</label></div>
    <p class="hint" id="sampleHint" ${o.orderType === 'sample' ? '' : 'hidden'}>A sample box is ${PRICING.sample.qty} logo biscuits for ${gbp(PRICING.sample.price)}. The price and costs are filled in for you. If they book a full order, take ${gbp(PRICING.sample.price)} off it.</p></div>
  </fieldset>
  <fieldset><legend>Customer</legend>
    <div class="full">${field('customerName', o.customerName, 'Name')}<div id="nameHits" class="suggest" hidden></div></div>${field('email', o.email, 'Email', 'email')}${field('instagram', o.instagram, 'Instagram', 'text', 'Their username, e.g. @name')}${field('phone', o.phone, 'Phone number', 'tel')}
  </fieldset>
  <fieldset><legend>Dates</legend>
    ${field('eventDate', o.eventDate, 'Date of event', 'date')}${field('makeDate', o.makeDate, 'Date I need to make these', 'date')}
  </fieldset>
  <fieldset><legend>The order</legend>
    <div class="f"><label class="tick"><input type="checkbox" id="biscuits" name="biscuits" ${o.biscuits ? 'checked' : ''}>Biscuits</label><label class="lab" for="biscuitQty">Quantity</label><input type="number" min="0" step="1" inputmode="numeric" id="biscuitQty" name="biscuitQty" value="${esc(o.biscuitQty)}"></div>
    <div class="f"><label class="tick"><input type="checkbox" id="cupcakes" name="cupcakes" ${o.cupcakes ? 'checked' : ''}>Cupcakes</label><label class="lab" for="cupcakeQty">Quantity</label><input type="number" min="0" step="1" inputmode="numeric" id="cupcakeQty" name="cupcakeQty" value="${esc(o.cupcakeQty)}"></div>
    <div class="f full"><label for="details">Theme, design and ideas</label><textarea id="details" name="details">${esc(o.details)}</textarea></div>
    <div class="full">${field('colourScheme', o.colourScheme, 'Colour scheme')}</div>${field('allergies', o.allergies, 'Allergies', 'text', 'Shown in red everywhere this order appears.')}${field('dietary', o.dietary, 'Dietary preference', 'text', 'For example vegan, vegetarian or halal')}
  </fieldset>
  <fieldset><legend>Images</legend>
    <div class="f full"><span class="hint" id="imgCount"></span><div class="thumbs" id="imgGrid"></div>
      <div class="row"><label class="btn" for="imgPick" id="imgAdd" tabindex="0">Add images</label><input type="file" id="imgPick" accept="image/*" multiple hidden></div>
      <p class="err" id="imgErr" hidden></p></div>
  </fieldset>
  <fieldset><legend>Packaging</legend>
    <label class="tick"><input type="checkbox" id="cellophane" name="cellophane" ${o.cellophane ? 'checked' : ''}>Wrapped in cellophane</label>
    <div class="f"><span class="lab">Bow</span><div class="choices"><label class="tick"><input type="radio" name="bow" id="bowWith" value="with" ${o.bow === 'with' ? 'checked' : ''}>With a bow</label><label class="tick"><input type="radio" name="bow" id="bowWithout" value="without" ${o.bow === 'without' ? 'checked' : ''}>Without a bow</label></div></div>
    <div id="bowBox" class="full">${field('bowColour', o.bowColour, 'Bow colour')}</div>
  </fieldset>
  <fieldset><legend>Delivery</legend>
    <div class="f full"><div class="choices"><label class="tick"><input type="radio" name="fulfilment" id="fDel" value="delivery" ${ful === 'delivery' ? 'checked' : ''}>Hand delivery</label><label class="tick"><input type="radio" name="fulfilment" id="fPost" value="post" ${ful === 'post' ? 'checked' : ''}>Postage</label><label class="tick"><input type="radio" name="fulfilment" id="fCol" value="collection" ${ful === 'collection' ? 'checked' : ''}>Collection</label></div></div>
    <div id="sendBox" class="full" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      <div class="f" style="grid-column:1/-1"><label for="deliveryAddress">Address</label><textarea id="deliveryAddress" name="deliveryAddress" style="min-height:70px">${esc(o.deliveryAddress)}</textarea></div>
      <div id="handBox" style="display:contents">${field('deliveryDate', o.deliveryDate, 'Date to be delivered', 'date', 'Leave blank for the event date')}${field('deliveryTime', o.deliveryTime, 'Time to be delivered', 'time')}<div style="grid-column:1/-1">${field('deliveryLocation', o.deliveryLocation, 'Location', 'text', 'Venue, room or drop-off point')}</div></div>
      <div id="postBox" style="display:contents">${field('postDate', o.postDate, 'Date to be posted', 'date')}${field('postTime', o.postTime, 'Time to be posted', 'time')}<div style="grid-column:1/-1">${field('trackingNumber', o.trackingNumber, 'Tracking number', 'text', 'From the Royal Mail receipt. You can add it after posting.')}</div></div>
    </div>
    <div id="colBox" class="full" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      ${field('collectionDate', o.collectionDate, 'Collection date', 'date', 'Leave blank for the event date')}${field('collectionTime', o.collectionTime, 'Collection time', 'time')}
    </div>
  </fieldset>
  <fieldset><legend>Payment</legend>
    ${moneyInput('price', o.price, 'Total cost of treats', 'Without delivery')}
    <div id="feeBox">${moneyInput('deliveryFee', o.deliveryFee, 'Delivery charge')}</div>
    <div class="f full"><span class="lab">Has the customer paid?</span><div class="choices">
      <label class="tick"><input type="radio" name="payment" id="payNone" value="none" ${pay === 'none' ? 'checked' : ''}>Not paid yet</label>
      <label class="tick"><input type="radio" name="payment" id="payDeposit" value="deposit" ${pay === 'deposit' ? 'checked' : ''}>Deposit paid</label>
      <label class="tick"><input type="radio" name="payment" id="payFull" value="paid" ${pay === 'paid' ? 'checked' : ''}>Paid in full</label>
    </div></div>
    <div id="depBox" class="full" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      ${moneyInput('deposit', o.deposit, 'Deposit amount')}${field('depositDate', o.depositDate || today(), 'Date deposit was paid', 'date')}
    </div>
    <div id="paidBox" class="full">${field('paidDate', o.balancePaidDate || today(), 'Date paid in full', 'date')}</div>
    <p class="hint full" id="dueHint"></p>
  </fieldset>
  <fieldset><legend>Expenses for this order</legend>
    <div class="full lines" id="lines"></div>
    <div class="full"><button type="button" id="addLine">Add an expense</button></div>
  </fieldset>
  <div class="total" id="tot"></div>
  <p class="err" id="ferr" role="alert" hidden></p>
  <div class="bar"><button class="primary" type="submit" id="save">${editing ? 'Save changes' : 'Save order'}</button><button type="button" id="cancel">Cancel</button><span class="hint" id="drafted"></span></div>
  </form>`;
  const f = app.querySelector('#f'), linesEl = f.querySelector('#lines');
  const addLine = (c = {}) => { const d = document.createElement('div'); d.className = 'line'; const n = linesEl.children.length + Math.random().toString(36).slice(2, 6);
    d.innerHTML = `<input type="text" id="ci${n}" aria-label="Expense" placeholder="e.g. Fondant, boxes" value="${esc(c.item)}"><div class="money"><input type="number" id="ca${n}" aria-label="Amount" step="0.01" min="0" inputmode="decimal" value="${esc(c.amount)}"></div><button type="button" aria-label="Remove expense">✕</button>`;
    d.querySelector('button').onclick = () => { d.remove(); sync(); }; linesEl.append(d); };
  (o.costs?.length ? o.costs : [{}]).forEach(addLine);
  const read = () => { const d = Object.fromEntries(new FormData(f)); ['biscuits', 'cupcakes', 'cellophane'].forEach(k => d[k] = !!f[k].checked);
    d.costs = [...linesEl.children].map(l => ({item: l.querySelector('input[type=text]').value.trim(), amount: l.querySelector('input[type=number]').value})).filter(c => c.item || c.amount);
    const p = d.payment; d.balancePaid = p === 'paid'; d.balancePaidDate = p === 'paid' ? d.paidDate : '';
    if (p === 'none') { d.deposit = ''; d.depositDate = ''; }
    if (d.fulfilment !== 'post') { d.postDate = ''; d.postTime = ''; d.trackingNumber = ''; }
    d.trackingNumber = (d.trackingNumber || '').trim().toUpperCase();
    if (d.fulfilment !== 'delivery') { d.deliveryDate = ''; d.deliveryTime = ''; d.deliveryLocation = ''; }
    if (!sendsOut(d)) d.deliveryFee = '';
    delete d.paidDate; delete d.balanceDue; return d; };
  function sync() {
    const d = read(), s = sums({...o, ...d}), pm = f.querySelector('input[name=payment]:checked').value;
    f.querySelector('#depBox').style.display = pm === 'deposit' ? 'grid' : 'none';
    f.querySelector('#paidBox').hidden = pm !== 'paid';
    f.querySelector('#dueHint').textContent = pm === 'paid' ? '' : d.eventDate ? 'The rest is due on the event date, ' + fmt(d.eventDate) + '.' : 'The rest is due on the event date.';
    f.querySelector('#bowBox').hidden = d.bow !== 'with';
    f.querySelector('#sendBox').style.display = sendsOut(d) ? 'grid' : 'none';
    f.querySelector('#handBox').style.display = d.fulfilment === 'delivery' ? 'contents' : 'none';
    f.querySelector('#postBox').style.display = d.fulfilment === 'post' ? 'contents' : 'none';
    f.querySelector('#colBox').style.display = d.fulfilment === 'collection' ? 'grid' : 'none';
    f.querySelector('#feeBox').hidden = !sendsOut(d);
    f.querySelector('#feeBox label').textContent = d.fulfilment === 'post' ? 'Postage charge' : 'Delivery charge';
    f.querySelector('#tot').innerHTML = `<div class="big" style="border:0;margin:0;padding:0"><span>Order income, including delivery</span><span>${gbp(s.income)}</span></div><div><span>Expenses</span><span>${gbp(s.costs)}</span></div><div><span>Profit</span><span class="${s.profit < 0 ? 'neg' : ''}">${gbp(s.profit)}</span></div><div><span>Payment outstanding</span><span>${gbp(s.outstanding)}</span></div>`;
    return d;
  }
  sync();
  f.querySelectorAll('input[name=orderType]').forEach(r => r.addEventListener('change', () => {
    const sample = f.querySelector('#otSample').checked; f.querySelector('#sampleHint').hidden = !sample;
    if (!sample) return;
    const sp = PRICING.sample, r2 = quote({lines: [{style: sp.style, qty: sp.qty, topper: sp.topper}]}), pounds = p => (p / 100).toFixed(2);
    f.biscuits.checked = true; f.cupcakes.checked = false; f.biscuitQty.value = sp.qty; f.cupcakeQty.value = ''; f.price.value = pounds(sp.price);
    if (![...linesEl.querySelectorAll('input')].some(i => i.value)) { linesEl.replaceChildren();
      [['Ingredients', r2.cost.ingredients], ['Toppers (1 sheet of 12)', r2.cost.toppers], ['Small box', r2.cost.boxes]].forEach(([item, a]) => addLine({item, amount: pounds(a)})); }
    if (!f.details.value.trim()) f.details.value = `Sample box: ${sp.qty} logo biscuits. ${gbp(sp.price)} comes off their order if they book.`;
    f.dispatchEvent(new Event('input', {bubbles: true}));
  }));
  const imgs = {kept: [...(o.images || [])], pending: [], removed: []}, grid = f.querySelector('#imgGrid'), imgErr = f.querySelector('#imgErr');
  const thumb = (src, onRemove) => { const w = document.createElement('div'); w.className = 'thumb'; const i = new Image(); i.alt = 'Order image'; if (src) i.src = src; i.onclick = () => i.src && lightbox(i.src);
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Remove image'); x.onclick = onRemove; w.append(i, x); return [w, i]; };
  async function drawImgs() {
    grid.replaceChildren(); const n = imgs.kept.length + imgs.pending.length;
    f.querySelector('#imgCount').textContent = n + ' of ' + MAX_IMAGES + ' images. Logos, inspiration and anything else for this order.';
    f.querySelector('#imgAdd').hidden = n >= MAX_IMAGES;
    const shown = imgs.kept.map(p => { const [w, i] = thumb('', () => { imgs.kept = imgs.kept.filter(x => x !== p); imgs.removed.push(p); S.dirty = true; drawImgs(); }); grid.append(w); return [p, i]; });
    imgs.pending.forEach(it => grid.append(thumb(it.url, () => { URL.revokeObjectURL(it.url); imgs.pending = imgs.pending.filter(x => x !== it); drawImgs(); })[0]));
    if (shown.length) { try { const m = await signedUrls(imgs.kept); shown.forEach(([p, i]) => { if (m[p]) i.src = m[p]; }); } catch (e) { imgErr.textContent = "Saved images couldn't load. They're still safe."; imgErr.hidden = false; } }
  }
  drawImgs();
  f.querySelector('#imgPick').addEventListener('change', async e => {
    imgErr.hidden = true; const files = [...e.target.files], room = MAX_IMAGES - imgs.kept.length - imgs.pending.length; e.target.value = '';
    for (const file of files.slice(0, room)) { try { const blob = await shrink(file); imgs.pending.push({blob, url: URL.createObjectURL(blob)}); S.dirty = true; } catch (x) { imgErr.textContent = "One image couldn't be read. Try a JPG or PNG."; imgErr.hidden = false; } }
    if (files.length > room) { imgErr.textContent = 'You can add up to ' + MAX_IMAGES + ' images, so only the first ' + room + ' were added.'; imgErr.hidden = false; }
    drawImgs();
  });
  if (!editing) {
    const nameIn = f.querySelector('#customerName'), hits = f.querySelector('#nameHits');
    nameIn.setAttribute('autocomplete', 'off');
    const people = () => { const m = new Map();
      [...S.orders].filter(x => !x.example && x.customerName).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
        .forEach(x => m.set(x.customerName.trim().toLowerCase() + '|' + (x.email || x.instagram || x.phone || '').toLowerCase(), x));
      return [...m.values()].reverse(); };
    const showHits = () => { const q = nameIn.value.trim().toLowerCase();
      const list = q ? people().filter(x => x.customerName.toLowerCase().split(/\s+/).some(w => w.startsWith(q)) || x.customerName.toLowerCase().startsWith(q)).slice(0, 6) : [];
      hits.hidden = !list.length; hits.replaceChildren(...list.map(x => { const b = document.createElement('button'); b.type = 'button';
        b.innerHTML = `<strong>${esc(x.customerName)}</strong><span class="hint">${esc([x.instagram, x.email, x.phone].filter(Boolean).join(' · ') || 'No contact details saved')}</span>`;
        b.onclick = () => { ['customerName', 'email', 'instagram', 'phone', 'deliveryAddress', 'allergies', 'dietary'].forEach(k => { if (x[k]) f[k].value = x[k]; }); hits.hidden = true; f.dispatchEvent(new Event('input', {bubbles: true}));
          toast(x.allergies || x.dietary ? 'Details added. Check the allergies and dietary preference are still right.' : 'Customer details added'); };
        return b; })); };
    nameIn.addEventListener('input', showHits);
    nameIn.addEventListener('focus', showHits);
    nameIn.addEventListener('keydown', e => { if (e.key === 'Escape') hits.hidden = true; });
    f.addEventListener('focusin', e => { if (e.target !== nameIn && !hits.contains(e.target)) hits.hidden = true; });
  }
  f.addEventListener('input', () => { const d = sync(); S.dirty = true; if (!editing) { try { localStorage.setItem(DRAFT, JSON.stringify(d)); f.querySelector('#drafted').textContent = 'Draft kept on this device'; } catch (e) {} } });
  f.addEventListener('change', sync);
  f.querySelector('#addLine').onclick = () => addLine();
  f.querySelector('#cancel').onclick = () => { try { if (!editing) { localStorage.removeItem(DRAFT); localStorage.removeItem(FROM_ENQ); } } catch (e) {} S.dirty = false; location.hash = editing ? '#order' : '#orders'; };
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const d = read(), e = f.querySelector('#ferr'), s = sums({...o, ...d});
    const fail = m => { e.textContent = m; e.hidden = false; e.scrollIntoView({block: 'center'}); };
    if (!d.customerName.trim()) return fail("Add the customer's name to save this order.");
    if (!d.eventDate) return fail('Add the date of the event to save this order.');
    if (!d.biscuits && !d.cupcakes) return fail('Tick biscuits or cupcakes to save this order.');
    if ((d.biscuits && !d.biscuitQty) || (d.cupcakes && !d.cupcakeQty)) return fail('Add the quantity to save this order.');
    if (s.deposit > s.income) return fail(`The deposit (${gbp(s.deposit)}) is more than the order income (${gbp(s.income)}). Check both amounts.`);
    if (f.querySelector('#payDeposit').checked && !s.deposit) return fail('Add the deposit amount, or choose Not paid yet.');
    if (f.querySelector('#payDeposit').checked && !d.depositDate) return fail('Add the date the deposit was paid.');
    if (d.balancePaid && !d.balancePaidDate) return fail('Add the date the order was paid in full.');
    if (!S.db || S.failed) return fail("This can't save right now. Your entries stay on this page, so reload once you're back online.");
    const btn = f.querySelector('#save'); btn.disabled = true; e.hidden = true;
    const now = new Date().toISOString(), ref = editing ? S.db.doc('orders/' + o.id) : S.db.collection('orders').doc();
    const {id, balanceDue, ...keep} = o;
    try {
      for (const it of imgs.pending) if (!it.path) { const path = TB.uid() + '/' + ref.id + '/' + crypto.randomUUID() + '.jpg'; await TB.upload(path, it.blob); it.path = path; }
    } catch (x) { btn.disabled = false; return fail("The images didn't upload, so the order hasn't been saved. Check your connection and press Save again."); }
    try {
      await ref.set({...keep, ...d, images: [...imgs.kept, ...imgs.pending.map(i => i.path)], customerName: d.customerName.trim(), status: o.status || 'Confirmed', createdAt: o.createdAt || now, updatedAt: now});
      try { localStorage.removeItem(DRAFT); } catch (x) {}
      TB.removeFiles(imgs.removed).catch(() => {});
      try { const fe = !editing && localStorage.getItem(FROM_ENQ); if (fe) { localStorage.removeItem(FROM_ENQ); enqSave(fe, {order_id: ref.id, status: 'confirmed'}); } } catch (x) {}
      S.dirty = false; S.open = ref.id; toast('Order saved'); location.hash = '#order'; calSync([S.orders.find(x => x.id === ref.id)]);
    } catch (x) { btn.disabled = false; fail("That didn't save. Your entries are still here, so check your connection and press Save again."); }
  });
}

function viewMoney() {
  const yrs = [...new Set([S.year, today().slice(0, 4), ...S.orders.map(o => (o.eventDate || '').slice(0, 4)), ...S.expenses.map(e => (e.date || '').slice(0, 4))].filter(Boolean))].sort();
  const rows = Array.from({length: 12}, (_, i) => { const ym = S.year + '-' + String(i + 1).padStart(2, '0'); return {ym, ...month(ym, S.orders, S.expenses)}; });
  const tot = k => rows.reduce((t, r) => t + r[k], 0), m = month(S.ym, S.orders, S.expenses), name = fmt(S.ym + '-15', {month: 'long', year: 'numeric'});
  const mo = S.orders.filter(o => o.status !== 'Cancelled' && (o.eventDate || '').startsWith(S.ym));
  const inMonth = S.expenses.filter(e => (e.date || '').startsWith(S.ym)).sort((a, b) => a.date.localeCompare(b.date));
  const ex = inMonth.filter(e => !e.source), oe = inMonth.filter(e => e.source);
  S.uc ||= ucDefault(today());
  const uc = ucPeriod(S.uc.from, S.uc.to, S.orders, S.expenses), dd = d => fmt(d, {day: 'numeric', month: 'short'});
  const ucRows = (list, empty, extra) => list.length ? `<div class="total">${list.map(r => `<div><span>${dd(r.date)}${r.guessed ? ' *' : ''} · ${esc(r.what)}${extra && r.where ? ` <span class="muted">(${esc(r.where)})</span>` : ''}</span><span>${gbp(r.amount)}</span></div>`).join('')}</div>` : `<div class="empty">${empty}</div>`;
  const ucHtml = `<details class="card uc" id="ucBox"${S.ucOpen ? ' open' : ''}><summary><h3 id="ucH" style="display:inline;margin:0">My 15th to 14th view</h3> <span class="small muted">(${dd(uc.from)} – ${dd(uc.to)}: ${gbp(uc.totalIn)} in, ${gbp(uc.totalOut)} out)</span></summary><div class="stack" style="margin-top:10px"><div class="row between"><span class="small muted">Universal Credit period</span>
    <div class="row"><button id="ucPrev" type="button" aria-label="Previous period">‹ Earlier</button><button id="ucNext" type="button" aria-label="Next period">Later ›</button></div></div>
    <div class="row" style="align-items:end">${field('ucFrom', S.uc.from, 'From', 'date')}${field('ucTo', S.uc.to, 'To', 'date')}</div>
    <p class="small muted">Counts only money that actually came in and expenses you actually paid between these dates, the way Universal Credit does. Check it against your bank statement.</p>
    <div class="stats">
      <div class="stat"><b>${gbp(uc.totalIn)}</b><span>Money in (${dd(uc.from)} – ${dd(uc.to)})</span></div>
      <div class="stat"><b>${gbp(uc.totalOut)}</b><span>Expenses paid</span></div>
      <div class="stat uc-result"><b class="${uc.profit < 0 ? 'neg' : ''}">${gbp(uc.profit)}</b><span>${uc.profit < 0 ? 'Loss' : 'Profit'} for this period</span></div>
    </div>
    ${uc.totalOut ? `<div class="stack" style="gap:6px"><h4 style="margin:0">Expenses by type, for your UC journal</h4><div class="total">${Object.entries(uc.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div><span>${esc(k)}${UC_TYPE[k] ? ` <span class="muted">→ UC: ${UC_TYPE[k]}</span>` : ''}</span><span>${gbp(v)}</span></div>`).join('')}<div class="big"><span>Total expenses</span><span>${gbp(uc.totalOut)}</span></div></div></div>` : ''}
    <details><summary>Show what's counted</summary><div class="stack" style="margin-top:10px">
      <h4 style="margin:0">Money in</h4>${ucRows(uc.moneyIn, 'No money recorded as received in these dates.')}
      ${uc.moneyIn.some(r => r.guessed) ? '<p class="small muted">* No deposit date was entered, so the date the order was added is used. Add the real date in the order if it was different.</p>' : ''}
      <h4 style="margin:0">Expenses paid</h4>${ucRows(uc.moneyOut, 'No expenses in these dates.', true)}
    </div></details>
    ${uc.totalOwed ? `<p class="notice"><span><b>${gbp(uc.totalOwed)} still owed</b> on orders in these dates (${uc.owed.map(r => esc(r.what)).join(', ')}). It's not counted until it's paid. If it has been paid, tick "balance paid" in the order with the date it came in.</span></p>` : ''}
    ${uc.estCosts ? `<p class="small muted">Not counted: ${gbp(uc.estCosts)} of costs typed into orders. Universal Credit uses what you actually paid, so log real receipts as expenses instead.</p>` : ''}
  </div></details>`;
  const srcRow = (n, inc, exp) => `<tr><td>${esc(n)}</td><td>${gbp(inc)}</td><td>${gbp(exp)}</td><td class="${inc - exp < 0 ? 'neg' : ''}">${gbp(inc - exp)}</td></tr>`;
  app.innerHTML = `${dataNote()}<div class="row between"><h2>${esc(name)}</h2><div class="row"><select id="yr" aria-label="Year" style="width:auto">${yrs.map(y => `<option ${y === S.year ? 'selected' : ''}>${y}</option>`).join('')}</select>${S.downloads ? '<button id="csvO">Save orders (CSV)</button><button id="csvE">Save earnings and expenses (CSV)</button>' : ''}</div></div>
  <div class="stats">
    <div class="stat"><b>${gbp(m.income)}</b><span>Income: ${gbp(m.orderIncome)} customer orders, ${gbp(m.otherIncome)} other earnings</span></div>
    <div class="stat"><b>${gbp(m.expenses)}</b><span>Expenses</span></div>
    <div class="stat"><b class="${m.profit < 0 ? 'neg' : ''}">${gbp(m.profit)}</b><span>Profit</span></div>
    <div class="stat"><b>${gbp(m.received)}</b><span>Money received this month</span></div>
  </div>
  <p class="small"><a href="#ucBox" id="ucJump">See my 15th to 14th totals ↓</a></p>
  <p class="small muted">Orders count in the month of their event. Money received counts deposits and balances in the month they were paid, plus other earnings on the date you enter.</p>
  <section class="stack"><h3>Where your money came from in ${esc(name)}</h3><div class="scroll"><table><thead><tr><th>Source</th><th>Income</th><th>Expenses</th><th>Profit</th></tr></thead><tbody>
  ${srcRow('Customer orders', m.orderIncome, m.orderCosts)}${Object.entries(m.sources).map(([n, v]) => srcRow(n, v.income, v.expenses)).join('')}${srcRow('Business expenses', 0, m.other)}
  </tbody><tfoot><tr><td>Total</td><td>${gbp(m.income)}</td><td>${gbp(m.expenses)}</td><td class="${m.profit < 0 ? 'neg' : ''}">${gbp(m.profit)}</td></tr></tfoot></table></div></section>
  <section class="card"><h3>Add other earnings</h3><p class="small muted">Record money in and costs for Too Good To Go, Uber Eats and market trading, such as sales, app fees, stall fees and stock.</p>
  <form id="of" novalidate style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end">
    ${field('oeDate', today(), 'Date', 'date')}
    <div class="f"><label for="oeSrc">Where from?</label><select id="oeSrc">${SOURCES.map(s => `<option>${s}</option>`).join('')}</select></div>
    <div class="f"><label for="oeType">Income or expense?</label><select id="oeType"><option value="income">Income</option><option value="expense">Expense</option></select></div>
    ${field('oeItem', '', 'Details')}${moneyInput('oeAmt', '', 'Amount')}<button class="primary" type="submit">Add entry</button>
  </form><p class="err" id="oeErr" role="alert" hidden></p></section>
  <section class="stack"><h3>Other earnings in ${esc(name)}</h3>${oe.length ? `<div class="scroll"><table><thead><tr><th>Details</th><th>Where from</th><th>Type</th><th>Date</th><th>Amount</th><th></th></tr></thead><tbody>${oe.map(e => `<tr><td style="white-space:normal">${esc(e.item)}</td><td>${esc(e.source)}</td><td><span class="pill ${e.entryType === 'income' ? 'done' : 'pay'}">${e.entryType === 'income' ? 'Income' : 'Expense'}</span></td><td>${fmt(e.date, {day: 'numeric', month: 'short'})}</td><td>${gbp(P(e.amount))}</td><td><button class="link" data-delex="${esc(e.id)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nothing added this month. Use the form above to add your first entry.</div>'}</section>
  <section class="stack"><h3>${esc(S.year)} by month</h3><div class="scroll"><table><thead><tr><th>Month</th><th>Orders</th><th>Income</th><th>Expenses</th><th>Profit</th><th>Received</th></tr></thead><tbody>
  ${rows.map(r => `<tr class="pick ${r.ym === S.ym ? 'sel' : ''}" data-ym="${r.ym}" tabindex="0"><td>${fmt(r.ym + '-15', {month: 'short'})}</td><td>${r.orders}</td><td>${gbp(r.income)}</td><td>${gbp(r.expenses)}</td><td class="${r.profit < 0 ? 'neg' : ''}">${gbp(r.profit)}</td><td>${gbp(r.received)}</td></tr>`).join('')}
  </tbody><tfoot><tr><td>Year</td><td>${tot('orders')}</td><td>${gbp(tot('income'))}</td><td>${gbp(tot('expenses'))}</td><td class="${tot('profit') < 0 ? 'neg' : ''}">${gbp(tot('profit'))}</td><td>${gbp(tot('received'))}</td></tr></tfoot></table></div></section>
  <section class="card"><h3>Add a business expense</h3><p class="small muted">For costs that aren't tied to one order, such as bulk ingredients, equipment or adverts.</p>
  <form id="ef" novalidate style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end">
    ${field('exDate', today(), 'Date', 'date')}${field('exItem', '', 'What was it?')}
    <div class="f"><label for="exCat">Type</label><select id="exCat">${CATS.map(c => `<option>${c}</option>`).join('')}</select></div>
    ${moneyInput('exAmt', '', 'Amount')}<button class="primary" type="submit">Add expense</button>
  </form><p class="err" id="exErr" role="alert" hidden></p></section>
  <section class="stack"><h3>Business expenses in ${esc(name)}</h3>${ex.length ? `<div class="scroll"><table><thead><tr><th>What</th><th>Type</th><th>Date</th><th>Amount</th><th></th></tr></thead><tbody>${ex.map(e => `<tr><td style="white-space:normal">${esc(e.item)}${e.example ? ' <span class="pill">Example</span>' : ''}</td><td>${esc(e.category)}</td><td>${fmt(e.date, {day: 'numeric', month: 'short'})}</td><td>${gbp(P(e.amount))}</td><td><button class="link" data-delex="${esc(e.id)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No business expenses this month.</div>'}</section>
  <section class="stack"><h3>Orders in ${esc(name)}</h3>${mo.length ? `<div class="scroll"><table><thead><tr><th>Customer</th><th>Event</th><th>Income</th><th>Expenses</th><th>Profit</th></tr></thead><tbody>${mo.map(o => { const s = sums(o); return `<tr class="pick" data-open="${esc(o.id)}" tabindex="0"><td>${esc(o.customerName)}</td><td>${fmt(o.eventDate, {day: 'numeric', month: 'short'})}</td><td>${gbp(s.income)}</td><td>${gbp(s.costs)}</td><td class="${s.profit < 0 ? 'neg' : ''}">${gbp(s.profit)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No orders with an event this month.</div>'}</section>${ucHtml}`;
  app.querySelector('#yr').onchange = e => { S.year = e.target.value; S.ym = S.year + S.ym.slice(4); viewMoney(); };
  const ucKeep = () => { const o = app.querySelector('.uc details')?.open; S.ucOpen = true; viewMoney(); if (o) app.querySelector('.uc details').open = true; };
  app.querySelector('#ucBox').addEventListener('toggle', e => { S.ucOpen = e.target.open; });
  app.querySelector('#ucJump').onclick = ev => { ev.preventDefault(); const b = app.querySelector('#ucBox'); b.open = true; S.ucOpen = true; b.scrollIntoView({behavior: 'smooth', block: 'start'}); };
  app.querySelector('#ucPrev').onclick = () => { S.uc = ucShift(S.uc, -1); ucKeep(); };
  app.querySelector('#ucNext').onclick = () => { S.uc = ucShift(S.uc, 1); ucKeep(); };
  ['ucFrom', 'ucTo'].forEach(id => app.querySelector('#' + id).addEventListener('change', e => { const v = e.target.value; if (!v) return; S.uc = {...S.uc, [id === 'ucFrom' ? 'from' : 'to']: v}; ucKeep(); }));
  app.querySelector('#ef').addEventListener('submit', async ev => { ev.preventDefault();
    const q = id => app.querySelector('#' + id), err = q('exErr'), item = q('exItem').value.trim(), amount = q('exAmt').value, date = q('exDate').value;
    if (!item || !P(amount) || !date) { err.textContent = 'Add a date, what it was and the amount.'; err.hidden = false; return; }
    if (!S.db) { err.textContent = "This can't save right now."; err.hidden = false; return; }
    try { await S.db.collection('expenses').add({date, item, amount, category: q('exCat').value, createdAt: new Date().toISOString()}); S.ym = date.slice(0, 7); S.year = date.slice(0, 4); toast('Expense added'); }
    catch (x) { err.textContent = "That didn't save. Check your connection and try again."; err.hidden = false; } });
  app.querySelector('#of').addEventListener('submit', async ev => { ev.preventDefault();
    const q = id => app.querySelector('#' + id), err = q('oeErr'), item = q('oeItem').value.trim(), amount = q('oeAmt').value, date = q('oeDate').value;
    if (!item || !P(amount) || !date) { err.textContent = 'Add a date, details and the amount.'; err.hidden = false; return; }
    if (!S.db || S.failed) { err.textContent = "This can't save right now."; err.hidden = false; return; }
    try { S.ym = date.slice(0, 7); S.year = date.slice(0, 4); await S.db.collection('expenses').add({date, item, amount, source: q('oeSrc').value, entryType: q('oeType').value, createdAt: new Date().toISOString()}); toast('Entry added'); }
    catch (x) { err.textContent = "That didn't save. Check your connection and try again."; err.hidden = false; } });
  const csv = async (name, head, rows) => { try { await S.downloads.save({filename: name, data: [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n')}); toast('File saved'); } catch (e) { if (e?.code !== 'declined') toast("That file couldn't be saved here."); } };
  app.querySelector('#csvO')?.addEventListener('click', () => csv('tinas-orders.csv', ['Event date', 'Customer', 'Email', 'Instagram', 'Phone', 'Status', 'Biscuits', 'Cupcakes', 'Details', 'Colours', 'Allergies', 'Dietary preference', 'Make date', 'Post date', 'Tracking number', 'Delivery or collection', 'Income', 'Expenses', 'Profit', 'Deposit', 'Outstanding'], S.orders.map(o => { const s = sums(o); return [o.eventDate, o.customerName, o.email, o.instagram, o.phone, o.status, o.biscuits ? o.biscuitQty : '', o.cupcakes ? o.cupcakeQty : '', o.details, o.colourScheme, o.allergies, o.dietary, o.makeDate, o.postDate, o.trackingNumber || '', o.fulfilment, s.income / 100, s.costs / 100, s.profit / 100, s.deposit / 100, s.outstanding / 100]; })));
  app.querySelector('#csvE')?.addEventListener('click', () => csv('tinas-earnings-and-expenses.csv', ['Date', 'What', 'Type', 'Where from', 'Income or expense', 'Amount'], S.expenses.map(e => [e.date, e.item, e.category, e.source || 'Business', e.entryType === 'income' ? 'Income' : 'Expense', e.amount])));
}

/* Google Calendar: every order's make, post, delivery and collection days go into Tina's calendar by themselves */
async function calPost(cfg, body) {
  const r = await fetch(cfg.url, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify({secret: cfg.secret, ...body}), redirect: 'follow'});
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw new Error('No answer from Google');
  if (!d.ok) throw new Error(d.error || 'Google said no');
  return d;
}
const calLastOk = v => { try { v === undefined ? null : v ? localStorage.setItem(CAL_LAST, v) : localStorage.removeItem(CAL_LAST); return localStorage.getItem(CAL_LAST); } catch (e) { return null; } };
async function calSync(orders) {
  if (!S.cal) return;
  try { await calPost(S.cal, {orders: orders.filter(Boolean).map(calOrder)}); }
  catch (e) { calLastOk(''); toast("Saved, but your Google Calendar didn't update. It will try again next time you open the order book."); }
}
async function calAll(quiet) {
  if (!S.cal || S.failed) return false;
  try { const d = await calPost(S.cal, {full: true, orders: S.orders.map(calOrder)}); calLastOk(String(Date.now())); return d; }
  catch (e) { if (!quiet) throw e; return false; }
}
function calCatchUp() { const last = +calLastOk() || 0; if (S.cal && Date.now() - last > 6 * 3600000) calAll(true); }
function calNote() {
  if (S.cal || !S.db || S.failed) return '';
  return `<div class="notice"><span><b>Put your orders in Google Calendar automatically.</b> Make, post, delivery and collection days, with reminders 5 days before and on the day.</span><a class="btn" href="#calendar">Set it up</a></div>`;
}
function newSecret() { const a = new Uint8Array(18); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); }
function viewCalendar() {
  S.calSecret ||= (S.cal && S.cal.secret) || newSecret();
  const code = CAL_SCRIPT.replace('__SECRET__', S.calSecret), on = !!S.cal;
  app.innerHTML = `<div id="calPage" class="stack">${dataNote().includes('bad') ? dataNote() : ''}<h2>Google Calendar</h2>
  ${on ? `<div class="notice"><span><b>Connected.</b> Every order goes into the <b>Tina's Orders</b> calendar in your Google Calendar by itself: make day, post day, and delivery or collection day and time. Each one pops up a reminder at 8am five days before and at 8am on the day. When you change or cancel an order, the calendar changes too.</span></div>
  <div class="row"><button class="primary" id="calNow">Update my calendar now</button></div><p class="small muted" id="calMsg" role="status"></p>
  <details class="card"><summary>Change the connection</summary><div class="stack" style="margin-top:10px">` : `<p>Do this once, on a computer if you can. It takes about 5 minutes. After that, every order goes into your Google Calendar by itself, with reminders 5 days before and on the day.</p>`}
  <section class="card"><h3>1. Copy your calendar code</h3><p class="small muted">It has your own secret key in it, so keep it to yourself.</p>
    <textarea id="calCode" readonly style="font-family:monospace;font-size:12px;min-height:120px">${esc(code)}</textarea>
    <div class="row"><button id="calCopy" type="button">Copy the code</button></div></section>
  <section class="card"><h3>2. Put it in Google</h3><ol style="margin:0;padding-left:20px;display:grid;gap:6px">
    <li>Open <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com</a>, signed in to the Google account whose calendar you use. A new project opens.</li>
    <li>Delete what's in the box, paste the code, then press the save icon.</li>
    <li>At the top, pick <b>setUp</b> and press <b>Run</b>. Google asks for permission: choose your account, then <b>Advanced</b>, then <b>Go to … (unsafe)</b>, then <b>Allow</b>. This is your own code, so that's fine.</li>
    <li>Press <b>Deploy</b>, then <b>New deployment</b>. Press the cog and choose <b>Web app</b>. Set <b>Execute as</b> to <b>Me</b> and <b>Who has access</b> to <b>Anyone</b>. Press <b>Deploy</b>.</li>
    <li>Copy the <b>Web app URL</b> it shows you. It ends in <b>/exec</b>.</li></ol></section>
  <section class="card"><h3>3. Paste the link here</h3>
    <div class="f"><label for="calUrl">Web app URL</label><input type="text" id="calUrl" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(S.cal && S.cal.secret === S.calSecret ? S.cal.url : '')}"></div>
    <p class="err" id="calErr" role="alert" hidden></p>
    <div class="row"><button class="primary" id="calSave" type="button">Connect and add all my orders</button></div></section>
  ${on ? '<div class="row"><button class="danger" id="calOff" type="button">Stop putting orders in my calendar</button></div></div></details>' : ''}</div>`;
  const q = id => app.querySelector('#' + id);
  q('calCopy').onclick = async () => { try { await navigator.clipboard.writeText(code); toast('Code copied'); } catch (e) { q('calCode').select(); toast('Press and hold to copy'); } };
  q('calNow')?.addEventListener('click', async e => { e.target.disabled = true; q('calMsg').textContent = 'Updating…';
    try { await calAll(false); q('calMsg').textContent = 'Your calendar is up to date.'; } catch (x) { q('calMsg').textContent = "That didn't work: " + x.message + '. Check your connection and try again.'; } e.target.disabled = false; });
  q('calOff')?.addEventListener('click', async () => { try { await TB.del('expenses', CAL_ID); S.calSecret = null; await load(); toast('Orders will no longer go in your calendar'); viewCalendar(); } catch (e) { toast("That didn't work. Try again."); } });
  q('calSave').onclick = async e => {
    const err = q('calErr'), url = q('calUrl').value.trim(); err.hidden = true;
    const bad = m => { err.textContent = m; err.hidden = false; e.target.disabled = false; };
    if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(url)) return bad('Paste the Web app URL from step 2. It starts with https://script.google.com and ends with /exec.');
    e.target.disabled = true; e.target.textContent = 'Connecting…';
    const cfg = {url, secret: S.calSecret};
    try { await calPost(cfg, {orders: []}); }
    catch (x) { e.target.textContent = 'Connect and add all my orders'; return bad(x.message === 'wrong secret' ? "Google answered, but the code there isn't this one. Copy the code again (step 1), paste it over the old one, save, then Deploy → Manage deployments → edit → New version." : "Google didn't answer. Check the link, and that Who has access is set to Anyone."); }
    try { await TB.put('expenses', CAL_ID, cfg); await load(); }
    catch (x) { e.target.textContent = 'Connect and add all my orders'; return bad("Connected, but the setting didn't save. Check your connection and try again."); }
    try { e.target.textContent = 'Adding your orders…'; await calAll(false); toast('Connected. Your orders are in Google Calendar.'); }
    catch (x) { toast('Connected. Some orders will be added next time you open the order book.'); }
    viewCalendar(); window.scrollTo(0, 0);
  };
}

/* events */
app.addEventListener('click', async e => {
  const t = e.target.closest('[data-open],[data-enq],[data-ym],[data-delex],#clearEx'); if (!t) return;
  if (t.dataset.open) { S.open = t.dataset.open; location.hash = '#order'; }
  if (t.dataset.enq) location.hash = '#enquiry/' + t.dataset.enq;
  else if (t.dataset.ym) { S.ym = t.dataset.ym; viewMoney(); }
  else if (t.dataset.delex) { try { await S.db.doc('expenses/' + t.dataset.delex).delete(); toast('Expense removed'); } catch (x) { toast("That didn't remove. Try again."); } }
  else if (t.id === 'clearEx') { t.disabled = true; try { for (const o of S.orders.filter(x => x.example)) await S.db.doc('orders/' + o.id).delete(); for (const x of S.expenses.filter(x => x.example)) await S.db.doc('expenses/' + x.id).delete(); toast('Examples removed'); } catch (x) { t.disabled = false; toast("That didn't finish. Try again."); } }
});
app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('tr.pick')) e.target.click(); });
app.addEventListener('input', e => { if (e.target.id === 'q') { S.q = e.target.value; const p = e.target.selectionStart; viewOrders(); const i = app.querySelector('#q'); i.focus(); i.setSelectionRange(p, p); } });
app.addEventListener('change', e => { if (e.target.id === 'fs') { S.status = e.target.value; viewOrders(); } });

function go() {
  const r = route();
  if (r === 'new-order') { let d = {}; try { d = JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch (e) {} render(); viewForm(d); window.scrollTo(0, 0); return; }
  if (r !== 'price') S.enqQuoting = null;
  if (r === 'price') { render(); viewPrice(); window.scrollTo(0, 0); return; }
  if (r === 'enquiry-new') { render(); viewEnquiryNew(); window.scrollTo(0, 0); return; }
  if (r.startsWith('enquiry/')) S.enqTyping = false;
  if (r === 'calendar') { render(); window.scrollTo(0, 0); return; }
  if (r === 'edit') { const o = S.orders.find(x => x.id === S.open); if (!o) { location.hash = '#orders'; return; } render(); viewForm(JSON.parse(JSON.stringify(o))); window.scrollTo(0, 0); return; }
  S.dirty = false; render(); window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => { if (S.db) go(); });

/* data */
const gate = document.getElementById('gate'), shell = [document.querySelector('.top'), app, document.getElementById('foot')];
const showShell = on => { gate.hidden = on; shell.forEach(el => el.hidden = !on); };
function refDoc(table, id) {
  return {id,
    set: async data => { const {id: _, ...d} = data; await TB.put(table, id, d); await load(); },
    update: async patch => { const cur = S[table].find(x => x.id === id) || {}; const {id: _, ...d} = cur; await TB.put(table, id, {...d, ...patch}); await load(); },
    delete: async () => { await TB.del(table, id); await load(); }};
}
const db = {
  doc: path => { const [t, id] = path.split('/'); return refDoc(t, id); },
  collection: t => ({doc: () => refDoc(t, crypto.randomUUID()), add: data => refDoc(t, crypto.randomUUID()).set(data)}),
};
S.downloads = {save: async ({filename, data}) => { const u = URL.createObjectURL(new Blob([data], {type: 'text/csv'})), a = document.createElement('a'); a.href = u; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); }};
async function load() {
  try {
    const [o, e] = await Promise.all([TB.list('orders'), TB.list('expenses')]);
    const cfg = e.find(r => r.id === CAL_ID);
    S.cal = cfg && cfg.data && cfg.data.url && cfg.data.secret ? cfg.data : null;
    const pay = e.find(r => r.id === PAY_ID); S.payImage = pay && pay.data && pay.data.path || '';
    S.orders = o.map(r => ({...r.data, id: r.id})); S.expenses = e.filter(r => r.id !== CAL_ID && r.id !== PAY_ID).map(r => ({...r.data, id: r.id})); S.failed = false;
    await loadEnquiries();
  } catch (x) {
    if (x.status === 401) { await TB.signOut(); S.orders = []; S.expenses = []; S.db = null; showShell(false); return; }
    S.failed = true;
  }
  render();
}
async function enter() { S.db = db; showShell(true); go(); await load(); calCatchUp(); }
document.addEventListener('visibilitychange', async () => { if (!document.hidden && S.db) { await load(); calCatchUp(); } });
document.getElementById('out').onclick = async () => { await TB.signOut(); location.reload(); };
document.getElementById('login').addEventListener('submit', async ev => {
  ev.preventDefault();
  const e = document.getElementById('lerr'), b = document.getElementById('lbtn'); e.hidden = true; b.disabled = true;
  try { await TB.signIn(document.getElementById('lmail').value.trim(), document.getElementById('lpass').value); document.getElementById('lpass').value = ''; await enter(); }
  catch (x) { e.textContent = x.status === 400 ? "That email or password isn't right." : "Sign-in didn't work. Check your connection and try again."; e.hidden = false; }
  b.disabled = false;
});
(async () => {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (location.protocol !== 'https:' && !local) { showShell(false); document.getElementById('login').hidden = true; document.getElementById('nosec').hidden = false; return; }
  if (await TB.resume()) await enter(); else showShell(false);
})();
})();
