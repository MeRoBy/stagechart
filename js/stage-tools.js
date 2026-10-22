/**
 * StageChart — Próbatermi és Színpadi Okos Eszközök
 * (Section Looper, Gig Clock, Stage Cues, Band Sync, Web MIDI, Ki-be kapcsolható Kamera Lapozás, Wake Lock)
 * Fájl: js/stage-tools.js
 */

window.StageChartStageTools = (function () {
  // 1. Section Looper (Szakasz-ismétlő)
  let activeLoopSection = null; // { name, element, bars, currentBar }

  // 2. Gig Clock (Koncert visszaszámláló)
  let gigClockRunning = false;
  let gigRemainingSec = 45 * 60;
  let gigTotalSec = 45 * 60;
  let gigInterval = null;

  // 3. Band Sync (Karmester mód)
  let syncChannel = null;
  let syncRole = 'off'; // 'off', 'leader', 'follower'
  let onSyncMessageCallback = null;

  // 4. Web MIDI
  let midiAccess = null;
  let midiOutputs = [];
  let onMidiCommandCallback = null;

  // 5. Webkamera mozdulat-lapozás (SZIGORÚAN KI-BE KAPCSOLHATÓ)
  let webcamActive = false;
  let webcamStream = null;
  let webcamInterval = null;
  let lastGestureTime = 0;

  // 6. Wake Lock & Színpadi Dimmer
  let wakeLockSentinel = null;
  let idleTimer = null;

  /********************************************************************
   * 1. SECTION LOOPER (SZAKASZ-ISMÉTLŐ HUROK PRÓBÁHOZ)
   ********************************************************************/
  function toggleSectionLoop(sectionName, sectionEl, barsCount = 8) {
    if (activeLoopSection && activeLoopSection.name === sectionName) {
      activeLoopSection = null;
      document.querySelectorAll('.song-section.looping-active').forEach(el => el.classList.remove('looping-active'));
      return null;
    }
    document.querySelectorAll('.song-section.looping-active').forEach(el => el.classList.remove('looping-active'));
    if (sectionEl) sectionEl.classList.add('looping-active');
    activeLoopSection = {
      name: sectionName,
      element: sectionEl,
      bars: barsCount,
      currentBar: 0
    };
    if (sectionEl) {
      sectionEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return activeLoopSection;
  }

  function clearSectionLoop() {
    activeLoopSection = null;
    document.querySelectorAll('.song-section.looping-active').forEach(el => el.classList.remove('looping-active'));
  }

  function getActiveLoopSection() {
    return activeLoopSection;
  }

  function onBarAdvanced() {
    if (!activeLoopSection) return;
    activeLoopSection.currentBar++;
    if (activeLoopSection.currentBar >= activeLoopSection.bars) {
      activeLoopSection.currentBar = 0;
      if (activeLoopSection.element) {
        activeLoopSection.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  /********************************************************************
   * 2. GIG CLOCK & SETLIST TRACKER (KONCERT IDŐZÍTŐ ÉS KALKULÁTOR)
   ********************************************************************/
  function parseDurationToSec(durStr) {
    if (!durStr) return 210; // alap 3:30
    const parts = String(durStr).trim().split(':');
    if (parts.length === 2) {
      return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    }
    return 210;
  }

  function formatSecToMinSec(totalSec) {
    const abs = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(abs / 60);
    const s = String(abs % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function calculateSetlistTotalDuration(songsList) {
    let totalSec = 0;
    songsList.forEach(s => {
      totalSec += parseDurationToSec(s.duration);
    });
    const mins = Math.floor(totalSec / 60);
    const secs = String(totalSec % 60).padStart(2, '0');
    return { totalSec, formatted: `${mins} perc ${secs} mp` };
  }

  function startGigClock(minutes, onTick) {
    stopGigClock();
    gigTotalSec = (parseInt(minutes, 10) || 45) * 60;
    gigRemainingSec = gigTotalSec;
    gigClockRunning = true;

    if (onTick) onTick(getGigClockStatus());
    gigInterval = setInterval(() => {
      gigRemainingSec--;
      if (onTick) onTick(getGigClockStatus());
      if (gigRemainingSec <= 0) {
        stopGigClock();
      }
    }, 1000);
  }

  function stopGigClock() {
    if (gigInterval) {
      clearInterval(gigInterval);
      gigInterval = null;
    }
    gigClockRunning = false;
  }

  function getGigClockStatus() {
    const ratio = gigTotalSec > 0 ? gigRemainingSec / gigTotalSec : 1;
    let statusColor = '#10b981'; // Zöld
    if (ratio <= 0.15 || gigRemainingSec <= 300) statusColor = '#ef4444'; // Piros (utolsó 5 perc)
    else if (ratio <= 0.35) statusColor = '#f59e0b'; // Sárga
    return {
      running: gigClockRunning,
      remainingSec: gigRemainingSec,
      formatted: formatSecToMinSec(gigRemainingSec),
      color: statusColor
    };
  }

  /********************************************************************
   * 3. STAGE CUES (SZÍNPADI VÉSZJELZŐ / ÜZENETKÜLDŐ)
   ********************************************************************/
  function showStageCueBanner(text, durationMs = 4500, broadcast = true) {
    let banner = document.getElementById('stageCueFloatingBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'stageCueFloatingBanner';
      banner.className = 'stage-cue-banner';
      document.body.appendChild(banner);
    }
    banner.textContent = text;
    banner.classList.add('visible');

    if (broadcast && syncRole === 'leader') {
      broadcastSyncEvent({ type: 'STAGE_CUE', text });
    }

    clearTimeout(banner._hideTimer);
    banner._hideTimer = setTimeout(() => {
      banner.classList.remove('visible');
    }, durationMs);
  }

  /********************************************************************
   * 4. BAND SYNC / KARMESTER MÓD (VALÓS IDEJŰ SZINKRON)
   ********************************************************************/
  function initBandSync(role = 'off', onMessage = null) {
    syncRole = role;
    onSyncMessageCallback = onMessage;
    if (syncChannel) {
      syncChannel.close();
      syncChannel = null;
    }
    if (role !== 'off' && 'BroadcastChannel' in window) {
      syncChannel = new BroadcastChannel('stagechart_live_sync');
      syncChannel.onmessage = (ev) => {
        if (syncRole === 'follower' && onSyncMessageCallback) {
          onSyncMessageCallback(ev.data);
        }
      };
    }
    return syncRole;
  }

  function broadcastSyncEvent(payload) {
    if (syncRole !== 'leader') return;
    // Helyi (azonos böngészős) szinkron + szerver nélküli WebRTC (PeerJS) Peer-to-Peer szinkron a zenekari eszközök felé
    if (syncChannel) {
      syncChannel.postMessage(payload);
    }
    if (window.StageChartP2P) {
      window.StageChartP2P.broadcast(payload);
    }
  }

  function getSyncRole() {
    return syncRole;
  }

  /********************************************************************
   * 5. WEB MIDI VEZÉRLÉS (BEMENETI PEDÁLOK ÉS KIMENETI PATCH VÁLTÁS)
   ********************************************************************/
  async function initWebMIDI(onMidiCmd) {
    onMidiCommandCallback = onMidiCmd;
    if (!navigator.requestMIDIAccess) {
      return { supported: false, inputs: 0, outputs: 0 };
    }
    try {
      midiAccess = await navigator.requestMIDIAccess();
      midiOutputs = Array.from(midiAccess.outputs.values());
      const inputs = Array.from(midiAccess.inputs.values());

      inputs.forEach(input => {
        input.onmidimessage = (msg) => {
          const [status, data1, data2] = msg.data;
          const cmd = status >> 4;
          // Note On (9) vagy Control Change (11)
          if ((cmd === 9 && data2 > 0) || (cmd === 11 && data2 > 64)) {
            if (onMidiCommandCallback) onMidiCommandCallback({ cmd, noteOrCc: data1, val: data2 });
          }
        };
      });
      return { supported: true, inputs: inputs.length, outputs: midiOutputs.length };
    } catch (e) {
      return { supported: false, inputs: 0, outputs: 0 };
    }
  }

  function sendMidiProgramChange(programNumber = 0, channel = 0) {
    if (!midiOutputs.length) return;
    const statusByte = 0xC0 | (channel & 0x0F);
    const progByte = Math.max(0, Math.min(127, parseInt(programNumber, 10) || 0));
    midiOutputs.forEach(output => {
      try {
        output.send([statusByte, progByte]);
      } catch (e) {}
    });
  }

  /********************************************************************
   * 6. KI-BE KAPCSOLHATÓ WEBKAMERÁS MOZDULAT-LAPOZÁS
   ********************************************************************/
  async function toggleWebcamGesture(enable, onGestureTurn) {
    if (!enable) {
      stopWebcamGesture();
      return false;
    }
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 160, height: 120, facingMode: 'user' }
      });
      const video = document.createElement('video');
      video.srcObject = webcamStream;
      video.muted = true;
      await video.play();

      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 60;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      let prevFrame = null;
      webcamActive = true;

      webcamInterval = setInterval(() => {
        if (!webcamActive) return;
        ctx.drawImage(video, 0, 0, 80, 60);
        const frame = ctx.getImageData(0, 0, 80, 60).data;

        if (prevFrame) {
          let leftDiff = 0;
          let rightDiff = 0;
          // Csak a felső két sarokzónát figyeljük szándékos kézlegyintésre
          for (let y = 0; y < 25; y++) {
            for (let x = 0; x < 80; x++) {
              const idx = (y * 80 + x) * 4;
              const diff = Math.abs(frame[idx] - prevFrame[idx]);
              if (diff > 45) {
                if (x < 22) leftDiff++;
                else if (x > 58) rightDiff++;
              }
            }
          }
          const now = Date.now();
          if (now - lastGestureTime > 1600) {
            if (rightDiff > 140 && leftDiff < 40) {
              lastGestureTime = now;
              if (onGestureTurn) onGestureTurn(1); // Következő oldal
            } else if (leftDiff > 140 && rightDiff < 40) {
              lastGestureTime = now;
              if (onGestureTurn) onGestureTurn(-1); // Előző oldal
            }
          }
        }
        prevFrame = new Uint8Array(frame);
      }, 150);

      return true;
    } catch (e) {
      alert('Webkamera nem érhető el vagy nincs engedélyezve.');
      return false;
    }
  }

  function stopWebcamGesture() {
    webcamActive = false;
    if (webcamInterval) {
      clearInterval(webcamInterval);
      webcamInterval = null;
    }
    if (webcamStream) {
      webcamStream.getTracks().forEach(t => t.stop());
      webcamStream = null;
    }
  }

  /********************************************************************
   * 7. SCREEN WAKE LOCK & SZÍNPADI FÉNYERŐ-KÍMÉLŐ MÓD
   ********************************************************************/
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
      } catch (e) {}
    }
  }

  function setupStageIdleDimmer(enabled) {
    clearTimeout(idleTimer);
    document.body.classList.remove('stage-idle-dimmed');
    if (!enabled) return;

    function resetIdle() {
      document.body.classList.remove('stage-idle-dimmed');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        document.body.classList.add('stage-idle-dimmed');
      }, 25000); // 25 mp inaktivitás után lehalványul a szünetben
    }

    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => {
      window.addEventListener(ev, resetIdle, { passive: true });
    });
    resetIdle();
  }

  return {
    toggleSectionLoop,
    clearSectionLoop,
    getActiveLoopSection,
    onBarAdvanced,
    calculateSetlistTotalDuration,
    startGigClock,
    stopGigClock,
    getGigClockStatus,
    showStageCueBanner,
    initBandSync,
    broadcastSyncEvent,
    getSyncRole,
    initWebMIDI,
    sendMidiProgramChange,
    toggleWebcamGesture,
    stopWebcamGesture,
    requestWakeLock,
    setupStageIdleDimmer
  };
})();
