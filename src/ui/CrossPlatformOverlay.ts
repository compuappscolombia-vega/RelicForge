import {
  formatTimeMs,
  PUZZLE_CATALOG,
  type AppSettings,
  type Difficulty,
  type GameMode,
  type LeaderboardEntry,
  type LeaderboardSort,
  type MenuView,
  type MultiplayerMode,
  type MultiplayerRoom,
  type PuzzleId,
  type RoomPlayer,
  type TutorialStep,
} from '../types.ts';

export interface OverlayCallbacks {
  onNavigate: (view: MenuView) => void;
  onSelectPuzzle: (id: PuzzleId) => void;
  onSelectDifficulty: (d: Difficulty) => void;
  onStartSolo: () => void;
  onStartTutorial: () => void;
  onRestart: () => void;
  onTogglePause: () => void;
  onHint: () => void;
  onRecenter: () => void;
  onRotate: (axis: 'x' | 'y' | 'z', dir: 1 | -1) => void;
  onNextPiece: () => void;
  onSnapPiece: () => void;
  onToggleVoice: () => void;
  onSubmitVoicePhrase: (phrase: string) => void;
  onSortLeaderboard: (sort: LeaderboardSort) => void;
  onFilterLeaderboard: (filter: PuzzleId | 'all') => void;
  onCreateRoom: (mode: MultiplayerMode) => void;
  onJoinRoom: (code: string) => void;
  onToggleReady: () => void;
  onStartRoomMatch: () => void;
  onLeaveRoom: () => void;
  onToggleSetting: (key: keyof AppSettings) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export interface OverlayState {
  view: MenuView;
  mode: GameMode;
  puzzleId: PuzzleId;
  difficulty: Difficulty;
  paused: boolean;
  elapsedMs: number;
  placedCount: number;
  totalPieces: number;
  accuracy: number;
  selectedPieceName: string | null;
  tutorialStep: TutorialStep;
  voiceListening: boolean;
  voiceTranscript: string;
  voiceLastLabel: string;
  voiceError: string | null;
  userDisplayName: string | null;
  userUid: string | null;
  leaderboard: LeaderboardEntry[];
  leaderboardSort: LeaderboardSort;
  leaderboardFilter: PuzzleId | 'all';
  room: MultiplayerRoom | null;
  players: RoomPlayer[];
  openRooms: MultiplayerRoom[];
  settings: AppSettings;
  countdownLeftSec: number;
}

const TUTORIAL_STEP_COPY: Record<TutorialStep, string> = {
  0: 'Ready to learn spatial assembly and voice commands.',
  1: 'Step 1/4: Grab the highlighted Keystone piece (Pinch or Click-Drag).',
  2: 'Step 2/4: Rotate it in 3D (Twist wrist, press Q/E/W/S, tap Rotate, or say "Rotate Left").',
  3: 'Step 3/4: Move the piece into the glowing green socket and release to snap.',
  4: 'Step 4/4: Say a voice command like "Show Leaderboard" or "Start Game" (or click Test Voice).',
  5: 'Onboarding Complete! You are ready for Solo Runs & Multiplayer Races.',
};

export class CrossPlatformOverlay {
  private root: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private dockCollapsed = false;
  private callbacks: OverlayCallbacks;
  private lastState: OverlayState | null = null;

  // Dynamic elements updated cleanly without wiping active inputs
  private timerSpan!: HTMLSpanElement;
  private statsSpan!: HTMLSpanElement;
  private selectedPieceSpan!: HTMLSpanElement;
  private voiceBtn!: HTMLButtonElement;
  private voiceTranscriptSpan!: HTMLSpanElement;
  private authBtn!: HTMLButtonElement;
  private topBannerSlot!: HTMLDivElement;
  private dockEl!: HTMLDivElement;
  private dockToggleBtn!: HTMLButtonElement;
  private tabRowEl!: HTMLDivElement;
  private bodySlot!: HTMLDivElement;
  private joinCodeValue = '';

