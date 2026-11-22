import * as THREE from 'three';
import * as xb from 'xrblocks';
import { type Difficulty } from '../types.ts';
import { type ProceduralMaterialLibrary } from './ProceduralMaterials.ts';
import { type PuzzlePieceSpec } from './PuzzleDefinitions.ts';

const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _quatA = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);

export interface PieceCallbacks {
  onGrabbed: (piece: PuzzlePieceScript) => void;
  onReleased: (piece: PuzzlePieceScript) => void;
  onMoved: (piece: PuzzlePieceScript) => void;
  onSelected: (piece: PuzzlePieceScript) => void;
}

export class PuzzlePieceScript extends xb.Script {
  public readonly spec: PuzzlePieceSpec;
  public readonly targetLocalPos: THREE.Vector3;
  public readonly targetLocalQuat: THREE.Quaternion;
  public readonly scatterLocalPos: THREE.Vector3;
  public readonly scatterLocalQuat: THREE.Quaternion;

  public meshGroup: THREE.Group;
  public ghostGroup: THREE.Group;
  private ghostMat: THREE.MeshBasicMaterial;
  private selectionHalo: THREE.Mesh;
  private haloMat: THREE.MeshBasicMaterial;

  public locked = false;
  public selected = false;
  public isGrabbed = false;
  public remoteHeldBy = '';

  // Smooth spring / lerp targets
  public animPos = new THREE.Vector3();
  public animQuat = new THREE.Quaternion();
  private useAnimTarget = false;
  private snapPopTimer = 0;

  // Hand/controller twist tracking during grab
  private activeSource: xb.InteractionSource | null = null;
  private grabStartSourceQuat = new THREE.Quaternion();
  private grabStartPieceQuat = new THREE.Quaternion();
  private hasSourceQuat = false;
  private lastSyncAt = 0;

  // Secondary hand trackball rotation
  private secondHandPrevPos = new THREE.Vector3();
  private secondHandActive = false;

  private callbacks: PieceCallbacks;

