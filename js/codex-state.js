(function(root) {
  function state(e, now = Date.now()) {
    if (e.connected === false || e.reported === false || e.limit !== 100 ||
        typeof e.used !== 'number' || !Number.isFinite(e.used) || e.used < 0 || e.used > 100) return 'unavailable';
    const updated = Date.parse(e.updated_at), reset = Date.parse(e.reset_at);
    if (e.stale || e.updated_at_unknown || !Number.isFinite(updated) || updated > now + 60000 ||
        now - updated > 24 * 3600e3 || (Number.isFinite(reset) && reset <= now)) return 'stale';
    return 'fresh';
  }
  root.CodexState = {state};
})(typeof window === 'undefined' ? globalThis : window);
