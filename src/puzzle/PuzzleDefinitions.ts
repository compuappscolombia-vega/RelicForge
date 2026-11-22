import * as THREE from 'three';
import { type PuzzleId } from '../types.ts';
import { type MaterialFinish, ProceduralMaterialLibrary } from './ProceduralMaterials.ts';

export type SymmetryType = 'none' | 'y-4' | 'y-12' | 'y-full' | 'z-2';

export interface PuzzlePieceSpec {
  id: string;
  name: string;
  finish: MaterialFinish;
  color: number;
  accentColor: number;
  targetLocalPos: [number, number, number];
  targetLocalEuler: [number, number, number];
  scatterLocalPos: [number, number, number];
  scatterLocalEuler: [number, number, number];
  symmetry: SymmetryType;
  buildMesh: (mats: ProceduralMaterialLibrary) => THREE.Group;
}

export interface PuzzleBlueprint {
  id: PuzzleId;
  title: string;
  pedestalRadius: number;
  buildBase: (mats: ProceduralMaterialLibrary) => THREE.Group;
  pieces: PuzzlePieceSpec[];
}

function createBeveledBlock(w: number, h: number, d: number, bevel = 0.004): THREE.BufferGeometry {
  const hw = w / 2 - bevel;
  const hh = h / 2 - bevel;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.004, d - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geo.center();
  return geo;
}

function createGearShapeGeometry(teeth: number, outerR: number, innerR: number, boreR: number, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;

  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const a1 = a0 + step * 0.22;
    const a2 = a0 + step * 0.34;
    const a3 = a0 + step * 0.66;
    const a4 = a0 + step * 0.78;

    const p0x = Math.cos(a0) * innerR;
    const p0y = Math.sin(a0) * innerR;
    if (i === 0) shape.moveTo(p0x, p0y);
    else shape.lineTo(p0x, p0y);

    shape.lineTo(Math.cos(a1) * innerR, Math.sin(a1) * innerR);
    shape.lineTo(Math.cos(a2) * outerR, Math.sin(a2) * outerR);
    shape.lineTo(Math.cos(a3) * outerR, Math.sin(a3) * outerR);
    shape.lineTo(Math.cos(a4) * innerR, Math.sin(a4) * innerR);
  }
  shape.closePath();

  if (boreR > 0.002) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, boreR, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.0025,
    bevelSize: 0.002,
    bevelSegments: 2,
  });
  geo.center();
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Helper to create a multi-voxel interlocking Soma-style polycube module
 * with brass corner pins and glowing seam inlay so every piece is a 4-8 part Group.
 */
function buildPolycubeModule(
  cells: Array<[number, number, number]>,
  unit: number,
  finish: MaterialFinish,
  color: number,
  accentColor: number,
  mats: ProceduralMaterialLibrary
): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = mats.createMaterial(finish, color);
  const accentMat = mats.createMaterial('brass', accentColor);
  const glowMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.55,
    roughness: 0.25,
    metalness: 0.1,
  });

  // Compute centroid so local origin sits at piece center for intuitive rotation
  const center = new THREE.Vector3();
  cells.forEach(([x, y, z]) => center.add(new THREE.Vector3(x * unit, y * unit, z * unit)));
  center.divideScalar(cells.length);

  const blockGeo = createBeveledBlock(unit * 0.96, unit * 0.96, unit * 0.96, 0.004);
  const pinGeo = new THREE.CylinderGeometry(unit * 0.14, unit * 0.14, unit * 0.14, 16);
  const ringGeo = new THREE.TorusGeometry(unit * 0.22, 0.0022, 8, 24);

  cells.forEach(([cx, cy, cz], idx) => {
    const lx = cx * unit - center.x;
    const ly = cy * unit - center.y;
    const lz = cz * unit - center.z;

    const cube = new THREE.Mesh(blockGeo, bodyMat);
    cube.position.set(lx, ly, lz);
    cube.castShadow = true;
    cube.receiveShadow = true;
    group.add(cube);

    // Add brass alignment dowel on top of select cells
    if (idx === 0) {
      const pin = new THREE.Mesh(pinGeo, accentMat);
      pin.position.set(lx, ly + unit * 0.48, lz);
      group.add(pin);
    }
    if (idx === cells.length - 1) {
      const inlay = new THREE.Mesh(ringGeo, glowMat);
      inlay.rotation.x = Math.PI / 2;
      inlay.position.set(lx, ly + unit * 0.49, lz);
      group.add(inlay);
    }
  });

  return group;
}

