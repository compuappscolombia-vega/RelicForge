import * as THREE from 'three';
import * as xb from 'xrblocks';
import {
  formatTimeMs,
  PUZZLE_CATALOG,
  type AppSettings,
  type Difficulty,
  type GameMode,
  type LeaderboardEntry,
  type LeaderboardSort,
  type MenuView,
  type MultiplayerRoom,
  type PuzzleId,
  type RoomPlayer,
  type TutorialStep,
} from '../types.ts';

export interface SpatialHUDActions {
  onNavigate: (view: MenuView) => void;
  onSelectPuzzle: (id: PuzzleId) => void;
  onSelectDifficulty: (d: Difficulty) => void;
  onStartSolo: () => void;
  onStartTutorial: () => void;
  onRestart: () => void;
  onHint: () => void;
  onRecenter: () => void;
  onRotate: (axis: 'x' | 'y' | 'z', dir: 1 | -1) => void;
  onToggleVoice: () => void;
  onSortLeaderboard: (sort: LeaderboardSort) => void;
  onCreateRoom: (mode: 'race' | 'coop') => void;
  onToggleReady: () => void;
  onStartRoomMatch: () => void;
  onLeaveRoom: () => void;
  onToggleSetting: (key: keyof AppSettings) => void;
  onSignIn: () => void;
}

const TUTORIAL_TEXT: Record<TutorialStep, string> = {
  0: 'Select Tutorial to practice hand gestures and voice navigation.',
  1: 'STEP 1/4 — PINCH & GRAB\nPinch (or click-drag) the glowing piece to lift it.',
  2: 'STEP 2/4 — 3D ROTATION\nTwist your wrist (or press Q/E/W/S or say "Rotate Left") to align.',
  3: 'STEP 3/4 — MAGNETIC SNAP\nMove the piece into the green holographic socket and release.',
  4: 'STEP 4/4 — VOICE COMMAND\nSay "Show Leaderboard" or "Start Game" (or tap Voice Test).',
  5: 'ONBOARDING COMPLETE!\nYou mastered hand assembly & voice commands.',
};

export class SpatialHUD extends xb.Script {
  private actions: SpatialHUDActions;

  private menuCard!: xb.UICard;
  private statusCard!: xb.UICard;

  // Status card elements
  private statusModeText!: xb.UIText;
  private statusTimerText!: xb.UIText;
  private statusStatsText!: xb.UIText;
  private statusBannerText!: xb.UIText;
  private voiceBadgeText!: xb.UIText;

  // Menu card elements
  private authBtn!: xb.UIButton;
  private voiceBtn!: xb.UIButton;
  private bodyHeaderText!: xb.UIText;
  private bodyDetailText!: xb.UIText;

  // Section panels (toggled via .visible)
  private playPanel!: xb.UIPanel;
  private tutorialPanel!: xb.UIPanel;
  private leaderboardPanel!: xb.UIPanel;
  private multiplayerPanel!: xb.UIPanel;
  private settingsPanel!: xb.UIPanel;

  private puzzleBtns: Record<PuzzleId, xb.UIButton> = {} as Record<PuzzleId, xb.UIButton>;
  private diffBtns: Record<Difficulty, xb.UIButton> = {} as Record<Difficulty, xb.UIButton>;
  private lbRowsText!: xb.UIText;
  private lbRankText!: xb.UIText;
  private mpRoomText!: xb.UIText;
  private mpPlayersText!: xb.UIText;
  private mpStartBtn!: xb.UIButton;
  private mpReadyBtn!: xb.UIButton;

  private sfxBtn!: xb.UIButton;
  private ghostBtn!: xb.UIButton;
  private snapBtn!: xb.UIButton;
  private ttsBtn!: xb.UIButton;

  constructor(actions: SpatialHUDActions) {
    super();
    this.actions = actions;
  }

