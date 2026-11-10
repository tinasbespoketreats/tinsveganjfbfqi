/* ---------- pure logic (tested) ---------- */
const SOURCES = ['Too Good To Go', 'Uber Eats', 'Market trading'];
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
const dueDate = o => o.eventDate;
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
  const r = {orderIncome: 0, delivery: 0, orderCosts: 0, other: 0, otherIncome: 0, otherCosts: 0, received: 0, orders: 0, sources: {}};
  SOURCES.forEach(s => r.sources[s] = {income: 0, expenses: 0});
  for (const o of orders) {
    const s = sums(o);
    if (o.status !== 'Cancelled' && (o.eventDate || '').startsWith(ym)) { r.orderIncome += s.income; r.delivery += s.delivery; r.orderCosts += s.costs; r.orders++; }
    if ((o.depositDate || (o.createdAt || '').slice(0, 10)).startsWith(ym)) r.received += Math.min(s.deposit, o.status === 'Cancelled' ? s.deposit : s.income);
    if (o.balancePaid && (o.balancePaidDate || '').startsWith(ym)) r.received += Math.max(0, s.income - s.deposit);
  }
  for (const e of expenses) {
    if (!(e.date || '').startsWith(ym)) continue;
    const a = P(e.amount), src = e.source && (r.sources[e.source] ||= {income: 0, expenses: 0});
    if (e.entryType === 'income') { r.otherIncome += a; r.received += a; if (src) src.income += a; }
    else if (src) { src.expenses += a; r.otherCosts += a; }
    else r.other += a;
  }
  r.income = r.orderIncome + r.otherIncome; r.expenses = r.orderCosts + r.otherCosts + r.other; r.profit = r.income - r.expenses;
  return r;
}
function calUrl(title, details, date, time) {
  const c = s => s.replace(/[-:]/g, '');
  let dates;
  if (time) { const [h, m] = time.split(':').map(Number), e = String(Math.min(h + 1, 23)).padStart(2, '0') + String(m).padStart(2, '0'); dates = c(date) + 'T' + c(time) + '00/' + c(date) + 'T' + e + '00'; }
  else dates = c(date) + '/' + c(addDays(date, 1));
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + dates + '&ctz=Europe/London&details=' + encodeURIComponent(details);
}
/* ---------- biscuit pricing (matches the Biscuit Quote Calculator sheet) ---------- */
// Money in pence. Costs are [pack price, biscuits one pack does].
const PRICING = {
  styles: {
    'Simple fondant': {prices: [320, 220, 200, 180], mins: 2, icing: 'fondant'},
    'Logo / photo topper': {prices: [350, 280, 265, 250], mins: 3, icing: 'fondant'},
    'Simple hand-piped': {prices: [350, 275, 260, 245], mins: 5, icing: 'royal'},
    'Hand-piped design': {prices: [380, 325, 315, 305], mins: 8, icing: 'royal'},
    'Detailed hand-piped design': {prices: [400, 400, 395, 395], mins: 12, icing: 'royal'},
  },
  tiers: [0, 50, 100, 200],
  wrap: 20, firstCutter: 800, extraCutter: 400, customCutter: 1200,
  delivery: {'Collection': 0, 'Personal delivery': 0, 'Royal Mail – small': 900, 'Royal Mail – medium': 1200, 'Royal Mail – large': 1800},
  // Personal delivery: petrol in pence per litre, car miles per gallon (UK), and the extra distance roads add to a straight line.
  // Customer pays 74.4p a mile there and back (so the E10 6EN trip, 12.9 miles, is the £9.60 Tina charged), rounded up to 10p, £5 minimum.
  car: {home: 'N9 7LJ', petrol: 179, mpg: 40, roadFactor: 1.3, minCharge: 500, perMile: 74.4},
  base: {flour: [80, 120], sugar: [225, 150], vitalite: [200, 44], vanilla: [899, 300]},
  icing: {fondant: [290, 40], royal: [265, 60]},
  toppers: {'Toppers 12 x 7cm': [834, 12], 'Toppers 6 x 7cm': [761, 6], 'Toppers custom shape': [551, 9]},
  bow: [225, 31], bigBox: [1299, 5], largeBox: [582, 8], smallBox: [874, 14], bigHolds: 200, bigFrom: 80, largeHolds: 40, smallHolds: 8,
  // Sample box: 6 logo biscuits for £15, taken off their order if they book.
  sample: {qty: 6, price: 1500, style: 'Logo / photo topper', topper: 'Toppers 12 x 7cm'},
  hourly: 1500, minOrder: 6, bakeMins: 4, bakeMinsBig: 3,
};
const each = ([price, n]) => price / n;
const LITRES_PER_GALLON = 4.54609;
const fuelPence = (miles, petrol, mpg) => mpg > 0 ? miles * petrol * LITRES_PER_GALLON / mpg : 0;
// Straight-line miles between two points, then the road factor, there and back.
function roundTripMiles(a, b, roadFactor = PRICING.car.roadFactor) {
  const R = 3958.8, rad = d => d * Math.PI / 180, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * roadFactor * 2 * 10) / 10;
}
function quote(q, cfg = PRICING) {
  const lines = (q.lines || []).map(l => ({...l, qty: Math.max(0, Math.floor(+l.qty || 0))})).filter(l => l.qty && cfg.styles[l.style]);
  const n = lines.reduce((t, l) => t + l.qty, 0);
  const tier = cfg.tiers.reduce((k, from, i) => n >= from ? i : k, 0);
  const priced = lines.map(l => ({...l, price: cfg.styles[l.style].prices[tier], total: l.qty * cfg.styles[l.style].prices[tier]}));
  const shapes = Math.max(0, Math.floor(+q.shapes || 0));
  const charge = {
    biscuits: priced.reduce((t, l) => t + l.total, 0),
    wrapping: q.wrapped ? n * cfg.wrap : 0,
    cutters: (shapes ? cfg.firstCutter + (shapes - 1) * cfg.extraCutter : 0) + (q.customCutter ? cfg.customCutter : 0),
    delivery: cfg.delivery[q.delivery] || 0,
  };
  const drive = q.delivery === 'Personal delivery', miles = drive ? Math.max(0, +q.miles || 0) : 0;
  const petrol = q.petrol > 0 ? +q.petrol : cfg.car.petrol, mpg = q.mpg > 0 ? +q.mpg : cfg.car.mpg, fuel = fuelPence(miles, petrol, mpg);
  if (drive) charge.delivery = Math.max(cfg.car.minCharge, Math.ceil(Math.round(miles * cfg.car.perMile) / 10) * 10);
  charge.total = charge.biscuits + charge.wrapping + charge.cutters + charge.delivery;
  const base = Object.values(cfg.base).reduce((t, c) => t + each(c), 0);
  const byTopper = {}; lines.forEach(l => { if (cfg.toppers[l.topper]) byTopper[l.topper] = (byTopper[l.topper] || 0) + l.qty; });
  const sheets = Object.entries(byTopper).map(([k, qty]) => ({topper: k, sheets: Math.ceil(qty / cfg.toppers[k][1])}));
  // Whole boxes only. 80+ biscuits: big boxes (up to 200 each), and a leftover of 80+ gets another big box.
  // The rest go in large boxes (up to 40), with a small box (up to 8) for a leftover that fits.
  const bigRest = n % cfg.bigHolds, big = n < cfg.bigFrom ? 0 : Math.floor(n / cfg.bigHolds) + (bigRest >= cfg.bigFrom ? 1 : 0);
  const rest = n < cfg.bigFrom ? n : bigRest >= cfg.bigFrom ? 0 : bigRest, left = rest % cfg.largeHolds;
  const boxes = {big, large: Math.floor(rest / cfg.largeHolds) + (left > cfg.smallHolds ? 1 : 0), small: left && left <= cfg.smallHolds ? 1 : 0};
  const cost = {
    ingredients: n * base + lines.reduce((t, l) => t + l.qty * each(cfg.icing[cfg.styles[l.style].icing]), 0),
    toppers: sheets.reduce((t, s) => t + s.sheets * cfg.toppers[s.topper][0], 0),
    boxes: boxes.big * each(cfg.bigBox) + boxes.large * each(cfg.largeBox) + boxes.small * each(cfg.smallBox),
    bagsBows: q.wrapped ? n * each(cfg.bow) : 0,
    cutters: charge.cutters, postage: drive ? fuel : charge.delivery,
  };
  const costTotal = Math.round(Object.values(cost).reduce((t, v) => t + v, 0));
  Object.keys(cost).forEach(k => cost[k] = Math.round(cost[k]));
  cost.ingredients = costTotal - (cost.toppers + cost.boxes + cost.bagsBows + cost.cutters + cost.postage); // lines add up to the total exactly
  cost.total = costTotal;
  const minutes = n * (n >= cfg.tiers[1] ? cfg.bakeMinsBig : cfg.bakeMins) + lines.reduce((t, l) => t + l.qty * cfg.styles[l.style].mins, 0) + (q.wrapped ? n : 0);
  const profit = charge.total - costTotal, hours = minutes / 60, perHour = hours ? Math.round(profit / hours) : 0;
  return {n, tier, lines: priced, boxes, drive: drive ? {miles, petrol, mpg, perMile: fuelPence(1, petrol, mpg), fuel: Math.round(fuel)} : null, charge, deposit: Math.round(charge.total / 2), cost, sheets, profit, minutes, hours, perHour,
    verdict: !n ? 'empty' : n < cfg.minOrder ? 'min' : perHour >= cfg.hourly ? 'good' : 'low'};
}
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
if (typeof module !== 'undefined') module.exports = {SOURCES, P, gbp, sums, jobs, month, calUrl, handover, dueDate, csvCell, addDays, PRICING, quote, fuelPence, roundTripMiles};
