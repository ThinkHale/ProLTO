import * as THREE from 'three'

function mat(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: .12, ...options })
}

function box(parent, size, position, color, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat(color, options))
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function concreteMaterial() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  const image = context.createImageData(256, 256)
  for (let index = 0; index < image.data.length; index += 4) {
    const variation = Math.floor(Math.random() * 24)
    image.data[index] = 113 + variation
    image.data[index + 1] = 118 + variation
    image.data[index + 2] = 119 + variation
    image.data[index + 3] = 255
  }
  context.putImageData(image, 0, 0)
  context.strokeStyle = 'rgba(45,50,51,.22)'
  context.lineWidth = 2
  context.strokeRect(0, 0, 256, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(12, 20)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshStandardMaterial({ color: 0x9da2a2, map: texture, bumpMap: texture, bumpScale: .012, roughness: .92, metalness: .02 })
  return material
}

function palletLoad(parent, position, loadColor) {
  const pallet = new THREE.Group()
  ;[-.48, 0, .48].forEach((z) => box(pallet, [1.38, .085, .16], [0, .08, z], 0x7d4d2a, { roughness: .9, metalness: 0 }))
  ;[-.48, 0, .48].forEach((x) => box(pallet, [.15, .085, 1.12], [x, .15, 0], 0x9b6537, { roughness: .88, metalness: 0 }))
  box(pallet, [1.32, .65, 1.03], [0, .55, 0], loadColor, { roughness: .76, metalness: .02 })
  const wrap = new THREE.Mesh(
    new THREE.BoxGeometry(1.345, .67, 1.05),
    new THREE.MeshPhysicalMaterial({ color: 0xcbd4d4, transparent: true, opacity: .14, roughness: .18, transmission: .08, depthWrite: false }),
  )
  wrap.position.y = .56
  pallet.add(wrap)
  pallet.position.set(...position)
  parent.add(pallet)
  return pallet
}

function rack(scene, x, z) {
  const group = new THREE.Group()
  ;[-1.8, 1.8].forEach((dx) => [-.65, .65].forEach((dz) => box(group, [.11, 4.8, .11], [dx, 2.4, dz], 0x31566a)))
  ;[.25, 1.65, 3.05, 4.45].forEach((y) => {
    box(group, [3.8, .1, 1.55], [0, y, 0], 0xd0882f)
    if (y > .3) {
      palletLoad(group, [-.82, y + .06, 0], 0x93623e)
      palletLoad(group, [.82, y + .06, 0], 0xa27249)
    }
  })
  ;[-1.8, 1.8].forEach((dx) => {
    const braceA = box(group, [.045, 1.78, .045], [dx, 1.1, -.69], 0x294c5c, { roughness: .45, metalness: .7 })
    braceA.rotation.z = dx < 0 ? -.62 : .62
    const braceB = box(group, [.045, 1.78, .045], [dx, 3.16, -.69], 0x294c5c, { roughness: .45, metalness: .7 })
    braceB.rotation.z = dx < 0 ? .62 : -.62
  })
  group.position.set(x, 0, z)
  scene.add(group)
}

function pedestrian(scene, x, z, color) {
  const group = new THREE.Group()
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.24, .55, 5, 10), mat(color))
  torso.position.y = 1.08
  group.add(torso)
  const head = new THREE.Mesh(new THREE.SphereGeometry(.17, 14, 10), mat(0xa76d52))
  head.position.y = 1.65
  group.add(head)
  group.position.set(x, 0, z)
  scene.add(group)
  return group
}

export function createWarehouse(scene) {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(24, .15, 40), concreteMaterial())
  floor.position.set(0, -.08, -1)
  floor.receiveShadow = true
  scene.add(floor)
  const grid = new THREE.GridHelper(40, 40, 0xe2a32b, 0x586064)
  grid.position.y = .005
  grid.material.opacity = .18
  grid.material.transparent = true
  scene.add(grid)
  ;[-9, 9].forEach((x) => box(scene, [.12, 7, 40], [x, 3.5, -1], 0x26343a))
  box(scene, [18, .12, 40], [0, 6.85, -1], 0x899194, { roughness: .82, metalness: .18 })
  for (let z = -15; z <= 14; z += 5.8) {
    box(scene, [5.4, .045, .38], [0, 6.72, z], 0xf1f4ed, { emissive: 0xffffff, emissiveIntensity: 1.6, roughness: .28, metalness: .04 })
    const light = new THREE.SpotLight(0xfff8e8, 95, 14, .78, .75, 1.1)
    light.position.set(0, 6.6, z)
    light.target.position.set(0, 0, z)
    scene.add(light, light.target)
  }
  ;[-6.7, 6.7].forEach((x) => [-12, -6, 0, 6].forEach((z) => rack(scene, x, z)))
  box(scene, [.09, .02, 33], [-3.4, .02, -1], 0xf0b32b, { emissive: 0x6a4200 })
  box(scene, [.09, .02, 33], [3.4, .02, -1], 0xf0b32b, { emissive: 0x6a4200 })
  ;[-14, 10].forEach((z) => box(scene, [6.7, .025, .1], [0, .025, z], 0xf0b32b, { emissive: 0x6a4200 }))
  const pallet = palletLoad(scene, [0, 0, -11.5], 0xa96f43)
  const pedestrians = [pedestrian(scene, 2.7, -7.6, 0xdac54c), pedestrian(scene, -2.9, 8.2, 0xe18a3b)]
  ;[[-2.1, 3.2], [0, 3.2], [2.1, 3.2]].forEach(([x, z]) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(.25, .75, 18), mat(0xe97520))
    cone.position.set(x, .38, z)
    scene.add(cone)
  })
  return { pallet, pedestrians }
}
