/* ---------- app ---------- */
(() => {
const app = document.getElementById('app');
const S = {orders: [], expenses: [], db: null, ready: {o: false, e: false}, stale: false, failed: false, year: null, ym: null, q: '', status: 'Active', open: null, dirty: false, downloads: null};
const STATUSES = ['Confirmed', 'In progress', 'Ready', 'Completed', 'Cancelled'];
const CATS = ['Ingredients', 'Packaging', 'Equipment', 'Delivery and travel', 'Marketing', 'Fees', 'Other'];
const DRAFT = 'tina-order-draft';
const today = () => iso(new Date());
S.ym = today().slice(0, 7); S.year = today().slice(0, 4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = (s, o = {day: 'numeric', month: 'short', year: 'numeric'}) => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-GB', o) : '';
const toast = m => { const t = document.getElementById('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200); };
const what = o => [o.biscuits && (o.biscuitQty || '?') + ' biscuits', o.cupcakes && (o.cupcakeQty || '?') + ' cupcakes'].filter(Boolean).join(' + ') || 'Items not set';
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
  document.querySelectorAll('nav a').forEach(a => a.dataset.r === (r.startsWith('order-') ? 'orders' : r) ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  if (r === 'new-order' || r === 'edit' || r === 'price') return; // forms are drawn once by go()
  if (r === 'orders') viewOrders(); else if (r === 'money') viewMoney(); else if (r === 'order') viewOrder(); else viewHome();
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
  app.innerHTML = `${dataNote()}
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
  <div class="stack" id="list">${list.length ? list.map(o => { const s = sums(o); return `<button class="docket" data-open="${esc(o.id)}">${dateTab(o.eventDate)}<div style="min-width:0"><strong>${esc(o.customerName)}</strong> ${o.example ? '<span class="pill">Example</span>' : ''}<div class="muted small">${esc(what(o))} · ${esc(o.fulfilment === 'delivery' ? 'Delivery' : o.fulfilment === 'collection' ? 'Collection' : 'Hand-over not set')}</div>${o.allergies ? `<div class="allergy small">Allergy: ${esc(o.allergies)}</div>` : ''}</div><div class="sum"><strong>${gbp(s.income)}</strong><br>${s.outstanding ? `<span class="pill pay">${gbp(s.outstanding)} to pay</span>` : '<span class="pill done">Paid</span>'}</div></button>`; }).join('') : `<div class="empty">No orders match. Try "All" or add a new order.</div>`}</div>`;
}

function viewOrder() {
  const o = S.orders.find(x => x.id === S.open);
  if (!o) { location.hash = '#orders'; return; }
  const s = sums(o), h = handover(o), note = [what(o), o.details, o.colourScheme && 'Colours: ' + o.colourScheme, o.allergies && 'ALLERGIES: ' + o.allergies, o.phone && 'Phone: ' + o.phone].filter(Boolean).join('\n');
  const cal = [o.makeDate && ['Make day', calUrl('Make: ' + o.customerName + ' (' + what(o) + ')', note, o.makeDate)], h.date && [h.label, calUrl(h.label + ': ' + o.customerName, note + (o.deliveryAddress ? '\nAddress: ' + o.deliveryAddress : ''), h.date, h.time)], s.outstanding && dueDate(o) && ['Payment due', calUrl('Payment due ' + gbp(s.outstanding) + ': ' + o.customerName, note, dueDate(o))]].filter(Boolean);
  const item = (k, v) => v ? `<div><h3>${k}</h3>${esc(v)}</div>` : '';
  app.innerHTML = `<div class="row between"><div><h2>${esc(o.customerName)}</h2><span class="muted">${esc(what(o))} for ${fmt(o.eventDate) || 'date not set'}</span></div>
  <div class="row"><label class="lab" for="st">Status</label><select id="st" style="width:auto">${STATUSES.map(x => `<option ${x === o.status ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
  ${o.example ? '<div class="notice"><span>This is an example order.</span></div>' : ''}
  ${o.allergies ? `<div class="notice bad"><span class="allergy">Allergies: ${esc(o.allergies)}</span></div>` : ''}
  <div class="total"><div><span>Treats</span><span>${gbp(s.treats)}</span></div>${o.fulfilment === 'delivery' ? `<div><span>Delivery</span><span>${gbp(s.delivery)}</span></div>` : ''}<div class="big"><span>Order income</span><span>${gbp(s.income)}</span></div><div><span>Expenses on this order</span><span>${gbp(s.costs)}</span></div><div><span>Profit</span><span class="${s.profit < 0 ? 'neg' : ''}">${gbp(s.profit)}</span></div><div><span>Deposit received</span><span>${gbp(s.deposit)}</span></div><div class="big"><span>Payment outstanding</span><span>${gbp(s.outstanding)}</span></div></div>
  <div class="row">${s.outstanding ? `<button class="primary" id="paid">Mark balance as paid</button>` : o.balancePaid ? '<button id="unpaid">Undo balance paid</button>' : ''}<button id="edit">Edit order</button></div>
  <section class="card"><h3>Add to Google Calendar</h3><div class="row">${cal.length ? cal.map(([l, u]) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('') : '<span class="muted">Add dates to the order to use this.</span>'}</div></section>
  <section class="card detail">
    ${item('Email', o.email)}${item('Instagram', o.instagram)}${item('Phone', o.phone)}${item('Make on', fmt(o.makeDate))}${item(h.label, [fmt(h.date), h.time].filter(Boolean).join(' at '))}
    ${item('Delivery address', o.fulfilment === 'delivery' && o.deliveryAddress)}${item('Delivery location', o.fulfilment === 'delivery' && o.deliveryLocation)}
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
  const upd = async (patch, msg) => { try { await S.db.doc('orders/' + o.id).update({...patch, updatedAt: new Date().toISOString()}); toast(msg); } catch (e) { toast("That didn't save. Check your connection and try again."); } };
  app.querySelector('#st').onchange = e => upd({status: e.target.value}, 'Status changed to ' + e.target.value);
  app.querySelector('#paid')?.addEventListener('click', () => upd({balancePaid: true, balancePaidDate: today()}, 'Balance marked as paid'));
  app.querySelector('#unpaid')?.addEventListener('click', () => upd({balancePaid: false, balancePaidDate: ''}, 'Balance marked as unpaid'));
  app.querySelector('#edit').onclick = () => { location.hash = '#edit'; };
  app.querySelector('#del').onclick = () => { document.getElementById('delrow').innerHTML = `<span>Delete this order for good?</span><button class="danger" id="delyes">Yes, delete it</button><button id="delno">Keep it</button>`;
    document.getElementById('delno').onclick = viewOrder;
    document.getElementById('delyes').onclick = async () => { try { await S.db.doc('orders/' + o.id).delete(); TB.removeFiles(o.images || []).catch(() => {}); location.hash = '#orders'; toast('Order deleted'); } catch (e) { toast("That didn't delete. Try again."); } }; };
}

/* price an order */
S.pq = {lines: [{style: 'Logo / photo topper', qty: '', topper: 'Toppers 12 x 7cm'}], wrapped: false, delivery: 'Collection', shapes: '', customCutter: false};
const TIER_NAMES = ['6–49', '50–99', '100–199', '200+'];
function viewPrice() {
  const q = S.pq, opt = (list, v) => list.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const styles = Object.keys(PRICING.styles), toppers = ['No toppers', ...Object.keys(PRICING.toppers)];
  app.innerHTML = `<h2>Price an order</h2>
  <p class="hint">Add a line for each biscuit style in the order. The price, your costs and your profit work themselves out.</p>
  <form id="pf" novalidate>
  <fieldset><legend>Biscuits</legend>
    <div class="full lines" id="qlines"></div>
    <div class="full"><button type="button" id="qadd">Add another style</button></div>
  </fieldset>
  <fieldset><legend>Extras</legend>
    <label class="tick full"><input type="checkbox" id="qwrap" ${q.wrapped ? 'checked' : ''}>Individually wrapped with a bow (${gbp(PRICING.wrap)} each)</label>
    <div class="f"><label for="qdel">Delivery</label><select id="qdel">${opt(Object.keys(PRICING.delivery), q.delivery)}</select></div>
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
    showQuote(); });
  f.addEventListener('change', e => { if (e.target.type !== 'number') f.dispatchEvent(new Event('input')); });
  f.querySelector('#qadd').onclick = () => { q.lines.push({style: 'Simple fondant personalisation', qty: '', topper: 'No toppers'}); drawLines(); showQuote(); box.querySelector(`#qn${q.lines.length - 1}`).focus(); };
  box.addEventListener('click', e => { const x = e.target.closest('[data-x]'); if (!x) return; q.lines.splice(+x.dataset.x, 1); drawLines(); showQuote(); });
}
function showQuote() {
  const q = S.pq, r = quote(q), out = app.querySelector('#qres'), key = JSON.stringify(q); if (!out || out.dataset.key === key) return; out.dataset.key = key;
  if (!r.n) { out.innerHTML = `<div class="empty">Type how many biscuits to see the price.</div>`; return; }
  const row = (k, v, cls = '') => `<div class="${cls}"><span>${k}</span><span>${v}</span></div>`;
  const verdict = {min: ['bad', `The minimum order is ${PRICING.minOrder} biscuits.`],
    good: ['good', `✓ Good price. You earn ${gbp(r.perHour)} an hour, at least your ${gbp(PRICING.hourly)} rate.`],
    low: ['warn', `⚠ Too cheap. You'd earn ${gbp(r.perHour)} an hour, under your ${gbp(PRICING.hourly)} rate. Charge more or change the toppers.`]}[r.verdict];
  const boxTxt = [r.boxes.large && r.boxes.large + ' large', r.boxes.small && r.boxes.small + ' small'].filter(Boolean).join(', ');
  const sheetTxt = r.sheets.map(s => s.sheets + ' × ' + s.topper.replace('Toppers ', '')).join(', ');
  out.innerHTML = `<div class="notice ${verdict[0]}"><span><b>${verdict[1]}</b></span></div>
  <div class="stats">
    <div class="stat"><b>${gbp(r.charge.total)}</b><span>Charge the customer</span></div>
    <div class="stat"><b class="${r.profit < 0 ? 'neg' : ''}">${gbp(r.profit)}</b><span>Your profit</span></div>
    <div class="stat"><b>${r.hours.toLocaleString('en-GB', {maximumFractionDigits: 1})} hrs</b><span>Time it will take</span></div>
    <div class="stat"><b>${gbp(r.deposit)}</b><span>Deposit to take (50%)</span></div>
  </div>
  <section class="card"><h3>What the customer pays</h3><div class="total">
    ${r.lines.map(l => row(`${l.qty} × ${esc(l.style)} at ${gbp(l.price)}`, gbp(l.total))).join('')}
    ${r.charge.wrapping ? row('Individual wrapping', gbp(r.charge.wrapping)) : ''}${r.charge.cutters ? row('Cutters', gbp(r.charge.cutters)) : ''}${r.charge.delivery ? row(esc(q.delivery), gbp(r.charge.delivery)) : ''}
    ${row('Total to charge', gbp(r.charge.total), 'big')}${row('Deposit to take (50%)', gbp(r.deposit))}</div>
    <p class="hint">${r.n} biscuits, so the ${TIER_NAMES[r.tier]} price is used.</p></section>
  <section class="card"><h3>What it costs you</h3><div class="total">
    ${row('Ingredients (biscuit and icing)', gbp(r.cost.ingredients))}${r.cost.toppers ? row(`Toppers (buy ${esc(sheetTxt)})`, gbp(r.cost.toppers)) : ''}
    ${row(`Boxes (${boxTxt})`, gbp(r.cost.boxes))}${r.cost.bagsBows ? row('Bows', gbp(r.cost.bagsBows)) : ''}
    ${r.cost.cutters ? row('Cutters', gbp(r.cost.cutters)) : ''}${r.cost.postage ? row('Postage', gbp(r.cost.postage)) : ''}
    ${row('Total costs', gbp(r.cost.total), 'big')}${row('Profit (money you keep)', `<span class="${r.profit < 0 ? 'neg' : ''}">${gbp(r.profit)}</span>`, 'big')}</div></section>
  <div class="row"><button class="primary" id="qorder" type="button">Start an order with these figures</button></div>`;
  out.querySelector('#qorder').onclick = () => {
    let d = {}; try { d = JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch (e) {}
    const pounds = p => (p / 100).toFixed(2), post = r.charge.delivery > 0;
    Object.assign(d, {biscuits: true, biscuitQty: String(r.n), price: pounds(r.charge.total - r.charge.delivery),
      details: [r.lines.map(l => `${l.qty} × ${l.style}${PRICING.toppers[l.topper] ? ' (' + l.topper + ')' : ''}`).join('\n'), d.details].filter(Boolean).join('\n\n'),
      cellophane: !!q.wrapped, bow: q.wrapped ? 'with' : (d.bow || ''),
      fulfilment: post ? 'delivery' : (d.fulfilment || 'collection'), deliveryFee: post ? pounds(r.charge.delivery) : '',
      costs: [['Ingredients', r.cost.ingredients], ['Toppers' + (sheetTxt ? ' (' + sheetTxt + ')' : ''), r.cost.toppers], ['Boxes (' + boxTxt + ')', r.cost.boxes], ['Bows', r.cost.bagsBows], ['Cutters', r.cost.cutters], ['Postage', r.cost.postage]]
        .filter(([, a]) => a).map(([item, a]) => ({item, amount: pounds(a)}))});
    try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch (e) {}
    location.hash = '#new-order'; toast('Prices added. Fill in the customer and dates.');
  };
}

function moneyInput(id, v, label, hint = '') { return `<div class="f"><label for="${id}">${label}</label><div class="money"><input type="number" inputmode="decimal" step="0.01" min="0" id="${id}" name="${id}" value="${esc(v)}"></div>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`; }
function field(id, v, label, type = 'text', hint = '') { return `<div class="f"><label for="${id}">${label}</label><input type="${type}" id="${id}" name="${id}" value="${esc(v)}">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`; }

function viewForm(o) {
  const editing = !!o.id, pay = o.balancePaid ? 'paid' : P(o.deposit) > 0 ? 'deposit' : 'none';
  S.dirty = false;
  app.innerHTML = `${dataNote().includes('bad') ? dataNote() : ''}<h2>${editing ? 'Edit ' + esc(o.customerName) : 'New order'}</h2>
  <form id="f" novalidate>
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
  <fieldset><legend>Delivery or collection</legend>
    <div class="f full"><div class="choices"><label class="tick"><input type="radio" name="fulfilment" id="fDel" value="delivery" ${o.fulfilment === 'delivery' ? 'checked' : ''}>Delivery</label><label class="tick"><input type="radio" name="fulfilment" id="fCol" value="collection" ${o.fulfilment === 'collection' ? 'checked' : ''}>Collection</label></div></div>
    <div id="delBox" class="full" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      <div class="f" style="grid-column:1/-1"><label for="deliveryAddress">Delivery address</label><textarea id="deliveryAddress" name="deliveryAddress" style="min-height:70px">${esc(o.deliveryAddress)}</textarea></div>
      ${field('deliveryLocation', o.deliveryLocation, 'Location', 'text', 'Venue, room or drop-off point')}${field('deliveryDate', o.deliveryDate, 'Delivery date', 'date', 'Leave blank for the event date')}${field('deliveryTime', o.deliveryTime, 'Delivery time', 'time')}
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
    delete d.paidDate; delete d.balanceDue; return d; };
  function sync() {
    const d = read(), s = sums({...o, ...d}), pm = f.querySelector('input[name=payment]:checked').value;
    f.querySelector('#depBox').style.display = pm === 'deposit' ? 'grid' : 'none';
    f.querySelector('#paidBox').hidden = pm !== 'paid';
    f.querySelector('#dueHint').textContent = pm === 'paid' ? '' : d.eventDate ? 'The rest is due on the event date, ' + fmt(d.eventDate) + '.' : 'The rest is due on the event date.';
    f.querySelector('#bowBox').hidden = d.bow !== 'with';
    f.querySelector('#delBox').style.display = d.fulfilment === 'delivery' ? 'grid' : 'none';
    f.querySelector('#colBox').style.display = d.fulfilment === 'collection' ? 'grid' : 'none';
    f.querySelector('#feeBox').hidden = d.fulfilment !== 'delivery';
    f.querySelector('#tot').innerHTML = `<div class="big" style="border:0;margin:0;padding:0"><span>Order income, including delivery</span><span>${gbp(s.income)}</span></div><div><span>Expenses</span><span>${gbp(s.costs)}</span></div><div><span>Profit</span><span class="${s.profit < 0 ? 'neg' : ''}">${gbp(s.profit)}</span></div><div><span>Payment outstanding</span><span>${gbp(s.outstanding)}</span></div>`;
    return d;
  }
  sync();
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
  f.querySelector('#cancel').onclick = () => { try { if (!editing) localStorage.removeItem(DRAFT); } catch (e) {} S.dirty = false; location.hash = editing ? '#order' : '#orders'; };
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
      S.dirty = false; S.open = ref.id; toast('Order saved'); location.hash = '#order';
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
  const srcRow = (n, inc, exp) => `<tr><td>${esc(n)}</td><td>${gbp(inc)}</td><td>${gbp(exp)}</td><td class="${inc - exp < 0 ? 'neg' : ''}">${gbp(inc - exp)}</td></tr>`;
  app.innerHTML = `${dataNote()}<div class="row between"><h2>${esc(name)}</h2><div class="row"><select id="yr" aria-label="Year" style="width:auto">${yrs.map(y => `<option ${y === S.year ? 'selected' : ''}>${y}</option>`).join('')}</select>${S.downloads ? '<button id="csvO">Save orders (CSV)</button><button id="csvE">Save earnings and expenses (CSV)</button>' : ''}</div></div>
  <div class="stats">
    <div class="stat"><b>${gbp(m.income)}</b><span>Income: ${gbp(m.orderIncome)} customer orders, ${gbp(m.otherIncome)} other earnings</span></div>
    <div class="stat"><b>${gbp(m.expenses)}</b><span>Expenses</span></div>
    <div class="stat"><b class="${m.profit < 0 ? 'neg' : ''}">${gbp(m.profit)}</b><span>Profit</span></div>
    <div class="stat"><b>${gbp(m.received)}</b><span>Money received this month</span></div>
  </div>
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
  <section class="stack"><h3>Orders in ${esc(name)}</h3>${mo.length ? `<div class="scroll"><table><thead><tr><th>Customer</th><th>Event</th><th>Income</th><th>Expenses</th><th>Profit</th></tr></thead><tbody>${mo.map(o => { const s = sums(o); return `<tr class="pick" data-open="${esc(o.id)}" tabindex="0"><td>${esc(o.customerName)}</td><td>${fmt(o.eventDate, {day: 'numeric', month: 'short'})}</td><td>${gbp(s.income)}</td><td>${gbp(s.costs)}</td><td class="${s.profit < 0 ? 'neg' : ''}">${gbp(s.profit)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No orders with an event this month.</div>'}</section>`;
  app.querySelector('#yr').onchange = e => { S.year = e.target.value; S.ym = S.year + S.ym.slice(4); viewMoney(); };
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
  app.querySelector('#csvO')?.addEventListener('click', () => csv('tinas-orders.csv', ['Event date', 'Customer', 'Email', 'Instagram', 'Phone', 'Status', 'Biscuits', 'Cupcakes', 'Details', 'Colours', 'Allergies', 'Dietary preference', 'Make date', 'Delivery or collection', 'Income', 'Expenses', 'Profit', 'Deposit', 'Outstanding'], S.orders.map(o => { const s = sums(o); return [o.eventDate, o.customerName, o.email, o.instagram, o.phone, o.status, o.biscuits ? o.biscuitQty : '', o.cupcakes ? o.cupcakeQty : '', o.details, o.colourScheme, o.allergies, o.dietary, o.makeDate, o.fulfilment, s.income / 100, s.costs / 100, s.profit / 100, s.deposit / 100, s.outstanding / 100]; })));
  app.querySelector('#csvE')?.addEventListener('click', () => csv('tinas-earnings-and-expenses.csv', ['Date', 'What', 'Type', 'Where from', 'Income or expense', 'Amount'], S.expenses.map(e => [e.date, e.item, e.category, e.source || 'Business', e.entryType === 'income' ? 'Income' : 'Expense', e.amount])));
}

/* events */
app.addEventListener('click', async e => {
  const t = e.target.closest('[data-open],[data-ym],[data-delex],#clearEx'); if (!t) return;
  if (t.dataset.open) { S.open = t.dataset.open; location.hash = '#order'; }
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
  if (r === 'price') { render(); viewPrice(); window.scrollTo(0, 0); return; }
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
    S.orders = o.map(r => ({...r.data, id: r.id})); S.expenses = e.map(r => ({...r.data, id: r.id})); S.failed = false;
  } catch (x) {
    if (x.status === 401) { await TB.signOut(); S.orders = []; S.expenses = []; S.db = null; showShell(false); return; }
    S.failed = true;
  }
  render();
}
async function enter() { S.db = db; showShell(true); go(); await load(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.db) load(); });
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
