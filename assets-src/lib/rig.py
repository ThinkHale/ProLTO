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
  rig_xrOrigin      tracked-floor origin at the operator's physical floor

Interactive controls are MESH objects tagged with custom properties
(ctrl_action/ctrl_label/ctrl_axis/ctrl_spring/ctrl_motion/ctrl_scale) which export
as glTF extras and surface in three.js as object.userData. ctrl_scale is normally
1, or -1 for the negative half of a split control such as Lower or Reverse.
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


def tag_control(obj, action, label, axis='vertical', spring=True, motion=None, scale=1.0,
                action2=None, motion2=None, shift2=None, detents=None, inverted=False):
    """Tag a mesh as an interactive control.

    A real multi-axis control such as the Crown Multi-Task handle or its thumb
    ball is ONE physical part the operator moves on TWO orthogonal axes. Rather
    than fake that with two adjacent meshes, a control may declare a secondary
    action bound to a second drag axis:

      action  / motion    primary axis  (e.g. travel on fore-aft)
      action2 / motion2   secondary axis (e.g. lift on vertical)
      shift2              what action2 becomes while a modifier is held
                          (Crown: thumb ball reach -> sideshift)
      detents             number of felt detents per half travel; 0 = smooth
    """
    assert action in CONTROL_ACTIONS, f'unknown control action {action}'
    obj['ctrl_action'] = action
    obj['ctrl_label'] = label
    obj['ctrl_axis'] = axis
    obj['ctrl_spring'] = 1 if spring else 0
    if motion:
        obj['ctrl_motion'] = motion
    obj['ctrl_scale'] = float(scale)
    if action2:
        assert action2 in CONTROL_ACTIONS, f'unknown secondary action {action2}'
        assert motion2, 'a secondary action needs its own motion axis'
        assert motion2 != (motion or axis), 'secondary axis must be orthogonal'
        obj['ctrl_action2'] = action2
        obj['ctrl_motion2'] = motion2
    if shift2:
        assert action2, 'shift2 re-maps action2, so action2 must exist'
        assert shift2 in CONTROL_ACTIONS, f'unknown shifted action {shift2}'
        obj['ctrl_shift2'] = shift2
    if detents is not None:
        obj['ctrl_detents'] = int(detents)
    if inverted:
        # Reverse-acting pedal. Crown RR 5700 foot brake (manual page 22):
        # pressed all the way down the brake is OFF; lifting the heel or coming
        # off the pedal APPLIES it. Treating this like a normal brake pedal
        # inverts the single most safety-relevant habit on the truck.
        obj['ctrl_inverted'] = 1
    return obj


def tag_modifier(obj, label):
    """Tag a mesh as a held modifier switch.

    The Crown Multi-Task handle carries a switch on its back face. Holding it
    re-maps the thumb ball's reach axis to sideshift, and gates Rack Height
    Select and Tilt Position Assist. It commands no hydraulic function itself.
    """
    obj['ctrl_modifier'] = 1
    obj['ctrl_label'] = label
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
