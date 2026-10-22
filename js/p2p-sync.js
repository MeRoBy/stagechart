/**
 * StageChart — Hibrid Zenekari Szinkronizáció (szerver nélküli Peer-to-Peer, WebRTC / PeerJS)
 * Fájl: js/p2p-sync.js
 *
 * - Nincs saját szerver: a zenészek eszközei közvetlenül, WebRTC adatcsatornán kapcsolódnak egymáshoz.
 *   (A PeerJS ingyenes nyilvános "broker" szolgáltatását csak a kapcsolat felépítéséhez - handshake - használja,
 *   a setlista és a vezérlőüzenetek már közvetlenül a két eszköz között mennek.)
 * - Leader: egyedi, 5 jegyű PIN-ből képzett Peer ID-t regisztrál. Amint egy Follower csatlakozik, azonnal elküldi neki
 *   a teljes aktuális setlistát (SETLIST_FULL), hogy a Follower előtöltse a memóriát.
 * - Follower: PIN alapján csatlakozik. Szívverés (PING/PONG) figyeli a kapcsolatot; szakadás esetén "offline" állapotba
 *   lép (a UI NEM fagy le, a letöltött setlista lapozható), és a háttérben automatikusan újracsatlakozni próbál.
 *
 * Követelmény: a PeerJS könyvtár (window.Peer) betöltése (index.html).
 */
