/**
 * StageChart — Alapértelmezett Daltár, Setlisták és Beállítási Profilok
 * Fájl: kottak/default-library.js
 */

window.STAGECHART_DEFAULT_SONGS = [
  {
    id: 1,
    title: 'Amazing Grace',
    altTitle: 'Az Úr irgalma végtelen',
    artist: 'John Newton',
    key: 'D',
    bpm: 78,
    timeSig: '3/4',
    duration: '3:30',
    order: 'V1 V2 C V3',
    number: '01',
    copyright: 'Public Domain',
    website: 'https://youtube.com/results?search_query=Amazing+Grace',
    tags: ['Himnusz', 'Akusztikus', 'Klasszikus'],
    format: 'over',
    rehearsalNotes: {},
    audioMemo: null,
    drawingData: null,
    content: `Verse 1:
D             G        D
Amazing Grace, how sweet the sound,
                    A7
that saved a wretch like me
D             G        D
I once was lost, but now am found,
    Hm      A7       D
was blind, but now I see.

Verse 2:
D                 G        D
'Twas grace that taught my heart to fear,
                     A7
and grace my fears relieved.
D                G        D
How precious did that grace appear,
    Hm    A7       D
the hour I first believed.

Chorus:
G                D/F#
My chains are gone, I've been set free,
Em7              D
My God, my Savior has ransomed me.
G                D/F#
And like a flood His mercy reigns,
Em7        A7         D
Unending love, amazing grace.

Verse 3:
D                  G           D
When we've been there ten thousand years,
D                      A7
bright shining as the sun
D              G             D
We've no less days to sing God's praise
     Hm     A7       D
than when we first begun.`
  },
  {
    id: 2,
    title: 'Come Thou Fount',
    altTitle: 'Jöjj, te forrás',
    artist: 'Robert Robinson',
    key: 'D',
    bpm: 84,
    timeSig: '3/4',
    duration: '3:45',
    order: 'I V1 C V2',
    number: '02',
    copyright: 'Public Domain',
    website: '',
    tags: ['Worshiip', 'Zongora'],
    format: 'over',
    rehearsalNotes: {},
    audioMemo: null,
    drawingData: null,
    content: `Intro:
(Lágy zongora és Pad beúszás)
D   A   Hm   G   D   A   D

Verse 1:
D                 A
Come, Thou Fount of every blessing,
G        A          D
Tune my heart to sing Thy grace;
D                  A
Streams of mercy, never ceasing,
G         A         D
Call for songs of loudest praise.

Chorus:
Hm       G         D         A
Teach me some melodious sonnet,
Hm       G          D        A
Sung by flaming tongues above.
D                 A
Praise the mount! I'm fixed upon it,
G         A           D
Mount of Thy redeeming love.

Bridge:
G         D/F#      Em7      D
Here I raise my Ebenezer;
Hm        G         Asus4    A
Hither by Thy help I'm come;
[Vokál 2: Hither by Thy help I'm come]`
  },
  {
    id: 3,
    title: 'Take Me Home',
    altTitle: 'Country Roads',
    artist: 'John Denver',
    key: 'G',
    bpm: 90,
    timeSig: '4/4',
    duration: '3:18',
    order: 'V1 C B C',
    number: '03',
    copyright: '1971 Cherry Lane Music',
    website: '',
    tags: ['Country', 'Akusztikus', 'Közönségénekeltető'],
    format: 'over',
    rehearsalNotes: {},
    audioMemo: null,
    drawingData: null,
    content: `Verse:
F              Dm
Almost Heaven, West Virginia,
C                    Bb             F
Blue Ridge Mountains, Shenandoah River.
F                    Dm
Life is old there, older than the trees,
C
younger than the mountains,
Bb                 F
blowin like a breeze.

Chorus:
          F             C7
Country Roads, take me home,
       Dm            Bb
to the place I belong
       F              C
West Virginia, mountain mama,
        Bb            F
take me home, country roads.

Bridge:
Dm            C               F
I hear her voice in the mornin' hour she calls me,
    Bb        F             C
The radio reminds me of my home far away.
(Dinamikai leállás a refrén előtt!)`
  },
  {
    id: 4,
    title: 'Magyar Harmónia & Színpadi Teszt (Hm / B)',
    altTitle: 'Európai jelölés demó',
    artist: 'StageChart Zenekar',
    key: 'Hm',
    bpm: 112,
    timeSig: '4/4',
    duration: '4:10',
    order: 'I V1 C B C O',
    number: '04',
    copyright: 'StageChart Demo',
    website: '',
    tags: ['Magyar', 'Teszt', 'Próbaterem'],
    format: 'over',
    rehearsalNotes: {
      5: 'A basszus csak a 2. ütemben lép be!',
      14: 'Refrénben 2 szólamú vokál!'
    },
    audioMemo: null,
    drawingData: null,
    content: `Intro:
(Dob beszámolás + Hm Pad)
Hm   Gmaj7   D/F#   Asus4  A

Verse 1:
Hm                     G
Itt a magyar H-moll és B-dúr akkordok példája,
D                        A/C#
Transzponáláskor sem akad el a zeneelméleti motor.
Hm             Em7          F#7
Ha félhanggal lejjebb viszed, B-moll (Bm/Bbm) lesz,
G              Em7      F#sus4   F#7
És a peres basszusok is pontosak: Hm/A  G/H  D/F#

Chorus:
G                   D
Lebegő Ambient Pad szól a háttérben,
Em7                 Hm          A
Finom Fade-in és Fade-out átmenettel.
[Vokál 2: Finom átmenettel a háttérben]
G                   D/F#
A klikk az 1-es, a beszámolás a 2-es csatornán,
Em7       F#7       Hm
A sztereó pad pedig megy a keverőbe!

Bridge:
B                   C
Félhangos moduláció B-dúrból C-dúrba,
Gm7        C7       Fmaj7
Majd visszatérés a záró akkordokra.`
  }
];