function buildWorkbenchBase(mats: ProceduralMaterialLibrary, accentHex: number, radius = 0.26): THREE.Group {
  const base = new THREE.Group();

  const outerRingMat = mats.createMaterial('slate', 0x1e293b);
  const brassMat = mats.createMaterial('brass', 0xd4a34a);
  const gridTex = mats.createGridPadTexture();
  const padMat = new THREE.MeshStandardMaterial({
    map: gridTex,
    roughness: 0.45,
    metalness: 0.3,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 0.85,
    roughness: 0.2,
    metalness: 0.2,
  });

  // Main octagonal plinth body (bottom at y=0, top surface at y=0.026)
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.06, 0.024, 16), outerRingMat);
  hull.position.y = 0.012;
  hull.receiveShadow = true;
  hull.castShadow = true;
  base.add(hull);

  // Precision target grid inlay pad
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.86, radius * 0.86, 0.004, 32), padMat);
  pad.position.y = 0.025;
  pad.receiveShadow = true;
  base.add(pad);

  // Glowing perimeter ring
  const trim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.89, 0.0032, 10, 48), glowMat);
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 0.026;
  base.add(trim);

  // 4 machined brass corner stabilizer feet
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.012, 12), brassMat);
    foot.position.set(Math.cos(angle) * (radius * 0.95), 0.006, Math.sin(angle) * (radius * 0.95));
    base.add(foot);
  }

  // Soft radial contact shadow under workbench
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2.7, radius * 2.7),
    new THREE.MeshBasicMaterial({
      map: mats.createContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.001;
  base.add(shadowPlane);

  return base;
}

// --- PUZZLE 1: CHRONO CUBE (5 interlocking polycube pieces forming a 2x2x2 + crown monolith) ---
const CHRONO_UNIT = 0.056;
// Let's arrange 5 distinct multi-cell pieces in a 2x2x2 cube + top keystone frame, centered neatly at y = 0.028 + ...
function cellCentroid(cells: Array<[number, number, number]>, unit: number): [number, number, number] {
  let sx = 0, sy = 0, sz = 0;
  cells.forEach(([x, y, z]) => {
    sx += x * unit;
    sy += y * unit;
    sz += z * unit;
  });
  const n = cells.length;
  return [sx / n, sy / n, sz / n];
}

const P1_CELLS: Array<{
  id: string;
  name: string;
  finish: MaterialFinish;
  color: number;
  accent: number;
  cells: Array<[number, number, number]>;
  scatter: [number, number, number];
  scatterRot: [number, number, number];
}> = [
  {
    id: 'chrono_base_l',
    name: 'Sapphire L-Base',
    finish: 'anodized',
    color: 0x0284c7,
    accent: 0x38bdf8,
    cells: [[-0.5, 0, -0.5], [0.5, 0, -0.5], [-0.5, 0, 0.5]],
    scatter: [-0.28, 0.055, 0.16],
    scatterRot: [0, Math.PI / 2, 0],
  },
  {
    id: 'chrono_corner_pillar',
    name: 'Amber Corner Pillar',
    finish: 'brass',
    color: 0xd97706,
    accent: 0xfde047,
    cells: [[0.5, 0, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5]],
    scatter: [0.29, 0.065, 0.14],
    scatterRot: [Math.PI / 2, 0, 0],
  },
  {
    id: 'chrono_spine_arch',
    name: 'Emerald Spine',
    finish: 'ceramic',
    color: 0x059669,
    accent: 0x34d399,
    cells: [[-0.5, 1, -0.5], [-0.5, 1, 0.5], [-0.5, 2, 0.5]],
    scatter: [-0.27, 0.085, -0.17],
    scatterRot: [0, -Math.PI / 2, 0],
  },
  {
    id: 'chrono_bridge_step',
    name: 'Crimson Z-Bridge',
    finish: 'anodized',
    color: 0xe11d48,
    accent: 0xfb7185,
    cells: [[0.5, 2, -0.5], [-0.5, 2, -0.5], [0.5, 2, 0.5]],
    scatter: [0.27, 0.075, -0.16],
    scatterRot: [0, Math.PI, Math.PI / 2],
  },
  {
    id: 'chrono_crown_core',
    name: 'Prismatic Keystone',
    finish: 'crystal',
    color: 0xa855f7,
    accent: 0xe879f9,
    cells: [[0, 3, 0]],
    scatter: [0.0, 0.055, 0.28],
    scatterRot: [0, Math.PI / 4, 0],
  },
];

// --- PUZZLE 2: AETHER CLOCKWORK (5-Stage Brass Planetary Gear & Balance Assembly) ---
function buildAetherClockworkPieces(): PuzzlePieceSpec[] {
  return [
    {
      id: 'cw_bezel',
      name: 'Chronometer Bezel Ring',
      finish: 'brass',
      color: 0xb45309,
      accentColor: 0xfbbf24,
      targetLocalPos: [0, 0.042, 0],
      targetLocalEuler: [0, 0, 0],
      scatterLocalPos: [-0.29, 0.05, 0.14],
      scatterLocalEuler: [Math.PI / 2, 0, 0],
      symmetry: 'y-full',
      buildMesh: (mats) => {
        const g = new THREE.Group();
        const brass = mats.createMaterial('brass', 0xd97706);
        const dark = mats.createMaterial('anodized', 0x1e293b);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.013, 14, 40), brass);
        ring.rotation.x = Math.PI / 2;
        ring.castShadow = true;
        g.add(ring);

        // 8 index lugs
        const lugGeo = new THREE.BoxGeometry(0.014, 0.016, 0.022);
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const lug = new THREE.Mesh(lugGeo, dark);
          lug.position.set(Math.cos(a) * 0.105, 0.008, Math.sin(a) * 0.105);
          lug.rotation.y = -a;
          g.add(lug);
        }
        return g;
      },
    },
    {
      id: 'cw_sun_gear',
      name: 'Solar Drive Gear',
      finish: 'brass',
      color: 0xf59e0b,
      accentColor: 0xfef08a,
      targetLocalPos: [0, 0.046, 0],
      targetLocalEuler: [0, 0, 0],
      scatterLocalPos: [0.29, 0.055, 0.13],
      scatterLocalEuler: [0, Math.PI / 2, Math.PI / 2],
      symmetry: 'y-12',
      buildMesh: (mats) => {
        const g = new THREE.Group();
        const gold = mats.createMaterial('brass', 0xfbbf24);
        const steel = mats.createMaterial('anodized', 0x64748b);
        const gear = new THREE.Mesh(createGearShapeGeometry(12, 0.068, 0.054, 0.018, 0.018), gold);
        gear.castShadow = true;
        g.add(gear);

        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.028, 24), steel);
        collar.castShadow = true;
        g.add(collar);

        const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.045, 16), gold);
        g.add(axle);
        return g;
      },
    },
    {
      id: 'cw_pinion_twin',
      name: 'Twin Planet Pinions',
      finish: 'anodized',
      color: 0x0284c7,
      accentColor: 0x38bdf8,
      targetLocalPos: [0, 0.072, 0],
      targetLocalEuler: [0, 0, 0],
      scatterLocalPos: [-0.28, 0.065, -0.15],
      scatterLocalEuler: [0, Math.PI / 2, 0],
      symmetry: 'z-2',
      buildMesh: (mats) => {
        const g = new THREE.Group();
        const cobalt = mats.createMaterial('anodized', 0x0284c7);
        const brass = mats.createMaterial('brass', 0xf59e0b);
        const carrier = new THREE.Mesh(createBeveledBlock(0.16, 0.012, 0.036, 0.003), cobalt);
        carrier.castShadow = true;
        g.add(carrier);

        [-0.062, 0.062].forEach((x) => {
          const pinion = new THREE.Mesh(createGearShapeGeometry(8, 0.032, 0.024, 0.007, 0.016), brass);
          pinion.position.set(x, -0.012, 0);
          pinion.castShadow = true;
          g.add(pinion);

          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.022, 12), cobalt);
          cap.position.set(x, 0.006, 0);
          g.add(cap);
        });
        return g;
      },
    },
    {
      id: 'cw_bridge_arch',
      name: 'Titanium Escapement Arch',
      finish: 'ceramic',
      color: 0xe2e8f0,
      accentColor: 0x38bdf8,
      targetLocalPos: [0, 0.102, 0],
      targetLocalEuler: [0, 0, 0],
      scatterLocalPos: [0.28, 0.08, -0.15],
      scatterLocalEuler: [Math.PI / 2, Math.PI / 2, 0],
      symmetry: 'z-2',
      buildMesh: (mats) => {
        const g = new THREE.Group();
        const ti = mats.createMaterial('ceramic', 0xe2e8f0);
        const ruby = mats.createMaterial('crystal', 0xf43f5e);
        const arch = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.011, 12, 24, Math.PI), ti);
        arch.position.y = -0.02;
        arch.castShadow = true;
        g.add(arch);

        const bearing = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.014, 20), ti);
        bearing.position.y = 0.055;
        g.add(bearing);

        const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.011, 0), ruby);
        jewel.position.y = 0.066;
        g.add(jewel);
        return g;
      },
    },
    {
      id: 'cw_crown_lens',
      name: 'Sapphire Balance Dome',
      finish: 'crystal',
      color: 0x38bdf8,
      accentColor: 0x7dd3fc,
      targetLocalPos: [0, 0.145, 0],
      targetLocalEuler: [0, 0, 0],
      scatterLocalPos: [0, 0.06, 0.28],
      scatterLocalEuler: [Math.PI / 2, 0, 0],
      symmetry: 'y-full',
      buildMesh: (mats) => {
        const g = new THREE.Group();
        const crystal = mats.createMaterial('crystal', 0x38bdf8);
        const brass = mats.createMaterial('brass', 0xfbbf24);

        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.036, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), crystal);
        dome.castShadow = true;
        g.add(dome);

        const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.005, 10, 28), brass);
        bezel.rotation.x = Math.PI / 2;
        g.add(bezel);

        const finial = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.026, 8), brass);
        finial.position.y = 0.044;
        g.add(finial);
        return g;
      },
    },
  ];
}

