import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type MaterialFinish = 'anodized' | 'brass' | 'ceramic' | 'crystal' | 'walnut' | 'slate';

export class ProceduralMaterialLibrary {
  private textures: THREE.Texture[] = [];
  private materials: THREE.Material[] = [];
  private maxAniso = 4;
  private isSoftwareGl = false;

  initEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param) || '');
      this.isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      this.isSoftwareGl = false;
    }

    this.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);

    // Ensure rich reflections for metallic & crystal puzzle pieces
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    this.textures.push(envTex);
    pmrem.dispose();
  }

  createContactShadowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(128, 128, 18, 128, 128, 126);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.22)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(tex);
    return tex;
  }

  createGridPadTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle carbon weave / precision grid
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.lineWidth = 1;
    const step = 32;
    for (let i = 0; i <= 512; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    // Concentric precision target circles
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.32)';
    ctx.lineWidth = 2;
    [70, 140, 210].forEach((r) => {
      ctx.beginPath();
      ctx.arc(256, 256, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Crosshairs
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
    ctx.beginPath();
    ctx.moveTo(256, 24);
    ctx.lineTo(256, 488);
    ctx.moveTo(24, 256);
    ctx.lineTo(488, 256);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.maxAniso;
    this.textures.push(tex);
    return tex;
  }

  private createBrushedTexture(baseHex: string, streakAlpha = 0.08): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);

    for (let y = 0; y < 256; y += 2) {
      const bright = Math.random() > 0.5 ? 255 : 0;
      ctx.fillStyle = `rgba(${bright},${bright},${bright},${Math.random() * streakAlpha})`;
      ctx.fillRect(0, y, 256, 1);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = this.maxAniso;
    this.textures.push(tex);
    return tex;
  }

  createMaterial(finish: MaterialFinish, colorHex: number): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
    const colorStr = '#' + new THREE.Color(colorHex).getHexString();

    if (finish === 'brass') {
      const mat = new THREE.MeshPhysicalMaterial({
        color: colorHex,
        map: this.createBrushedTexture(colorStr, 0.07),
        metalness: 0.92,
        roughness: 0.22,
        anisotropy: 0.75,
        clearcoat: 0.25,
      });
      this.materials.push(mat);
      return mat;
    }

    if (finish === 'crystal') {
      const mat = new THREE.MeshPhysicalMaterial({
        color: colorHex,
        metalness: 0.05,
        roughness: 0.08,
        transmission: this.isSoftwareGl ? 0 : 0.72,
        transparent: true,
        opacity: this.isSoftwareGl ? 0.65 : 0.94,
        ior: 1.58,
        thickness: 0.2,
        clearcoat: 1.0,
        emissive: colorHex,
        emissiveIntensity: 0.14,
      });
      this.materials.push(mat);
      return mat;
    }

    if (finish === 'ceramic') {
      const mat = new THREE.MeshPhysicalMaterial({
        color: colorHex,
        metalness: 0.06,
        roughness: 0.32,
        clearcoat: 0.85,
        clearcoatRoughness: 0.12,
      });
      this.materials.push(mat);
      return mat;
    }

    if (finish === 'walnut') {
      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        map: this.createBrushedTexture(colorStr, 0.12),
        metalness: 0.04,
        roughness: 0.58,
      });
      this.materials.push(mat);
      return mat;
    }

    if (finish === 'slate') {
      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        metalness: 0.25,
        roughness: 0.68,
      });
      this.materials.push(mat);
      return mat;
    }

    // Default: anodized aluminum
    const mat = new THREE.MeshPhysicalMaterial({
      color: colorHex,
      map: this.createBrushedTexture(colorStr, 0.06),
      metalness: 0.72,
      roughness: 0.34,
      clearcoat: 0.3,
      clearcoatRoughness: 0.28,
    });
    this.materials.push(mat);
    return mat;
  }

  createGhostMaterial(colorHex = 0x38bdf8): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.22,
      wireframe: false,
      depthWrite: false,
    });
    this.materials.push(mat);
    return mat;
  }

  dispose(): void {
    this.textures.forEach((t) => t.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures = [];
    this.materials = [];
  }
}