  override init(): void {
    xb.ui.setTheme({
      colors: {
        surface: 'rgba(11, 17, 30, 0.9)',
        raisedSurface: 'rgba(30, 41, 59, 0.95)',
        primary: '#38bdf8',
        primaryText: '#082f49',
        text: '#f8fafc',
        secondaryText: '#94a3b8',
        outline: 'rgba(148, 163, 184, 0.35)',
      },
      borderRadius: 16,
    });

    // 1. Compact Floating Status & Timer Card above-right of workbench
    this.statusTimerText = new xb.UIText({
      text: '00:00.00',
      style: { fontSize: 30, fontWeight: 'bold', color: '#fbbf24' },
    });
    this.statusModeText = new xb.UIText({
      text: 'RELICFORGE XR',
      style: { fontSize: 16, color: '#38bdf8', fontWeight: 'bold' },
    });
    this.statusStatsText = new xb.UIText({
      text: 'Pieces: 0/5  |  Acc: 100%',
      style: { fontSize: 17, color: '#e2e8f0' },
    });
    this.statusBannerText = new xb.UIText({
      text: 'Pinch or drag pieces onto the glowing sockets.',
      style: { fontSize: 15, color: '#cbd5e1', whiteSpace: 'pre-line' },
    });
    this.voiceBadgeText = new xb.UIText({
      text: 'Voice: Ready ("Start Game", "Rotate Left")',
      style: { fontSize: 14, color: '#7dd3fc' },
    });

    this.statusCard = new xb.UICard({
      size: { width: 0.44, height: 'auto' },
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 8,
        padding: 16,
        backgroundColor: 'rgba(10, 16, 28, 0.9)',
        borderRadius: 18,
      },
      children: [
        new xb.UIPanel({
          style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
          children: [this.statusModeText, this.statusTimerText],
        }),
        this.statusStatsText,
        this.statusBannerText,
        this.voiceBadgeText,
        new xb.UIPanel({
          style: { flexDirection: 'row', gap: 6, marginTop: 4 },
          children: [
            new xb.UIButton({ label: 'Rot L', onClick: () => this.actions.onRotate('y', 1), style: { padding: 8, fontSize: 14 } }),
            new xb.UIButton({ label: 'Rot R', onClick: () => this.actions.onRotate('y', -1), style: { padding: 8, fontSize: 14 } }),
            new xb.UIButton({ label: 'Hint', onClick: () => this.actions.onHint(), style: { padding: 8, fontSize: 14 } }),
            new xb.UIButton({ label: 'Table', onClick: () => this.actions.onRecenter(), style: { padding: 8, fontSize: 14 } }),
          ],
        }),
      ],
    });
    this.statusCard.position.set(0.42, 1.32, -0.78);
    this.statusCard.add(new xb.FaceCamera({ mode: 'capsule', smoothing: 0.12 }));
    this.add(this.statusCard);

    // 2. Spatial Command Menu Card to the left of workbench
    this.authBtn = new xb.UIButton({
      label: 'Sign In',
      onClick: () => this.actions.onSignIn(),
      style: { fontSize: 14, padding: 8 },
    });
    this.voiceBtn = new xb.UIButton({
      label: 'Voice: Off',
      onClick: () => this.actions.onToggleVoice(),
      style: { fontSize: 14, padding: 8 },
    });

    this.bodyHeaderText = new xb.UIText({
      text: 'Puzzle Arena',
      style: { fontSize: 22, fontWeight: 'bold', color: '#f8fafc' },
    });
    this.bodyDetailText = new xb.UIText({
      text: 'Choose a relic and difficulty to begin.',
      style: { fontSize: 15, color: '#94a3b8', whiteSpace: 'pre-line' },
    });

