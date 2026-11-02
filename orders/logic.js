/* ---------- pure logic (tested) ---------- */
const P = v => Math.round((parseFloat(v) || 0) * 100);
const gbp = p => (p < 0 ? '-£' : '£') + (Math.abs(p) / 100).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
function handover(o) {
  return o.fulfilment === 'delivery' ? {date: o.deliveryDate || o.eventDate, time: o.deliveryTime || '', label: 'Deliver'}
       : o.fulfilment === 'collection' ? {date: o.collectionDate || o.eventDate, time: o.collectionTime || '', label: 'Collection'}
       : {date: o.eventDate, time: '', label: 'Hand over'};
}
function sums(o) {
  const treats = P(o.price), delivery = o.fulfilment === 'delivery' ? P(o.deliveryFee) : 0, income = treats + delivery;
  const costs = (o.costs || []).reduce((t, c) => t + P(c.amount), 0), deposit = P(o.deposit);
  const outstanding = o.balancePaid ? 0 : Math.max(0, income - deposit);
  return {treats, delivery, income, costs, deposit, outstanding, profit: income - costs};
}
const dueDate = o => o.balanceDue || handover(o).date;
function jobs(o) {
  const out = [], s = sums(o), h = handover(o);
  if (o.status === 'Cancelled') return out;
  if (o.status !== 'Completed') {
    if (o.makeDate) out.push({date: o.makeDate, kind: 'make', label: 'Make', o});
    if (h.date) out.push({date: h.date, time: h.time, kind: 'hand', label: h.label, o});
    if (o.eventDate && o.eventDate !== h.date) out.push({date: o.eventDate, kind: 'event', label: 'Event', o});
  }
  if (s.outstanding > 0 && dueDate(o)) out.push({date: dueDate(o), kind: 'pay', label: gbp(s.outstanding) + ' due', o});
  return out;
}
function month(ym, orders, expenses) {
  const r = {income: 0, delivery: 0, orderCosts: 0, other: 0, received: 0, orders: 0};
  for (const o of orders) {
    const s = sums(o);
    if (o.status !== 'Cancelled' && (o.eventDate || '').startsWith(ym)) { r.income += s.income; r.delivery += s.delivery; r.orderCosts += s.costs; r.orders++; }
    if ((o.depositDate || (o.createdAt || '').slice(0, 10)).startsWith(ym)) r.received += Math.min(s.deposit, o.status === 'Cancelled' ? s.deposit : s.income);
    if (o.balancePaid && (o.balancePaidDate || '').startsWith(ym)) r.received += Math.max(0, s.income - s.deposit);
  }
  for (const e of expenses) if ((e.date || '').startsWith(ym)) r.other += P(e.amount);
  r.expenses = r.orderCosts + r.other; r.profit = r.income - r.expenses;
  return r;
}
function calUrl(title, details, date, time) {
  const c = s => s.replace(/[-:]/g, '');
  let dates;
  if (time) { const [h, m] = time.split(':').map(Number), e = String(Math.min(h + 1, 23)).padStart(2, '0') + String(m).padStart(2, '0'); dates = c(date) + 'T' + c(time) + '00/' + c(date) + 'T' + e + '00'; }
  else dates = c(date) + '/' + c(addDays(date, 1));
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + dates + '&ctz=Europe/London&details=' + encodeURIComponent(details);
}
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
if (typeof module !== 'undefined') module.exports = {P, gbp, sums, jobs, month, calUrl, handover, dueDate, csvCell, addDays};
