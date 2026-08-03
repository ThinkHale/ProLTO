"""Rig node contract shared with src/sim/vehicleFactory.js.

The Simulator animates these named nodes (all must be UNROTATED empties so its
absolute euler writes behave; rest tilts belong on child meshes, except pivots
whose documented rest rotation the Simulator preserves on other axes):

  rig_root          truck origin at floor, forks toward +Y (Blender)
  rig_mast          mast pivot (counterbalance tilts this node)
  rig_carriage      child of rig_mast; +Z lift, +X sideshift (three.js +Y/+X)
  rig_reachGroup    reach trucks: child of rig_carriage; pantograph + forks
  rig_platform      order pickers: child of rig_carriage
  rig_steerPivot    steer control pivot (tiller / palm wheel)
  rig_travelPivot   travel control pivot
  rig_liftPivot, rig_reachPivot, rig_tiltPivot   thumb-control pivots
  rig_tillerPivot   pallet trucks: tiller arm pivot at its base
  rig_headGroup     pallet trucks: tiller head (child of rig_tillerPivot)
  rig_wheelPivot    counterbalance steering wheel; local Z = column axis
  rig_driveWheel    drive tire mesh (spins around local X)
  rig_loadWheel_0..n, rig_frontWheel_0..n, rig_rearWheel_0..n
  rig_lever_0..2    counterbalance hydraulic lever pivots
  rig_gate_0..1     order picker side gates
  rig_cameraMount   operator eye point empty

Interactive controls are MESH objects tagged with custom properties
(ctrl_action/ctrl_label/ctrl_axis/ctrl_spring) which export as glTF extras and
surface in three.js as object.userData.
"""
import bpy

CONTROL_ACTIONS = {'travel', 'steer', 'lift', 'reach', 'tilt', 'sideshift',
                   'brake', 'horn', 'presence', 'belly'}


def empty(name, location=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_size = 0.1
    obj.location = location
    if parent is not None:
        obj.parent = parent
    bpy.context.scene.collection.objects.link(obj)
    return obj


def tag_control(obj, action, label, axis='vertical', spring=True):
    assert action in CONTROL_ACTIONS, f'unknown control action {action}'
    obj['ctrl_action'] = action
    obj['ctrl_label'] = label
    obj['ctrl_axis'] = axis
    obj['ctrl_spring'] = 1 if spring else 0
    return obj


def export_glb(filepath):
    bpy.ops.object.select_all(action='SELECT')
    for obj in bpy.context.scene.objects:
        if obj.name.startswith('qa_'):
            obj.select_set(False)
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        export_extras=True,
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        use_selection=True,
        export_image_format='AUTO',
    )
    print(f'EXPORTED {filepath}')