    // Play Panel
    this.puzzleBtns['chrono-cube'] = new xb.UIButton({
      label: 'Chrono Cube',
      onClick: () => this.actions.onSelectPuzzle('chrono-cube'),
      style: { fontSize: 14, padding: 8 },
    });
    this.puzzleBtns['aether-clockwork'] = new xb.UIButton({
      label: 'Clockwork',
      onClick: () => this.actions.onSelectPuzzle('aether-clockwork'),
      style: { fontSize: 14, padding: 8 },
    });
    this.puzzleBtns['orbital-sanctum'] = new xb.UIButton({
      label: 'Orbital',
      onClick: () => this.actions.onSelectPuzzle('orbital-sanctum'),
      style: { fontSize: 14, padding: 8 },
    });

    this.diffBtns.easy = new xb.UIButton({
      label: 'Easy',
      onClick: () => this.actions.onSelectDifficulty('easy'),
      style: { fontSize: 14, padding: 7 },
    });
    this.diffBtns.normal = new xb.UIButton({
      label: 'Normal',
      onClick: () => this.actions.onSelectDifficulty('normal'),
      style: { fontSize: 14, padding: 7 },
    });
    this.diffBtns.hard = new xb.UIButton({
      label: 'Hard',
      onClick: () => this.actions.onSelectDifficulty('hard'),
      style: { fontSize: 14, padding: 7 },
    });

    this.playPanel = new xb.UIPanel({
      style: { flexDirection: 'column', gap: 10 },
      children: [
        new xb.UIPanel({
          style: { flexDirection: 'row', gap: 6 },
          children: [
            this.puzzleBtns['chrono-cube'],
            this.puzzleBtns['aether-clockwork'],
            this.puzzleBtns['orbital-sanctum'],
          ],
        }),
        new xb.UIPanel({
          style: { flexDirection: 'row', gap: 6 },
          children: [this.diffBtns.easy, this.diffBtns.normal, this.diffBtns.hard],
        }),
        new xb.UIPanel({
          style: { flexDirection: 'row', gap: 8 },
          children: [
            new xb.UIButton({
              label: 'Start Timed Run',
              onClick: () => this.actions.onStartSolo(),
              style: { fontSize: 15, padding: 10, backgroundColor: '#0284c7' },
            }),
            new xb.UIButton({
              label: 'Reset',
              onClick: () => this.actions.onRestart(),
              style: { fontSize: 15, padding: 10 },
            }),
          ],
        }),
      ],
    });

    // Tutorial Panel
    this.tutorialPanel = new xb.UIPanel({
      style: { flexDirection: 'column', gap: 10 },
      children: [
        new xb.UIButton({
          label: 'Launch Guided Onboarding',
          onClick: () => this.actions.onStartTutorial(),
          style: { fontSize: 15, padding: 10, backgroundColor: '#0f766e' },
        }),
      ],
    });
    this.tutorialPanel.visible = false;

    // Leaderboard Panel
    this.lbRankText = new xb.UIText({
      text: 'Global Top Rankings',
      style: { fontSize: 15, color: '#fbbf24', fontWeight: 'bold' },
    });
    this.lbRowsText = new xb.UIText({
      text: 'Loading global scores...',
      style: { fontSize: 14, color: '#e2e8f0', whiteSpace: 'pre-line', lineHeight: 1.35 },
    });
    this.leaderboardPanel = new xb.UIPanel({
      style: { flexDirection: 'column', gap: 8 },
      children: [
        new xb.UIPanel({
          style: { flexDirection: 'row', gap: 6 },
          children: [
            new xb.UIButton({ label: 'By Score', onClick: () => this.actions.onSortLeaderboard('score'), style: { fontSize: 13, padding: 7 } }),
            new xb.UIButton({ label: 'Best Time', onClick: () => this.actions.onSortLeaderboard('bestTimeMs'), style: { fontSize: 13, padding: 7 } }),
            new xb.UIButton({ label: 'Accuracy', onClick: () => this.actions.onSortLeaderboard('accuracy'), style: { fontSize: 13, padding: 7 } }),
          ],
        }),
        this.lbRankText,
        this.lbRowsText,
      ],
    });
    this.leaderboardPanel.visible = false;

