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

function rack(scene, x, z) {
  const group = new THREE.Group()
  ;[-1.8, 1.8].forEach((dx) => [-.65, .65].forEach((dz) => box(group, [.11, 4.8, .11], [dx, 2.4, dz], 0x31566a)))
  ;[.25, 1.65, 3.05, 4.45].forEach((y) => {
    box(group, [3.8, .1, 1.55], [0, y, 0], 0xd0882f)
    if (y > .3) {
      box(group, [1.45, .7, 1.08], [-.82, y + .42, 0], 0x90603d)
      box(group, [1.45, .7, 1.08], [.82, y + .42, 0], 0x9c704b)
    }
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
  box(scene, [24, .15, 40], [0, -.08, -1], 0x6c7476)
  const grid = new THREE.GridHelper(40, 40, 0xe2a32b, 0x586064)
  grid.position.y = .005
  grid.material.opacity = .18
  grid.material.transparent = true
  scene.add(grid)
  ;[-9, 9].forEach((x) => box(scene, [.12, 7, 40], [x, 3.5, -1], 0x26343a))
  ;[-6.7, 6.7].forEach((x) => [-12, -6, 0, 6].forEach((z) => rack(scene, x, z)))
  box(scene, [.09, .02, 33], [-3.4, .02, -1], 0xf0b32b, { emissive: 0x6a4200 })
  box(scene, [.09, .02, 33], [3.4, .02, -1], 0xf0b32b, { emissive: 0x6a4200 })
  ;[-14, 10].forEach((z) => box(scene, [6.7, .025, .1], [0, .025, z], 0xf0b32b, { emissive: 0x6a4200 }))
  const pallet = new THREE.Group()
  ;[-.45, 0, .45].forEach((z) => box(pallet, [1.25, .1, .23], [0, .13, z], 0x8e5b32))
  box(pallet, [1.2, .86, .98], [0, .68, 0], 0xaa7448)
  pallet.position.set(0, 0, -11.5)
  scene.add(pallet)
  const pedestrians = [pedestrian(scene, 2.7, -7.6, 0xdac54c), pedestrian(scene, -2.9, 8.2, 0xe18a3b)]
  ;[[-2.1, 3.2], [0, 3.2], [2.1, 3.2]].forEach(([x, z]) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(.25, .75, 18), mat(0xe97520))
    cone.position.set(x, .38, z)
    scene.add(cone)
  })
  return { pallet, pedestrians }
}

