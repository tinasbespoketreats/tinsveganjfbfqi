/* ---------- pure logic (tested) ---------- */
const SOURCES = ['Too Good To Go', 'Uber Eats', 'Market trading', 'Website income'];
const P = v => Math.round((parseFloat(v) || 0) * 100);
const gbp = p => (p < 0 ? '-£' : '£') + (Math.abs(p) / 100).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
function handover(o) {
  return o.fulfilment === 'delivery' ? {date: o.deliveryDate || o.eventDate, time: o.deliveryTime || '', label: 'Deliver'}
       : o.fulfilment === 'post' ? {date: o.postDate || '', time: o.postTime || '', label: 'Post'}
       : o.fulfilment === 'collection' ? {date: o.collectionDate || o.eventDate, time: o.collectionTime || '', label: 'Collection'}
       : {date: o.eventDate, time: '', label: 'Hand over'};
}
// Hand delivery and postage both send the order to an address and both can carry a delivery charge.
const sendsOut = o => o.fulfilment === 'delivery' || o.fulfilment === 'post';
// Orders saved before postage became a delivery option could have a separate post date.
const oldPostDate = o => o.fulfilment !== 'post' && o.postDate ? o.postDate : '';
function sums(o) {
  const treats = P(o.price), delivery = sendsOut(o) ? P(o.deliveryFee) : 0, income = treats + delivery;
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
    if (oldPostDate(o)) out.push({date: o.postDate, kind: 'post', label: 'Post', o});
    if (h.date) out.push({date: h.date, time: h.time, kind: h.label === 'Post' ? 'post' : 'hand', label: h.label, o});
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
/* ---------- Universal Credit assessment period: money actually in and out between two dates ---------- */
// Period runs from the start day of one month to the day before it next month (15th to 14th by default).
function ucDefault(todayIso, startDay = 15) {
  const [y, m, d] = todayIso.split('-').map(Number);
  const pad = n => String(n).padStart(2, '0'), ym = (yy, mm) => mm < 1 ? [yy - 1, mm + 12] : mm > 12 ? [yy + 1, mm - 12] : [yy, mm];
  const [fy, fm] = d >= startDay ? [y, m] : ym(y, m - 1);
  const from = `${fy}-${pad(fm)}-${pad(startDay)}`, [ty, tm] = ym(fy, fm + 1);
  return {from, to: addDays(`${ty}-${pad(tm)}-${pad(startDay)}`, -1)};
}
function ucShift(p, months, startDay = 15) {
  const [y, m] = p.from.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 + months, 15));
  return ucDefault(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`, startDay);
}
function ucPeriod(from, to, orders, expenses) {
  const inP = d => !!d && d >= from && d <= to, moneyIn = [], moneyOut = [], owed = [];
  let estCosts = 0;
  for (const o of orders) {
    const s = sums(o), who = o.customerName || 'Customer';
    const depDate = o.depositDate || (o.createdAt || '').slice(0, 10);
    const dep = Math.min(s.deposit, o.status === 'Cancelled' ? s.deposit : s.income);
    if (dep > 0 && inP(depDate)) moneyIn.push({date: depDate, what: `${who}: deposit`, amount: dep, guessed: !o.depositDate});
    const bal = Math.max(0, s.income - s.deposit);
    if (o.balancePaid && bal > 0 && inP(o.balancePaidDate)) moneyIn.push({date: o.balancePaidDate, what: `${who}: balance`, amount: bal});
    if (o.status !== 'Cancelled' && inP(o.eventDate)) { estCosts += s.costs; if (s.outstanding > 0) owed.push({date: o.eventDate, what: who, amount: s.outstanding}); }
  }
  for (const e of expenses) {
    if (!inP(e.date)) continue;
    const row = {date: e.date, what: e.item || '', amount: P(e.amount), where: e.source || e.category || ''};
    (e.entryType === 'income' ? moneyIn : moneyOut).push(row);
  }
  const by = (a, b) => a.date.localeCompare(b.date), add = l => l.reduce((t, r) => t + r.amount, 0);
  moneyIn.sort(by); moneyOut.sort(by); owed.sort(by);
  const totalIn = add(moneyIn), totalOut = add(moneyOut), byType = {};
  for (const r of moneyOut) { const k = r.where || 'Other'; byType[k] = (byType[k] || 0) + r.amount; }
  return {from, to, moneyIn, moneyOut, owed, totalIn, totalOut, profit: totalIn - totalOut, estCosts, totalOwed: add(owed), byType};
}
function calUrl(title, details, date, time) {
  const c = s => s.replace(/[-:]/g, '');
  let dates;
  if (time) { const [h, m] = time.split(':').map(Number), e = String(Math.min(h + 1, 23)).padStart(2, '0') + String(m).padStart(2, '0'); dates = c(date) + 'T' + c(time) + '00/' + c(date) + 'T' + e + '00'; }
  else dates = c(date) + '/' + c(addDays(date, 1));
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + dates + '&ctz=Europe/London&details=' + encodeURIComponent(details);
}
/* ---------- Google Calendar: the entries each order puts in Tina's calendar ---------- */
// Reminders pop up at 8am five days before and at 8am on the day (or when it starts, if earlier).
const CAL = {remindAt: 8 * 60, daysBefore: 5, make: {time: '09:00', mins: 60}, post: {time: '10:00', mins: 30}, hand: {time: '10:00', mins: 60}};
function calReminders(time) {
  const [h, m] = time.split(':').map(Number), start = h * 60 + m;
  return [CAL.daysBefore * 1440 + start - CAL.remindAt, Math.max(0, start - CAL.remindAt)];
}
function calEvents(o) {
  if (!o || o.example || o.status === 'Cancelled') return [];
  const name = o.customerName || 'Customer', h = handover(o);
  const items = [o.orderType === 'sample' ? 'Sample box (' + (o.biscuitQty || PRICING.sample.qty) + ' biscuits)' : [o.biscuits && (o.biscuitQty || '?') + ' biscuits', o.cupcakes && (o.cupcakeQty || '?') + ' cupcakes'].filter(Boolean).join(' + ')].filter(Boolean).join('');
  const note = [items, o.eventDate && 'Event: ' + o.eventDate.split('-').reverse().join('/'), o.details, o.colourScheme && 'Colours: ' + o.colourScheme, o.allergies && 'ALLERGIES: ' + o.allergies, o.dietary && 'Dietary: ' + o.dietary, o.phone && 'Phone: ' + o.phone].filter(Boolean).join('\n');
  const out = [], ev = (key, title, date, time, mins, extra = '', location = '') => out.push({key, title, date, time, mins, details: note + extra, location, reminders: calReminders(time)});
  if (o.makeDate) ev('make', '🍪 Make: ' + name + (items ? ' (' + items + ')' : ''), o.makeDate, CAL.make.time, CAL.make.mins);
  if (oldPostDate(o)) ev('post', 'Post: ' + name + (items ? ' (' + items + ')' : ''), o.postDate, CAL.post.time, CAL.post.mins, o.deliveryAddress ? '\nAddress: ' + o.deliveryAddress : '');
  if (h.date && o.fulfilment === 'post') {
    ev('post', 'Post: ' + name + (items ? ' (' + items + ')' : ''), h.date, h.time || CAL.post.time, CAL.post.mins,
      (h.time ? '' : '\n(No time set on the order.)') + (o.deliveryAddress ? '\nAddress: ' + o.deliveryAddress : ''), o.deliveryAddress || '');
  } else if (h.date) {
    const addr = o.fulfilment === 'delivery' ? [o.deliveryLocation, o.deliveryAddress].filter(Boolean).join(', ') : '';
    ev('hand', (o.fulfilment === 'delivery' ? 'Deliver: ' : o.fulfilment === 'collection' ? 'Collection: ' : 'Hand over: ') + name, h.date, h.time || CAL.hand.time, CAL.hand.mins,
      (h.time ? '' : '\n(No time set on the order.)') + (addr ? '\nAddress: ' + addr : ''), addr);
  }
  return out;
}
function calSig(events) { let x = 5381; const t = JSON.stringify(events); for (let i = 0; i < t.length; i++) x = (x * 33 ^ t.charCodeAt(i)) >>> 0; return events.length ? 'v1-' + x.toString(36) : ''; }
const calOrder = o => { const events = calEvents(o); return {id: o.id, sig: calSig(events), events}; };
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
  // Customer pays £14 an hour for the drive there, plus 55p a mile (HMRC rate) for the miles there and back, to the nearest £1, £6 minimum,
  // plus the £18 London Congestion Charge when the delivery is in the zone during charging hours.
  // Drive time: 12mph anywhere in London (within 12 miles of the centre), plus 15 mins of crawling in central London;
  // outside London, the first 5 miles at 12mph and the rest at 35mph.
  car: {home: 'N9 7LJ', petrol: 179, mpg: 40, roadFactor: 1.3, minCharge: 600, perMile: 55, perHour: 1400, congestion: 1800,
    londonMiles: 12, londonMph: 12, centralMiles: 2.5, centralExtraMins: 15, slowMiles: 5, openMph: 35},
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
// Central London Congestion Charge zone (approximate outline of the Inner Ring Road), as [lat, lon].
const CCZ = [[51.5205,-0.1640],[51.5225,-0.1570],[51.5238,-0.1440],[51.5275,-0.1320],[51.5305,-0.1230],[51.5320,-0.1058],[51.5257,-0.0877],[51.5235,-0.0775],[51.5150,-0.0720],[51.5100,-0.0715],[51.5010,-0.0750],[51.4935,-0.0800],[51.4950,-0.1005],[51.4870,-0.1180],[51.4880,-0.1275],[51.4960,-0.1440],[51.5027,-0.1527],[51.5130,-0.1585]];
function inCongestionZone(p) {
  let inside = false;
  for (let i = 0, j = CCZ.length - 1; i < CCZ.length; j = i++) {
    const [yi, xi] = CCZ[i], [yj, xj] = CCZ[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < (xj - xi) * (p.lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Estimated minutes to drive from home to the customer (one way), slower in busy parts of London.
function driveMinsThere(home, dest, cfg = PRICING) {
  const c = cfg.car, oneWay = roundTripMiles(home, dest) / 2, fromCentre = roundTripMiles({lat: 51.5074, lon: -0.1278}, dest, 1) / 2;
  if (fromCentre > c.londonMiles) return Math.round(Math.min(oneWay, c.slowMiles) / c.londonMph * 60 + Math.max(0, oneWay - c.slowMiles) / c.openMph * 60);
  return Math.round(oneWay / c.londonMph * 60 + (inCongestionZone(dest) || fromCentre <= c.centralMiles ? c.centralExtraMins : 0));
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
  const driveMins = drive ? (+q.driveMins > 0 ? +q.driveMins : Math.round(miles / 2 / cfg.car.londonMph * 60)) : 0, cc = drive && !!q.congestion;
  if (drive) charge.delivery = Math.max(cfg.car.minCharge, Math.round((miles * cfg.car.perMile + driveMins / 60 * cfg.car.perHour) / 100) * 100) + (cc ? cfg.car.congestion : 0);
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
    cutters: charge.cutters, postage: drive ? fuel + (cc ? cfg.car.congestion : 0) : charge.delivery,
  };
  const costTotal = Math.round(Object.values(cost).reduce((t, v) => t + v, 0));
  Object.keys(cost).forEach(k => cost[k] = Math.round(cost[k]));
  cost.ingredients = costTotal - (cost.toppers + cost.boxes + cost.bagsBows + cost.cutters + cost.postage); // lines add up to the total exactly
  cost.total = costTotal;
  const minutes = n * (n >= cfg.tiers[1] ? cfg.bakeMinsBig : cfg.bakeMins) + lines.reduce((t, l) => t + l.qty * cfg.styles[l.style].mins, 0) + (q.wrapped ? n : 0);
  const profit = charge.total - costTotal, hours = minutes / 60, perHour = hours ? Math.round(profit / hours) : 0;
  return {n, tier, lines: priced, boxes, drive: drive ? {miles, mins: driveMins, congestion: cc, petrol, mpg, perMile: fuelPence(1, petrol, mpg), fuel: Math.round(fuel)} : null, charge, deposit: Math.round(charge.total / 2), cost, sheets, profit, minutes, hours, perHour,
    verdict: !n ? 'empty' : n < cfg.minOrder ? 'min' : perHour >= cfg.hourly ? 'good' : 'low'};
}
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
if (typeof module !== 'undefined') module.exports = {sendsOut, oldPostDate, CAL, calEvents, calReminders, calSig, calOrder, SOURCES, P, gbp, sums, jobs, month, calUrl, handover, dueDate, csvCell, addDays, PRICING, quote, fuelPence, roundTripMiles, inCongestionZone, driveMinsThere, ucDefault, ucShift, ucPeriod};
