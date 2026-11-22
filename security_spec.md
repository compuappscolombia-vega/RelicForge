# Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Identity Integrity**: No user may create or update a `UserProfile`, `LeaderboardEntry`, or `RoomPlayer` with a `uid` other than `request.auth.uid`, nor create a `MultiplayerRoom` with `hostUid != request.auth.uid`.
2. **Email Verification**: All authenticated write operations require `request.auth.token.email_verified == true`.
3. **PII Isolation**: No email addresses, phone numbers, or addresses are stored in `users`, `leaderboards`, or `rooms`.
4. **Master Gate Relational Sync**: `rooms/{roomId}/players/{playerId}` and `rooms/{roomId}/pieces/{pieceId}` cannot exist without a valid parent `rooms/{roomId}` document; piece state writes require the writer to be an existing player member of that room.
5. **Terminal & Immutable Fields**: `createdAt` and `hostUid` on rooms, `uid` on profiles/leaderboards/players, and `roomCode` are immutable after creation. Locked puzzle pieces (`locked == true`) cannot be unlocked unless the host resets the room to `waiting`.
6. **Strict Schema & Bounds**: All documents enforce `keys().hasAll(...) && keys().hasOnly(...)`, strict string length bounds, numeric range bounds (`accuracy` 0..100, `bestTimeMs` 100..3600000, `score` 0..100000), fixed-length numeric arrays (`pos` size 3, `quat` size 4, `handPos` size 3), and server timestamps (`request.time`).

## 2. Dirty Dozen Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Unauthenticated Leaderboard Write**: Unauthenticated client attempts `setDoc(/leaderboards/u1_chrono-cube, ...)` -> DENIED.
2. **Unverified Email Write**: Signed-in user with `email_verified: false` creates a leaderboard score -> DENIED.
3. **Identity Spoofing on Leaderboard**: User A (`uid: 'userA'`) attempts to write `/leaderboards/userB_chrono-cube` with `uid: 'userB'` -> DENIED.
4. **Shadow / Ghost Field Injection**: User A adds `{ isAdmin: true }` or `{ verified: true }` to `/users/userA` -> DENIED (`hasOnly` check).
5. **Impossible Score / Negative Time Poisoning**: User A writes `score: 9999999` or `bestTimeMs: -50` or `accuracy: 150` -> DENIED.
6. **ID Poisoning**: Client attempts to `get` or `create` `/rooms/bad$room!id` or a 500-char roomId -> DENIED (`isValidId` check).
7. **Timestamp Forgery**: Client passes a past `createdAt` or `updatedAt` instead of `serverTimestamp()` (`request.time`) -> DENIED.
8. **Host Hijacking**: Non-host Player B updates `hostUid` or `puzzleId` on `/rooms/ABC123` -> DENIED.
9. **Terminal Room Status Reversal**: Player updates a `finished` room back to `playing` without host reset or attempts to overwrite `winnerUid` after finish -> DENIED.
10. **Non-Member Piece Tampering**: User C (not in `/rooms/ABC123/players`) attempts to update `/rooms/ABC123/pieces/p0` -> DENIED.
11. **Locked Piece Unlock Attack**: Player B attempts to change `locked: true` back to `locked: false` on a solved co-op piece -> DENIED.
12. **Blanket User List Scraping**: Client attempts `getDocs(collection(db, 'users'))` -> DENIED (`allow list: if false`).
