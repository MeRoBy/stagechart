/**
 * StageChart — Skálázható Licenc és Trial Modul (.exe előkészület)
 * Fájl: js/license.js
 *
 * Aszinkron API-hívásokra felkészített, de egyelőre "Mock" (szimulált) szerverválaszokkal dolgozik.
 * Később elég a `StageChartLicense.setApi({...})` hívással (vagy az `ApiClient` lecserélésével) valódi szerverre kötni:
 *   - activate(key)  -> Promise<{ ok: boolean, plan?: string, token?: string, error?: string }>
 *   - verify(stored) -> Promise<{ valid: boolean, revoked?: boolean }>
 */
window.StageChartLicense = (function () {
  const STORAGE_KEY = 'stagechart_license_v1';
  const TRIAL_SONG_LIMIT = 10;
  const listeners = [];

  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  /** Szimulált licencszerver. A "STAGE-VIP" kód érvényes. */
  const MockApi = {
    latencyMs: 700,
    async activate(key) {
      await sleep(this.latencyMs);
      const clean = String(key || '').trim().toUpperCase();
      if (clean === 'STAGE-VIP') {
        return {
          ok: true,
          plan: 'VIP',
          token: 'mock-token-' + Math.random().toString(36).slice(2, 12)
        };
      }
      return { ok: false, error: 'invalid_key' };
    },
    async verify(stored) {
      await sleep(150);
      return { valid: !!(stored && String(stored.key || '').toUpperCase() === 'STAGE-VIP') };
    }
  };

  let api = MockApi;
  let state = { active: false, key: '', plan: '', token: '', activatedAt: 0 };

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (raw && raw.active && raw.key) {
        state = {
          active: true,
          key: raw.key,
          plan: raw.plan || 'VIP',
          token: raw.token || '',
          activatedAt: raw.activatedAt || Date.now()
        };
      }
    } catch (e) {}
  }

  function save() {
    try {
      if (state.active) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function emit() {
    listeners.forEach(cb => {
      try { cb(getStatus()); } catch (e) {}
    });
  }

  function getStatus() {
    return {
      active: !!state.active,
      plan: state.active ? state.plan : 'TRIAL',
      key: state.active ? state.key : '',
      activatedAt: state.activatedAt,
      trialSongLimit: TRIAL_SONG_LIMIT
    };
  }

  /** Betöltés + háttérben történő (nem blokkoló) szerveres ellenőrzés. Offline állapotban a licenc érvényben marad. */
  function init() {
    load();
    if (state.active) {
      api.verify(state).then(res => {
        if (res && res.revoked === true) {
          state = { active: false, key: '', plan: '', token: '', activatedAt: 0 };
          save();
          emit();
        }
      }).catch(() => { /* hálózati hiba: a mentett licenc érvényben marad */ });
    }
    return getStatus();
  }

  async function activate(key) {
    const clean = String(key || '').trim();
    if (!clean) return { ok: false, error: 'empty' };
    try {
      const res = await api.activate(clean);
      if (res && res.ok) {
        state = {
          active: true,
          key: clean.toUpperCase(),
          plan: res.plan || 'VIP',
          token: res.token || '',
          activatedAt: Date.now()
        };
        save();
        emit();
        return { ok: true, plan: state.plan };
      }
      return { ok: false, error: (res && res.error) || 'invalid_key' };
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }

  function deactivate() {
    state = { active: false, key: '', plan: '', token: '', activatedAt: 0 };
    save();
    emit();
  }

  function onChange(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  function setApi(customApi) {
    if (customApi && typeof customApi.activate === 'function' && typeof customApi.verify === 'function') {
      api = customApi;
    }
  }

  return {
    TRIAL_SONG_LIMIT,
    init,
    activate,
    deactivate,
    onChange,
    setApi,
    getStatus,
    isActive: () => !!state.active
  };
})();
