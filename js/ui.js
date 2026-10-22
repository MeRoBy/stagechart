/**
 * StageChart — Felületvezérlő, Élő Formázó, Daltár, Setlista és Beállítások Motor
 * Fájl: js/ui.js
 */

window.StageChartUI = (function () {
  const Theory = window.StageChartTheory;
  const AudioEngine = window.StageChartAudio;
  const StageTools = window.StageChartStageTools;

  // Állapot betöltése LocalStorage-ból vagy az alapértelmezett könyvtárból
  let songs = JSON.parse(localStorage.getItem('stagechart_songs_v2')) || window.STAGECHART_DEFAULT_SONGS;
  // Ha egy korábbi sikertelen SongbookPro importból bent maradt volna egy hibás "dataFile" nevű bejegyzés, automatikusan kiszűrjük
  if (Array.isArray(songs)) {
    songs = songs.filter(s => s && s.title !== 'dataFile' && !String(s.content || '').trim().startsWith('1.0'));
    if (songs.length === 0) songs = JSON.parse(JSON.stringify(window.STAGECHART_DEFAULT_SONGS));
  }
  let setlists = JSON.parse(localStorage.getItem('stagechart_setlists_v2')) || window.STAGECHART_DEFAULT_SETLISTS;
  let settings = loadMergedSettings();

  const runtime = {
    currentSongId: songs[0] ? songs[0].id : 1,
    activeSetlistId: null,
    viewingSetlistId: null, // Ha egy konkrét setlistába léptünk be az oldalsávon
    sidebarTab: 'songs',    // 'songs' vagy 'setlists'
    sortMode: 'title',      // 'title', 'artist', 'key', 'recent', 'number'
    multiSelectMode: false,
    selectedSongIds: [],
    importIntoActiveSetlist: false,
    pickerTempSongIds: [],
    pickerSearch: '',
    pickerSort: 'title',
    transposeSemitones: 0,
    capo: 0,
    lyricsOnly: false,
    nashville: false,
    instrumentView: 'full', // 'full', 'bass', 'vocals'
    autoScrolling: false,
    scrollSpeed: 4,
    scrollDurationSec: 90,
    drawingMode: false,
    brushColor: 'rgba(250, 204, 21, 0.5)',
    brushSize: 16,
    formattingOpenedFromSettings: false
  };

  // Memóriabeli Blob URL tároló nagy PDF/kép fájlokhoz, hogy a LocalStorage sose teljen be és a böngésző ne fagyjon le
  const mediaBlobUrls = {};

  let scrollInterval = null;
  let scrollDelayTimeout = null;
  let topbarHideTimeout = null;

  function loadMergedSettings() {
    const saved = JSON.parse(localStorage.getItem('stagechart_settings_v2') || 'null');
    const def = JSON.parse(JSON.stringify(window.STAGECHART_DEFAULT_SETTINGS));
    if (!saved) return def;
    return {
      ...def,
      ...saved,
      accidentalsOverride: { ...def.accidentalsOverride, ...(saved.accidentalsOverride || {}) },
      formatting: { ...def.formatting, ...(saved.formatting || {}) },
      audioRouting: { ...def.audioRouting, ...(saved.audioRouting || {}) }
    };
  }

  function persistAll() {
    try {
      localStorage.setItem('stagechart_songs_v2', JSON.stringify(songs));
      localStorage.setItem('stagechart_setlists_v2', JSON.stringify(setlists));
      localStorage.setItem('stagechart_settings_v2', JSON.stringify(settings));
    } catch (e) {
      console.warn('LocalStorage kvóta figyelmeztetés (nagy PDF/kép memóriából fut):', e);
    }
    // Trial limit: a daltár méretének változásakor frissítjük a letiltott gombokat (license modul)
    try { refreshLicenseLocks(); } catch (e) {}
  }

  function getCurrentSong() {
    if (sessionSetlist && Array.isArray(sessionSetlist.songs) && sessionSetlist.songs.length) {
      const found = sessionSetlist.songs.find(s => String(s.id) === String(runtime.currentSongId));
      if (found) return found;
      return sessionSetlist.songs[0];
    }
    return songs.find(s => s.id === runtime.currentSongId) || songs[0];
  }

  /********************************************************************
   * 1. KOTTA RENDERELÉS (CHORDPRO, SZÖVEG FELETTI, SZAKASZOK, PDF/FOTÓ, TABOK)
   ********************************************************************/
  function renderSongInto(song, containerEl, roadmapEl = null, isInteractiveMain = false) {
    containerEl.innerHTML = '';
    if (roadmapEl) roadmapEl.innerHTML = '';
    if (!song) return;

    const pdfSrc = mediaBlobUrls[song.id] || song.pdfDataUrl;
    const imgSrc = song.imageDataUrl;

    // Ha PDF dokumentumként vagy lefotózott kottaként importált dal (és még nincs átalakítva szöveges kottává)
    if ((pdfSrc || imgSrc) && (!song.content || !song.content.trim())) {
      containerEl.style.columnCount = '1';
      containerEl.style.columnRule = 'none';
      const invertStyle = settings.pdfInvertColors ? 'filter: invert(1) hue-rotate(180deg);' : '';
      const convertBanner = isInteractiveMain ? `
        <div style="width:100%; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; padding:10px 14px; margin-bottom:12px; border-radius:8px; background:var(--accent-soft); border:1px solid var(--accent); font-family:var(--font-ui);">
          <div style="font-size:13px;">
            <strong>📄 Importált ${pdfSrc ? 'PDF' : 'Fotózott'} kotta</strong> — Automatikus szöveg- és akkordfelismerés szerkeszthető, transzponálható StageChart énekké:
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            ${pdfSrc ? `<a href="${pdfSrc}" target="_blank" rel="noopener" class="btn-outline" style="text-decoration:none; white-space:nowrap; padding:6px 12px; font-size:12.5px;">🔍 PDF külön lapon</a>` : ''}
            <button class="btn-outline" style="white-space:nowrap; padding:6px 12px; font-size:12.5px;" onclick="StageChartUI.openConvertMediaToEditableModal()">✏️ Ellenőrzés / Szerkesztés</button>
            <button class="btn-primary" style="white-space:nowrap;" onclick="StageChartUI.quickAutoConvertCurrentMediaSong()">✨ Azonnali átalakítás kottává</button>
          </div>
        </div>
      ` : '';

      if (pdfSrc) {
        containerEl.innerHTML = `
          ${convertBanner}
          <div style="width:100%; min-height:80vh; display:flex; flex-direction:column; align-items:stretch;">
            <embed src="${pdfSrc}#toolbar=1&navpanes=0&view=FitH" type="application/pdf" width="100%" height="820px" style="border-radius:8px; border:1px solid var(--border); background:#fff; ${invertStyle}" />
          </div>
        `;
      } else {
        containerEl.innerHTML = `
          ${convertBanner}
          <div style="width:100%; display:flex; flex-direction:column; align-items:flex-start;">
            <img src="${imgSrc}" alt="${song.title}" style="max-width:100%; border-radius:8px; border:1px solid var(--border); ${invertStyle}" />
          </div>
        `;
      }
      return;
    }

    const fmt = settings.formatting;
    const baseKeyClean = (song.key || 'D').replace('m', '');
    const songRootPc = Theory.noteToPitchClass(baseKeyClean, settings.notation);
    const effectiveShift = runtime.transposeSemitones - runtime.capo;
    const bAnalysis = Theory.analyzeSongBNotationContext(song.content, song.key || 'D');

    const theoryContext = {
      notation: settings.notation,
      bNoteInputMode: settings.bNoteInputMode || 'auto',
      treatInputBAs11: bAnalysis.treatInputBAs11,
      songKey: song.key || 'D',
      songRootPc: songRootPc !== -1 ? songRootPc : 2,
      accidentalsOverride: settings.accidentalsOverride,
      nashville: runtime.nashville,
      instrumentView: runtime.instrumentView
    };

    // Figyelmeztetés, ha a dalban gitár tabulatúra van és transzponálva lett
    if (isInteractiveMain && settings.warnTabsOnTranspose && effectiveShift !== 0 && Theory.hasGuitarTabs(song.content)) {
      const warnDiv = document.createElement('div');
      warnDiv.style.cssText = 'margin-bottom:14px; padding:8px 12px; border-radius:8px; background:#fef3c7; color:#92400e; border:1px solid #f59e0b; font-size:13px;';
      warnDiv.textContent = '⚠ Figyelem: Az ének gitár tabulatúrát tartalmaz, amely transzponáláskor nem változik automatikusan!';
      containerEl.appendChild(warnDiv);
    }

    const rawLines = (song.content || '').split('\n');
    let currentSection = document.createElement('div');
    currentSection.className = 'song-section';
    containerEl.appendChild(currentSection);

    let activeSecStyle = null;

    function isSectionHeaderLine(str) {
      const t = str.trim();
      return /^(Verse|Chorus|Bridge|Intro|Outro|Pre-Chorus|Refrén|Szóló|Interlude|Coda).*:/i.test(t) ||
             /^(Verse|Chorus|Bridge|Intro|Outro)\s*[0-9]*$/i.test(t);
    }

    function isSpecialLine(str) {
      const t = str.trim();
      if (!t) return true;
      if (isSectionHeaderLine(t)) return true;
      if (/^\[(Vokál|Szólam|Vocal).*\]$/i.test(t)) return true;
      if (t.startsWith('(') && t.endsWith(')') && !Theory.isChordLine(t)) return true;
      return false;
    }

    for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
      const line = rawLines[lineIdx];
      const trimmed = line.trim();

      // 1. Szakasz fejléc felismerése (pl. "Verse 1:", "Chorus:", "Bridge:", "Intro:", "Refrén:")
      if (isSectionHeaderLine(trimmed)) {
        const secName = trimmed.replace(':', '').trim();
        currentSection = document.createElement('div');
        currentSection.className = 'song-section';

        // Szakasz-specifikus stílus keresése (Verse, Chorus, Bridge...)
        activeSecStyle = findSectionStyle(secName);
        if (activeSecStyle) {
          if (activeSecStyle.indent) currentSection.classList.add('indented');
          if (activeSecStyle.bold) currentSection.style.fontWeight = '700';
          if (activeSecStyle.italic) currentSection.style.fontStyle = 'italic';
          if (activeSecStyle.color && activeSecStyle.color !== 'default') {
            currentSection.style.color = activeSecStyle.color;
          }
        } else if (/^(Chorus|Refrén)/i.test(secName)) {
          currentSection.classList.add('indented');
        }

        if (fmt.headingsEnabled !== false) {
          const hRow = document.createElement('div');
          hRow.className = 'section-heading-row';
          const h = document.createElement('div');
          h.className = 'section-heading';
          h.textContent = secName;
          hRow.appendChild(h);

          if (isInteractiveMain) {
            const loopBtn = document.createElement('button');
            loopBtn.className = 'loop-sec-btn';
            loopBtn.textContent = '🔁 Hurok (8 ütem)';
            const secRef = currentSection;
            loopBtn.onclick = (e) => {
              e.stopPropagation();
              const loopState = StageTools.toggleSectionLoop(secName, secRef, 8);
              updateRoadmapLoopBadges();
              if (loopState) {
                StageTools.showStageCueBanner(`Szakasz-hurok aktív: ${secName}`, 2000, false);
              }
            };
            hRow.appendChild(loopBtn);
          }
          currentSection.appendChild(hRow);
        }

        containerEl.appendChild(currentSection);

        // Roadmap ugrógomb hozzáadása
        if (roadmapEl) {
          const pill = document.createElement('span');
          pill.className = 'roadmap-pill';
          pill.dataset.secName = secName;
          pill.textContent = secName;
          const targetSec = currentSection;
          pill.onclick = () => {
            targetSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
          };
          pill.oncontextmenu = (e) => {
            e.preventDefault();
            StageTools.toggleSectionLoop(secName, targetSec, 8);
            updateRoadmapLoopBadges();
          };
          roadmapEl.appendChild(pill);
        }
        continue;
      }

      // 2. Vokál / 2. szólam sor: pl. "[Vokál 2: ...]"
      if (/^\[(Vokál|Szólam|Vocal).*\]$/i.test(trimmed)) {
        const vDiv = document.createElement('div');
        vDiv.className = 'vocal-harmony-line';
        vDiv.textContent = trimmed.slice(1, -1);
        currentSection.appendChild(vDiv);
        continue;
      }

      // 3. Zárójeles megjegyzés / instrukció sor: pl. "(Dinamikai leállás!)"
      if (trimmed.startsWith('(') && trimmed.endsWith(')') && !Theory.isChordLine(trimmed)) {
        const nDiv = document.createElement('div');
        nDiv.className = 'note-line';
        nDiv.textContent = fmt.hideParensInChordLines ? trimmed.slice(1, -1) : trimmed;
        currentSection.appendChild(nDiv);
        continue;
      }

      // 4. ChordPro sor (pl. "[D]Amazing [G]Grace") -> Szótaghoz rögzített szegmensek
      if (line.includes('[') && line.includes(']')) {
        const segments = parseChordProIntoSegments(line, effectiveShift, theoryContext);
        appendSyllableLockedRow(currentSection, segments, lineIdx, song, isInteractiveMain);
        continue;
      }

      // 5. Szöveg feletti akkordsor: ha a következő sor dalszöveg, összekapcsoljuk a szótagokkal!
      if (Theory.isChordLine(line)) {
        let processedChordLine = line;
        if (fmt.hideParensInChordLines) {
          processedChordLine = processedChordLine.replace(/[()]/g, ' ');
        }

        const nextLine = lineIdx + 1 < rawLines.length ? rawLines[lineIdx + 1] : null;
        const hasLyricBelow = nextLine !== null &&
          !isSpecialLine(nextLine) &&
          !Theory.isChordLine(nextLine) &&
          !Theory.isTabLine(nextLine) &&
          !(nextLine.includes('[') && nextLine.includes(']'));

        if (hasLyricBelow) {
          const segments = pairChordLineWithLyricLine(processedChordLine, nextLine, effectiveShift, theoryContext);
          appendSyllableLockedRow(currentSection, segments, lineIdx + 1, song, isInteractiveMain);
          lineIdx++; // Átlépjük a már feldolgozott dalszöveg sort
        } else {
          // Önálló akkordsor (pl. Intro: Hm G D A)
          if (runtime.instrumentView !== 'vocals') {
            const cDiv = document.createElement('div');
            cDiv.className = 'chord-line';
            cDiv.innerHTML = processedChordLine.replace(/(\S+)/g, (tok) => {
              // Ha a felhasználó "-" jelet tett az akkordsorba az akkordok eltolásához / igazításához,
              // nem jelenítjük meg, de megtartjuk a szóköz-szélességét!
              if (Theory.isChordSpacerToken(tok)) return ' '.repeat(tok.length);
              if (!Theory.isChordToken(tok)) return tok;
              const tr = Theory.transposeChordToken(tok, effectiveShift, theoryContext);
              const cleanChord = tr.replace(/[()]/g, '');
              return `<span class="chord-token" onclick="StageChartUI.showSingleChordPopup('${cleanChord}')">${tr}</span>`;
            });
            currentSection.appendChild(cDiv);
          }
        }
        continue;
      }

      // 6. Sima dalszöveg sor (akkord nélkül)
      appendLyricLineWithNotes(currentSection, line, lineIdx, song, isInteractiveMain);
    }
  }

  /**
   * Összepárosítja a szöveg feletti akkordsort az alatta lévő dalszöveg-sor pontos szótagjaival
   */
  function pairChordLineWithLyricLine(chordLine, lyricLine, effectiveShift, theoryContext) {
    const placements = [];
    const regex = /(\S+)/g;
    let match;
    while ((match = regex.exec(chordLine)) !== null) {
      const rawTok = match[1];
      // Ha a felhasználó "-" vagy egyéb pozicionáló segédjelet írt az akkordsorba,
      // figyelmen kívül hagyjuk (nem írjuk ki), de a mögötte lévő akkordok pontos match.index pozíciója megmarad!
      if (Theory.isChordSpacerToken(rawTok)) continue;
      const tr = Theory.isChordToken(rawTok)
        ? Theory.transposeChordToken(rawTok, effectiveShift, theoryContext)
        : rawTok;
      if (tr) {
        placements.push({ col: match.index, chord: tr });
      }
    }

    if (placements.length === 0) {
      return [{ chord: '', lyric: lyricLine }];
    }

    // Ha az utolsó akkord túlnyúlik a szöveg hosszán, kiegészítjük szóközzel
    const maxCol = placements[placements.length - 1].col;
    const paddedLyric = lyricLine.length < maxCol ? lyricLine.padEnd(maxCol, ' ') : lyricLine;

    const segments = [];
    if (placements[0].col > 0) {
      segments.push({
        chord: '',
        lyric: paddedLyric.slice(0, placements[0].col)
      });
    }

    for (let i = 0; i < placements.length; i++) {
      const startCol = placements[i].col;
      const endCol = (i + 1 < placements.length) ? placements[i + 1].col : paddedLyric.length;
      segments.push({
        chord: placements[i].chord,
        lyric: paddedLyric.slice(startCol, endCol)
      });
    }

    return segments;
  }

  /**
   * ChordPro sor ("[D]Amazing [G]Grace") felbontása szótaghoz rögzített szegmensekre
   */
  function parseChordProIntoSegments(line, effectiveShift, theoryContext) {
    const segments = [];
    const parts = line.split(/(\[[^\]]+\])/g);
    let pendingChord = '';

    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('[') && part.endsWith(']')) {
        const rawChord = part.slice(1, -1).trim();
        if (Theory.isChordSpacerToken(rawChord)) continue;
        if (pendingChord) {
          segments.push({ chord: pendingChord, lyric: ' ' });
        }
        pendingChord = Theory.transposeChordToken(rawChord, effectiveShift, theoryContext);
      } else {
        segments.push({ chord: pendingChord, lyric: part });
        pendingChord = '';
      }
    }
    if (pendingChord) {
      segments.push({ chord: pendingChord, lyric: '' });
    }
    return segments;
  }

  /**
   * Szótaghoz rögzített (Syllable-Locked) akkord + szöveg sor DOM felépítése
   */
  function appendSyllableLockedRow(sectionEl, segments, lineIdx, song, isInteractiveMain) {
    const wrap = document.createElement('div');
    wrap.className = 'lyric-line-wrap';

    const row = document.createElement('div');
    row.className = 'chord-lyric-row';
    if (settings.longLinesBehavior === 'shrink') {
      row.classList.add('nowrap-shrink');
    }

    segments.forEach(seg => {
      const segEl = document.createElement('span');
      segEl.className = 'chord-lyric-seg';

      if (runtime.instrumentView !== 'vocals') {
        const chordSpan = document.createElement('span');
        chordSpan.className = 'seg-chord';
        if (seg.chord) {
          const cleanChord = seg.chord.replace(/[()]/g, '');
          chordSpan.innerHTML = `<span class="chord-token" onclick="StageChartUI.showSingleChordPopup('${cleanChord}')">${seg.chord}</span>`;
        } else {
          chordSpan.textContent = ' ';
        }
        segEl.appendChild(chordSpan);
      }

      const lyricSpan = document.createElement('span');
      lyricSpan.className = 'seg-lyric';
      lyricSpan.textContent = seg.lyric || '';
      segEl.appendChild(lyricSpan);

      row.appendChild(segEl);
    });

    if (isInteractiveMain) {
      row.ondblclick = () => {
        const existing = (song.rehearsalNotes && song.rehearsalNotes[lineIdx]) || '';
        const note = prompt('Próbatermi megjegyzés ehhez a sorhoz (üresen hagyva törlődik):', existing);
        if (note === null) return;
        if (!song.rehearsalNotes) song.rehearsalNotes = {};
        if (note.trim() === '') delete song.rehearsalNotes[lineIdx];
        else song.rehearsalNotes[lineIdx] = note.trim();
        persistAll();
        refreshMainView();
      };
    }

    wrap.appendChild(row);

    if (song.rehearsalNotes && song.rehearsalNotes[lineIdx]) {
      const badge = document.createElement('span');
      badge.className = 'rehearsal-note-badge';
      badge.textContent = '📌 ' + song.rehearsalNotes[lineIdx];
      badge.title = 'Kattints a próbajegyzet szerkesztéséhez';
      badge.onclick = () => row.ondblclick();
      wrap.appendChild(badge);
    }

    sectionEl.appendChild(wrap);
  }

  function appendLyricLineWithNotes(sectionEl, text, lineIdx, song, isInteractiveMain) {
    const wrap = document.createElement('div');
    wrap.className = 'lyric-line-wrap';

    const lDiv = document.createElement('div');
    lDiv.className = 'lyric-line';
    if (settings.longLinesBehavior === 'shrink') {
      lDiv.classList.add('nowrap-shrink');
    }
    lDiv.textContent = text || ' ';

    // Dupla kattintással próbatermi megjegyzés fűzhető bármelyik sorhoz
    if (isInteractiveMain && text.trim()) {
      lDiv.ondblclick = () => {
        const existing = (song.rehearsalNotes && song.rehearsalNotes[lineIdx]) || '';
        const note = prompt('Próbatermi megjegyzés ehhez a sorhoz (üresen hagyva törlődik):', existing);
        if (note === null) return;
        if (!song.rehearsalNotes) song.rehearsalNotes = {};
        if (note.trim() === '') delete song.rehearsalNotes[lineIdx];
        else song.rehearsalNotes[lineIdx] = note.trim();
        persistAll();
        refreshMainView();
      };
    }

    wrap.appendChild(lDiv);

    if (song.rehearsalNotes && song.rehearsalNotes[lineIdx]) {
      const badge = document.createElement('span');
      badge.className = 'rehearsal-note-badge';
      badge.textContent = '📌 ' + song.rehearsalNotes[lineIdx];
      badge.title = 'Kattints a próbajegyzet szerkesztéséhez';
      badge.onclick = () => lDiv.ondblclick();
      wrap.appendChild(badge);
    }

    sectionEl.appendChild(wrap);
  }

  function findSectionStyle(secName) {
    const list = settings.formatting.sectionStyles || [];
    const lower = secName.toLowerCase();
    return list.find(s => lower.startsWith(s.name.toLowerCase()));
  }

  function updateRoadmapLoopBadges() {
    const active = StageTools.getActiveLoopSection();
    document.querySelectorAll('#roadmapBar .roadmap-pill').forEach(pill => {
      pill.classList.toggle('looping', !!(active && active.name === pill.dataset.secName));
    });
  }

  /********************************************************************
   * 2. FŐ KÉPERNYŐ, SETLISTA HANGNEM-MEMÓRIA ÉS METAADATOK FRISSÍTÉSE
   ********************************************************************/
  function getActiveOrViewingSetlist() {
    const id = runtime.activeSetlistId || runtime.viewingSetlistId;
    if (!id) return null;
    return setlists.find(l => l.id === id) || null;
  }

  function getEffectiveSongKeyInSetlist(song, list) {
    if (!song) return 'D';
    const ov = list && list.songOverrides ? list.songOverrides[String(song.id)] : null;
    const isMinor = (song.key || '').endsWith('m');
    const basePc = Theory.noteToPitchClass((song.key || 'D').replace('m', ''), settings.notation);
    const validBasePc = basePc !== -1 ? basePc : 2;
    const tr = ov && typeof ov.transposeSemitones === 'number' ? ov.transposeSemitones : 0;
    const soundingPc = (validBasePc + tr + 120) % 12;
    const preferFlats = [5, 10, 3, 8, 1].includes(soundingPc);
    return Theory.pitchClassToNote(soundingPc, {
      notation: settings.notation,
      preferFlats,
      accidentalsOverride: settings.accidentalsOverride
    }) + (isMinor ? 'm' : '');
  }

  function saveCurrentSongOverrideToActiveSetlist() {
    const list = getActiveOrViewingSetlist();
    const song = getCurrentSong();
    if (!list || !song) return;
    if (!list.songOverrides) list.songOverrides = {};
    if (runtime.transposeSemitones === 0 && runtime.capo === 0) {
      delete list.songOverrides[String(song.id)];
    } else {
      list.songOverrides[String(song.id)] = {
        transposeSemitones: runtime.transposeSemitones,
        capo: runtime.capo
      };
    }
    persistAll();
  }

  function getCurrentTimeStr() {
    const now = new Date();
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }

  function getNextSongForTopbar(currentSong) {
    if (!currentSong) return null;
    if (sessionSetlist && Array.isArray(sessionSetlist.songs) && sessionSetlist.songs.length) {
      const sSongs = sessionSetlist.songs;
      const sIds = (sessionSetlist.setlist && Array.isArray(sessionSetlist.setlist.songIds) && sessionSetlist.setlist.songIds.length)
        ? sessionSetlist.setlist.songIds
        : sSongs.map(s => s.id);
      const curIdx = sIds.findIndex(id => String(id) === String(currentSong.id));
      if (curIdx !== -1 && curIdx + 1 < sIds.length) {
        const nextId = sIds[curIdx + 1];
        const nextS = sSongs.find(s => String(s.id) === String(nextId));
        if (nextS) return { song: nextS, label: `Következő: ${nextS.title} (${nextS.key || ''})` };
      }
      return { song: null, label: 'Következő: (Lista vége)' };
    }
    const activeList = getActiveOrViewingSetlist();
    if (activeList && Array.isArray(activeList.songIds) && activeList.songIds.length > 0) {
      const curIdx = activeList.songIds.indexOf(currentSong.id);
      if (curIdx !== -1 && curIdx + 1 < activeList.songIds.length) {
        const nextId = activeList.songIds[curIdx + 1];
        const nextS = songs.find(s => s.id === nextId);
        if (nextS) {
          const effK = getEffectiveSongKeyInSetlist(nextS, activeList);
          return { song: nextS, label: `Következő: ${nextS.title} (${effK})` };
        }
      }
      return { song: null, label: 'Következő: (Lista vége)' };
    }
    // Ha nem egy Setlistában vagyunk, az aktuális rendezés szerinti következő éneket mutatjuk
    const sorted = sortSongsArray(songs, runtime.sortMode);
    if (sorted.length > 1) {
      const idx = sorted.findIndex(s => s.id === currentSong.id);
      if (idx !== -1 && idx + 1 < sorted.length) {
        const nextS = sorted[idx + 1];
        return { song: nextS, label: `Következő: ${nextS.title}` };
      }
    }
    return null;
  }

  function resolveTopbarElementValue(type, song, soundingKeyName) {
    if (!song || type === 'none') return '';
    switch (type) {
      case 'title':
        return song.title || '';
      case 'nextSong': {
        const nxt = getNextSongForTopbar(song);
        return nxt ? nxt.label : '';
      }
      case 'clock':
        return getCurrentTimeStr();
      case 'subtitle':
        return song.altTitle || '';
      case 'artist':
        return song.artist || '';
      case 'key':
        return `Hangnem: ${soundingKeyName || song.key || 'D'}${runtime.capo > 0 ? ' (Kápó ' + runtime.capo + ')' : ''}`;
      case 'tempo':
        return `${song.bpm ? song.bpm + ' BPM' : ''}${song.timeSig ? ' (' + song.timeSig + ')' : ''}`;
      case 'setlist': {
        const activeList = getActiveOrViewingSetlist();
        return activeList ? activeList.name : '';
      }
      default:
        return '';
    }
  }

  function refreshTopbarCenterLines(song, soundingKeyName) {
    const s = song || getCurrentSong();
    if (!s) return;

    const t1 = settings.topbarLine1 || 'title';
    const t2 = settings.topbarLine2 || 'nextSong';
    const t3 = settings.topbarLine3 || 'clock';

    const val1 = resolveTopbarElementValue(t1, s, soundingKeyName);
    const val2 = resolveTopbarElementValue(t2, s, soundingKeyName);
    const val3 = resolveTopbarElementValue(t3, s, soundingKeyName);

    const el1 = document.getElementById('topSongTitle');
    const el2 = document.getElementById('topSubLine');
    const el3 = document.getElementById('liveClock');
    const row3 = document.getElementById('topThirdRow');

    if (el1) {
      el1.textContent = val1;
      el1.style.display = val1 ? 'block' : 'none';
    }
    if (el2) {
      el2.textContent = val2;
      el2.style.display = val2 ? 'block' : 'none';
    }
    if (el3) {
      el3.textContent = val3;
      el3.style.display = val3 ? 'inline' : 'none';
    }
    if (row3) {
      const gigPill = document.getElementById('gigClockPill');
      const gigActive = gigPill && gigPill.classList.contains('active');
      row3.style.display = (val3 || gigActive) ? 'flex' : 'none';
    }
  }

  /**
   * "Parancssor opciók" Modal (Fent középen a címre kattintva jön elő — 3 soros testreszabható fejléc!)
   */
  function openTopbarOptionsModal() {
    closeAllDropdowns();
    const t1 = settings.topbarLine1 || 'title';
    const t2 = settings.topbarLine2 || 'nextSong';
    const t3 = settings.topbarLine3 || 'clock';

    const optionsList = [
      { val: 'title', label: 'Cím' },
      { val: 'nextSong', label: 'Következő ének' },
      { val: 'clock', label: 'Idő' },
      { val: 'subtitle', label: 'Alcím' },
      { val: 'artist', label: 'Előadó' },
      { val: 'key', label: 'Hangnem' },
      { val: 'tempo', label: 'Tempó (BPM)' },
      { val: 'setlist', label: 'Aktív lista neve' },
      { val: 'none', label: 'Nincs (Elrejtve)' }
    ];

    const buildOpts = (selectedVal) =>
      optionsList.map(o => `<option value="${o.val}" ${o.val === selectedVal ? 'selected' : ''}>${o.label}</option>`).join('');

    const html = `
      <div style="max-width:340px; margin:0 auto; padding:6px 4px;">
        <h3 style="text-align:center; font-size:20px; font-weight:500; margin-bottom:18px;">Parancssor opciók</h3>

        <div style="margin-bottom:14px;">
          <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:4px;">Elsődleges elem (1. sor — Nagyobb betűvel)</div>
          <select class="line-input" id="topOptLine1" style="width:100%; font-size:15px; padding:6px 4px; background:transparent;" onchange="StageChartUI.updateTopbarOption(1, this.value)">
            ${buildOpts(t1)}
          </select>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:4px;">Másodlagos elem (2. sor — Következő ének)</div>
          <select class="line-input" id="topOptLine2" style="width:100%; font-size:15px; padding:6px 4px; background:transparent;" onchange="StageChartUI.updateTopbarOption(2, this.value)">
            ${buildOpts(t2)}
          </select>
        </div>

        <div style="margin-bottom:18px;">
          <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:4px;">Harmadlagos elem (3. sor — Óra / Idő)</div>
          <select class="line-input" id="topOptLine3" style="width:100%; font-size:15px; padding:6px 4px; background:transparent;" onchange="StageChartUI.updateTopbarOption(3, this.value)">
            ${buildOpts(t3)}
          </select>
        </div>

        <div style="display:flex; justify-content:flex-end;">
          <button class="btn-outline" style="border:none; color:var(--accent); font-weight:600; font-size:14px; padding:6px 12px;" onclick="StageChartUI.closeModal()">Bezárás</button>
        </div>
      </div>
    `;
    showModalHtml(html);
  }

  function updateTopbarOption(lineIndex, val) {
    settings['topbarLine' + lineIndex] = val;
    persistAll();
    refreshMainView(false);
  }

  function refreshMainView(broadcastToBand = true) {
    const song = getCurrentSong();
    if (!song) return;

    applyFormattingCssVariables();

    const fmt = settings.formatting;

    const titleEl = document.getElementById('sheetTitle');
    titleEl.textContent = song.title;
    titleEl.style.display = fmt.titleEnabled !== false ? 'block' : 'none';

    const subEl = document.getElementById('sheetSubtitle');
    subEl.textContent = song.altTitle || '';
    subEl.style.display = (fmt.showSubtitle && song.altTitle) ? 'block' : 'none';

    const artistEl = document.getElementById('sheetArtist');
    artistEl.textContent = song.artist || '';
    artistEl.style.display = fmt.showArtist !== false ? 'block' : 'none';

    // Hangnem, Kápó és Tempó kiszámítása
    const isMinor = (song.key || '').endsWith('m');
    const basePc = Theory.noteToPitchClass((song.key || 'D').replace('m', ''), settings.notation);
    const validBasePc = basePc !== -1 ? basePc : 2;
    const soundingPc = (validBasePc + runtime.transposeSemitones + 120) % 12;
    const capoPlayedPc = (soundingPc - runtime.capo + 120) % 12;

    const preferFlats = [5, 10, 3, 8, 1].includes(soundingPc);
    const soundingKeyName = Theory.pitchClassToNote(soundingPc, {
      notation: settings.notation,
      preferFlats,
      accidentalsOverride: settings.accidentalsOverride
    }) + (isMinor ? 'm' : '');

    const playedKeyName = Theory.pitchClassToNote(capoPlayedPc, {
      notation: settings.notation,
      preferFlats,
      accidentalsOverride: settings.accidentalsOverride
    }) + (isMinor ? 'm' : '');

    // Felső sáv (Topbar) 3 soros középső kijelzőjének frissítése (1: Cím, 2: Következő dal, 3: Óra)
    refreshTopbarCenterLines(song, soundingKeyName);

    let metaParts = [];
    if (fmt.showKey !== false) {
      let keyLine = `Hangnem: ${soundingKeyName}`;
      if (runtime.capo > 0) {
        keyLine += ` (${playedKeyName})<br>Kápó ${runtime.capo}`;
      }
      metaParts.push(keyLine);
    }
    if (fmt.showTempo && song.bpm) {
      metaParts.push(`${song.bpm} BPM`);
    }
    if (fmt.showTimeSig && song.timeSig) {
      metaParts.push(song.timeSig);
    }
    document.getElementById('sheetMetaRight').innerHTML = metaParts.join('<br>');

    // Ambient Pad gomb felirat és élő hangnem-követés (Crossfade)
    document.getElementById('padBtnLabel').textContent = `PAD: ${soundingKeyName}`;
    if (AudioEngine.isPadRunning()) {
      AudioEngine.crossfadePadToPitchClass(soundingPc, settings);
    }

    // Hangjegyzet (Quick Memo) lejátszó gomb láthatósága
    document.getElementById('btnPlayMemo').style.display = song.audioMemo ? 'inline-flex' : 'none';

    // Hangnemválasztó legördülők feltöltése
    populateKeySelectors(soundingKeyName, isMinor);

    // Kotta tartalom renderelése
    renderSongInto(song, document.getElementById('sheetBody'), document.getElementById('roadmapBar'), true);

    // Inline akkord diagramok sáv
    renderInlineChordDiagrams(song);

    // Automatikus többhasábos (1-2-3-4 hasáb) és egyoldalas betűméret-igazítás a teljes képernyőszélességen (SOHA nem csúszik egymásra!)
    fitSongColumnsAndFontToScreen(song);

    // Oldalsáv lista frissítése
    renderSidebarContent();

    // Szabadkézi rajz visszatöltése a dalhoz
    loadDrawingForCurrentSong();

    // Ha Karmester (Leader) módban vagyunk, szinkronizáljuk a zenekarral
    if (broadcastToBand && StageTools.getSyncRole() === 'leader') {
      StageTools.broadcastSyncEvent({
        type: 'SONG_STATE',
        songId: song.id,
        transposeSemitones: runtime.transposeSemitones,
        capo: runtime.capo
      });
    }
  }

  function populateKeySelectors(activeKeyName, isMinor) {
    const scale = settings.notation === 'hu' ? Theory.SCALE_HU_SHARP : Theory.SCALE_EN_SHARP;
    const quickSel = document.getElementById('quickKeySelect');
    const editSel = document.getElementById('editKey');
    if (!quickSel || !editSel) return;

    quickSel.innerHTML = '';
    editSel.innerHTML = '';

    scale.forEach((note, idx) => {
      const label = note + (isMinor ? 'm' : '');
      const opt1 = document.createElement('option');
      opt1.value = idx;
      opt1.textContent = label;
      if (label === activeKeyName) opt1.selected = true;
      quickSel.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = note;
      opt2.textContent = note;
      editSel.appendChild(opt2);

      const opt2m = document.createElement('option');
      opt2m.value = note + 'm';
      opt2m.textContent = note + 'm';
      editSel.appendChild(opt2m);
    });

    editSel.value = getCurrentSong().key || 'D';

    quickSel.onchange = (e) => {
      const song = getCurrentSong();
      const origPc = Theory.noteToPitchClass((song.key || 'D').replace('m', ''), settings.notation);
      const validOrig = origPc !== -1 ? origPc : 0;
      const targetPc = parseInt(e.target.value, 10);
      runtime.transposeSemitones = (targetPc - validOrig + 12) % 12;
      saveCurrentSongOverrideToActiveSetlist();
      refreshMainView();
    };
  }

  function renderInlineChordDiagrams(song) {
    const strip = document.getElementById('inlineDiagramsStrip');
    if (!settings.showChordDiagramsInline || song.pdfDataUrl) {
      strip.classList.remove('visible');
      return;
    }
    strip.classList.add('visible');
    strip.innerHTML = '';

    const basePc = Theory.noteToPitchClass((song.key || 'D').replace('m', ''), settings.notation);
    const chords = Theory.extractUniqueChords(song.content, runtime.transposeSemitones - runtime.capo, {
      notation: settings.notation,
      songRootPc: basePc !== -1 ? basePc : 0,
      accidentalsOverride: settings.accidentalsOverride
    });

    chords.forEach(ch => {
      if ((settings.knownChords || []).includes(ch)) return;
      const box = document.createElement('div');
      box.className = 'chord-box';
      box.innerHTML = `
        <div style="font-weight:700; color:var(--chord-color); margin-bottom:4px;">${ch}</div>
        ${Theory.generateChordDiagramSVG(ch, settings.instrument, settings.leftHandedChords)}
      `;
      box.onclick = () => showSingleChordPopup(ch);
      strip.appendChild(box);
    });
  }

  /********************************************************************
   * 3. ÉLŐ FORMÁZÁS CSS VÁLTOZÓK ÉS KÉTOSZLOPOS FORMÁZÓ NÉZET
   ********************************************************************/
  function applyFormattingCssVariables() {
    const root = document.documentElement;
    const fmt = settings.formatting;

    root.style.setProperty('--title-size', (fmt.titleSize || 38) + 'px');
    root.style.setProperty('--title-color', fmt.titleColor === 'default' ? 'inherit' : fmt.titleColor);
    root.style.setProperty('--meta-size', (fmt.metaSize || 22) + 'px');
    root.style.setProperty('--meta-color', fmt.metaColor === 'default' ? 'inherit' : fmt.metaColor);
    root.style.setProperty('--lyrics-size', (fmt.lyricsSize || 16) + 'px');
    root.style.setProperty('--lyrics-color', fmt.lyricsColor === 'default' ? 'inherit' : fmt.lyricsColor);
    root.style.setProperty('--heading-size', (fmt.headingSize || 19) + 'px');
    root.style.setProperty('--heading-color', fmt.headingColor === 'default' ? 'inherit' : fmt.headingColor);
    root.style.setProperty('--heading-bg', fmt.headingHighlight || 'transparent');
    root.style.setProperty('--chord-size', (fmt.chordSize || 16) + 'px');
    root.style.setProperty('--chord-color', fmt.chordColor || '#0b5bb5');
    root.style.setProperty('--chord-weight', fmt.chordBold ? '700' : '400');
    root.style.setProperty('--chord-style', fmt.chordItalic ? 'italic' : 'normal');
    root.style.setProperty('--chord-bg', fmt.chordHighlight || 'transparent');
    root.style.setProperty('--notes-color', fmt.notesColor || '#64748b');
    root.style.setProperty('--notes-weight', fmt.notesBold ? '700' : '400');
    root.style.setProperty('--notes-style', fmt.notesItalic ? 'italic' : 'normal');

    if (fmt.sheetBgColor && fmt.sheetBgColor !== 'default' && !settings.darkMode) {
      root.style.setProperty('--bg-sheet', fmt.sheetBgColor);
    } else {
      root.style.setProperty('--bg-sheet', settings.darkMode ? '#0b0e14' : '#ffffff');
    }

    const viewer = document.getElementById('mainViewer');
    if (viewer) {
      viewer.classList.toggle('multipage-columns', settings.pageLayout !== 'single');
      viewer.classList.toggle('overshoot-padding', !!settings.autoScrollOvershoot);
    }
    fitSongColumnsAndFontToScreen(getCurrentSong());
  }

  /**
   * SongbookPro-stílusú, garantáltan átfedésmentes (Flexbox alapú), középre/egyenletesen elosztott
   * többhasábos (1 / 2 / 3 / 4 hasáb) elrendezés + automatikus betűméret-igazítás:
   * - A szakaszokat (.song-section) kiegyensúlyozott .sheet-col Flexbox oszlopokba osztja el.
   * - Mivel valódi Flexbox oszlopokat használ (nem CSS column-count-ot), a hosszú sorok SOHA nem tudnak
   *   átlógni vagy rácsúszni a szomszédos oszlopra kisebb képernyőn sem!
   * - Ha 2 vagy 3 oszlop van, azok arányosan középre/egyenletesen (space-evenly) oszlanak el a képernyőn.
   * - Ellenőrzi a függőleges magasságot ÉS a vízszintes szélességet is!
   */
  function fitSongColumnsAndFontToScreen(song) {
    const viewer = document.getElementById('mainViewer');
    const sheetBody = document.getElementById('sheetBody');
    if (!viewer || !sheetBody || !song) return;

    const pdfSrc = mediaBlobUrls[song.id] || song.pdfDataUrl;
    const imgSrc = song.imageDataUrl;
    if ((pdfSrc || imgSrc) && (!song.content || !song.content.trim())) {
      sheetBody.classList.remove('flex-columns-mode', 'single-col-left');
      sheetBody.style.columnCount = '1';
      sheetBody.style.columnRule = 'none';
      return;
    }

    // Összegyűjtjük az összes .song-section elemet (akár közvetlenül a sheetBody-ban, akár korábbi .sheet-col-ban vannak)
    const rawSections = Array.from(sheetBody.querySelectorAll('.song-section'));
    if (rawSections.length === 0) return;

    // Ha csak 1 darab nagyon hosszú .song-section van (pl. szakasz-fejlécek nélküli ének), és több mint 10 sora van,
    // 6-8 soros logikai blokkokra bontjuk, hogy több hasábba is tördelhető legyen:
    let sections = rawSections;
    if (rawSections.length === 1 && rawSections[0].children.length > 10) {
      const children = Array.from(rawSections[0].children);
      const chunked = [];
      let currentBlock = document.createElement('div');
      currentBlock.className = 'song-section';
      children.forEach((ch, idx) => {
        currentBlock.appendChild(ch);
        if (currentBlock.children.length >= 7 && idx < children.length - 2) {
          chunked.push(currentBlock);
          currentBlock = document.createElement('div');
          currentBlock.className = 'song-section';
        }
      });
      if (currentBlock.children.length > 0) chunked.push(currentBlock);
      sections = chunked;
    }

    // Esetleges felső figyelmeztető sávok (pl. gitár tabulatúra figyelmeztetés) megőrzése
    const extraBanners = Array.from(sheetBody.children).filter(
      el => !el.classList.contains('song-section') && !el.classList.contains('sheet-col')
    );

    const fmt = settings.formatting;
    let baseLyricsSize = fmt.lyricsSize || 16;
    let baseChordSize = fmt.chordSize || 16;
    const root = document.documentElement;

    root.style.setProperty('--lyrics-size', baseLyricsSize + 'px');
    root.style.setProperty('--chord-size', baseChordSize + 'px');

    sheetBody.style.columnCount = 'unset';
    sheetBody.style.columnRule = 'none';
    sheetBody.classList.add('flex-columns-mode');

    function distributeSectionsIntoFlexCols(colCount) {
      sheetBody.innerHTML = '';
      extraBanners.forEach(b => sheetBody.appendChild(b));

      const actualCols = Math.max(1, Math.min(colCount, sections.length));
      sheetBody.classList.toggle('single-col-left', actualCols === 1);

      if (actualCols === 1) {
        const colEl = document.createElement('div');
        colEl.className = 'sheet-col';
        sections.forEach(sec => colEl.appendChild(sec));
        sheetBody.appendChild(colEl);
        return;
      }

      // Kiegyensúlyozott elosztás a szakaszok sorainak száma (súlya) alapján, sorrend megtartásával
      const weights = sections.map(sec => Math.max(2, sec.children.length + 1));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const targetPerCol = totalWeight / actualCols;

      const cols = [];
      for (let i = 0; i < actualCols; i++) {
        const colEl = document.createElement('div');
        colEl.className = 'sheet-col';
        cols.push(colEl);
      }

      let currentColIdx = 0;
      let currentColWeight = 0;

      sections.forEach((sec, idx) => {
        const w = weights[idx];
        const remainingSections = sections.length - idx;
        const remainingCols = actualCols - currentColIdx - 1;

        if (
          currentColIdx < actualCols - 1 &&
          cols[currentColIdx].children.length > 0 &&
          (currentColWeight + w * 0.55 > targetPerCol || remainingSections <= remainingCols)
        ) {
          currentColIdx++;
          currentColWeight = 0;
        }
        cols[currentColIdx].appendChild(sec);
        currentColWeight += w;
      });

      cols.filter(c => c.children.length > 0).forEach(c => sheetBody.appendChild(c));
    }

    if (settings.pageLayout === 'single') {
      distributeSectionsIntoFlexCols(1);
      return;
    }

    const availWidth = Math.max(300, viewer.clientWidth - 68);
    const bodyTop = sheetBody.offsetTop || 140;
    const availHeight = Math.max(240, viewer.clientHeight - bodyTop - 68);

    const maxPossibleCols = Math.max(1, Math.min(4, sections.length, Math.floor((availWidth + 32) / 260)));
    const minStartCols = settings.pageLayout === 'multipage' ? Math.min(2, maxPossibleCols) : 1;

    function findFittingColsForCurrentFont() {
      let bestWideFitCol = 1;
      for (let c = minStartCols; c <= maxPossibleCols; c++) {
        distributeSectionsIntoFlexCols(c);
        const fitsHoriz = sheetBody.scrollWidth <= availWidth + 4;
        const fitsVert = sheetBody.offsetHeight <= availHeight;
        if (fitsHoriz) {
          bestWideFitCol = c;
          if (fitsVert) {
            return true; // Vízszintesen ÉS függőlegesen is tökéletesen kifér!
          }
        } else {
          // Ha c hasáb már vízszintesen szélesebb, mint a képernyő, visszalépünk az utolsó vízszintesen elférő hasábszámra
          distributeSectionsIntoFlexCols(bestWideFitCol);
          return false;
        }
      }
      return false;
    }

    // 1. Megpróbáljuk a felhasználó által választott betűmérettel 1 -> 2 -> 3 -> 4 hasábba elosztani
    let fits = findFittingColsForCurrentFont();

    // 2. Ha a választott betűmérettel vagy túl magas, vagy vízszintesen túl széles a képernyőhöz képest,
    //    automatikusan csökkentjük a betűméretet, hogy SOHA ne csússzanak egymásra az oszlopok és kiférjen a képernyőn!
    const shouldAutoShrink = settings.pageLayout === 'auto' || settings.longLinesBehavior === 'shrink';
    if (!fits && shouldAutoShrink) {
      let curL = baseLyricsSize;
      let curC = baseChordSize;
      while (curL > 11 || curC > 11) {
        if (curL > 11) curL--;
        if (curC > 11) curC--;
        root.style.setProperty('--lyrics-size', curL + 'px');
        root.style.setProperty('--chord-size', curC + 'px');
        if (findFittingColsForCurrentFont()) {
          break;
        }
      }
    }
  }

  function openFormattingScreen(fromSettings = false) {
    closeAllDropdowns();
    runtime.formattingOpenedFromSettings = fromSettings;
    syncFormattingControlsWithState();
    renderSectionStyleCards();
    refreshFormattingSamplePreview();
    document.getElementById('screenFormatting').classList.add('open');
  }

  function closeFormattingScreen() {
    document.getElementById('screenFormatting').classList.remove('open');
    refreshMainView();
    // Ha a Beállítások -> Ének megjelenítése menüből nyitották meg, a Beállítások nyitva marad alatta!
  }

  function ensureSelectHasColorOption(selectEl, colorVal) {
    if (!selectEl || !colorVal) return;
    const exists = Array.from(selectEl.options).some(o => o.value.toLowerCase() === colorVal.toLowerCase());
    if (!exists && colorVal !== 'default' && colorVal !== 'transparent') {
      const opt = document.createElement('option');
      opt.value = colorVal;
      opt.textContent = `Egyéni (${colorVal})`;
      selectEl.appendChild(opt);
    }
    selectEl.value = colorVal;
  }

  function updateBgColorSquarePreview() {
    const sq = document.getElementById('fmtBgColorSquare');
    if (!sq) return;
    const val = settings.formatting.sheetBgColor;
    if (!val || val === 'default') {
      sq.style.background = settings.darkMode ? '#0b0e14' : '#ffffff';
    } else {
      sq.style.background = val;
    }
  }

  function syncFormattingControlsWithState() {
    const fmt = settings.formatting;
    document.getElementById('fmtTitleEnabled').checked = fmt.titleEnabled !== false;
    document.getElementById('fmtTitleSize').value = fmt.titleSize || 38;
    document.getElementById('lblFmtTitleSize').textContent = fmt.titleSize || 38;
    ensureSelectHasColorOption(document.getElementById('fmtTitleColor'), fmt.titleColor || 'default');

    document.getElementById('fmtMetaSize').value = fmt.metaSize || 22;
    document.getElementById('lblFmtMetaSize').textContent = fmt.metaSize || 22;
    ensureSelectHasColorOption(document.getElementById('fmtMetaColor'), fmt.metaColor || 'default');
    document.getElementById('fmtShowSubtitle').checked = !!fmt.showSubtitle;
    document.getElementById('fmtShowArtist').checked = fmt.showArtist !== false;
    document.getElementById('fmtShowKey').checked = fmt.showKey !== false;
    document.getElementById('fmtShowTempo').checked = fmt.showTempo !== false;
    document.getElementById('fmtShowTimeSig').checked = !!fmt.showTimeSig;
    const chkNextSong = document.getElementById('fmtShowNextSong');
    if (chkNextSong) chkNextSong.checked = fmt.showNextSong !== false;

    document.getElementById('fmtLyricsSize').value = fmt.lyricsSize || 16;
    document.getElementById('lblFmtLyricsSize').textContent = fmt.lyricsSize || 16;
    ensureSelectHasColorOption(document.getElementById('fmtLyricsColor'), fmt.lyricsColor || 'default');
    document.querySelectorAll('input[name="fmtLongLines"]').forEach(r => {
      r.checked = (r.value === settings.longLinesBehavior);
    });

    document.getElementById('fmtHeadingsEnabled').checked = fmt.headingsEnabled !== false;
    document.getElementById('fmtHeadingSize').value = fmt.headingSize || 19;
    document.getElementById('lblFmtHeadingSize').textContent = fmt.headingSize || 19;
    ensureSelectHasColorOption(document.getElementById('fmtHeadingColor'), fmt.headingColor || 'default');
    document.getElementById('fmtHeadingHighlight').value = fmt.headingHighlight || 'transparent';

    document.getElementById('fmtChordSize').value = fmt.chordSize || 16;
    document.getElementById('lblFmtChordSize').textContent = fmt.chordSize || 16;
    ensureSelectHasColorOption(document.getElementById('fmtChordColor'), fmt.chordColor || '#0b5bb5');
    document.getElementById('btnFmtChordBold').classList.toggle('active', !!fmt.chordBold);
    document.getElementById('btnFmtChordItalic').classList.toggle('active', !!fmt.chordItalic);
    document.getElementById('fmtChordHighlight').value = fmt.chordHighlight || 'transparent';

    ensureSelectHasColorOption(document.getElementById('fmtNotesColor'), fmt.notesColor || '#64748b');
    document.getElementById('btnFmtNotesBold').classList.toggle('active', !!fmt.notesBold);
    document.getElementById('btnFmtNotesItalic').classList.toggle('active', !!fmt.notesItalic);
    document.getElementById('fmtHideParens').checked = !!fmt.hideParensInChordLines;
    ensureSelectHasColorOption(document.getElementById('fmtSheetBgColor'), fmt.sheetBgColor || 'default');
    updateBgColorSquarePreview();
  }

  function renderSectionStyleCards() {
    const container = document.getElementById('sectionStylesContainer');
    container.innerHTML = '';
    const styles = settings.formatting.sectionStyles || [];

    styles.forEach((sec, idx) => {
      const card = document.createElement('div');
      card.className = 'section-style-card';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="font-size:15px;">${sec.name}</strong>
          <div style="display:flex; gap:6px;">
            <button class="icon-btn" style="width:28px;height:28px;" onclick="StageChartUI.renameSectionStyle(${idx})" title="Szakasz átnevezése">✎</button>
            <button class="icon-btn" style="width:28px;height:28px;" onclick="StageChartUI.deleteSectionStyle(${idx})" title="Szakasz stílus törlése">🗑</button>
          </div>
        </div>
        <div class="quick-row">
          <span> Szín:</span>
          <select class="select-clean" onchange="StageChartUI.updateSectionStyleProp(${idx}, 'color', this.value)">
            <option value="default" ${sec.color === 'default' ? 'selected' : ''}>Alapértelmezett</option>
            <option value="#0f6fd6" ${sec.color === '#0f6fd6' ? 'selected' : ''}>Kék</option>
            <option value="#059669" ${sec.color === '#059669' ? 'selected' : ''}>Zöld</option>
            <option value="#d97706" ${sec.color === '#d97706' ? 'selected' : ''}>Borostyán</option>
          </select>
          <div style="display:flex; gap:6px;">
            <button class="style-toggle-btn ${sec.bold ? 'active' : ''}" onclick="StageChartUI.updateSectionStyleProp(${idx}, 'bold', !${!!sec.bold})">B</button>
            <button class="style-toggle-btn ${sec.italic ? 'active' : ''}" onclick="StageChartUI.updateSectionStyleProp(${idx}, 'italic', !${!!sec.italic})">I</button>
            <button class="style-toggle-btn ${sec.indent ? 'active' : ''}" onclick="StageChartUI.updateSectionStyleProp(${idx}, 'indent', !${!!sec.indent})" title="Behúzás">⇥</button>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  }

  function updateSectionStyleProp(idx, prop, val) {
    const list = settings.formatting.sectionStyles;
    if (!list[idx]) return;
    list[idx][prop] = val;
    persistAll();
    renderSectionStyleCards();
    refreshFormattingSamplePreview();
  }

  function renameSectionStyle(idx) {
    const list = settings.formatting.sectionStyles;
    if (!list[idx]) return;
    const newName = prompt('Szakasz neve (pl. Verse, Chorus, Bridge, Refrén):', list[idx].name);
    if (newName && newName.trim()) {
      list[idx].name = newName.trim();
      persistAll();
      renderSectionStyleCards();
      refreshFormattingSamplePreview();
    }
  }

  function deleteSectionStyle(idx) {
    settings.formatting.sectionStyles.splice(idx, 1);
    persistAll();
    renderSectionStyleCards();
    refreshFormattingSamplePreview();
  }

  function addCustomSectionStyle() {
    const name = prompt('Új szakasz típus neve (pl. Pre-Chorus, Refrén, Outro):', 'Refrén');
    if (!name || !name.trim()) return;
    settings.formatting.sectionStyles.push({
      id: 'sec_' + Date.now(),
      name: name.trim(),
      font: 'Alapértelmezett',
      color: 'default',
      bold: false,
      italic: false,
      indent: true
    });
    persistAll();
    renderSectionStyleCards();
    refreshFormattingSamplePreview();
  }

  function toggleFormatFlag(flagName) {
    settings.formatting[flagName] = !settings.formatting[flagName];
    syncFormattingControlsWithState();
    updateFormattingFromUI();
  }

  function updateFormattingFromUI() {
    const fmt = settings.formatting;
    fmt.titleEnabled = document.getElementById('fmtTitleEnabled').checked;
    fmt.titleSize = parseInt(document.getElementById('fmtTitleSize').value, 10);
    document.getElementById('lblFmtTitleSize').textContent = fmt.titleSize;
    fmt.titleColor = document.getElementById('fmtTitleColor').value;

    fmt.metaSize = parseInt(document.getElementById('fmtMetaSize').value, 10);
    document.getElementById('lblFmtMetaSize').textContent = fmt.metaSize;
    fmt.metaColor = document.getElementById('fmtMetaColor').value;
    fmt.showSubtitle = document.getElementById('fmtShowSubtitle').checked;
    fmt.showArtist = document.getElementById('fmtShowArtist').checked;
    fmt.showKey = document.getElementById('fmtShowKey').checked;
    fmt.showTempo = document.getElementById('fmtShowTempo').checked;
    fmt.showTimeSig = document.getElementById('fmtShowTimeSig').checked;
    const chkNextSong = document.getElementById('fmtShowNextSong');
    if (chkNextSong) fmt.showNextSong = chkNextSong.checked;

    fmt.lyricsSize = parseInt(document.getElementById('fmtLyricsSize').value, 10);
    document.getElementById('lblFmtLyricsSize').textContent = fmt.lyricsSize;
    fmt.lyricsColor = document.getElementById('fmtLyricsColor').value;
    const selectedLongLine = document.querySelector('input[name="fmtLongLines"]:checked');
    if (selectedLongLine) {
      settings.longLinesBehavior = selectedLongLine.value;
      document.getElementById('setLongLines').value = selectedLongLine.value;
    }

    fmt.headingsEnabled = document.getElementById('fmtHeadingsEnabled').checked;
    fmt.headingSize = parseInt(document.getElementById('fmtHeadingSize').value, 10);
    document.getElementById('lblFmtHeadingSize').textContent = fmt.headingSize;
    fmt.headingColor = document.getElementById('fmtHeadingColor').value;
    fmt.headingHighlight = document.getElementById('fmtHeadingHighlight').value;

    fmt.chordSize = parseInt(document.getElementById('fmtChordSize').value, 10);
    document.getElementById('lblFmtChordSize').textContent = fmt.chordSize;
    fmt.chordColor = document.getElementById('fmtChordColor').value;
    fmt.chordHighlight = document.getElementById('fmtChordHighlight').value;

    fmt.notesColor = document.getElementById('fmtNotesColor').value;
    fmt.hideParensInChordLines = document.getElementById('fmtHideParens').checked;
    const bgVal = document.getElementById('fmtSheetBgColor').value;
    if (bgVal === 'custom') {
      openColorPickerModal('sheetBgColor');
      return;
    }
    fmt.sheetBgColor = bgVal;

    updateBgColorSquarePreview();
    persistAll();
    applyFormattingCssVariables();
    refreshFormattingSamplePreview();
  }

  /**
   * Vizuális RGB / HSB Színválasztó Modal (8. kép alapján: 2D telítettség/fényerő mező + Szivárvány Hue sáv + Piros/Zöld/Kék 0-255 mezők)
   */
  let colorPickerState = { targetProp: 'sheetBgColor', h: 210, s: 15, v: 98, r: 245, g: 248, b: 250 };

  function hexToRgbObj(hex) {
    if (!hex || hex === 'default' || !hex.startsWith('#')) return { r: 255, g: 255, b: 255 };
    let c = hex.slice(1);
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    if (isNaN(num)) return { r: 255, g: 255, b: 255 };
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgbToHexStr(r, g, b) {
    const toH = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${toH(r)}${toH(g)}${toH(b)}`;
  }

  function rgbToHsvObj(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (max !== min) {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
  }

  function hsvToRgbObj(h, s, v) {
    h = (h % 360) / 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    v = Math.max(0, Math.min(100, v)) / 100;
    let r = 0, g = 0, b = 0;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  function openColorPickerModal(targetProp = 'sheetBgColor') {
    const currentHex = settings.formatting[targetProp] || '#ffffff';
    const rgb = hexToRgbObj(currentHex);
    const hsv = rgbToHsvObj(rgb.r, rgb.g, rgb.b);
    colorPickerState = {
      targetProp,
      initialHex: currentHex,
      h: hsv.h,
      s: hsv.s,
      v: hsv.v,
      r: rgb.r,
      g: rgb.g,
      b: rgb.b
    };

    const html = `
      <div style="max-width:440px; margin:0 auto;">
        <div class="color-picker-sv" id="cpSvBox" style="background: hsl(${hsv.h}, 100%, 50%);">
          <div class="sv-white"></div>
          <div class="sv-black"></div>
          <div class="sv-cursor" id="cpSvCursor" style="left:${hsv.s}%; top:${100 - hsv.v}%;"></div>
        </div>

        <input type="range" class="hue-slider" id="cpHueSlider" min="0" max="360" value="${hsv.h}" style="margin:16px 0;">

        <div class="rgb-inputs-row">
          <div class="rgb-field">
            <label>Piros</label>
            <input type="number" id="cpInputR" min="0" max="255" value="${rgb.r}" oninput="StageChartUI.onColorPickerRgbInput()">
          </div>
          <div class="rgb-field">
            <label>Zöld</label>
            <input type="number" id="cpInputG" min="0" max="255" value="${rgb.g}" oninput="StageChartUI.onColorPickerRgbInput()">
          </div>
          <div class="rgb-field">
            <label>Kék</label>
            <input type="number" id="cpInputB" min="0" max="255" value="${rgb.b}" oninput="StageChartUI.onColorPickerRgbInput()">
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:18px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div id="cpPreviewSwatch" style="width:42px; height:32px; border-radius:6px; border:1px solid var(--border); background:${rgbToHexStr(rgb.r, rgb.g, rgb.b)};"></div>
            <span id="cpHexLabel" style="font-family:var(--font-mono); font-size:13px; color:var(--text-muted);">${rgbToHexStr(rgb.r, rgb.g, rgb.b)}</span>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn-outline" onclick="StageChartUI.cancelColorPickerModal()">Mégsem</button>
            <button class="btn-primary" onclick="StageChartUI.confirmColorPickerModal()">Rendben</button>
          </div>
        </div>
      </div>
    `;

    showModalHtml(html);

    const svBox = document.getElementById('cpSvBox');
    const hueSlider = document.getElementById('cpHueSlider');

    function handleSvPointer(e) {
      const rect = svBox.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      colorPickerState.s = Math.round((x / rect.width) * 100);
      colorPickerState.v = Math.round(100 - (y / rect.height) * 100);
      const newRgb = hsvToRgbObj(colorPickerState.h, colorPickerState.s, colorPickerState.v);
      colorPickerState.r = newRgb.r;
      colorPickerState.g = newRgb.g;
      colorPickerState.b = newRgb.b;
      refreshColorPickerModalUI();
    }

    let draggingSv = false;
    svBox.addEventListener('pointerdown', (e) => { draggingSv = true; handleSvPointer(e); });
    window.addEventListener('pointermove', (e) => { if (draggingSv) handleSvPointer(e); });
    window.addEventListener('pointerup', () => { draggingSv = false; });

    hueSlider.addEventListener('input', (e) => {
      colorPickerState.h = parseInt(e.target.value, 10) || 0;
      const newRgb = hsvToRgbObj(colorPickerState.h, colorPickerState.s, colorPickerState.v);
      colorPickerState.r = newRgb.r;
      colorPickerState.g = newRgb.g;
      colorPickerState.b = newRgb.b;
      refreshColorPickerModalUI();
    });
  }

  function onColorPickerRgbInput() {
    const r = Math.max(0, Math.min(255, parseInt(document.getElementById('cpInputR').value, 10) || 0));
    const g = Math.max(0, Math.min(255, parseInt(document.getElementById('cpInputG').value, 10) || 0));
    const b = Math.max(0, Math.min(255, parseInt(document.getElementById('cpInputB').value, 10) || 0));
    const hsv = rgbToHsvObj(r, g, b);
    colorPickerState.r = r;
    colorPickerState.g = g;
    colorPickerState.b = b;
    colorPickerState.h = hsv.h;
    colorPickerState.s = hsv.s;
    colorPickerState.v = hsv.v;
    refreshColorPickerModalUI(false);
  }

  function refreshColorPickerModalUI(updateRgbInputs = true) {
    const svBox = document.getElementById('cpSvBox');
    const cursor = document.getElementById('cpSvCursor');
    const swatch = document.getElementById('cpPreviewSwatch');
    const hexLbl = document.getElementById('cpHexLabel');
    const hueSlider = document.getElementById('cpHueSlider');
    if (!svBox || !cursor) return;

    svBox.style.background = `hsl(${colorPickerState.h}, 100%, 50%)`;
    cursor.style.left = `${colorPickerState.s}%`;
    cursor.style.top = `${100 - colorPickerState.v}%`;
    if (hueSlider) hueSlider.value = colorPickerState.h;

    if (updateRgbInputs) {
      document.getElementById('cpInputR').value = colorPickerState.r;
      document.getElementById('cpInputG').value = colorPickerState.g;
      document.getElementById('cpInputB').value = colorPickerState.b;
    }

    const hex = rgbToHexStr(colorPickerState.r, colorPickerState.g, colorPickerState.b);
    if (swatch) swatch.style.background = hex;
    if (hexLbl) hexLbl.textContent = hex;

    // Élő frissítés a gyorsnézetben (már húzás közben is azonnal látszik a kottalapon!)
    settings.formatting[colorPickerState.targetProp] = hex;
    applyFormattingCssVariables();
    updateBgColorSquarePreview();
    refreshFormattingSamplePreview();
  }

  function cancelColorPickerModal() {
    if (colorPickerState.initialHex !== undefined) {
      settings.formatting[colorPickerState.targetProp] = colorPickerState.initialHex;
      syncFormattingControlsWithState();
      applyFormattingCssVariables();
      refreshFormattingSamplePreview();
    }
    closeModal();
  }

  function confirmColorPickerModal() {
    const hex = rgbToHexStr(colorPickerState.r, colorPickerState.g, colorPickerState.b);
    const prop = colorPickerState.targetProp;
    settings.formatting[prop] = hex;
    persistAll();
    syncFormattingControlsWithState();
    applyFormattingCssVariables();
    refreshFormattingSamplePreview();
    closeModal();
  }

  function refreshFormattingSamplePreview() {
    const sample = songs.find(s => s.id === 3) || songs[0];
    const fmt = settings.formatting;
    document.getElementById('fmtSampleTitle').style.display = fmt.titleEnabled ? 'block' : 'none';
    document.getElementById('fmtSampleSubtitle').style.display = fmt.showSubtitle ? 'block' : 'none';
    document.getElementById('fmtSampleArtist').style.display = fmt.showArtist ? 'block' : 'none';

    let m = [];
    if (fmt.showKey) m.push('Hangnem: G (F)<br>Kápó 2');
    if (fmt.showTempo) m.push('90 BPM');
    if (fmt.showTimeSig) m.push('4/4');
    document.getElementById('fmtSampleMeta').innerHTML = m.join('<br>');

    renderSongInto(sample, document.getElementById('fmtSampleBody'), null, false);
  }

  function resetFormattingDefaults() {
    settings.formatting = JSON.parse(JSON.stringify(window.STAGECHART_DEFAULT_SETTINGS.formatting));
    persistAll();
    syncFormattingControlsWithState();
    renderSectionStyleCards();
    applyFormattingCssVariables();
    refreshFormattingSamplePreview();
  }

  /********************************************************************
   * 4. MÓDOSÍTÓJELEK ALOLDAL (5 FÉLHANGPÁR EGYÉNI FELÜLBÍRÁLÁSA)
   ********************************************************************/
  function openAccidentalsScreen() {
    const ov = settings.accidentalsOverride || {};
    ['A#', 'C#', 'D#', 'F#', 'G#'].forEach(pair => {
      const sel = document.getElementById('accPair_' + pair);
      if (sel) sel.value = ov[pair] || 'auto';
    });
    document.getElementById('screenAccidentals').classList.add('open');
  }

  function closeAccidentalsScreen() {
    document.getElementById('screenAccidentals').classList.remove('open');
    refreshMainView();
  }

  function saveAccidentalOverride(pairKey, val) {
    if (!settings.accidentalsOverride) settings.accidentalsOverride = {};
    settings.accidentalsOverride[pairKey] = val;
    persistAll();
    refreshMainView();
  }

  /********************************************************************
   * 5. DALTÁR (SIDEBAR), RENDEZÉS, CSOPORTOS KIJELÖLÉS ÉS SETLISTÁK
   ********************************************************************/
  const HU_MONTHS_LONG = [
    'január', 'február', 'március', 'április', 'május', 'június',
    'július', 'augusztus', 'szeptember', 'október', 'november', 'december'
  ];
  const HU_MONTHS_SHORT = [
    'jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.',
    'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'
  ];

  function formatSetlistDateShort(isoDate) {
    const d = isoDate ? new Date(isoDate) : new Date();
    if (isNaN(d.getTime())) return isoDate || '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}. ${m}. ${day}.`;
  }

  function formatSetlistDateModalLabel(isoDate) {
    const d = isoDate ? new Date(isoDate) : new Date();
    if (isNaN(d.getTime())) return isoDate || '';
    return `${d.getFullYear()}. ${HU_MONTHS_SHORT[d.getMonth()]} ${d.getDate()}.`;
  }

  function formatSetlistMonthGroupHeader(isoDate) {
    const d = isoDate ? new Date(isoDate) : new Date();
    if (isNaN(d.getTime())) return 'Listák';
    return `${d.getFullYear()}. ${HU_MONTHS_LONG[d.getMonth()]}`;
  }

  function sortSongsArray(arr, mode) {
    return [...arr].sort((a, b) => {
      if (mode === 'artist') {
        const cmp = (a.artist || '').localeCompare(b.artist || '', 'hu');
        return cmp !== 0 ? cmp : (a.title || '').localeCompare(b.title || '', 'hu');
      }
      if (mode === 'key') {
        // Hangnem szerint, és azon belül ABC sorrendben!
        const cmpKey = (a.key || '').localeCompare(b.key || '', 'hu');
        return cmpKey !== 0 ? cmpKey : (a.title || '').localeCompare(b.title || '', 'hu');
      }
      if (mode === 'recent') {
        return (Number(b.id) || 0) - (Number(a.id) || 0);
      }
      if (mode === 'number') {
        return (a.number || '').localeCompare(b.number || '', 'hu', { numeric: true });
      }
      return (a.title || '').localeCompare(b.title || '', 'hu');
    });
  }

  function getSongGroupLabel(song, mode) {
    if (mode === 'key') return `Hangnem: ${song.key || 'D'}`;
    if (mode === 'recent') return 'Legutóbb hozzáadott';
    if (mode === 'number') return 'Sorszám szerint';
    const str = mode === 'artist' ? (song.artist || '#') : (song.title || '#');
    return str.charAt(0).toUpperCase();
  }

  function closeSidebarPopups() {
    document.querySelectorAll('.sidebar-popup-menu').forEach(m => m.classList.remove('open'));
  }

  function switchSidebarTab(tab) {
    closeSidebarPopups();
    runtime.sidebarTab = tab;
    if (tab === 'songs') {
      runtime.viewingSetlistId = null;
    } else if (tab === 'setlists') {
      runtime.multiSelectMode = false;
      runtime.selectedSongIds = [];
    }
    const btnSongs = document.getElementById('btnMenuSongs');
    const btnLists = document.getElementById('btnMenuSetlists');
    if (btnSongs) btnSongs.classList.toggle('active', tab === 'songs');
    if (btnLists) btnLists.classList.toggle('active', tab === 'setlists');

    const tabSongs = document.getElementById('sideTabSongs');
    const tabLists = document.getElementById('sideTabSetlists');
    if (tabSongs) tabSongs.classList.toggle('active', tab === 'songs');
    if (tabLists) tabLists.classList.toggle('active', tab === 'setlists');
    renderSidebarContent();
  }

  function handleSidebarBackBtn() {
    closeSidebarPopups();
    // Ha egy konkrét setlistán belül vagyunk, a bal felső <- nyíl visszalép az "Összes lista" nézetre
    if (runtime.sidebarTab === 'setlists' && runtime.viewingSetlistId) {
      runtime.viewingSetlistId = null;
      renderSidebarContent();
      return;
    }
    toggleSidebar(false);
  }

  function setSortMode(mode) {
    runtime.sortMode = mode;
    const sel = document.getElementById('sidebarSortSelect');
    if (sel) sel.value = mode;
    renderSidebarContent();
  }

  function cycleSortMode() {
    const modes = ['title', 'artist', 'key', 'recent', 'number'];
    const nextIdx = (modes.indexOf(runtime.sortMode) + 1) % modes.length;
    setSortMode(modes[nextIdx]);
  }

  function renderSidebarContent() {
    const container = document.getElementById('songListContainer');
    const query = (document.getElementById('songSearchInput').value || '').toLowerCase().trim();
    container.innerHTML = '';

    const normalHeaderActs = document.getElementById('sidebarHeaderNormalActions');
    const setlistHeaderActs = document.getElementById('sidebarHeaderSetlistActions');
    const searchBox = document.getElementById('sidebarSearchBox');
    const sortRow = document.getElementById('sidebarSortRow');
    const bottomBar = document.getElementById('sidebarBottomActionBar');
    const multiIcons = document.getElementById('multiSelectActionIcons');
    const btnMultiMenu = document.getElementById('btnMultiSelectMenu');

    if (runtime.sidebarTab === 'setlists') {
      if (multiIcons) multiIcons.style.display = 'none';
      if (btnMultiMenu) btnMultiMenu.style.display = 'none';

      // Ha egy konkrét setlistába léptünk bele (4. és 6. kép alapján)
      const activeList = runtime.viewingSetlistId
        ? setlists.find(l => l.id === runtime.viewingSetlistId)
        : null;

      if (activeList) {
        // Csatolt kép alapján: Setlista nézetben a felső sávban nincs szöveges cím, csak a <- nyíl balra és a 4 ikon jobbra,
        // a lista címe és dátuma pedig középre igazítva jelenik meg alatta!
        document.getElementById('sidebarTitle').textContent = '';
        if (normalHeaderActs) normalHeaderActs.style.display = 'none';
        if (setlistHeaderActs) setlistHeaderActs.style.display = 'flex';
        if (searchBox) searchBox.style.display = 'none';
        if (bottomBar) bottomBar.style.display = 'none';
        renderSingleSetlistDetailView(container, activeList);
      } else {
        document.getElementById('sidebarTitle').textContent = 'Összes lista';
        if (normalHeaderActs) normalHeaderActs.style.display = 'flex';
        if (setlistHeaderActs) setlistHeaderActs.style.display = 'none';
        if (searchBox) searchBox.style.display = 'block';
        if (sortRow) sortRow.style.display = 'none';
        if (bottomBar) bottomBar.style.display = 'flex';
        document.getElementById('btnSidebarPrimaryAdd').textContent = 'Hozzáadás...';
        renderAllSetlistsView(container, query);
      }
      return;
    }

    // "Összes ének" nézet (9. kép alapján)
    document.getElementById('sidebarTitle').textContent = 'Összes ének';
    if (normalHeaderActs) normalHeaderActs.style.display = 'flex';
    if (setlistHeaderActs) setlistHeaderActs.style.display = 'none';
    if (searchBox) searchBox.style.display = 'block';
    if (sortRow) sortRow.style.display = 'flex';
    if (bottomBar) bottomBar.style.display = 'flex';
    if (btnMultiMenu) btnMultiMenu.style.display = 'inline-flex';
    if (multiIcons) multiIcons.style.display = runtime.multiSelectMode ? 'flex' : 'none';
    document.getElementById('btnSidebarPrimaryAdd').textContent = 'Hozzáadás...';

    const filtered = sortSongsArray(
      songs.filter(s =>
        (s.title || '').toLowerCase().includes(query) ||
        (s.artist || '').toLowerCase().includes(query) ||
        (s.content || '').toLowerCase().includes(query) ||
        (s.tags || []).join(' ').toLowerCase().includes(query)
      ),
      runtime.sortMode
    );

    document.getElementById('songCountLabel').textContent = `${filtered.length} ének`;

    let currentGroup = '';
    filtered.forEach((song, idx) => {
      const groupLabel = getSongGroupLabel(song, runtime.sortMode);
      if (groupLabel !== currentGroup) {
        currentGroup = groupLabel;
        const grp = document.createElement('div');
        grp.className = 'alpha-group';
        grp.textContent = currentGroup;
        container.appendChild(grp);
      }

      const item = document.createElement('div');
      const isSelected = runtime.selectedSongIds.includes(song.id);
      item.className = 'song-item' + (song.id === runtime.currentSongId && !runtime.multiSelectMode ? ' active' : '');
      const numBadgeHtml = settings.numberSongsInLists
        ? `<span class="sbp-row-num">${idx + 1}</span>`
        : '';

      const checkboxHtml = runtime.multiSelectMode
        ? `<input type="checkbox" ${isSelected ? 'checked' : ''} style="width:17px; height:17px; accent-color:var(--accent); cursor:pointer; flex-shrink:0;" onclick="event.stopPropagation(); StageChartUI.toggleSongMultiSelect(${song.id})">`
        : '';

      const cleanArtist = (song.artist && song.artist !== 'PDF Dokumentum' && song.artist !== 'Fotózott kotta')
        ? song.artist
        : '';
      const subMeta = [cleanArtist, song.bpm ? `${song.bpm} BPM` : ''].filter(Boolean).join(' • ');

      item.innerHTML = `
        ${checkboxHtml}
        ${numBadgeHtml}
        <div class="sbp-row-body">
          <div class="sbp-row-title">${song.title}</div>
          <div class="sbp-row-meta">
            <span class="sbp-row-sub">${subMeta}</span>
            <span class="sbp-row-key">${song.key || 'D'}</span>
          </div>
        </div>
      `;
      item.onclick = () => {
        if (runtime.multiSelectMode) {
          toggleSongMultiSelect(song.id);
        } else {
          runtime.activeSetlistId = null;
          selectSongById(song.id);
        }
      };
      container.appendChild(item);
    });
  }

  /**
   * "Összes lista" nézet: Év és hónap szerint csoportosítva (pl. "2026. október"), alatta Cím és dátum
   */
  function renderAllSetlistsView(container, query) {
    const filtered = [...setlists]
      .filter(l => !query || (l.name || '').toLowerCase().includes(query))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    let currentMonthGroup = '';
    filtered.forEach(list => {
      const monthHeader = formatSetlistMonthGroupHeader(list.date);
      if (monthHeader !== currentMonthGroup) {
        currentMonthGroup = monthHeader;
        const grp = document.createElement('div');
        grp.className = 'alpha-group';
        grp.style.cssText = 'color:var(--accent); font-size:13px; padding:10px 14px 4px;';
        grp.textContent = currentMonthGroup;
        container.appendChild(grp);
      }

      const item = document.createElement('div');
      item.className = 'song-item' + (runtime.activeSetlistId === list.id ? ' active' : '');
      item.innerHTML = `
        <div>
          <div class="song-item-title" style="font-size:15px;">${list.name}</div>
          <div class="song-item-artist">${formatSetlistDateShort(list.date)} • ${(list.songIds || []).length} ének</div>
        </div>
        <button class="icon-btn" style="width:28px;height:28px;" onclick="event.stopPropagation(); StageChartUI.deleteSetlist('${list.id}')" title="Lista törlése">🗑</button>
      `;
      item.onclick = () => {
        runtime.viewingSetlistId = list.id;
        runtime.activeSetlistId = list.id;
        renderSidebarContent();
      };
      container.appendChild(item);
    });
  }

  /**
   * Konkrét Setlista részletező nézete az oldalsávban (5. és 6. kép alapján:
   * Középre igazított Cím + Dátum fejléc, szabadon húzható "=" sorok, és oldalra húzásra megjelenő piros "Törlés" gomb!)
   */
  let dragSortState = { fromIdx: null, listRef: null };

  function renderSingleSetlistDetailView(container, list) {
    // Felső középre igazított Cím + Dátum blokk (csatolt kép alapján)
    const headerBox = document.createElement('div');
    headerBox.className = 'setlist-detail-header-box';
    headerBox.innerHTML = `
      <h2>${list.name}</h2>
      <div class="setlist-sub-date">${formatSetlistDateShort(list.date)}</div>
    `;
    container.appendChild(headerBox);

    const listSongs = (list.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean);

    if (listSongs.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.cssText = 'padding:32px 16px; text-align:center; color:var(--text-muted); font-size:13.5px;';
      emptyDiv.innerHTML = `
        Ez a lista még üres.<br><br>
        <button class="btn-primary" onclick="StageChartUI.openSetlistSongPickerModal()">+ Énekek hozzáadása</button>
      `;
      container.appendChild(emptyDiv);
      return;
    }

    const frameBox = document.createElement('div');
    frameBox.className = 'setlist-songs-frame';
    container.appendChild(frameBox);

    listSongs.forEach((s, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'setlist-swipe-wrapper';
      wrapper.dataset.idx = idx;

      // Bal oldali piros "Törlés" gomb (oldalra húzáskor jelenik meg)
      const delBtn = document.createElement('button');
      delBtn.className = 'setlist-swipe-delete-btn';
      delBtn.innerHTML = `
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        <span>Törlés</span>
      `;
      delBtn.onclick = (e) => {
        e.stopPropagation();
        removeSongAtIndexFromActiveSetlist(idx);
      };

      const effKey = getEffectiveSongKeyInSetlist(s, list);
      const ov = list.songOverrides ? list.songOverrides[String(s.id)] : null;
      const capoBadge = ov && ov.capo > 0 ? ` • Kápó ${ov.capo}` : '';
      const cleanArtist = (s.artist && s.artist !== 'PDF Dokumentum' && s.artist !== 'Fotózott kotta')
        ? s.artist
        : '';

      const content = document.createElement('div');
      content.className = 'setlist-swipe-content' + (s.id === runtime.currentSongId ? ' active' : '');
      content.innerHTML = `
        <span class="sbp-row-num">${idx + 1}</span>
        <div class="sbp-row-body">
          <div class="sbp-row-title">${s.title}</div>
          <div class="sbp-row-meta">
            <span class="sbp-row-sub">${cleanArtist}</span>
            <span class="sbp-row-key">${effKey}${capoBadge}</span>
          </div>
        </div>
        <div class="drag-handle-eq" title="Tartsd lenyomva és húzd fel/le a sorrend módosításához">
          <span></span><span></span>
        </div>
      `;

      // Oldalra húzás (Swipe) a piros "Törlés" gomb megjelenítéséhez (egérrel és érintőképernyőn is!)
      let startX = 0;
      let startY = 0;
      let swiping = false;
      let movedHoriz = false;

      content.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.drag-handle-eq')) return;
        startX = e.clientX;
        startY = e.clientY;
        swiping = true;
        movedHoriz = false;
      });

      content.addEventListener('pointermove', (e) => {
        if (!swiping) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy)*1.5) {
          movedHoriz = true;
          if (dx > 40) {
            // Más nyitott sorok bezárása
            frameBox.querySelectorAll('.setlist-swipe-wrapper.swiped-open').forEach(w => {
              if (w !== wrapper) w.classList.remove('swiped-open');
            });
            wrapper.classList.add('swiped-open');
          } else if (dx < -30) {
            wrapper.classList.remove('swiped-open');
          }
        }
      });

      window.addEventListener('pointerup', () => {
        swiping = false;
      });

      content.onclick = (e) => {
        if (movedHoriz) {
          movedHoriz = false;
          return;
        }
        const anyOpen = frameBox.querySelector('.setlist-swipe-wrapper.swiped-open');
        if (anyOpen) {
          anyOpen.classList.remove('swiped-open');
          return;
        }
       runtime.activeSetlistId = list.id;
    runtime.currentSetlistIndex = idx; // <--- Ezt a sort add hozzá ide
    selectSongById(s.id);
      };

      // Szabadon húzható (Drag & Drop) átrendezés a "=" fogantyúval (egérrel és érintőképernyőn is!)
      const handle = content.querySelector('.drag-handle-eq');
      attachFreeDragReorder(handle, wrapper, frameBox, list.songIds, idx, () => {
        persistAll();
        renderSidebarContent();
      });

      wrapper.appendChild(delBtn);
      wrapper.appendChild(content);
      frameBox.appendChild(wrapper);
    });
  }

  /**
   * Univerzális (PC egér + Android/iOS érintőképernyő) szabadon húzható lista-átrendező
   */
  function attachFreeDragReorder(handleEl, rowEl, containerEl, arrayRef, itemIdx, onComplete) {
    if (!handleEl) return;
    handleEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      rowEl.classList.add('dragging-sort');
      const startY = e.clientY;
      let currentTargetIdx = itemIdx;

      const onMove = (moveEv) => {
        const dy = moveEv.clientY - startY;
        rowEl.style.transform = `translateY(${dy}px)`;
        rowEl.style.zIndex = '30';

        const siblings = Array.from(containerEl.querySelectorAll('[data-idx]'));
        for (const sib of siblings) {
          if (sib === rowEl) continue;
          const rect = sib.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const sibIdx = parseInt(sib.dataset.idx, 10);
          if (moveEv.clientY > rect.top && moveEv.clientY < rect.bottom) {
            currentTargetIdx = sibIdx;
            sib.style.borderTop = sibIdx < itemIdx ? '2.5px solid var(--accent)' : '';
            sib.style.borderBottom = sibIdx > itemIdx ? '2.5px solid var(--accent)' : '';
          } else {
            sib.style.borderTop = '';
            sib.style.borderBottom = '';
          }
        }
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        rowEl.classList.remove('dragging-sort');
        rowEl.style.transform = '';
        rowEl.style.zIndex = '';

        if (currentTargetIdx !== itemIdx && currentTargetIdx >= 0 && currentTargetIdx < arrayRef.length) {
          const [moved] = arrayRef.splice(itemIdx, 1);
          arrayRef.splice(currentTargetIdx, 0, moved);
          onComplete();
        } else {
          onComplete();
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  function removeSongAtIndexFromActiveSetlist(idx) {
    const list = setlists.find(l => l.id === runtime.viewingSetlistId);
    if (!list || !list.songIds) return;
    list.songIds.splice(idx, 1);
    persistAll();
    renderSidebarContent();
  }

  function moveSongInActiveSetlist(index, delta) {
    const list = setlists.find(l => l.id === runtime.viewingSetlistId);
    if (!list) return;
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= list.songIds.length) return;
    const temp = list.songIds[index];
    list.songIds[index] = list.songIds[targetIdx];
    list.songIds[targetIdx] = temp;
    persistAll();
    renderSidebarContent();
  }

  /**
   * 2. KÉP ALAPJÁN: Új Lista Létrehozása / Szerkesztése Modal (Cím + automatikus mai dátum + szerkesztő ceruza)
   */
  function openNewSetlistModal(editExisting = false) {
    closeSidebarPopups();
    const existing = editExisting ? setlists.find(l => l.id === runtime.viewingSetlistId) : null;
    const defaultDate = existing ? (existing.date || new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10);
    const defaultName = existing ? existing.name : '';

    const html = `
      <div style="max-width:420px; margin:0 auto; padding:6px;">
        <input type="text" class="line-input" id="modalSetlistNameInput" placeholder="Cím..." value="${defaultName}" style="font-size:16px; margin-bottom:18px;" autofocus>
        <div style="display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:22px; font-size:15px;">
          <span style="color:var(--text-muted);">Dátum:</span>
          <strong id="modalSetlistDateLabel">${formatSetlistDateModalLabel(defaultDate)}</strong>
          <label style="cursor:pointer; color:var(--accent); display:inline-flex; align-items:center;" title="Dátum módosítása">
            ✎
            <input type="date" id="modalSetlistDateInput" value="${defaultDate}" style="position:absolute; opacity:0; width:1px; height:1px;" onchange="document.getElementById('modalSetlistDateLabel').textContent = StageChartUI.formatSetlistDateModalLabel(this.value)">
          </label>
          <input type="date" class="select-clean" id="modalSetlistDateVisible" value="${defaultDate}" style="padding:3px 8px; font-size:12.5px;" onchange="document.getElementById('modalSetlistDateInput').value = this.value; document.getElementById('modalSetlistDateLabel').textContent = StageChartUI.formatSetlistDateModalLabel(this.value)">
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <button class="btn-outline" onclick="StageChartUI.closeModal()">Mégsem</button>
          <button class="btn-primary" onclick="StageChartUI.confirmSaveSetlistModal(${!!editExisting})">${editExisting ? 'Mentés' : 'Hozzáadás'}</button>
        </div>
      </div>
    `;
    showModalHtml(html);
    setTimeout(() => {
      const inp = document.getElementById('modalSetlistNameInput');
      if (inp) inp.focus();
    }, 50);
  }

  function openEditSetlistModal() {
    openNewSetlistModal(true);
  }

  function confirmSaveSetlistModal(editExisting) {
    const nameInput = document.getElementById('modalSetlistNameInput');
    const dateInput = document.getElementById('modalSetlistDateInput');
    const name = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : 'Új lista';
    const dateVal = (dateInput && dateInput.value) ? dateInput.value : new Date().toISOString().slice(0, 10);

    if (editExisting && runtime.viewingSetlistId) {
      const list = setlists.find(l => l.id === runtime.viewingSetlistId);
      if (list) {
        list.name = name;
        list.date = dateVal;
      }
      persistAll();
      closeModal();
      renderSidebarContent();
    } else {
      const newList = {
        id: 'set_' + Date.now(),
        name,
        date: dateVal,
        targetMinutes: 45,
        songIds: []
      };
      setlists.unshift(newList);
      runtime.viewingSetlistId = newList.id;
      runtime.activeSetlistId = newList.id;
      persistAll();
      closeModal();
      renderSidebarContent();
      // Új lista létrehozása után azonnal megnyitjuk a 2-oszlopos "Énekek hozzáadása" ablakot (4. kép)
      openSetlistSongPickerModal();
    }
  }

  /**
   * 4. KÉP ALAPJÁN: Kétoszlopos "Énekek hozzáadása" Setlista Dalválasztó Modal
   */
  function openSetlistSongPickerModal() {
    closeSidebarPopups();
    const list = setlists.find(l => l.id === runtime.viewingSetlistId) || setlists[0];
    if (!list) return;
    runtime.viewingSetlistId = list.id;
    runtime.pickerTempSongIds = [...(list.songIds || [])];
    runtime.pickerSearch = '';
    runtime.pickerSort = runtime.sortMode || 'title';

    const html = `
      <div class="setlist-picker-modal">
        <div class="setlist-picker-header">
          <button class="icon-btn" onclick="StageChartUI.closeModal()" title="Mégsem (✕)">✕</button>
          <span style="font-size:17px;">Énekek hozzáadása — ${list.name}</span>
          <button class="icon-btn" style="color:var(--accent); font-size:20px; font-weight:700;" onclick="StageChartUI.saveSetlistSongPickerModal()" title="Mentés (✓)">✓</button>
        </div>
        <div class="setlist-picker-body">
          <!-- BAL OSZLOP: Daltár keresővel, rendezéssel és zöld pipákkal -->
          <div class="setlist-picker-left">
            <div class="search-box">
              <div class="search-input-wrap">
                <input type="text" class="search-input" id="pickerSearchInput" placeholder="Keresés..." oninput="StageChartUI.onPickerSearchOrSortChange()">
              </div>
              <div class="sort-row" style="margin-top:8px;">
                <span>Rendezés:
                  <select class="select-clean" id="pickerSortSelect" style="padding:2px 6px; font-size:12px;" onchange="StageChartUI.onPickerSearchOrSortChange()">
                    <option value="title" ${runtime.pickerSort === 'title' ? 'selected' : ''}>Cím (A–Z)</option>
                    <option value="artist" ${runtime.pickerSort === 'artist' ? 'selected' : ''}>Előadó (A–Z)</option>
                    <option value="key" ${runtime.pickerSort === 'key' ? 'selected' : ''}>Hangnem (+ ABC)</option>
                    <option value="recent" ${runtime.pickerSort === 'recent' ? 'selected' : ''}>Legutóbb hozzáadott</option>
                    <option value="number" ${runtime.pickerSort === 'number' ? 'selected' : ''}>Sorszám</option>
                  </select>
                </span>
                <span id="pickerTotalLibraryCount">0 ének</span>
              </div>
            </div>
            <div class="song-list-container" id="pickerLibraryListContainer"></div>
          </div>

          <!-- JOBB OSZLOP: Kiválasztott énekek sorszámmal, összidővel, kukával és sorrend-nyilakkal -->
          <div class="setlist-picker-right">
            <div style="padding:10px 14px; text-align:right; font-size:13px; color:var(--text-muted); border-bottom:1px solid var(--border);">
              Hossz: <strong id="pickerSelectedDuration">0m</strong>
            </div>
            <div class="song-list-container" id="pickerSelectedListContainer"></div>
          </div>
        </div>
      </div>
    `;

    showModalHtml(html);
    refreshSetlistPickerColumns();
  }

  function onPickerSearchOrSortChange() {
    const sInp = document.getElementById('pickerSearchInput');
    const sortSel = document.getElementById('pickerSortSelect');
    if (sInp) runtime.pickerSearch = sInp.value.toLowerCase().trim();
    if (sortSel) runtime.pickerSort = sortSel.value;
    refreshSetlistPickerColumns();
  }

  function refreshSetlistPickerColumns() {
    const leftContainer = document.getElementById('pickerLibraryListContainer');
    const rightContainer = document.getElementById('pickerSelectedListContainer');
    if (!leftContainer || !rightContainer) return;

    leftContainer.innerHTML = '';
    rightContainer.innerHTML = '';

    const filtered = sortSongsArray(
      songs.filter(s =>
        !runtime.pickerSearch ||
        (s.title || '').toLowerCase().includes(runtime.pickerSearch) ||
        (s.artist || '').toLowerCase().includes(runtime.pickerSearch)
      ),
      runtime.pickerSort
    );

    const cntLbl = document.getElementById('pickerTotalLibraryCount');
    if (cntLbl) cntLbl.textContent = `${filtered.length} ének`;

    let currentGrp = '';
    filtered.forEach(song => {
      const grpName = getSongGroupLabel(song, runtime.pickerSort);
      if (grpName !== currentGrp) {
        currentGrp = grpName;
        const grp = document.createElement('div');
        grp.className = 'alpha-group';
        grp.textContent = currentGrp;
        leftContainer.appendChild(grp);
      }

      const occurrences = runtime.pickerTempSongIds.filter(id => id === song.id).length;
      const checked = occurrences > 0;
      const badgeLabel = checked ? (occurrences > 1 ? `x${occurrences}` : '✓') : '';
      const row = document.createElement('div');
      row.className = 'song-item';
      row.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
          <div style="min-width:0;">
            <div class="song-item-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${song.title}</div>
            <div class="song-item-artist">${song.artist || song.altTitle || ''}</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="song-item-key">${song.key || 'D'}</span>
          <span class="check-circle ${checked ? 'checked' : ''}" title="Kattints a hozzáadáshoz (többszöri kattintás: x2, x3)">${badgeLabel}</span>
        </div>
      `;
      // Kattintásra hozzáadja az éneket a listához (ha már benne van, újra hozzáadja és x2, x3 lesz a zöld körben!)
      row.onclick = () => {
        runtime.pickerTempSongIds.push(song.id);
        refreshSetlistPickerColumns();
      };
      // Jobb gombbal (vagy ha a felhasználó csökkenteni akarja) a bal oszlopban is levehető egy példány
      row.oncontextmenu = (e) => {
        e.preventDefault();
        const lastIdx = runtime.pickerTempSongIds.lastIndexOf(song.id);
        if (lastIdx !== -1) {
          runtime.pickerTempSongIds.splice(lastIdx, 1);
          refreshSetlistPickerColumns();
        }
      };
      leftContainer.appendChild(row);
    });

    // Jobb oszlop: kiválasztott énekek (szabadon húzható "=" fogantyúval és kukával)
    const selectedSongs = runtime.pickerTempSongIds.map(id => songs.find(s => s.id === id)).filter(Boolean);
    const calc = StageTools.calculateSetlistTotalDuration(selectedSongs);
    const durEl = document.getElementById('pickerSelectedDuration');
    if (durEl) durEl.textContent = calc.formatted;

    selectedSongs.forEach((s, idx) => {
      const row = document.createElement('div');
      row.className = 'song-item';
      row.dataset.idx = idx;
      row.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
          <span style="font-weight:700; color:var(--accent); min-width:18px;">${idx + 1}</span>
          <span style="font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.title}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="song-item-key">${s.key || 'D'}</span>
          <button class="icon-btn" style="width:26px;height:26px;color:var(--text-muted);" onclick="StageChartUI.removeSongFromPicker(${idx})" title="Eltávolítás a listából">🗑</button>
          <div class="drag-handle-eq" title="Húzd fel vagy le a sorrend módosításához">
            <span></span><span></span>
          </div>
        </div>
      `;
      const handle = row.querySelector('.drag-handle-eq');
      attachFreeDragReorder(handle, row, rightContainer, runtime.pickerTempSongIds, idx, () => {
        refreshSetlistPickerColumns();
      });
      rightContainer.appendChild(row);
    });
  }

  function addDuplicateSongToPicker(songId) {
    runtime.pickerTempSongIds.push(songId);
    refreshSetlistPickerColumns();
  }

  function removeSongFromPicker(idx) {
    runtime.pickerTempSongIds.splice(idx, 1);
    refreshSetlistPickerColumns();
  }

  function moveSongInPicker(idx, delta) {
    const target = idx + delta;
    if (target < 0 || target >= runtime.pickerTempSongIds.length) return;
    const tmp = runtime.pickerTempSongIds[idx];
    runtime.pickerTempSongIds[idx] = runtime.pickerTempSongIds[target];
    runtime.pickerTempSongIds[target] = tmp;
    refreshSetlistPickerColumns();
  }

  function saveSetlistSongPickerModal() {
    const list = setlists.find(l => l.id === runtime.viewingSetlistId);
    if (list) {
      list.songIds = [...runtime.pickerTempSongIds];
      persistAll();
    }
    closeModal();
    renderSidebarContent();
  }

  /**
   * 6. ÉS 7. KÉP ALAPJÁN: Setlista "..." Kontextus Menü és "Áttekintő lap nyomtatása"
   */
  function toggleSetlistContextMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('setlistContextMenu');
    const wasOpen = menu.classList.contains('open');
    closeSidebarPopups();
    if (!wasOpen) menu.classList.add('open');
  }

  /**
   * Valódi SongbookPro (.sbp) ZIP archívum előállítása ("dataFile" -> "1.0\n{...}")
   */
  function createSbpArchiveBlob(songsArray, setsArray = []) {
    const scaleMap = settings.notation === 'hu' ? SBP_KEY_MAP_HU : SBP_KEY_MAP_EN;
    const sbpSongs = songsArray.map((s, idx) => {
      const kIdx = scaleMap.indexOf(s.key || 'D');
      return {
        id: s.id || (idx + 1),
        name: s.title || 'Névtelen ének',
        subtitle: s.altTitle || '',
        author: s.artist || '',
        key: kIdx !== -1 ? kIdx : 5,
        tempo: s.bpm || 90,
        timeSig: s.timeSig || '4/4',
        content: s.content || ''
      };
    });

    const sbpSets = setsArray.map((l, idx) => ({
      id: idx + 1,
      name: l.name || 'Lista',
      date: l.date || new Date().toISOString().slice(0, 10),
      songOverrides: l.songOverrides || {},
      contents: (l.songIds || []).map(sid => {
        const ov = l.songOverrides ? l.songOverrides[String(sid)] : null;
        const rawSemi = ov ? (ov.transposeSemitones || 0) : 0;
        const signedShift = rawSemi > 6 ? rawSemi - 12 : rawSemi;
        return {
          songId: sid,
          transposeSemitones: rawSemi,
          keyAdjust: signedShift,
          keyAdjustment: signedShift,
          keyShift: signedShift,
          capo: ov ? (ov.capo || 0) : 0
        };
      })
    }));

    const dataFileStr = '1.0\n' + JSON.stringify({ songs: sbpSongs, sets: sbpSets });
    const fileData = new TextEncoder().encode(dataFileStr);
    const nameBytes = new TextEncoder().encode('dataFile');

    // CRC32 számítás a szabványos ZIP fejléchez
    let crc = 0xffffffff;
    for (let i = 0; i < fileData.length; i++) {
      crc ^= fileData[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    const localLen = 30 + nameBytes.length;
    const cdLen = 46 + nameBytes.length;
    const totalLen = localLen + fileData.length + cdLen + 22;
    const zipBuf = new ArrayBuffer(totalLen);
    const view = new DataView(zipBuf);
    const out = new Uint8Array(zipBuf);

    // 1. Local File Header (PK\x03\x04)
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true); // store (method 0)
    view.setUint32(14, crc, true);
    view.setUint32(18, fileData.length, true);
    view.setUint32(22, fileData.length, true);
    view.setUint16(26, nameBytes.length, true);
    out.set(nameBytes, 30);
    out.set(fileData, localLen);

    // 2. Central Directory Header (PK\x01\x02)
    const cdStart = localLen + fileData.length;
    view.setUint32(cdStart, 0x02014b50, true);
    view.setUint16(cdStart + 4, 20, true);
    view.setUint16(cdStart + 6, 20, true);
    view.setUint16(cdStart + 10, 0, true);
    view.setUint32(cdStart + 16, crc, true);
    view.setUint32(cdStart + 20, fileData.length, true);
    view.setUint32(cdStart + 24, fileData.length, true);
    view.setUint16(cdStart + 28, nameBytes.length, true);
    view.setUint32(cdStart + 42, 0, true);
    out.set(nameBytes, cdStart + 46);

    // 3. End of Central Directory (PK\x05\x06)
    const eocdStart = cdStart + cdLen;
    view.setUint32(eocdStart, 0x06054b50, true);
    view.setUint16(eocdStart + 8, 1, true);
    view.setUint16(eocdStart + 10, 1, true);
    view.setUint32(eocdStart + 12, cdLen, true);
    view.setUint32(eocdStart + 16, cdStart, true);

    return new Blob([zipBuf], { type: 'application/octet-stream' });
  }

  function exportActiveSetlist(format = 'json') {
    closeAllDropdowns();
    closeSidebarPopups();
    const list = setlists.find(l => l.id === runtime.viewingSetlistId) || setlists.find(l => l.id === runtime.activeSetlistId) || setlists[0];
    if (!list) return;
    const listSongs = (list.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean);

    if (format === 'sbp') {
      const blob = createSbpArchiveBlob(listSongs, [list]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${list.name.replace(/\s+/g, '_')}.sbp`;
      a.click();
      return;
    }

    if (format === 'cho') {
      const combinedCho = listSongs.map(s =>
        `{title: ${s.title}}\n{artist: ${s.artist || ''}}\n{key: ${s.key || 'D'}}\n\n${Theory.convertOverToChordPro(s.content || '')}`
      ).join('\n\n========================================\n\n');
      const blob = new Blob([combinedCho], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${list.name.replace(/\s+/g, '_')}_Setlista.cho`;
      a.click();
      return;
    }

    const payload = {
      type: 'StageChart_Setlist',
      setlist: list,
      songs: listSongs
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${list.name.replace(/\s+/g, '_')}_Setlista.json`;
    a.click();
  }

  async function shareActiveSetlist(format = 'sbp') {
    closeAllDropdowns();
    closeSidebarPopups();
    const list = setlists.find(l => l.id === runtime.viewingSetlistId) || setlists.find(l => l.id === runtime.activeSetlistId) || setlists[0];
    if (!list) return;
    const listSongs = (list.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean);
    const fileName = `${list.name.replace(/\s+/g, '_')}.${format === 'cho' ? 'cho' : 'sbp'}`;
    const blob = format === 'cho'
      ? new Blob([listSongs.map(s => `{title: ${s.title}}\n${Theory.convertOverToChordPro(s.content || '')}`).join('\n\n')], { type: 'text/plain;charset=utf-8' })
      : createSbpArchiveBlob(listSongs, [list]);

    if (navigator.canShare && navigator.share) {
      try {
        const fileObj = new File([blob], fileName, { type: 'application/octet-stream' });
        if (navigator.canShare({ files: [fileObj] })) {
          await navigator.share({ title: list.name, files: [fileObj] });
          return;
        }
      } catch (e) {}
    }
    exportActiveSetlist(format);
  }

  function promptSaveSetlistAs() {
    closeSidebarPopups();
    const list = setlists.find(l => l.id === runtime.viewingSetlistId);
    if (!list) return;
    const html = `
      <div style="max-width:380px; margin:0 auto;">
        <h3 style="margin-bottom:12px;">Lista mentése mint — ${list.name}</h3>
        <div style="display:flex; flex-direction:column; gap:10px;">
          <button class="btn-primary" onclick="StageChartUI.exportActiveSetlist('json'); StageChartUI.closeModal();">💾 StageChart Setlista csomag (.json)</button>
          <button class="btn-outline" onclick="StageChartUI.exportActiveSetlist('cho'); StageChartUI.closeModal();">📄 ChordPro gyűjtemény (.cho)</button>
          <button class="btn-outline" onclick="StageChartUI.closeModal(); StageChartUI.printSetlistOverview();">🖨 Áttekintő lap mentése PDF-ként</button>
          <button class="btn-outline" onclick="StageChartUI.closeModal()">Mégsem</button>
        </div>
      </div>
    `;
    showModalHtml(html);
  }

  function printActiveSetlistSongs() {
    closeSidebarPopups();
    const list = setlists.find(l => l.id === runtime.viewingSetlistId);
    if (!list) return;
    const listSongs = (list.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean);
    if (listSongs.length > 0) {
      selectSongById(listSongs[0].id);
    }
    setTimeout(() => window.print(), 150);
  }

  /**
   * 7. KÉP ALAPJÁN: Áttekintő lap nyomtatása (Bal felső: Lista címe, Jobb felső: Dátum, Vízszintes vonal, alatta Dalok + Hangnem)
   */
  function printSetlistOverview() {
    closeSidebarPopups();
    const list = setlists.find(l => l.id === runtime.viewingSetlistId) || setlists[0];
    if (!list) return;
    const listSongs = (list.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean);
    const printArea = document.getElementById('setlistOverviewPrintArea');
    if (!printArea) return;

    let itemsHtml = '';
    listSongs.forEach((s, idx) => {
      const subText = s.altTitle || s.artist || '';
      const numStr = settings.printSongNumbers ? `${idx + 1}. ` : '';
      const effKey = getEffectiveSongKeyInSetlist(s, list);
      const ov = list.songOverrides ? list.songOverrides[String(s.id)] : null;
      const capoStr = ov && ov.capo > 0 ? ` (Kápó ${ov.capo})` : '';
      itemsHtml += `
        <div class="setlist-overview-item">
          <div class="ov-song-title">${numStr}${s.title}</div>
          ${subText ? `<div class="ov-song-sub">${subText}</div>` : ''}
          <div class="ov-song-key">Hangnem: ${effKey}${capoStr}</div>
        </div>
      `;
    });

    printArea.innerHTML = `
      <div class="setlist-overview-header">
        <h1>${list.name}</h1>
        <div class="overview-date">${formatSetlistDateShort(list.date)}</div>
      </div>
      ${itemsHtml}
    `;

    document.body.classList.add('printing-setlist-overview');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-setlist-overview');
    }, 500);
  }

  function deleteActiveSetlist() {
    closeSidebarPopups();
    if (!runtime.viewingSetlistId) return;
    deleteSetlist(runtime.viewingSetlistId);
  }

  function duplicateActiveSetlist() {
    closeSidebarPopups();
    const list = setlists.find(l => l.id === runtime.viewingSetlistId);
    if (!list) return;
    const copy = {
      ...JSON.parse(JSON.stringify(list)),
      id: 'set_' + Date.now(),
      name: list.name + ' (Másolat)'
    };
    setlists.unshift(copy);
    runtime.viewingSetlistId = copy.id;
    runtime.activeSetlistId = copy.id;
    persistAll();
    renderSidebarContent();
  }

  function shuffleActiveSetlist() {
    closeSidebarPopups();
    const list = setlists.find(l => l.id === runtime.viewingSetlistId);
    if (!list || !list.songIds) return;
    for (let i = list.songIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list.songIds[i], list.songIds[j]] = [list.songIds[j], list.songIds[i]];
    }
    persistAll();
    renderSidebarContent();
  }

  /**
   * 9. KÉP ALAPJÁN: Csoportos kijelölés (Multi-Select) az "Összes ének" nézetben (Törlés, Mentés, Címkék)
   */
  function handleMultiSelectBtnClick(event) {
    if (event) event.stopPropagation();
    if (!runtime.multiSelectMode) {
      runtime.multiSelectMode = true;
      runtime.selectedSongIds = [];
      renderSidebarContent();
    }
    const menu = document.getElementById('multiSelectPopupMenu');
    const wasOpen = menu.classList.contains('open');
    closeSidebarPopups();
    if (!wasOpen) menu.classList.add('open');
  }

  function toggleSongMultiSelect(songId) {
    const idx = runtime.selectedSongIds.indexOf(songId);
    if (idx === -1) runtime.selectedSongIds.push(songId);
    else runtime.selectedSongIds.splice(idx, 1);
    renderSidebarContent();
  }

  function selectAllSongs() {
    closeSidebarPopups();
    runtime.multiSelectMode = true;
    runtime.selectedSongIds = songs.map(s => s.id);
    renderSidebarContent();
  }

  function invertSongSelection() {
    closeSidebarPopups();
    runtime.multiSelectMode = true;
    runtime.selectedSongIds = songs
      .filter(s => !runtime.selectedSongIds.includes(s.id))
      .map(s => s.id);
    renderSidebarContent();
  }

  function exitMultiSelectMode() {
    closeSidebarPopups();
    runtime.multiSelectMode = false;
    runtime.selectedSongIds = [];
    renderSidebarContent();
  }

  function deleteSelectedSongs() {
    closeSidebarPopups();
    if (!runtime.selectedSongIds.length) {
      alert('Nincs kijelölve egyetlen ének sem a törléshez!');
      return;
    }
    if (!confirm(`Biztosan törölni szeretnéd a kijelölt ${runtime.selectedSongIds.length} db éneket?`)) return;

    songs = songs.filter(s => !runtime.selectedSongIds.includes(s.id));
    setlists.forEach(list => {
      list.songIds = (list.songIds || []).filter(id => !runtime.selectedSongIds.includes(id));
    });

    if (songs.length === 0) {
      createNewSong();
    } else if (!songs.some(s => s.id === runtime.currentSongId)) {
      runtime.currentSongId = songs[0].id;
    }

    runtime.multiSelectMode = false;
    runtime.selectedSongIds = [];
    persistAll();
    refreshMainView();
  }

  function exportSelectedSongs() {
    closeSidebarPopups();
    const selected = songs.filter(s => runtime.selectedSongIds.includes(s.id));
    if (!selected.length) {
      alert('Jelölj ki legalább egy éneket a mentéshez!');
      return;
    }
    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `StageChart_Kijelolt_Enekek_${selected.length}db.json`;
    a.click();
  }

  function batchEditTagsForSelected() {
    closeSidebarPopups();
    const selected = songs.filter(s => runtime.selectedSongIds.includes(s.id));
    if (!selected.length) {
      alert('Jelölj ki legalább egy éneket a címkék módosításához!');
      return;
    }
    const newTagsStr = prompt(`Add meg az új címkéket a kijelölt ${selected.length} db énekhez (vesszővel elválasztva):`, 'Koncert, Kedvenc');
    if (newTagsStr === null) return;
    const tagArr = newTagsStr.split(',').map(t => t.trim()).filter(Boolean);
    selected.forEach(s => {
      s.tags = Array.from(new Set([...(s.tags || []), ...tagArr]));
    });
    persistAll();
    renderSidebarContent();
  }

  function selectSongById(songId) {
    saveCurrentDrawingToSong();
    runtime.currentSongId = songId;

    if (sessionSetlist && sessionSetlist.setlist && sessionSetlist.setlist.songOverrides) {
      const ov = sessionSetlist.setlist.songOverrides[String(songId)];
      runtime.transposeSemitones = ov && typeof ov.transposeSemitones === 'number' ? ov.transposeSemitones : 0;
      runtime.capo = ov && typeof ov.capo === 'number' ? ov.capo : 0;
    } else {
      const activeList = getActiveOrViewingSetlist();
      const ov = activeList && activeList.songOverrides ? activeList.songOverrides[String(songId)] : null;
      runtime.transposeSemitones = ov && typeof ov.transposeSemitones === 'number' ? ov.transposeSemitones : 0;
      runtime.capo = ov && typeof ov.capo === 'number' ? ov.capo : 0;
    }
    const capoEl = document.getElementById('capoVal');
    if (capoEl) capoEl.textContent = String(runtime.capo);

    StageTools.clearSectionLoop();
    refreshMainView(syncUi.role === 'leader');

    if (settings.midiEnabled) {
      const sArr = (sessionSetlist && sessionSetlist.songs) || songs;
      const idx = sArr.findIndex(s => String(s.id) === String(songId));
      StageTools.sendMidiProgramChange(Math.max(0, idx));
    }

    if (!document.getElementById('sidebar').classList.contains('pinned')) {
      toggleSidebar(false);
    }
  }

  function handleSidebarAdd(event) {
    if (event) event.stopPropagation();
    if (runtime.sidebarTab === 'setlists') {
      openNewSetlistModal(false);
    } else {
      const addMenu = document.getElementById('sidebarAddPopupMenu');
      const wasOpen = addMenu.classList.contains('open');
      closeSidebarPopups();
      if (!wasOpen) addMenu.classList.add('open');
    }
  }

  function addCurrentSongToSetlist(setlistId) {
    const list = setlists.find(l => l.id === setlistId);
    if (!list) return;
    if (!list.songIds.includes(runtime.currentSongId)) {
      list.songIds.push(runtime.currentSongId);
      persistAll();
      renderSidebarContent();
    }
  }

  function deleteSetlist(setlistId) {
    if (!confirm('Biztosan törlöd ezt a setlistát? (A dalok megmaradnak a daltárban)')) return;
    setlists = setlists.filter(l => l.id !== setlistId);
    if (runtime.viewingSetlistId === setlistId) runtime.viewingSetlistId = null;
    if (runtime.activeSetlistId === setlistId) runtime.activeSetlistId = null;
    persistAll();
    renderSidebarContent();
  }

  function toggleSidebar(force) {
    closeSidebarPopups();
    const sb = document.getElementById('sidebar');
    const open = force !== undefined ? force : !sb.classList.contains('open');
    sb.classList.toggle('open', open);
  }

  function togglePinSidebar() {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('pinned');
    document.getElementById('btnPinSidebar').classList.toggle('active', sb.classList.contains('pinned'));
  }

  /********************************************************************
   * 6. KÉTOSZLOPOS ÉLŐ ÉNEK SZERKESZTŐ + CHORDPRO KONVERTÁLÓ
   ********************************************************************/
  function openEditorScreen() {
    closeAllDropdowns();
    const song = getCurrentSong();
    document.getElementById('editTitle').value = song.title || '';
    document.getElementById('editAltTitle').value = song.altTitle || '';
    document.getElementById('editArtist').value = song.artist || '';
    document.getElementById('editTags').value = (song.tags || []).join(', ');
    document.getElementById('editKey').value = song.key || 'D';
    document.getElementById('editTimeSig').value = song.timeSig || '4/4';
    document.getElementById('editBpm').value = song.bpm || 90;
    document.getElementById('editDuration').value = song.duration || '3:30';
    document.getElementById('editOrder').value = song.order || '';
    document.getElementById('editNumber').value = song.number || '';
    document.getElementById('editCopyright').value = song.copyright || '';
    document.getElementById('editWebsite').value = song.website || '';
    const editTa = document.getElementById('editContent');
    editTa.placeholder = 'Kezd el ide gépelni vagy másolni a dalszöveget és az akkordokat. Ez a minta szöveg automatikusan el fog tűnni...';
    editTa.value = song.content || '';

    document.querySelectorAll('input[name="editFormat"]').forEach(r => {
      r.checked = (r.value === (song.format || 'over'));
    });

    renderEditorPreview();
    document.getElementById('screenEditor').classList.add('open');
  }

  function closeEditorScreen() {
    document.getElementById('screenEditor').classList.remove('open');
  }

  function switchEditorTab(tab) {
    document.getElementById('tabBtnGeneral').classList.toggle('active', tab === 'general');
    document.getElementById('tabBtnAdvanced').classList.toggle('active', tab === 'advanced');
    document.getElementById('editorTabGeneral').style.display = tab === 'general' ? 'flex' : 'none';
    document.getElementById('editorTabAdvanced').style.display = tab === 'advanced' ? 'flex' : 'none';
  }

  function handleFormatConvert(targetFormat) {
    const ta = document.getElementById('editContent');
    if (targetFormat === 'chordpro') {
      ta.value = Theory.convertOverToChordPro(ta.value);
    } else {
      ta.value = Theory.convertChordProToOver(ta.value);
    }
    renderEditorPreview();
  }

  function renderEditorPreview() {
    const contentVal = document.getElementById('editContent').value;
    const tempSong = {
      title: document.getElementById('editTitle').value || 'Névtelen ének',
      altTitle: document.getElementById('editAltTitle').value || '',
      artist: document.getElementById('editArtist').value || '',
      key: document.getElementById('editKey').value || 'D',
      bpm: document.getElementById('editBpm').value || '',
      timeSig: document.getElementById('editTimeSig').value || '',
      content: contentVal
    };

    document.getElementById('previewTitle').textContent = tempSong.title;
    document.getElementById('previewSubtitle').textContent = tempSong.altTitle;
    document.getElementById('previewArtist').textContent = tempSong.artist;
    document.getElementById('previewMeta').innerHTML = `Hangnem: ${tempSong.key}${tempSong.bpm ? '<br>' + tempSong.bpm + ' BPM' : ''}`;

    renderSongInto(tempSong, document.getElementById('previewBody'), null, false);
  }

  function insertAtCursor(text) {
    const ta = document.getElementById('editContent');
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
    ta.focus();
    renderEditorPreview();
  }

  function saveEditorChanges() {
    const song = getCurrentSong();
    song.title = document.getElementById('editTitle').value || 'Névtelen ének';
    song.altTitle = document.getElementById('editAltTitle').value || '';
    song.artist = document.getElementById('editArtist').value || '';
    song.tags = document.getElementById('editTags').value.split(',').map(t => t.trim()).filter(Boolean);
    song.key = document.getElementById('editKey').value || 'D';
    song.timeSig = document.getElementById('editTimeSig').value || '4/4';
    song.bpm = parseInt(document.getElementById('editBpm').value, 10) || 90;
    song.duration = document.getElementById('editDuration').value || '3:30';
    song.order = document.getElementById('editOrder').value || '';
    song.number = document.getElementById('editNumber').value || '';
    song.copyright = document.getElementById('editCopyright').value || '';
    song.website = document.getElementById('editWebsite').value || '';
    song.content = document.getElementById('editContent').value;
    const fmtRadio = document.querySelector('input[name="editFormat"]:checked');
    if (fmtRadio) song.format = fmtRadio.value;

    persistAll();
    closeEditorScreen();
    refreshMainView();
  }

  function createNewSong() {
    if (!guardTrialLimit()) return;
    const newId = Date.now();
    const newSong = {
      id: newId,
      title: 'Új ének',
      altTitle: '',
      artist: 'Előadó',
      key: 'D',
      bpm: 100,
      timeSig: '4/4',
      duration: '3:30',
      order: 'V1 C V2 C',
      number: String(songs.length + 1).padStart(2, '0'),
      copyright: '',
      website: '',
      tags: [],
      format: 'over',
      rehearsalNotes: {},
      content: ''
    };
    songs.push(newSong);
    runtime.currentSongId = newId;
    persistAll();
    refreshMainView();
    openEditorScreen();
  }

  /********************************************************************
   * 7. AUDIO MUNKAÁLLOMÁS, METRONÓM / GROOVE, PAD ÉS GYORSMŰVELETEK
   ********************************************************************/
  function toggleAmbientPad() {
    const song = getCurrentSong();
    const basePc = Theory.noteToPitchClass((song.key || 'D').replace('m', ''), settings.notation);
    const soundingPc = ((basePc !== -1 ? basePc : 2) + runtime.transposeSemitones + 120) % 12;

    const running = AudioEngine.togglePad(soundingPc, settings);
    document.getElementById('btnPadToggle').classList.toggle('running', running);
  }

  function toggleMetronome() {
    const btn = document.getElementById('fabMetronome');
    const topbar = document.getElementById('topbar');

    if (!AudioEngine.isGrooveRunning()) {
      const song = getCurrentSong();
      AudioEngine.startGroove(song.bpm || 90, settings, {
        onBeat: ({ beat, isDownbeat }) => {
          if (settings.metronomeFlashTopbar) {
            const cls = isDownbeat ? 'beat-flash-downbeat' : 'beat-flash-sub';
            topbar.classList.add(cls);
            setTimeout(() => topbar.classList.remove(cls), 95);
          }
          if (isDownbeat) {
            StageTools.onBarAdvanced();
          }
        },
        onBpmChange: (newBpm) => {
          song.bpm = newBpm;
          refreshMainView(false);
        },
        onAutoStop: () => {
          btn.classList.remove('active');
        }
      });
      btn.classList.add('active');
    } else {
      AudioEngine.stopGroove();
      btn.classList.remove('active');
    }
  }

  function changeGrooveStyle(styleVal) {
    settings.audioRouting.grooveStyle = styleVal;
    persistAll();
    if (AudioEngine.isGrooveRunning()) {
      // Azonnali stílusváltás menet közben
      AudioEngine.stopGroove();
      toggleMetronome();
    }
  }

  function handleTapTempo() {
    const newBpm = AudioEngine.registerTap();
    if (newBpm && newBpm >= 35 && newBpm <= 240) {
      const song = getCurrentSong();
      song.bpm = newBpm;
      persistAll();
      refreshMainView(false);
      if (AudioEngine.isGrooveRunning()) {
        AudioEngine.stopGroove();
        toggleMetronome();
      }
    }
  }

  function triggerCueCountIn() {
    AudioEngine.triggerCue('Intro, one, two, three, four', settings.audioRouting);
  }

  function stepTranspose(delta) {
    runtime.transposeSemitones = (runtime.transposeSemitones + delta + 12) % 12;
    saveCurrentSongOverrideToActiveSetlist();
    refreshMainView();
  }

  function changeCapo(delta) {
    runtime.capo = Math.max(0, Math.min(11, runtime.capo + delta));
    document.getElementById('capoVal').textContent = runtime.capo;
    saveCurrentSongOverrideToActiveSetlist();
    refreshMainView();
  }

  function setCapo(val) {
    runtime.capo = val;
    document.getElementById('capoVal').textContent = val;
    saveCurrentSongOverrideToActiveSetlist();
    refreshMainView();
  }

  function resetTranspositionAndCapo() {
    runtime.transposeSemitones = 0;
    runtime.capo = 0;
    document.getElementById('capoVal').textContent = 0;
    saveCurrentSongOverrideToActiveSetlist();
    refreshMainView();
  }

  function changeInstrumentView(view) {
    runtime.instrumentView = view;
    refreshMainView();
  }

  function searchSongOnWeb() {
    const song = getCurrentSong();
    if (song.website && song.website.startsWith('http')) {
      window.open(song.website, '_blank');
      return;
    }
    const q = encodeURIComponent(`${song.title} ${song.artist || ''}`);
    const provider = settings.webSearchProvider || 'YouTube';
    const url = provider === 'Spotify'
      ? `https://open.spotify.com/search/${q}`
      : provider === 'Google'
      ? `https://www.google.com/search?q=${q}+chords`
      : `https://www.youtube.com/results?search_query=${q}`;
    window.open(url, '_blank');
  }

  function promptCustomScrollDuration() {
    const current = document.getElementById('scrollTimeLabel').textContent;
    const input = prompt('Add meg az automatikus görgetés kívánt idejét (perc:másodperc, pl. 2:15):', current);
    if (!input) return;
    document.getElementById('scrollTimeLabel').textContent = input.trim();
  }

  function toggleAutoScroll() {
    const btn = document.getElementById('fabScroll');
    const viewer = document.getElementById('mainViewer');
    clearTimeout(scrollDelayTimeout);

    if (!runtime.autoScrolling) {
      runtime.autoScrolling = true;
      btn.classList.add('active');
      const delayMs = (parseInt(settings.autoScrollDelaySec, 10) || 0) * 1000;
      if (delayMs > 0) {
        StageTools.showStageCueBanner(`Görgetés indul ${settings.autoScrollDelaySec} mp múlva...`, 2000, false);
      }
      scrollDelayTimeout = setTimeout(() => {
        scrollInterval = setInterval(() => {
          viewer.scrollTop += runtime.scrollSpeed * 0.45;
        }, 35);
      }, delayMs);
    } else {
      clearInterval(scrollInterval);
      runtime.autoScrolling = false;
      btn.classList.remove('active');
    }
  }

  /********************************************************************
   * 8. BEÁLLÍTÁSOK MENÜRENDSZER ÉS LÁBKAPCSOLÓ KÁRTYÁK
   ********************************************************************/
  function openSettingsScreen() {
    closeAllDropdowns();
    const audioInfo = AudioEngine.initAudio();
    const badge = document.getElementById('maxChannelsBadge');
    if (badge) badge.textContent = `${audioInfo.maxChannels} csatorna elérhető`;

    document.getElementById('chkDarkMode').checked = !!settings.darkMode;
    document.getElementById('setNotationSystem').value = settings.notation || 'hu';
    const bModeEl = document.getElementById('setBNoteInputMode');
    if (bModeEl) bModeEl.value = settings.bNoteInputMode || 'auto';
    document.getElementById('setPageLayout').value = settings.pageLayout || 'auto';
    document.getElementById('setLongLines').value = settings.longLinesBehavior || 'wrap';
    document.getElementById('chkWarnTabs').checked = settings.warnTabsOnTranspose !== false;
    document.getElementById('chkInlineDiagrams').checked = !!settings.showChordDiagramsInline;
    document.getElementById('chkLeftHanded').checked = !!settings.leftHandedChords;

    const langSel = document.getElementById('setLanguageSelect');
    if (langSel) langSel.value = settings.language || 'hu';
    const themeSel = document.getElementById('setThemeSelect');
    if (themeSel) themeSel.value = settings.theme || 'default';
    renderLicensePage();
    renderSyncPanel();

    renderPedalBindingCards();
    renderPadStatusGrid();
    document.getElementById('screenSettings').classList.add('open');
  }

  function closeSettingsScreen() {
    document.getElementById('screenSettings').classList.remove('open');
    refreshMainView();
  }

  function switchSettingsPage(pageId, navEl) {
    document.querySelectorAll('.settings-nav-item').forEach(el => el.classList.remove('active'));
    if (navEl) navEl.classList.add('active');
    document.querySelectorAll('.settings-page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('setPage-' + pageId);
    if (target) target.classList.add('active');
  }

  function toggleDarkMode(enabled) {
    settings.darkMode = enabled;
    document.body.classList.toggle('dark-mode', enabled);
    persistAll();
    applyFormattingCssVariables();
  }

  function updateSetting(key, val) {
    settings[key] = val;
    if (key === 'highContrast') document.body.classList.toggle('high-contrast', !!val);
    if (key === 'compactSidebar') document.getElementById('sidebar').classList.toggle('compact', !!val);
    if (key === 'touchZonesEnabled') document.body.classList.toggle('touch-zones-active', !!val);
    if (key === 'stageDimmerIdle') StageTools.setupStageIdleDimmer(!!val);
    if (key === 'language' && I18n) I18n.applyLanguage(val);
    if (key === 'theme' && I18n) I18n.applyTheme(val);
    persistAll();
    refreshMainView();
  }

  function updateAudioRouting() {
    settings.audioRouting.clickChannel = document.getElementById('routeClickCh').value;
    settings.audioRouting.cueChannel = document.getElementById('routeCueCh').value;
    settings.audioRouting.padChannelPair = document.getElementById('routePadCh').value;
    settings.audioRouting.padCharacter = document.getElementById('setPadCharacter').value;
    settings.audioRouting.padFadeTime = parseFloat(document.getElementById('setPadFadeTime').value) || 2.8;
    persistAll();
  }

  function renderPadStatusGrid(statusObj) {
    const status = statusObj || AudioEngine.getLoadedPadStatus();
    const badge = document.getElementById('dockPadCountBadge');
    if (badge) {
      badge.textContent = status.totalLoaded > 0 ? `${status.totalLoaded}/12 Pad` : 'Synth';
      badge.style.color = status.totalLoaded > 0 ? '#10b981' : 'inherit';
    }

    const grid = document.getElementById('padStatusGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const scale = settings.notation === 'hu' ? Theory.SCALE_HU_SHARP : Theory.SCALE_EN_SHARP;

    scale.forEach((noteName, pc) => {
      const info = status.map[pc];
      const cell = document.createElement('div');
      cell.style.cssText = `
        padding: 8px 6px;
        border-radius: 6px;
        border: 1px solid ${info ? '#10b981' : 'var(--border)'};
        background: ${info ? 'rgba(16, 185, 129, 0.14)' : 'var(--bg-card)'};
        text-align: center;
        font-size: 12px;
      `;
      cell.title = info ? `Betöltve: ${info.name}` : 'Nincs saját fájl (Beépített Synth szól)';
      cell.innerHTML = `
        <div style="font-weight:700; color:${info ? '#10b981' : 'var(--text-main)'};">${noteName}</div>
        <div style="font-size:10px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${info ? '✓ ' + info.name : 'Synth'}
        </div>
      `;
      grid.appendChild(cell);
    });
  }

  async function handleCustomPadsUpload(event) {
    const files = event.target.files;
    if (!files || !files.length) return;
    const res = await AudioEngine.loadCustomPadFiles(files, settings.notation);
    renderPadStatusGrid();
    if (res.loadedCount > 0) {
      StageTools.showStageCueBanner(`✓ ${res.loadedCount} db Pad hangfájl betöltve!`, 2400, false);
    } else {
      alert('Nem sikerült hangfájlt betölteni. Kérlek ellenőrizd, hogy .mp3 vagy .wav formátumúak-e!');
    }
    event.target.value = '';
  }

  async function resetCustomPadsToSynth() {
    await AudioEngine.clearCustomPads();
    renderPadStatusGrid();
    StageTools.showStageCueBanner('Beépített Synth Pad visszaállítva', 2000, false);
  }

  async function handleCustomDrumsUpload(event) {
    const files = event.target.files;
    if (!files || !files.length) return;
    const count = await AudioEngine.loadCustomDrumFiles(files);
    alert(`${count} db saját Dob sample sikeresen betöltve a Groove Engine-be!`);
  }

  function renderPedalBindingCards() {
    const grid = document.getElementById('pedalCardsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    (settings.pedalBindings || []).forEach((b, idx) => {
      const card = document.createElement('div');
      card.className = 'pedal-card';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:13px; color:var(--text-muted);">Művelet:</span>
          <div style="display:flex; gap:4px;">
            <button class="icon-btn" style="width:26px;height:26px;" onclick="StageChartUI.editPedalBinding(${idx})" title="Billentyű módosítása">✎</button>
            <button class="icon-btn" style="width:26px;height:26px;" onclick="StageChartUI.deletePedalBinding(${idx})" title="Törlés">🗑</button>
          </div>
        </div>
        <div style="font-weight:600; font-size:14px;">${b.label}</div>
        <div>
          <span style="font-size:12px; color:var(--text-muted);">Indító: </span>
          <span class="key-badge">${b.key}</span>
        </div>
      `;
      grid.appendChild(card);
    });

    const addCard = document.createElement('div');
    addCard.className = 'pedal-card';
    addCard.style.cssText = 'align-items:center; justify-content:center; cursor:pointer; border-style:dashed;';
    addCard.innerHTML = `<div style="font-size:24px; color:var(--accent);">+</div><div style="font-size:13px; font-weight:600;">Új lábkapcsoló gomb</div>`;
    addCard.onclick = addPedalBinding;
    grid.appendChild(addCard);
  }

  function editPedalBinding(idx) {
    const b = settings.pedalBindings[idx];
    if (!b) return;
    const newKey = prompt(`Nyomd le vagy írd be az új billentyűt ehhez: "${b.label}"`, b.key);
    if (newKey && newKey.trim()) {
      b.key = newKey.trim();
      persistAll();
      renderPedalBindingCards();
    }
  }

  function deletePedalBinding(idx) {
    settings.pedalBindings.splice(idx, 1);
    persistAll();
    renderPedalBindingCards();
  }

  function addPedalBinding() {
    const key = prompt('Add meg a pedál által küldött billentyűt (pl. PageDown, Space, p, m):', 'm');
    if (!key) return;
    settings.pedalBindings.push({
      id: 'p_' + Date.now(),
      action: 'togglePad',
      label: 'Ambient Pad indítás/leállítás',
      key: key.trim()
    });
    persistAll();
    renderPedalBindingCards();
  }

  async function toggleMidiSupport(enabled) {
    settings.midiEnabled = enabled;
    persistAll();
    if (enabled) {
      const res = await StageTools.initWebMIDI(({ noteOrCc }) => {
        if (noteOrCc === 60 || noteOrCc === 64) stepScrollDown(1);
        else if (noteOrCc === 62) nextSongInLibrary(1);
      });
      if (!res.supported) {
        alert('A böngésző nem támogatja a Web MIDI API-t, vagy nincs csatlakoztatott MIDI eszköz.');
      }
    }
  }

  async function toggleWebcamSupport(enabled) {
    settings.webcamGestureEnabled = enabled;
    persistAll();
    const ok = await StageTools.toggleWebcamGesture(enabled, (dir) => {
      stepScrollDown(dir);
    });
    if (!ok && enabled) {
      document.getElementById('chkWebcamGesture').checked = false;
      settings.webcamGestureEnabled = false;
    }
  }

  function selectInstrument(instName, cardEl) {
    settings.instrument = instName;
    document.querySelectorAll('#instrumentSelectorGrid .inst-card').forEach(c => c.classList.remove('active'));
    if (cardEl) cardEl.classList.add('active');
    persistAll();
    refreshMainView();
  }

  function changeSyncRole(role) {
    StageTools.initBandSync(role, (msg) => {
      if (msg.type === 'SONG_STATE') {
        runtime.currentSongId = msg.songId;
        runtime.transposeSemitones = msg.transposeSemitones || 0;
        runtime.capo = msg.capo || 0;
        document.getElementById('capoVal').textContent = runtime.capo;
        refreshMainView(false);
      } else if (msg.type === 'STAGE_CUE') {
        StageTools.showStageCueBanner(msg.text, 4500, false);
      }
    });
    const badge = document.getElementById('syncStatusBadge');
    badge.style.display = role === 'off' ? 'none' : 'inline-block';
    badge.textContent = role === 'leader' ? 'KARMESTER (ADÓ)' : 'KÖVETŐ (VEVŐ)';
  }

  /********************************************************************
   * 9. MODALOK: AKKORD DIAGRAMOK, HANGOLÓ, KÁPÓ-OPTIMALIZÁLÓ, SZÍNPADI ESZKÖZÖK
   ********************************************************************/
  function openChordDiagramsModal() {
    closeAllDropdowns();
    const song = getCurrentSong();
    const basePc = Theory.noteToPitchClass((song.key || 'D').replace('m', ''), settings.notation);
    const chords = Theory.extractUniqueChords(song.content, runtime.transposeSemitones - runtime.capo, {
      notation: settings.notation,
      songRootPc: basePc !== -1 ? basePc : 0,
      accidentalsOverride: settings.accidentalsOverride
    });

    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:12px;">
        <div>
          <h3>Akkord diagramok — ${song.title}</h3>
          <div style="font-size:12.5px; color:var(--text-muted);">Hangszer: <strong>${settings.instrument}</strong> (${settings.tuning})</div>
        </div>
        <button class="btn-outline" onclick="StageChartUI.closeModal()">Bezárás</button>
      </div>
      <div class="chord-diagrams-wrap">
    `;

    chords.forEach(ch => {
      const isKnown = (settings.knownChords || []).includes(ch);
      html += `
        <div class="chord-box ${isKnown ? 'known' : ''}" onclick="StageChartUI.toggleKnownChord('${ch}')" title="Kattints az ismert akkordként való megjelöléshez">
          <div style="font-size:16px; font-weight:700; color:var(--chord-color); margin-bottom:4px;">${ch}</div>
          ${Theory.generateChordDiagramSVG(ch, settings.instrument, settings.leftHandedChords)}
        </div>
      `;
    });

    html += `</div>`;
    showModalHtml(html);
  }

  function showSingleChordPopup(chordName) {
    const html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3>Akkord: <span style="color:var(--chord-color);">${chordName}</span> (${settings.instrument})</h3>
        <button class="btn-outline" onclick="StageChartUI.closeModal()">Bezárás</button>
      </div>
      <div style="display:flex; justify-content:center; padding:16px;">
        <div class="chord-box" style="width:160px;">
          ${Theory.generateChordDiagramSVG(chordName, settings.instrument, settings.leftHandedChords)}
        </div>
      </div>
    `;
    showModalHtml(html);
  }

  function toggleKnownChord(ch) {
    if (!settings.knownChords) settings.knownChords = [];
    const idx = settings.knownChords.indexOf(ch);
    if (idx === -1) settings.knownChords.push(ch);
    else settings.knownChords.splice(idx, 1);
    persistAll();
    openChordDiagramsModal();
    refreshMainView(false);
  }

  function openCapoOptimizerModal() {
    closeAllDropdowns();
    const song = getCurrentSong();
    const recs = Theory.recommendCapoPositions(song.content, runtime.transposeSemitones, {
      notation: settings.notation
    });

    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3>✨ Intelligens Kápó-optimalizáló</h3>
        <button class="btn-outline" onclick="StageChartUI.closeModal()">Bezárás</button>
      </div>
      <p style="font-size:13.5px; color:var(--text-muted); margin-bottom:14px;">
        A dal harmóniái alapján ezekkel a kápó-pozíciókkal játszhatod le a legkönnyebb nyitott akkordokkal:
      </p>
      <div style="display:flex; flex-direction:column; gap:10px;">
    `;

    recs.forEach((r, i) => {
      html += `
        <div style="padding:12px 16px; border:1px solid var(--border); border-radius:10px; display:flex; justify-content:space-between; align-items:center; background:var(--bg-sidebar);">
          <div>
            <strong>${i === 0 ? '🏆 Ajánlott: ' : ''}Kápó ${r.capo}. bund</strong>
            <div style="font-size:12.5px; color:var(--text-muted); margin-top:3px;">Fogott akkordok: <strong>${r.chords.join(', ')}</strong></div>
          </div>
          <button class="btn-primary" onclick="StageChartUI.setCapo(${r.capo}); StageChartUI.closeModal();">Kiválasztás</button>
        </div>
      `;
    });

    html += `</div>`;
    showModalHtml(html);
  }

  function openVocalRangeModal() {
    closeAllDropdowns();
    const html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3>🎤 Énekes Hangterjedelem & Kvartkör Segéd</h3>
        <button class="btn-outline" onclick="StageChartUI.closeModal()">Bezárás</button>
      </div>
      <p style="font-size:13.5px; color:var(--text-muted); margin-bottom:14px;">
        Gyors hangnem-igazítás az énekes hangfajához az eredeti hangnemhez képest:
      </p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <button class="btn-outline" onclick="StageChartUI.stepTranspose(-3); StageChartUI.closeModal();">Kis terc le (−3 félhang)</button>
        <button class="btn-outline" onclick="StageChartUI.stepTranspose(3); StageChartUI.closeModal();">Kis terc fel (+3 félhang)</button>
        <button class="btn-outline" onclick="StageChartUI.stepTranspose(-5); StageChartUI.closeModal();">Kvart le / Női ↔ Férfi (−5)</button>
        <button class="btn-outline" onclick="StageChartUI.stepTranspose(5); StageChartUI.closeModal();">Kvart fel / Férfi ↔ Női (+5)</button>
        <button class="btn-outline" onclick="StageChartUI.stepTranspose(-2); StageChartUI.closeModal();">Egész hang le (−2 félhang)</button>
        <button class="btn-outline" onclick="StageChartUI.stepTranspose(2); StageChartUI.closeModal();">Egész hang fel (+2 félhang)</button>
      </div>
    `;
    showModalHtml(html);
  }

  function openTunerModal() {
    closeAllDropdowns();
    const html = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>Kromatikus Hangoló (Mikrofon & 440 Hz)</h3>
        <button class="btn-outline" onclick="StageChartAudio.stopMicTuner(); StageChartUI.closeModal();">Bezárás</button>
      </div>
      <div style="text-align:center; padding:26px 0;">
        <div id="tunerNoteDisplay" style="font-size:56px; font-weight:800; color:var(--accent);">A</div>
        <div id="tunerFreqDisplay" style="font-size:15px; color:var(--text-muted); margin-top:4px;">440.0 Hz (0 cent)</div>
        <div style="display:flex; justify-content:center; gap:10px; margin-top:20px; flex-wrap:wrap;">
          <button class="btn-primary" onclick="StageChartUI.activateMicTuner()">🎤 Mikrofonos mérés indítása</button>
          <button class="btn-outline" onclick="StageChartAudio.playReferenceTone(440, 2.5)">🔊 440 Hz (A4) referencia</button>
        </div>
      </div>
    `;
    showModalHtml(html);
  }

  async function activateMicTuner() {
    const scale = settings.notation === 'hu' ? Theory.SCALE_HU_SHARP : Theory.SCALE_EN_SHARP;
    const ok = await AudioEngine.startMicTuner(({ freq, pc, cents }) => {
      const nEl = document.getElementById('tunerNoteDisplay');
      const fEl = document.getElementById('tunerFreqDisplay');
      if (nEl && fEl) {
        nEl.textContent = scale[pc];
        const sign = cents > 0 ? '+' : '';
        fEl.textContent = `${freq} Hz (${sign}${cents} cent)`;
        nEl.style.color = Math.abs(cents) <= 6 ? '#10b981' : 'var(--accent)';
      }
    });
    if (!ok) {
      alert('Mikrofon hozzáférés szükséges a hangolóhoz.');
    }
  }

  function openStageToolsModal() {
    closeAllDropdowns();
    const tr = AudioEngine.getTrainerConfig();
    const gig = StageTools.getGigClockStatus();
    const totalCalc = StageTools.calculateSetlistTotalDuration(songs);

    const html = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:16px;">
        <h3>🎛 Színpadi & Próbatermi Okos Eszközök</h3>
        <button class="btn-outline" onclick="StageChartUI.closeModal()">Bezárás</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:18px;">
        <!-- 1. KONCERT IDŐZÍTŐ (GIG CLOCK) -->
        <div class="format-block">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>⏱ Koncert Időzítő (Gig Clock) & Műsoridő</strong>
            <span style="font-size:12px; color:var(--text-muted);">Daltár összidő: ${totalCalc.formatted}</span>
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <input type="number" id="gigMinutesInput" value="45" style="width:70px; padding:6px; border:1px solid var(--border); border-radius:6px; background:var(--bg-card); color:var(--text-main);">
            <span style="font-size:13px;">perc</span>
            <button class="btn-primary" onclick="StageChartUI.startGigTimerFromModal()">Visszaszámlálás indítása</button>
            <button class="btn-outline" onclick="StageChartStageTools.stopGigClock(); document.getElementById('gigClockPill').classList.remove('active');">Leállítás</button>
          </div>
        </div>

        <!-- 2. TEMPÓ-GYORSÍTÓ EDZŐ (TRAINER MODE) -->
        <div class="format-block">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>🚀 Tempó-gyorsító edzés (Trainer Mode)</strong>
            <label class="switch">
              <input type="checkbox" ${tr.enabled ? 'checked' : ''} onchange="StageChartAudio.setTrainerConfig({ enabled: this.checked })">
              <span class="switch-slider"></span>
            </label>
          </div>
          <div style="font-size:12.5px; color:var(--text-muted);">
            Minden <strong>4 ütem</strong> után automatikusan emeli a tempót <strong>+2 BPM</strong>-mel a céltempóig (140 BPM).
          </div>
        </div>

        <!-- 3. SZÍNPADI VÉSZJELZŐ FELIRATOK (STAGE CUES) -->
        <div class="format-block">
          <strong>🚨 Színpadi Vészjelző / Gyors Üzenet (Stage Cues)</strong>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-outline" onclick="StageChartStageTools.showStageCueBanner('MÉG EGY REFRÉN!'); StageChartUI.closeModal();">Még egy Refrén!</button>
            <button class="btn-outline" onclick="StageChartStageTools.showStageCueBanner('SZÓLÓ UTÁN VÉGE!'); StageChartUI.closeModal();">Szóló után vége!</button>
            <button class="btn-outline" onclick="StageChartStageTools.showStageCueBanner('LEÁLLÁS (STOP)!'); StageChartUI.closeModal();">Leállás!</button>
            <button class="btn-outline" onclick="StageChartStageTools.showStageCueBanner('CSAK PAD & ÉNEK'); StageChartUI.closeModal();">Csak Pad & Ének</button>
          </div>
        </div>
      </div>
    `;
    showModalHtml(html);
  }

  function startGigTimerFromModal() {
    const mins = parseInt(document.getElementById('gigMinutesInput').value, 10) || 45;
    const pill = document.getElementById('gigClockPill');
    pill.classList.add('active');
    StageTools.startGigClock(mins, (status) => {
      pill.textContent = status.formatted;
      pill.style.backgroundColor = status.color;
    });
    closeModal();
  }

  function promptStageCue() {
    const msg = prompt('Milyen színpadi jelzést írjunk ki nagyban a kijelzőre?', 'MÉG EGY REFRÉN!');
    if (msg && msg.trim()) {
      StageTools.showStageCueBanner(msg.trim());
    }
  }

  async function handleQuickMemo() {
    const btn = document.getElementById('btnQuickMemo');
    const recording = await AudioEngine.toggleQuickMemoRecording((dataUrl) => {
      const song = getCurrentSong();
      song.audioMemo = dataUrl;
      persistAll();
      btn.textContent = '🎙 Hangjegyzet';
      refreshMainView(false);
    });
    if (recording) {
      btn.textContent = '⏹ Felvétel leállítása...';
    }
  }

  function playSavedMemo() {
    const song = getCurrentSong();
    if (!song.audioMemo) return;
    const audio = new Audio(song.audioMemo);
    audio.play();
  }

  function showModalHtml(html) {
    document.getElementById('modalContent').innerHTML = html;
    document.getElementById('modalBackdrop').classList.add('open');
  }

  function closeModal() {
    AudioEngine.stopMicTuner();
    document.getElementById('modalBackdrop').classList.remove('open');
  }

  /********************************************************************
   * 10. EXPORTÁLÁS, FAGYÁSMENTES IMPORTÁLÁS (.cho, .txt, .json, .pdf, fotó, Setlista)
   *     ÉS PDF / FOTÓZOTT KOTTA ÁTALAKÍTÁSA SZERKESZTHETŐ ÉNEKKÉ
   ********************************************************************/
  function exportCurrentSong(ext) {
    closeAllDropdowns();
    const song = getCurrentSong();
    if (!song) return;

    if (ext === 'sbp') {
      const blob = createSbpArchiveBlob([song], []);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${song.title.replace(/\s+/g, '_')}.sbp`;
      a.click();
      return;
    }

    const dataStr = ext === 'cho'
      ? `{title: ${song.title}}\n{artist: ${song.artist || ''}}\n{key: ${song.key || 'D'}}\n{tempo: ${song.bpm || 90}}\n\n${Theory.convertOverToChordPro(song.content)}`
      : JSON.stringify(song, null, 2);

    const blob = new Blob([dataStr], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${song.title.replace(/\s+/g, '_')}.${ext}`;
    a.click();
  }

  async function shareCurrentSong(ext = 'sbp') {
    closeAllDropdowns();
    const song = getCurrentSong();
    if (!song) return;
    const fileName = `${song.title.replace(/\s+/g, '_')}.${ext}`;
    const blob = ext === 'sbp'
      ? createSbpArchiveBlob([song], [])
      : new Blob([`{title: ${song.title}}\n{artist: ${song.artist || ''}}\n{key: ${song.key || 'D'}}\n{tempo: ${song.bpm || 90}}\n\n${Theory.convertOverToChordPro(song.content)}`], { type: 'text/plain;charset=utf-8' });

    if (navigator.canShare && navigator.share) {
      try {
        const fileObj = new File([blob], fileName, { type: 'application/octet-stream' });
        if (navigator.canShare({ files: [fileObj] })) {
          await navigator.share({ title: song.title, files: [fileObj] });
          return;
        }
      } catch (e) {}
    }
    exportCurrentSong(ext);
  }

  function triggerSongImport(intoActiveSetlist = false) {
    if (!guardTrialLimit()) return;
    closeAllDropdowns();
    closeSidebarPopups();
    runtime.importIntoActiveSetlist = !!intoActiveSetlist;
    const inp = document.getElementById('hiddenSongFileInput');
    if (inp) {
      inp.value = '';
      inp.click();
    }
  }

  function triggerSetlistImport() {
    if (!guardTrialLimit()) return;
    closeAllDropdowns();
    closeSidebarPopups();
    const inp = document.getElementById('hiddenSetlistFileInput');
    if (inp) {
      inp.value = '';
      inp.click();
    }
  }

  /**
   * FAGYÁSMENTES BEHÚZÓ (DRAG & DROP) ÉS SONGBOOKPRO (.sbpbackup / .sbp) IMPORTÁLÓ ABLAK
   * Teljesen megkerüli a Windows 11 lassú "Letöltések" tallózó ablakát!
   */
  function openSmartImportModal(intoActiveSetlist = false) {
    if (!guardTrialLimit()) return;
    closeAllDropdowns();
    closeSidebarPopups();
    runtime.importIntoActiveSetlist = !!intoActiveSetlist;

    const html = `
      <div style="max-width:560px; margin:0 auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:10px; margin-bottom:14px;">
          <div>
            <h3>📂 Gyors Importálás (PDF, Fotó, Kotta, SongbookPro .sbpbackup)</h3>
            <div style="font-size:12px; color:var(--text-muted);">Húzd ide a fájlokat közvetlenül (a Windows tallózó megnyitása nélkül, 0 mp alatt!)</div>
          </div>
          <button class="btn-outline" onclick="StageChartUI.closeModal()">Bezárás</button>
        </div>

        <!-- 1. DRAG & DROP ZÓNA (Nem nyitja meg a Windows Letöltések ablakot, így SOHA nem fagy le!) -->
        <div class="import-dropzone" id="smartImportDropzone">
          <div style="font-size:34px; margin-bottom:6px;">📥</div>
          <div style="font-size:16px; font-weight:700; color:var(--accent); margin-bottom:4px;">
            Fogd meg a fájlt bármelyik mappádban vagy az Asztalon, és húzd ide!
          </div>
          <div style="font-size:12.5px; color:var(--text-muted); line-height:1.5;">
            Támogatott formátumok:<br>
            • <strong>SongbookPro teljes mentés:</strong> <code>.sbpbackup</code>, <code>.sbp</code> (több száz ének + listák egyszerre!)<br>
            • <strong>Dokumentumok és fotózott kották:</strong> <code>.pdf</code>, <code>.jpg</code>, <code>.png</code>, <code>.webp</code><br>
            • <strong>Szöveges kották és listák:</strong> <code>.cho</code>, <code>.crd</code>, <code>.txt</code>, <code>.json</code>
          </div>
        </div>

        <!-- 2. KÖZVETLEN BETÖLTÉS A STAGECHART/KOTTAK/ MAPPÁBÓL (TALLÓZÓ NÉLKÜL) -->
        <div class="format-block" style="margin-top:14px; padding:12px 14px;">
          <div style="font-size:13px; font-weight:600;">⚡ Vagy másold be a fájlt a <code>StageChart/kottak/</code> mappába, és írd be a nevét:</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="text" id="directKottakFileName" placeholder="pl. kotta.pdf, kep.jpg vagy mentes.sbpbackup" style="flex:1; padding:7px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg-card); color:var(--text-main); font-size:13px;">
            <button class="btn-primary" onclick="StageChartUI.loadFileDirectlyFromKottakFolder()">Betöltés</button>
          </div>
        </div>

        <!-- 3. HAGYOMÁNYOS TALLÓZÁS GOMB (Szűrő nélkül, gyorsított) -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; padding-top:10px; border-top:1px solid var(--border);">
          <span style="font-size:12px; color:var(--text-muted);">Ha mégis a Windows fájlválasztót használnád:</span>
          <button class="btn-outline" onclick="StageChartUI.triggerSongImport(${!!intoActiveSetlist})">📁 Windows Tallózás megnyitása...</button>
        </div>
      </div>
    `;

    showModalHtml(html);

    const dz = document.getElementById('smartImportDropzone');
    if (dz) {
      dz.addEventListener('dragover', (e) => {
        e.preventDefault();
        dz.classList.add('drag-over');
      });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
      dz.addEventListener('drop', async (e) => {
        e.preventDefault();
        dz.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          closeModal();
          await processImportedFilesList(Array.from(e.dataTransfer.files));
        }
      });
      dz.onclick = () => triggerSongImport(intoActiveSetlist);
    }
  }

  async function loadFileDirectlyFromKottakFolder() {
    const inp = document.getElementById('directKottakFileName');
    const name = inp ? inp.value.trim() : '';
    if (!name) {
      alert('Írd be a StageChart/kottak/ mappába másolt fájl nevét (pl. dal.pdf vagy mentes.sbpbackup)!');
      return;
    }
    try {
      const resp = await fetch(`kottak/${encodeURIComponent(name)}`);
      if (!resp.ok) throw new Error('A fájl nem található');
      const blob = await resp.blob();
      const fileObj = new File([blob], name, { type: blob.type });
      closeModal();
      await processImportedFilesList([fileObj]);
    } catch (e) {
      alert(`Nem sikerült közvetlenül betölteni a "kottak/${name}" fájlt. Kérlek húzd be a fájlt az egérrel a fenti szaggatott keretbe (Drag & Drop)!`);
    }
  }

  /**
   * SONGBOOKPRO (.sbpbackup / .sbp / .zip) TELJES KÖNYVTÁR KICSOMAGOLÓ MOTOR
   * Külső szerver nélkül, a böngésző natív DecompressionStream('deflate-raw') motorjával kicsomagolja a ZIP/SBPBACKUP fájlt,
   * és átkonvertálja az összes (akár több száz) éneket és setlistát!
   *
   * FONTOS: A SongbookPro belső adatbázisa ("dataFile") A-tól indítja a 12 félhang indexelését (0 = A, 1 = B/Bb, 2 = H/B, 3 = C, 4 = C#, 5 = D, 6 = Eb, 7 = E, 8 = F, 9 = F#, 10 = G, 11 = Ab)!
   * (Korábban C = 0 szerepelt, ami minden hangnemet +3 félhanggal eltolt, pl. az 5-ös kódú D-dúrt F-dúrra!)
   */
  const SBP_KEY_MAP_HU = ['A', 'B', 'H', 'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'Am', 'Bm', 'Hm', 'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m'];
  const SBP_KEY_MAP_EN = ['A', 'Bb', 'B', 'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'Am', 'Bbm', 'Bm', 'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m'];

  async function decompressZipSlice(compData, method) {
    if (method === 0) return compData;
    if (method === 8 && typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(compData);
      writer.close();
      const decompressedBuf = await new Response(ds.readable).arrayBuffer();
      return new Uint8Array(decompressedBuf);
    }
    return null;
  }

  /**
   * Univerzális ZIP / .sbp / .sbpbackup kicsomagoló:
   * 1. Először a ZIP Central Directory (PK\x01\x02 / PK\x05\x06) táblából olvassa ki a pontos fájlméreteket
   *    (mivel az Android/iOS/Windows SongbookPro mentések gyakran Data Descriptor bit 3-at használnak, ahol a helyi fejlécben compSize = 0!).
   * 2. Tartalékként végigfut a helyi fejléceken (PK\x03\x04) is.
   */
  async function unpackZipEntriesFromBuffer(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const entries = {};

    // 1. Megkeressük az End of Central Directory (PK\x05\x06 -> 0x06054b50) rekordot a fájl végén
    let eocdOffset = -1;
    const minSearch = Math.max(0, bytes.length - 65558);
    for (let i = bytes.length - 22; i >= minSearch; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset !== -1) {
      const totalEntries = view.getUint16(eocdOffset + 10, true);
      let cdOffset = view.getUint32(eocdOffset + 16, true);

      for (let e = 0; e < totalEntries && cdOffset + 46 <= bytes.length; e++) {
        if (view.getUint32(cdOffset, true) !== 0x02014b50) break; // Central Directory PK\x01\x02
        const method = view.getUint16(cdOffset + 10, true);
        const compSize = view.getUint32(cdOffset + 20, true);
        const nameLen = view.getUint16(cdOffset + 28, true);
        const extraLen = view.getUint16(cdOffset + 30, true);
        const commentLen = view.getUint16(cdOffset + 32, true);
        const localHeaderOffset = view.getUint32(cdOffset + 42, true);

        const fileName = new TextDecoder('utf-8').decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));

        if (!fileName.endsWith('/') && compSize > 0 && localHeaderOffset + 30 <= bytes.length) {
          const lfNameLen = view.getUint16(localHeaderOffset + 26, true);
          const lfExtraLen = view.getUint16(localHeaderOffset + 28, true);
          const dataStart = localHeaderOffset + 30 + lfNameLen + lfExtraLen;
          const compData = bytes.subarray(dataStart, dataStart + compSize);
          try {
            const out = await decompressZipSlice(compData, method);
            if (out) entries[fileName] = out;
          } catch (err) {
            console.warn('Central Directory ZIP kicsomagolási hiba:', fileName, err);
          }
        }

        cdOffset += 46 + nameLen + extraLen + commentLen;
      }
    }

    if (Object.keys(entries).length > 0) {
      return entries;
    }

    // 2. Tartalék: Helyi fejléc (PK\x03\x04) olvasása
    let offset = 0;
    while (offset + 30 <= bytes.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;

      const method = view.getUint16(offset + 8, true);
      const compSize = view.getUint32(offset + 18, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);

      const fileName = new TextDecoder('utf-8').decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
      const dataStart = offset + 30 + nameLen + extraLen;

      if (compSize > 0 && !fileName.endsWith('/')) {
        const compData = bytes.subarray(dataStart, dataStart + compSize);
        try {
          const out = await decompressZipSlice(compData, method);
          if (out) entries[fileName] = out;
        } catch (err) {
          console.warn('Local Header ZIP kicsomagolási figyelmeztetés:', fileName, err);
        }
        offset = dataStart + compSize;
      } else {
        break;
      }
    }
    return entries;
  }

  /**
   * SongbookPro "dataFile" szöveg értelmezése:
   * A SongbookPro a dataFile elejére egy verziószámot ír (pl. "1.0\n{...}"),
   * ezért levágjuk az első '{' előtti fejlécet, majd JSON.parse-oljuk!
   */
  function tryParseSongbookProDataText(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const trimmed = rawText.trim();
    try {
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return JSON.parse(trimmed);
      }
    } catch (e) {}

    // Ha "1.0\n{..." vagy egyéb SongbookPro verzió-fejléccel kezdődik:
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const jsonCandidate = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(jsonCandidate);
        if (parsed && (parsed.songs || parsed.Songs || parsed.sets || parsed.Sets || parsed.name || parsed.title || parsed.content)) {
          return parsed;
        }
      } catch (e) {}
    }
    return null;
  }

  function cleanSbpSongContent(rawContent) {
    if (!rawContent) return '';
    let txt = String(rawContent)
      // Ha kétszeresen escape-elt \r\n vagy \n maradt a szövegben, valódi sortöréssé alakítjuk
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    // Meta-tagok eltávolítása a törzsből (mivel ezek a fejlécbe kerülnek)
    txt = txt.replace(/\{(?:title|t|subtitle|st|artist|author|key|k|tempo|capo|time|duration|number|ccli|copyright|footer):[^}]*\}\n?/gi, '');

    // {soc} / {start_of_chorus} -> Chorus:
    txt = txt.replace(/\{(?:soc|start_of_chorus)(?::\s*([^}]*))?\}/gi, (_, label) => (label && label.trim()) ? `${label.trim()}:` : 'Chorus:');
    txt = txt.replace(/\{(?:eoc|end_of_chorus|sot|start_of_tab|eot|end_of_tab)\}\n?/gi, '');

    // {c: Verse 1} vagy {comment: ...} -> szakasz fejléc vagy zárójeles megjegyzés
    txt = txt.replace(/\{(?:c|comment|ci|comment_italic|cb|comment_box):\s*([^}]*)\}/gi, (_, inner) => {
      const c = (inner || '').trim();
      if (!c) return '';
      if (/^(Verse|Chorus|Bridge|Intro|Outro|Pre-Chorus|Refrén|Szóló|Interlude|Instrumental|Solo|Tag|Coda)/i.test(c)) {
        return c.endsWith(':') ? c : `${c}:`;
      }
      return c.startsWith('(') ? c : `(${c})`;
    });

    return txt.trim();
  }

  function convertSbpSongObject(rawSong, idx, pdfBlobsMap = {}, pdfMetaMap = {}) {
    const scaleMap = settings.notation === 'hu' ? SBP_KEY_MAP_HU : SBP_KEY_MAP_EN;
    let keyStr = 'D';
    let hasExplicitKey = false;
    const rawKeyVal = rawSong.key !== undefined ? rawSong.key : rawSong.Key;
    const isMinorFlag = rawSong.keyType === 1 || rawSong.KeyType === 1 || rawSong.isMinor === true;
    const rawSongShift = rawSong.keyShift ?? rawSong.KeyShift ?? rawSong.keyAdjust ?? rawSong.KeyAdjust ?? rawSong.transpose ?? rawSong.Transpose ?? 0;

    if (typeof rawKeyVal === 'number' && rawKeyVal >= 0 && scaleMap[rawKeyVal]) {
      keyStr = scaleMap[rawKeyVal];
      if (isMinorFlag && !keyStr.endsWith('m')) keyStr += 'm';
      hasExplicitKey = true;
    } else if (typeof rawKeyVal === 'string' && rawKeyVal.trim() && rawKeyVal.trim() !== '-1') {
      const numKey = parseInt(rawKeyVal.trim(), 10);
      if (!isNaN(numKey) && numKey >= 0 && scaleMap[numKey]) {
        keyStr = scaleMap[numKey];
        if (isMinorFlag && !keyStr.endsWith('m')) keyStr += 'm';
        hasExplicitKey = true;
      } else if (isNaN(numKey)) {
        keyStr = rawKeyVal.trim();
        hasExplicitKey = true;
      }
    }

    const rawContent = rawSong.content || rawSong.Content || rawSong.lyrics || rawSong.Lyrics || rawSong.text || '';

    // 1. Ha a nyers szövegben szerepel explicit {key: ...}, {k: ...} vagy "Hangnem: ..." fejléc, az a legpontosabb!
    if (rawContent) {
      const explicitKeyMatch = String(rawContent).match(/\{(?:key|k)\s*:\s*([A-GH][#b]?m?)\s*\}/i) ||
        String(rawContent).match(/(?:^|\n)\s*(?:Hangnem|Key)\s*:\s*([A-GH][#b]?m?)\b/i);
      if (explicitKeyMatch && explicitKeyMatch[1]) {
        keyStr = explicitKeyMatch[1].trim();
        hasExplicitKey = true;
      }
    }

    const cleanedContent = cleanSbpSongContent(rawContent);

    // 2. Ha a SongbookPro-ban nem volt megadva hangnem (-1), az első akkordból állapítjuk meg
    if (!hasExplicitKey && cleanedContent) {
      const extracted = Theory.extractUniqueChords(cleanedContent, 0, { notation: settings.notation });
      if (extracted.length > 0) {
        const firstChord = extracted[0].split('/')[0];
        const m = firstChord.match(/^([A-GH][#b]?m?)/);
        if (m) {
          keyStr = m[1];
          hasExplicitKey = true;
        }
      }
    }

    const sbpOrigId = rawSong.id !== undefined ? rawSong.id : rawSong.Id;
    const newId = Date.now() + idx + Math.floor(Math.random() * 1000);
    const titleStr = rawSong.name || rawSong.Name || rawSong.title || rawSong.Title || `Importált ének ${idx + 1}`;

    // Megkeressük, tartozik-e a dalhoz beágyazott PDF fájl (és abból kinyert "Hangnem: X" metaadat) a csomagban
    const candidates = [
      rawSong.file,
      rawSong.File,
      rawSong.fileName,
      rawSong.FileName,
      rawSong.pdfFile,
      rawSong.path,
      rawSong.url,
      sbpOrigId !== undefined ? String(sbpOrigId) : null,
      sbpOrigId !== undefined ? `${sbpOrigId}.pdf` : null,
      titleStr ? `${titleStr}.pdf` : null
    ].filter(Boolean);

    let matchedUrl = null;
    let matchedPdfMeta = null;
    for (const cand of candidates) {
      const shortCand = String(cand).split('/').pop();
      matchedUrl = pdfBlobsMap[cand] || pdfBlobsMap[shortCand] || pdfBlobsMap[shortCand.toLowerCase()];
      matchedPdfMeta = pdfMetaMap[cand] || pdfMetaMap[shortCand] || pdfMetaMap[shortCand.toLowerCase()];
      if (matchedUrl) break;
    }

    // Ha a beágyazott PDF fejlécében szerepelt a "Hangnem: D" (és a rekordban nem volt külön hangnem), átvesszük!
    if (!hasExplicitKey && matchedPdfMeta && matchedPdfMeta.key) {
      keyStr = matchedPdfMeta.key;
      hasExplicitKey = true;
    }

    // Ha a dal szintjén volt elmentett félhang-eltolás (keyShift / keyAdjust), alkalmazzuk
    if (typeof rawSongShift === 'number' && rawSongShift !== 0) {
      keyStr = Theory.transposeChordToken(keyStr, rawSongShift, {
        notation: settings.notation,
        accidentalsOverride: settings.accidentalsOverride
      });
    }

    const songObj = {
      id: newId,
      title: titleStr,
      altTitle: rawSong.subtitle || rawSong.Subtitle || '',
      artist: rawSong.artist || rawSong.Artist || rawSong.author || rawSong.Author || '',
      key: keyStr,
      bpm: parseInt(rawSong.tempo || rawSong.Tempo || rawSong.bpm || (matchedPdfMeta && matchedPdfMeta.bpm) || 95, 10) || 95,
      timeSig: rawSong.timeSig || rawSong.TimeSignature || (matchedPdfMeta && matchedPdfMeta.timeSig) || '4/4',
      duration: rawSong.duration || '3:30',
      format: cleanedContent.includes('[') ? 'chordpro' : 'over',
      content: cleanedContent
    };

    if (matchedPdfMeta && matchedPdfMeta.text && !songObj.content) {
      songObj.extractedDraft = matchedPdfMeta.text;
    }

    if (matchedUrl) {
      mediaBlobUrls[newId] = matchedUrl;
      songObj.pdfDataUrl = matchedUrl;
    }

    return songObj;
  }

  function isPdfBytes(uint8) {
    return uint8 && uint8.length >= 4 &&
      uint8[0] === 0x25 && uint8[1] === 0x50 && uint8[2] === 0x44 && uint8[3] === 0x46; // %PDF
  }

  async function importSbpBackupOrZipBuffer(arrayBuffer, fileName) {
    // 1. Megpróbáljuk közvetlenül SongbookPro dataFile / JSON szövegként értelmezni (ha nem ZIP tömörített)
    try {
      const text = new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer));
      const directParsed = tryParseSongbookProDataText(text);
      if (directParsed) {
        return importParsedSbpJsonData(directParsed, fileName);
      }
    } catch (e) {}

    // 2. Ha ZIP alapú .sbpbackup / .sbp archívum (PK\x03\x04 / PK\x01\x02)
    const entries = await unpackZipEntriesFromBuffer(arrayBuffer);
    const entryNames = Object.keys(entries);
    if (entryNames.length === 0) {
      alert('A kiválasztott .sbp / .sbpbackup fájl üres vagy nem sikerült kicsomagolni.');
      return null;
    }

    const pdfBlobsMap = {};
    const pdfMetaMap = {};
    let mainJsonData = null;
    let importedCount = 0;
    let lastId = runtime.currentSongId;

    // 2/A. Először kinyerjük az összes beágyazott PDF fájlt + azok metaadatait (pl. "Hangnem: D", BPM, szöveg)
    for (const name of entryNames) {
      const bytes = entries[name];
      const lower = name.toLowerCase();
      if (lower.endsWith('.pdf') || isPdfBytes(bytes)) {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const shortName = name.split('/').pop();
        const baseNoExt = shortName.replace(/\.[^.]+$/, '');
        pdfBlobsMap[name] = url;
        pdfBlobsMap[shortName] = url;
        pdfBlobsMap[shortName.toLowerCase()] = url;
        pdfBlobsMap[baseNoExt] = url;
        pdfBlobsMap[baseNoExt.toLowerCase()] = url;

        try {
          const pdfBufSlice = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          const meta = await extractStructuredSongFromPdfBuffer(pdfBufSlice);
          if (meta) {
            pdfMetaMap[name] = meta;
            pdfMetaMap[shortName] = meta;
            pdfMetaMap[shortName.toLowerCase()] = meta;
            pdfMetaMap[baseNoExt] = meta;
            pdfMetaMap[baseNoExt.toLowerCase()] = meta;
          }
        } catch (e) {}
      }
    }

    // 2/B. Megkeressük a SongbookPro adatbázist ("dataFile", "backup.json", "*.json")
    for (const name of entryNames) {
      const bytes = entries[name];
      if (isPdfBytes(bytes)) continue;
      const lower = name.toLowerCase();
      if (lower.includes('datafile') || lower.endsWith('.json') || lower.includes('backup') || !lower.includes('.')) {
        try {
          const txt = new TextDecoder('utf-8').decode(bytes);
          const parsed = tryParseSongbookProDataText(txt);
          if (parsed) {
            mainJsonData = parsed;
            break;
          }
        } catch (e) {}
      }
    }

    if (mainJsonData) {
      return importParsedSbpJsonData(mainJsonData, fileName, pdfBlobsMap, pdfMetaMap);
    }

    // 2/C. Ha nem JSON adatbázis, hanem egyedi .cho / .txt / .pdf fájlok vannak a csomagban
    for (let i = 0; i < entryNames.length; i++) {
      const name = entryNames[i];
      const bytes = entries[name];
      const lower = name.toLowerCase();
      const shortTitle = name.split('/').pop().replace(/\.[^.]+$/, '');

      if (lower.endsWith('.pdf') || isPdfBytes(bytes)) {
        const newId = Date.now() + i;
        const url = pdfBlobsMap[name];
        mediaBlobUrls[newId] = url;
        songs.push({
          id: newId,
          title: shortTitle,
          artist: 'PDF Dokumentum',
          key: 'D',
          bpm: 90,
          pdfDataUrl: url,
          content: ''
        });
        importedCount++;
        lastId = newId;
      } else if (lower.endsWith('.cho') || lower.endsWith('.txt') || lower.endsWith('.chopro') || lower.endsWith('.crd')) {
        const txt = new TextDecoder('utf-8').decode(bytes);
        const maybeSbp = tryParseSongbookProDataText(txt);
        if (maybeSbp) {
          return importParsedSbpJsonData(maybeSbp, fileName, pdfBlobsMap);
        }
        const cleaned = cleanSbpSongContent(txt);
        const newId = Date.now() + i;
        songs.push({
          id: newId,
          title: shortTitle,
          artist: '',
          key: 'D',
          bpm: 95,
          format: cleaned.includes('[') ? 'chordpro' : 'over',
          content: cleaned
        });
        importedCount++;
        lastId = newId;
      }
    }

    if (importedCount > 0) {
      runtime.currentSongId = lastId;
      persistAll();
      refreshMainView();
      StageTools.showStageCueBanner(`✓ ${importedCount} db ének sikeresen importálva a csomagból!`, 3200, false);
    }
    return lastId;
  }

  let pendingImportConflictState = null;

  function computeKeyDifferenceSemitones(fromKeyStr, toKeyStr) {
    const pc1 = Theory.noteToPitchClass((fromKeyStr || 'D').replace('m', ''), settings.notation);
    const pc2 = Theory.noteToPitchClass((toKeyStr || 'D').replace('m', ''), settings.notation);
    if (pc1 === -1 || pc2 === -1) return 0;
    return (pc2 - pc1 + 12) % 12;
  }

  function openImportConflictModal(conflicts, onResolve) {
    pendingImportConflictState = { conflicts, onResolve };
    const rowsHtml = conflicts.map((c, idx) => `
      <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; border-bottom:1px solid var(--border); cursor:pointer; font-size:13.5px;">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
          <input type="checkbox" class="conflict-overwrite-chk" data-idx="${idx}" checked style="width:17px; height:17px; accent-color:var(--accent);">
          <div style="min-width:0;">
            <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${c.incoming.title}</div>
            <div style="font-size:11.5px; color:var(--text-muted);">Meglévő hangnem: <strong>${c.existing.key || 'D'}</strong> ↔ Importált: <strong>${c.incoming.key || 'D'}</strong></div>
          </div>
        </div>
        <span style="font-size:11.5px; color:var(--accent); font-weight:600;">Felülírás</span>
      </label>
    `).join('');

    const html = `
      <div style="max-width:520px; margin:0 auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:10px; margin-bottom:12px;">
          <div>
            <h3>⚠ Már létező énekek a Daltárban (${conflicts.length} db)</h3>
            <div style="font-size:12.5px; color:var(--text-muted);">
              Válaszd ki, hogy az azonos című énekeket felülírjuk-e az importált verzióval, vagy megtartsuk a meglévőket (a Setlista hangnemei mindkét esetben megmaradnak!):
            </div>
          </div>
        </div>
        <div style="max-height:260px; overflow-y:auto; border:1px solid var(--border); border-radius:8px; background:var(--bg-sidebar); margin-bottom:14px;">
          ${rowsHtml}
        </div>
        <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
          <button class="btn-outline" onclick="StageChartUI.resolveImportConflictModal('keep_all')">Meglévők megtartása</button>
          <button class="btn-outline" onclick="StageChartUI.resolveImportConflictModal('selected')">Kijelöltek felülírása</button>
          <button class="btn-primary" onclick="StageChartUI.resolveImportConflictModal('overwrite_all')">Mindet felülír</button>
        </div>
      </div>
    `;
    showModalHtml(html);
  }

  function resolveImportConflictModal(mode) {
    if (!pendingImportConflictState) {
      closeModal();
      return;
    }
    const { conflicts, onResolve } = pendingImportConflictState;
    const overwriteSet = new Set();

    if (mode === 'overwrite_all') {
      conflicts.forEach((_, idx) => overwriteSet.add(idx));
    } else if (mode === 'selected') {
      document.querySelectorAll('.conflict-overwrite-chk').forEach(chk => {
        if (chk.checked) overwriteSet.add(parseInt(chk.dataset.idx, 10));
      });
    }
    pendingImportConflictState = null;
    closeModal();
    if (onResolve) onResolve(overwriteSet);
  }

  function importParsedSbpJsonData(data, fileName, pdfBlobsMap = {}, pdfMetaMap = {}) {
    // Ha korábban bekerült egy hibás "dataFile" nevű bejegyzés, automatikusan eltávolítjuk
    songs = songs.filter(s => s && s.title !== 'dataFile' && !String(s.content || '').trim().startsWith('1.0'));

    const attachedPdfUrls = new Set();
    const rawSongsList = data.songs || data.Songs || (Array.isArray(data) ? data : (data.name || data.title ? [data] : []));
    const preparedSongs = rawSongsList.map((rawS, idx) => {
      const converted = convertSbpSongObject(rawS, idx, pdfBlobsMap, pdfMetaMap);
      if (converted.pdfDataUrl) attachedPdfUrls.add(converted.pdfDataUrl);
      const origId = rawS.id !== undefined ? rawS.id : rawS.Id;
      return { rawS, converted, origId };
    });

    // Ellenőrizzük, van-e már azonos című ének a Daltárban
    const conflicts = [];
    preparedSongs.forEach((item, prepIdx) => {
      const normTitle = (item.converted.title || '').toLowerCase().trim();
      if (!normTitle) return;
      const existing = songs.find(s => (s.title || '').toLowerCase().trim() === normTitle);
      if (existing) {
        conflicts.push({ prepIdx, existing, incoming: item.converted });
      }
    });

    function finalizeSbpImport(overwriteConflictIndicesSet) {
      let addedSongsCount = 0;
      let addedSetsCount = 0;
      let lastSongId = runtime.currentSongId;
      const sbpIdToStageChartId = {};
      const sbpIdToIncomingKey = {};
      const titleToStageChartId = {};

      preparedSongs.forEach((item, prepIdx) => {
        const { converted, origId } = item;
        if (origId !== undefined) sbpIdToIncomingKey[String(origId)] = converted.key || 'D';

        const conflictIdx = conflicts.findIndex(c => c.prepIdx === prepIdx);
        if (conflictIdx !== -1) {
          const existingSong = conflicts[conflictIdx].existing;
          if (overwriteConflictIndicesSet && overwriteConflictIndicesSet.has(conflictIdx)) {
            // Felülírjuk a meglévő éneket, de megtartjuk az ID-ját, hogy a meglévő listák se törjenek el
            const keepId = existingSong.id;
            Object.assign(existingSong, converted, { id: keepId });
            if (mediaBlobUrls[converted.id]) {
              mediaBlobUrls[keepId] = mediaBlobUrls[converted.id];
            }
          }
          if (origId !== undefined) sbpIdToStageChartId[String(origId)] = existingSong.id;
          if (converted.title) titleToStageChartId[converted.title.toLowerCase().trim()] = existingSong.id;
          addSongIdToViewingSetlistIfRequested(existingSong.id);
          lastSongId = existingSong.id;
          addedSongsCount++;
        } else {
          if (origId !== undefined) sbpIdToStageChartId[String(origId)] = converted.id;
          if (converted.title) titleToStageChartId[converted.title.toLowerCase().trim()] = converted.id;
          songs.push(converted);
          addSongIdToViewingSetlistIfRequested(converted.id);
          lastSongId = converted.id;
          addedSongsCount++;
        }
      });

      // Ha a ZIP csomagban volt még olyan PDF fájl, amihez nem tartozott külön szöveges rekord:
      const uniquePdfEntries = [];
      const seenUrls = new Set();
      Object.entries(pdfBlobsMap).forEach(([k, url]) => {
        if (!seenUrls.has(url) && !attachedPdfUrls.has(url)) {
          seenUrls.add(url);
          uniquePdfEntries.push({ name: k, url });
        }
      });

      if (uniquePdfEntries.length > 0) {
        const emptySongsWithoutPdf = songs.filter(s => (!s.content || !s.content.trim()) && !s.pdfDataUrl);
        uniquePdfEntries.forEach((pdfEntry, idx) => {
          if (idx < emptySongsWithoutPdf.length) {
            const targetSong = emptySongsWithoutPdf[idx];
            mediaBlobUrls[targetSong.id] = pdfEntry.url;
            targetSong.pdfDataUrl = pdfEntry.url;
          } else {
            const newId = Date.now() + 5000 + idx;
            mediaBlobUrls[newId] = pdfEntry.url;
            const cleanPdfTitle = pdfEntry.name.split('/').pop().replace(/\.pdf$/i, '') || `Importált PDF ${idx + 1}`;
            songs.push({
              id: newId,
              title: cleanPdfTitle,
              artist: 'PDF Dokumentum',
              key: 'D',
              bpm: 90,
              pdfDataUrl: pdfEntry.url,
              content: ''
            });
            lastSongId = newId;
            addedSongsCount++;
          }
        });
      }

      // Setlisták (sets / setlists / setItems) importálása + dalonkénti hangnemek (songOverrides) megőrzése!
      const rawSetsList = data.sets || data.Sets || data.setlists || [];
      const topLevelSetItems = data.setItems || data.SetItems || data.set_items || [];
      const scaleMap = settings.notation === 'hu' ? SBP_KEY_MAP_HU : SBP_KEY_MAP_EN;
      let firstCreatedSet = null;

      rawSetsList.forEach((rawSet, idx) => {
        const setOrigId = rawSet.id !== undefined ? rawSet.id : rawSet.Id;
        let rawItems = rawSet.contents || rawSet.Contents || rawSet.items || rawSet.Items || rawSet.songIds || rawSet.songs || [];

        if ((!rawItems || rawItems.length === 0) && setOrigId !== undefined && Array.isArray(topLevelSetItems)) {
          rawItems = topLevelSetItems
            .filter(it => String(it.setId ?? it.SetId ?? it.set_id) === String(setOrigId))
            .sort((a, b) => (a.order ?? a.Order ?? 0) - (b.order ?? b.Order ?? 0));
        }

        const songOverrides = { ...(rawSet.songOverrides || {}) };
        const mappedSongIds = rawItems.map(item => {
          let targetStageId = null;
          let itemOrigId = null;

          if (typeof item === 'number' || typeof item === 'string') {
            itemOrigId = String(item);
            targetStageId = sbpIdToStageChartId[itemOrigId] || titleToStageChartId[itemOrigId.toLowerCase().trim()] || null;
          } else if (item && typeof item === 'object') {
            const refId = item.songId ?? item.SongId ?? item.song_id ?? item.id ?? item.Id;
            if (refId !== undefined) {
              itemOrigId = String(refId);
              if (sbpIdToStageChartId[itemOrigId]) targetStageId = sbpIdToStageChartId[itemOrigId];
            }
            if (!targetStageId) {
              const refTitle = item.name || item.Name || item.title || item.Title;
              if (refTitle && titleToStageChartId[String(refTitle).toLowerCase().trim()]) {
                targetStageId = titleToStageChartId[String(refTitle).toLowerCase().trim()];
              }
            }
          }

          if (targetStageId) {
            const libSong = songs.find(s => s.id === targetStageId);
            let trSemi = 0;
            let capoVal = 0;

            // Ha a meglévő éneket megtartottuk, de az importált csomagban a dal más alap-hangnemben volt:
            if (libSong && itemOrigId && sbpIdToIncomingKey[itemOrigId]) {
              trSemi = computeKeyDifferenceSemitones(libSong.key, sbpIdToIncomingKey[itemOrigId]);
            }

            if (item && typeof item === 'object') {
              if (typeof item.transposeSemitones === 'number') {
                trSemi = (trSemi + item.transposeSemitones + 12) % 12;
              } else if (typeof (item.keyAdjustment ?? item.KeyAdjustment ?? item.keyAdjust ?? item.KeyAdjust ?? item.keyShift ?? item.KeyShift ?? item.transpose ?? item.Transpose) === 'number') {
                const adj = item.keyAdjustment ?? item.KeyAdjustment ?? item.keyAdjust ?? item.KeyAdjust ?? item.keyShift ?? item.KeyShift ?? item.transpose ?? item.Transpose;
                trSemi = (trSemi + adj + 120) % 12;
              } else if (item.key !== undefined && item.key !== null && item.key !== -1 && libSong) {
                let targetKeyStr = null;
                if (typeof item.key === 'number' && item.key >= 0 && scaleMap[item.key]) targetKeyStr = scaleMap[item.key];
                else if (typeof item.key === 'string' && item.key.trim() && item.key.trim() !== '-1') targetKeyStr = item.key.trim();
                if (targetKeyStr) trSemi = computeKeyDifferenceSemitones(libSong.key, targetKeyStr);
              }
              if (typeof (item.capo ?? item.Capo) === 'number' && (item.capo ?? item.Capo) > 0) {
                capoVal = item.capo ?? item.Capo;
              }
            }

            if (trSemi !== 0 || capoVal !== 0) {
              songOverrides[String(targetStageId)] = { transposeSemitones: trSemi, capo: capoVal };
            }
          }

          return targetStageId;
        }).filter(Boolean);

        let setDate = new Date().toISOString().slice(0, 10);
        const rawDate = rawSet.date || rawSet.Date || rawSet.modified || rawSet.created;
        if (typeof rawDate === 'number' && rawDate > 100000) {
          const ms = rawDate < 10000000000 ? rawDate * 1000 : rawDate;
          const dObj = new Date(ms);
          if (!isNaN(dObj.getTime())) setDate = dObj.toISOString().slice(0, 10);
        } else if (typeof rawDate === 'string' && rawDate.length >= 10) {
          setDate = rawDate.slice(0, 10);
        }

        const newSetObj = {
          id: 'set_' + (Date.now() + idx),
          name: rawSet.name || rawSet.Name || `Importált lista ${idx + 1}`,
          date: setDate,
          targetMinutes: 45,
          songIds: mappedSongIds,
          songOverrides
        };
        setlists.unshift(newSetObj);
        if (idx === 0) {
          firstCreatedSet = newSetObj;
        }
        addedSetsCount++;
      });

      if (firstCreatedSet) {
        runtime.sidebarTab = 'setlists';
        runtime.viewingSetlistId = firstCreatedSet.id;
        runtime.activeSetlistId = firstCreatedSet.id;
        document.getElementById('sideTabSongs').classList.remove('active');
        document.getElementById('sideTabSetlists').classList.add('active');
        toggleSidebar(true);
        if (firstCreatedSet.songIds.length > 0) {
          lastSongId = firstCreatedSet.songIds[0];
          selectSongById(lastSongId);
        }
      }

      if (addedSongsCount > 0 || addedSetsCount > 0) {
        if (!firstCreatedSet) {
          runtime.currentSongId = lastSongId;
        }
        persistAll();
        refreshMainView();
        StageTools.showStageCueBanner(
          `✓ Importálás kész: ${addedSongsCount} ének${addedSetsCount > 0 ? ' és ' + addedSetsCount + ' lista' : ''} betöltve!`,
          3800,
          false
        );
      }
      return lastSongId;
    }

    if (conflicts.length > 0) {
      openImportConflictModal(conflicts, (overwriteSet) => {
        finalizeSbpImport(overwriteSet);
      });
      return runtime.currentSongId;
    }

    return finalizeSbpImport(new Set());
  }

  function addSongIdToViewingSetlistIfRequested(songId) {
    if (!runtime.importIntoActiveSetlist) return;
    const targetSetId = runtime.viewingSetlistId || runtime.activeSetlistId;
    if (!targetSetId) return;
    const list = setlists.find(l => l.id === targetSetId);
    if (list && Array.isArray(list.songIds) && !list.songIds.includes(songId)) {
      list.songIds.push(songId);
    }
  }

  /**
   * Koordináta-tudatos (X, Y) PDF szöveg-, szakasz- és akkordkinyerő motor:
   * 1. Ha elérhető a Mozilla PDF.js (pdfjsLib), pontos (X, Y) koordinátákkal olvassa ki az összes sort és az akkordok szótagok feletti vízszintes pozícióját!
   * 2. Tartalékként a böngésző natív DecompressionStream('deflate') motorjával kicsomagolja a FlateDecode PDF streameket és ToUnicode CMap táblákat.
   */
  function reconstructSongFromPositionedItems(items) {
    if (!items || !items.length) return null;

    // Sorokba rendezés Y koordináta szerint (fentről lefelé, 4pt tűréssel)
    const cleanItems = items
      .filter(it => it && typeof it.str === 'string' && it.str.trim().length > 0)
      .map(it => ({
        str: it.str,
        x: Number(it.x) || 0,
        y: Number(it.y) || 0,
        h: Number(it.h) || 11
      }));

    if (!cleanItems.length) return null;

    cleanItems.sort((a, b) => b.y - a.y || a.x - b.x);

    const rows = [];
    for (const item of cleanItems) {
      let row = rows.find(r => Math.abs(r.y - item.y) <= 4.2);
      if (!row) {
        row = { y: item.y, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    }

    rows.sort((a, b) => b.y - a.y);
    rows.forEach(r => r.items.sort((a, b) => a.x - b.x));

    let detectedKey = null;
    let detectedBpm = null;
    let detectedTimeSig = null;
    let detectedTitle = null;

    // Bal margó (minX) meghatározása a dalszöveg/akkord sorokból
    const bodyXValues = [];
    rows.forEach(r => {
      const joined = r.items.map(i => i.str).join(' ').trim();
      if (!joined) return;
      if (/^(Hangnem|Key|Ütem|Time|\d+\s*BPM)/i.test(joined)) return;
      if (r.items[0].x < 250) bodyXValues.push(r.items[0].x);
    });
    const minX = bodyXValues.length ? Math.min(...bodyXValues) : 36;

    const outLines = [];
    rows.forEach((r, rowIdx) => {
      // Kiszűrjük a jobb felső sarokban lévő metaadatokat (pl. "Hangnem: D", "110 BPM", "Ütem: 4/4")
      const bodyRowItems = [];
      for (const it of r.items) {
        const s = it.str.trim();
        const keyM = s.match(/^(?:Hangnem|Key)\s*:\s*([A-GH][#b]?m?)/i);
        if (keyM) {
          detectedKey = keyM[1];
          continue;
        }
        const bpmM = s.match(/^(\d{2,3})\s*BPM/i);
        if (bpmM) {
          detectedBpm = parseInt(bpmM[1], 10);
          continue;
        }
        const tsM = s.match(/^(?:Ütem|Time)\s*:\s*(\d+\/\d+)/i);
        if (tsM) {
          detectedTimeSig = tsM[1];
          continue;
        }
        bodyRowItems.push(it);
      }

      if (!bodyRowItems.length) return;

      // Ha a legelső sor nagy betűméretű főcím (pl. "Dicsérem én"), elmentjük címnek és nem ismételjük a kotta törzsében
      const simpleJoined = bodyRowItems.map(i => i.str.trim()).join(' ').trim();
      if (rowIdx === 0 && bodyRowItems[0].h >= 16 && !Theory.isChordLine(simpleJoined)) {
        detectedTitle = simpleJoined;
        return;
      }

      // Karakter-szélesség becslése az adott sorhoz (hogy az akkordok pontosan a szótagok fölé kerüljenek!)
      const avgFontH = bodyRowItems.reduce((acc, i) => acc + (i.h || 11), 0) / bodyRowItems.length;
      const charW = Math.max(4.5, avgFontH * 0.52);

      let lineStr = '';
      let currentCol = 0;

      bodyRowItems.forEach((it, idx) => {
        const targetCol = Math.max(0, Math.round((it.x - minX) / charW));
        if (idx === 0) {
          // Ha a sor beljebb kezdődik (pl. szöveg feletti akkordsor: "      D        A"), beszúrjuk a kezdő szóközöket
          if (targetCol > 0 && targetCol < 80) {
            lineStr += ' '.repeat(targetCol);
            currentCol = targetCol;
          }
        } else {
          const gapCols = targetCol - currentCol;
          if (gapCols > 1 && gapCols < 65) {
            lineStr += ' '.repeat(gapCols);
            currentCol += gapCols;
          } else if (lineStr.length > 0 && !lineStr.endsWith(' ')) {
            lineStr += ' ';
            currentCol += 1;
          }
        }
        lineStr += it.str;
        currentCol += it.str.length;
      });

      const trimmedLine = lineStr.trim();
      if (!trimmedLine) return;

      // Szakasz fejlécek egységesítése (pl. "Verse1" -> "Verse 1:", "Chorus" -> "Chorus:", "Vamp" -> "Vamp:")
      if (/^(Verse|Chorus|Bridge|Intro|Outro|Pre-Chorus|Refrén|Szóló|Interlude|Instrumental|Solo|Tag|Coda|Vamp)\s*\d*:?$/i.test(trimmedLine)) {
        const normalizedSec = trimmedLine
          .replace(/^(Verse|Chorus|Bridge|Refrén)(\d+)$/i, '$1 $2')
          .replace(/:$/, '') + ':';
        if (outLines.length > 0 && outLines[outLines.length - 1] !== '') {
          outLines.push('');
        }
        outLines.push(normalizedSec);
        return;
      }

      // Ha nem akkordsor, a felesleges bal oldali behúzást levágjuk, az akkordsoroknál viszont megtartjuk a pontos szótag-pozíciót!
      if (Theory.isChordLine(trimmedLine)) {
        outLines.push(lineStr.replace(/\s+$/, ''));
      } else {
        outLines.push(trimmedLine);
      }
    });

    return {
      text: outLines.join('\n').trim(),
      title: detectedTitle,
      key: detectedKey,
      bpm: detectedBpm,
      timeSig: detectedTimeSig
    };
  }

  async function extractStructuredSongFromPdfBuffer(arrayBuffer) {
    // 1. Elsődleges motor: Mozilla PDF.js (ha betöltődött)
    if (window.pdfjsLib) {
      try {
        if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        const copyBuf = arrayBuffer.slice(0);
        const loadingTask = window.pdfjsLib.getDocument({ data: copyBuf });
        const pdfDoc = await loadingTask.promise;
        const allPageResults = [];
        let metaKey = null, metaBpm = null, metaTimeSig = null, metaTitle = null;

        for (let p = 1; p <= pdfDoc.numPages; p++) {
          const page = await pdfDoc.getPage(p);
          const textContent = await page.getTextContent();
          const pageItems = (textContent.items || []).map(it => ({
            str: it.str,
            x: it.transform ? it.transform[4] : 0,
            y: it.transform ? it.transform[5] : 0,
            h: it.transform ? Math.hypot(it.transform[0], it.transform[1]) : 11
          }));
          const rec = reconstructSongFromPositionedItems(pageItems);
          if (rec && rec.text) {
            allPageResults.push(rec.text);
            if (!metaKey && rec.key) metaKey = rec.key;
            if (!metaBpm && rec.bpm) metaBpm = rec.bpm;
            if (!metaTimeSig && rec.timeSig) metaTimeSig = rec.timeSig;
            if (!metaTitle && rec.title) metaTitle = rec.title;
          }
        }

        if (allPageResults.length > 0) {
          return {
            text: allPageResults.join('\n\n'),
            title: metaTitle,
            key: metaKey,
            bpm: metaBpm,
            timeSig: metaTimeSig
          };
        }

        // Ha a PDF szkennelt kép (nincs benne szöveges réteg) és elérhető a Tesseract OCR, lerendereljük az 1. oldalt vászonra és OCR-ezzük!
        if (window.Tesseract && pdfDoc.numPages >= 1) {
          const page = await pdfDoc.getPage(1);
          const viewport = page.getViewport({ scale: 2.0 });
          const offCanvas = document.createElement('canvas');
          offCanvas.width = viewport.width;
          offCanvas.height = viewport.height;
          await page.render({ canvasContext: offCanvas.getContext('2d'), viewport }).promise;
          const ocrRes = await window.Tesseract.recognize(offCanvas, 'hun+eng');
          if (ocrRes && ocrRes.data && ocrRes.data.text && ocrRes.data.text.trim()) {
            return { text: ocrRes.data.text.trim() };
          }
        }
      } catch (pdfJsErr) {
        console.warn('PDF.js kinyerési figyelmeztetés, váltás beépített motorra:', pdfJsErr);
      }
    }

    // 2. Offline tartalék motor: Natív DecompressionStream('deflate') FlateDecode PDF stream kicsomagolás
    try {
      const bytes = new Uint8Array(arrayBuffer);
      const rawLatin = new TextDecoder('latin1').decode(bytes);
      const positionedItems = [];

      const streamRegex = /stream\r?\n/g;
      let match;
      while ((match = streamRegex.exec(rawLatin)) !== null) {
        const startIdx = match.index + match[0].length;
        const endIdx = rawLatin.indexOf('endstream', startIdx);
        if (endIdx === -1) break;
        let sliceEnd = endIdx;
        if (bytes[sliceEnd - 1] === 0x0a) sliceEnd--;
        if (bytes[sliceEnd - 1] === 0x0d) sliceEnd--;
        const streamBytes = bytes.subarray(startIdx, sliceEnd);

        let decodedStr = '';
        if (typeof DecompressionStream !== 'undefined') {
          for (const fmt of ['deflate', 'deflate-raw']) {
            try {
              const ds = new DecompressionStream(fmt);
              const writer = ds.writable.getWriter();
              writer.write(streamBytes);
              writer.close();
              const decBuf = await new Response(ds.readable).arrayBuffer();
              decodedStr = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(decBuf));
              if (decodedStr && decodedStr.includes('BT')) break;
            } catch (e) {}
          }
        }
        if (!decodedStr) {
          decodedStr = new TextDecoder('latin1').decode(streamBytes);
        }

        if (decodedStr.includes('BT')) {
          let curX = 36, curY = 750;
          const lines = decodedStr.split(/\r?\n/);
          for (const l of lines) {
            const tm = l.match(/([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+Tm/);
            if (tm) {
              curX = parseFloat(tm[5]);
              curY = parseFloat(tm[6]);
            }
            const td = l.match(/([0-9.-]+)\s+([0-9.-]+)\s+T[dD]/);
            if (td) {
              curX += parseFloat(td[1]);
              curY += parseFloat(td[2]);
            }
            const strMatches = l.match(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g);
            if (strMatches) {
              const txt = strMatches.map(s => s.slice(1, -1).replace(/\\([()\\])/g, '$1')).join('');
              if (txt.trim()) {
                positionedItems.push({ str: txt, x: curX, y: curY, h: 11 });
              }
            }
          }
        }
      }

      if (positionedItems.length > 0) {
        const rec = reconstructSongFromPositionedItems(positionedItems);
        if (rec && rec.text) return rec;
      }
    } catch (e) {}

    return null;
  }

  async function tryExtractTextFromPdfBuffer(arrayBuffer) {
    const res = await extractStructuredSongFromPdfBuffer(arrayBuffer);
    return res ? res.text : '';
  }

  async function importSongFile(event) {
    closeAllDropdowns();
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    event.target.value = '';
    await processImportedFilesList(files);
  }

  async function processImportedFilesList(files) {
    if (!guardTrialLimit()) return;
    try {
      if (!files || !files.length) return;
      let lastAddedId = runtime.currentSongId;
      let totalImportedCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const lowerName = file.name.toLowerCase();
        const baseTitle = file.name.replace(/\.[^.]+$/, '');

        try {
          // 0. SongbookPro teljes mentés vagy egyedi dal (.sbpbackup, .sbp, .zip, vagy "dataFile")
          if (lowerName.endsWith('.sbpbackup') || lowerName.endsWith('.sbp') || lowerName.endsWith('.zip') || lowerName === 'datafile') {
            const buf = await file.arrayBuffer();
            const resId = await importSbpBackupOrZipBuffer(buf, file.name);
            if (resId) {
              lastAddedId = resId;
              totalImportedCount++;
            }
            continue;
          }

          // 1. PDF dokumentum importálása (garantált application/pdf MIME típussal, fagyásmentesen)
          if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
            const buf = await file.arrayBuffer();
            const pdfBlob = new Blob([buf], { type: 'application/pdf' });
            const blobUrl = URL.createObjectURL(pdfBlob);
            const extractedInfo = await extractStructuredSongFromPdfBuffer(buf);
            const newId = Date.now() + i;
            mediaBlobUrls[newId] = blobUrl;

            let smallDataUrl = null;
            if (file.size < 1800000) {
              smallDataUrl = await new Promise((res) => {
                const r = new FileReader();
                r.onload = (e) => res(e.target.result);
                r.readAsDataURL(pdfBlob);
              });
            }

            const newSong = {
              id: newId,
              title: (extractedInfo && extractedInfo.title) ? extractedInfo.title : baseTitle,
              artist: 'PDF Dokumentum',
              key: (extractedInfo && extractedInfo.key) ? extractedInfo.key : 'D',
              bpm: (extractedInfo && extractedInfo.bpm) ? extractedInfo.bpm : 90,
              timeSig: (extractedInfo && extractedInfo.timeSig) ? extractedInfo.timeSig : '4/4',
              pdfDataUrl: smallDataUrl || blobUrl,
              extractedDraft: (extractedInfo && extractedInfo.text) ? extractedInfo.text : '',
              content: ''
            };
            songs.push(newSong);
            addSongIdToViewingSetlistIfRequested(newId);
            lastAddedId = newId;
            totalImportedCount++;
            continue;
          }

          // 2. Lefotózott kotta (.jpg, .png, .webp) importálása
          if (/\.(jpg|jpeg|png|webp)$/i.test(lowerName)) {
            const dataUrl = await new Promise((res) => {
              const r = new FileReader();
              r.onload = (e) => res(e.target.result);
              r.readAsDataURL(file);
            });
            const newId = Date.now() + i;
            const newSong = {
              id: newId,
              title: baseTitle,
              artist: 'Fotózott kotta',
              key: 'D',
              bpm: 90,
              imageDataUrl: dataUrl,
              content: ''
            };
            songs.push(newSong);
            addSongIdToViewingSetlistIfRequested(newId);
            lastAddedId = newId;
            totalImportedCount++;
            continue;
          }

          // 3. Szöveges kotta (.cho, .crd, .chopro, .txt, .json) vagy kicsomagolt SongbookPro dataFile
          const buf = await file.arrayBuffer();
          const uint8 = new Uint8Array(buf);
          // Ha mégis ZIP fejlécű fájl (PK\x03\x04) más kiterjesztéssel:
          if (uint8.length >= 4 && uint8[0] === 0x50 && uint8[1] === 0x4b && uint8[2] === 0x03 && uint8[3] === 0x04) {
            const resId = await importSbpBackupOrZipBuffer(buf, file.name);
            if (resId) {
              lastAddedId = resId;
              totalImportedCount++;
            }
            continue;
          }
          // Ha PDF fejlécű (%PDF):
          if (isPdfBytes(uint8)) {
            const pdfBlob = new Blob([buf], { type: 'application/pdf' });
            const blobUrl = URL.createObjectURL(pdfBlob);
            const newId = Date.now() + i;
            mediaBlobUrls[newId] = blobUrl;
            songs.push({
              id: newId,
              title: baseTitle,
              artist: 'PDF Dokumentum',
              key: 'D',
              bpm: 90,
              pdfDataUrl: blobUrl,
              content: ''
            });
            addSongIdToViewingSetlistIfRequested(newId);
            lastAddedId = newId;
            totalImportedCount++;
            continue;
          }

          const text = new TextDecoder('utf-8').decode(uint8);

          // Ellenőrizzük, hogy nem SongbookPro dataFile formátumú-e (pl. "1.0\n{...}")
          const sbpParsed = tryParseSongbookProDataText(text);
          if (sbpParsed && (sbpParsed.songs || sbpParsed.Songs || sbpParsed.sets || sbpParsed.Sets)) {
            const resId = importParsedSbpJsonData(sbpParsed, file.name);
            if (resId) {
              lastAddedId = resId;
              totalImportedCount++;
            }
            continue;
          }

          if (lowerName.endsWith('.json')) {
            try {
              const parsed = JSON.parse(text);
              if (parsed.type === 'StageChart_Setlist' && parsed.setlist) {
                importParsedSbpJsonData({
                  songs: parsed.songs || [],
                  sets: [parsed.setlist]
                }, file.name);
                totalImportedCount++;
                continue;
              } else if (parsed.songs && Array.isArray(parsed.songs)) {
                importParsedSbpJsonData(parsed, file.name);
                totalImportedCount++;
                continue;
              } else if (Array.isArray(parsed)) {
                parsed.forEach((s, idx) => {
                  const sid = s.id || (Date.now() + idx);
                  s.id = sid;
                  if (!songs.some(ex => ex.id === sid)) songs.push(s);
                  addSongIdToViewingSetlistIfRequested(sid);
                  lastAddedId = sid;
                  totalImportedCount++;
                });
                continue;
              } else if (parsed.title) {
                parsed.id = Date.now() + i;
                songs.push(parsed);
                addSongIdToViewingSetlistIfRequested(parsed.id);
                lastAddedId = parsed.id;
                totalImportedCount++;
                continue;
              }
            } catch (e) {}
          }

          const titleMatch = text.match(/\{(?:title|t):\s*([^}]+)\}/i);
          const artistMatch = text.match(/\{(?:artist|subtitle|st):\s*([^}]+)\}/i);
          const keyMatch = text.match(/\{(?:key|k):\s*([^}]+)\}/i);
          const cleanedBody = cleanSbpSongContent(text);

          const newId = Date.now() + i;
          const newSong = {
            id: newId,
            title: titleMatch ? titleMatch[1].trim() : baseTitle,
            artist: artistMatch ? artistMatch[1].trim() : '',
            key: keyMatch ? keyMatch[1].trim() : 'D',
            bpm: 95,
            timeSig: '4/4',
            duration: '3:30',
            format: cleanedBody.includes('[') ? 'chordpro' : 'over',
            content: cleanedBody
          };
          songs.push(newSong);
          addSongIdToViewingSetlistIfRequested(newId);
          lastAddedId = newId;
          totalImportedCount++;
        } catch (fileErr) {
          console.error(`Hiba a(z) ${file.name} fájl feldolgozása közben:`, fileErr);
        }
      }

      runtime.importIntoActiveSetlist = false;
      runtime.currentSongId = lastAddedId;
      persistAll();
      refreshMainView();
      if (totalImportedCount > 0) {
        StageTools.showStageCueBanner(`✓ ${totalImportedCount} fájl sikeresen importálva!`, 2500, false);
      }
    } catch (globalErr) {
      console.error('Kritikus importálási hiba:', globalErr);
      alert('Hiba történt a fájl importálásakor: ' + (globalErr.message || globalErr));
    }
  }

  /**
   * Setlista (.json / .txt / .cho / .sbp / .sbpbackup) közvetlen importálása a Listák közé
   */
  async function importSetlistFile(event) {
    if (!guardTrialLimit()) {
      if (event && event.target) event.target.value = '';
      return;
    }
    closeAllDropdowns();
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    event.target.value = '';

    for (const file of files) {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.sbpbackup') || lowerName.endsWith('.sbp') || lowerName.endsWith('.zip')) {
        const buf = await file.arrayBuffer();
        await importSbpBackupOrZipBuffer(buf, file.name);
        switchSidebarTab('setlists');
        toggleSidebar(true);
        continue;
      }
      const text = await file.text();
      const sbpData = tryParseSongbookProDataText(text);
      if (sbpData && (sbpData.sets || sbpData.Sets || sbpData.songs || sbpData.Songs)) {
        importParsedSbpJsonData(sbpData, file.name);
        switchSidebarTab('setlists');
        toggleSidebar(true);
        continue;
      }
      const baseName = file.name.replace(/\.[^.]+$/, '');
      try {
        const data = JSON.parse(text);
        if (data.type === 'StageChart_Setlist' && data.setlist) {
          importParsedSbpJsonData({
            songs: data.songs || [],
            sets: [data.setlist]
          }, file.name);
        } else if (data.setlists && Array.isArray(data.setlists)) {
          importParsedSbpJsonData({
            songs: data.songs || [],
            sets: data.setlists
          }, file.name);
        } else if (Array.isArray(data)) {
          const addedIds = [];
          data.forEach((s, idx) => {
            const sid = s.id || (Date.now() + idx);
            s.id = sid;
            if (!songs.some(ex => ex.id === sid)) songs.push(s);
            addedIds.push(sid);
          });
          const newList = {
            id: 'set_' + Date.now(),
            name: baseName,
            date: new Date().toISOString().slice(0, 10),
            targetMinutes: 45,
            songIds: addedIds
          };
          setlists.unshift(newList);
          runtime.viewingSetlistId = newList.id;
          runtime.activeSetlistId = newList.id;
        }
      } catch (e) {
        // Ha sima szöveges lista (soronként egy dalcím), megkeressük vagy létrehozzuk a listát
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const matchedIds = [];
        lines.forEach(lineTitle => {
          const found = songs.find(s => s.title.toLowerCase() === lineTitle.toLowerCase());
          if (found) matchedIds.push(found.id);
        });
        const newList = {
          id: 'set_' + Date.now(),
          name: baseName,
          date: new Date().toISOString().slice(0, 10),
          targetMinutes: 45,
          songIds: matchedIds
        };
        setlists.unshift(newList);
        runtime.viewingSetlistId = newList.id;
        runtime.activeSetlistId = newList.id;
      }
    }

    persistAll();
    switchSidebarTab('setlists');
    toggleSidebar(true);
    StageTools.showStageCueBanner('✓ Setlista sikeresen importálva!', 2200, false);
  }

  /**
   * Kép előfeldolgozása (2x felnagyítás + adaptív szürkeárnyalatos kontraszt-élesítés) a sokkal pontosabb OCR akkord- és szövegfelismeréshez
   */
  async function preprocessImageForOcr(imgSrc) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const minTargetW = 1800;
          const scale = img.width < minTargetW ? Math.min(2.5, minTargetW / Math.max(1, img.width)) : 1;
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const off = document.createElement('canvas');
          off.width = w;
          off.height = h;
          const c = off.getContext('2d');
          c.fillStyle = '#ffffff';
          c.fillRect(0, 0, w, h);
          c.drawImage(img, 0, 0, w, h);

          const imgData = c.getImageData(0, 0, w, h);
          const d = imgData.data;

          // Átlagos fényerő meghatározása (hogy sötét módban készült képernyőfotót is felismerjen!)
          let lumSum = 0;
          const sampleStep = 16;
          let count = 0;
          for (let i = 0; i < d.length; i += 4 * sampleStep) {
            lumSum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            count++;
          }
          const avgLum = count > 0 ? lumSum / count : 200;
          const isDarkBg = avgLum < 115;

          for (let i = 0; i < d.length; i += 4) {
            let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            if (isDarkBg) gray = 255 - gray;
            // Kontraszt nyújtás: a világos hátteret tiszta fehérre (255), a betűket sötétre húzzuk
            let stretched = (gray - 155) * 2.1 + 155;
            if (stretched > 232) stretched = 255;
            if (stretched < 45) stretched = 0;
            d[i] = d[i + 1] = d[i + 2] = stretched;
          }
          c.putImageData(imgData, 0, 0);
          resolve(off);
        } catch (err) {
          resolve(imgSrc);
        }
      };
      img.onerror = () => resolve(imgSrc);
      img.src = imgSrc;
    });
  }

  /**
   * OCR által gyakran eltévesztett akkord-karakterek javítása (pl. "Hrn" -> "Hm", "F#rn" -> "F#m", "0" -> "D")
   */
  function cleanOcrChordLineTypos(text) {
    if (!text) return '';
    return text.split('\n').map(line => {
      let fixed = line
        .replace(/\b([A-GH][#b]?)rn\b/g, '$1m')
        .replace(/\b([A-GH][#b]?)m7\b/g, '$1m7')
        .replace(/\b0(?=\s+[A-GH]|\s*$)/g, 'D');
      return fixed;
    }).join('\n');
  }

  /**
   * Segédfüggvény: bármilyen PDF (DataURL vagy BlobURL) vagy Fotó (JPG/PNG) automatikus szöveg- és akkordfelismerése
   */
  async function extractMediaSongDraftOnDemand(song, onStatusUpdate) {
    if (!song) return null;
    if (song.extractedDraft && song.extractedDraft.trim().length > 10) {
      return {
        text: song.extractedDraft,
        key: song.key,
        bpm: song.bpm,
        timeSig: song.timeSig,
        title: song.title
      };
    }

    const pdfSrc = mediaBlobUrls[song.id] || song.pdfDataUrl;
    const imgSrc = song.imageDataUrl;

    if (pdfSrc) {
      if (onStatusUpdate) onStatusUpdate('⏳ PDF szöveg és akkordok kinyerése folyamatban...');
      try {
        let buf = null;
        if (pdfSrc.startsWith('data:')) {
          const base64 = pdfSrc.split(',')[1] || '';
          const binStr = atob(base64);
          const bytes = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
          buf = bytes.buffer;
        } else {
          const resp = await fetch(pdfSrc);
          buf = await resp.arrayBuffer();
        }
        if (buf) {
          const info = await extractStructuredSongFromPdfBuffer(buf);
          if (info && info.text) {
            song.extractedDraft = info.text;
            if (info.key) song.key = info.key;
            if (info.bpm) song.bpm = info.bpm;
            if (info.timeSig) song.timeSig = info.timeSig;
            if (info.title && (!song.title || song.title.toLowerCase().includes('pdf'))) {
              song.title = info.title;
            }
            persistAll();
            return info;
          }
        }
      } catch (e) {
        console.warn('PDF on-demand kinyerési figyelmeztetés:', e);
      }
    }

    if (imgSrc && window.Tesseract) {
      if (onStatusUpdate) onStatusUpdate('🔍 Fotózott kotta kontraszt-élesítése és akkordok felismerése (OCR)...');
      try {
        const processedSource = await preprocessImageForOcr(imgSrc);
        const res = await window.Tesseract.recognize(processedSource, 'hun+eng', {
          logger: (m) => {
            if (m.status === 'recognizing text' && onStatusUpdate) {
              onStatusUpdate(`🔍 Képfelismerés (OCR): ${Math.round((m.progress || 0) * 100)}%...`);
            }
          }
        });

        // 1. Ha a Tesseract visszaadta a szavak pontos (x0, y0, x1, y1) koordinátáit, a koordináta-tudatos motorral
        //    állítjuk vissza az akkordok szótagok feletti vízszintes pozícióját!
        if (res && res.data && Array.isArray(res.data.words) && res.data.words.length > 0) {
          const positionedWords = res.data.words
            .filter(w => w && w.text && w.text.trim() && (w.confidence === undefined || w.confidence > 18))
            .map(w => {
              const bx = w.bbox || {};
              const hPx = Math.max(10, (bx.y1 || 20) - (bx.y0 || 0));
              const cleanTok = w.text.trim().replace(/^([A-GH][#b]?)rn$/, '$1m');
              return {
                str: cleanTok,
                x: (bx.x0 || 0) * 0.5,
                y: -(bx.y0 || 0) * 0.5,
                h: hPx * 0.5
              };
            });

          const rec = reconstructSongFromPositionedItems(positionedWords);
          if (rec && rec.text && rec.text.trim()) {
            const finalTxt = cleanOcrChordLineTypos(rec.text);
            song.extractedDraft = finalTxt;
            if (rec.key) song.key = rec.key;
            if (rec.bpm) song.bpm = rec.bpm;
            if (rec.timeSig) song.timeSig = rec.timeSig;
            persistAll();
            return {
              text: finalTxt,
              key: rec.key,
              bpm: rec.bpm,
              timeSig: rec.timeSig,
              title: rec.title
            };
          }
        }

        // 2. Tartalék: sima szöveges OCR eredmény
        if (res && res.data && res.data.text && res.data.text.trim()) {
          const cleaned = cleanOcrChordLineTypos(
            res.data.text
              .replace(/\r\n/g, '\n')
              .replace(/[ \t]+$/gm, '')
              .replace(/\n{3,}/g, '\n\n')
              .trim()
          );
          song.extractedDraft = cleaned;
          persistAll();
          return { text: cleaned };
        }
      } catch (ocrErr) {
        console.warn('OCR hiba:', ocrErr);
      }
    }

    return null;
  }

  /**
   * 1-kattintásos azonnali átalakítás a főképernyő PDF/Fotó sávjáról:
   * Kinyeri a kotta szövegét, akkordjait, hangnemét és tempóját, majd azonnal élő, transzponálható StageChart kottává alakítja!
   */
  async function quickAutoConvertCurrentMediaSong() {
    const song = getCurrentSong();
    if (!song) return;

    StageTools.showStageCueBanner('⏳ Kotta automatikus felismerése és átalakítása...', 4000, false);
    const info = await extractMediaSongDraftOnDemand(song, (msg) => {
      StageTools.showStageCueBanner(msg, 3000, false);
    });

    if (info && info.text && info.text.trim()) {
      song.content = info.text.trim();
      if (info.key) song.key = info.key;
      if (info.bpm) song.bpm = info.bpm;
      if (info.timeSig) song.timeSig = info.timeSig;
      if (song.artist === 'PDF Dokumentum' || song.artist === 'Fotózott kotta') {
        song.artist = '';
      }
      song.format = song.content.includes('[') ? 'chordpro' : 'over';
      persistAll();
      refreshMainView();
      StageTools.showStageCueBanner('✓ Kotta sikeresen átalakítva szerkeszthető és transzponálható énekké!', 3200, false);
    } else {
      // Ha nem sikerült automatikusan kinyerni (pl. kézzel írott kotta vagy offline kép), megnyitjuk a 2-oszlopos szerkesztő ablakot
      openConvertMediaToEditableModal();
    }
  }

  /**
   * PDF vagy Lefotózott kotta átalakítása szerkeszthető, transzponálható StageChart énekké (2-oszlopos előnézeti ablakkal)
   */
  async function openConvertMediaToEditableModal() {
    const song = getCurrentSong();
    if (!song) return;
    const pdfSrc = mediaBlobUrls[song.id] || song.pdfDataUrl;
    const imgSrc = song.imageDataUrl;
    const hasDraft = !!(song.extractedDraft && song.extractedDraft.trim());

    const previewMediaHtml = pdfSrc
      ? `<embed src="${pdfSrc}#toolbar=0&navpanes=0&view=FitH" type="application/pdf" width="100%" height="380px" style="border:1px solid var(--border); border-radius:8px; background:#fff;" />`
      : imgSrc
      ? `<div style="max-height:380px; overflow:auto; border:1px solid var(--border); border-radius:8px;"><img src="${imgSrc}" style="width:100%; display:block;"></div>`
      : '';

    const html = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:10px; margin-bottom:12px;">
        <div>
          <h3>✨ PDF / Fotózott kotta átalakítása szerkeszthető énekké</h3>
          <div id="convStatusSubtitle" style="font-size:12.5px; color:var(--text-muted);">
            ${hasDraft ? '✓ A kotta szövegét és akkordjait automatikusan felismertük! Ellenőrizd és kattints alul a mentésre:' : '⏳ Automatikus szöveg- és akkordfelismerés indítása...'}
          </div>
        </div>
        <button class="btn-outline" onclick="StageChartUI.closeModal()">Mégsem</button>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:14px; align-items:start;">
        <div>
          ${previewMediaHtml}
          <div style="margin-top:8px; font-size:12px; color:var(--text-muted);">
            💡 A bal oldali eredeti dokumentumból a StageChart automatikusan kiolvassa a szakaszokat, dalszöveget és a szótagok feletti akkordokat.
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <span style="font-size:13px; font-weight:600;">Alap hangnem:</span>
            <input type="text" id="convSongKey" value="${song.key || 'D'}" style="width:60px; padding:4px 8px; border:1px solid var(--border); border-radius:6px; background:var(--bg-card); color:var(--text-main);">
            <button class="btn-outline" style="font-size:12px; padding:4px 10px;" onclick="StageChartUI.runOcrOrExtractIntoModal(true)">🔄 Újrafelismerés</button>
            <button class="btn-outline" style="margin-left:auto; font-size:12px; padding:4px 10px;" onclick="StageChartUI.cleanUpConvertedText()">🧹 Tisztítás</button>
          </div>
          <textarea id="convSongTextarea" placeholder="Kotta szövegének és akkordjainak automatikus beolvasása..." style="width:100%; height:310px; font-family:var(--font-mono); font-size:13.5px; padding:10px; border:1px solid var(--border); border-radius:8px; background:var(--bg-card); color:var(--text-main); resize:vertical;">${hasDraft ? song.extractedDraft : ''}</textarea>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
            <button class="btn-primary" style="padding:10px;" onclick="StageChartUI.confirmConvertMediaToSong(false)">✓ Átalakítás és Megjelenítés</button>
            <button class="btn-outline" style="padding:10px;" onclick="StageChartUI.confirmConvertMediaToSong(true)">✏️ Megnyitás a Szerkesztőben</button>
          </div>
        </div>
      </div>
    `;
    showModalHtml(html);

    if (!hasDraft) {
      await runOcrOrExtractIntoModal(false);
    }
  }

  async function runOcrOrExtractIntoModal(forceReExtract = false) {
    const song = getCurrentSong();
    if (!song) return;
    if (forceReExtract) song.extractedDraft = '';
    const subEl = document.getElementById('convStatusSubtitle');
    const taEl = document.getElementById('convSongTextarea');
    const keyEl = document.getElementById('convSongKey');

    const info = await extractMediaSongDraftOnDemand(song, (msg) => {
      if (subEl) {
        subEl.textContent = msg;
        subEl.style.color = 'var(--accent)';
      }
    });

    if (info && info.text && taEl) {
      taEl.value = info.text;
      if (info.key && keyEl) keyEl.value = info.key;
      if (subEl) {
        subEl.textContent = '✓ Szöveg és akkordok sikeresen felismerve!';
        subEl.style.color = '#16a34a';
      }
    } else if (subEl) {
      subEl.textContent = '⚠ Nem található digitális szövegréteg — másold be (Ctrl+V) vagy gépeld be a kottát a jobb oldali mezőbe:';
      subEl.style.color = 'var(--warning)';
    }
  }

  function cleanUpConvertedText() {
    const ta = document.getElementById('convSongTextarea');
    if (!ta) return;
    ta.value = ta.value
      .replace(/\t/g, '    ')
      .replace(/[ \u00A0]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function confirmConvertMediaToSong(openEditorAfter = false) {
    const song = getCurrentSong();
    const ta = document.getElementById('convSongTextarea');
    const keyInp = document.getElementById('convSongKey');
    if (!song || !ta) return;

    song.content = ta.value.trim();
    song.key = (keyInp && keyInp.value.trim()) ? keyInp.value.trim() : 'D';
    if (song.artist === 'PDF Dokumentum' || song.artist === 'Fotózott kotta') {
      song.artist = '';
    }
    song.format = song.content.includes('[') ? 'chordpro' : 'over';
    persistAll();
    closeModal();
    refreshMainView();
    if (openEditorAfter) {
      openEditorScreen();
    }
  }

  function backupFullLibrary() {
    const payload = { songs, setlists, settings };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `StageChart_Teljes_Mentes_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  function restoreFullLibrary(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.songs && Array.isArray(data.songs)) {
          songs = data.songs;
          if (data.setlists) setlists = data.setlists;
          if (data.settings) settings = { ...settings, ...data.settings };
        } else if (Array.isArray(data)) {
          songs = data;
        }
        runtime.currentSongId = songs[0].id;
        persistAll();
        refreshMainView();
        alert('Könyvtár sikeresen visszaállítva!');
      } catch (e) {
        alert('Hibás mentési fájl formátum.');
      }
    };
    reader.readAsText(file);
  }

  function printCurrentSong() {
    closeAllDropdowns();
    closeSettingsScreen();
    window.print();
  }

  // Szabadkézi rajz vászon
  const canvas = document.getElementById('drawingCanvas');
  const ctx = canvas.getContext('2d');
  let isDrawingStroke = false;

  function resizeCanvas() {
    const viewer = document.getElementById('mainViewer');
    canvas.width = viewer.scrollWidth;
    canvas.height = Math.max(viewer.scrollHeight, viewer.clientHeight);
    loadDrawingForCurrentSong();
  }

  function toggleDrawingMode() {
    runtime.drawingMode = !runtime.drawingMode;
    canvas.classList.toggle('drawing-active', runtime.drawingMode);
    document.getElementById('fabDraw').classList.toggle('active', runtime.drawingMode);
    document.getElementById('drawingToolbar').classList.toggle('open', runtime.drawingMode);
    if (runtime.drawingMode) resizeCanvas();
    else saveCurrentDrawingToSong();
  }

  function setBrush(color, size) {
    runtime.brushColor = color;
    runtime.brushSize = size;
  }

  function clearDrawing() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const song = getCurrentSong();
    song.drawingData = null;
    persistAll();
  }

  function saveCurrentDrawingToSong() {
    if (!runtime.drawingMode) return;
    const song = getCurrentSong();
    if (song) {
      song.drawingData = canvas.toDataURL();
      persistAll();
    }
  }

  function loadDrawingForCurrentSong() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const song = getCurrentSong();
    if (song && song.drawingData) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = song.drawingData;
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!runtime.drawingMode) return;
    isDrawingStroke = true;
    ctx.strokeStyle = runtime.brushColor;
    ctx.lineWidth = runtime.brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(e.offsetX, e.offsetY);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isDrawingStroke) return;
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
  });

  window.addEventListener('pointerup', () => {
    if (isDrawingStroke) {
      isDrawingStroke = false;
      saveCurrentDrawingToSong();
    }
  });

  // FAB és navigációs segédek
  function zoomSheet(dir) {
    const next = Math.max(12, Math.min(60, (settings.formatting.lyricsSize || 16) + dir * 2));
    settings.formatting.lyricsSize = next;
    settings.formatting.chordSize = next;
    persistAll();
    applyFormattingCssVariables();
  }

  function nextSongInLibrary(dir = 1) {
    let list = songs;
    let songIds = [];
    
    if (sessionSetlist && Array.isArray(sessionSetlist.songs) && sessionSetlist.songs.length) {
      if (sessionSetlist.setlist && Array.isArray(sessionSetlist.setlist.songIds) && sessionSetlist.setlist.songIds.length) {
        songIds = sessionSetlist.setlist.songIds;
        list = songIds.map(id => sessionSetlist.songs.find(s => String(s.id) === String(id))).filter(Boolean);
      } else {
        list = sessionSetlist.songs;
        songIds = list.map(s => s.id);
      }
    } else if (runtime.activeSetlistId) {
      const setObj = setlists.find(l => l.id === runtime.activeSetlistId);
      if (setObj && setObj.songIds && setObj.songIds.length) {
        songIds = setObj.songIds;
        list = songIds.map(id => songs.find(s => s.id === id)).filter(Boolean);
      }
    }

    if (!list || !list.length) return;

    // Ha van tárolt pozíciónk a setlistában, abból indulunk ki (ez kezeli a duplikált dalokat is!)
    let curIdx = runtime.currentSetlistIndex !== undefined ? runtime.currentSetlistIndex : list.findIndex(s => String(s.id) === String(runtime.currentSongId));
    if (curIdx < 0) curIdx = 0;

    let nextIdx = curIdx + dir;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= list.length) nextIdx = list.length - 1; // Megáll a lista végén

    runtime.currentSetlistIndex = nextIdx; // Eltároljuk az új pozíciót

    if (list[nextIdx]) {
      selectSongById(list[nextIdx].id);
    }
  }

  function stepScrollDown(dir = 1) {
    const viewer = document.getElementById('mainViewer');
    const pct = (settings.pedalScrollPercent || 50) / 100;
    viewer.scrollBy({ top: dir * viewer.clientHeight * pct, behavior: 'smooth' });
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }

  function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-panel').forEach(p => p.classList.remove('open'));
  }

  /********************************************************************
   * 11. ESEMÉNYKEZELŐK ÉS INICIALIZÁLÁS
   ********************************************************************/
  function bindEvents() {
    document.getElementById('btnToggleSidebar').onclick = () => toggleSidebar();
    document.getElementById('topbarCenter').onclick = () => openTopbarOptionsModal();
    document.getElementById('btnOpenEditor').onclick = openEditorScreen;

    document.getElementById('btnMoreMenu').onclick = (e) => {
      e.stopPropagation();
      const p = document.getElementById('panelMore');
      const was = p.classList.contains('open');
      closeAllDropdowns();
      if (!was) p.classList.add('open');
    };

    document.getElementById('btnSaveMenu').onclick = (e) => {
      e.stopPropagation();
      const p = document.getElementById('panelExport');
      const was = p.classList.contains('open');
      closeAllDropdowns();
      if (!was) p.classList.add('open');
    };

    document.getElementById('btnShareMenu').onclick = (e) => {
      e.stopPropagation();
      const p = document.getElementById('panelShare');
      const was = p && p.classList.contains('open');
      closeAllDropdowns();
      if (p && !was) p.classList.add('open');
    };

    window.addEventListener('resize', () => {
      fitSongColumnsAndFontToScreen(getCurrentSong());
    });

    document.getElementById('btnQuickActions').onclick = (e) => {
      e.stopPropagation();
      const p = document.getElementById('panelQuick');
      const was = p.classList.contains('open');
      closeAllDropdowns();
      if (!was) p.classList.add('open');
    };

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown-panel') && !e.target.closest('.icon-btn')) {
        closeAllDropdowns();
      }
      if (!e.target.closest('.sidebar-popup-menu') && !e.target.closest('.icon-btn') && !e.target.closest('#btnSidebarPrimaryAdd')) {
        closeSidebarPopups();
      }
    });

    // Ha a felhasználó a fő kottaterületre kattint, és az oldalsáv nincs rögzítve (kitűzve), automatikusan csukódjon be!
    document.getElementById('mainViewer').addEventListener('click', () => {
      const sb = document.getElementById('sidebar');
      if (sb && sb.classList.contains('open') && !sb.classList.contains('pinned')) {
        toggleSidebar(false);
      }
    });

    // Globális Drag & Drop a teljes ablakon: bárhová behúzhatsz PDF, JPG, CHO vagy SBPBACKUP fájlt!
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    window.addEventListener('drop', async (e) => {
      if (e.target.closest('#smartImportDropzone')) return; // azt a modal saját maga kezeli
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        await processImportedFilesList(Array.from(e.dataTransfer.files));
      }
    });

    // Azonnali sötét Tooltip felirat (7. kép alapján: PC-n egér rávitelkor, telefonon/tableten érintéskor)
    const tooltipPill = document.getElementById('floatingTooltipPill');
    let tooltipHideTimer = null;

    function showFloatingTooltipForEl(el) {
      if (!tooltipPill || !el) return;
      const text = el.getAttribute('data-tooltip') || el.getAttribute('title');
      if (!text) return;
      // Ha natív title van, átmentjük data-tooltip-be, hogy a böngésző dupla buborékja ne zavarjon
      if (el.hasAttribute('title')) {
        el.setAttribute('data-tooltip', text);
        el.removeAttribute('title');
      }
      tooltipPill.textContent = text;
      const rect = el.getBoundingClientRect();
      tooltipPill.classList.add('visible');

      const pillW = tooltipPill.offsetWidth || 110;
      let left = rect.left + rect.width / 2 - pillW / 2;
      left = Math.max(8, Math.min(window.innerWidth - pillW - 8, left));
      let top = rect.bottom + 7;
      if (top + 32 > window.innerHeight) {
        top = rect.top - 34;
      }
      tooltipPill.style.left = `${Math.round(left)}px`;
      tooltipPill.style.top = `${Math.round(top)}px`;
    }

    function hideFloatingTooltip() {
      if (tooltipPill) tooltipPill.classList.remove('visible');
    }

    document.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const btn = e.target.closest('.icon-btn, .fab-btn, [data-tooltip]');
      if (btn) {
        clearTimeout(tooltipHideTimer);
        showFloatingTooltipForEl(btn);
      } else {
        hideFloatingTooltip();
      }
    });

    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        const btn = e.target.closest('.icon-btn, .fab-btn, [data-tooltip]');
        if (btn) {
          clearTimeout(tooltipHideTimer);
          showFloatingTooltipForEl(btn);
          tooltipHideTimer = setTimeout(hideFloatingTooltip, 1600);
        } else {
          hideFloatingTooltip();
        }
      } else {
        hideFloatingTooltip();
      }
    });

    document.getElementById('songSearchInput').addEventListener('input', renderSidebarContent);
    document.getElementById('btnClearSearch').onclick = () => {
      document.getElementById('songSearchInput').value = '';
      renderSidebarContent();
    };

    document.getElementById('padVolumeSlider').addEventListener('input', (e) => {
      AudioEngine.setPadVolume(parseInt(e.target.value, 10));
    });

    document.getElementById('scrollSpeedSlider').addEventListener('input', (e) => {
      runtime.scrollSpeed = parseInt(e.target.value, 10);
      const totalSec = Math.max(30, 195 - runtime.scrollSpeed * 15);
      const m = Math.floor(totalSec / 60);
      const s = String(totalSec % 60).padStart(2, '0');
      document.getElementById('scrollTimeLabel').textContent = `${m}:${s}`;
    });

    document.getElementById('toggleLyricsOnly').addEventListener('change', (e) => {
      runtime.lyricsOnly = e.target.checked;
      document.body.classList.toggle('lyrics-only-mode', runtime.lyricsOnly);
    });

    document.getElementById('toggleNashville').addEventListener('change', (e) => {
      runtime.nashville = e.target.checked;
      refreshMainView();
    });

    // Billentyűzet és Bluetooth lábkapcsoló figyelés
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      if (e.key === 'ArrowDown' || e.key === 'v' || e.key === 'PageDown') {
        e.preventDefault();
        stepScrollDown(1);
      } else if (e.key === 'ArrowUp' || e.key === '^' || e.key === 'PageUp') {
        e.preventDefault();
        stepScrollDown(-1);
      } else if (e.key === 'ArrowRight' || e.key === '>') {
        e.preventDefault();
        nextSongInLibrary(1);
      } else if (e.key === 'ArrowLeft' || e.key === '<') {
        e.preventDefault();
        nextSongInLibrary(-1);
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomSheet(1);
      } else if (e.key === '-') {
        e.preventDefault();
        zoomSheet(-1);
      } else if (e.key === '0') {
        e.preventDefault();
        settings.formatting.lyricsSize = 16;
        settings.formatting.chordSize = 16;
        applyFormattingCssVariables();
      } else if (e.key === ' ') {
        e.preventDefault();
        toggleAutoScroll();
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        toggleAmbientPad();
      }
    });

    // Élő óra és 3 soros felső sáv frissítése
    function updateClock() {
      refreshTopbarCenterLines(getCurrentSong());
    }
    setInterval(updateClock, 10000);
    updateClock();

    // Mobil érintéses lapozás (Swipe Balra: Következő dal, Swipe Jobbra: Előző dal)
    const viewer = document.getElementById('mainViewer');
    if (viewer) {
      let touchStartX = 0;
      let touchStartY = 0;
      let touchStartTime = 0;

      viewer.addEventListener('touchstart', (e) => {
        if (runtime.isDrawingMode) return;
        if (e.touches && e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          touchStartTime = Date.now();
        }
      }, { passive: true });

      viewer.addEventListener('touchend', (e) => {
        if (runtime.isDrawingMode) return;
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;
        const elapsed = Date.now() - touchStartTime;

        // Min. 50px vízszintes elmozdulás és vízszintes dominancia
        if (Math.abs(diffX) >= 50 && Math.abs(diffX) > Math.abs(diffY) * 1.2 && elapsed < 800) {
          if (diffX < 0) {
            nextSongInLibrary(1); // Balra húzás -> Következő dal
          } else {
            nextSongInLibrary(-1); // Jobbra húzás -> Előző dal
          }
        }
      }, { passive: true });
    }

    // Mobilos alsó panel (Pad/Klikk vezérlőpult) összecsukó gomb inicializálása
    const dock = document.getElementById('padDock');
    if (dock && !document.getElementById('btnPadDockToggle')) {
      const btn = document.createElement('button');
      btn.id = 'btnPadDockToggle';
      btn.className = 'btn-outline';
      btn.innerHTML = '🎛️ Vezérlők';
      btn.onclick = (e) => {
        e.stopPropagation();
        dock.classList.toggle('expanded');
        btn.innerHTML = dock.classList.contains('expanded') ? '✕ Bezár' : '🎛️ Vezérlők';
      };
      dock.appendChild(btn);
    }
  }

  /********************************************************************
   * 11. ÚJ MODULOK INTEGRÁCIÓJA
   *     a) Nyelv (i18n) + Téma  (js/i18n.js)
   *     b) Licenc / Trial limit (js/license.js)
   *     c) Szerver nélküli zenekari szinkron, WebRTC / PeerJS (js/p2p-sync.js)
   ********************************************************************/
  const I18n = window.StageChartI18n;
  const License = window.StageChartLicense;
  const P2P = window.StageChartP2P;

  function i18nT(key, params) {
    return I18n ? I18n.t(key, params) : key;
  }

  /* ---------- b) LICENC / TRIAL ---------- */
  const LICENSE_LOCK_SELECTOR = '[onclick*="createNewSong"], [onclick*="openSmartImportModal"], [onclick*="triggerSongImport"], [onclick*="triggerSetlistImport"]';
  let lastTrialLocked = null;

  // A zenekari szinkronnal (Follower) letöltött énekek nem számítanak bele a próbaverzió limitjébe
  function getTrialSongCount() {
    return songs.filter(s => s && !s.fromSync).length;
  }

  function isTrialLocked() {
    return !!License && !License.isActive() && getTrialSongCount() >= License.TRIAL_SONG_LIMIT;
  }

  function guardTrialLimit() {
    if (!isTrialLocked()) return true;
    openTrialLimitModal();
    return false;
  }

  function openTrialLimitModal() {
    const max = License ? License.TRIAL_SONG_LIMIT : 10;
    showModalHtml(`
      <div class="trial-modal">
        <div class="trial-icon">🔒</div>
        <h3>${i18nT('trial.title')}</h3>
        <p>${i18nT('trial.body', { max })}</p>
        <div class="trial-actions">
          <button class="btn-outline" onclick="StageChartUI.closeModal()">${i18nT('trial.later')}</button>
          <button class="btn-primary" onclick="StageChartUI.openLicenseSettings()">${i18nT('trial.enter')}</button>
        </div>
      </div>
    `);
  }

  function openLicenseSettings() {
    closeModal();
    openSettingsScreen();
    switchSettingsPage('license', document.getElementById('navLicense'));
  }

  function refreshLicenseLocks() {
    const locked = isTrialLocked();
    document.querySelectorAll(LICENSE_LOCK_SELECTOR).forEach(el => {
      el.classList.toggle('license-locked', locked);
      if ('disabled' in el) el.disabled = locked;
      el.setAttribute('aria-disabled', locked ? 'true' : 'false');
    });
    // Éppen most érte el a limitet: felugró tájékoztató ablak
    if (lastTrialLocked === false && locked) {
      openTrialLimitModal();
    }
    lastTrialLocked = locked;
    renderLicensePage();
  }

  function renderLicensePage() {
    const badge = document.getElementById('licenseStatusBadge');
    if (!badge || !License) return;
    const active = License.isActive();
    const count = getTrialSongCount();
    badge.textContent = active
      ? `${i18nT('license.status.active')} · ${License.getStatus().plan}`
      : i18nT('license.status.trial');
    badge.className = 'license-badge ' + (active ? 'active' : 'trial');

    const countEl = document.getElementById('licenseSongCount');
    if (countEl) {
      countEl.textContent = active
        ? i18nT('license.songs.unlimited', { n: count })
        : i18nT('license.songs', { n: count, max: License.TRIAL_SONG_LIMIT });
    }
    const form = document.getElementById('licenseForm');
    if (form) form.style.display = active ? 'none' : 'flex';
    const deact = document.getElementById('btnLicenseDeactivate');
    if (deact) deact.style.display = active ? 'inline-flex' : 'none';
  }

  function setLicenseMessage(text, cls) {
    const el = document.getElementById('licenseMessage');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'license-message' + (cls ? ' ' + cls : '');
  }

  async function activateLicenseFromUI() {
    if (!License) return;
    const input = document.getElementById('licenseKeyInput');
    const btn = document.getElementById('btnLicenseActivate');
    const key = input ? input.value : '';
    if (!key.trim()) {
      setLicenseMessage(i18nT('license.empty'), 'err');
      return;
    }
    if (btn) btn.disabled = true;
    setLicenseMessage(i18nT('license.checking'), '');
    const res = await License.activate(key);
    if (btn) btn.disabled = false;
    if (res.ok) {
      if (input) input.value = '';
      setLicenseMessage(i18nT('license.success'), 'ok');
      refreshLicenseLocks();
      StageTools.showStageCueBanner(i18nT('license.success'), 3200, false);
    } else {
      setLicenseMessage(res.error === 'network' ? i18nT('license.network') : i18nT('license.invalid'), 'err');
    }
  }

  function deactivateLicenseFromUI() {
    if (!License) return;
    License.deactivate();
    setLicenseMessage('', '');
    refreshLicenseLocks();
  }

  /* ---------- c) ZENEKARI SZINKRON (PeerJS / WebRTC) ---------- */
  const syncUi = { role: 'off', pin: null, followers: 0, online: false, idMap: {} };

  function updateSyncBadge() {
    const badge = document.getElementById('syncStatusBadge');
    if (!badge) return;
    badge.classList.remove('sync-offline');
    if (syncUi.role === 'off') {
      badge.style.display = 'none';
      return;
    }
    badge.style.display = 'inline-block';
    if (syncUi.role === 'leader') {
      badge.textContent = `${i18nT('sync.badge.leader')} · ${syncUi.followers}`;
    } else if (syncUi.online) {
      badge.textContent = i18nT('sync.badge.follower');
    } else {
      badge.textContent = i18nT('sync.badge.offline');
      badge.classList.add('sync-offline');
    }
  }

  function renderSyncPanel() {
    const el = document.getElementById('syncPanelStatus');
    if (!el) return;
    el.removeAttribute('data-i18n');
    let text;
    if (syncUi.role === 'leader') {
      text = i18nT('sync.status.leader', { pin: syncUi.pin, n: syncUi.followers });
    } else if (syncUi.role === 'follower') {
      text = i18nT(syncUi.online ? 'sync.status.follower.online' : 'sync.status.follower.offline');
    } else {
      text = i18nT('sync.status.off');
    }
    el.textContent = text;

    const idle = syncUi.role === 'off';
    const startBtn = document.getElementById('btnSyncStartLeader');
    const joinBtn = document.getElementById('btnSyncJoin');
    const stopBtn = document.getElementById('btnSyncStop');
    if (startBtn) startBtn.style.display = idle ? '' : 'none';
    if (joinBtn) joinBtn.style.display = idle ? '' : 'none';
    if (stopBtn) stopBtn.style.display = idle ? 'none' : '';
  }

  /** Leader: a teljes aktuális setlista (és az éppen aktív ének állapota) a Followereknek. A nehéz (PDF/kép/hang) mezők kimaradnak. */
  function stripSongForSync(s) {
    const copy = Object.assign({}, s);
    delete copy.audioMemo;
    delete copy.drawingData;
    delete copy.pdfDataUrl;
    delete copy.imageDataUrl;
    delete copy.extractedDraft;
    return JSON.parse(JSON.stringify(copy));
  }

  function buildSyncSnapshot() {
    const listId = runtime.activeSetlistId || runtime.viewingSetlistId;
    const list = setlists.find(l => l.id === listId);
    let ids;
    let setlistInfo;
    if (list && Array.isArray(list.songIds) && list.songIds.length) {
      ids = list.songIds.slice();
      setlistInfo = {
        id: list.id,
        name: list.name,
        date: list.date,
        songIds: ids,
        songOverrides: JSON.parse(JSON.stringify(list.songOverrides || {}))
      };
    } else {
      ids = songs.map(s => s.id);
      setlistInfo = {
        id: 'library',
        name: i18nT('sync.adhoc') || 'Daltár',
        date: new Date().toISOString().slice(0, 10),
        songIds: ids,
        songOverrides: {}
      };
    }
    const uniqueIds = Array.from(new Set(ids));
    const slimSongs = uniqueIds
      .map(id => songs.find(s => s.id === id))
      .filter(Boolean)
      .map(stripSongForSync);
    return {
      type: 'INIT_SETLIST',
      setlist: setlistInfo,
      songs: slimSongs,
      songState: {
        songId: runtime.currentSongId,
        transposeSemitones: runtime.transposeSemitones,
        capo: runtime.capo
      }
    };
  }

  function onLeaderSyncStatus(evt) {
    if (evt && typeof evt.followers === 'number') {
      syncUi.followers = evt.followers;
      const msgEl = document.getElementById('syncLeaderMsg');
      if (msgEl) {
        msgEl.textContent = syncUi.followers > 0
          ? i18nT('sync.leader.count', { n: syncUi.followers })
          : i18nT('sync.leader.waiting');
        msgEl.className = 'sync-msg' + (syncUi.followers > 0 ? ' ok' : '');
      }
      updateSyncBadge();
      renderSyncPanel();
    }
  }

  function stopSyncInternal() {
    if (P2P) P2P.stop();
    StageTools.initBandSync('off', null);
    syncUi.role = 'off';
    syncUi.pin = null;
    syncUi.followers = 0;
    syncUi.online = false;
    sessionSetlist = null; // Ideiglenes munkamenet memória törlése szinkron leállításakor
    updateSyncBadge();
    renderSyncPanel();
    refreshMainView(false);
  }

  function stopSync() {
    stopSyncInternal();
    closeModal();
  }

  async function startLeaderSync() {
    closeAllDropdowns();
    if (!P2P || !P2P.isAvailable()) {
      alert(i18nT('sync.err.lib'));
      return;
    }
    stopSyncInternal();
    showModalHtml(`
      <div class="sync-modal">
        <h3>${i18nT('sync.leader.title')}</h3>
        <div class="sync-hint">${i18nT('sync.leader.pin')}</div>
        <div class="sync-pin-display" id="syncLeaderPin">•••••</div>
        <div class="sync-qr-wrap" id="syncLeaderQr"></div>
        <div class="sync-qr-url" id="syncLeaderUrl"></div>
        <div class="sync-msg" id="syncLeaderMsg">${i18nT('sync.leader.generating')}</div>
        <div class="sync-modal-actions">
          <button class="btn-outline" onclick="StageChartUI.resendSetlistToBand()">${i18nT('sync.resend')}</button>
          <button class="btn-outline" onclick="StageChartUI.stopSync()">${i18nT('sync.stop')}</button>
          <button class="btn-primary" onclick="StageChartUI.closeModal()">${i18nT('common.close')}</button>
        </div>
      </div>
    `);
    try {
      const pin = await P2P.startLeader({
        getSnapshot: buildSyncSnapshot,
        onStatus: onLeaderSyncStatus
      });
      syncUi.role = 'leader';
      syncUi.pin = pin;
      syncUi.followers = 0;
      StageTools.initBandSync('leader', null);
      const pinEl = document.getElementById('syncLeaderPin');
      if (pinEl) pinEl.textContent = pin;
      renderLeaderQr(pin);
      onLeaderSyncStatus({ followers: 0 });
      updateSyncBadge();
      renderSyncPanel();
    } catch (err) {
      const msgEl = document.getElementById('syncLeaderMsg');
      if (msgEl) {
        msgEl.textContent = i18nT('sync.err.generic');
        msgEl.className = 'sync-msg err';
      }
    }
  }

  /** Csatlakozási URL: origin/host + path + ?sync=peerID */
  function buildJoinUrl(peerID) {
    if (window.location.protocol === 'file:' || !window.location.host) {
      return `${window.location.href.split(/[?#]/)[0]}?sync=${peerID}`;
    }
    return `${window.location.protocol}//${window.location.host}${window.location.pathname}?sync=${peerID}`;
  }

  /** Függőségmentes, beépített Vanilla JS SVG QR-kód generátor */
  function createQrSvg(r){var n,t,o,e,a=[],f=[],i=Math.max,u=Math.min,h=Math.abs,v=Math.ceil,c=/^[0-9]*$/,s=/^[A-Z0-9 $%*+.\/:-]*$/,l="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:",g=[[-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],[-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],[-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],[-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]],d=[[-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],[-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],[-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],[-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81]],m={L:[0,1],M:[1,0],Q:[2,3],H:[3,2]},p=function(r,n){for(var t=0,o=8;o--;)t=t<<1^285*(t>>>7)^(n>>>o&1)*r;return t},C=function(r,n){for(var t=[],o=r.length,e=o;e;)for(var a=r[o-e--]^t.shift(),f=n.length;f--;)t[f]^=p(n[f],a);return t},w=function(r){for(var n=[function(){return 0==(t+o)%2},function(){return 0==t%2},function(){return 0==o%3},function(){return 0==(t+o)%3},function(){return 0==((t/2|0)+(o/3|0))%2},function(){return 0==t*o%2+t*o%3},function(){return 0==(t*o%2+t*o%3)%2},function(){return 0==((t+o)%2+t*o%3)%2}][r],t=e;t--;)for(var o=e;o--;)f[t][o]||(a[t][o]^=n())},b=function(){for(var r=function(r,n){n[6]||(r+=e),n.shift(),n.push(r)},n=function(n,o,a){return n&&(r(o,a),o=0),r(o+=e,a),t(a)},t=function(r){var n=r[5],t=n>0&&r[4]==n&&r[3]==3*n&&r[2]==n&&r[1]==n;return(t&&r[6]>=4*n&&r[0]>=n?1:0)+(t&&r[0]>=4*n&&r[6]>=n?1:0)},o=0,f=e*e,i=0,u=e;u--;){for(var c=[0,0,0,0,0,0,0],s=[0,0,0,0,0,0,0],l=!1,g=!1,d=0,m=0,p=e;p--;){a[u][p]==l?5==++d?o+=3:d>5&&o++:(r(d,c),o+=40*t(c),d=1,l=a[u][p]),a[p][u]==g?5==++m?o+=3:m>5&&o++:(r(m,s),o+=40*t(s),m=1,g=a[p][u]);var C=a[u][p];C&&i++,p&&u&&C==a[u][p-1]&&C==a[u-1][p]&&C==a[u-1][p-1]&&(o+=3)}o+=40*n(l,d,c)+40*n(g,m,s)}return o+=10*(v(h(20*i-10*f)/f)-1)},A=function(r,n,t){for(;n--;)t.push(r>>>n&1)},M=function(r,n){return r.numBitsCharCount[(n+7)/17|0]},B=function(r,n){return 0!=(r>>>n&1)},x=function(r,n){for(var t=0,o=r.length;o--;){var e=r[o],a=M(e,n);if(1<<a<=e.numChars)return 1/0;t+=4+a+e.bitData.length}return t},D=function(r){if(r<1||r>40)throw"Version number out of range";var n=(16*r+128)*r+64;if(r>=2){var t=r/7|2;n-=(25*t-10)*t-55,r>=7&&(n-=36)}return n},I=function(r,n){for(var t=2;-2<=t;t--)for(var o=2;-2<=o;o--)E(r+o,n+t,1!=i(h(o),h(t)))},H=function(r,n){for(var t=4;-4<=t;t--)for(var o=4;-4<=o;o--){var a=i(h(o),h(t)),f=r+o,u=n+t;0<=f&&f<e&&0<=u&&u<e&&E(f,u,2!=a&&4!=a)}},$=function(r){for(var n=t[1]<<3|r,o=n,a=10;a--;)o=o<<1^1335*(o>>>9);var f=21522^(n<<10|o);if(f>>>15!=0)throw"Assertion error";for(a=0;a<=5;a++)E(8,a,B(f,a));E(8,7,B(f,6)),E(8,8,B(f,7)),E(7,8,B(f,8));for(a=9;a<15;a++)E(14-a,8,B(f,a));for(a=0;a<8;a++)E(e-1-a,8,B(f,a));for(a=8;a<15;a++)E(8,e-15+a,B(f,a));E(8,e-8,1)},O=function(){for(var r=e;r--;)E(6,r,0==r%2),E(r,6,0==r%2);for(var t=function(){var r=[];if(n>1)for(var t=2+(n/7|0),o=32==n?26:2*v((e-13)/(2*t-2));t--;)r[t]=t*o+6;return r}(),o=r=t.length;o--;)for(var a=r;a--;)0==a&&0==o||0==a&&o==r-1||a==r-1&&0==o||I(t[a],t[o]);H(3,3),H(e-4,3),H(3,e-4),$(0),function(){if(!(7>n)){for(var r=n,t=12;t--;)r=r<<1^7973*(r>>>11);var o=n<<12|r;if(t=18,o>>>18!=0)throw"Assertion error";for(;t--;){var a=e-11+t%3,f=t/3|0,i=B(o,t);E(a,f,i),E(f,a,i)}}}()},Q=function(r){if(r.length!=V(n,t))throw"Invalid argument";for(var o=d[t[0]][n],e=g[t[0]][n],a=D(n)/8|0,f=o-a%o,i=a/o|0,u=[],h=function(r){var n=1,t=[];t[r-1]=1;for(var o=0;o<r;o++){for(var e=0;e<r;e++)t[e]=p(t[e],n)^t[e+1];n=p(n,2)}return t}(e),v=0,c=0;v<o;v++){var s=r.slice(c,c+i-e+(v<f?0:1));c+=s.length;var l=C(s,h);v<f&&s.push(0),u.push(s.concat(l))}var m=[];for(v=0;v<u[0].length;v++)for(var w=0;w<u.length;w++)(v!=i-e||w>=f)&&m.push(u[w][v]);return m},S=function(r){for(var n=[],t=(r=encodeURI(r),0);t<r.length;t++)"%"!=r.charAt(t)?n.push(r.charCodeAt(t)):(n.push(parseInt(r.substr(t+1,2),16)),t+=2);return n},V=function(r,n){return(D(r)/8|0)-g[n[0]][r]*d[n[0]][r]},E=function(r,n,t){a[n][r]=t?1:0,f[n][r]=1},R=function(r){for(var n=[],t=0,o=r;t<o.length;t++){var e=o[t];A(e,8,n)}return{modeBits:4,numBitsCharCount:[8,16,16],numChars:r.length,bitData:n}},Z=function(r){if(!c.test(r))throw"String contains non-numeric characters";for(var n=[],t=0;t<r.length;){var o=u(r.length-t,3);A(parseInt(r.substr(t,o),10),3*o+1,n),t+=o}return{modeBits:1,numBitsCharCount:[10,12,14],numChars:r.length,bitData:n}},z=function(r){if(!s.test(r))throw"String contains unencodable characters in alphanumeric mode";var n,t=[];for(n=0;n+2<=r.length;n+=2){var o=45*l.indexOf(r.charAt(n));o+=l.indexOf(r.charAt(n+1)),A(o,11,t)}return n<r.length&&A(l.indexOf(r.charAt(n)),6,t),{modeBits:2,numBitsCharCount:[9,11,13],numChars:r.length,bitData:t}},L=function(r,n,t,o){var e=function(r){return""==r?[]:c.test(r)?[Z(r)]:s.test(r)?[z(r)]:[R(S(r))]}(r);return U(e,n,t,o)},N=function(r,i,u,h){t=i,o=h;for(var v=e=4*(n=r)+17;v--;)a[v]=[],f[v]=[];if(O(),function(r){for(var n=0,t=1,o=e-1,i=o;i>0;i-=2){6==i&&--i;for(var u=0>(t=-t)?o:0,h=0;h<e;++h){for(var v=i;v>i-2;--v)f[u][v]||(a[u][v]=B(r[n>>>3],7-(7&n)),++n);u+=t}}}(Q(u)),0>o){var c=1e9;for(v=8;v--;){w(v),$(v);var s=b();c>s&&(c=s,o=v),w(v)}}w(o),$(o),f=[]},U=function(r,n,t,o,e,a){if(void 0===e&&(e=1),void 0===a&&(a=40),void 0===o&&(o=-1),void 0===t&&(t=!0),!(1<=e&&e<=a&&a<=40)||o<-1||o>7)throw"Invalid value";for(var f=[],i=236,h=[],v=e;;){var c=x(r,v);if(c<=8*V(v,n))break;if(v>=a)throw"Data too long";v++}if(t)for(var s=(l=[m.H,m.Q,m.M]).length;s--;)c<=8*V(v,l[s])&&(n=l[s]);for(var l=0;l<r.length;l++){var g=r[l];A(g.modeBits,4,f),A(g.numChars,M(g,v),f);for(var d=0,p=g.bitData;d<p.length;d++)f.push(p[d])}if(f.length!=c)throw"Assertion error";var C=8*V(v,n);if(f.length>C)throw"Assertion error";if(A(0,u(4,C-f.length),f),A(0,(8-f.length%8)%8,f),f.length%8!=0)throw"Assertion error";for(;f.length<C;)A(i,8,f),i^=253;for(s=f.length;s--;)h[s>>>3]|=f[s]<<7-(7&s);return N(v,n,h,o)};return function(){function n(r){return/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(r)}function t(r,n){for(var t in r=document.createElementNS(s,r),n||{})r.setAttribute(t,n[t]);return r}var o,f,i,u,v,c,s="http://www.w3.org/2000/svg",l="",g="string"==typeof r?{msg:r}:r||{},d=g.pal||["#000"],p=h(g.dim)||256,C=[1,0,0,1,c=(c=h(g.pad))>-1?c:4,c],w=n(w=d[0])?w:"#000",b=n(b=d[1])?b:0,A=g.vrb?0:1;for(L(g.msg||"",m[g.ecl]||m.M,0==g.ecb?0:1,g.mtx),v=e+2*c,i=e;i--;)for(u=0,f=e;f--;)a[i][f]&&(A?(u++,a[i][f-1]||(l+="M"+f+","+i+"h"+u+"v1h-"+u+"v-1z",u=0)):l+="M"+f+","+i+"h1v1h-1v-1z");return o=t("svg",{viewBox:[0,0,v,v].join(" "),width:p,height:p,fill:w,"shape-rendering":"crispEdges",xmlns:s,version:"1.1"}),b&&o.appendChild(t("path",{fill:b,d:"M0,0V"+v+"H"+v+"V0H0Z"})),o.appendChild(t("path",{transform:"matrix("+C+")",d:l})),o}()}

  /** Fekete-fehér, telefonkamerával beolvasható beépített SVG QR-kód */
  function renderLeaderQr(peerID) {
    const box = document.getElementById('syncLeaderQr');
    const urlEl = document.getElementById('syncLeaderUrl');
    if (!box) return;
    const url = `${window.location.protocol}//${window.location.host}${window.location.pathname}?sync=${peerID}`;
    box.innerHTML = '';
    if (urlEl) {
      urlEl.textContent = url + (window.location.protocol === 'file:' ? '  —  ' + i18nT('sync.qr.file') : '');
    }
    try {
      const svg = createQrSvg({ msg: url, dim: 200, pad: 2, pal: ['#000', '#fff'] });
      if (svg) box.appendChild(svg);
    } catch (e) {
      box.textContent = i18nT('sync.qr.unavailable');
    }
  }

  function resendSetlistToBand() {
    if (!P2P || syncUi.role !== 'leader') return;
    P2P.resend();
    StageTools.showStageCueBanner(i18nT('sync.resent'), 2000, false);
  }

  /** Follower: a Leader helyi azonosítóinak leképezése a saját daltár azonosítóira (+ hangnem-átszámítás) */
  function remapSemitonesForLocalSong(localSong, leaderKey, semi) {
    const norm = (semi % 12 + 12) % 12;
    const pcLocal = Theory.noteToPitchClass(String((localSong && localSong.key) || 'D').replace('m', ''), settings.notation);
    const pcLeader = Theory.noteToPitchClass(String(leaderKey || 'D').replace('m', ''), settings.notation);
    if (pcLocal === -1 || pcLeader === -1) return norm;
    return ((pcLeader + norm - pcLocal) % 12 + 12) % 12;
  }

  /** Follower: ideiglenes munkamenet memória (kizárólag RAM-ban él, LocalStorage-ba NEM mentjük) */
  let sessionSetlist = null;

  function applyRemoteSongState(st) {
    if (!st) return;
    runtime.currentSongId = st.songId;
    runtime.transposeSemitones = typeof st.transposeSemitones === 'number' ? st.transposeSemitones : 0;
    runtime.capo = typeof st.capo === 'number' ? st.capo : 0;
    const capoEl = document.getElementById('capoVal');
    if (capoEl) capoEl.textContent = String(runtime.capo);
    refreshMainView(false);
  }

  function applyRemoteSetlist(msg) {
    // 2. Session Memória: a teljes daltár/setlista mentése csak memóriaváltozóba
    const incomingSongs = Array.isArray(msg.songs) ? msg.songs : (Array.isArray(msg.data) ? msg.data : []);
    sessionSetlist = {
      setlist: msg.setlist || null,
      songs: incomingSongs,
      songState: msg.songState || null
    };

    if (msg.songState) {
      applyRemoteSongState(msg.songState);
    } else if (sessionSetlist.songs.length) {
      runtime.currentSongId = sessionSetlist.songs[0].id;
      refreshMainView(false);
    }
    const setName = (sessionSetlist.setlist && sessionSetlist.setlist.name) || i18nT('sync.badge.follower');
    StageTools.showStageCueBanner(i18nT('sync.received', { name: setName, n: sessionSetlist.songs.length }), 3000, false);
  }

  function handleSyncMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'INIT_SETLIST' || msg.type === 'SETLIST_FULL') {
      applyRemoteSetlist(msg);
    } else if (msg.type === 'SONG_STATE') {
      applyRemoteSongState(msg);
    } else if (msg.type === 'STAGE_CUE') {
      StageTools.showStageCueBanner(msg.text, 4500, false);
    }
  }

  function onFollowerSyncStatus(evt) {
    if (!evt || !evt.state) return;
    syncUi.online = evt.state === 'online';
    updateSyncBadge();
    renderSyncPanel();
    if (syncUi.role !== 'follower') return;
    if (evt.state === 'offline') {
      // Diszkrét jelzés: a Follower képernyője nem fagy le, az előtöltött setlista a saját felületen lapozható
      StageTools.showStageCueBanner(i18nT('sync.offline'), 4200, false);
    } else if (evt.state === 'online') {
      StageTools.showStageCueBanner(i18nT('sync.online'), 2400, false);
    }
  }

  function openFollowerJoinModal() {
    closeAllDropdowns();
    if (!P2P || !P2P.isAvailable()) {
      alert(i18nT('sync.err.lib'));
      return;
    }
    showModalHtml(`
      <div class="sync-modal">
        <h3>${i18nT('sync.join.title')}</h3>
        <div class="sync-hint">${i18nT('sync.join.hint')}</div>
        <input type="text" id="syncPinInput" class="sync-pin-input" inputmode="numeric" maxlength="6" autocomplete="off"
               placeholder="•••••" aria-label="${i18nT('sync.join.pin')}"
               oninput="this.value=this.value.replace(/\\D/g,'')"
               onkeydown="if(event.key==='Enter') StageChartUI.joinBandFromModal()">
        <div class="sync-msg" id="syncJoinMsg"></div>
        <div class="sync-modal-actions">
          <button class="btn-outline" onclick="StageChartUI.closeModal()">${i18nT('common.close')}</button>
          <button class="btn-primary" id="btnSyncJoinGo" onclick="StageChartUI.joinBandFromModal()">${i18nT('sync.join.btn')}</button>
        </div>
      </div>
    `);
    setTimeout(() => {
      const inp = document.getElementById('syncPinInput');
      if (inp) inp.focus();
    }, 60);
  }

  async function joinBandFromModal() {
    const input = document.getElementById('syncPinInput');
    const msgEl = document.getElementById('syncJoinMsg');
    const btn = document.getElementById('btnSyncJoinGo');
    const setMsg = (text, cls) => {
      if (!msgEl) return;
      msgEl.textContent = text;
      msgEl.className = 'sync-msg' + (cls ? ' ' + cls : '');
    };
    const pin = input ? input.value.trim() : '';
    if (!/^\d{4,6}$/.test(pin)) {
      setMsg(i18nT('sync.err.pin'), 'err');
      return;
    }
    if (btn) btn.disabled = true;
    setMsg(i18nT('sync.connecting'), '');
    stopSyncInternal();
    try {
      await P2P.join(pin, {
        onMessage: handleSyncMessage,
        onStatus: onFollowerSyncStatus
      });
      syncUi.role = 'follower';
      syncUi.online = true;
      StageTools.initBandSync('follower', handleSyncMessage);
      updateSyncBadge();
      renderSyncPanel();
      setMsg(i18nT('sync.connected'), 'ok');
      setTimeout(() => {
        if (document.getElementById('syncPinInput')) closeModal();
      }, 1200);
    } catch (err) {
      if (btn) btn.disabled = false;
      setMsg(err && err.type === 'peer-unavailable' ? i18nT('sync.err.notfound') : i18nT('sync.err.generic'), 'err');
    }
  }

  function init() {
    document.body.classList.toggle('dark-mode', !!settings.darkMode);
    document.body.classList.toggle('high-contrast', !!settings.highContrast);
    document.body.classList.toggle('touch-zones-active', !!settings.touchZonesEnabled);

    // Téma + nyelv (azonnal, oldalfrissítés nélkül váltható)
    if (I18n) {
      I18n.applyTheme(settings.theme || 'default');
      I18n.applyLanguage(settings.language || 'hu');
    }
    document.addEventListener('stagechart:languagechange', () => {
      renderLicensePage();
      renderSyncPanel();
      updateSyncBadge();
    });

    // Licenc (Mock szerver) + trial limit
    if (License) {
      License.init();
      License.onChange(() => refreshLicenseLocks());
    }

    bindEvents();
    StageTools.requestWakeLock();
    AudioEngine.autoProbeLocalPadsFolder(settings.notation, renderPadStatusGrid);
    refreshMainView(false);
    setTimeout(resizeCanvas, 200);

    refreshLicenseLocks();
    if (isTrialLocked()) {
      let alreadyShown = false;
      try {
        alreadyShown = !!sessionStorage.getItem('sc_trial_modal_shown');
        sessionStorage.setItem('sc_trial_modal_shown', '1');
      } catch (e) {}
      if (!alreadyShown) setTimeout(openTrialLimitModal, 900);
    }

    // QR-kóddal / linkkel érkező csatlakozás (?sync=PIN): automatikus Follower csatlakozás
    try {
      const syncParam = new URLSearchParams(window.location.search).get('sync');
      if (syncParam && /^\d{4,6}$/.test(syncParam)) {
        setTimeout(() => {
          openFollowerJoinModal();
          const inp = document.getElementById('syncPinInput');
          if (inp) {
            inp.value = syncParam;
            joinBandFromModal();
          }
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname);
          }
        }, 800);
      }
    } catch (e) {}
  }

  // Indítás betöltés után
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    openTopbarOptionsModal,
    updateTopbarOption,
    setBrush,
    clearDrawing,
    toggleDrawingMode,
    openStageToolsModal,
    startGigTimerFromModal,
    openFormattingScreen,
    closeFormattingScreen,
    resetFormattingDefaults,
    updateFormattingFromUI,
    toggleFormatFlag,
    updateSectionStyleProp,
    renameSectionStyle,
    deleteSectionStyle,
    addCustomSectionStyle,
    printCurrentSong,
    openChordDiagramsModal,
    showSingleChordPopup,
    toggleKnownChord,
    openTunerModal,
    activateMicTuner,
    openSettingsScreen,
    closeSettingsScreen,
    switchSettingsPage,
    exportCurrentSong,
    shareCurrentSong,
    openSmartImportModal,
    loadFileDirectlyFromKottakFolder,
    triggerSongImport,
    triggerSetlistImport,
    importSongFile,
    importSetlistFile,
    resolveImportConflictModal,
    quickAutoConvertCurrentMediaSong,
    openConvertMediaToEditableModal,
    runOcrOrExtractIntoModal,
    cleanUpConvertedText,
    confirmConvertMediaToSong,
    openColorPickerModal,
    onColorPickerRgbInput,
    cancelColorPickerModal,
    confirmColorPickerModal,
    resetTranspositionAndCapo,
    searchSongOnWeb,
    toggleFullscreen,
    stepTranspose,
    setCapo,
    changeCapo,
    openCapoOptimizerModal,
    openVocalRangeModal,
    promptCustomScrollDuration,
    changeInstrumentView,
    toggleSidebar,
    togglePinSidebar,
    handleSidebarBackBtn,
    closeSidebarPopups,
    setSortMode,
    cycleSortMode,
    handleSidebarAdd,
    createNewSong,
    formatSetlistDateModalLabel,
    openNewSetlistModal,
    openEditSetlistModal,
    confirmSaveSetlistModal,
    openSetlistSongPickerModal,
    onPickerSearchOrSortChange,
    addDuplicateSongToPicker,
    removeSongFromPicker,
    moveSongInPicker,
    saveSetlistSongPickerModal,
    removeSongAtIndexFromActiveSetlist,
    moveSongInActiveSetlist,
    toggleSetlistContextMenu,
    exportActiveSetlist,
    shareActiveSetlist,
    promptSaveSetlistAs,
    printActiveSetlistSongs,
    printSetlistOverview,
    deleteActiveSetlist,
    duplicateActiveSetlist,
    shuffleActiveSetlist,
    handleMultiSelectBtnClick,
    toggleSongMultiSelect,
    selectAllSongs,
    invertSongSelection,
    exitMultiSelectMode,
    deleteSelectedSongs,
    exportSelectedSongs,
    batchEditTagsForSelected,
    addCurrentSongToSetlist,
    deleteSetlist,
    switchSidebarTab,
    stepScrollDown,
    handleQuickMemo,
    playSavedMemo,
    promptStageCue,
    toggleAmbientPad,
    changeGrooveStyle,
    handleTapTempo,
    triggerCueCountIn,
    zoomSheet,
    toggleAutoScroll,
    toggleMetronome,
    nextSongInLibrary,
    closeEditorScreen,
    saveEditorChanges,
    switchEditorTab,
    renderEditorPreview,
    handleFormatConvert,
    insertAtCursor,
    openAccidentalsScreen,
    closeAccidentalsScreen,
    saveAccidentalOverride,
    toggleDarkMode,
    updateSetting,
    updateAudioRouting,
    handleCustomPadsUpload,
    resetCustomPadsToSynth,
    handleCustomDrumsUpload,
    editPedalBinding,
    deletePedalBinding,
    toggleMidiSupport,
    toggleWebcamSupport,
    selectInstrument,
    backupFullLibrary,
    restoreFullLibrary,
    changeSyncRole,
    startLeaderSync,
    openFollowerJoinModal,
    joinBandFromModal,
    stopSync,
    resendSetlistToBand,
    activateLicenseFromUI,
    deactivateLicenseFromUI,
    openLicenseSettings,
    openTrialLimitModal,
    closeModal
  };
})();
