import * as THREE from 'three';
import * as xb from 'xrblocks';
import { soundFX } from '../audio/SoundFX.ts';
import {
  type Difficulty,
  type PuzzleId,
  type RoomPieceState,
  type RoomPlayer,
} from '../types.ts';
import { ProceduralMaterialLibrary } from './ProceduralMaterials.ts';
import { getPuzzleBlueprint, type PuzzleBlueprint } from './PuzzleDefinitions.ts';
import { PuzzlePieceScript } from './PuzzlePieceScript.ts';

interface BurstParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

export interface ArenaEvents {
  onPieceGrabbed: (piece: PuzzlePieceScript) => void;
  onPieceRotated: (piece: PuzzlePieceScript) => void;
  onPiecePlaced: (placedCount: number, totalPieces: number, accuracy: number, piece: PuzzlePieceScript) => void;
  onMisplacement: (accuracy: number) => void;
  onPuzzleCompleted: (accuracy: number) => void;
  onPieceNetworkSync: (piece: PuzzlePieceScript, locked: boolean, heldByMe: boolean) => void;
  onSelectedPieceChange: (piece: PuzzlePieceScript | null) => void;
}

const _tmpVec = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();

export class PuzzleArena extends xb.Script {
  public readonly mats = new ProceduralMaterialLibrary();
  private events: ArenaEvents;

  private pedestalGroup: THREE.Group | null = null;
  private blueprint: PuzzleBlueprint | null = null;
  public pieces: PuzzlePieceScript[] = [];
  public selectedPiece: PuzzlePieceScript | null = null;

  public puzzleId: PuzzleId = 'chrono-cube';
  public difficulty: Difficulty = 'normal';
  public ghostGuides = true;
  public snapAssist = true;
  public paused = false;
  public isTutorial = false;

  private attempts = 0;
  private misplacements = 0;
  private hintsUsed = 0;
  private hintPieceId: string | null = null;
  private hintTimer = 0;

  // Particle bursts on snap
  private burstPool: BurstParticle[] = [];
  private burstGeo = new THREE.OctahedronGeometry(0.008, 0);

  // Remote multiplayer hand/cursor avatars around the shared board
  private remoteCursors = new Map<string, { group: THREE.Group; target: THREE.Vector3 }>();

  // Ambient living room floor shadow & subtle studio lighting rig
  private keyLight?: THREE.DirectionalLight;

  constructor(events: ArenaEvents) {
    super();
    this.events = events;
    this.position.set(0, 0.92, -0.68);
  }

