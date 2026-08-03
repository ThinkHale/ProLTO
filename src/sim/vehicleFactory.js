import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createVehicleRig as createProceduralRig } from './proceduralFactory.js'

// Blender-authored fleet assets (assets-src/trucks/*.py -> public/models/*.glb).
// Node names + ctrl_* extras are the contract; see assets-src/lib/rig.py.
const ASSETS = {
  'Crown:reach': 'crown_rr5725',
  'Raymond:reach': 'raymond_7500',
  'Crown:order-picker': 'crown_sp1500',
  'Raymond:order-picker': 'raymond_5300',
  'Crown:pallet': 'crown_pe4500',
  'Raymond:pallet': 'raymond_8210',
  'Crown:counterbalance': 'crown_sc6200',
  'Raymond:counterbalance': 'raymond_4460',
}

const loader = new GLTFLoader()

function telemetryTexture(manufacturer) {
  const crown = manufacturer === 'Crown'
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 320
  const context = canvas.getContext('2d')
  context.fillStyle = '#0b1416'
  context.fillRect(0, 0, 512, 320)
  context.fillStyle = crown ? '#9cc8c3' : '#a9c4a6'
  context.fillRect(14, 14, 484, 292)
  context.fillStyle = '#10292b'
  context.font = '700 36px Arial'
  context.fillText(crown ? 'CROWN' : 'RAYMOND', 26, 56)
  context.font = '700 74px Arial'
  context.fillText('0.0', 32, 152)
  context.font = '600 25px Arial'
  context.fillText('MPH', 208, 148)
  context.strokeStyle = '#10292b'
  context.lineWidth = 8
  context.strokeRect(362, 36, 104, 50)
  context.fillRect(466, 50, 12, 22)
  context.fillRect(373, 47, 76, 28)
  context.font = '600 24px Arial'
  context.fillText('PARK', 34, 236)
  context.fillText('FORKS 0 in', 200, 236)
  context.fillStyle = '#173a3b'
  context.fillRect(26, 262, 460, 4)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function attachControlMetadata(object) {
  const extras = object.userData
  if (!extras || !extras.ctrl_action) return
  object.userData.control = {
    action: extras.ctrl_action,
    label: extras.ctrl_label || extras.ctrl_action,
    axis: extras.ctrl_axis || 'vertical',
    spring: !!extras.ctrl_spring,
    motion: extras.ctrl_motion || extras.ctrl_axis || 'vertical',
    scale: Number.isFinite(extras.ctrl_scale) ? extras.ctrl_scale : 1,
  }
  if (object.material) {
    object.material = object.material.clone()
    object.userData.baseEmissive = object.material.emissive?.getHex?.() || 0
  }
}

function collectIndexed(index, prefix) {
  const found = []
  for (let i = 0; i < 8; i += 1) {
    const node = index.get(`${prefix}${i}`)
    if (node) found.push(node)
  }
  return found
}

function recordRests(rig) {
  if (rig.carriage) rig.carriage.userData.rest = rig.carriage.position.clone()
  if (rig.reachGroup) rig.reachGroup.userData.rest = rig.reachGroup.position.clone()
  if (rig.levers) rig.levers.forEach((lever) => { lever.userData.restRX = lever.rotation.x })
  return rig
}

// Bolts, ribs, and label plates cost a shadow-map draw each and contribute
// nothing legible. Only parts big enough to read as a shadow cast one.
const SHADOW_CASTER_SIZE = .12
const shadowSize = new THREE.Vector3()

function castsUsefulShadow(mesh) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  mesh.geometry.boundingBox.getSize(shadowSize)
  return Math.max(shadowSize.x, shadowSize.y, shadowSize.z) >= SHADOW_CASTER_SIZE
}

function mapRig(gltfScene, profile) {
  const index = new Map()
  gltfScene.traverse((object) => {
    index.set(object.name, object)
    attachControlMetadata(object)
    if (object.isMesh) {
      object.castShadow = castsUsefulShadow(object)
      object.receiveShadow = true
      // Any mesh a truck module names as a display face gets the live cluster
      // texture, unlit so it reads as an emissive panel at any exposure.
      if (/screen/i.test(object.name)) {
        object.material = new THREE.MeshBasicMaterial({ map: telemetryTexture(profile.manufacturer), toneMapped: false })
      }
    }
  })
  const get = (name) => index.get(name) || null
  const mast = get('rig_mast')
  const carriage = get('rig_carriage')
  const walkie = profile.family === 'pallet' && profile.stance.includes('Walk')
  const rig = {
    root: gltfScene,
    body: gltfScene,
    mast,
    carriage,
    reachGroup: get('rig_reachGroup'),
    platform: get('rig_platform'),
    cameraMount: get('rig_cameraMount') || gltfScene,
    xrOrigin: get('rig_xrOrigin'),
    controls: gltfScene,
    steerPivot: get('rig_steerPivot'),
    travelPivot: get('rig_travelPivot'),
    liftPivot: get('rig_liftPivot'),
    reachPivot: get('rig_reachPivot'),
    tiltPivot: get('rig_tiltPivot'),
    tillerPivot: get('rig_tillerPivot'),
    headGroup: get('rig_headGroup'),
    wheelPivot: get('rig_wheelPivot'),
    driveWheel: get('rig_driveWheel'),
    loadWheels: collectIndexed(index, 'rig_loadWheel_'),
    frontWheels: collectIndexed(index, 'rig_frontWheel_'),
    rearWheels: collectIndexed(index, 'rig_rearWheel_'),
    levers: collectIndexed(index, 'rig_lever_'),
    gates: collectIndexed(index, 'rig_gate_'),
    family: profile.family,
    walkie,
    specification: `${profile.manufacturer} ${profile.model}`,
    // reach trucks tilt at the fork carriage; counterbalance tilts the mast
    tiltGroup: profile.family === 'reach' ? carriage : profile.family === 'counterbalance' ? mast : null,
  }
  if (!rig.loadWheels.length) rig.loadWheels = null
  if (!rig.levers.length) rig.levers = null
  return recordRests(rig)
}

export async function createVehicleRig(profile) {
  const asset = ASSETS[`${profile.manufacturer}:${profile.family}`]
  const url = `${import.meta.env.BASE_URL}models/${asset}.glb`
  try {
    const gltf = await loader.loadAsync(url)
    return mapRig(gltf.scene, profile)
  } catch (error) {
    console.warn(`ProLTO: falling back to procedural rig for ${asset}:`, error)
    return recordRests(createProceduralRig(profile))
  }
}

export function controlMeshes(rig) {
  const result = []
  rig.root.traverse((object) => { if (object.userData.control) result.push(object) })
  return result
}