    // Multiplayer Panel
    this.mpRoomText = new xb.UIText({
      text: 'Host a cross-platform room for VR, PC & Mobile.',
      style: { fontSize: 14, color: '#e2e8f0', whiteSpace: 'pre-line' },
    });
    this.mpPlayersText = new xb.UIText({
      text: '',
      style: { fontSize: 14, color: '#7dd3fc', whiteSpace: 'pre-line' },
    });
    this.mpReadyBtn = new xb.UIButton({
      label: 'Ready',
      onClick: () => this.actions.onToggleReady(),
      style: { fontSize: 14, padding: 8 },
    });
    this.mpStartBtn = new xb.UIButton({
      label: 'Start Match',
      onClick: () => this.actions.onStartRoomMatch(),
      style: { fontSize: 14, padding: 8, backgroundColor: '#0284c7' },
    });

    this.multiplayerPanel = new xb.UIPanel({
      style: { flexDirection: 'column', gap: 8 },
      children: [
        this.mpRoomText,
        this.mpPlayersText,
        new xb.UIPanel({
          style: { flexDirection: 'row', gap: 6 },
          children: [
            new xb.UIButton({ label: 'Host Race', onClick: () => this.actions.onCreateRoom('race'), style: { fontSize: 13, padding: 8 } }),
            new xb.UIButton({ label: 'Host Co-op', onClick: () => this.actions.onCreateRoom('coop'), style: { fontSize: 13, padding: 8 } }),
            this.mpReadyBtn,
            this.mpStartBtn,
            new xb.UIButton({ label: 'Leave', onClick: () => this.actions.onLeaveRoom(), style: { fontSize: 13, padding: 8 } }),
          ],
        }),
      ],
    });
    this.multiplayerPanel.visible = false;

    // Settings Panel
    this.sfxBtn = new xb.UIButton({ label: 'SFX: On', onClick: () => this.actions.onToggleSetting('sfxEnabled'), style: { fontSize: 14, padding: 8 } });
    this.ghostBtn = new xb.UIButton({ label: 'Guides: On', onClick: () => this.actions.onToggleSetting('ghostGuides'), style: { fontSize: 14, padding: 8 } });
    this.snapBtn = new xb.UIButton({ label: 'Snap Assist: On', onClick: () => this.actions.onToggleSetting('snapAssist'), style: { fontSize: 14, padding: 8 } });
    this.ttsBtn = new xb.UIButton({ label: 'Voice TTS: Off', onClick: () => this.actions.onToggleSetting('ttsEnabled'), style: { fontSize: 14, padding: 8 } });

    this.settingsPanel = new xb.UIPanel({
      style: { flexDirection: 'column', gap: 8 },
      children: [
        new xb.UIPanel({
          style: { flexDirection: 'row', gap: 8 },
          children: [this.sfxBtn, this.ghostBtn],
        }),
        new xb.UIPanel({
          style: { flexDirection: 'row', gap: 8 },
          children: [this.snapBtn, this.ttsBtn],
        }),
      ],
    });
    this.settingsPanel.visible = false;

