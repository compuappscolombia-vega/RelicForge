/**
 * Phase 0 Dirty Dozen Security Rules Verification Spec
 * Run with @firebase/rules-unit-testing against the Firebase Emulator Suite.
 */
export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'create' | 'update' | 'get' | 'list';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Leaderboard Write',
    operation: 'create',
    path: 'leaderboards/u1_chrono-cube',
    auth: null,
    payload: { uid: 'u1', score: 5000 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Leaderboard Write',
    operation: 'create',
    path: 'leaderboards/u1_chrono-cube',
    auth: { uid: 'u1', email_verified: false },
    payload: { uid: 'u1', score: 5000 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Identity Spoofing on Leaderboard',
    operation: 'create',
    path: 'leaderboards/victim_chrono-cube',
    auth: { uid: 'attacker', email_verified: true },
    payload: { uid: 'victim', score: 99999 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on UserProfile',
    operation: 'create',
    path: 'users/u1',
    auth: { uid: 'u1', email_verified: true },
    payload: {
      uid: 'u1',
      displayName: 'Alice',
      platform: 'desktop',
      tutorialCompleted: true,
      totalSolved: 1,
      bestScore: 1000,
      isAdmin: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Out-of-Bounds Score Poisoning',
    operation: 'create',
    path: 'leaderboards/u1_chrono-cube',
    auth: { uid: 'u1', email_verified: true },
    payload: {
      uid: 'u1',
      displayName: 'Cheater',
      puzzleId: 'chrono-cube',
      puzzleTitle: 'Chrono Cube',
      difficulty: 'hard',
      bestTimeMs: 1,
      accuracy: 250,
      score: 9999999,
      platform: 'desktop',
      mode: 'solo',
      isPublic: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'ID Poisoning on Room Creation',
    operation: 'create',
    path: 'rooms/bad$id!',
    auth: { uid: 'u1', email_verified: true },
    payload: { roomCode: 'BAD' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Client Timestamp Forgery',
    operation: 'create',
    path: 'users/u1',
    auth: { uid: 'u1', email_verified: true },
    payload: {
      uid: 'u1',
      displayName: 'Alice',
      platform: 'vr',
      tutorialCompleted: false,
      totalSolved: 0,
      bestScore: 0,
      updatedAt: new Date(0),
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Non-Host Hijacking Room Settings',
    operation: 'update',
    path: 'rooms/XR4K9M',
    auth: { uid: 'guestUid', email_verified: true },
    payload: { hostUid: 'guestUid', puzzleId: 'orbital-sanctum' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Terminal Winner Overwrite After Finish',
    operation: 'update',
    path: 'rooms/XR4K9M',
    auth: { uid: 'guestUid', email_verified: true },
    payload: { status: 'finished', winnerUid: 'guestUid', winnerName: 'Guest' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Non-Member Co-op Piece Tampering',
    operation: 'update',
    path: 'rooms/XR4K9M/pieces/p0',
    auth: { uid: 'outsider', email_verified: true },
    payload: { pos: [0, 1, 0] },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unlocking Already-Locked Piece',
    operation: 'update',
    path: 'rooms/XR4K9M/pieces/p0',
    auth: { uid: 'member', email_verified: true },
    payload: { locked: false },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'User Directory Scraping',
    operation: 'list',
    path: 'users',
    auth: { uid: 'u1', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
];
