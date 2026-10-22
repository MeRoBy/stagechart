/**
 * StageChart — Zeneelméleti, Transzponáló, Kápó-optimalizáló és Akkorddiagram Motor
 * Fájl: js/theory.js
 */

window.StageChartTheory = (function () {
  // 12 félhang skálák (Magyar H/B és Angolszász B/Bb)
  const SCALE_HU_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
  const SCALE_HU_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'B', 'H'];
  const SCALE_EN_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SCALE_EN_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Az 5 félhangpár indexe a 12-es skálán: 1 (C#/Db), 3 (D#/Eb), 6 (F#/Gb), 8 (G#/Ab), 10 (A#/Bb/B)
  const ACCIDENTAL_PAIR_MAP = {
    1:  { key: 'C#', sharp: 'C#', flat: 'Db' },
    3:  { key: 'D#', sharp: 'D#', flat: 'Eb' },
    6:  { key: 'F#', sharp: 'F#', flat: 'Gb' },
    8:  { key: 'G#', sharp: 'G#', flat: 'Ab' },
    10: { key: 'A#', sharpEn: 'A#', flatEn: 'Bb', sharpHu: 'A#', flatHu: 'B' }
  };

  // Nyitott gitárakkordok pontszáma a Kápó-optimalizálóhoz
  const OPEN_CHORD_WEIGHTS = {
    'C': 10, 'G': 10, 'D': 10, 'A': 9, 'E': 9,
    'Am': 10, 'Em': 10, 'Dm': 9,
    'C7': 8, 'G7': 8, 'D7': 8, 'A7': 8, 'E7': 8,
    'Fmaj7': 7, 'F': 4, 'Hm': 4, 'Bm': 4
  };

  /**
   * Hangnév -> Pitch Class (0..11)
   * Natívan és kis-/nagybetű-függetlenül felismeri a magyar (H, Hm, B, Fisz, Cisz...)
   * és az angolszász (B, Bm, Bb, F#, Db...) alakokat is.
   */
  function noteToPitchClass(noteStr, notation = 'hu') {
    if (!noteStr) return -1;
    let clean = String(noteStr).trim();
    if (!clean) return -1;

    // Magyar kiírt módosítójelek normalizálása (fisz -> F#, cisz -> C#, esz -> Eb stb.)
    const lower = clean.toLowerCase()
      .replace(/cisz|cis/g, 'c#')
      .replace(/disz|dis/g, 'd#')
      .replace(/fisz|fis/g, 'f#')
      .replace(/gisz|gis/g, 'g#')
      .replace(/aisz|ais/g, 'a#')
      .replace(/esz|^es$/g, 'eb')
      .replace(/asz|^as$/g, 'ab')
      .replace(/desz|des/g, 'db')
      .replace(/gesz|ges/g, 'gb')
      .replace(/(major|maj|minor|min|pad|drone|ambient|loop)$/i, '')
      .trim();

    // Első betű nagybetűsítése, második karakter (# vagy b) megtartása
    const match = lower.match(/^([a-h])([#b♯♭])?m?$/i);
    if (!match) return -1;

    const letter = match[1].toUpperCase();
    let acc = match[2] || '';
    if (acc === '♯') acc = '#';
    if (acc === '♭') acc = 'b';
    const normNote = letter + acc;

    const baseMap = {
      'C': 0, 'B#': 0, 'H#': 0,
      'C#': 1, 'Db': 1,
      'D': 2,
      'D#': 3, 'Eb': 3,
      'E': 4, 'Fb': 4,
      'F': 5, 'E#': 5,
      'F#': 6, 'Gb': 6,
      'G': 7,
      'G#': 8, 'Ab': 8,
      'A': 9,
      'A#': 10, 'Bb': 10, 'Hb': 10,
      'H': 11, 'Cb': 11
    };
    if (normNote === 'B') {
      return notation === 'hu' ? 10 : 11;
    }
    return baseMap[normNote] !== undefined ? baseMap[normNote] : -1;
  }

  /**
   * Pitch Class (0..11) -> Hangnév a beállítások és az 5 félhangpár felülbírálás alapján
   */
  function pitchClassToNote(pc, options = {}) {
    const norm = ((pc % 12) + 12) % 12;
    const notation = options.notation || 'hu';
    const preferFlats = !!options.preferFlats;
    const overrides = options.accidentalsOverride || {};

    // Ellenőrizzük az 5 félhangpár egyéni felülbírálását (A#/Bb, C#/Db, D#/Eb, F#/Gb, G#/Ab)
    if (ACCIDENTAL_PAIR_MAP[norm]) {
      const pair = ACCIDENTAL_PAIR_MAP[norm];
      const rule = overrides[pair.key] || 'auto';
      if (norm === 10) {
        if (notation === 'hu') {
          if (rule === '#') return 'A#';
          return 'B';
        } else {
          if (rule === '#') return 'A#';
          if (rule === 'b') return 'Bb';
          return preferFlats ? 'Bb' : 'A#';
        }
      } else {
        if (rule === '#') return pair.sharp;
        if (rule === 'b') return pair.flat;
      }
    }

    if (notation === 'hu') {
      return preferFlats ? SCALE_HU_FLAT[norm] : SCALE_HU_SHARP[norm];
    } else {
      return preferFlats ? SCALE_EN_FLAT[norm] : SCALE_EN_SHARP[norm];
    }
  }

  /**
   * Nashville Number System (I, ii, iii, IV, V, vi, vii°)
   */
  function toNashville(pc, songRootPc, suffix = '', slashPc = -1) {
    const degDiff = ((pc - songRootPc) % 12 + 12) % 12;
    const numeralsMajor = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
    let num = numeralsMajor[degDiff];
    let cleanSuffix = suffix;

    if (cleanSuffix.startsWith('m') && !cleanSuffix.startsWith('maj')) {
      num = num.toLowerCase();
      cleanSuffix = cleanSuffix.slice(1);
    } else if (cleanSuffix.startsWith('dim')) {
      num = num.toLowerCase() + '°';
      cleanSuffix = cleanSuffix.slice(3);
    }

    let slashStr = '';
    if (slashPc !== -1) {
      const slashDeg = ((slashPc - songRootPc) % 12 + 12) % 12;
      const arabicDegrees = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];
      slashStr = '/' + arabicDegrees[slashDeg];
    }
    return num + cleanSuffix + slashStr;
  }

  /**
   * Megvizsgálja a dal szövegét, hogy szerepel-e benne explicit magyar "H" akkord (pl. H, Hm, H7, G/H),
   * vagy angolszász "B" (= magyar H, 11-es félhang, pl. B/D#, Bm, G/B) jelöléssel íródott-e.
   */
  function analyzeSongBNotationContext(content, songKey = 'D') {
    let hasExplicitH = false;
    let hasStandardBIndicator = false;

    const cleanKey = String(songKey || 'D').trim();
    if (/^H/i.test(cleanKey)) hasExplicitH = true;

    if (content) {
      const lines = String(content).split('\n');
      for (const line of lines) {
        // ChordPro [Hm], [B/D#], [G/B]
        const brackets = line.match(/\[([^\]]+)\]/g);
        if (brackets) {
          for (const b of brackets) {
            const tok = b.slice(1, -1).trim();
            if (/^H([#b]?)(m|maj|min|dim|aug|sus|add|[0-9]|\/|$)/.test(tok) || /\/H([#b]?)$/.test(tok)) {
              hasExplicitH = true;
            }
            if (/^Bb/.test(tok) || /\/Bb$/.test(tok) || /^B\/(D#|F#)$/.test(tok) || /^(G|E|D|A|C|F#m?)\/B$/.test(tok)) {
              hasStandardBIndicator = true;
            }
          }
        }
        // Szöveg feletti akkordsorok
        const trimmed = line.trim();
        if (trimmed && !trimmed.endsWith(':')) {
          const words = trimmed.split(/\s+/);
          let chCount = 0;
          let validWords = 0;
          for (const w of words) {
            if (isChordSpacerToken(w)) continue;
            validWords++;
            if (isChordToken(w)) chCount++;
          }
          if (chCount > 0 && validWords > 0 && (chCount / validWords) >= 0.5) {
            for (const w of words) {
              const cleanW = w.replace(/[()|\[\],-]/g, '');
              if (/^H([#b]?)(m|maj|min|dim|aug|sus|add|[0-9]|\/|$)/.test(cleanW) || /\/H([#b]?)$/.test(cleanW)) {
                hasExplicitH = true;
              }
              if (/^Bb/.test(cleanW) || /\/Bb$/.test(cleanW) || /^B\/(D#|F#)$/.test(cleanW) || /^(G|E|D|A|C|F#m?)\/B$/.test(cleanW)) {
                hasStandardBIndicator = true;
              }
            }
          }
        }
      }
    }

    // Keresztes hangnemekben (G, D, A, E, H, F#, C# és moll párjaik), ha a dalban egyáltalán nincs 'H' leírva,
    // akkor a kottában szereplő 'B' (pl. E-dúrban B/D#, D-dúrban Bm vagy G/B) a 11-es félhangot (H) jelenti!
    const sharpKeys = ['G', 'D', 'A', 'E', 'H', 'B', 'F#', 'C#', 'Em', 'Hm', 'Bm', 'F#m', 'C#m', 'G#m'];
    const isSharpKey = sharpKeys.includes(cleanKey);

    return {
      hasExplicitH,
      treatInputBAs11: hasStandardBIndicator || (!hasExplicitH && isSharpKey)
    };
  }

  /**
   * Akkord token felbontása és transzponálása
   */
  function transposeChordToken(token, semitones, context = {}) {
    if (!token) return token;
    if (isChordSpacerToken(token)) return '';

    // Megőrizzük az esetleges zárójeleket az akkord körül: pl. (Hm7)
    const leadMatch = token.match(/^[(\[]+/);
    const trailMatch = token.match(/[)\]]+$/);
    const lead = leadMatch ? leadMatch[0] : '';
    const trail = trailMatch ? trailMatch[0] : '';
    const core = token.slice(lead.length, trail.length ? token.length - trail.length : token.length).replace(/^-+|-+$/g, '');
    if (!core) return '';

    const chordRegex = /^([A-H][#b]?)(m|maj|min|dim|aug|sus|add|[0-9]|[#b][0-9])*(\/([A-H][#b]?))?$/;
    const match = core.match(chordRegex);
    if (!match) return token;

    const rootNote = match[1];
    const slashPart = match[3] || '';
    const slashNote = match[4] || '';
    const suffix = core.slice(rootNote.length, slashPart ? core.length - slashPart.length : core.length);

    const notation = context.notation || 'hu';
    const bNoteInputMode = context.bNoteInputMode || 'auto'; // 'auto', 'en_b', 'hu_b'
    const songRootPc = context.songRootPc !== undefined ? context.songRootPc : 2;

    // Eldöntjük, hogy a bemeneti "B" betű ebben az akkordban 11-es (H) vagy 10-es (Bb) félhangot jelent-e:
    // Pl. "B/D#", "B/F#", "G/B", "E/B", "D/B", "A/B" zeneelméletileg mindig 11-es (H/D#, G/H, E/H), soha nem Bb/D#!
    const isUnambiguousSlashB11 =
      (rootNote === 'B' && (slashNote === 'D#' || slashNote === 'F#')) ||
      (slashNote === 'B' && ['G', 'E', 'D', 'A', 'C', 'F#'].includes(rootNote));

    let parseNotationForInput = notation;
    if (bNoteInputMode === 'en_b') {
      parseNotationForInput = 'en';
    } else if (bNoteInputMode === 'hu_b') {
      parseNotationForInput = 'hu';
    } else {
      // 'auto' (Intelligens mód):
      if (isUnambiguousSlashB11 || context.treatInputBAs11) {
        parseNotationForInput = 'en';
      }
    }

    const pc = noteToPitchClass(rootNote, parseNotationForInput);
    if (pc === -1) return token;

    const targetPc = (pc + semitones + 120) % 12;
    const targetSongRootPc = (songRootPc + semitones + 120) % 12;
    const preferFlats = [5, 10, 3, 8].includes(targetSongRootPc);

    let slashTargetPc = -1;
    if (slashNote) {
      const spc = noteToPitchClass(slashNote, parseNotationForInput);
      if (spc !== -1) slashTargetPc = (spc + semitones + 120) % 12;
    }

    // Hangszer-specifikus szűrés: Basszus mód (ha van peres basszus, azt emeli ki alaphangnak)
    if (context.instrumentView === 'bass') {
      const bassPc = slashTargetPc !== -1 ? slashTargetPc : targetPc;
      const bassNote = pitchClassToNote(bassPc, {
        notation,
        preferFlats,
        accidentalsOverride: context.accidentalsOverride
      });
      return lead + bassNote + (slashTargetPc !== -1 ? ' (bass)' : '') + trail;
    }

    // Nashville fokszám mód
    if (context.nashville) {
      return lead + toNashville(targetPc, targetSongRootPc, suffix, slashTargetPc) + trail;
    }

    const newRoot = pitchClassToNote(targetPc, {
      notation,
      preferFlats,
      accidentalsOverride: context.accidentalsOverride
    });

    let newSlash = '';
    if (slashTargetPc !== -1) {
      newSlash = '/' + pitchClassToNote(slashTargetPc, {
        notation,
        preferFlats,
        accidentalsOverride: context.accidentalsOverride
      });
    }

    return lead + newRoot + suffix + newSlash + trail;
  }

  /**
   * Pozicionáló / ritmus segédjel az akkordsorban (pl. "-", "--", "|", "."):
   * A felhasználó szabadon tehet "-" jeleket az akkordsorba az akkordok eltolásához / igazításához,
   * a motor figyelmen kívül hagyja őket a megjelenítésnél, de megtartja az akkordok pontos helyét!
   */
  function isChordSpacerToken(word) {
    if (!word) return false;
    const trimmed = String(word).trim();
    return /^[-–—|/\\.,~*]+$/.test(trimmed);
  }

  function isChordToken(word) {
    if (!word) return false;
    if (isChordSpacerToken(word)) return false;
    const cleaned = word.replace(/[()|\[\],]/g, '').replace(/^-+|-+$/g, '').trim();
    if (!cleaned) return false;
    return /^([A-H][#b]?)(m|maj|min|dim|aug|sus|add|7|9|11|13|6|5|4|2|b5|#5|b9|#9)*(\/[A-H][#b]?)?$/.test(cleaned);
  }

  function isChordLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.endsWith(':')) return false;
    // Ha tabulatúra sor (pl. e|---0---2---|)
    if (/^[eBGDAEHa-g]\|[-0-9hpb/\\~x]+/.test(trimmed)) return false;
    const tokens = trimmed.split(/\s+/);
    let chordCount = 0;
    let nonParenTokens = 0;
    for (const t of tokens) {
      // A "-" vagy egyéb pozicionáló segédjeleket és ismétlésjeleket (x2, 2x) figyelmen kívül hagyjuk,
      // hogy bármennyi "-" jellel lehessen szabadon játszani az akkordsorban!
      if (isChordSpacerToken(t) || /^[xX]?\d+[xX]?$/.test(t)) continue;
      if (t.startsWith('(') && t.endsWith(')') && !isChordToken(t)) continue;
      nonParenTokens++;
      if (isChordToken(t)) chordCount++;
    }
    return chordCount > 0 && nonParenTokens > 0 && (chordCount / nonParenTokens) >= 0.6;
  }

  function isTabLine(line) {
    const trimmed = line.trim();
    return /^[eBGDAEHa-g]?\|[-0-9hpb/\\~x|]{4,}/.test(trimmed);
  }

  function hasGuitarTabs(content) {
    if (!content) return false;
    return content.split('\n').some(isTabLine);
  }

  /**
   * Kigyűjti a dalban szereplő összes egyedi akkordot (transzponálva)
   */
  function extractUniqueChords(content, semitones = 0, context = {}) {
    const chords = [];
    const seen = new Set();
    if (!content) return chords;

    const effContext = { ...context };
    if (effContext.treatInputBAs11 === undefined) {
      const bAnalysis = analyzeSongBNotationContext(content, effContext.songKey || 'D');
      effContext.treatInputBAs11 = bAnalysis.treatInputBAs11;
    }

    const lines = content.split('\n');
    for (const line of lines) {
      // ChordPro [Am]
      const bracketMatches = line.match(/\[([^\]]+)\]/g);
      if (bracketMatches) {
        bracketMatches.forEach(m => {
          const inner = m.slice(1, -1).trim();
          if (isChordToken(inner)) {
            const tr = transposeChordToken(inner, semitones, effContext);
            if (tr && !seen.has(tr)) { seen.add(tr); chords.push(tr); }
          }
        });
      }
      if (isChordLine(line)) {
        line.trim().split(/\s+/).forEach(tok => {
          const clean = tok.replace(/[()]/g, '');
          if (isChordToken(clean)) {
            const tr = transposeChordToken(clean, semitones, effContext);
            if (tr && !seen.has(tr)) { seen.add(tr); chords.push(tr); }
          }
        });
      }
    }
    return chords;
  }

  /**
   * Kápó-optimalizáló:
   * Megkeresi, melyik kápó-pozícióval (0..11) kapjuk a legkönnyebb nyitott gitárakkordokat.
   */
  function recommendCapoPositions(content, currentTranspose = 0, context = {}) {
    const results = [];
    for (let capo = 0; capo <= 9; capo++) {
      const shift = currentTranspose - capo;
      const chords = extractUniqueChords(content, shift, { ...context, nashville: false, instrumentView: 'full' });
      let score = 0;
      chords.forEach(ch => {
        const base = ch.split('/')[0];
        if (OPEN_CHORD_WEIGHTS[base]) {
          score += OPEN_CHORD_WEIGHTS[base];
        } else if (base.includes('#') || base.includes('b')) {
          score -= 4;
        } else {
          score += 2;
        }
      });
      results.push({
        capo,
        score,
        chords: chords.slice(0, 6)
      });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  /**
   * Egykattintásos konvertáló: Szöveg feletti akkordok <-> ChordPro ([Am]Szöveg)
   */
  function convertOverToChordPro(content) {
    const lines = content.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (isChordLine(line) && i + 1 < lines.length && !isChordLine(lines[i + 1]) && lines[i + 1].trim() !== '') {
        const chordLine = line;
        const lyricLine = lines[i + 1];
        // Pozíciók kigyűjtése a szokásos oszlopok alapján
        const placements = [];
        const regex = /(\S+)/g;
        let match;
        while ((match = regex.exec(chordLine)) !== null) {
          placements.push({ index: match.index, chord: match[1] });
        }
        let merged = lyricLine;
        for (let p = placements.length - 1; p >= 0; p--) {
          const pos = Math.min(placements[p].index, merged.length);
          merged = merged.slice(0, pos) + `[${placements[p].chord}]` + merged.slice(pos);
        }
        out.push(merged);
        i += 2;
      } else {
        out.push(line);
        i++;
      }
    }
    return out.join('\n');
  }

  function convertChordProToOver(content) {
    const lines = content.split('\n');
    const out = [];
    for (const line of lines) {
      if (line.includes('[') && line.includes(']') && !/^\[Vokál/i.test(line.trim())) {
        let chordRow = '';
        let lyricRow = '';
        let i = 0;
        while (i < line.length) {
          if (line[i] === '[') {
            const closeIdx = line.indexOf(']', i);
            if (closeIdx !== -1) {
              const rawChord = line.slice(i + 1, closeIdx);
              if (isChordToken(rawChord)) {
                while (chordRow.length < lyricRow.length) chordRow += ' ';
                chordRow += rawChord + ' ';
                i = closeIdx + 1;
                continue;
              }
            }
          }
          lyricRow += line[i];
          i++;
        }
        if (chordRow.trim()) out.push(chordRow.trimEnd());
        out.push(lyricRow);
      } else {
        out.push(line);
      }
    }
    return out.join('\n');
  }

  /**
   * Valódi grafikus SVG Akkorddiagram generátor (Gitár, Ukulele, Zongora, Mandolin, Bendzsó)
   */
  const GUITAR_VOICINGS = {
    'C':  [-1, 3, 2, 0, 1, 0],
    'D':  [-1, -1, 0, 2, 3, 2],
    'Dm': [-1, -1, 0, 2, 3, 1],
    'D7': [-1, -1, 0, 2, 1, 2],
    'E':  [0, 2, 2, 1, 0, 0],
    'Em': [0, 2, 2, 0, 0, 0],
    'Em7':[0, 2, 0, 0, 0, 0],
    'F':  [1, 3, 3, 2, 1, 1],
    'F#m':[2, 4, 4, 2, 2, 2],
    'F#7':[2, 4, 2, 3, 2, 2],
    'G':  [3, 2, 0, 0, 0, 3],
    'G7': [3, 2, 0, 0, 0, 1],
    'A':  [-1, 0, 2, 2, 2, 0],
    'Am': [-1, 0, 2, 2, 1, 0],
    'A7': [-1, 0, 2, 0, 2, 0],
    'Asus4': [-1, 0, 2, 2, 3, 0],
    'B':  [-1, 1, 3, 3, 3, 1],
    'Bb': [-1, 1, 3, 3, 3, 1],
    'Hm': [-1, 2, 4, 4, 3, 2],
    'Bm': [-1, 2, 4, 4, 3, 2],
    'H':  [-1, 2, 4, 4, 4, 2],
    'C7': [-1, 3, 2, 3, 1, 0]
  };

  function generateChordDiagramSVG(chordName, instrument = 'Gitár', leftHanded = false) {
    const baseChord = chordName.split('/')[0];

    if (instrument === 'Zongora') {
      // Zongora billentyűzet diagram (1 oktáv + terc/kvint)
      const rootMatch = baseChord.match(/^([A-H][#b]?)/);
      const rootPc = rootMatch ? noteToPitchClass(rootMatch[1], 'hu') : 0;
      const isMinor = baseChord.includes('m') && !baseChord.includes('maj');
      const thirdPc = (rootPc + (isMinor ? 3 : 4)) % 12;
      const fifthPc = (rootPc + 7) % 12;
      const activePcs = new Set([rootPc, thirdPc, fifthPc]);

      const whiteKeys = [0, 2, 4, 5, 7, 9, 11];
      const blackKeys = [
        { pc: 1, x: 13 }, { pc: 3, x: 29 },
        { pc: 6, x: 61 }, { pc: 8, x: 77 }, { pc: 10, x: 93 }
      ];

      let svg = `<svg viewBox="0 0 116 64" width="110" height="62">`;
      whiteKeys.forEach((pc, idx) => {
        const fill = activePcs.has(pc) ? 'var(--accent)' : '#ffffff';
        svg += `<rect x="${2 + idx * 16}" y="4" width="15" height="54" rx="2" fill="${fill}" stroke="#334155" stroke-width="1.2"/>`;
      });
      blackKeys.forEach(bk => {
        const fill = activePcs.has(bk.pc) ? '#f59e0b' : '#1e293b';
        svg += `<rect x="${bk.x}" y="4" width="10" height="34" rx="1.5" fill="${fill}" stroke="#0f172a" stroke-width="1"/>`;
      });
      svg += `</svg>`;
      return svg;
    }

    // Húros hangszer (Gitár 6 húr, Ukulele/Mandolin/Bendzsó 4 húr)
    const numStrings = (instrument === 'Ukulele' || instrument === 'Mandolin' || instrument === 'Bendzsó') ? 4 : 6;
    let frets = GUITAR_VOICINGS[baseChord] || [0, 2, 2, 1, 0, 0];
    if (numStrings === 4) {
      frets = frets.slice(2, 6).map(f => Math.max(0, f));
    }
    if (leftHanded) {
      frets = [...frets].reverse();
    }

    const width = 84;
    const height = 96;
    const padX = 14;
    const padY = 18;
    const gridW = width - padX * 2;
    const gridH = 64;
    const strSpacing = gridW / (numStrings - 1);
    const fretSpacing = gridH / 4;

    let svg = `<svg viewBox="0 0 ${width} ${height}" width="84" height="94">`;
    // Felső nyereg
    svg += `<line x1="${padX}" y1="${padY}" x2="${padX + gridW}" y2="${padY}" stroke="currentColor" stroke-width="3.2"/>`;
    // Bundok
    for (let f = 1; f <= 4; f++) {
      const y = padY + f * fretSpacing;
      svg += `<line x1="${padX}" y1="${y}" x2="${padX + gridW}" y2="${y}" stroke="currentColor" stroke-width="1" opacity="0.6"/>`;
    }
    // Húrok
    for (let s = 0; s < numStrings; s++) {
      const x = padX + s * strSpacing;
      svg += `<line x1="${x}" y1="${padY}" x2="${x}" y2="${padY + gridH}" stroke="currentColor" stroke-width="1.1" opacity="0.8"/>`;
      const fVal = frets[s];
      if (fVal === -1) {
        svg += `<text x="${x}" y="${padY - 5}" text-anchor="middle" font-size="9" fill="currentColor">✕</text>`;
      } else if (fVal === 0) {
        svg += `<circle cx="${x}" cy="${padY - 7}" r="3" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
      } else {
        const clampedFret = Math.min(4, fVal);
        const cy = padY + (clampedFret - 0.5) * fretSpacing;
        svg += `<circle cx="${x}" cy="${cy}" r="4.6" fill="var(--accent)"/>`;
      }
    }
    svg += `</svg>`;
    return svg;
  }

  return {
    SCALE_HU_SHARP,
    SCALE_HU_FLAT,
    SCALE_EN_SHARP,
    SCALE_EN_FLAT,
    noteToPitchClass,
    pitchClassToNote,
    analyzeSongBNotationContext,
    transposeChordToken,
    isChordSpacerToken,
    isChordToken,
    isChordLine,
    isTabLine,
    hasGuitarTabs,
    extractUniqueChords,
    recommendCapoPositions,
    convertOverToChordPro,
    convertChordProToOver,
    generateChordDiagramSVG
  };
})();
