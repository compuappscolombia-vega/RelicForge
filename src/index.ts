import * as THREE from 'three';
import * as xb from 'xrblocks';
import { type User as FirebaseUser } from 'firebase/auth';
import { type Unsubscribe } from 'firebase/firestore';
import { soundFX } from './audio/SoundFX.ts';
import {
  claimRoomWinner,
  createMultiplayerRoom,
  ensureUserProfile,
  initRoomPieces,
  joinMultiplayerRoom,
  leaveMultiplayerRoom,
  onAuthChange,
  signInWithGoogle,
  signOutUser,
  submitLeaderboardScore,
  subscribeLeaderboard,
  subscribeOpenRooms,
  subscribeRoom,
  updatePlayerProgress,
  updateRoomConfig,
  updateRoomPiece,
} from './firebase/client.ts';
import { PuzzleArena } from './puzzle/PuzzleArena.ts';
import { type PuzzlePieceScript } from './puzzle/PuzzlePieceScript.ts';
import {
  calculateScore,
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
  type RoomPieceState,
  type RoomPlayer,
  type TutorialStep,
} from './types.ts';
import { CrossPlatformOverlay } from './ui/CrossPlatformOverlay.ts';
import { SpatialHUD } from './ui/SpatialHUD.ts';
import { type VoiceAction, VoiceController, type VoiceStatus } from './voice/VoiceController.ts';

class RelicForgeApp extends xb.Script {
  private arena!: PuzzleArena;
  private spatialHud!: SpatialHUD;
  private overlay!: CrossPlatformOverlay;
  private voice!: VoiceController;

  // Game & Menu State
  private view: MenuView = 'play';
  private mode: GameMode = 'solo';
  private puzzleId: PuzzleId = 'chrono-cube';
  private difficulty: Difficulty = 'normal';
  private tutorialStep: TutorialStep = 0;

  // Timer & Accuracy
  private runStarted = false;
  private runFinished = false;
  private elapsedMs = 0;
  private countdownEndMs = 0;
  private lastCountdownTick = 0;
  private countdownLeftSec = 0;

  // Settings
  private settings: AppSettings = {
    voiceEnabled: false,
    ttsEnabled: false,
    sfxEnabled: true,
    ghostGuides: true,
    snapAssist: true,
  };

  // Voice status
  private voiceStatus: VoiceStatus = {
    listening: false,
    supported: true,
    lastTranscript: '',
    lastActionLabel: 'Ready',
    error: null,
  };

  // Auth & Leaderboard
  private currentUser: FirebaseUser | null = null;
  private allLeaderboardEntries: LeaderboardEntry[] = [];
  private leaderboardSort: LeaderboardSort = 'score';
  private leaderboardFilter: PuzzleId | 'all' = 'all';

  // Multiplayer
  private activeRoom: MultiplayerRoom | null = null;
  private roomPlayers: RoomPlayer[] = [];
  private roomPieces: RoomPieceState[] = [];
  private openRooms: MultiplayerRoom[] = [];
  private pendingInviteCode: string | null = null;
  private lastHandSyncAt = 0;

  private unsubAuth?: Unsubscribe;
  private unsubLeaderboard?: Unsubscribe;
  private unsubOpenRooms?: Unsubscribe;
  private unsubRoom?: Unsubscribe;

  private uiDirty = true;
  private lastHudClockPaint = 0;