  override init(): void {
    const renderer = xb.core.renderer;
    if (renderer instanceof THREE.WebGLRenderer) {
      this.mats.initEnvironment(renderer, xb.scene);
    }

    // Balanced 3-point warm/cool studio lighting rig
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.35);
    xb.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff7ed, 2.1);
    key.position.set(1.6, 2.8, 1.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.2;
    key.shadow.camera.far = 8;
    const d = 1.2;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    xb.scene.add(key);
    this.keyLight = key;

    const rim = new THREE.DirectionalLight(0x38bdf8, 0.95);
    rim.position.set(-1.5, 1.6, -1.8);
    xb.scene.add(rim);

    // Pre-allocate burst particle pool (zero GC in loop)
    for (let i = 0; i < 18; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0 });
      const m = new THREE.Mesh(this.burstGeo, mat);
      m.visible = false;
      this.add(m);
      this.burstPool.push({ mesh: m, vel: new THREE.Vector3(), life: 0 });
    }

    this.loadPuzzle('chrono-cube', 'normal', false);
  }

  async recenterOnTable(): Promise<boolean> {
    // Try XR Blocks physical surface detection in living room first
    let placedOnSurface = false;
    try {
      if (xb.world?.planes) {
        placedOnSurface = await xb.world.placeOnHorizontalSurface(this, { milliseconds: 600 });
      }
    } catch {
      placedOnSurface = false;
    }

    if (!placedOnSurface) {
      const cam = xb.core.camera;
      cam.getWorldDirection(_tmpDir);
      _tmpDir.y = 0;
      if (_tmpDir.lengthSq() < 0.001) _tmpDir.set(0, 0, -1);
      _tmpDir.normalize();

      cam.getWorldPosition(_tmpVec);
      this.position.set(
        _tmpVec.x + _tmpDir.x * 0.66,
        Math.max(0.68, _tmpVec.y - 0.42),
        _tmpVec.z + _tmpDir.z * 0.66
      );
      this.lookAt(_tmpVec.x, this.position.y, _tmpVec.z);
      this.rotateY(Math.PI);
    }

    soundFX.playVoiceChirp();
    return placedOnSurface;
  }

  loadPuzzle(puzzleId: PuzzleId, difficulty: Difficulty, tutorialMode = false): void {
    this.clearCurrentPuzzle();
    this.puzzleId = puzzleId;
    this.difficulty = difficulty;
    this.isTutorial = tutorialMode;
    this.paused = false;
    this.attempts = 0;
    this.misplacements = 0;
    this.hintsUsed = 0;
    this.hintPieceId = null;
    this.hintTimer = 0;

    const bp = getPuzzleBlueprint(puzzleId);
    this.blueprint = bp;

    this.pedestalGroup = bp.buildBase(this.mats);
    this.add(this.pedestalGroup);

    bp.pieces.forEach((spec, idx) => {
      const piece = new PuzzlePieceScript(spec, this.mats, {
        onGrabbed: (p) => this.handlePieceGrabbed(p),
        onReleased: (p) => this.handlePieceReleased(p),
        onMoved: (p) => this.handlePieceMoved(p),
        onSelected: (p) => this.selectPiece(p),
      });

      this.add(piece.ghostGroup);
      this.add(piece);
      this.pieces.push(piece);

      // In Tutorial Mode, pre-lock the first 4 pieces so the player masters Grab -> Rotate -> Assemble on the final keystone!
      if (tutorialMode && idx < bp.pieces.length - 1) {
        piece.lockAtTarget(false);
      }
    });

    // Auto-select first unlocked piece for keyboard/voice convenience
    const firstUnlocked = this.pieces.find((p) => !p.locked) || null;
    this.selectPiece(firstUnlocked);
  }

  private clearCurrentPuzzle(): void {
    this.selectedPiece = null;
    if (this.pedestalGroup) {
      this.remove(this.pedestalGroup);
      this.pedestalGroup = null;
    }
    for (const p of this.pieces) {
      this.remove(p.ghostGroup);
      this.remove(p);
      p.disposeResources();
    }
    this.pieces = [];
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const p of this.pieces) {
      if (!p.locked) {
        p.setManipulationEnabled(!paused);
      }
    }
  }

  selectPiece(piece: PuzzlePieceScript | null): void {
    for (const p of this.pieces) {
      p.setSelected(p === piece && !p.locked);
    }
    this.selectedPiece = piece && !piece.locked ? piece : null;
    this.events.onSelectedPieceChange(this.selectedPiece);
  }

  selectNextPiece(): PuzzlePieceScript | null {
    const unlocked = this.pieces.filter((p) => !p.locked);
    if (unlocked.length === 0) return null;
    const idx = this.selectedPiece ? unlocked.indexOf(this.selectedPiece) : -1;
    const next = unlocked[(idx + 1) % unlocked.length];
    this.selectPiece(next);
    soundFX.playRotateClick();
    return next;
  }

  rotateSelected(axis: 'x' | 'y' | 'z', dir: 1 | -1, angleDeg = 45): boolean {
    if (this.paused) return false;
    const target = this.selectedPiece || this.pieces.find((p) => !p.locked) || null;
    if (!target || target.locked) return false;
    this.selectPiece(target);
    target.rotateStep(axis, THREE.MathUtils.degToRad(angleDeg * dir));
    soundFX.playRotateClick();
    this.events.onPieceRotated(target);
    return true;
  }

  triggerHint(): PuzzlePieceScript | null {
    const target = (this.selectedPiece && !this.selectedPiece.locked)
      ? this.selectedPiece
      : this.pieces.find((p) => !p.locked) || null;
    if (!target) return null;

    this.hintsUsed += 1;
    this.selectPiece(target);
    this.hintPieceId = target.spec.id;
    this.hintTimer = 5.0;
    // Gently orient piece closer to target rotation as helpful hint nudge
    target.animPos.copy(target.position);
    target.animQuat.copy(target.targetLocalQuat);
    soundFX.playVoiceChirp();
    return target;
  }

  trySnapSelected(): boolean {
    const target = this.selectedPiece || this.pieces.find((p) => !p.locked);
    if (!target || target.locked) return false;
    const { posOk, rotOk } = target.isAlignedFor(this.difficulty, this.snapAssist);
    if (posOk && rotOk) {
      this.completePieceSnap(target);
      return true;
    }
    return false;
  }

  getAccuracy(): number {
    const penalty = this.misplacements * 5 + this.hintsUsed * 6;
    return Math.max(20, Math.min(100, 100 - penalty));
  }

  getPlacedCount(): number {
    return this.pieces.filter((p) => p.locked).length;
  }

  private handlePieceGrabbed(piece: PuzzlePieceScript): void {
    if (this.paused) return;
    soundFX.playGrab();
    this.events.onPieceGrabbed(piece);
    this.events.onPieceNetworkSync(piece, false, true);
  }

  private handlePieceMoved(piece: PuzzlePieceScript): void {
    if (this.paused) return;
    this.events.onPieceNetworkSync(piece, piece.locked, piece.isGrabbed);
  }

  private handlePieceReleased(piece: PuzzlePieceScript): void {
    if (this.paused || piece.locked) return;
    this.attempts += 1;

    const { posOk, rotOk, near } = piece.isAlignedFor(this.difficulty, this.snapAssist);
    if (posOk && rotOk) {
      this.completePieceSnap(piece);
    } else {
      // Only count misplacement if user dropped it onto the assembly zone misaligned
      const distFromCenter = Math.hypot(piece.position.x, piece.position.z);
      const radius = this.blueprint?.pedestalRadius ?? 0.26;
      if (near || distFromCenter < radius * 0.92) {
        this.misplacements += 1;
        soundFX.playWrongDrop();
        this.events.onMisplacement(this.getAccuracy());
      }
      this.events.onPieceNetworkSync(piece, false, false);
    }
  }

  private completePieceSnap(piece: PuzzlePieceScript): void {
    piece.lockAtTarget(true);
    const placed = this.getPlacedCount();
    const total = this.pieces.length;
    const accuracy = this.getAccuracy();

    soundFX.playSnapSuccess(placed - 1);
    this.spawnBurst(piece.targetLocalPos, piece.spec.accentColor);
    this.events.onPieceNetworkSync(piece, true, false);
    this.events.onPiecePlaced(placed, total, accuracy, piece);

    // Select next unlocked piece automatically
    const next = this.pieces.find((p) => !p.locked) || null;
    this.selectPiece(next);

    if (placed === total) {
      soundFX.playVictoryFanfare();
      this.events.onPuzzleCompleted(accuracy);
    }
  }

  private spawnBurst(localPos: THREE.Vector3, colorHex: number): void {
    for (let i = 0; i < this.burstPool.length; i++) {
      const b = this.burstPool[i];
      b.mesh.position.copy(localPos);
      b.mesh.visible = true;
      (b.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.65;
      const speed = 0.25 + Math.random() * 0.45;
      b.vel.set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed + 0.15,
        Math.sin(phi) * Math.sin(theta) * speed
      );
      b.life = 0.55;
    }
  }

  // Apply remote co-op piece transforms & remote player hand cursors
  syncRemotePieces(remotePieces: RoomPieceState[], myUid: string): void {
    for (const rp of remotePieces) {
      const local = this.pieces.find((p) => p.spec.id === rp.pieceId);
      if (!local) continue;
      if (rp.heldByUid === myUid && local.isGrabbed) continue;
      local.applyRemoteState(rp.pos, rp.quat, rp.locked, rp.heldByUid && rp.heldByUid !== myUid ? rp.heldByName : '');
    }

    const placed = this.getPlacedCount();
    const total = this.pieces.length;
    if (total > 0 && placed === total) {
      // All locked via co-op
      this.selectPiece(null);
    }
  }

  syncRemoteCursors(players: RoomPlayer[], myUid: string): void {
    const activeIds = new Set<string>();
    for (const pl of players) {
      if (pl.uid === myUid) continue;
      activeIds.add(pl.uid);
      let entry = this.remoteCursors.get(pl.uid);
      if (!entry) {
        const g = new THREE.Group();
        const orb = new THREE.Mesh(
          new THREE.SphereGeometry(0.016, 14, 14),
          new THREE.MeshStandardMaterial({
            color: 0xf43f5e,
            emissive: 0xf43f5e,
            emissiveIntensity: 0.7,
            roughness: 0.2,
          })
        );
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.022, 0.028, 20),
          new THREE.MeshBasicMaterial({ color: 0xfda4af, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        g.add(orb, ring);
        this.add(g);
        entry = { group: g, target: new THREE.Vector3(...pl.handPos) };
        this.remoteCursors.set(pl.uid, entry);
      }
      entry.target.set(pl.handPos[0], pl.handPos[1], pl.handPos[2]);
    }

    for (const [uid, entry] of this.remoteCursors.entries()) {
      if (!activeIds.has(uid)) {
        this.remove(entry.group);
        this.remoteCursors.delete(uid);
      }
    }
  }

  getLocalPiecesSnapshot(): Array<{
    pieceId: string;
    pos: [number, number, number];
    quat: [number, number, number, number];
  }> {
    return this.pieces.map((p) => ({
      pieceId: p.spec.id,
      pos: [p.position.x, p.position.y, p.position.z],
      quat: [p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w],
    }));
  }

  override update(): void {
    const dt = Math.min(0.05, xb.getDeltaTime() || 0.016);

    if (this.hintTimer > 0) {
      this.hintTimer = Math.max(0, this.hintTimer - dt);
      if (this.hintTimer === 0) this.hintPieceId = null;
    }

    // Update ghost socket guides
    for (const p of this.pieces) {
      p.updateGhostVisual(
        this.difficulty,
        this.snapAssist,
        this.ghostGuides || this.isTutorial,
        this.hintPieceId === p.spec.id
      );
    }

    // Update snap particle bursts
    for (const b of this.burstPool) {
      if (b.life > 0) {
        b.life -= dt;
        b.vel.y -= 1.6 * dt;
        b.mesh.position.addScaledVector(b.vel, dt);
        b.mesh.rotation.x += dt * 6;
        b.mesh.rotation.y += dt * 8;
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.life / 0.55);
        if (b.life <= 0) b.mesh.visible = false;
      }
    }

    // Smooth remote player cursor interpolation
    const alpha = 1 - Math.exp(-10 * dt);
    for (const entry of this.remoteCursors.values()) {
      entry.group.position.lerp(entry.target, alpha);
    }

    if (this.keyLight) {
      this.keyLight.target.position.copy(this.position);
      this.keyLight.target.updateMatrixWorld();
    }
  }

  override dispose(): void {
    this.clearCurrentPuzzle();
    this.burstGeo.dispose();
    this.mats.dispose();
  }
}