// --- PUZZLE 3: ORBITAL SANCTUM (6-Part Gimbal Ring & Faceted Crystal Geode) ---
function buildOrbitalSanctumPieces(): PuzzlePieceSpec[] {
  return [
    {
      id: 'orb_cradle',
      name: 'Sanctum Anchor Cradle',
      finish: 'walnut',
      color: 0x78350f,
      accentColor: 0xfbbf24,
      targetLocalPos: [0, 0.042, 0],
      targetLocalEuler: [0, 0, 0],
      scatterLocalPos: [-0.29, 0.05, 0.16],
      scatterLocalEuler: [0, Math.PI / 3, 0],
      symmetry: 'y-4',
      buildMesh: (mats) => {
        const g = new THREE.Group();
        const wood = mats.createMaterial('walnut', 0x92400e);
        const brass = mats.createMaterial('brass', 0xfbbf24);
        const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.098, 0.022, 16), wood);
        dish.castShadow = true;
        g.add(dish);
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.045, 10), brass);
          post.position.set(Math.cos(a) * 0.078, 0.025, Math.sin(a) * 0.078);
          g.add(post);
        }
        return g;
      },
    },
    {
      id: 'orb_outer_gimbal',
      name: 'Outer Meridian Gimbal',
      finish: 'brass',
      color: 0xeab308,
      accentColor: 0xfef08a,
      targetLocalPos: [0, 0.135, 0],
      targetLocalEuler: [0, 0, 0],
      scatterLocalPos: [0.3, 0.07, 0.14],
      scatterLocalEuler: [Math.PI / 2, 0, 0],
      symmetry: 'y-4',
      buildMesh: (mats) => {
        const g = new THREE.Group();
        const brass = mats.createMaterial('brass', 0xeab308);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.009, 12, 42), brass);
        ring.castShadow = true;
        g.add(ring);
        [-0.095, 0.095].forEach((x) => {
          const node = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 12), brass);
          node.position.x = x;
          g.add(node);
        });
        return g;
      },
    },
    {
      id: 'orb_inner_gimbal',
      name: 'Inner Zenith Gimbal',
      finish: 'anodized',
      color: 0x6366f1,
      accentColor: 0xa5b4fc,
      targetLocalPos: [0, 0.135, 0],
      targetLocalEuler: [0, Math.PI / 2, 0],
      scatterLocalPos: [-0.28, 0.075, -0.15],
      scatterLocalEuler: [Math.PI / 2, Math.PI / 4, 0],
      symmetry: 'y-4',
      buildMesh: (mats) => {
        const g = new THREE.Group();
        const indigo = mats.createMaterial('anodized', 0x6366f1);
        const silver = mats.createMaterial('ceramic', 0xe2e8f0);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.074, 0.0085, 12, 36), indigo);
        ring.castShadow = true;
        g.add(ring);
        [-0.074, 0.074].forEach((y) => {
          const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.018, 10), silver);
          pivot.position.y = y;
          g.add(pivot);
        });
        return g;
      },
    },
    {
      id: 'orb_equator_band',
      name: 'Equatorial Horizon Ring',
      finish: 'ceramic',
      color: 0x14b8a6,
      accentColor: 0x5eead4,
      targetLocalPos: [0, 0.135, 0],
      targetLocalEuler: [Math.PI / 2, 0, 0],
      scatterLocalPos: [0.28, 0.055, -0.15],
      scatterLocalEuler: [0, 0, Math.PI / 4],
      symmetry: 'y-full',
      buildMesh: (mats) => {
        const g = new THREE.Group();
        const teal = mats.createMaterial('ceramic', 0x14b8a6);
        const brass = mats.createMaterial('brass', 0xfbbf24);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.0075, 12, 36), teal);
        ring.castShadow = true;
        g.add(ring);
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          const pip = new THREE.Mesh(new THREE.OctahedronGeometry(0.011, 0), brass);
          pip.position.set(Math.cos(a) * 0.056, Math.sin(a) * 0.056, 0);
          g.add(pip);
        }
        return g;
      },
    },
    {
      id: 'orb_south_spire',
      name: 'Lower Harmonic Prism',
      finish: 'crystal',
      color: 0xc084fc,
      accentColor: 0xe879f9,
      targetLocalPos: [0, 0.112, 0],
      targetLocalEuler: [0, 0, 0],
      scatterLocalPos: [-0.14, 0.065, 0.28],
      scatterLocalEuler: [Math.PI / 2, 0, 0],
      symmetry: 'y-full',
      buildMesh: (mats) => {
        const g = new THREE.Group();
        const crystal = mats.createMaterial('crystal', 0xc084fc);
        const brass = mats.createMaterial('brass', 0xfbbf24);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.048, 6), crystal);
        cone.rotation.x = Math.PI;
        cone.castShadow = true;
        g.add(cone);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.008, 12), brass);
        collar.position.y = 0.022;
        g.add(collar);
        return g;
      },
    },
    {
      id: 'orb_north_spire',
      name: 'Apex Harmonic Prism',
      finish: 'crystal',
      color: 0x38bdf8,
      accentColor: 0x7dd3fc,
      targetLocalPos: [0, 0.16, 0],
      targetLocalEuler: [0, 0, 0],
      scatterLocalPos: [0.14, 0.065, 0.28],
      scatterLocalEuler: [Math.PI, 0, Math.PI / 3],
      symmetry: 'y-full',
      buildMesh: (mats) => {
        const g = new THREE.Group();
        const crystal = mats.createMaterial('crystal', 0x38bdf8);
        const brass = mats.createMaterial('brass', 0xfbbf24);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.048, 6), crystal);
        cone.castShadow = true;
        g.add(cone);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.008, 12), brass);
        collar.position.y = -0.022;
        g.add(collar);
        return g;
      },
    },
  ];
}