  override init(): void {
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get('room');
    if (inviteCode) {
      this.pendingInviteCode = inviteCode.trim().toUpperCase();
      this.view = 'multiplayer';
    } else if (!localStorage.getItem('relicforge_tutorial_done')) {
      this.view = 'tutorial';
    }

    this.arena = new PuzzleArena({
      onPieceGrabbed: (piece) => this.handlePieceGrabbed(piece),
      onPieceRotated: (piece) => this.handlePieceRotated(piece),
      onPiecePlaced: (placed, total, acc, piece) => this.handlePiecePlaced(placed, total, acc, piece),
      onMisplacement: (acc) => this.handleMisplacement(acc),
      onPuzzleCompleted: (acc) => this.handlePuzzleCompleted(acc),
      onPieceNetworkSync: (piece, locked, heldByMe) => this.handlePieceNetworkSync(piece, locked, heldByMe),
      onSelectedPieceChange: () => this.markDirty(),
    });
    this.add(this.arena);

    this.spatialHud = new SpatialHUD({
      onNavigate: (v) => this.setView(v),
      onSelectPuzzle: (id) => this.selectPuzzle(id),
      onSelectDifficulty: (d) => this.setDifficulty(d),
      onStartSolo: () => this.startSoloRun(),
      onStartTutorial: () => this.startTutorial(),
      onRestart: () => this.restartCurrentMode(),
      onHint: () => this.triggerHint(),
      onRecenter: () => void this.recenterWorkbench(),
      onRotate: (axis, dir) => {
        this.arena.rotateSelected(axis, dir, 45);
      },
      onToggleVoice: () => this.toggleVoice(),
      onSortLeaderboard: (s) => this.setLeaderboardSort(s),
      onCreateRoom: (m) => void this.hostRoom(m),
      onToggleReady: () => void this.toggleReady(),
      onStartRoomMatch: () => void this.startRoomMatch(),
      onLeaveRoom: () => void this.leaveRoom(),
      onToggleSetting: (k) => this.toggleSetting(k),
      onSignIn: () => void this.signIn(),
    });
    this.add(this.spatialHud);

    this.overlay = new CrossPlatformOverlay({
      onNavigate: (v) => this.setView(v),
      onSelectPuzzle: (id) => this.selectPuzzle(id),
      onSelectDifficulty: (d) => this.setDifficulty(d),
      onStartSolo: () => this.startSoloRun(),
      onStartTutorial: () => this.startTutorial(),
      onRestart: () => this.restartCurrentMode(),
      onTogglePause: () => this.togglePause(),
      onHint: () => this.triggerHint(),
      onRecenter: () => void this.recenterWorkbench(),
      onRotate: (axis, dir) => {
        this.arena.rotateSelected(axis, dir, 45);
      },
      onNextPiece: () => {
        this.arena.selectNextPiece();
        this.markDirty();
      },
      onSnapPiece: () => {
        if (!this.arena.trySnapSelected()) {
          this.overlay.showToast('Align piece position & rotation inside green ghost first.');
        }
      },
      onToggleVoice: () => this.toggleVoice(),
      onSubmitVoicePhrase: (phrase) => {
        const ok = this.voice.processTranscript(phrase);
        if (!ok) {
          this.overlay.showToast(`Unrecognized voice phrase: "${phrase}"`);
        }
      },
      onSortLeaderboard: (s) => this.setLeaderboardSort(s),
      onFilterLeaderboard: (f) => {
        this.leaderboardFilter = f;
        this.markDirty();
      },
      onCreateRoom: (m) => void this.hostRoom(m),
      onJoinRoom: (code) => void this.joinRoom(code),
      onToggleReady: () => void this.toggleReady(),
      onStartRoomMatch: () => void this.startRoomMatch(),
      onLeaveRoom: () => void this.leaveRoom(),
      onToggleSetting: (k) => this.toggleSetting(k),
      onSignIn: () => void this.signIn(),
      onSignOut: () => void this.signOut(),
    });

    this.voice = new VoiceController(
      (action, label) => this.handleVoiceAction(action, label),
      (status) => {
        const prevErr = this.voiceStatus.error;
        this.voiceStatus = status;
        this.settings.voiceEnabled = status.listening;
        if (status.error && status.error !== prevErr) {
          this.overlay.showToast(status.error, 3200);
        }
        this.markDirty();
      }
    );

    this.bindInputShortcuts();
    this.initFirebaseSubscriptions();

    if (this.pendingInviteCode) {
      this.overlay.showToast(`Room ${this.pendingInviteCode} invite detected. Sign in with Google to join!`);
    } else if (this.view === 'tutorial') {
      this.overlay.showToast('Welcome to RelicForge XR! Launch Guided Tutorial or pick a puzzle.');
    }

    this.markDirty();
    window.setTimeout(() => this.spatialHud.validateLayout(), 800);
  }

  override onXRSessionStarted(): void {
    this.overlay.setVisible(false);
  }

  override onXRSessionEnded(): void {
    this.overlay.setVisible(true);
  }