  constructor(
    spec: PuzzlePieceSpec,
    mats: ProceduralMaterialLibrary,
    callbacks: PieceCallbacks
  ) {
    super();
    this.spec = spec;
    this.callbacks = callbacks;

    this.targetLocalPos = new THREE.Vector3(...spec.targetLocalPos);
    this.targetLocalQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...spec.targetLocalEuler)
    );
    this.scatterLocalPos = new THREE.Vector3(...spec.scatterLocalPos);
    this.scatterLocalQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...spec.scatterLocalEuler)
    );

    this.meshGroup = spec.buildMesh(mats);
    this.add(this.meshGroup);

    // Selection halo ring
    this.haloMat = new THREE.MeshBasicMaterial({
      color: spec.accentColor,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.selectionHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.068, 0.076, 32),
      this.haloMat
    );
    this.selectionHalo.rotation.x = -Math.PI / 2;
    this.selectionHalo.position.y = -0.025;
    this.add(this.selectionHalo);

    // Ghost target guide mesh (added to workbench parent by PuzzleArena)
    this.ghostMat = mats.createGhostMaterial(spec.accentColor);
    this.ghostGroup = spec.buildMesh(mats);
    this.ghostGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.material = this.ghostMat;
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
    this.ghostGroup.position.copy(this.targetLocalPos);
    this.ghostGroup.quaternion.copy(this.targetLocalQuat);

    // Configure XR Blocks manipulation (translate only; rotation via wrist twist, second hand, keys, HUD, or voice)
    this.xb = {
      manipulation: {
        actions: {
          translate: {
            faceCamera: false,
            scaleWithDistance: false,
            pushPull: true,
            minDistance: 0.25,
            maxDistance: 2.5,
          },
          rotate: false,
          scale: false,
        },
      },
    };

    this.resetToScatter(false);
  }

  resetToScatter(animated = false): void {
    this.locked = false;
    this.isGrabbed = false;
    this.activeSource = null;
    this.remoteHeldBy = '';
    this.ghostGroup.visible = true;
    this.setManipulationEnabled(true);

    if (animated) {
      this.animPos.copy(this.scatterLocalPos);
      this.animQuat.copy(this.scatterLocalQuat);
      this.useAnimTarget = true;
    } else {
      this.useAnimTarget = false;
      this.position.copy(this.scatterLocalPos);
      this.quaternion.copy(this.scatterLocalQuat);
    }
  }

  setManipulationEnabled(enabled: boolean): void {
    if (this.xb?.manipulation) {
      this.xb.manipulation = enabled
        ? {
            actions: {
              translate: {
                faceCamera: false,
                scaleWithDistance: false,
                pushPull: true,
                minDistance: 0.25,
                maxDistance: 2.5,
              },
              rotate: false,
              scale: false,
            },
          }
        : false;
    }
  }

  setSelected(val: boolean): void {
    this.selected = val;
  }

  rotateStep(axis: 'x' | 'y' | 'z', angleRad: number): void {
    if (this.locked) return;
    _vecA.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    _quatA.setFromAxisAngle(_vecA, angleRad);
    this.quaternion.premultiply(_quatA).normalize();
    this.grabStartPieceQuat.copy(this.quaternion);
    if (this.activeSource?.controller) {
      this.grabStartSourceQuat.copy(this.activeSource.controller.quaternion);
    }
    this.callbacks.onMoved(this);
  }

  applyRemoteState(pos: [number, number, number], quat: [number, number, number, number], locked: boolean, heldByName: string): void {
    if (this.isGrabbed) return;
    this.remoteHeldBy = heldByName;
    this.animPos.set(pos[0], pos[1], pos[2]);
    this.animQuat.set(quat[0], quat[1], quat[2], quat[3]);
    this.useAnimTarget = true;
    if (locked && !this.locked) {
      this.lockAtTarget(false);
    }
  }

  lockAtTarget(snapAnim = true): void {
    this.locked = true;
    this.isGrabbed = false;
    this.activeSource = null;
    this.selected = false;
    this.remoteHeldBy = '';
    this.setManipulationEnabled(false);
    this.ghostGroup.visible = false;
    this.haloMat.opacity = 0;

    if (snapAnim) {
      this.animPos.copy(this.targetLocalPos);
      this.animQuat.copy(this.targetLocalQuat);
      this.useAnimTarget = true;
      this.snapPopTimer = 0.28;
    } else {
      this.useAnimTarget = false;
      this.position.copy(this.targetLocalPos);
      this.quaternion.copy(this.targetLocalQuat);
    }
  }

  getPositionError(): number {
    return this.position.distanceTo(this.targetLocalPos);
  }

  getOrientationErrorRad(): number {
    const sym = this.spec.symmetry;
    if (sym === 'y-full') {
      _vecA.copy(_axisY).applyQuaternion(this.quaternion).normalize();
      _vecB.copy(_axisY).applyQuaternion(this.targetLocalQuat).normalize();
      return Math.acos(THREE.MathUtils.clamp(_vecA.dot(_vecB), -1, 1));
    }

    const folds = sym === 'y-12' ? 12 : sym === 'y-4' ? 4 : sym === 'z-2' ? 2 : 1;
    let best = Math.PI;
    for (let i = 0; i < folds; i++) {
      const a = (i * Math.PI * 2) / folds;
      _quatA.setFromAxisAngle(_axisY, a);
      _quatB.copy(this.targetLocalQuat).multiply(_quatA);
      const dot = Math.abs(THREE.MathUtils.clamp(this.quaternion.dot(_quatB), -1, 1));
      const err = 2 * Math.acos(dot);
      if (err < best) best = err;
    }
    return best;
  }

  isAlignedFor(difficulty: Difficulty, snapAssist: boolean): { posOk: boolean; rotOk: boolean; near: boolean } {
    const basePosTol = difficulty === 'easy' ? 0.085 : difficulty === 'normal' ? 0.062 : 0.044;
    const baseRotDeg = difficulty === 'easy' ? 38 : difficulty === 'normal' ? 26 : 16;
    const assistMul = snapAssist ? 1.25 : 1.0;

    const posTol = basePosTol * assistMul;
    const rotTol = THREE.MathUtils.degToRad(baseRotDeg * assistMul);

    const posErr = this.getPositionError();
    const rotErr = this.getOrientationErrorRad();

    return {
      posOk: posErr <= posTol,
      rotOk: rotErr <= rotTol,
      near: posErr <= posTol * 2.1,
    };
  }

  override onObjectSelectStart(event: xb.SelectEvent): void {
    if (this.locked) return;
    this.callbacks.onSelected(this);
    this.beginGrab(event.source);
  }

  override onObjectGrabStart(event: xb.ObjectGrabEvent): void {
    if (this.locked) return;
    this.callbacks.onSelected(this);
    this.beginGrab(event.source);
  }

  override onObjectManipulate(event: xb.ManipulationEvent): void {
    if (this.locked) {
      event.preventDefault();
      return;
    }
    if (event.phase === 'start') {
      this.callbacks.onSelected(this);
      this.beginGrab(event.source);
    } else if (event.phase === 'update') {
      // Keep piece slightly above plinth floor while dragging
      if (this.position.y < 0.035) {
        this.position.y = 0.035;
      }
      const now = performance.now();
      if (now - this.lastSyncAt > 90) {
        this.lastSyncAt = now;
        this.callbacks.onMoved(this);
      }
    } else if (event.phase === 'end' || event.phase === 'cancel') {
      this.endGrab();
    }
  }

  override onObjectSelectEnd(): void {
    if (this.isGrabbed) {
      this.endGrab();
    }
  }

  override onObjectGrabEnd(): void {
    if (this.isGrabbed) {
      this.endGrab();
    }
  }

  private beginGrab(source: xb.InteractionSource): void {
    if (this.locked) return;
    this.useAnimTarget = false;
    this.isGrabbed = true;
    this.activeSource = source;
    this.grabStartPieceQuat.copy(this.quaternion);
    this.secondHandActive = false;

    const ctrl = source?.controller;
    if (ctrl && (source.type === 'hand-ray' || source.type === 'controller-ray' || source.type === 'direct-touch')) {
      ctrl.getWorldQuaternion(this.grabStartSourceQuat);
      this.hasSourceQuat = true;
    } else {
      this.hasSourceQuat = false;
    }

    this.callbacks.onGrabbed(this);
  }

  private endGrab(): void {
    if (!this.isGrabbed) return;
    this.isGrabbed = false;
    this.activeSource = null;
    this.hasSourceQuat = false;
    this.secondHandActive = false;
    if (this.position.y < 0.04) {
      this.position.y = 0.04;
    }
    this.callbacks.onReleased(this);
  }

  updateGhostVisual(difficulty: Difficulty, snapAssist: boolean, showGhosts: boolean, hintActive: boolean): void {
    if (this.locked) {
      this.ghostGroup.visible = false;
      return;
    }

    const { posOk, rotOk, near } = this.isAlignedFor(difficulty, snapAssist);
    const shouldShow = showGhosts || hintActive || (this.isGrabbed && near);
    this.ghostGroup.visible = shouldShow;

    if (!shouldShow) return;

    if (posOk && rotOk) {
      this.ghostMat.color.setHex(0x22c55e); // Emerald: ready to lock!
      this.ghostMat.opacity = 0.45;
    } else if (near) {
      this.ghostMat.color.setHex(0xfbbf24); // Amber: close, twist to align
      this.ghostMat.opacity = 0.36;
    } else if (hintActive) {
      this.ghostMat.color.setHex(0x38bdf8);
      this.ghostMat.opacity = 0.42;
    } else {
      this.ghostMat.color.setHex(this.spec.accentColor);
      this.ghostMat.opacity = 0.16;
    }
  }

  override update(): void {
    const dt = Math.min(0.05, xb.getDeltaTime() || 0.016);

    // 1. Hand / controller wrist-twist rotation while holding piece
    if (this.isGrabbed && this.hasSourceQuat && this.activeSource?.controller) {
      this.activeSource.controller.getWorldQuaternion(_quatA);
      // delta = current * start^-1
      _quatB.copy(this.grabStartSourceQuat).invert();
      _quatA.multiply(_quatB);
      this.quaternion.copy(_quatA).multiply(this.grabStartPieceQuat).normalize();

      // Optional bimanual second-hand arcball rotation when second hand pinches
      const primaryIdx = xb.user.controllers.indexOf(this.activeSource.controller);
      const otherIdx = primaryIdx === 0 ? 1 : primaryIdx === 1 ? 0 : -1;
      if (otherIdx >= 0 && xb.user.isSelecting(otherIdx)) {
        const p = xb.user.getControllerPosition(otherIdx, _vecA);
        if (!this.secondHandActive) {
          this.secondHandPrevPos.copy(p);
          this.secondHandActive = true;
        } else {
          _vecB.copy(p).sub(this.secondHandPrevPos);
          this.secondHandPrevPos.copy(p);
          const yaw = _vecB.x * 5.0;
          const pitch = -_vecB.y * 5.0;
          if (Math.abs(yaw) > 0.001 || Math.abs(pitch) > 0.001) {
            _quatA.setFromEuler(new THREE.Euler(pitch, yaw, 0));
            this.grabStartPieceQuat.premultiply(_quatA).normalize();
          }
        }
      } else {
        this.secondHandActive = false;
      }
    }

    // 2. Smooth animation target (snap-in, scatter reset, or remote co-op sync)
    if (this.useAnimTarget && !this.isGrabbed) {
      const alpha = 1 - Math.exp(-12 * dt);
      this.position.lerp(this.animPos, alpha);
      this.quaternion.slerp(this.animQuat, alpha);
      if (this.position.distanceTo(this.animPos) < 0.0015 && this.quaternion.angleTo(this.animQuat) < 0.01) {
        this.position.copy(this.animPos);
        this.quaternion.copy(this.animQuat);
        this.useAnimTarget = false;
      }
    }

    // 3. Snap pop scale pulse
    if (this.snapPopTimer > 0) {
      this.snapPopTimer = Math.max(0, this.snapPopTimer - dt);
      const s = 1 + Math.sin((this.snapPopTimer / 0.28) * Math.PI) * 0.1;
      this.meshGroup.scale.setScalar(s);
    } else if (this.meshGroup.scale.x !== 1) {
      this.meshGroup.scale.setScalar(1);
    }

    // 4. Selection halo visibility
    const targetOpacity = this.locked ? 0 : this.isGrabbed ? 0.85 : this.selected ? 0.65 : this.remoteHeldBy ? 0.5 : 0;
    this.haloMat.opacity = THREE.MathUtils.lerp(this.haloMat.opacity, targetOpacity, 1 - Math.exp(-14 * dt));
    if (this.haloMat.opacity > 0.02) {
      this.haloMat.color.setHex(this.remoteHeldBy ? 0xf43f5e : this.spec.accentColor);
      this.selectionHalo.rotation.z += dt * 1.4;
    }
  }

  disposeResources(): void {
    this.haloMat.dispose();
    this.ghostMat.dispose();
    this.selectionHalo.geometry.dispose();
  }
}