window.StageChartP2P = (function () {
  const ID_PREFIX = 'stagechart-';
  const HEARTBEAT_MS = 3000;
  const LEADER_PRUNE_MS = 15000;
  const FOLLOWER_TIMEOUT_MS = 9500;
  const RECONNECT_MS = 5000;
  const CONNECT_TIMEOUT_MS = 12000;

  let role = 'off';
  let peer = null;
  let handlers = {};
  let pin = null;

  // Leader állapot
  let leaderConns = [];
  let heartbeatTimer = null;

  // Follower állapot
  let leaderConn = null;
  let joinPin = null;
  let lastSeen = 0;
  let online = false;
  let everConnected = false;
  let connecting = false;
  let watchdogTimer = null;
  let reconnectTimer = null;

  function isAvailable() {
    return typeof window.Peer === 'function';
  }

  function safeSend(conn, data) {
    try {
      if (conn && conn.open) {
        conn.send(data);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function destroyPeer() {
    if (peer) {
      try { peer.destroy(); } catch (e) {}
      peer = null;
    }
  }

  function emitStatus(evt) {
    if (handlers && typeof handlers.onStatus === 'function') {
      try { handlers.onStatus(evt); } catch (e) {}
    }
  }

  /********************************************************************
   * LEADER
   ********************************************************************/
  function generatePin() {
    return String(Math.floor(10000 + Math.random() * 90000));
  }

  function sendFull(conn) {
    if (!handlers || typeof handlers.getSnapshot !== 'function') return;
    let snap = null;
    try { snap = handlers.getSnapshot(); } catch (e) { snap = null; }
    if (snap) safeSend(conn, snap);
  }

  function notifyLeaderCount() {
    emitStatus({ followers: leaderConns.length });
  }

  function startHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      const now = Date.now();
      leaderConns.slice().forEach(c => {
        if (now - (c._lastSeen || 0) > LEADER_PRUNE_MS) {
          leaderConns = leaderConns.filter(x => x !== c);
          try { c.close(); } catch (e) {}
          notifyLeaderCount();
          return;
        }
        safeSend(c, { type: 'PING', t: now });
      });
    }, HEARTBEAT_MS);
  }

  function setupLeaderPeer(p) {
    p.on('connection', (conn) => {
      conn.on('open', () => {
        conn._lastSeen = Date.now();
        leaderConns.push(conn);
        sendFull(conn); // Azonnali előtöltés: teljes setlista a Followernek
        notifyLeaderCount();
      });
      conn.on('data', (msg) => {
        conn._lastSeen = Date.now();
        if (msg && msg.type === 'REQUEST_STATE') sendFull(conn);
      });
      const drop = () => {
        leaderConns = leaderConns.filter(c => c !== conn);
        notifyLeaderCount();
      };
      conn.on('close', drop);
      conn.on('error', drop);
    });
    p.on('disconnected', () => {
      // A közvetítő szerverrel megszakadt a kapcsolat, de a már élő adatcsatornák működnek tovább: újracsatlakozás a háttérben
      try { p.reconnect(); } catch (e) {}
    });
    p.on('error', () => { /* megnyitás után nem dobunk hibát a felhasználónak */ });
  }

  function startLeader(h) {
    stop();
    handlers = h || {};
    role = 'leader';
    return new Promise((resolve, reject) => {
      let attempts = 0;
      let done = false;

      const fail = (err) => {
        if (done) return;
        done = true;
        clearTimeout(globalTimeout);
        stop();
        reject(err);
      };

      const globalTimeout = setTimeout(() => {
        fail(Object.assign(new Error('timeout'), { type: 'timeout' }));
      }, 15000);

      const tryOpen = () => {
        attempts++;
        const candidate = generatePin();
        let p;
        try {
          p = new window.Peer(ID_PREFIX + candidate);
        } catch (e) {
          fail(e);
          return;
        }
        peer = p;
        let opened = false;

        p.on('open', () => {
          if (done) return;
          opened = true;
          done = true;
          clearTimeout(globalTimeout);
          pin = candidate;
          setupLeaderPeer(p);
          startHeartbeat();
          resolve(pin);
        });
        p.on('error', (err) => {
          if (opened || done) return;
          try { p.destroy(); } catch (e) {}
          if (err && err.type === 'unavailable-id' && attempts < 6) {
            tryOpen(); // foglalt PIN: új PIN-nel próbáljuk
            return;
          }
          fail(err);
        });
      };
      tryOpen();
    });
  }

  function broadcast(payload) {
    if (role !== 'leader') return;
    leaderConns.forEach(c => safeSend(c, payload));
  }

  function resend() {
    if (role !== 'leader') return;
    leaderConns.forEach(sendFull);
  }

  /********************************************************************
   * FOLLOWER
   ********************************************************************/
  function onFollowerData(msg) {
    lastSeen = Date.now();
    if (!msg) return;
    if (msg.type === 'PING') {
      safeSend(leaderConn, { type: 'PONG', t: msg.t });
      return;
    }
    if (handlers && typeof handlers.onMessage === 'function') {
      try { handlers.onMessage(msg); } catch (e) { console.warn('Sync üzenet feldolgozási hiba:', e); }
    }
  }

  function setOnline() {
    const was = online;
    online = true;
    everConnected = true;
    clearInterval(reconnectTimer);
    reconnectTimer = null;
    if (!was) emitStatus({ state: 'online' });
  }

  function goOffline() {
    if (role !== 'follower' || !everConnected) return;
    const was = online;
    online = false;
    const c = leaderConn;
    leaderConn = null; // a 'close' eseménykezelő így nem fut rekurzióba
    try { if (c) c.close(); } catch (e) {}
    scheduleReconnect();
    if (was) emitStatus({ state: 'offline' });
  }

  function scheduleReconnect() {
    if (reconnectTimer || role !== 'follower') return;
    reconnectTimer = setInterval(() => {
      if (online || connecting || role !== 'follower') return;
      if (navigator.onLine === false) return;
      connectToLeader().catch(() => { /* következő ciklusban újra próbáljuk */ });
    }, RECONNECT_MS);
  }

  function connectToLeader() {
    return new Promise((resolve, reject) => {
      if (connecting) {
        reject(new Error('busy'));
        return;
      }
      connecting = true;
      destroyPeer();
      leaderConn = null;
      let settled = false;
      let timeoutId = null;

      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        connecting = false;
        if (err) {
          destroyPeer();
          reject(err);
        } else {
          resolve();
        }
      };

      timeoutId = setTimeout(() => {
        finish(Object.assign(new Error('timeout'), { type: 'timeout' }));
      }, CONNECT_TIMEOUT_MS);

      let p;
      try {
        p = new window.Peer();
      } catch (e) {
        finish(e);
        return;
      }
      peer = p;

      p.on('error', (err) => {
        if (!settled) finish(err);
        else goOffline();
      });

      p.on('open', () => {
        const c = p.connect(ID_PREFIX + joinPin, { reliable: true });
        leaderConn = c;
        c.on('open', () => {
          lastSeen = Date.now();
          setOnline();
          finish();
        });
        c.on('data', onFollowerData);
        c.on('close', () => { if (leaderConn === c) goOffline(); });
        c.on('error', () => { if (leaderConn === c) goOffline(); });
      });
    });
  }

  function startWatchdog() {
    clearInterval(watchdogTimer);
    watchdogTimer = setInterval(() => {
      if (role === 'follower' && online && Date.now() - lastSeen > FOLLOWER_TIMEOUT_MS) {
        goOffline();
      }
    }, 2000);
  }

  function join(pinStr, h) {
    stop();
    handlers = h || {};
    role = 'follower';
    joinPin = String(pinStr);
    return connectToLeader()
      .then(() => {
        startWatchdog();
      })
      .catch((err) => {
        stop();
        throw err;
      });
  }

  window.addEventListener('offline', () => {
    if (role === 'follower') goOffline();
  });
  window.addEventListener('online', () => {
    if (role === 'follower' && everConnected && !online && !connecting) {
      connectToLeader().catch(() => {});
    }
  });

  /********************************************************************
   * KÖZÖS
   ********************************************************************/
  function stop() {
    clearInterval(heartbeatTimer);
    clearInterval(watchdogTimer);
    clearInterval(reconnectTimer);
    heartbeatTimer = watchdogTimer = reconnectTimer = null;
    leaderConns.forEach(c => { try { c.close(); } catch (e) {} });
    leaderConns = [];
    const c = leaderConn;
    leaderConn = null;
    try { if (c) c.close(); } catch (e) {}
    destroyPeer();
    role = 'off';
    pin = null;
    joinPin = null;
    online = false;
    everConnected = false;
    connecting = false;
  }

  function getState() {
    return {
      role,
      pin,
      followers: leaderConns.length,
      online
    };
  }

  return {
    isAvailable,
    startLeader,
    join,
    broadcast,
    resend,
    stop,
    getState
  };
})();