  constructor(callbacks: OverlayCallbacks) {
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.id = 'rf-hud';
    document.body.appendChild(this.root);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'rf-toast';
    document.body.appendChild(this.toastEl);

    this.buildShell();
  }

  private buildShell(): void {
    // Top Minimal Bar
    const topBar = document.createElement('div');
    topBar.className = 'rf-top-bar';

    const leftBadge = document.createElement('div');
    leftBadge.className = 'rf-badge';

    const brand = document.createElement('span');
    brand.className = 'rf-brand';
    brand.textContent = 'RelicForge XR';

    const div1 = document.createElement('span');
    div1.className = 'rf-divider';

    this.timerSpan = document.createElement('span');
    this.timerSpan.className = 'rf-timer-val';
    this.timerSpan.textContent = '00:00.00';

    const div2 = document.createElement('span');
    div2.className = 'rf-divider';

    this.statsSpan = document.createElement('span');
    this.statsSpan.className = 'rf-stat-chip';
    this.statsSpan.textContent = '0/5 · 100%';

    this.selectedPieceSpan = document.createElement('span');
    this.selectedPieceSpan.className = 'rf-hint-text';
    this.selectedPieceSpan.textContent = '';

    leftBadge.append(brand, div1, this.timerSpan, div2, this.statsSpan, this.selectedPieceSpan);

    // Right Controls (Voice + Auth)
    const rightGroup = document.createElement('div');
    rightGroup.className = 'rf-row';

    const voiceBanner = document.createElement('div');
    voiceBanner.className = 'rf-voice-banner';

    this.voiceBtn = document.createElement('button');
    this.voiceBtn.className = 'rf-btn';
    this.voiceBtn.textContent = 'Mic: Off';
    this.voiceBtn.onclick = () => this.callbacks.onToggleVoice();

    this.voiceTranscriptSpan = document.createElement('span');
    this.voiceTranscriptSpan.className = 'rf-voice-transcript';
    this.voiceTranscriptSpan.textContent = 'Say "Start Game" or "Leaderboard"';

    const cmdInput = document.createElement('input');
    cmdInput.className = 'rf-input';
    cmdInput.type = 'text';
    cmdInput.placeholder = 'Type voice phrase...';
    cmdInput.style.width = '142px';
    cmdInput.onkeydown = (e) => {
      if (e.key === 'Enter' && cmdInput.value.trim()) {
        this.callbacks.onSubmitVoicePhrase(cmdInput.value.trim());
        cmdInput.value = '';
      }
    };

    voiceBanner.append(this.voiceBtn, this.voiceTranscriptSpan, cmdInput);

    this.authBtn = document.createElement('button');
    this.authBtn.className = 'rf-btn primary';
    this.authBtn.textContent = 'Sign in with Google';
    this.authBtn.onclick = () => {
      if (this.lastState?.userUid) {
        this.callbacks.onSignOut();
      } else {
        this.callbacks.onSignIn();
      }
    };

    rightGroup.append(voiceBanner, this.authBtn);
    topBar.append(leftBadge, rightGroup);

    // Center-top live strip (Tutorial prompt or Live Multiplayer Opponent progress)
    this.topBannerSlot = document.createElement('div');
    this.topBannerSlot.style.display = 'flex';
    this.topBannerSlot.style.justifyContent = 'center';
    this.topBannerSlot.style.marginTop = '8px';

    const topWrapper = document.createElement('div');
    topWrapper.append(topBar, this.topBannerSlot);

    // Bottom Collapsible Dock
    const dockWrap = document.createElement('div');
    dockWrap.className = 'rf-dock-wrap';

    this.dockToggleBtn = document.createElement('button');
    this.dockToggleBtn.className = 'rf-dock-toggle';
    this.dockToggleBtn.textContent = '▾ Hide Controls (H)';
    this.dockToggleBtn.onclick = () => {
      this.dockCollapsed = !this.dockCollapsed;
      this.dockEl.classList.toggle('collapsed', this.dockCollapsed);
      this.dockToggleBtn.textContent = this.dockCollapsed ? '▴ Show Controls (H)' : '▾ Hide Controls (H)';
    };

    this.dockEl = document.createElement('div');
    this.dockEl.className = 'rf-dock';

    this.tabRowEl = document.createElement('div');
    this.tabRowEl.className = 'rf-tabs';

    this.bodySlot = document.createElement('div');
    this.dockEl.append(this.tabRowEl, this.bodySlot);

    dockWrap.append(this.dockToggleBtn, this.dockEl);
    this.root.append(topWrapper, dockWrap);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  toggleDock(forceShow?: boolean): void {
    this.dockCollapsed = forceShow === undefined ? !this.dockCollapsed : !forceShow;
    this.dockEl.classList.toggle('collapsed', this.dockCollapsed);
    this.dockToggleBtn.textContent = this.dockCollapsed ? '▴ Show Controls (H)' : '▾ Hide Controls (H)';
  }

  showToast(message: string, durationMs = 2600): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, durationMs);
  }