window.STAGECHART_DEFAULT_SETLISTS = [
  {
    id: 'set_1',
    name: 'Vasárnapi Akusztikus Szett',
    date: '2026-10-25',
    targetMinutes: 20,
    songIds: [1, 2, 4],
    songOverrides: {}
  },
  {
    id: 'set_2',
    name: 'Esti Klubkoncert & Próba',
    date: '2026-10-30',
    targetMinutes: 45,
    songIds: [3, 1, 4, 2],
    songOverrides: {}
  }
];

window.STAGECHART_DEFAULT_SETTINGS = {
  // 1. Felület (UI)
  darkMode: false,
  highContrast: false,
  hideTopbarMode: 'never', // 'never', '5s', '10s'
  topbarLine1: 'title',    // 'title', 'nextSong', 'clock', 'subtitle', 'artist', 'key', 'tempo', 'setlist', 'none'
  topbarLine2: 'nextSong',
  topbarLine3: 'clock',
  compactSidebar: false,
  numberSongsInLists: true,
  touchZonesEnabled: false,
  swipePageTurn: true,
  webSearchProvider: 'YouTube',
  showHelpBadges: false,
  stageDimmerIdle: false,

  // 2. Ének megjelenítése (ChordPro & PDF)
  notation: 'hu', // 'hu' (H / B) vagy 'en' (B / Bb)
  bNoteInputMode: 'auto', // 'auto' (Intelligens), 'en_b' (A kottában írt B mindig angol B = magyar H), 'hu_b' (A kottában írt B mindig magyar B = Bb)
  pageLayout: 'auto', // 'auto', 'scroll', 'multipage', 'fit'
  longLinesBehavior: 'wrap', // 'wrap' (Hosszú sorok kettébontása) vagy 'shrink' (Betűméret csökkentése)
  warnTabsOnTranspose: true,
  accidentalsOverride: {
    'A#': 'auto', // 'auto', '#', 'b'
    'C#': 'auto',
    'D#': 'auto',
    'F#': 'auto',
    'G#': 'auto'
  },
  pdfLayout: 'default',
  pdfQuality: 'medium', // 'low', 'medium', 'high'
  pdfInvertColors: false,
  pdfAutoCrop: true,

  // 3. Ének formázása (2-oszlopos részletes testreszabás)
  formatting: {
    titleEnabled: true,
    titleSize: 38,
    titleColor: 'default',
    metaSize: 22,
    metaColor: 'default',
    showSubtitle: true,
    showArtist: true,
    showKey: true,
    showTempo: true,
    showTimeSig: false,
    showNextSong: true,
    lyricsSize: 16,
    lyricsColor: 'default',
    headingsEnabled: true,
    headingSize: 19,
    headingColor: 'default',
    headingHighlight: 'none',
    chordSize: 16,
    chordColor: '#0b5bb5',
    chordBold: true,
    chordItalic: false,
    chordHighlight: 'none',
    notesColor: '#64748b',
    notesBold: false,
    notesItalic: true,
    hideParensInChordLines: false,
    sheetBgColor: 'default',
    sectionStyles: [
      { id: 'sec_verse', name: 'Verse', font: 'Alapértelmezett', color: 'default', bold: false, italic: false, indent: false },
      { id: 'sec_chorus', name: 'Chorus', font: 'Alapértelmezett', color: 'default', bold: true, italic: false, indent: true },
      { id: 'sec_bridge', name: 'Bridge', font: 'Alapértelmezett', color: 'default', bold: false, italic: true, indent: false }
    ]
  },

  // 4. Élő gombok (FAB), Metronóm & Automatikus görgetés
  fabButtons: ['zoom', 'scroll', 'draw', 'metronome', 'nextSong', 'pageDown'],
  metronomeFlashTopbar: true,
  metronomeSoundEnabled: true,
  metronomeAutoOff: 'never', // 'never', '4bars', '8bars', '30s'
  introSilentFlashBars: 0, // 0, 4, 8
  defaultSongLengthSec: 90,
  autoScrollDelaySec: 0, // 0 vagy 10
  autoScrollOvershoot: false,
  unifiedFreehandNotes: true,
  defaultBackingTrack: false,

  // 5. Audio Munkaállomás & Csatorna-routing (Univerzális)
  audioRouting: {
    clickChannel: '0',     // Mono Out 1 (L)
    cueChannel: '1',       // Mono Out 2 (R)
    padChannelPair: '2-3', // Sztereó Out 3-4 (vagy 0-1 ha 2 csatornás a kártya)
    padCharacter: 'warm',  // 'warm' (Meleg analóg), 'strings' (Lágy vonósok), 'organ' (Templomi orgona)
    padFadeTime: 2.8,      // másodperc
    grooveStyle: 'click',  // 'click', 'pop8', 'ballad16', 'country', 'acoustic68', 'bossa', 'swing'
    countInEnabled: true
  },

  // 6. Lábkapcsolók, Vezérlők és MIDI
  pedalBindings: [
    { id: 'p1', action: 'nextPage', label: 'Következő oldal / ének', key: '>' },
    { id: 'p2', action: 'prevPage', label: 'Előző oldal / ének', key: '<' },
    { id: 'p3', action: 'scrollDown', label: 'Görgetés lefele', key: 'v' },
    { id: 'p4', action: 'scrollUp', label: 'Görgetés felfele', key: '^' },
    { id: 'p5', action: 'zoomIn', label: 'Nagyítás', key: '=' },
    { id: 'p6', action: 'zoomOut', label: 'Kicsinyítés', key: '-' },
    { id: 'p7', action: 'zoomReset', label: 'Nagyítás visszaállítása', key: '0' },
    { id: 'p8', action: 'fitPage', label: 'Oldalhoz igazítás', key: '9' }
  ],
  pedalScrollPercent: 50,
  midiEnabled: false,
  midiSendPatchOnSongChange: false,
  webcamGestureEnabled: false, // Szigorúan ki-be kapcsolható!

  // 7. Akkord diagramok
  instrument: 'Gitár', // 'Gitár', 'Zongora', 'Ukulele', 'Bendzsó', 'Mandolin', 'Egyéb'
  tuning: 'Standard',  // 'Standard', 'Drop D', 'DADGAD', 'Open D', 'Open E', 'Open G', 'Open A'
  showChordDiagramsInline: false,
  leftHandedChords: false,
  knownChords: [],

  // 8. Nyomtatás
  printFontSize: '12 pt',
  printUrlLink: true,
  printColor: false,
  printChordDiagrams: false,
  printSongNumbers: false,
  printTabletFormat: false,
  printPaperSize: 'A4',

  // 9. Biztonsági mentés és Szinkronizáció
  autoBackupWeekly: false,
  exportWithBackingTracks: false,
  onlineSyncEnabled: false,
  cloudProvider: '',
  syncFrequency: 'manual' // 'manual', 'onOpen', 'interval10m'
};
