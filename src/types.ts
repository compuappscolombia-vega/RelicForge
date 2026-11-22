export type PuzzleId = 'chrono-cube' | 'aether-clockwork' | 'orbital-sanctum';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type PlatformType = 'vr' | 'desktop' | 'mobile';
export type GameMode = 'menu' | 'tutorial' | 'solo' | 'race' | 'coop';
export type MenuView = 'play' | 'tutorial' | 'leaderboard' | 'multiplayer' | 'settings';
export type LeaderboardSort = 'score' | 'bestTimeMs' | 'accuracy';
export type MultiplayerMode = 'race' | 'coop';
export type RoomStatus = 'waiting' | 'countdown' | 'playing' | 'finished';

export const SCHEMA_LIMITS = {
  DISPLAY_NAME_MAX: 40,
  PUZZLE_TITLE_MAX: 60,
  ROOM_CODE_MIN: 4,
  ROOM_CODE_MAX: 12,
  UID_MAX: 128,
  PIECE_ID_MAX: 64,
  MAX_SCORE: 100000,
  MIN_TIME_MS: 100,
  MAX_TIME_MS: 3600000,
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  ROOM_CODE_PATTERN: /^[A-Z0-9]+$/,
} as const;

export interface AppSettings {
  voiceEnabled: boolean;
  ttsEnabled: boolean;
  sfxEnabled: boolean;
  ghostGuides: boolean;
  snapAssist: boolean;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  platform: PlatformType;
  tutorialCompleted: boolean;
  totalSolved: number;
  bestScore: number;
}

export interface LeaderboardEntry {
  id: string;
  uid: string;
  displayName: string;
  puzzleId: PuzzleId;
  puzzleTitle: string;
  difficulty: Difficulty;
  bestTimeMs: number;
  accuracy: number;
  score: number;
  platform: PlatformType;
  mode: 'solo' | 'multiplayer';
  isPublic: boolean;
  updatedAtMs: number;
}

export interface MultiplayerRoom {
  roomCode: string;
  hostUid: string;
  hostName: string;
  puzzleId: PuzzleId;
  difficulty: Difficulty;
  mode: MultiplayerMode;
  status: RoomStatus;
  countdownStartMs: number;
  winnerUid: string;
  winnerName: string;
  playerCount: number;
}

export interface RoomPlayer {
  roomId: string;
  uid: string;
  displayName: string;
  platform: PlatformType;
  ready: boolean;
  placedCount: number;
  totalPieces: number;
  accuracy: number;
  score: number;
  finished: boolean;
  finishTimeMs: number;
  handPos: [number, number, number];
}

export interface RoomPieceState {
  roomId: string;
  pieceId: string;
  pos: [number, number, number];
  quat: [number, number, number, number];
  locked: boolean;
  heldByUid: string;
  heldByName: string;
  placedByUid: string;
}

export type TutorialStep = 0 | 1 | 2 | 3 | 4 | 5;

export interface PuzzleMeta {
  id: PuzzleId;
  title: string;
  subtitle: string;
  pieceCount: number;
  difficultyMultiplier: number;
  accentHex: string;
}

export const PUZZLE_CATALOG: Record<PuzzleId, PuzzleMeta> = {
  'chrono-cube': {
    id: 'chrono-cube',
    title: 'Chrono Cube',
    subtitle: '5-Module Interlocking Architectural Soma Relic',
    pieceCount: 5,
    difficultyMultiplier: 1.0,
    accentHex: '#38bdf8',
  },
  'aether-clockwork': {
    id: 'aether-clockwork',
    title: 'Aether Clockwork',
    subtitle: '5-Stage Brass Planetary Gear & Balance Core',
    pieceCount: 5,
    difficultyMultiplier: 1.2,
    accentHex: '#fbbf24',
  },
  'orbital-sanctum': {
    id: 'orbital-sanctum',
    title: 'Orbital Sanctum',
    subtitle: '6-Part Gimbal Ring & Faceted Crystal Geode',
    pieceCount: 6,
    difficultyMultiplier: 1.35,
    accentHex: '#c084fc',
  },
};

export function detectPlatform(): PlatformType {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/OculusBrowser|Quest|Android XR|PicoBrowser|Vive/i.test(ua)) return 'vr';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (window.innerWidth <= 820 && 'ontouchstart' in window)) {
    return 'mobile';
  }
  return 'desktop';
}

export function formatTimeMs(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const mins = Math.floor(clamped / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const centis = Math.floor((clamped % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

export function calculateScore(
  puzzleId: PuzzleId,
  difficulty: Difficulty,
  elapsedMs: number,
  accuracy: number
): number {
  const meta = PUZZLE_CATALOG[puzzleId];
  const diffBonus = difficulty === 'hard' ? 1.45 : difficulty === 'normal' ? 1.15 : 0.9;
  const targetParMs = meta.pieceCount * (difficulty === 'hard' ? 14000 : difficulty === 'normal' ? 16000 : 20000);
  const timeRatio = Math.max(0.15, Math.min(2.2, targetParMs / Math.max(4000, elapsedMs)));
  const accFactor = Math.max(0.25, accuracy / 100);
  const raw = Math.round(2800 * meta.difficultyMultiplier * diffBonus * timeRatio * accFactor);
  return Math.max(100, Math.min(SCHEMA_LIMITS.MAX_SCORE, raw));
}
