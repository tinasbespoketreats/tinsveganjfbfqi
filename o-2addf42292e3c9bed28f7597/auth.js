/* Sign-in and database access for Tina's Order Book. The key below is the public one: orders are protected by login and database rules. */
window.TB = (() => {
  const URL_ = 'https://ecrnwmzdzvpvfxaxolpv.supabase.co', KEY = 'sb_publishable_N0yjgQiIWdJXuOllHMs8xQ_uhJxB_sU', STORE = 'tina-orders-session';
  let session = null, refreshing = null;
  const save = s => { session = s; try { s ? localStorage.setItem(STORE, JSON.stringify(s)) : localStorage.removeItem(STORE); } catch (e) {} };
  const keep = d => { save({access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600)}); };
  async function token(body, grant) {
    const r = await fetch(URL_ + '/auth/v1/token?grant_type=' + grant, {method: 'POST', headers: {apikey: KEY, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error_description || d.msg || 'Sign-in failed'); e.status = r.status; throw e; }
    keep(d);
  }
  async function refresh() {
    refreshing ||= token({refresh_token: session.refresh_token}, 'refresh_token').finally(() => { refreshing = null; });
    return refreshing;
  }
  async function resume() {
    try { session = JSON.parse(localStorage.getItem(STORE)); } catch (e) { session = null; }
    if (!session) return false;
    try { await refresh(); return true; }
    catch (e) { if (e.status === 400 || e.status === 401) { save(null); return false; } return true; }
  }
  async function rest(path, opts = {}) {
    if (!session) { const e = new Error('Signed out'); e.status = 401; throw e; }
    if (session.expires_at - 60 < Date.now() / 1000) await refresh();
    const r = await fetch(URL_ + '/rest/v1/' + path, {...opts, headers: {apikey: KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json', ...(opts.headers || {})}});
    if (!r.ok) { const e = new Error('Database error ' + r.status); e.status = r.status; throw e; }
    return r.status === 204 ? null : r.json().catch(() => null);
  }
  return {
    resume, signedIn: () => !!session,
    signIn: (email, password) => token({email, password}, 'password'),
    signOut: async () => { try { await fetch(URL_ + '/auth/v1/logout', {method: 'POST', headers: {apikey: KEY, Authorization: 'Bearer ' + session.access_token}}); } catch (e) {} save(null); },
    list: table => rest(table + '?select=id,data'),
    put: (table, id, data) => rest(table, {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'}, body: JSON.stringify({id, data, updated_at: new Date().toISOString()})}),
    del: (table, id) => rest(table + '?id=eq.' + encodeURIComponent(id), {method: 'DELETE'}),
  };
})();