  private bindInputShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.code) {
        case 'KeyQ':
          this.arena.rotateSelected('y', 1, 45);
          break;
        case 'KeyE':
          this.arena.rotateSelected('y', -1, 45);
          break;
        case 'KeyW':
          this.arena.rotateSelected('x', 1, 45);
          break;
        case 'KeyS':
          this.arena.rotateSelected('x', -1, 45);
          break;
        case 'KeyA':
          this.arena.rotateSelected('z', 1, 45);
          break;
        case 'KeyD':
          this.arena.rotateSelected('z', -1, 45);
          break;
        case 'Tab':
          e.preventDefault();
          this.arena.selectNextPiece();
          this.markDirty();
          break;
        case 'Space':
          e.preventDefault();
          this.arena.trySnapSelected();
          break;
        case 'KeyH':
          this.overlay.toggleDock();
          break;
        case 'KeyM':
          this.toggleVoice();
          break;
      }
    });

    window.addEventListener(
      'wheel',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (target && target.closest('.rf-dock')) return;
        const dir: 1 | -1 = e.deltaY > 0 ? -1 : 1;
        this.arena.rotateSelected(e.shiftKey ? 'x' : 'y', dir, 15);
      },
      { passive: true }
    );
  }

  private initFirebaseSubscriptions(): void {
    this.unsubLeaderboard = subscribeLeaderboard(
      (entries) => {
        this.allLeaderboardEntries = entries;
        this.markDirty();
      },
      (err) => {
        console.warn('Leaderboard subscription error:', err);
      }
    );

    this.unsubAuth = onAuthChange(async (user) => {
      this.currentUser = user;
      if (user) {
        try {
          await ensureUserProfile(user);
        } catch (e) {
          console.warn('Profile sync warning:', e);
        }

        if (!this.unsubOpenRooms) {
          this.unsubOpenRooms = subscribeOpenRooms((rooms) => {
            this.openRooms = rooms;
            this.markDirty();
          });
        }

        if (this.pendingInviteCode) {
          const code = this.pendingInviteCode;
          this.pendingInviteCode = null;
          await this.joinRoom(code);
        }
      } else {
        this.unsubOpenRooms?.();
        this.unsubOpenRooms = undefined;
        this.openRooms = [];
      }
      this.markDirty();
    });
  }

  private async signIn(): Promise<void> {
    try {
      const user = await signInWithGoogle();
      if (user) {
        this.overlay.showToast(`Signed in as ${user.displayName || 'Builder'}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in canceled';
      this.overlay.showToast(msg);
    }
  }

  private async signOut(): Promise<void> {
    if (this.activeRoom) {
      await this.leaveRoom();
    }
    await signOutUser();
    this.overlay.showToast('Signed out.');
  }

  // --- Navigation & Mode Transitions ---
  private setView(view: MenuView): void {
    this.view = view;
    this.markDirty();
  }

  private selectPuzzle(id: PuzzleId): void {
    this.puzzleId = id;
    if (this.activeRoom && this.activeRoom.hostUid === this.currentUser?.uid && this.activeRoom.status === 'waiting') {
      void updateRoomConfig(this.activeRoom.roomCode, { puzzleId: id });
    }
    if (this.mode === 'solo' || this.mode === 'menu') {
      this.startSoloRun();
    }
    this.markDirty();
  }

  private setDifficulty(d: Difficulty): void {
    this.difficulty = d;
    this.arena.difficulty = d;
    if (this.activeRoom && this.activeRoom.hostUid === this.currentUser?.uid && this.activeRoom.status === 'waiting') {
      void updateRoomConfig(this.activeRoom.roomCode, { difficulty: d });
    }
    this.markDirty();
  }

  private startSoloRun(): void {
    this.mode = 'solo';
    this.tutorialStep = 0;
    this.elapsedMs = 0;
    this.runStarted = false;
    this.runFinished = false;
    this.countdownEndMs = 0;
    this.countdownLeftSec = 0;
    this.arena.loadPuzzle(this.puzzleId, this.difficulty, false);
    this.overlay.showToast(`${PUZZLE_CATALOG[this.puzzleId].title} (${this.difficulty.toUpperCase()}) — Timer starts on first grab!`);
    this.markDirty();
  }

  private startTutorial(): void {
    this.mode = 'tutorial';
    this.view = 'tutorial';
    this.tutorialStep = 1;
    this.elapsedMs = 0;
    this.runStarted = false;
    this.runFinished = false;
    this.arena.loadPuzzle('chrono-cube', 'easy', true);
    this.overlay.showToast('Tutorial Step 1/4: Pinch or Drag the highlighted Keystone piece!');
    this.markDirty();
  }

  private restartCurrentMode(): void {
    if (this.mode === 'tutorial') {
      this.startTutorial();
    } else if (this.activeRoom) {
      if (this.activeRoom.hostUid === this.currentUser?.uid) {
        void this.startRoomMatch();
      }
    } else {
      this.startSoloRun();
    }
  }

  private togglePause(): void {
    if (this.runFinished) return;
    this.arena.setPaused(!this.arena.paused);
    this.markDirty();
  }

  private triggerHint(): void {
    const p = this.arena.triggerHint();
    if (p) {
      this.overlay.showToast(`Hint: Glowing socket revealed for ${p.spec.name}`);
      this.markDirty();
    }
  }

  private async recenterWorkbench(): Promise<void> {
    const onPlane = await this.arena.recenterOnTable();
    this.overlay.showToast(
      onPlane ? 'Workbench anchored to detected living room surface!' : 'Workbench centered in front of you.'
    );
  }

  private toggleVoice(): void {
    const active = this.voice.toggle();
    this.settings.voiceEnabled = active;
    if (active) {
      this.overlay.showToast('Voice control listening...');
    } else if (!this.voiceStatus.error) {
      this.overlay.showToast('Voice microphone paused.');
    }
    this.markDirty();
  }

  private toggleSetting(key: keyof AppSettings): void {
    this.settings[key] = !this.settings[key];
    soundFX.enabled = this.settings.sfxEnabled;
    this.arena.ghostGuides = this.settings.ghostGuides;
    this.arena.snapAssist = this.settings.snapAssist;
    this.voice.ttsEnabled = this.settings.ttsEnabled;
    if (key === 'voiceEnabled') {
      if (this.settings.voiceEnabled) this.voice.start();
      else this.voice.stop();
    }
    this.markDirty();
  }

  private setLeaderboardSort(sort: LeaderboardSort): void {
    this.leaderboardSort = sort;
    this.markDirty();
  }

  private getFilteredLeaderboard(): LeaderboardEntry[] {
    const list = this.leaderboardFilter === 'all'
      ? [...this.allLeaderboardEntries]
      : this.allLeaderboardEntries.filter((e) => e.puzzleId === this.leaderboardFilter);

    list.sort((a, b) => {
      if (this.leaderboardSort === 'bestTimeMs') return a.bestTimeMs - b.bestTimeMs;
      if (this.leaderboardSort === 'accuracy') return b.accuracy - a.accuracy || b.score - a.score;
      return b.score - a.score || a.bestTimeMs - b.bestTimeMs;
    });
    return list;
  }

  // --- Arena Events & Tutorial Progression ---
  private handlePieceGrabbed(piece: PuzzlePieceScript): void {
    if (!this.runStarted && !this.runFinished && this.countdownLeftSec === 0) {
      this.runStarted = true;
    }

    if (this.mode === 'tutorial' && this.tutorialStep === 1) {
      this.tutorialStep = 2;
      this.overlay.showToast('Nice grab! Step 2/4: Twist wrist, press Q/E/W/S, or say "Rotate Left"!');
    }

    if (this.mode === 'coop' && this.activeRoom && this.currentUser) {
      void updateRoomPiece(this.activeRoom.roomCode, piece.spec.id, {
        pos: [piece.position.x, piece.position.y, piece.position.z],
        quat: [piece.quaternion.x, piece.quaternion.y, piece.quaternion.z, piece.quaternion.w],
        locked: piece.locked,
        heldByUid: this.currentUser.uid,
        heldByName: this.currentUser.displayName || 'Player',
        placedByUid: '',
      });
    }
    this.markDirty();
  }

  private handlePieceRotated(_piece: PuzzlePieceScript): void {
    if (this.mode === 'tutorial' && this.tutorialStep === 2) {
      this.tutorialStep = 3;
      this.overlay.showToast('Great rotation! Step 3/4: Move piece into the glowing green socket!');
      this.markDirty();
    }
  }

  private handleMisplacement(accuracy: number): void {
    this.overlay.showToast(`Misaligned socket — Accuracy ${accuracy}%`);
    this.markDirty();
  }

  private handlePiecePlaced(placed: number, total: number, accuracy: number, piece: PuzzlePieceScript): void {
    this.overlay.showToast(`Snapped ${piece.spec.name}! (${placed}/${total})`);

    if (this.mode === 'tutorial' && this.tutorialStep <= 3) {
      this.tutorialStep = 4;
      this.overlay.showToast('Step 4/4: Say "Show Leaderboard" or click Test Voice to finish onboarding!');
    }

    if ((this.mode === 'race' || this.mode === 'coop') && this.activeRoom) {
      void updatePlayerProgress(this.activeRoom.roomCode, {
        placedCount: placed,
        totalPieces: total,
        accuracy,
      });
    }
    this.markDirty();
  }

  private handlePieceNetworkSync(piece: PuzzlePieceScript, locked: boolean, heldByMe: boolean): void {
    if (this.mode !== 'coop' || !this.activeRoom || !this.currentUser) return;
    void updateRoomPiece(this.activeRoom.roomCode, piece.spec.id, {
      pos: [piece.position.x, piece.position.y, piece.position.z],
      quat: [piece.quaternion.x, piece.quaternion.y, piece.quaternion.z, piece.quaternion.w],
      locked,
      heldByUid: heldByMe ? this.currentUser.uid : '',
      heldByName: heldByMe ? (this.currentUser.displayName || 'Player') : '',
      placedByUid: locked ? this.currentUser.uid : '',
    });
  }

  private async handlePuzzleCompleted(accuracy: number): Promise<void> {
    if (this.mode === 'tutorial') {
      if (this.tutorialStep < 4) this.tutorialStep = 4;
      this.markDirty();
      return;
    }

    this.runFinished = true;
    const score = calculateScore(this.puzzleId, this.difficulty, this.elapsedMs, accuracy);
    const timeStr = formatTimeMs(this.elapsedMs);
    this.overlay.showToast(`Puzzle Assembled! Time: ${timeStr} · Acc: ${accuracy}% · Score: ${score}`, 4500);

    if (this.activeRoom && (this.mode === 'race' || this.mode === 'coop')) {
      const uid = this.currentUser?.uid;
      const myName = this.currentUser?.displayName || 'Builder';
      await updatePlayerProgress(this.activeRoom.roomCode, {
        placedCount: this.arena.pieces.length,
        totalPieces: this.arena.pieces.length,
        accuracy,
        score,
        finished: true,
        finishTimeMs: Math.round(this.elapsedMs),
      });
      if (uid && !this.activeRoom.winnerUid) {
        await claimRoomWinner(this.activeRoom.roomCode, myName);
      }
    }

    if (this.currentUser) {
      try {
        const res = await submitLeaderboardScore({
          puzzleId: this.puzzleId,
          difficulty: this.difficulty,
          elapsedMs: Math.max(250, Math.round(this.elapsedMs)),
          accuracy,
          score,
          mode: this.activeRoom ? 'multiplayer' : 'solo',
        });
        await ensureUserProfile(this.currentUser, {
          totalSolved: 1,
          bestScore: score,
        });
        if (res?.updated) {
          this.overlay.showToast(`New Personal Record Posted: ${score} pts!`);
        }
      } catch (err) {
        console.warn('Score submit error:', err);
      }
    }
    this.markDirty();
  }

  // --- Voice Commands ---
  private handleVoiceAction(action: VoiceAction, label: string): void {
    this.overlay.showToast(`Voice: ${label}`);

    // Complete Tutorial Step 4 if waiting for voice navigation!
    if (this.mode === 'tutorial' && this.tutorialStep === 4) {
      this.tutorialStep = 5;
      localStorage.setItem('relicforge_tutorial_done', '1');
      soundFX.playVictoryFanfare();
      if (this.currentUser) {
        void ensureUserProfile(this.currentUser, { tutorialCompleted: true });
      }
      this.overlay.showToast('Onboarding Complete! Badge Unlocked: Spatial Builder', 4000);
    }

    switch (action.type) {
      case 'navigate':
        this.setView(action.view);
        break;
      case 'toggle_hud':
        this.overlay.toggleDock(action.show);
        break;
      case 'select_puzzle':
        this.selectPuzzle(action.puzzleId);
        break;
      case 'set_difficulty':
        this.setDifficulty(action.difficulty);
        break;
      case 'start_game':
        if (this.activeRoom && this.activeRoom.hostUid === this.currentUser?.uid) {
          void this.startRoomMatch();
        } else {
          this.startSoloRun();
        }
        break;
      case 'start_tutorial':
        this.startTutorial();
        break;
      case 'restart_game':
        this.restartCurrentMode();
        break;
      case 'toggle_pause':
        this.arena.setPaused(action.paused ?? !this.arena.paused);
        break;
      case 'hint':
        this.triggerHint();
        break;
      case 'recenter':
        void this.recenterWorkbench();
        break;
      case 'rotate_piece':
        this.arena.rotateSelected(action.axis, action.dir, 45);
        break;
      case 'next_piece':
        this.arena.selectNextPiece();
        break;
      case 'snap_piece':
        this.arena.trySnapSelected();
        break;
      case 'sort_leaderboard':
        this.setView('leaderboard');
        this.setLeaderboardSort(action.sort);
        break;
      case 'create_room':
        this.setView('multiplayer');
        void this.hostRoom('race');
        break;
      case 'toggle_ready':
        void this.toggleReady();
        break;
      case 'leave_room':
        void this.leaveRoom();
        break;
      case 'toggle_setting':
        if (action.value !== undefined) {
          this.settings[action.setting] = action.value;
          soundFX.enabled = this.settings.sfxEnabled;
          this.arena.ghostGuides = this.settings.ghostGuides;
          this.voice.ttsEnabled = this.settings.ttsEnabled;
        } else {
          this.toggleSetting(action.setting);
        }
        break;
      case 'help':
        this.setView('settings');
        break;
    }
    this.markDirty();
  }

  // --- Cross-Platform Multiplayer ---
  private async hostRoom(mode: MultiplayerMode): Promise<void> {
    if (!this.currentUser) {
      this.overlay.showToast('Please sign in with Google first to host a room.');
      await this.signIn();
      if (!this.currentUser) return;
    }

    try {
      if (this.activeRoom) await this.leaveRoom();
      const room = await createMultiplayerRoom({
        puzzleId: this.puzzleId,
        difficulty: this.difficulty,
        mode,
      });
      this.attachRoomSubscription(room.roomCode);
      this.view = 'multiplayer';
      this.overlay.showToast(`Hosted ${mode.toUpperCase()} Room ${room.roomCode}! Share invite link.`);
    } catch (err) {
      this.overlay.showToast(err instanceof Error ? err.message : 'Failed to create room.');
    }
  }

  private async joinRoom(code: string): Promise<void> {
    if (!this.currentUser) {
      this.overlay.showToast('Please sign in with Google to join the room.');
      await this.signIn();
      if (!this.currentUser) return;
    }

    try {
      if (this.activeRoom) await this.leaveRoom();
      const room = await joinMultiplayerRoom(code);
      this.attachRoomSubscription(room.roomCode);
      this.view = 'multiplayer';
      this.overlay.showToast(`Joined Room ${room.roomCode}!`);
    } catch (err) {
      this.overlay.showToast(err instanceof Error ? err.message : 'Failed to join room.');
    }
  }

  private attachRoomSubscription(roomCode: string): void {
    this.unsubRoom?.();
    let prevStatus = '';

    this.unsubRoom = subscribeRoom(roomCode, {
      onRoom: (room) => {
        if (!room) {
          this.activeRoom = null;
          this.mode = 'solo';
          this.markDirty();
          return;
        }
        this.activeRoom = room;
        this.puzzleId = room.puzzleId;
        this.difficulty = room.difficulty;

        if (room.status !== prevStatus) {
          prevStatus = room.status;
          if (room.status === 'countdown') {
            this.mode = room.mode;
            this.elapsedMs = 0;
            this.runStarted = false;
            this.runFinished = false;
            this.countdownEndMs = room.countdownStartMs;
            this.lastCountdownTick = 0;
            this.arena.loadPuzzle(room.puzzleId, room.difficulty, false);
            this.arena.setPaused(true);
          } else if (room.status === 'playing') {
            this.mode = room.mode;
            this.countdownEndMs = 0;
            this.countdownLeftSec = 0;
            this.runStarted = true;
            this.arena.setPaused(false);
            soundFX.playCountdownTick(true);
            this.overlay.showToast('GO! Race to assemble the puzzle!');
          } else if (room.status === 'finished' && room.winnerName) {
            this.overlay.showToast(`Winner: ${room.winnerName}!`, 4000);
          }
        }
        this.markDirty();
      },
      onPlayers: (players) => {
        this.roomPlayers = players;
        if (this.mode === 'coop' && this.currentUser) {
          this.arena.syncRemoteCursors(players, this.currentUser.uid);
        }
        this.markDirty();
      },
      onPieces: (pieces) => {
        this.roomPieces = pieces;
        if (this.mode === 'coop' && this.currentUser) {
          this.arena.syncRemotePieces(pieces, this.currentUser.uid);
        }
      },
    });
  }

  private async toggleReady(): Promise<void> {
    if (!this.activeRoom || !this.currentUser) return;
    const me = this.roomPlayers.find((p) => p.uid === this.currentUser?.uid);
    await updatePlayerProgress(this.activeRoom.roomCode, { ready: !(me?.ready ?? false) });
  }

  private async startRoomMatch(): Promise<void> {
    if (!this.activeRoom || !this.currentUser) return;
    if (this.activeRoom.hostUid !== this.currentUser.uid) return;

    if (this.activeRoom.status === 'finished') {
      await updateRoomConfig(this.activeRoom.roomCode, {
        status: 'waiting',
        winnerUid: '',
        winnerName: '',
        countdownStartMs: 0,
      });
      await updatePlayerProgress(this.activeRoom.roomCode, {
        placedCount: 0,
        finished: false,
        finishTimeMs: 0,
        score: 0,
      });
      this.arena.loadPuzzle(this.activeRoom.puzzleId, this.activeRoom.difficulty, false);
      return;
    }

    this.arena.loadPuzzle(this.activeRoom.puzzleId, this.activeRoom.difficulty, false);
    if (this.activeRoom.mode === 'coop') {
      await initRoomPieces(this.activeRoom.roomCode, this.arena.getLocalPiecesSnapshot());
    }

    const startMs = Date.now() + 3200;
    await updateRoomConfig(this.activeRoom.roomCode, {
      status: 'countdown',
      countdownStartMs: startMs,
      winnerUid: '',
      winnerName: '',
    });
  }

  private async leaveRoom(): Promise<void> {
    if (!this.activeRoom) return;
    const code = this.activeRoom.roomCode;
    this.unsubRoom?.();
    this.unsubRoom = undefined;
    this.activeRoom = null;
    this.roomPlayers = [];
    this.roomPieces = [];
    await leaveMultiplayerRoom(code);
    this.startSoloRun();
    this.overlay.showToast(`Left room ${code}.`);
  }

  private markDirty(): void {
    this.uiDirty = true;
  }

  override update(): void {
    const dtMs = (xb.getDeltaTime() || 0.016) * 1000;

    // Tutorial step 2 detection for XR wrist-twist rotation
    if (this.mode === 'tutorial' && this.tutorialStep === 2) {
      const p = this.arena.pieces.find((x) => !x.locked);
      if (p && p.isGrabbed && p.quaternion.angleTo(p.scatterLocalQuat) > 0.42) {
        this.tutorialStep = 3;
        this.overlay.showToast('Great wrist rotation! Step 3/4: Move into the green socket and release!');
        this.markDirty();
      }
    }

    // Multiplayer synchronized countdown
    if (this.activeRoom?.status === 'countdown' && this.countdownEndMs > 0) {
      const rem = Math.max(0, this.countdownEndMs - Date.now());
      const sec = Math.ceil(rem / 1000);
      this.countdownLeftSec = sec;
      if (sec > 0 && sec !== this.lastCountdownTick) {
        this.lastCountdownTick = sec;
        soundFX.playCountdownTick(false);
      }
      if (rem <= 0 && this.activeRoom.hostUid === this.currentUser?.uid) {
        void updateRoomConfig(this.activeRoom.roomCode, { status: 'playing' });
      }
    }

    // Live match timer
    if (this.runStarted && !this.runFinished && !this.arena.paused && this.countdownLeftSec === 0) {
      this.elapsedMs += dtMs;
    }

    // Broadcast player hand/cursor position in Co-op every ~180ms
    if (this.mode === 'coop' && this.activeRoom && this.currentUser && this.runStarted) {
      const now = performance.now();
      if (now - this.lastHandSyncAt > 180) {
        this.lastHandSyncAt = now;
        const p = this.arena.selectedPiece?.position;
        if (p) {
          void updatePlayerProgress(this.activeRoom.roomCode, {
            handPos: [Number(p.x.toFixed(3)), Number((p.y + 0.08).toFixed(3)), Number(p.z.toFixed(3))],
          });
        }
      }
    }

    // Lightweight timer paint every ~50ms without rebuilding DOM
    const now = performance.now();
    if (now - this.lastHudClockPaint > 50) {
      this.lastHudClockPaint = now;
      this.overlay.updateTimerOnly(this.elapsedMs, this.countdownLeftSec);
      this.spatialHud.updateTimerOnly(this.elapsedMs, this.countdownLeftSec);
    }

    if (this.uiDirty) {
      this.uiDirty = false;
      const filteredLb = this.getFilteredLeaderboard();
      const placedCount = this.arena.getPlacedCount();
      const totalPieces = this.arena.pieces.length || PUZZLE_CATALOG[this.puzzleId].pieceCount;
      const accuracy = this.arena.getAccuracy();

      this.spatialHud.syncState({
        view: this.view,
        mode: this.mode,
        puzzleId: this.puzzleId,
        difficulty: this.difficulty,
        elapsedMs: this.elapsedMs,
        placedCount,
        totalPieces,
        accuracy,
        tutorialStep: this.tutorialStep,
        voiceListening: this.voiceStatus.listening,
        voiceLastLabel: this.voiceStatus.lastActionLabel,
        userDisplayName: this.currentUser?.displayName || null,
        userUid: this.currentUser?.uid || null,
        leaderboard: filteredLb,
        leaderboardSort: this.leaderboardSort,
        room: this.activeRoom,
        players: this.roomPlayers,
        settings: this.settings,
        countdownLeftSec: this.countdownLeftSec,
      });

      this.overlay.render({
        view: this.view,
        mode: this.mode,
        puzzleId: this.puzzleId,
        difficulty: this.difficulty,
        paused: this.arena.paused,
        elapsedMs: this.elapsedMs,
        placedCount,
        totalPieces,
        accuracy,
        selectedPieceName: this.arena.selectedPiece?.spec.name || null,
        tutorialStep: this.tutorialStep,
        voiceListening: this.voiceStatus.listening,
        voiceTranscript: this.voiceStatus.lastTranscript,
        voiceLastLabel: this.voiceStatus.lastActionLabel,
        voiceError: this.voiceStatus.error,
        userDisplayName: this.currentUser?.displayName || null,
        userUid: this.currentUser?.uid || null,
        leaderboard: filteredLb,
        leaderboardSort: this.leaderboardSort,
        leaderboardFilter: this.leaderboardFilter,
        room: this.activeRoom,
        players: this.roomPlayers,
        openRooms: this.openRooms,
        settings: this.settings,
        countdownLeftSec: this.countdownLeftSec,
      });
    }
  }

  override dispose(): void {
    this.unsubAuth?.();
    this.unsubLeaderboard?.();
    this.unsubOpenRooms?.();
    this.unsubRoom?.();
    this.voice.dispose();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const options = new xb.Options();
  options.enableHands();
  options.enableHandRays();
  options.enableReticles();
  options.enablePlaneDetection();
  options.sound.speechSynthesizer.enabled = true;
  options.xrButton.appTitle = 'RelicForge XR';
  options.xrButton.appDescription =
    'Interactive 3D spatial puzzles with hand-tracking assembly, voice commands, onboarding tutorial, global leaderboards, and real-time multiplayer.';
  options.xrButton.showEnterSimulatorButton = true;

  xb.add(new RelicForgeApp());
  void xb.init(options);
});
