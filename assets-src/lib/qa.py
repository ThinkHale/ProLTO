"""Headless QA rendering: HDRI-lit turntable + cab views on the GPU."""
import math
import os

import bpy
from mathutils import Vector

from . import scene as scene_lib

HDRI_DIR = os.environ.get(
    'PROLTO_HDRI_DIR',
    r'C:\Users\think\AppData\Local\Temp\claude\c--Users-think-OneDrive-Desktop-ProLTO'
    r'\8f8d9f97-f27e-43de-8d1c-3ca86a8d2231\scratchpad\hdri')
QA_HDRI = os.path.join(HDRI_DIR, 'studio_small_08_2k.hdr')


def _world(hdri, strength=1.0, rotation=0.0):
    world = bpy.data.worlds.new('qa_world')
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    if os.path.exists(hdri):
        env.image = bpy.data.images.load(hdri)
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Rotation'].default_value = (0, 0, rotation)
    coord = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], env.inputs['Vector'])
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    bpy.context.scene.world = world


def _floor():
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=64, radius=26)
    me = bpy.data.meshes.new('qa_floor')
    bm.to_mesh(me)
    bm.free()
    mat = bpy.data.materials.new('qa_floor')
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (0.028, 0.03, 0.032, 1)
    bsdf.inputs['Roughness'].default_value = 0.55
    me.materials.append(mat)
    obj = bpy.data.objects.new('qa_floor', me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _bounds():
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or obj.name.startswith('qa_'):
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, world))
            hi = Vector(map(max, hi, world))
    return lo, hi


def _camera(name, location, target, focal=40):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = focal
    cam = bpy.data.objects.new(name, cam_data)
    cam.location = location
    direction = Vector(target) - Vector(location)
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(cam)
    return cam


def render_views(truck, out_dir, views=('hero', 'side', 'rear34', 'cab'), samples=48,
                 resolution=(1024, 768)):
    os.makedirs(out_dir, exist_ok=True)
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    device = scene_lib.enable_gpu()
    scn.cycles.device = 'GPU' if device != 'CPU' else 'CPU'
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    scn.render.resolution_x, scn.render.resolution_y = resolution
    scn.render.image_settings.file_format = 'PNG'
    scn.view_settings.view_transform = 'AgX' if 'AgX' in [
        i.name for i in type(scn.view_settings).bl_rna.properties['view_transform'].enum_items
    ] else 'Filmic'
    scn.view_settings.look = 'AgX - Base Contrast' if scn.view_settings.view_transform == 'AgX' else 'None'

    _world(QA_HDRI, strength=1.05, rotation=math.radians(35))
    _floor()

    lo, hi = _bounds()
    center = (lo + hi) / 2
    size = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    center.z = (hi.z - lo.z) * 0.42

    def orbit(azimuth_deg, elevation_deg, dist_scale=1.9, focal=42):
        a = math.radians(azimuth_deg)
        e = math.radians(elevation_deg)
        d = size * dist_scale
        loc = center + Vector((math.sin(a) * math.cos(e) * d,
                               -math.cos(a) * math.cos(e) * d,
                               math.sin(e) * d))
        return loc, center, focal

    presets = {
        'hero': orbit(38, 13),
        'side': orbit(90, 6, 1.95, 48),
        'front': orbit(0, 10),
        'rear34': orbit(207, 15),
        'top': orbit(30, 55, 1.7),
    }
    cab = truck.get('cab_view') if isinstance(truck, dict) else None
    if cab:
        presets['cab'] = (Vector(cab['loc']), Vector(cab['target']), cab.get('focal', 21))
    for key, view in (truck.get('closeups', {}) if isinstance(truck, dict) else {}).items():
        presets[key] = (Vector(view['loc']), Vector(view['target']), view.get('focal', 30))

    for view_name in views:
        if view_name not in presets:
            print(f'skip unknown view {view_name}')
            continue
        loc, target, focal = presets[view_name]
        cam = _camera(f'qa_cam_{view_name}', loc, target, focal)
        scn.camera = cam
        scn.render.filepath = os.path.join(out_dir, f'{view_name}.png')
        bpy.ops.render.render(write_still=True)
        print(f'RENDERED {scn.render.filepath} ({device})')
