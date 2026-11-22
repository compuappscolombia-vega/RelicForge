import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  detectPlatform,
  PUZZLE_CATALOG,
  SCHEMA_LIMITS,
  type Difficulty,
  type LeaderboardEntry,
  type MultiplayerMode,
  type MultiplayerRoom,
  type PuzzleId,
  type RoomPieceState,
  type RoomPlayer,
  type RoomStatus,
  type UserProfile,
} from '../types.ts';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

function sanitizeDisplayName(raw?: string | null): string {
  const clean = (raw || 'Builder').trim().replace(/\s+/g, ' ');
  return (clean || 'Builder').slice(0, SCHEMA_LIMITS.DISPLAY_NAME_MAX);
}

function clampInt(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Math.round(val)));
}

export function onAuthChange(cb: (user: FirebaseUser | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, cb);
}

export async function signInWithGoogle(): Promise<FirebaseUser | null> {
  const provider = new GoogleAuthProvider();
  const res = await signInWithPopup(auth, provider);
  return res.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export async function ensureUserProfile(
  user: FirebaseUser,
  updates?: Partial<Pick<UserProfile, 'tutorialCompleted' | 'totalSolved' | 'bestScore'>>
): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const platform = detectPlatform();
  const displayName = sanitizeDisplayName(user.displayName || user.email?.split('@')[0]);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const initial: UserProfile = {
        uid: user.uid,
        displayName,
        platform,
        tutorialCompleted: updates?.tutorialCompleted ?? false,
        totalSolved: clampInt(updates?.totalSolved ?? 0, 0, 1000000),
        bestScore: clampInt(updates?.bestScore ?? 0, 0, SCHEMA_LIMITS.MAX_SCORE),
      };
      await setDoc(ref, {
        ...initial,
        updatedAt: serverTimestamp(),
      });
      return initial;
    }

    const existing = snap.data() as UserProfile;
    const nextProfile: UserProfile = {
      uid: user.uid,
      displayName: sanitizeDisplayName(existing.displayName || displayName),
      platform,
      tutorialCompleted: updates?.tutorialCompleted ?? existing.tutorialCompleted ?? false,
      totalSolved: clampInt(updates?.totalSolved ?? existing.totalSolved ?? 0, 0, 1000000),
      bestScore: clampInt(
        Math.max(existing.bestScore ?? 0, updates?.bestScore ?? 0),
        0,
        SCHEMA_LIMITS.MAX_SCORE
      ),
    };
    await updateDoc(ref, {
      displayName: nextProfile.displayName,
      platform: nextProfile.platform,
      tutorialCompleted: nextProfile.tutorialCompleted,
      totalSolved: nextProfile.totalSolved,
      bestScore: nextProfile.bestScore,
      updatedAt: serverTimestamp(),
    });
    return nextProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function submitLeaderboardScore(params: {
  puzzleId: PuzzleId;
  difficulty: Difficulty;
  elapsedMs: number;
  accuracy: number;
  score: number;
  mode: 'solo' | 'multiplayer';
}): Promise<{ updated: boolean; entry: LeaderboardEntry } | null> {
  const user = auth.currentUser;
  if (!user) return null;

  const entryId = `${user.uid}_${params.puzzleId}`;
  const path = `leaderboards/${entryId}`;
  const ref = doc(db, 'leaderboards', entryId);

  const safeTime = clampInt(params.elapsedMs, SCHEMA_LIMITS.MIN_TIME_MS, SCHEMA_LIMITS.MAX_TIME_MS);
  const safeAcc = clampInt(params.accuracy, 0, 100);
  const safeScore = clampInt(params.score, 0, SCHEMA_LIMITS.MAX_SCORE);
  const meta = PUZZLE_CATALOG[params.puzzleId];
  const displayName = sanitizeDisplayName(user.displayName || user.email?.split('@')[0]);
  const platform = detectPlatform();

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const prev = snap.data() as LeaderboardEntry;
      // Update if score improved or faster best time at same/higher score
      const improvedScore = safeScore > (prev.score ?? 0);
      const improvedTime = safeTime < (prev.bestTimeMs ?? SCHEMA_LIMITS.MAX_TIME_MS);
      if (!improvedScore && !improvedTime) {
        return { updated: false, entry: { ...prev, id: entryId } };
      }
      const nextBestScore = Math.max(prev.score ?? 0, safeScore);
      const nextBestTime = Math.min(prev.bestTimeMs ?? safeTime, safeTime);
      const nextBestAcc = improvedScore ? safeAcc : Math.max(prev.accuracy ?? 0, safeAcc);
      await updateDoc(ref, {
        displayName,
        puzzleTitle: meta.title.slice(0, SCHEMA_LIMITS.PUZZLE_TITLE_MAX),
        difficulty: params.difficulty,
        bestTimeMs: nextBestTime,
        accuracy: nextBestAcc,
        score: nextBestScore,
        platform,
        mode: params.mode,
        updatedAt: serverTimestamp(),
      });
      return {
        updated: true,
        entry: {
          id: entryId,
          uid: user.uid,
          displayName,
          puzzleId: params.puzzleId,
          puzzleTitle: meta.title,
          difficulty: params.difficulty,
          bestTimeMs: nextBestTime,
          accuracy: nextBestAcc,
          score: nextBestScore,
          platform,
          mode: params.mode,
          isPublic: true,
          updatedAtMs: Date.now(),
        },
      };
    } else {
      const payload = {
        uid: user.uid,
        displayName,
        puzzleId: params.puzzleId,
        puzzleTitle: meta.title.slice(0, SCHEMA_LIMITS.PUZZLE_TITLE_MAX),
        difficulty: params.difficulty,
        bestTimeMs: safeTime,
        accuracy: safeAcc,
        score: safeScore,
        platform,
        mode: params.mode,
        isPublic: true,
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, payload);
      return {
        updated: true,
        entry: {
          ...payload,
          id: entryId,
          updatedAtMs: Date.now(),
        },
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeLeaderboard(
  onData: (entries: LeaderboardEntry[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = 'leaderboards';
  const q = query(collection(db, 'leaderboards'), where('isPublic', '==', true), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const rows: LeaderboardEntry[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const updatedTs = data.updatedAt as { toMillis?: () => number } | undefined;
        rows.push({
          id: d.id,
          uid: String(data.uid || ''),
          displayName: String(data.displayName || 'Builder'),
          puzzleId: (data.puzzleId as PuzzleId) || 'chrono-cube',
          puzzleTitle: String(data.puzzleTitle || 'Chrono Cube'),
          difficulty: (data.difficulty as Difficulty) || 'normal',
          bestTimeMs: Number(data.bestTimeMs || 0),
          accuracy: Number(data.accuracy || 0),
          score: Number(data.score || 0),
          platform: (data.platform as 'vr' | 'desktop' | 'mobile') || 'desktop',
          mode: (data.mode as 'solo' | 'multiplayer') || 'solo',
          isPublic: Boolean(data.isPublic),
          updatedAtMs: updatedTs?.toMillis ? updatedTs.toMillis() : Date.now(),
        });
      });
      onData(rows);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function createMultiplayerRoom(params: {
  puzzleId: PuzzleId;
  difficulty: Difficulty;
  mode: MultiplayerMode;
}): Promise<MultiplayerRoom> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in with Google to host a multiplayer room.');

  const roomCode = generateRoomCode();
  const roomPath = `rooms/${roomCode}`;
  const roomRef = doc(db, 'rooms', roomCode);
  const hostName = sanitizeDisplayName(user.displayName || user.email?.split('@')[0]);
  const totalPieces = PUZZLE_CATALOG[params.puzzleId].pieceCount;

  try {
    const roomData: MultiplayerRoom = {
      roomCode,
      hostUid: user.uid,
      hostName,
      puzzleId: params.puzzleId,
      difficulty: params.difficulty,
      mode: params.mode,
      status: 'waiting',
      countdownStartMs: 0,
      winnerUid: '',
      winnerName: '',
      playerCount: 1,
    };
    await setDoc(roomRef, {
      ...roomData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const playerRef = doc(db, 'rooms', roomCode, 'players', user.uid);
    await setDoc(playerRef, {
      roomId: roomCode,
      uid: user.uid,
      displayName: hostName,
      platform: detectPlatform(),
      ready: true,
      placedCount: 0,
      totalPieces,
      accuracy: 100,
      score: 0,
      finished: false,
      finishTimeMs: 0,
      handPos: [0, 1.3, -0.7],
      updatedAt: serverTimestamp(),
    });

    return roomData;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, roomPath);
  }
}

export async function joinMultiplayerRoom(rawCode: string): Promise<MultiplayerRoom> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in with Google to join a multiplayer room.');

  const roomCode = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!SCHEMA_LIMITS.ROOM_CODE_PATTERN.test(roomCode) || roomCode.length < 4) {
    throw new Error('Invalid room code.');
  }

  const roomPath = `rooms/${roomCode}`;
  const roomRef = doc(db, 'rooms', roomCode);
  const playerRef = doc(db, 'rooms', roomCode, 'players', user.uid);

  try {
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) {
      throw new Error(`Room ${roomCode} not found.`);
    }
    const room = roomSnap.data() as MultiplayerRoom;
    const playerSnap = await getDoc(playerRef);
    const totalPieces = PUZZLE_CATALOG[room.puzzleId].pieceCount;

    if (!playerSnap.exists()) {
      if (room.status !== 'waiting') {
        throw new Error(`Room ${roomCode} match is already underway.`);
      }
      if (room.playerCount >= 8) {
        throw new Error(`Room ${roomCode} is full.`);
      }
      await updateDoc(roomRef, {
        playerCount: room.playerCount + 1,
        updatedAt: serverTimestamp(),
      });
    }

    await setDoc(playerRef, {
      roomId: roomCode,
      uid: user.uid,
      displayName: sanitizeDisplayName(user.displayName || user.email?.split('@')[0]),
      platform: detectPlatform(),
      ready: false,
      placedCount: 0,
      totalPieces,
      accuracy: 100,
      score: 0,
      finished: false,
      finishTimeMs: 0,
      handPos: [0, 1.3, -0.7],
      updatedAt: serverTimestamp(),
    });

    return room;
  } catch (error) {
    if (error instanceof Error && (error.message.includes('not found') || error.message.includes('already underway') || error.message.includes('full'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, roomPath);
  }
}

export async function leaveMultiplayerRoom(roomCode: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !roomCode) return;

  const roomRef = doc(db, 'rooms', roomCode);
  const playerRef = doc(db, 'rooms', roomCode, 'players', user.uid);
  try {
    const roomSnap = await getDoc(roomRef);
    await deleteDoc(playerRef).catch(() => {});
    if (roomSnap.exists()) {
      const room = roomSnap.data() as MultiplayerRoom;
      if (room.status === 'waiting' && room.playerCount > 1) {
        await updateDoc(roomRef, {
          playerCount: room.playerCount - 1,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `rooms/${roomCode}/players/${user.uid}`);
  }
}

export async function updateRoomConfig(
  roomCode: string,
  updates: Partial<Pick<MultiplayerRoom, 'puzzleId' | 'difficulty' | 'mode' | 'status' | 'countdownStartMs' | 'winnerUid' | 'winnerName'>>
): Promise<void> {
  const path = `rooms/${roomCode}`;
  try {
    await updateDoc(doc(db, 'rooms', roomCode), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updatePlayerProgress(
  roomCode: string,
  updates: Partial<Omit<RoomPlayer, 'roomId' | 'uid' | 'displayName' | 'platform'>>
): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const path = `rooms/${roomCode}/players/${user.uid}`;
  try {
    await updateDoc(doc(db, 'rooms', roomCode, 'players', user.uid), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function claimRoomWinner(roomCode: string, winnerName: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const path = `rooms/${roomCode}`;
  try {
    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'finished' as RoomStatus,
      winnerUid: user.uid,
      winnerName: sanitizeDisplayName(winnerName),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Another player may have claimed first; ignore contention gracefully
  }
}

export async function initRoomPieces(
  roomCode: string,
  pieces: Array<{
    pieceId: string;
    pos: [number, number, number];
    quat: [number, number, number, number];
  }>
): Promise<void> {
  const path = `rooms/${roomCode}/pieces`;
  try {
    await Promise.all(
      pieces.map((p) =>
        setDoc(doc(db, 'rooms', roomCode, 'pieces', p.pieceId), {
          roomId: roomCode,
          pieceId: p.pieceId.slice(0, SCHEMA_LIMITS.PIECE_ID_MAX),
          pos: p.pos,
          quat: p.quat,
          locked: false,
          heldByUid: '',
          heldByName: '',
          placedByUid: '',
          updatedAt: serverTimestamp(),
        })
      )
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateRoomPiece(
  roomCode: string,
  pieceId: string,
  updates: Omit<RoomPieceState, 'roomId' | 'pieceId'>
): Promise<void> {
  const path = `rooms/${roomCode}/pieces/${pieceId}`;
  try {
    await updateDoc(doc(db, 'rooms', roomCode, 'pieces', pieceId), {
      ...updates,
      heldByName: updates.heldByName.slice(0, SCHEMA_LIMITS.DISPLAY_NAME_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeRoom(
  roomCode: string,
  handlers: {
    onRoom: (room: MultiplayerRoom | null) => void;
    onPlayers: (players: RoomPlayer[]) => void;
    onPieces: (pieces: RoomPieceState[]) => void;
  }
): Unsubscribe {
  const unsubRoom = onSnapshot(
    doc(db, 'rooms', roomCode),
    (snap) => {
      handlers.onRoom(snap.exists() ? (snap.data() as MultiplayerRoom) : null);
    },
    (error) => handleFirestoreError(error, OperationType.GET, `rooms/${roomCode}`)
  );

  const playersQuery = query(
    collection(db, 'rooms', roomCode, 'players'),
    where('roomId', '==', roomCode)
  );
  const unsubPlayers = onSnapshot(
    playersQuery,
    (snap) => {
      const list: RoomPlayer[] = [];
      snap.forEach((d) => list.push(d.data() as RoomPlayer));
      list.sort((a, b) => b.placedCount - a.placedCount || a.finishTimeMs - b.finishTimeMs);
      handlers.onPlayers(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, `rooms/${roomCode}/players`)
  );

  const piecesQuery = query(
    collection(db, 'rooms', roomCode, 'pieces'),
    where('roomId', '==', roomCode)
  );
  const unsubPieces = onSnapshot(
    piecesQuery,
    (snap) => {
      const list: RoomPieceState[] = [];
      snap.forEach((d) => list.push(d.data() as RoomPieceState));
      handlers.onPieces(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, `rooms/${roomCode}/pieces`)
  );

  return () => {
    unsubRoom();
    unsubPlayers();
    unsubPieces();
  };
}

export function subscribeOpenRooms(onData: (rooms: MultiplayerRoom[]) => void): Unsubscribe {
  const q = query(collection(db, 'rooms'), where('status', '==', 'waiting'), limit(15));
  return onSnapshot(
    q,
    (snap) => {
      const rooms: MultiplayerRoom[] = [];
      snap.forEach((d) => rooms.push(d.data() as MultiplayerRoom));
      onData(rooms);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'rooms')
  );
}

export async function fetchOpenRoomsOnce(): Promise<MultiplayerRoom[]> {
  try {
    const q = query(collection(db, 'rooms'), where('status', '==', 'waiting'), limit(10));
    const snap = await getDocs(q);
    const rooms: MultiplayerRoom[] = [];
    snap.forEach((d) => rooms.push(d.data() as MultiplayerRoom));
    return rooms;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'rooms');
  }
}