  updateTimerOnly(elapsedMs: number, countdownLeftSec: number): void {
    this.timerSpan.textContent = countdownLeftSec > 0 ? `START ${countdownLeftSec}` : formatTimeMs(elapsedMs);
  }

  render(state: OverlayState): void {
    this.lastState = state;
    this.updateTimerOnly(state.elapsedMs, state.countdownLeftSec);
    this.statsSpan.textContent = `${state.placedCount}/${state.totalPieces} · ${state.accuracy}% Acc`;
    this.selectedPieceSpan.textContent = state.selectedPieceName ? `· ${state.selectedPieceName}` : '';

    this.voiceBtn.textContent = state.voiceListening ? 'Mic: Listening' : 'Mic: Off';
    this.voiceBtn.className = state.voiceListening ? 'rf-btn active' : 'rf-btn';
    this.voiceTranscriptSpan.textContent = state.voiceError
      ? state.voiceError
      : state.voiceTranscript
        ? `"${state.voiceTranscript}" → ${state.voiceLastLabel}`
        : state.voiceLastLabel;

    this.authBtn.textContent = state.userDisplayName ? `${state.userDisplayName} (Sign Out)` : 'Sign in with Google';
    this.authBtn.className = state.userUid ? 'rf-btn' : 'rf-btn primary';

    // Top tutorial / multiplayer race live banner
    this.renderTopBanner(state);
    this.renderTabs(state);
    this.renderDockBody(state);
  }

  private renderTopBanner(state: OverlayState): void {
    this.topBannerSlot.innerHTML = '';
    if (state.mode === 'tutorial') {
      const strip = document.createElement('div');
      strip.className = 'rf-tutorial-strip';
      const txt = document.createElement('span');
      txt.textContent = TUTORIAL_STEP_COPY[state.tutorialStep];
      strip.appendChild(txt);

      if (state.tutorialStep === 4) {
        const testBtn = document.createElement('button');
        testBtn.className = 'rf-btn primary';
        testBtn.textContent = 'Test Voice: "Show Leaderboard"';
        testBtn.onclick = () => this.callbacks.onSubmitVoicePhrase('show leaderboard');
        strip.appendChild(testBtn);
      }
      this.topBannerSlot.appendChild(strip);
    } else if (state.room && (state.mode === 'race' || state.mode === 'coop')) {
      const strip = document.createElement('div');
      strip.className = 'rf-race-strip';
      state.players.forEach((p) => {
        const chip = document.createElement('span');
        chip.className = 'rf-player-chip';
        chip.textContent = `${p.displayName} [${p.platform.toUpperCase()}]: ${p.placedCount}/${p.totalPieces}${
          p.finished ? ` ✓ ${formatTimeMs(p.finishTimeMs)}` : ''
        }`;
        strip.appendChild(chip);
      });
      this.topBannerSlot.appendChild(strip);
    }
  }

