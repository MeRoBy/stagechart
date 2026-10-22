/**
 * StageChart — Nemzetköziesítés (i18n) és Dinamikus Témaválasztó
 * Fájl: js/i18n.js
 *
 * - Nyelvváltás oldalfrissítés nélkül: a HTML elemek `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`
 *   attribútumai alapján. A magyar (alap) szöveg az eredeti HTML-ben marad, így visszaváltáskor pontosan visszaáll.
 * - Témaválasztás: a `body` elem CSS-változóinak (:root változók felülbírálása) dinamikus cseréje + `data-theme` attribútum.
 */
window.StageChartI18n = (function () {
  const DICT = {
    hu: {
      'settings.title': 'Beállítások',
      'nav.ui': 'Felület',
      'nav.display': 'Ének megjelenítése',
      'nav.fab': 'Élő gombok:',
      'nav.audio': 'Audio & Csatorna-routing',
      'nav.pedals': 'Lábkapcsolók és vezérlők',
      'nav.chords': 'Akkord diagramok',
      'nav.print': 'Nyomtatás',
      'nav.backup': 'Biztonsági mentés és szinkronizáció',
      'nav.groups': 'StageChart Groups (Live Sync)',
      'nav.license': 'Licenc',
      'nav.about': 'Rólunk, Dokumentáció, Támogatás',

      'ui.h1': 'Felület',
      'ui.general': 'Általános',
      'ui.language': 'Nyelv',
      'ui.language.desc': 'A felület nyelve (azonnal vált, frissítés nélkül)',
      'lang.hu': 'Magyar',
      'lang.en': 'Angol',
      'ui.theme': 'Téma',
      'ui.theme.desc': 'A teljes felület színvilága és stílusa',
      'theme.default': 'Alapértelmezett (világos / sötét)',
      'theme.oled': 'OLED Színpad',
      'theme.studio': 'Stúdió',
      'theme.acoustic': 'Akusztikus',
      'theme.glass': 'Modern Glass',
      'ui.darkmode': 'Sötét mód',
      'ui.sidebar': 'Oldalsáv',
      'ui.navigation': 'Navigáció',
      'ui.quick': 'Gyorsműveletek',
      'ui.hideTopbar': 'Felső sáv elrejtése',
      'ui.stageDimmer': 'Színpadi fényerő-kímélő mód',
      'ui.compactSidebar': 'Kompakt oldalsáv',
      'ui.numberSongs': 'Énekek sorszámozása a listákban',
      'ui.touchZones': 'Érintési zónák engedélyezése',
      'ui.swipeTurn': 'Lapozás oldalra húzással',
      'ui.webSearch': 'Webes lejátszó keresés',

      'license.h1': 'Licenc',
      'license.status': 'Állapot',
      'license.status.trial': 'Próbaverzió',
      'license.status.active': 'Aktív licenc',
      'license.songs': 'Daltár: {n} / {max} ének',
      'license.songs.unlimited': 'Daltár: {n} ének (korlátlan)',
      'license.enter': 'Licenc megadása',
      'license.enter.desc': 'Írd be a vásárláskor kapott licenckulcsot a korlátlan daltárhoz.',
      'license.placeholder': 'Licenckulcs',
      'license.activate': 'Aktiválás',
      'license.checking': 'Ellenőrzés...',
      'license.invalid': 'Érvénytelen licenckulcs.',
      'license.empty': 'Kérlek, add meg a licenckulcsot.',
      'license.success': '✓ Sikeres aktiválás! A daltár mostantól korlátlan.',
      'license.network': 'A licencszerver nem érhető el. Próbáld újra később.',
      'license.deactivate': 'Licenc eltávolítása',
      'license.locked.tip': 'A próbaverzió limitje betelt — add meg a licenckulcsot.',
      'trial.title': 'A próbaverzió limitje betelt',
      'trial.body': 'A próbaverzióban legfeljebb {max} éneket tárolhatsz a daltárban. Az „Új ének” és az „Importálás” funkciók le vannak tiltva. Add meg a licenckulcsot a korlátlan daltárhoz!',
      'trial.enter': 'Licenc megadása',
      'trial.later': 'Később',

      'sync.h1': 'StageChart Groups — Zenekari Szinkron',
      'sync.desc': 'Kapcsold össze a zenekar eszközeit szerver nélkül (közvetlen WebRTC kapcsolat). A Leader dalt vált, transzponál vagy színpadi jelzést küld — a Follower eszközök azonnal követik, és a teljes setlistát előre letöltik, így hálózati szakadás esetén is lapozhatók maradnak.',
      'sync.start': 'Szinkronizáció indítása (Leader)',
      'sync.join': 'Csatlakozás zenekarhoz (Follower)',
      'sync.stop': 'Szinkron leállítása',
      'sync.status.off': 'Nincs aktív szinkron.',
      'sync.status.leader': 'Leader aktív — PIN: {pin} · {n} csatlakozott zenész',
      'sync.status.follower.online': 'Follower — online, szinkronban',
      'sync.status.follower.offline': 'Follower — OFFLINE MÓD (a lista helyben lapozható)',
      'sync.leader.title': 'Zenekari szinkron — Leader',
      'sync.leader.pin': 'Ezt a PIN kódot add meg a zenészeknek',
      'sync.leader.waiting': 'Várakozás a csatlakozókra...',
      'sync.leader.count': '{n} zenész csatlakozva',
      'sync.leader.generating': 'PIN generálása...',
      'sync.resend': 'Setlista újraküldése',
      'sync.resent': 'Setlista újraküldve a zenészeknek',
      'sync.join.title': 'Csatlakozás zenekarhoz',
      'sync.join.hint': 'Írd be a Leader képernyőjén látható PIN kódot.',
      'sync.join.pin': 'PIN kód',
      'sync.join.btn': 'Csatlakozás',
      'sync.connecting': 'Csatlakozás...',
      'sync.connected': '✓ Csatlakozva! A setlista letöltése folyamatban...',
      'sync.online': 'Online — szinkronban a Leaderrel',
      'sync.offline': 'Offline mód — a letöltött setlista a saját gépeden lapozható',
      'sync.reconnecting': 'Újracsatlakozás...',
      'sync.received': 'Setlista megérkezett: {name} ({n} ének)',
      'sync.err.lib': 'A PeerJS (WebRTC) könyvtár nem érhető el — a kapcsolat felépítéséhez egyszeri internetkapcsolat szükséges.',
      'sync.err.pin': 'Érvénytelen PIN (4–6 számjegy).',
      'sync.err.notfound': 'Nem található ilyen PIN-nel induló zenekar.',
      'sync.err.generic': 'A csatlakozás nem sikerült. Ellenőrizd a hálózatot és próbáld újra.',
      'sync.adhoc': 'Zenekari ének',
      'sync.qr.unavailable': 'A QR-kód nem jeleníthető meg (a generátor könyvtár nem töltődött be) — használd a PIN kódot.',
      'sync.qr.file': 'Figyelem: helyi fájlból futtatva a link telefonon nem nyílik meg, ilyenkor használd a PIN kódot.',
      'sync.badge.leader': 'KARMESTER (ADÓ)',
      'sync.badge.follower': 'KÖVETŐ (VEVŐ)',
      'sync.badge.offline': 'OFFLINE MÓD',
      'common.close': 'Bezárás'
    },
    en: {
      'settings.title': 'Settings',
      'nav.ui': 'Interface',
      'nav.display': 'Song display',
      'nav.fab': 'Floating buttons',
      'nav.audio': 'Audio & Channel routing',
      'nav.pedals': 'Pedals & controllers',
      'nav.chords': 'Chord diagrams',
      'nav.print': 'Printing',
      'nav.backup': 'Backup & synchronization',
      'nav.groups': 'StageChart Groups (Live Sync)',
      'nav.license': 'License',
      'nav.about': 'About, Documentation, Support',

      'ui.h1': 'Interface',
      'ui.general': 'General',
      'ui.language': 'Language',
      'ui.language.desc': 'Interface language (switches instantly, no reload)',
      'lang.hu': 'Hungarian',
      'lang.en': 'English',
      'ui.theme': 'Theme',
      'ui.theme.desc': 'Colors and style of the whole interface',
      'theme.default': 'Default (light / dark)',
      'theme.oled': 'OLED Stage',
      'theme.studio': 'Studio',
      'theme.acoustic': 'Acoustic',
      'theme.glass': 'Modern Glass',
      'ui.darkmode': 'Dark mode',
      'ui.sidebar': 'Sidebar',
      'ui.navigation': 'Navigation',
      'ui.quick': 'Quick actions',
      'ui.hideTopbar': 'Hide top bar',
      'ui.stageDimmer': 'Stage screen dimmer',
      'ui.compactSidebar': 'Compact sidebar',
      'ui.numberSongs': 'Number songs in lists',
      'ui.touchZones': 'Enable touch zones',
      'ui.swipeTurn': 'Swipe to turn pages',
      'ui.webSearch': 'Web player search',

      'license.h1': 'License',
      'license.status': 'Status',
      'license.status.trial': 'Trial version',
      'license.status.active': 'License active',
      'license.songs': 'Library: {n} / {max} songs',
      'license.songs.unlimited': 'Library: {n} songs (unlimited)',
      'license.enter': 'Enter license',
      'license.enter.desc': 'Enter the license key you received to unlock an unlimited song library.',
      'license.placeholder': 'License key',
      'license.activate': 'Activate',
      'license.checking': 'Checking...',
      'license.invalid': 'Invalid license key.',
      'license.empty': 'Please enter your license key.',
      'license.success': '✓ Activated! Your song library is now unlimited.',
      'license.network': 'License server unreachable. Please try again later.',
      'license.deactivate': 'Remove license',
      'license.locked.tip': 'Trial limit reached — please enter your license key.',
      'trial.title': 'Trial limit reached',
      'trial.body': 'The trial version can store up to {max} songs. "New song" and "Import" are disabled. Enter your license key to unlock an unlimited library!',
      'trial.enter': 'Enter license',
      'trial.later': 'Later',

      'sync.h1': 'StageChart Groups — Band Sync',
      'sync.desc': 'Connect the band\'s devices without a server (direct WebRTC link). The Leader changes songs, transposes or sends stage cues — Followers follow instantly and pre-download the whole setlist, so they can keep paging even if the network drops.',
      'sync.start': 'Start synchronization (Leader)',
      'sync.join': 'Join the band (Follower)',
      'sync.stop': 'Stop synchronization',
      'sync.status.off': 'No active synchronization.',
      'sync.status.leader': 'Leader active — PIN: {pin} · {n} musician(s) connected',
      'sync.status.follower.online': 'Follower — online, in sync',
      'sync.status.follower.offline': 'Follower — OFFLINE MODE (list can be paged locally)',
      'sync.leader.title': 'Band sync — Leader',
      'sync.leader.pin': 'Give this PIN code to the musicians',
      'sync.leader.waiting': 'Waiting for musicians to join...',
      'sync.leader.count': '{n} musician(s) connected',
      'sync.leader.generating': 'Generating PIN...',
      'sync.resend': 'Resend setlist',
      'sync.resent': 'Setlist re-sent to the musicians',
      'sync.join.title': 'Join the band',
      'sync.join.hint': 'Enter the PIN shown on the Leader\'s screen.',
      'sync.join.pin': 'PIN code',
      'sync.join.btn': 'Join',
      'sync.connecting': 'Connecting...',
      'sync.connected': '✓ Connected! Downloading the setlist...',
      'sync.online': 'Online — in sync with the Leader',
      'sync.offline': 'Offline mode — the downloaded setlist can be paged on this device',
      'sync.reconnecting': 'Reconnecting...',
      'sync.received': 'Setlist received: {name} ({n} songs)',
      'sync.err.lib': 'The PeerJS (WebRTC) library is unavailable — a one-time internet connection is required to establish the link.',
      'sync.err.pin': 'Invalid PIN (4–6 digits).',
      'sync.err.notfound': 'No band found with this PIN.',
      'sync.err.generic': 'Connection failed. Check your network and try again.',
      'sync.adhoc': 'Band song',
      'sync.qr.unavailable': 'QR code unavailable (generator library failed to load) — please use the PIN.',
      'sync.qr.file': 'Note: when run from a local file the link will not open on a phone — use the PIN instead.',
      'sync.badge.leader': 'LEADER (SENDER)',
      'sync.badge.follower': 'FOLLOWER (RECEIVER)',
      'sync.badge.offline': 'OFFLINE MODE',
      'common.close': 'Close'
    }
  };

  /**
   * Témák: CSS-változók (a style.css :root / body.dark-mode változóinak felülbírálása a body elemen).
   * Az "default" téma nem ír felül semmit, így a jelenlegi világos/sötét mód változatlanul működik.
   */
  const THEMES = {
    default: {},
    oled: {
      '--bg-app': '#000000',
      '--bg-sheet': '#000000',
      '--bg-topbar': '#000000',
      '--bg-panel': 'rgba(0, 0, 0, 0.97)',
      '--bg-sidebar': '#000000',
      '--bg-card': '#0a0a0a',
      '--bg-hover': '#161100',
      '--text-main': '#ffb000',
      '--text-muted': '#a87400',
      '--accent': '#39ff14',
      '--accent-hover': '#2bd10f',
      '--accent-soft': 'rgba(57, 255, 20, 0.14)',
      '--border': '#2b2000',
      '--danger': '#ff4d4d',
      '--chord-color': '#39ff14',
      '--notes-color': '#a87400',
      '--shadow-lg': 'none',
      '--shadow-md': 'none',
      '--shadow-sm': 'none'
    },
    studio: {
      '--bg-app': '#1e1f22',
      '--bg-sheet': '#26272b',
      '--bg-topbar': '#2b2d31',
      '--bg-panel': '#2b2d31',
      '--bg-sidebar': '#232428',
      '--bg-card': '#2b2d31',
      '--bg-hover': '#36383e',
      '--text-main': '#e3e5e8',
      '--text-muted': '#9a9ea6',
      '--accent': '#ff7a1a',
      '--accent-hover': '#ff9442',
      '--accent-soft': 'rgba(255, 122, 26, 0.16)',
      '--border': '#3a3c42',
      '--chord-color': '#ffb74d',
      '--notes-color': '#9a9ea6',
      '--shadow-lg': 'none',
      '--shadow-md': 'none',
      '--shadow-sm': 'none',
      '--radius-lg': '3px',
      '--radius-md': '2px',
      '--radius-sm': '2px'
    },
    acoustic: {
      '--bg-app': '#f3ead6',
      '--bg-sheet': '#fbf5e6',
      '--bg-topbar': '#eee4cb',
      '--bg-panel': 'rgba(251, 245, 230, 0.97)',
      '--bg-sidebar': '#f0e6cf',
      '--bg-card': '#fbf5e6',
      '--bg-hover': '#e8dcc0',
      '--text-main': '#3b2a1a',
      '--text-muted': '#7a6650',
      '--accent': '#8b5a2b',
      '--accent-hover': '#6f4520',
      '--accent-soft': 'rgba(139, 90, 43, 0.14)',
      '--border': '#d9c9a6',
      '--chord-color': '#7b3f00',
      '--notes-color': '#8a7358',
      '--shadow-lg': '0 14px 36px rgba(80, 55, 20, 0.16)',
      '--shadow-md': '0 6px 18px rgba(80, 55, 20, 0.10)',
      '--shadow-sm': '0 2px 6px rgba(80, 55, 20, 0.08)'
    },
    glass: {
      '--bg-app': '#e6ecfa',
      '--bg-sheet': 'rgba(255, 255, 255, 0.55)',
      '--bg-topbar': 'rgba(255, 255, 255, 0.45)',
      '--bg-panel': 'rgba(255, 255, 255, 0.62)',
      '--bg-sidebar': 'rgba(255, 255, 255, 0.50)',
      '--bg-card': 'rgba(255, 255, 255, 0.60)',
      '--bg-hover': 'rgba(255, 255, 255, 0.75)',
      '--text-main': '#1d1d1f',
      '--text-muted': '#5c5c63',
      '--accent': '#007aff',
      '--accent-hover': '#0062cc',
      '--accent-soft': 'rgba(0, 122, 255, 0.14)',
      '--border': 'rgba(255, 255, 255, 0.7)',
      '--chord-color': '#0a5fd0',
      '--shadow-lg': '0 18px 48px rgba(31, 38, 135, 0.22)',
      '--shadow-md': '0 8px 24px rgba(31, 38, 135, 0.14)',
      '--shadow-sm': '0 2px 10px rgba(31, 38, 135, 0.10)',
      '--radius-lg': '20px',
      '--radius-md': '14px',
      '--radius-sm': '10px'
    }
  };

  let currentLang = 'hu';
  let currentTheme = 'default';
  let appliedVars = [];

  function t(key, params) {
    const dict = DICT[currentLang] || DICT.hu;
    let str = dict[key];
    if (str === undefined) str = DICT.hu[key];
    if (str === undefined) return key;
    if (params) {
      Object.keys(params).forEach(k => {
        str = str.split('{' + k + '}').join(String(params[k]));
      });
    }
    return str;
  }

  /** Egy elem eredeti (magyar) szövegének eltárolása az első cserénél. */
  function rememberOriginal(el, prop, datasetKey) {
    if (el.dataset[datasetKey] === undefined) {
      el.dataset[datasetKey] = prop === 'text' ? el.textContent : (el.getAttribute(prop) || '');
    }
    return el.dataset[datasetKey];
  }

  function applyLanguage(lang, root) {
    if (!DICT[lang]) lang = 'hu';
    currentLang = lang;
    document.documentElement.lang = lang;
    const scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach(el => {
      const orig = rememberOriginal(el, 'text', 'i18nOrig');
      const val = DICT[lang][el.dataset.i18n];
      el.textContent = val !== undefined ? val : orig;
    });
    scope.querySelectorAll('[data-i18n-title]').forEach(el => {
      const orig = rememberOriginal(el, 'title', 'i18nOrigTitle');
      const val = DICT[lang][el.dataset.i18nTitle];
      el.setAttribute('title', val !== undefined ? val : orig);
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const orig = rememberOriginal(el, 'placeholder', 'i18nOrigPh');
      const val = DICT[lang][el.dataset.i18nPlaceholder];
      el.setAttribute('placeholder', val !== undefined ? val : orig);
    });

    const sel = document.getElementById('setLanguageSelect');
    if (sel) sel.value = lang;
    document.dispatchEvent(new CustomEvent('stagechart:languagechange', { detail: { lang } }));
  }

  function applyTheme(name) {
    if (!THEMES[name]) name = 'default';
    currentTheme = name;
    const body = document.body;
    appliedVars.forEach(v => body.style.removeProperty(v));
    appliedVars = [];
    Object.keys(THEMES[name]).forEach(k => {
      body.style.setProperty(k, THEMES[name][k]);
      appliedVars.push(k);
    });
    body.setAttribute('data-theme', name);
    const sel = document.getElementById('setThemeSelect');
    if (sel) sel.value = name;
    document.dispatchEvent(new CustomEvent('stagechart:themechange', { detail: { theme: name } }));
  }

  return {
    t,
    applyLanguage,
    applyTheme,
    getLanguage: () => currentLang,
    getTheme: () => currentTheme,
    themes: Object.keys(THEMES)
  };
})();