export function getPuzzleBlueprint(id: PuzzleId): PuzzleBlueprint {
  if (id === 'aether-clockwork') {
    return {
      id,
      title: 'Aether Clockwork',
      pedestalRadius: 0.26,
      buildBase: (mats) => buildWorkbenchBase(mats, 0xfbbf24, 0.26),
      pieces: buildAetherClockworkPieces(),
    };
  }

  if (id === 'orbital-sanctum') {
    return {
      id,
      title: 'Orbital Sanctum',
      pedestalRadius: 0.27,
      buildBase: (mats) => buildWorkbenchBase(mats, 0xc084fc, 0.27),
      pieces: buildOrbitalSanctumPieces(),
    };
  }

  // Default: Chrono Cube
  const pieces: PuzzlePieceSpec[] = P1_CELLS.map((def) => {
    const [cx, cy, cz] = cellCentroid(def.cells, CHRONO_UNIT);
    return {
      id: def.id,
      name: def.name,
      finish: def.finish,
      color: def.color,
      accentColor: def.accent,
      targetLocalPos: [cx, 0.056 + cy, cz],
      targetLocalEuler: [0, 0, 0],
      scatterLocalPos: def.scatter,
      scatterLocalEuler: def.scatterRot,
      symmetry: def.id === 'chrono_crown_core' ? 'y-4' : 'none',
      buildMesh: (mats) => buildPolycubeModule(def.cells, CHRONO_UNIT, def.finish, def.color, def.accent, mats),
    };
  });

  return {
    id: 'chrono-cube',
    title: 'Chrono Cube',
    pedestalRadius: 0.26,
    buildBase: (mats) => buildWorkbenchBase(mats, 0x38bdf8, 0.26),
    pieces,
  };
}