  private renderTabs(state: OverlayState): void {
    this.tabRowEl.innerHTML = '';

    const navGroup = document.createElement('div');
    navGroup.className = 'rf-tab-group';
    const tabs: Array<{ id: MenuView; label: string }> = [
      { id: 'play', label: 'Puzzles & Controls' },
      { id: 'tutorial', label: 'Tutorial' },
      { id: 'leaderboard', label: 'Leaderboard' },
      { id: 'multiplayer', label: state.room ? `Room: ${state.room.roomCode}` : 'Multiplayer' },
      { id: 'settings', label: 'Settings' },
    ];
    tabs.forEach((t) => {
      const b = document.createElement('button');
      b.className = state.view === t.id ? 'rf-btn primary' : 'rf-btn';
      b.textContent = t.label;
      b.onclick = () => this.callbacks.onNavigate(t.id);
      navGroup.appendChild(b);
    });

    // Quick manipulation strip always reachable
    const quickGroup = document.createElement('div');
    quickGroup.className = 'rf-tab-group';
    const quickBtns: Array<{ label: string; onClick: () => void }> = [
      { label: '↺ Yaw (Q)', onClick: () => this.callbacks.onRotate('y', 1) },
      { label: '↻ Yaw (E)', onClick: () => this.callbacks.onRotate('y', -1) },
      { label: '⤴ Pitch (W)', onClick: () => this.callbacks.onRotate('x', 1) },
      { label: '⟲ Roll (A)', onClick: () => this.callbacks.onRotate('z', 1) },
      { label: 'Next (Tab)', onClick: () => this.callbacks.onNextPiece() },
      { label: 'Hint', onClick: () => this.callbacks.onHint() },
      { label: 'Table', onClick: () => this.callbacks.onRecenter() },
    ];
    quickBtns.forEach((qb) => {
      const b = document.createElement('button');
      b.className = 'rf-btn';
      b.textContent = qb.label;
      b.onclick = qb.onClick;
      quickGroup.appendChild(b);
    });

    this.tabRowEl.append(navGroup, quickGroup);
  }

