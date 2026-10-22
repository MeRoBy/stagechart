/**
 * StageChart — Univerzális Audio Munkaállomás (Multi-Channel Routing, Ambient Pad, Groove Engine, Hangoló, Quick Memo)
 * Fájl: js/audio.js
 */

window.StageChartAudio = (function () {
  let audioCtx = null;
  let channelMerger = null;
  let maxChannels = 2;

  // Ambient Pad állapot
  let padRunning = false;
  let padSession = null;
  let padCurrentPc = 2; // D
  let padVolume = 0.65;
  let customPadBuffers = {}; // { 0: AudioBuffer ... }
  let customPadUrls = {};    // { 0: { url, name, sourceType } ... } (Azonnali lejátszás audio/pads/ mappából vagy feltöltésből)
  let onPadsUpdatedCallback = null;

  // Groove Engine / Metronóm állapot
  let grooveRunning = false;
  let grooveTimer = null;
  let currentStep = 0;
  let currentBar = 0;
  let tapTimes = [];
  let customDrumBuffers = {}; // { kick, snare, sidestick, hihat_closed, hihat_open, shaker }

  // Trainer (Tempó-gyorsító edző) és Section Looper visszahívások
  let trainerConfig = {
    enabled: false,
    stepBpm: 2,
    everyBars: 4,
    targetBpm: 130
  };
  let onBeatCallback = null;
  let onBpmChangeCallback = null;

  // Kromatikus hangoló (Mikrofon) állapot
  let tunerActive = false;
  let tunerStream = null;
  let tunerAnimFrame = null;

  // Quick Memo (Hangjegyzet rögzítő) állapot
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecordingMemo = false;

  /**
   * AudioContext és többcsatornás ChannelMergerNode inicializálása
   */
  function initAudio() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
      maxChannels = audioCtx.destination.maxChannelCount || 2;

      const targetChannels = Math.min(Math.max(maxChannels, 2), 8);
      try {
        audioCtx.destination.channelCount = targetChannels;
        audioCtx.destination.channelInterpretation = 'discrete';
      } catch (e) {
        // Ha a böngésző csak sztereót enged, 2 csatornán marad
      }

      channelMerger = audioCtx.createChannelMerger(targetChannels);
      channelMerger.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return { maxChannels: audioCtx.destination.channelCount || maxChannels };
  }

  function getMaxChannels() {
    if (!audioCtx) return 2;
    return audioCtx.destination.maxChannelCount || 2;
  }

  /**
   * Mono jel küldése egy kiválasztott fizikai kimeneti csatornára (pl. Out 1 = ch 0, Out 2 = ch 1)
   */
  function connectMonoToChannel(sourceNode, channelIndexStr) {
    initAudio();
    const totalCh = channelMerger.numberOfInputs;
    const chIdx = Math.min(parseInt(channelIndexStr || '0', 10), totalCh - 1);
    sourceNode.connect(channelMerger, 0, chIdx);
  }

  /**
   * Sztereó jel küldése egy kiválasztott fizikai csatornapárra (pl. "0-1", "2-3", "4-5")
   */
  function connectStereoToPair(leftNode, rightNode, pairStr) {
    initAudio();
    const totalCh = channelMerger.numberOfInputs;
    const parts = (pairStr || '0-1').split('-').map(n => parseInt(n, 10));
    const chL = parts[0] < totalCh ? parts[0] : 0;
    const chR = parts[1] < totalCh ? parts[1] : Math.min(1, totalCh - 1);
    leftNode.connect(channelMerger, 0, chL);
    rightNode.connect(channelMerger, 0, chR);
  }

  function pitchClassToFreq(pc, octave = 2) {
    // C2 = 65.406 Hz
    return 65.406 * Math.pow(2, (pc / 12) + (octave - 2));
  }

  /********************************************************************
   * 1. AMBIENT SYNTH PAD (1-5 DRONE + KARAKTERVÁLASZTÓ + CUSTOM AUDIO)
   ********************************************************************/
  function createPadVoice(pc, character = 'warm', fadeTime = 2.8, pairStr = '2-3') {
    // 1. Ha van saját hangfájl (az audio/pads/ mappából vagy betöltésből/IndexedDB-ből):
    // HTML5 Audio streaminggel játsszuk le, így 10 perces MP3/WAV fájlok is 0 mp alatt indulnak!
    if (customPadUrls[pc] && customPadUrls[pc].url) {
      const audioEl = new Audio(customPadUrls[pc].url);
      audioEl.loop = true;
      audioEl.volume = 0.0;
      const targetVol = Math.max(0.01, Math.min(1.0, padVolume));
      const steps = Math.max(10, Math.floor((fadeTime * 1000) / 35));
      let stepCount = 0;

      audioEl.play().catch(err => {
        console.warn('Pad audio lejátszási hiba:', err);
      });

      const fadeInterval = setInterval(() => {
        stepCount++;
        const ratio = Math.min(1, stepCount / steps);
        audioEl.volume = Math.min(1, Math.max(0, targetVol * ratio));
        if (ratio >= 1) clearInterval(fadeInterval);
      }, 35);

      return {
        isHtmlAudio: true,
        audioEl,
        fadeInterval,
        stopNodes: [],
        oscList: []
      };
    }

    initAudio();
    const now = audioCtx.currentTime;
    const masterGain = audioCtx.createGain();
    const targetGain = Math.max(0.0001, padVolume * 0.36);

    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(targetGain, now + fadeTime);

    // Sztereó szétválasztás a kimeneti csatornapárra
    const leftGain = audioCtx.createGain();
    const rightGain = audioCtx.createGain();
    masterGain.connect(leftGain);
    masterGain.connect(rightGain);
    connectStereoToPair(leftGain, rightGain, pairStr);

    const stopNodes = [];

    // Ha van dekódolt AudioBuffer
    if (customPadBuffers[pc]) {
      const bufSource = audioCtx.createBufferSource();
      bufSource.buffer = customPadBuffers[pc];
      bufSource.loop = true;
      bufSource.connect(masterGain);
      bufSource.start(now);
      stopNodes.push(bufSource);
      return { masterGain, stopNodes, oscList: [] };
    }

    const rootFreq = pitchClassToFreq(pc, 2);
    const fifthFreq = rootFreq * 1.498307; // Tiszta kvint (dúr és moll dalokhoz is)
    const octFreq = rootFreq * 2;
    const highFifth = fifthFreq * 2;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';

    if (character === 'strings') {
      filter.frequency.setValueAtTime(980, now);
      filter.Q.setValueAtTime(0.7, now);
    } else if (character === 'organ') {
      filter.frequency.setValueAtTime(1450, now);
      filter.Q.setValueAtTime(0.4, now);
    } else {
      // 'warm' analóg szőnyeg
      filter.frequency.setValueAtTime(580, now);
      filter.Q.setValueAtTime(1.1, now);
    }

    // Finom LFO a szűrőre, hogy éljen és lélegezzen a pad
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.frequency.setValueAtTime(0.18, now);
    lfoGain.gain.setValueAtTime(95, now);
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start(now);
    stopNodes.push(lfo);

    filter.connect(masterGain);

    const configs = character === 'organ'
      ? [
          { freq: rootFreq, type: 'sine', detune: 0, gain: 0.45 },
          { freq: fifthFreq, type: 'sine', detune: 2, gain: 0.30 },
          { freq: octFreq, type: 'triangle', detune: -2, gain: 0.28 },
          { freq: highFifth, type: 'sine', detune: 3, gain: 0.16 }
        ]
      : character === 'strings'
      ? [
          { freq: rootFreq, type: 'sawtooth', detune: -11, gain: 0.25 },
          { freq: rootFreq, type: 'sawtooth', detune: 11, gain: 0.25 },
          { freq: fifthFreq, type: 'sawtooth', detune: -7, gain: 0.20 },
          { freq: octFreq, type: 'triangle', detune: 8, gain: 0.22 }
        ]
      : [
          { freq: rootFreq, type: 'sawtooth', detune: -7, gain: 0.32 },
          { freq: fifthFreq, type: 'triangle', detune: 6, gain: 0.28 },
          { freq: octFreq, type: 'sine', detune: -4, gain: 0.28 },
          { freq: highFifth, type: 'sine', detune: 5, gain: 0.12 }
        ];

    const oscList = [];
    configs.forEach(cfg => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = cfg.type;
      osc.frequency.setValueAtTime(cfg.freq, now);
      osc.detune.setValueAtTime(cfg.detune, now);
      g.gain.setValueAtTime(cfg.gain, now);
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
      stopNodes.push(osc);
      oscList.push({ osc, ratio: cfg.freq / rootFreq });
    });

    return { masterGain, stopNodes, oscList };
  }

  function fadeOutPadSession(session, fadeTime = 2.8) {
    if (!session) return;

    if (session.isHtmlAudio && session.audioEl) {
      clearInterval(session.fadeInterval);
      const startVol = session.audioEl.volume;
      const steps = Math.max(8, Math.floor((fadeTime * 1000) / 35));
      let stepCount = 0;
      const outInterval = setInterval(() => {
        stepCount++;
        const ratio = Math.max(0, 1 - stepCount / steps);
        session.audioEl.volume = Math.max(0, startVol * ratio);
        if (ratio <= 0) {
          clearInterval(outInterval);
          try {
            session.audioEl.pause();
            session.audioEl.currentTime = 0;
          } catch (e) {}
        }
      }, 35);
      return;
    }

    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    try {
      session.masterGain.gain.cancelScheduledValues(now);
      session.masterGain.gain.setValueAtTime(Math.max(0.0001, session.masterGain.gain.value), now);
      session.masterGain.gain.linearRampToValueAtTime(0.0001, now + fadeTime);
    } catch (e) {}

    setTimeout(() => {
      session.stopNodes.forEach(n => {
        try { n.stop(); n.disconnect(); } catch (e) {}
      });
    }, fadeTime * 1000 + 120);
  }

  function togglePad(pc, settings = {}) {
    const routing = settings.audioRouting || {};
    const fadeTime = parseFloat(routing.padFadeTime) || 2.8;
    const character = routing.padCharacter || 'warm';
    const pairStr = routing.padChannelPair || '2-3';
    padCurrentPc = pc !== undefined ? pc : padCurrentPc;

    if (!padRunning) {
      padSession = createPadVoice(padCurrentPc, character, fadeTime, pairStr);
      padRunning = true;
    } else {
      fadeOutPadSession(padSession, fadeTime);
      padSession = null;
      padRunning = false;
    }
    return padRunning;
  }

  function crossfadePadToPitchClass(newPc, settings = {}) {
    padCurrentPc = newPc;
    if (!padRunning || !padSession) return;

    const routing = settings.audioRouting || {};
    const fadeTime = Math.min(2.2, parseFloat(routing.padFadeTime) || 2.0);
    const character = routing.padCharacter || 'warm';
    const pairStr = routing.padChannelPair || '2-3';

    // Keresztátúszás (Crossfade) az előző hangnem és az új hangnem között
    const oldSession = padSession;
    fadeOutPadSession(oldSession, fadeTime);
    padSession = createPadVoice(newPc, character, fadeTime, pairStr);
  }

  function setPadVolume(val0to100) {
    padVolume = Math.max(0, Math.min(1, val0to100 / 100));
    if (padSession) {
      if (padSession.isHtmlAudio && padSession.audioEl) {
        clearInterval(padSession.fadeInterval);
        padSession.audioEl.volume = padVolume;
      } else if (padSession.masterGain && audioCtx) {
        padSession.masterGain.gain.setTargetAtTime(Math.max(0.0001, padVolume * 0.36), audioCtx.currentTime, 0.12);
      }
    }
  }

  function isPadRunning() {
    return padRunning;
  }

  /********************************************************************
   * 2. GROOVE ENGINE (AKUSZTIKUS DOBMINTÁK + KLIKK + CUE BESZÁMOLÁS)
   ********************************************************************/
  function playCustomOrSynthDrum(type, velocity = 1.0, routing = {}) {
    initAudio();
    const now = audioCtx.currentTime;

    // Ha van betöltött saját dob sample
    if (customDrumBuffers[type]) {
      const src = audioCtx.createBufferSource();
      const g = audioCtx.createGain();
      src.buffer = customDrumBuffers[type];
      g.gain.setValueAtTime(velocity * 0.8, now);
      src.connect(g);
      connectStereoToPair(g, g, routing.padChannelPair || '2-3');
      src.start(now);
      return;
    }

    if (type === 'click_hi' || type === 'click_lo') {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(type === 'click_hi' ? 1280 : 860, now);
      g.gain.setValueAtTime(0.38 * velocity, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
      osc.connect(g);
      connectMonoToChannel(g, routing.clickChannel || '0');
      osc.start(now);
      osc.stop(now + 0.06);
      return;
    }

    // Akusztikus dob szintézis a sztereó/dob kimenetre
    const outLeft = audioCtx.createGain();
    const outRight = audioCtx.createGain();
    connectStereoToPair(outLeft, outRight, routing.padChannelPair || '2-3');

    if (type === 'kick') {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(135, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.09);
      g.gain.setValueAtTime(0.75 * velocity, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(g);
      g.connect(outLeft);
      g.connect(outRight);
      osc.start(now);
      osc.stop(now + 0.28);
    } else if (type === 'snare') {
      // Pergő: test + szűrt zaj
      const osc = audioCtx.createOscillator();
      const oscGain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(185, now);
      osc.frequency.exponentialRampToValueAtTime(95, now + 0.08);
      oscGain.gain.setValueAtTime(0.35 * velocity, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(oscGain);
      oscGain.connect(outLeft);
      oscGain.connect(outRight);
      osc.start(now);
      osc.stop(now + 0.13);

      // Pergő sodrony zaj
      const bufSize = audioCtx.sampleRate * 0.18;
      const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = audioCtx.createBufferSource();
      noise.buffer = noiseBuf;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(900, now);
      const nGain = audioCtx.createGain();
      nGain.gain.setValueAtTime(0.32 * velocity, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(outLeft);
      nGain.connect(outRight);
      noise.start(now);
    } else if (type === 'sidestick') {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.035);
      g.gain.setValueAtTime(0.28 * velocity, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      osc.connect(g);
      g.connect(outLeft);
      g.connect(outRight);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'hihat_closed' || type === 'hihat_open' || type === 'shaker') {
      const dur = type === 'hihat_open' ? 0.25 : 0.055;
      const bufSize = Math.floor(audioCtx.sampleRate * dur);
      const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
      const noise = audioCtx.createBufferSource();
      noise.buffer = noiseBuf;
      const filter = audioCtx.createBiquadFilter();
      filter.type = type === 'shaker' ? 'bandpass' : 'highpass';
      filter.frequency.setValueAtTime(type === 'shaker' ? 5200 : 7500, now);
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.18 * velocity, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      noise.connect(filter);
      filter.connect(g);
      g.connect(outLeft);
      g.connect(outRight);
      noise.start(now);
    }
  }

  // 8-lépéses (nyolcados) vagy 6-lépéses (6/8) groove minták
  const GROOVE_PATTERNS = {
    click: {
      stepsPerBar: 4,
      subdivision: 1,
      events: [
        [{ drum: 'click_hi', vel: 1.0 }],
        [{ drum: 'click_lo', vel: 0.75 }],
        [{ drum: 'click_lo', vel: 0.75 }],
        [{ drum: 'click_lo', vel: 0.75 }]
      ]
    },
    pop8: {
      stepsPerBar: 8,
      subdivision: 2,
      events: [
        [{ drum: 'kick', vel: 1.0 }, { drum: 'hihat_closed', vel: 0.8 }],
        [{ drum: 'hihat_closed', vel: 0.5 }],
        [{ drum: 'snare', vel: 0.9 }, { drum: 'hihat_closed', vel: 0.8 }],
        [{ drum: 'hihat_closed', vel: 0.5 }],
        [{ drum: 'kick', vel: 0.85 }, { drum: 'hihat_closed', vel: 0.8 }],
        [{ drum: 'kick', vel: 0.75 }, { drum: 'hihat_closed', vel: 0.5 }],
        [{ drum: 'snare', vel: 0.95 }, { drum: 'hihat_closed', vel: 0.8 }],
        [{ drum: 'hihat_open', vel: 0.6 }]
      ]
    },
    ballad16: {
      stepsPerBar: 8,
      subdivision: 2,
      events: [
        [{ drum: 'kick', vel: 0.9 }, { drum: 'shaker', vel: 0.7 }],
        [{ drum: 'shaker', vel: 0.45 }],
        [{ drum: 'sidestick', vel: 0.85 }, { drum: 'shaker', vel: 0.65 }],
        [{ drum: 'shaker', vel: 0.45 }],
        [{ drum: 'kick', vel: 0.8 }, { drum: 'shaker', vel: 0.65 }],
        [{ drum: 'kick', vel: 0.6 }, { drum: 'shaker', vel: 0.45 }],
        [{ drum: 'sidestick', vel: 0.9 }, { drum: 'shaker', vel: 0.7 }],
        [{ drum: 'shaker', vel: 0.5 }]
      ]
    },
    country: {
      stepsPerBar: 8,
      subdivision: 2,
      events: [
        [{ drum: 'kick', vel: 1.0 }, { drum: 'hihat_closed', vel: 0.7 }],
        [{ drum: 'hihat_closed', vel: 0.5 }],
        [{ drum: 'snare', vel: 0.85 }, { drum: 'hihat_closed', vel: 0.7 }],
        [{ drum: 'snare', vel: 0.45 }],
        [{ drum: 'kick', vel: 0.95 }, { drum: 'hihat_closed', vel: 0.7 }],
        [{ drum: 'hihat_closed', vel: 0.5 }],
        [{ drum: 'snare', vel: 0.9 }, { drum: 'hihat_closed', vel: 0.7 }],
        [{ drum: 'snare', vel: 0.5 }]
      ]
    },
    acoustic68: {
      stepsPerBar: 6,
      subdivision: 2,
      events: [
        [{ drum: 'kick', vel: 1.0 }, { drum: 'shaker', vel: 0.8 }],
        [{ drum: 'shaker', vel: 0.45 }],
        [{ drum: 'shaker', vel: 0.55 }],
        [{ drum: 'sidestick', vel: 0.9 }, { drum: 'shaker', vel: 0.8 }],
        [{ drum: 'shaker', vel: 0.45 }],
        [{ drum: 'kick', vel: 0.65 }, { drum: 'shaker', vel: 0.55 }]
      ]
    },
    bossa: {
      stepsPerBar: 8,
      subdivision: 2,
      events: [
        [{ drum: 'kick', vel: 0.9 }, { drum: 'sidestick', vel: 0.8 }, { drum: 'shaker', vel: 0.6 }],
        [{ drum: 'shaker', vel: 0.45 }],
        [{ drum: 'shaker', vel: 0.6 }],
        [{ drum: 'kick', vel: 0.75 }, { drum: 'sidestick', vel: 0.75 }],
        [{ drum: 'kick', vel: 0.85 }, { drum: 'shaker', vel: 0.6 }],
        [{ drum: 'shaker', vel: 0.45 }],
        [{ drum: 'sidestick', vel: 0.8 }, { drum: 'shaker', vel: 0.6 }],
        [{ drum: 'kick', vel: 0.7 }]
      ]
    },
    swing: {
      stepsPerBar: 6,
      subdivision: 2,
      events: [
        [{ drum: 'kick', vel: 0.8 }, { drum: 'hihat_open', vel: 0.65 }],
        [],
        [{ drum: 'hihat_closed', vel: 0.5 }],
        [{ drum: 'hihat_closed', vel: 0.9 }, { drum: 'sidestick', vel: 0.6 }],
        [],
        [{ drum: 'hihat_closed', vel: 0.65 }]
      ]
    }
  };

  function startGroove(bpm, settings, callbacks = {}) {
    stopGroove();
    initAudio();
    onBeatCallback = callbacks.onBeat || null;
    onBpmChangeCallback = callbacks.onBpmChange || null;

    let activeBpm = Math.max(35, Math.min(240, parseInt(bpm, 10) || 90));
    const routing = settings.audioRouting || {};
    const styleKey = routing.grooveStyle || 'click';
    const pattern = GROOVE_PATTERNS[styleKey] || GROOVE_PATTERNS.click;

    currentStep = 0;
    currentBar = 0;
    grooveRunning = true;

    function scheduleNextStep() {
      if (!grooveRunning) return;

      const isDownbeat = (currentStep === 0);
      const isQuarterBeat = (currentStep % pattern.subdivision === 0);

      // Néma vizuális Intro villanás vagy normál hangos ütés
      const silentIntroBars = parseInt(settings.introSilentFlashBars || 0, 10);
      const isSilentIntro = silentIntroBars > 0 && currentBar < silentIntroBars;

      if (settings.metronomeSoundEnabled !== false && !isSilentIntro) {
        const evList = pattern.events[currentStep] || [];
        evList.forEach(ev => {
          // Finom humanizálás
          const humanVel = ev.vel * (0.94 + Math.random() * 0.1);
          playCustomOrSynthDrum(ev.drum, humanVel, routing);
        });
      }

      if (isQuarterBeat && onBeatCallback) {
        onBeatCallback({
          beat: Math.floor(currentStep / pattern.subdivision) + 1,
          bar: currentBar + 1,
          isDownbeat,
          isSilentIntro
        });
      }

      currentStep++;
      if (currentStep >= pattern.stepsPerBar) {
        currentStep = 0;
        currentBar++;

        // Automatikus metronóm kikapcsolás (pl. 4 ütem vagy 8 ütem után)
        if (settings.metronomeAutoOff === '4bars' && currentBar >= 4) {
          stopGroove();
          if (callbacks.onAutoStop) callbacks.onAutoStop();
          return;
        }
        if (settings.metronomeAutoOff === '8bars' && currentBar >= 8) {
          stopGroove();
          if (callbacks.onAutoStop) callbacks.onAutoStop();
          return;
        }

        // Trainer Mode (Tempó-gyorsító edzés)
        if (trainerConfig.enabled && currentBar > 0 && (currentBar % trainerConfig.everyBars === 0)) {
          if (activeBpm < trainerConfig.targetBpm) {
            activeBpm = Math.min(trainerConfig.targetBpm, activeBpm + trainerConfig.stepBpm);
            if (onBpmChangeCallback) onBpmChangeCallback(activeBpm);
          }
        }
      }

      const stepMs = ((60 / activeBpm) / pattern.subdivision) * 1000;
      grooveTimer = setTimeout(scheduleNextStep, stepMs);
    }

    scheduleNextStep();
    return true;
  }

  function stopGroove() {
    if (grooveTimer) {
      clearTimeout(grooveTimer);
      grooveTimer = null;
    }
    grooveRunning = false;
  }

  function isGrooveRunning() {
    return grooveRunning;
  }

  function setTrainerConfig(cfg) {
    trainerConfig = { ...trainerConfig, ...cfg };
  }

  function getTrainerConfig() {
    return trainerConfig;
  }

  /**
   * Tap Tempo számítás
   */
  function registerTap() {
    const now = performance.now();
    tapTimes.push(now);
    if (tapTimes.length > 5) tapTimes.shift();
    if (tapTimes.length < 2) return null;

    let diffs = [];
    for (let i = 1; i < tapTimes.length; i++) {
      const d = tapTimes[i] - tapTimes[i - 1];
      if (d > 2200) {
        tapTimes = [now];
        return null;
      }
      diffs.push(d);
    }
    const avgMs = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    return Math.round(60000 / avgMs);
  }

  /**
   * Szóbeli Cue / Beszámolás ("Intro, 1, 2, 3, 4", "Chorus" stb.)
   */
  function triggerCue(cueText = 'One, two, three, four', routing = {}) {
    initAudio();
    // Hangjelzés a dedikált Cue mono csatornán
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.5, audioCtx.currentTime); // C6
    g.gain.setValueAtTime(0.25, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
    osc.connect(g);
    connectMonoToChannel(g, routing.cueChannel || '1');
    osc.start();
    osc.stop(audioCtx.currentTime + 0.09);

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(cueText);
      utter.lang = cueText.match(/[áéíóöőúüű]/i) ? 'hu-HU' : 'en-US';
      utter.rate = 1.12;
      window.speechSynthesis.speak(utter);
    }
  }

  /********************************************************************
   * 3. SAJÁT HANGMINTÁK BETÖLTÉSE, AUTOMATIKUS AUDIO/PADS/ KERESÉS & INDEXEDDB
   ********************************************************************/
  function extractPitchClassFromFilename(fileName, notation = 'hu') {
    if (!fileName) return -1;
    let baseName = fileName.replace(/\.(mp3|wav|ogg|m4a|flac|aac)$/i, '').trim();

    // Angol kiírt módosítójelek normalizálása (pl. "Fsharp" -> "F#", "Bflat" -> "Bb")
    baseName = baseName
      .replace(/([A-Ha-h])[\s_\-]*sharp/gi, '$1#')
      .replace(/([A-Ha-h])[\s_\-]*flat/gi, '$1b');

    // 1. Közvetlen egyezés (pl. "C", "F#", "Bb", "H", "d", "fisz")
    let pc = window.StageChartTheory.noteToPitchClass(baseName, notation);
    if (pc !== -1) return pc;

    // 2. Ha összetett név (pl. "01 - C# Pad.mp3", "Pad_D.wav", "Worship_Eb_120.mp3")
    const tokens = baseName.split(/[\s_\-.,()[\]]+/);
    for (const tok of tokens) {
      if (!tok) continue;
      const candidate = window.StageChartTheory.noteToPitchClass(tok, notation);
      if (candidate !== -1) {
        return candidate;
      }
    }
    return -1;
  }

  // IndexedDB segédfüggvények, hogy a betöltött Pad fájlokat a böngésző tartósan megjegyezze
  function openAudioDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('No IndexedDB'));
      const req = indexedDB.open('StageChartAudioDB', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pads')) {
          db.createObjectStore('pads', { keyPath: 'pc' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function savePadFileToIDB(pc, file) {
    try {
      const db = await openAudioDB();
      const tx = db.transaction('pads', 'readwrite');
      tx.objectStore('pads').put({ pc, name: file.name, blob: file });
    } catch (e) {}
  }

  async function restorePadsFromIDB() {
    try {
      const db = await openAudioDB();
      return new Promise((resolve) => {
        const tx = db.transaction('pads', 'readonly');
        const req = tx.objectStore('pads').getAll();
        req.onsuccess = () => {
          const items = req.result || [];
          let count = 0;
          items.forEach(item => {
            if (item && item.blob && item.pc !== undefined) {
              customPadUrls[item.pc] = {
                url: URL.createObjectURL(item.blob),
                name: item.name || `Pad_${item.pc}`,
                sourceType: 'saved'
              };
              count++;
            }
          });
          if (count > 0 && onPadsUpdatedCallback) onPadsUpdatedCallback(getLoadedPadStatus());
          resolve(count);
        };
        req.onerror = () => resolve(0);
      });
    } catch (e) {
      return 0;
    }
  }

  async function clearCustomPads() {
    customPadUrls = {};
    customPadBuffers = {};
    try {
      const db = await openAudioDB();
      const tx = db.transaction('pads', 'readwrite');
      tx.objectStore('pads').clear();
    } catch (e) {}
    if (onPadsUpdatedCallback) onPadsUpdatedCallback(getLoadedPadStatus());
  }

  /**
   * Automatikusan végigellenőrzi az audio/pads/ mappát indításkor,
   * így ha a felhasználó bemásolta oda a fájlokat (pl. C.mp3, D.mp3, F#.mp3...),
   * gombnyomás nélkül is azonnal megtalálja és használja őket!
   */
  function autoProbeLocalPadsFolder(notation = 'hu', onUpdate = null) {
    if (onUpdate) onPadsUpdatedCallback = onUpdate;

    // Először visszatöltjük a korábban kiválasztott fájlokat IndexedDB-ből
    restorePadsFromIDB();

    const candidateFiles = [
      { pc: 0,  names: ['C.mp3', 'c.mp3', 'C.wav', 'c.wav'] },
      { pc: 1,  names: ['C#.mp3', 'Db.mp3', 'c#.mp3', 'db.mp3', 'C#.wav', 'Db.wav', 'Cisz.mp3'] },
      { pc: 2,  names: ['D.mp3', 'd.mp3', 'D.wav', 'd.wav'] },
      { pc: 3,  names: ['D#.mp3', 'Eb.mp3', 'd#.mp3', 'eb.mp3', 'D#.wav', 'Eb.wav', 'Esz.mp3'] },
      { pc: 4,  names: ['E.mp3', 'e.mp3', 'E.wav', 'e.wav'] },
      { pc: 5,  names: ['F.mp3', 'f.mp3', 'F.wav', 'f.wav'] },
      { pc: 6,  names: ['F#.mp3', 'Gb.mp3', 'f#.mp3', 'gb.mp3', 'F#.wav', 'Gb.wav', 'Fisz.mp3'] },
      { pc: 7,  names: ['G.mp3', 'g.mp3', 'G.wav', 'g.wav'] },
      { pc: 8,  names: ['G#.mp3', 'Ab.mp3', 'g#.mp3', 'ab.mp3', 'G#.wav', 'Ab.wav', 'Gisz.mp3'] },
      { pc: 9,  names: ['A.mp3', 'a.mp3', 'A.wav', 'a.wav'] },
      { pc: 10, names: ['B.mp3', 'Bb.mp3', 'A#.mp3', 'b.mp3', 'bb.mp3', 'a#.mp3', 'B.wav', 'Bb.wav'] },
      { pc: 11, names: ['H.mp3', 'h.mp3', 'H.wav', 'h.wav', 'B.mp3'] }
    ];

    candidateFiles.forEach(group => {
      group.names.forEach(fileName => {
        // A '#' karaktert URL-kódolni kell (%23), különben a böngésző horgonynak (hash) nézi!
        const encodedName = fileName.replace('#', '%23');
        const path = `audio/pads/${encodedName}`;
        const probeAudio = new Audio();
        probeAudio.preload = 'metadata';
        probeAudio.onloadedmetadata = () => {
          // Ha a H és B ütközne angolszász módban, a notation dönt
          let targetPc = group.pc;
          if (fileName.toUpperCase().startsWith('B.') && notation === 'en') {
            targetPc = 11;
          }
          if (!customPadUrls[targetPc]) {
            customPadUrls[targetPc] = {
              url: path,
              name: fileName,
              sourceType: 'folder'
            };
            if (onPadsUpdatedCallback) onPadsUpdatedCallback(getLoadedPadStatus());
          }
        };
        probeAudio.src = path;
      });
    });
  }

  /**
   * Fájlok vagy teljes mappa azonnali betöltése (decodeAudioData lefagyás nélkül!)
   */
  async function loadCustomPadFiles(fileList, notation = 'hu') {
    if (!fileList || !fileList.length) return { loadedCount: 0, unmatched: [] };
    let loadedCount = 0;
    const unmatched = [];

    // Ha pont 12 db hangfájlt választott ki a felhasználó, de a nevükben nincs hangnem (pl. Track01..Track12)
    const audioFiles = Array.from(fileList).filter(f => /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name));

    for (const file of audioFiles) {
      const pc = extractPitchClassFromFilename(file.name, notation);
      if (pc !== -1) {
        const blobUrl = URL.createObjectURL(file);
        customPadUrls[pc] = {
          url: blobUrl,
          name: file.name,
          sourceType: 'upload'
        };
        await savePadFileToIDB(pc, file);
        loadedCount++;
      } else {
        unmatched.push(file.name);
      }
    }

    // Ha egyetlen fájlnév sem tartalmazott hangnevet, de van kiválasztott hangfájl,
    // az első fájlt (vagy sorrendben C..H-ig) hozzárendeljük, hogy akkor is megszólaljon!
    if (loadedCount === 0 && audioFiles.length > 0) {
      audioFiles.slice(0, 12).forEach((file, idx) => {
        const blobUrl = URL.createObjectURL(file);
        customPadUrls[idx] = {
          url: blobUrl,
          name: file.name,
          sourceType: 'upload'
        };
        savePadFileToIDB(idx, file);
        loadedCount++;
      });
      // Ha csak 1 db univerzális pad fájlt töltött be, minden hangnemhez elérhetővé tesszük
      if (audioFiles.length === 1) {
        const singleUrl = URL.createObjectURL(audioFiles[0]);
        for (let p = 0; p < 12; p++) {
          customPadUrls[p] = {
            url: singleUrl,
            name: audioFiles[0].name,
            sourceType: 'upload'
          };
        }
      }
    }

    if (onPadsUpdatedCallback) onPadsUpdatedCallback(getLoadedPadStatus());

    // Ha éppen fut a Pad, azonnal átúsztatjuk az újonnan betöltött hangfájlra!
    if (padRunning) {
      crossfadePadToPitchClass(padCurrentPc, {});
    }

    return { loadedCount, unmatched };
  }

  function getLoadedPadStatus() {
    const loadedPcs = Object.keys(customPadUrls).map(k => parseInt(k, 10));
    return {
      totalLoaded: loadedPcs.length,
      map: customPadUrls
    };
  }

  async function loadCustomDrumFiles(fileList) {
    initAudio();
    let loadedCount = 0;
    for (const file of fileList) {
      const lower = file.name.toLowerCase();
      let key = null;
      if (lower.includes('kick') || lower.includes('bd') || lower.includes('labdob')) key = 'kick';
      else if (lower.includes('snare') || lower.includes('sd') || lower.includes('pergo')) key = 'snare';
      else if (lower.includes('side') || lower.includes('rim') || lower.includes('kava')) key = 'sidestick';
      else if (lower.includes('open') || lower.includes('oh')) key = 'hihat_open';
      else if (lower.includes('hat') || lower.includes('hh') || lower.includes('ch')) key = 'hihat_closed';
      else if (lower.includes('shak')) key = 'shaker';

      if (key) {
        try {
          const arrayBuf = await file.arrayBuffer();
          customDrumBuffers[key] = await audioCtx.decodeAudioData(arrayBuf);
          loadedCount++;
        } catch (e) {}
      }
    }
    return loadedCount;
  }

  /********************************************************************
   * 4. KROMATIKUS HANGOLÓ (MIKROFON + 440 HZ REFERENCIA)
   ********************************************************************/
  function playReferenceTone(freq = 440, durationSec = 2.0) {
    initAudio();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.3, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.05);
  }

  async function startMicTuner(onPitchDetected) {
    stopMicTuner();
    try {
      initAudio();
      tunerStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audioCtx.createMediaStreamSource(tunerStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      tunerActive = true;

      function detectLoop() {
        if (!tunerActive) return;
        analyser.getFloatTimeDomainData(buf);
        const freq = autoCorrelate(buf, audioCtx.sampleRate);
        if (freq !== -1 && onPitchDetected) {
          const noteNum = 12 * (Math.log(freq / 440) / Math.log(2)) + 69;
          const rounded = Math.round(noteNum);
          const cents = Math.floor((noteNum - rounded) * 100);
          const pc = ((rounded % 12) + 12) % 12;
          onPitchDetected({ freq: freq.toFixed(1), pc, cents });
        }
        tunerAnimFrame = requestAnimationFrame(detectLoop);
      }
      detectLoop();
      return true;
    } catch (err) {
      return false;
    }
  }

  function stopMicTuner() {
    tunerActive = false;
    if (tunerAnimFrame) cancelAnimationFrame(tunerAnimFrame);
    if (tunerStream) {
      tunerStream.getTracks().forEach(t => t.stop());
      tunerStream = null;
    }
  }

  function autoCorrelate(buf, sampleRate) {
    let size = buf.length;
    let rms = 0;
    for (let i = 0; i < size; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / size);
    if (rms < 0.015) return -1;

    let r1 = 0, r2 = size - 1, thres = 0.2;
    for (let i = 0; i < size / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    for (let i = 1; i < size / 2; i++) if (Math.abs(buf[size - i]) < thres) { r2 = size - i; break; }
    buf = buf.slice(r1, r2);
    size = buf.length;

    const c = new Array(size).fill(0);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size - i; j++) c[i] = c[i] + buf[j] * buf[j + i];
    }
    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < size; i++) {
      if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    }
    let T0 = maxpos;
    return sampleRate / T0;
  }

  /********************************************************************
   * 5. QUICK MEMO (PRÓBATERMI MIKROFONOS HANGJEGYZET RÖGZÍTŐ)
   ********************************************************************/
  async function toggleQuickMemoRecording(onComplete) {
    if (isRecordingMemo && mediaRecorder) {
      mediaRecorder.stop();
      isRecordingMemo = false;
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          if (onComplete) onComplete(reader.result);
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorder.start();
      isRecordingMemo = true;
      return true;
    } catch (e) {
      alert('Mikrofon hozzáférés szükséges a hangjegyzet rögzítéséhez.');
      return false;
    }
  }

  return {
    initAudio,
    getMaxChannels,
    togglePad,
    crossfadePadToPitchClass,
    setPadVolume,
    isPadRunning,
    startGroove,
    stopGroove,
    isGrooveRunning,
    setTrainerConfig,
    getTrainerConfig,
    registerTap,
    triggerCue,
    autoProbeLocalPadsFolder,
    loadCustomPadFiles,
    getLoadedPadStatus,
    clearCustomPads,
    loadCustomDrumFiles,
    playReferenceTone,
    startMicTuner,
    stopMicTuner,
    toggleQuickMemoRecording
  };
})();