    this.menuCard = new xb.UICard({
      size: { width: 0.56, height: 'auto' },
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 10,
        padding: 18,
        backgroundColor: 'rgba(10, 16, 28, 0.92)',
        borderRadius: 20,
      },
      children: [
        new xb.UIPanel({
          style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
          children: [
            new xb.UIText({ text: 'RelicForge XR', style: { fontSize: 20, fontWeight: 'bold', color: '#38bdf8' } }),
            new xb.UIPanel({
              style: { flexDirection: 'row', gap: 6 },
              children: [this.voiceBtn, this.authBtn],
            }),
          ],
        }),
        new xb.UIPanel({
          style: { flexDirection: 'row', gap: 5 },
          children: [
            new xb.UIButton({ label: 'Play', onClick: () => this.actions.onNavigate('play'), style: { fontSize: 13, padding: 7 } }),
            new xb.UIButton({ label: 'Tutorial', onClick: () => this.actions.onNavigate('tutorial'), style: { fontSize: 13, padding: 7 } }),
            new xb.UIButton({ label: 'Ranks', onClick: () => this.actions.onNavigate('leaderboard'), style: { fontSize: 13, padding: 7 } }),
            new xb.UIButton({ label: 'Friends', onClick: () => this.actions.onNavigate('multiplayer'), style: { fontSize: 13, padding: 7 } }),
            new xb.UIButton({ label: 'Config', onClick: () => this.actions.onNavigate('settings'), style: { fontSize: 13, padding: 7 } }),
          ],
        }),
        this.bodyHeaderText,
        this.bodyDetailText,
        this.playPanel,
        this.tutorialPanel,
        this.leaderboardPanel,
        this.multiplayerPanel,
        this.settingsPanel,
      ],
    });
    this.menuCard.position.set(-0.48, 1.24, -0.78);
    this.menuCard.add(new xb.FaceCamera({ mode: 'capsule', smoothing: 0.12 }));
    this.add(this.menuCard);
  }

  updateTimerOnly(elapsedMs: number, countdownLeftSec: number): void {
    if (!this.statusTimerText) return;
    this.statusTimerText.text = countdownLeftSec > 0
      ? `GO IN ${countdownLeftSec}`
      : formatTimeMs(elapsedMs);
  }

  syncState(state: {
    view: MenuView;
    mode: GameMode;
    puzzleId: PuzzleId;
    difficulty: Difficulty;
    elapsedMs: number;
    placedCount: number;
    totalPieces: number;
    accuracy: number;
    tutorialStep: TutorialStep;
    voiceListening: boolean;
    voiceLastLabel: string;
    userDisplayName: string | null;
    userUid: string | null;
    leaderboard: LeaderboardEntry[];
    leaderboardSort: LeaderboardSort;
    room: MultiplayerRoom | null;
    players: RoomPlayer[];
    settings: AppSettings;
    countdownLeftSec: number;
  }): void {
    if (!this.statusTimerText) return;

    this.statusTimerText.text = state.countdownLeftSec > 0
      ? `GO IN ${state.countdownLeftSec}`
      : formatTimeMs(state.elapsedMs);
    this.statusModeText.text = `${PUZZLE_CATALOG[state.puzzleId].title.toUpperCase()} · ${state.mode.toUpperCase()}`;
    this.statusStatsText.text = `Pieces: ${state.placedCount}/${state.totalPieces}  |  Accuracy: ${state.accuracy}%`;
    this.voiceBadgeText.text = state.voiceListening
      ? `Mic On · ${state.voiceLastLabel}`
      : `Mic Off · ${state.voiceLastLabel}`;

    if (state.mode === 'tutorial') {
      this.statusBannerText.text = TUTORIAL_TEXT[state.tutorialStep];
    } else if (state.room && (state.mode === 'race' || state.mode === 'coop')) {
      const oppSummary = state.players
        .slice(0, 3)
        .map((p) => `${p.displayName}: ${p.placedCount}/${p.totalPieces}${p.finished ? ' ✓' : ''}`)
        .join('  |  ');
      this.statusBannerText.text = `Room ${state.room.roomCode} (${state.room.mode.toUpperCase()})\n${oppSummary}`;
    } else {
      this.statusBannerText.text = 'Pinch & twist wrist to rotate. Release inside green ghost socket.';
    }

    this.authBtn.label = state.userDisplayName ? state.userDisplayName.slice(0, 12) : 'Sign In';
    this.voiceBtn.label = state.voiceListening ? 'Voice: On' : 'Voice: Off';

    // Show active panel
    this.playPanel.visible = state.view === 'play';
    this.tutorialPanel.visible = state.view === 'tutorial';
    this.leaderboardPanel.visible = state.view === 'leaderboard';
    this.multiplayerPanel.visible = state.view === 'multiplayer';
    this.settingsPanel.visible = state.view === 'settings';

    if (state.view === 'play') {
      const meta = PUZZLE_CATALOG[state.puzzleId];
      this.bodyHeaderText.text = meta.title;
      this.bodyDetailText.text = `${meta.subtitle}\nDifficulty: ${state.difficulty.toUpperCase()}`;
    } else if (state.view === 'tutorial') {
      this.bodyHeaderText.text = 'Onboarding Academy';
      this.bodyDetailText.text = TUTORIAL_TEXT[state.tutorialStep];
    } else if (state.view === 'leaderboard') {
      this.bodyHeaderText.text = 'Global Leaderboard';
      this.bodyDetailText.text = `Sorted by ${state.leaderboardSort === 'bestTimeMs' ? 'Best Time' : state.leaderboardSort === 'accuracy' ? 'Accuracy' : 'Total Score'}`;
      const top = state.leaderboard.slice(0, 5);
      const myRankIdx = state.userUid ? state.leaderboard.findIndex((e) => e.uid === state.userUid) : -1;
      this.lbRankText.text = myRankIdx >= 0 ? `Your Global Rank: #${myRankIdx + 1} of ${state.leaderboard.length}` : `${state.leaderboard.length} Global Records`;
      this.lbRowsText.text = top.length > 0
        ? top
            .map((e, i) => `#${i + 1} ${e.displayName.slice(0, 12)} · ${e.score}pts · ${formatTimeMs(e.bestTimeMs)} (${e.accuracy}%)`)
            .join('\n')
        : 'No records yet. Complete a timed run to claim #1!';
    } else if (state.view === 'multiplayer') {
      this.bodyHeaderText.text = 'Cross-Platform Arena';
      this.bodyDetailText.text = 'Real-time sync for VR, PC & Mobile';
      if (state.room) {
        this.mpRoomText.text = `Room: ${state.room.roomCode} (${state.room.mode.toUpperCase()}) · ${state.room.status.toUpperCase()}`;
        this.mpPlayersText.text = state.players
          .map((p) => `${p.displayName} [${p.platform.toUpperCase()}] ${p.ready ? 'READY' : '...'}`)
          .join('\n');
        this.mpStartBtn.disabled = state.room.hostUid !== state.userUid || state.room.status === 'playing';
      } else {
        this.mpRoomText.text = 'Create a Race or Co-op room and share the 6-char code.';
        this.mpPlayersText.text = '';
        this.mpStartBtn.disabled = true;
      }
    } else if (state.view === 'settings') {
      this.bodyHeaderText.text = 'Settings & Controls';
      this.bodyDetailText.text = 'Voice: "Start Game", "Show Leaderboard", "Rotate Left", "Hint"';
      this.sfxBtn.label = `SFX: ${state.settings.sfxEnabled ? 'On' : 'Off'}`;
      this.ghostBtn.label = `Guides: ${state.settings.ghostGuides ? 'On' : 'Off'}`;
      this.snapBtn.label = `Snap Assist: ${state.settings.snapAssist ? 'On' : 'Off'}`;
      this.ttsBtn.label = `Voice TTS: ${state.settings.ttsEnabled ? 'On' : 'Off'}`;
    }

    // Highlight active puzzle & difficulty buttons
    (['chrono-cube', 'aether-clockwork', 'orbital-sanctum'] as PuzzleId[]).forEach((pid) => {
      this.puzzleBtns[pid].style.backgroundColor = pid === state.puzzleId ? '#0284c7' : undefined;
    });
    (['easy', 'normal', 'hard'] as Difficulty[]).forEach((d) => {
      this.diffBtns[d].style.backgroundColor = d === state.difficulty ? '#0f766e' : undefined;
    });
  }

  validateLayout(): void {
    const r = xb.ui.validate();
    if (r.ready && !r.ok) {
      console.warn('Spatial UI validation issues:', r.issues);
    }
  }
}
