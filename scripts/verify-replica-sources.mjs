import fs from 'node:fs'

const candidates = [
  {
    path: 'assets-src/trucks/crown_sp3500.py',
    exportName: 'crown_sp3500',
    nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_platform',
      'rig_steerPivot', 'rig_travelPivot', 'rig_liftPivot',
      'rig_cameraMount', 'rig_xrOrigin'],
  },
  {
    path: 'assets-src/trucks/raymond_7500_video_replica.py',
    exportName: 'raymond_7500_video_replica',
    nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_reachGroup',
      'rig_steerPivot', 'rig_travelPivot', 'rig_liftPivot',
      'rig_reachPivot', 'rig_tiltPivot', 'rig_sideshiftPivot',
      'rig_cameraMount', 'rig_xrOrigin'],
  },
]

const runtimeMap = fs.readFileSync('src/sim/vehicleFactory.js', 'utf8')
let failed = false

for (const candidate of candidates) {
  const source = fs.readFileSync(candidate.path, 'utf8')
  const dependencies = new Set()
  const baseImport = source.match(/from trucks import ([a-z0-9_]+) as base/)
  if (baseImport) {
    const basePath = `assets-src/trucks/${baseImport[1]}.py`
    dependencies.add(fs.readFileSync(basePath, 'utf8'))
  }
  const corpus = [source, ...dependencies].join('\n')
  const missing = candidate.nodes.filter((name) => !corpus.includes(name))
  if (!source.includes(`truck['name'] = '${candidate.exportName}'`)) {
    console.error(`FAIL ${candidate.path}: export name is not isolated`)
    failed = true
  }
  if (missing.length) {
    console.error(`FAIL ${candidate.path}: missing rig declarations ${missing.join(', ')}`)
    failed = true
  }
  if (runtimeMap.includes(`'${candidate.exportName}'`)) {
    console.error(`FAIL ${candidate.path}: candidate is prematurely mapped into production`)
    failed = true
  }
  if (!missing.length) console.log(`PASS ${candidate.exportName}: source rig contract present and production mapping untouched`)
}

if (failed) process.exit(1)

