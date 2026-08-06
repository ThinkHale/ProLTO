# Facility shell converter. Run inside Blender:
#   blender -b -P assets-src/facility.py
#
# Turns the third-party warehouse interior (FBX, ~4.1M triangles, 94 MB of
# 2K/4K spec-gloss textures) into a single Quest-affordable glTF shell at
# public/models/facility.glb.
#
# WHAT THIS DOES NOT TOUCH
# Racking, pallets, rack slots and every collider stay procedural in
# src/sim/warehouse.js. The source model contains no racking, shelving or
# pallets at all -- it is purely a building envelope -- so the two compose
# cleanly and none of the training-critical collision geometry is at risk.
#
# WHY THE DECIMATION RATIOS LOOK BRUTAL
# 86% of the source is decorative: hanging lamps and their covers alone are 42%
# (~46,000 triangles per fixture, 14 m overhead), and the wall cladding spends
# another 30% modelling corrugations that a normal map represents for free. The
# structure an operator actually judges is tiny by comparison -- the walls are
# 1,090 quads, the columns 6,666. So the decorative families are crushed and the
# structural ones are left alone.
import os
import sys

import bpy

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
SOURCE = os.path.join(REPO, 'Warehouse Model', 'Warehouse_Interior_Fbx', 'Warehouse.FBX')
TARGET = os.path.join(REPO, 'public', 'models', 'facility.glb')

# The OBJ is authored in centimetres, but Blender's FBX importer applies the
# file's own unit scale, so the imported result may already be metres. Measure
# rather than assume: a warehouse is tens of metres, never hundreds.
METRES_MAX_EXTENT = 200
MAX_TEXTURE = 1024

# name prefix -> decimate ratio. First match wins, so order matters.
RATIOS = [
    # Second pass, tightened after measuring frame time: the shell cost p95
    # 22.6 ms on desktop, which leaves nothing for a 72-90 Hz headset. These are
    # all ceiling furniture 10-14 m overhead where silhouette is all that reads.
    ('hanging_lamp', 0.012),
    ('lamp_cover', 0.012),
    ('hanging_light_glass', 0.012),
    ('corrugated_sheet', 0.02),
    ('circular_duct', 0.035),
    ('rectangular_duct', 0.035),
    ('roof_duct', 0.035),
    ('ac_roof', 0.035),
    ('ac_', 0.035),
    ('truss', 0.12),
    ('exterior_cladding', 0.30),
    ('single_door_metal', 0.25),
    ('wire', 0.12),
    ('pipe', 0.12),
    ('stair', 0.15),
    ('hands', 0.10),
    ('lock', 0.10),
    ('hinge', 0.10),
    ('sign', 0.12),
    ('fire_exit', 0.12),
    ('shutter', 0.30),
    ('portable_building', 0.30),
]
STRUCTURAL = ('warehouse_walls', 'colomn', 'column', 'floor', 'exterior_cladding',
              'win_frames', 'win_glass', 'door', 'roof')


def ratio_for(name):
    key = name.lower()
    for prefix, ratio in RATIOS:
        if key.startswith(prefix) or prefix in key:
            return ratio
    for prefix in STRUCTURAL:
        if prefix in key:
            return 1.0
    return 0.6


def triangles():
    total = 0
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        total += sum(len(p.vertices) - 2 for p in obj.data.polygons)
    return total


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def world_extent():
    lo = [1e18] * 3
    hi = [-1e18] * 3
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ __import__('mathutils').Vector(corner)
            for axis in range(3):
                lo[axis] = min(lo[axis], world[axis])
                hi[axis] = max(hi[axis], world[axis])
    return tuple(round(hi[axis] - lo[axis], 1) for axis in range(3))


def merge_by_material():
    """One object per material. Static shell, so nothing needs to move alone."""
    groups = {}
    for obj in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        if len(obj.data.materials) != 1 or obj.data.materials[0] is None:
            continue
        groups.setdefault(obj.data.materials[0].name, []).append(obj)
    merges = 0
    for name, objects in groups.items():
        if len(objects) < 2:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        objects[0].name = f'facility_{name}'
        merges += 1
    return merges


def strip_material_maps():
    """Keep base colour and normal only.

    The source is a specular-glossiness asset and three.js is
    metallic-roughness, so the gloss/spec maps cannot be used as authored.
    Rather than convert them, they are dropped and roughness becomes a constant
    that src/sim/surfacing.js then modulates with its own procedural detail --
    which is the same treatment the fleet gets.
    """
    kept = 0
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.node_tree is None:
            continue
        tree = mat.node_tree
        bsdf = next((n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is None:
            continue
        for link in list(tree.links):
            if link.from_node.type != 'TEX_IMAGE':
                continue
            target = link.to_socket.name
            through_normal = link.to_node.type == 'NORMAL_MAP'
            if target == 'Base Color' or through_normal:
                kept += 1
                continue
            tree.links.remove(link)
        for socket, value in (('Roughness', 0.78), ('Metallic', 0.0)):
            if bsdf.inputs.get(socket) is not None:
                bsdf.inputs[socket].default_value = value
    return kept


def shrink_textures():
    resized = 0
    for image in bpy.data.images:
        if image.size[0] > MAX_TEXTURE or image.size[1] > MAX_TEXTURE:
            image.scale(min(image.size[0], MAX_TEXTURE), min(image.size[1], MAX_TEXTURE))
            resized += 1
    return resized


def main():
    if not os.path.exists(SOURCE):
        print(f'FACILITY MISSING SOURCE {SOURCE}')
        sys.exit(1)
    reset()
    bpy.ops.import_scene.fbx(filepath=SOURCE, global_scale=1.0, use_image_search=True)

    # Drop anything that is not geometry; lighting is authored in the simulator.
    for obj in list(bpy.context.scene.objects):
        if obj.type in {'LIGHT', 'CAMERA', 'SPEAKER'}:
            bpy.data.objects.remove(obj, do_unlink=True)

    before = triangles()
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    print(f'FACILITY imported {len(meshes)} meshes, {before} triangles')

    for obj in meshes:
        ratio = ratio_for(obj.name)
        if ratio >= 1.0 or len(obj.data.polygons) < 200:
            continue
        modifier = obj.modifiers.new('facility_decimate', 'DECIMATE')
        modifier.decimate_type = 'COLLAPSE'
        modifier.ratio = ratio
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)

    after = triangles()
    kept = strip_material_maps()
    resized = shrink_textures()
    merged = merge_by_material()

    # 299 separate objects meant 299 draw calls for 22 materials. Joining them
    # per material is the single biggest headset win available here, and the
    # shell is entirely static so there is nothing to lose by merging it.
    extent = world_extent()
    scale = 0.01 if max(extent) > METRES_MAX_EXTENT else 1.0
    bpy.ops.object.select_all(action='SELECT')
    root = bpy.data.objects.new('facility_root', None)
    bpy.context.scene.collection.objects.link(root)
    for obj in list(bpy.context.scene.objects):
        if obj is not root and obj.parent is None:
            obj.parent = root
    root.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    print(f'FACILITY extent {extent} source units -> scale {scale}, {merged} merges')

    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=TARGET,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        use_selection=True,
        export_image_format='AUTO',
        export_jpeg_quality=82,
    )
    size = os.path.getsize(TARGET) / 1048576
    print(f'FACILITY decimated {before} -> {after} triangles '
          f'({after * 100 // max(before, 1)}%), {kept} maps kept, {resized} textures resized')
    print(f'FACILITY EXPORTED {TARGET} ({size:.1f} MB)')


main()