  private renderDockBody(state: OverlayState): void {
    this.bodySlot.innerHTML = '';

    if (state.view === 'play') {
      const row1 = document.createElement('div');
      row1.className = 'rf-row';
      (['chrono-cube', 'aether-clockwork', 'orbital-sanctum'] as PuzzleId[]).forEach((pid) => {
        const meta = PUZZLE_CATALOG[pid];
        const b = document.createElement('button');
        b.className = state.puzzleId === pid ? 'rf-btn primary' : 'rf-btn';
        b.textContent = `${meta.title} (${meta.pieceCount}pc)`;
        b.onclick = () => this.callbacks.onSelectPuzzle(pid);
        row1.appendChild(b);
      });

      const div = document.createElement('span');
      div.className = 'rf-divider';
      row1.appendChild(div);

      (['easy', 'normal', 'hard'] as Difficulty[]).forEach((d) => {
        const b = document.createElement('button');
        b.className = state.difficulty === d ? 'rf-btn active' : 'rf-btn';
        b.textContent = d.toUpperCase();
        b.onclick = () => this.callbacks.onSelectDifficulty(d);
        row1.appendChild(b);
      });

      const row2 = document.createElement('div');
      row2.className = 'rf-row';
      row2.style.marginTop = '8px';

      const startBtn = document.createElement('button');
      startBtn.className = 'rf-btn primary';
      startBtn.textContent = state.mode === 'solo' ? 'Restart Timed Run' : 'Start Timed Run';
      startBtn.onclick = () => this.callbacks.onStartSolo();

      const pauseBtn = document.createElement('button');
      pauseBtn.className = state.paused ? 'rf-btn warn' : 'rf-btn';
      pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
      pauseBtn.onclick = () => this.callbacks.onTogglePause();

      const snapBtn = document.createElement('button');
      snapBtn.className = 'rf-btn';
      snapBtn.textContent = 'Check Snap (Space)';
      snapBtn.onclick = () => this.callbacks.onSnapPiece();

      const tip = document.createElement('span');
      tip.className = 'rf-hint-text';
      tip.textContent = 'Controls: Drag pieces (Pinch in XR) · Twist wrist or Q/E/W/S/A/D/Wheel to rotate · Say voice commands anytime.';

      row2.append(startBtn, pauseBtn, snapBtn, tip);
      this.bodySlot.append(row1, row2);
      return;
    }

    if (state.view === 'tutorial') {
      const wrap = document.createElement('div');
      wrap.className = 'rf-row';
      wrap.style.justifyContent = 'space-between';

      const info = document.createElement('div');
      info.innerHTML = `<strong>Onboarding Academy</strong> — ${TUTORIAL_STEP_COPY[state.tutorialStep]}`;
      info.style.fontSize = '13px';

      const actions = document.createElement('div');
      actions.className = 'rf-row';

      const launchBtn = document.createElement('button');
      launchBtn.className = 'rf-btn primary';
      launchBtn.textContent = state.mode === 'tutorial' ? 'Restart Tutorial' : 'Start Guided Tutorial';
      launchBtn.onclick = () => this.callbacks.onStartTutorial();
      actions.appendChild(launchBtn);

      if (state.mode === 'tutorial' && state.tutorialStep === 4) {
        const testVoiceBtn = document.createElement('button');
        testVoiceBtn.className = 'rf-btn active';
        testVoiceBtn.textContent = 'Complete Voice Step';
        testVoiceBtn.onclick = () => this.callbacks.onSubmitVoicePhrase('open leaderboard');
        actions.appendChild(testVoiceBtn);
      }

      wrap.append(info, actions);
      this.bodySlot.appendChild(wrap);
      return;
    }

    if (state.view === 'leaderboard') {
      const controls = document.createElement('div');
      controls.className = 'rf-row';
      controls.style.justifyContent = 'space-between';
      controls.style.marginBottom = '8px';

      const sortGroup = document.createElement('div');
      sortGroup.className = 'rf-row';
      const sorts: Array<{ id: LeaderboardSort; label: string }> = [
        { id: 'score', label: 'Sort: Top Score' },
        { id: 'bestTimeMs', label: 'Sort: Best Time' },
        { id: 'accuracy', label: 'Sort: Accuracy %' },
      ];
      sorts.forEach((s) => {
        const b = document.createElement('button');
        b.className = state.leaderboardSort === s.id ? 'rf-btn primary' : 'rf-btn';
        b.textContent = s.label;
        b.onclick = () => this.callbacks.onSortLeaderboard(s.id);
        sortGroup.appendChild(b);
      });

      const filterGroup = document.createElement('div');
      filterGroup.className = 'rf-row';
      (['all', 'chrono-cube', 'aether-clockwork', 'orbital-sanctum'] as Array<PuzzleId | 'all'>).forEach((f) => {
        const b = document.createElement('button');
        b.className = state.leaderboardFilter === f ? 'rf-btn active' : 'rf-btn';
        b.textContent = f === 'all' ? 'All Puzzles' : PUZZLE_CATALOG[f].title;
        b.onclick = () => this.callbacks.onFilterLeaderboard(f);
        filterGroup.appendChild(b);
      });

      controls.append(sortGroup, filterGroup);

      const myIdx = state.userUid ? state.leaderboard.findIndex((e) => e.uid === state.userUid) : -1;
      const rankNote = document.createElement('div');
      rankNote.className = 'rf-hint-text';
      rankNote.style.marginBottom = '6px';
      rankNote.textContent = myIdx >= 0
        ? `Your Global Rank: #${myIdx + 1} of ${state.leaderboard.length} (${state.leaderboard[myIdx].score} pts · ${formatTimeMs(state.leaderboard[myIdx].bestTimeMs)})`
        : state.userUid
          ? 'Complete any timed puzzle to post your score on the global leaderboard.'
          : 'Sign in with Google to save and rank your scores globally.';

      const table = document.createElement('table');
      table.className = 'rf-table';
      table.innerHTML = '<thead><tr><th>#</th><th>Player</th><th>Puzzle</th><th>Difficulty</th><th>Time</th><th>Accuracy</th><th>Score</th><th>Device</th></tr></thead>';
      const tbody = document.createElement('tbody');

      const topRows = state.leaderboard.slice(0, 12);
      if (topRows.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="8" style="color:#94a3b8">No scores recorded yet for this filter. Be the first!</td>';
        tbody.appendChild(tr);
      } else {
        topRows.forEach((e, idx) => {
          const tr = document.createElement('tr');
          if (state.userUid && e.uid === state.userUid) tr.className = 'me';
          const cells = [
            `#${idx + 1}`,
            e.displayName,
            e.puzzleTitle,
            e.difficulty.toUpperCase(),
            formatTimeMs(e.bestTimeMs),
            `${e.accuracy}%`,
            String(e.score),
            e.platform.toUpperCase(),
          ];
          cells.forEach((c) => {
            const td = document.createElement('td');
            td.textContent = c;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
      }
      table.appendChild(tbody);
      this.bodySlot.append(controls, rankNote, table);
      return;
    }

    if (state.view === 'multiplayer') {
      if (!state.room) {
        const row = document.createElement('div');
        row.className = 'rf-row';

        const hostRace = document.createElement('button');
        hostRace.className = 'rf-btn primary';
        hostRace.textContent = 'Host Speed Race';
        hostRace.onclick = () => this.callbacks.onCreateRoom('race');

        const hostCoop = document.createElement('button');
        hostCoop.className = 'rf-btn active';
        hostCoop.textContent = 'Host Shared Co-op';
        hostCoop.onclick = () => this.callbacks.onCreateRoom('coop');

        const codeInput = document.createElement('input');
        codeInput.className = 'rf-input';
        codeInput.placeholder = 'Room Code (e.g. XR4K9M)';
        codeInput.value = this.joinCodeValue;
        codeInput.oninput = () => {
          this.joinCodeValue = codeInput.value.toUpperCase();
        };

        const joinBtn = document.createElement('button');
        joinBtn.className = 'rf-btn';
        joinBtn.textContent = 'Join Room';
        joinBtn.onclick = () => {
          if (this.joinCodeValue.trim()) {
            this.callbacks.onJoinRoom(this.joinCodeValue.trim());
          }
        };

        row.append(hostRace, hostCoop, codeInput, joinBtn);
        this.bodySlot.appendChild(row);

        if (state.openRooms.length > 0) {
          const openRow = document.createElement('div');
          openRow.className = 'rf-row';
          openRow.style.marginTop = '8px';
          const lbl = document.createElement('span');
          lbl.className = 'rf-hint-text';
          lbl.textContent = 'Open Lobbies:';
          openRow.appendChild(lbl);

          state.openRooms.slice(0, 5).forEach((rm) => {
            const b = document.createElement('button');
            b.className = 'rf-btn';
            b.textContent = `${rm.roomCode} · ${rm.hostName} (${rm.mode.toUpperCase()} ${rm.playerCount}/8)`;
            b.onclick = () => this.callbacks.onJoinRoom(rm.roomCode);
            openRow.appendChild(b);
          });
          this.bodySlot.appendChild(openRow);
        }
      } else {
        const rm = state.room;
        const header = document.createElement('div');
        header.className = 'rf-row';
        header.style.justifyContent = 'space-between';

        const meta = document.createElement('span');
        meta.style.fontSize = '13px';
        meta.innerHTML = `Room <strong>${rm.roomCode}</strong> · ${rm.mode.toUpperCase()} · ${PUZZLE_CATALOG[rm.puzzleId].title} (${rm.status.toUpperCase()})`;

        const btns = document.createElement('div');
        btns.className = 'rf-row';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'rf-btn';
        copyBtn.textContent = 'Copy Invite Link';
        copyBtn.onclick = () => {
          const url = `${window.location.origin}${window.location.pathname}?room=${rm.roomCode}`;
          navigator.clipboard?.writeText(url).catch(() => {});
          this.showToast(`Invite link copied for Room ${rm.roomCode}!`);
        };

        const readyBtn = document.createElement('button');
        readyBtn.className = 'rf-btn active';
        readyBtn.textContent = 'Toggle Ready';
        readyBtn.onclick = () => this.callbacks.onToggleReady();

        btns.append(copyBtn, readyBtn);

        if (rm.hostUid === state.userUid) {
          const startBtn = document.createElement('button');
          startBtn.className = 'rf-btn primary';
          startBtn.textContent = rm.status === 'finished' ? 'Reset / Rematch' : 'Start Match';
          startBtn.disabled = rm.status === 'playing' || rm.status === 'countdown';
          startBtn.onclick = () => this.callbacks.onStartRoomMatch();
          btns.appendChild(startBtn);
        }

        const leaveBtn = document.createElement('button');
        leaveBtn.className = 'rf-btn warn';
        leaveBtn.textContent = 'Leave Room';
        leaveBtn.onclick = () => this.callbacks.onLeaveRoom();
        btns.appendChild(leaveBtn);

        header.append(meta, btns);

        const roster = document.createElement('div');
        roster.className = 'rf-row';
        roster.style.marginTop = '8px';
        state.players.forEach((p) => {
          const chip = document.createElement('span');
          chip.className = 'rf-player-chip';
          chip.textContent = `${p.displayName} [${p.platform.toUpperCase()}] · ${p.ready ? 'READY' : 'WAIT'} · ${p.placedCount}/${p.totalPieces}`;
          roster.appendChild(chip);
        });

        this.bodySlot.append(header, roster);
      }
      return;
    }

    if (state.view === 'settings') {
      const row = document.createElement('div');
      row.className = 'rf-row';

      const items: Array<{ key: keyof AppSettings; label: string }> = [
        { key: 'sfxEnabled', label: `Sound FX: ${state.settings.sfxEnabled ? 'On' : 'Off'}` },
        { key: 'ghostGuides', label: `Ghost Guides: ${state.settings.ghostGuides ? 'On' : 'Off'}` },
        { key: 'snapAssist', label: `Snap Assist: ${state.settings.snapAssist ? 'On' : 'Off'}` },
        { key: 'ttsEnabled', label: `Voice TTS Feedback: ${state.settings.ttsEnabled ? 'On' : 'Off'}` },
      ];
      items.forEach((it) => {
        const b = document.createElement('button');
        b.className = state.settings[it.key] ? 'rf-btn active' : 'rf-btn';
        b.textContent = it.label;
        b.onclick = () => this.callbacks.onToggleSetting(it.key);
        row.appendChild(b);
      });

      const voiceHelp = document.createElement('div');
      voiceHelp.className = 'rf-hint-text';
      voiceHelp.style.marginTop = '8px';
      voiceHelp.textContent =
        'Voice Commands: "Open Menu", "Show Leaderboard", "Sort by Time", "Open Multiplayer", "Start Tutorial", "Chrono Cube", "Clockwork", "Orbital", "Easy / Normal / Hard", "Start Game", "Restart", "Hint", "Rotate Left / Right / Up", "Flip", "Next Piece", "Recenter".';

      this.bodySlot.append(row, voiceHelp);
    }
  }
}
