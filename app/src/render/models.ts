// Blocky unit models built from boxes.
import * as THREE from 'three';
import type { ClassId } from '../rules/balance';

export interface Model { group: THREE.Group; body: THREE.Group; mats: THREE.MeshLambertMaterial[] }

interface Colors { skin: string; legs: string; body: string; arms: string; eye?: string }

const ringGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 24);
const heroRing = new THREE.MeshBasicMaterial({ color: 0x4c9bff, transparent: true, opacity: 0.85 });
const gobRing = new THREE.MeshBasicMaterial({ color: 0xe2553f, transparent: true, opacity: 0.85 });

export function buildModel(cls: ClassId, team: 'hero' | 'gob', small = false): Model {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const mats: THREE.MeshLambertMaterial[] = [];
  const part = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, o: { glow?: boolean; rz?: number; rx?: number } = {}) => {
    const mat = new THREE.MeshLambertMaterial({ color });
    if (o.glow) { mat.emissive = new THREE.Color(color); mat.emissiveIntensity = 0.7; }
    mat.userData.e = mat.emissive.clone();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (o.rz) m.rotation.z = o.rz;
    if (o.rx) m.rotation.x = o.rx;
    m.castShadow = true;
    body.add(m);
    mats.push(mat);
    return m;
  };
  const humanoid = (c: Colors) => {
    part(0.17, 0.45, 0.2, c.legs, -0.11, 0.225, 0);
    part(0.17, 0.45, 0.2, c.legs, 0.11, 0.225, 0);
    part(0.46, 0.46, 0.28, c.body, 0, 0.68, 0);
    part(0.15, 0.44, 0.16, c.arms, -0.31, 0.69, 0);
    part(0.15, 0.44, 0.16, c.arms, 0.31, 0.69, 0);
    part(0.38, 0.38, 0.38, c.skin, 0, 1.1, 0);
    const eye = c.eye || '#1a1a1a';
    part(0.07, 0.07, 0.02, eye, -0.08, 1.13, 0.195);
    part(0.07, 0.07, 0.02, eye, 0.08, 1.13, 0.195);
  };
  const goblinHead = (skin: string) => {
    part(0.14, 0.08, 0.05, skin, -0.25, 1.15, 0);
    part(0.14, 0.08, 0.05, skin, 0.25, 1.15, 0);
    part(0.07, 0.09, 0.07, '#5f9334', 0, 1.05, 0.21);
  };
  switch (cls) {
    case 'knight':
      humanoid({ skin: '#f1c27d', legs: '#59606e', body: '#a7b0c0', arms: '#a7b0c0' });
      part(0.3, 0.36, 0.02, '#2f6fd1', 0, 0.66, 0.145);
      part(0.42, 0.2, 0.42, '#c3cad6', 0, 1.28, 0);
      part(0.42, 0.26, 0.06, '#c3cad6', 0, 1.12, -0.2);
      part(0.06, 0.16, 0.22, '#2f6fd1', 0, 1.45, -0.02);
      part(0.06, 0.62, 0.06, '#e6ebf2', 0.31, 0.98, 0.12);
      part(0.2, 0.05, 0.08, '#7a5230', 0.31, 0.66, 0.12);
      part(0.06, 0.44, 0.36, '#2f6fd1', -0.41, 0.68, 0.04);
      part(0.02, 0.13, 0.13, '#f2c14e', -0.445, 0.7, 0.04);
      break;
    case 'archer':
      humanoid({ skin: '#e0ac69', legs: '#4b3b29', body: '#3f7d3a', arms: '#3f7d3a' });
      part(0.42, 0.12, 0.42, '#2d5e2a', 0, 1.33, 0);
      part(0.42, 0.36, 0.08, '#2d5e2a', 0, 1.12, -0.2);
      part(0.47, 0.06, 0.29, '#6b4a2b', 0, 0.48, 0);
      part(0.12, 0.42, 0.12, '#7a5230', 0.12, 0.86, -0.2, { rz: 0.4 });
      part(0.05, 0.84, 0.05, '#8a5a2c', -0.38, 0.74, 0.14);
      break;
    case 'mage':
      humanoid({ skin: '#c68642', legs: '#4b2a85', body: '#6a3fb5', arms: '#6a3fb5' });
      part(0.5, 0.42, 0.32, '#5a33a0', 0, 0.3, 0);
      part(0.56, 0.06, 0.56, '#3e2270', 0, 1.32, 0);
      part(0.32, 0.24, 0.32, '#3e2270', 0, 1.47, 0);
      part(0.16, 0.22, 0.16, '#3e2270', 0.04, 1.66, -0.03, { rz: -0.25 });
      part(0.08, 0.08, 0.02, '#f2c14e', 0, 1.47, 0.165);
      part(0.06, 1.15, 0.06, '#7a5230', 0.33, 0.62, 0.12);
      part(0.16, 0.16, 0.16, '#ff8a3d', 0.33, 1.25, 0.12, { glow: true });
      break;
    case 'builder':
      humanoid({ skin: '#f1c27d', legs: '#34497a', body: '#e08a2c', arms: '#e9e2d2' });
      part(0.47, 0.06, 0.29, '#f2e34c', 0, 0.76, 0);
      part(0.42, 0.16, 0.42, '#f2c14e', 0, 1.36, 0);
      part(0.46, 0.04, 0.52, '#f2c14e', 0, 1.29, 0.03);
      part(0.05, 0.68, 0.05, '#7a5230', 0.31, 0.76, 0.14);
      part(0.42, 0.07, 0.07, '#8d8d8d', 0.31, 1.08, 0.14);
      break;
    case 'cleric':
      humanoid({ skin: '#8d5524', legs: '#e9e4d8', body: '#f4f0e6', arms: '#f4f0e6' });
      part(0.5, 0.42, 0.32, '#e9e4d8', 0, 0.3, 0);
      part(0.47, 0.06, 0.29, '#f2c14e', 0, 0.5, 0);
      part(0.06, 0.26, 0.02, '#f2c14e', 0, 0.7, 0.145);
      part(0.18, 0.06, 0.02, '#f2c14e', 0, 0.76, 0.146);
      part(0.42, 0.14, 0.42, '#f4f0e6', 0, 1.34, 0);
      part(0.42, 0.34, 0.06, '#f4f0e6', 0, 1.12, -0.2);
      part(0.05, 1.05, 0.05, '#c9a26b', 0.33, 0.62, 0.12);
      part(0.2, 0.05, 0.05, '#f2c14e', 0.33, 1.12, 0.12);
      part(0.14, 0.14, 0.14, '#fff3b0', 0.33, 1.24, 0.12, { glow: true });
      break;
    case 'grunt':
    case 'garcher': {
      const archer = cls === 'garcher';
      humanoid({ skin: '#76b041', legs: '#4a3a28', body: archer ? '#5a4a33' : '#7a5a3a', arms: '#76b041', eye: '#ffd23a' });
      goblinHead('#76b041');
      part(0.47, 0.07, 0.29, '#3a2c1c', 0, 0.48, 0);
      if (archer) {
        part(0.42, 0.1, 0.42, '#4a3a28', 0, 1.32, 0);
        part(0.05, 0.78, 0.05, '#5a3d22', -0.38, 0.72, 0.14);
      } else {
        part(0.12, 0.52, 0.12, '#5a3d22', 0.31, 0.88, 0.14);
        part(0.18, 0.16, 0.18, '#4a321b', 0.31, 1.16, 0.14);
      }
      body.scale.setScalar(small ? 0.66 : 0.86);
      break;
    }
    case 'shaman':
      humanoid({ skin: '#6aa63a', legs: '#3a2c4a', body: '#5a3a6a', arms: '#6aa63a', eye: '#d58cff' });
      goblinHead('#6aa63a');
      part(0.5, 0.36, 0.32, '#4a2c5a', 0, 0.28, 0);
      part(0.3, 0.1, 0.04, '#e9e2d2', 0, 1.0, 0.2);
      part(0.06, 0.3, 0.06, '#d14a5a', -0.1, 1.42, -0.05, { rz: 0.3 });
      part(0.06, 0.34, 0.06, '#f2c14e', 0, 1.45, -0.05);
      part(0.06, 0.3, 0.06, '#4c9bff', 0.1, 1.42, -0.05, { rz: -0.3 });
      part(0.05, 1.1, 0.05, '#5a3d22', 0.33, 0.62, 0.12);
      part(0.16, 0.14, 0.16, '#e9e2d2', 0.33, 1.2, 0.12);
      part(0.1, 0.1, 0.1, '#b48cff', 0.33, 1.35, 0.12, { glow: true });
      body.scale.setScalar(0.86);
      break;
    case 'turret':
      part(0.7, 0.5, 0.7, '#808080', 0, 0.25, 0);
      part(0.76, 0.08, 0.76, '#6b6b6b', 0, 0.52, 0);
      part(0.12, 0.3, 0.12, '#6b4a2b', 0, 0.71, 0);
      part(0.16, 0.12, 0.7, '#8a5a2c', 0, 0.9, 0.05);
      part(0.7, 0.06, 0.08, '#5a3d22', 0, 0.93, 0.3);
      part(0.04, 0.04, 0.5, '#e9e2d2', 0, 0.98, 0.15);
      part(0.08, 0.08, 0.08, '#4c9bff', 0, 1.0, -0.28, { glow: true });
      break;
    case 'tnt':
      part(0.72, 0.72, 0.72, '#d33a2c', 0, 0.36, 0);
      part(0.74, 0.2, 0.74, '#f4f0e6', 0, 0.4, 0);
      part(0.46, 0.1, 0.02, '#1a1a1a', 0, 0.4, 0.375);
      part(0.06, 0.2, 0.06, '#8a8a8a', 0, 0.82, 0);
      part(0.1, 0.1, 0.1, '#ffd23a', 0, 0.96, 0, { glow: true });
      break;
    case 'troll':
      part(0.26, 0.5, 0.3, '#5d6b4a', -0.17, 0.25, 0);
      part(0.26, 0.5, 0.3, '#5d6b4a', 0.17, 0.25, 0);
      part(0.7, 0.62, 0.46, '#7a8a5a', 0, 0.8, 0);
      part(0.72, 0.14, 0.48, '#4a3a28', 0, 0.56, 0);
      part(0.22, 0.66, 0.24, '#7a8a5a', -0.47, 0.76, 0.04);
      part(0.22, 0.66, 0.24, '#7a8a5a', 0.47, 0.76, 0.04);
      part(0.42, 0.36, 0.38, '#7a8a5a', 0, 1.28, 0.08);
      part(0.08, 0.08, 0.02, '#ff5a3a', -0.1, 1.32, 0.275);
      part(0.08, 0.08, 0.02, '#ff5a3a', 0.1, 1.32, 0.275);
      part(0.06, 0.1, 0.06, '#e9e2d2', -0.12, 1.14, 0.27);
      part(0.06, 0.1, 0.06, '#e9e2d2', 0.12, 1.14, 0.27);
      part(0.16, 0.8, 0.16, '#5a3d22', 0.5, 0.75, 0.3, { rx: 0.5 });
      part(0.28, 0.28, 0.28, '#4a321b', 0.5, 1.05, 0.52);
      body.scale.setScalar(1.15);
      break;
  }
  const ring = new THREE.Mesh(ringGeo, team === 'hero' ? heroRing : gobRing);
  ring.position.y = 0.03;
  group.add(ring);
  return { group, body, mats };
}
