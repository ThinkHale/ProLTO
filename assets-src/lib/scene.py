"""Scene lifecycle for headless truck builds.

Coordinate convention (Blender, before glTF Y-up conversion):
  +Y = forks-forward, -Y = operator side, +Z = up, +X = truck right.
The glTF exporter maps this to three.js as: forks -Z, up +Y — matching the
Simulator, which drives the truck with forks pointing toward -Z.
All dimensions are meters (1 Blender unit = 1 three.js unit).
"""
import bpy


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.unit_settings.system = 'METRIC'
    scn.unit_settings.scale_length = 1.0
    view_layer = bpy.context.view_layer
    if view_layer is None:
        view_layer = scn.view_layers[0]
    return scn


def enable_gpu():
    """Prefer OptiX on the RTX GPU, fall back to CUDA, then CPU."""
    prefs = bpy.context.preferences.addons.get('cycles')
    if prefs is None:
        return 'CPU'
    cprefs = prefs.preferences
    for device_type in ('OPTIX', 'CUDA', 'NONE'):
        try:
            cprefs.compute_device_type = device_type
        except TypeError:
            continue
        try:
            cprefs.get_devices()
        except Exception:
            pass
        enabled = False
        for device in cprefs.devices:
            use = device.type != 'CPU' and device_type != 'NONE'
            device.use = use or device.type == 'CPU'
            enabled = enabled or use
        if enabled:
            return device_type
    return 'CPU'
