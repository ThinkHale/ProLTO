"""Parametric truck components.

Everything is bpy.data/bmesh based so it runs headless. Realism rules that make
industrial equipment read as real:
  - nothing ships without a bevel (add_bevel) and angle-aware smooth shading
  - structural parts are extruded profiles (C-channels, plates), never bare cubes
  - bodywork is lofted cross-sections (loft_shell) with subsurf, never a box
  - hardware density: bolts, hose runs, chains, tread plate, labels
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import materials as M


# ---------------------------------------------------------------- fundamentals
def link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def mesh_from_bm(name, bm, mat=None, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    if mat is not None:
        obj.data.materials.append(mat)
    return link(obj, parent)


def smooth_shade(obj, angle_deg=38):
    me = obj.data
    for poly in me.polygons:
        poly.use_smooth = True
    limit = math.radians(angle_deg)
    bm = bmesh.new()
    bm.from_mesh(me)
    for edge in bm.edges:
        if len(edge.link_faces) == 2:
            try:
                if edge.calc_face_angle() > limit:
                    edge.smooth = False
            except ValueError:
                pass
        else:
            edge.smooth = False
    bm.to_mesh(me)
    bm.free()
    return obj


def add_bevel(obj, width=0.006, segments=2, angle_deg=42):
    mod = obj.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle_deg)
    mod.miter_outer = 'MITER_ARC'
    return obj


def add_subsurf(obj, levels=2):
    mod = obj.modifiers.new('subsurf', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    return obj


def apply_all_modifiers(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return obj


def box(name, size, loc=(0, 0, 0), mat=None, parent=None, bevel=0.006, rot=(0, 0, 0), segments=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, verts=bm.verts, vec=Vector(size))
    obj = mesh_from_bm(name, bm, mat, parent)
    obj.location = loc
    obj.rotation_euler = rot
    if bevel:
        add_bevel(obj, min(bevel, min(size) / 2.2), segments)
    smooth_shade(obj)
    return obj


def rounded_box(name, size, loc=(0, 0, 0), mat=None, parent=None, radius=0.03, segments=4, rot=(0, 0, 0)):
    return box(name, size, loc, mat, parent, bevel=radius, rot=rot, segments=segments)


def cyl(name, radius, depth, loc=(0, 0, 0), mat=None, parent=None, axis='Z', verts=48,
        rot=(0, 0, 0), bevel=0.0, radius2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts,
                          radius1=radius, radius2=radius if radius2 is None else radius2, depth=depth)
    obj = mesh_from_bm(name, bm, mat, parent)
    obj.location = loc
    if axis == 'X':
        obj.rotation_euler = (0, math.pi / 2, 0)
    elif axis == 'Y':
        obj.rotation_euler = (math.pi / 2, 0, 0)
    if any(rot):
        obj.rotation_euler = rot
    if bevel:
        add_bevel(obj, bevel, 2)
    smooth_shade(obj)
    return obj


def extrude_profile(name, pts, thickness, mat=None, parent=None, plane='XZ', bevel=0.004,
                    loc=(0, 0, 0), rot=(0, 0, 0)):
    """Extrude a closed 2D polygon. plane='XZ' extrudes along Y (fore-aft parts),
    'XY' along Z (vertical parts), 'YZ' along X (side parts, e.g. fork blades)."""
    bm = bmesh.new()
    verts = []
    for a, b in pts:
        if plane == 'XZ':
            verts.append(bm.verts.new((a, 0, b)))
        elif plane == 'XY':
            verts.append(bm.verts.new((a, b, 0)))
        else:
            verts.append(bm.verts.new((0, a, b)))
    face = bm.faces.new(verts)
    axis = {'XZ': Vector((0, thickness, 0)), 'XY': Vector((0, 0, thickness)), 'YZ': Vector((thickness, 0, 0))}[plane]
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=axis)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = mesh_from_bm(name, bm, mat, parent)
    obj.location = loc
    obj.rotation_euler = rot
    if bevel:
        add_bevel(obj, bevel)
    smooth_shade(obj)
    return obj


def loft_shell(name, sections, mat=None, parent=None, cap_start=True, cap_end=True,
               subsurf=1, bevel=0.0, crease_sharp=False):
    """Loft bodywork through cross-sections: [(y, [(x, z), ...]), ...].
    All sections need the same point count and winding. With subsurf=1..2 this
    produces the smooth pressed-steel / molded shells real trucks have."""
    bm = bmesh.new()
    rings = []
    for y, pts in sections:
        ring = [bm.verts.new((x, y, z)) for x, z in pts]
        rings.append(ring)
    for ring_a, ring_b in zip(rings, rings[1:]):
        n = len(ring_a)
        for i in range(n):
            bm.faces.new((ring_a[i], ring_a[(i + 1) % n], ring_b[(i + 1) % n], ring_b[i]))
    # crease cap boundaries so subsurf keeps end faces flat instead of ballooning
    crease = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
    for ring, do_cap, reverse in ((rings[0], cap_start, True), (rings[-1], cap_end, False)):
        if not do_cap:
            continue
        bm.faces.new(list(reversed(ring)) if reverse else ring)
        n = len(ring)
        for i in range(n):
            edge = bm.edges.get((ring[i], ring[(i + 1) % n]))
            if edge is not None:
                edge[crease] = 1.0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = mesh_from_bm(name, bm, mat, parent)
    if subsurf:
        add_subsurf(obj, subsurf)
    if bevel:
        add_bevel(obj, bevel)
    smooth_shade(obj, 60 if subsurf else 38)
    return obj


def tube(name, points, radius, mat=None, parent=None, resolution=16, corner_radius=0.06,
         cyclic=False):
    """Round-tube swept along a polyline with filleted corners: guard posts,
    tiller loops, grab bars, hose runs."""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = max(4, resolution // 2)
    curve.use_fill_caps = True
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for index, (bp, pt) in enumerate(zip(spline.bezier_points, points)):
        bp.co = Vector(pt)
        # interior points get a small AUTO fillet, ends stay VECTOR-straight;
        # welded-tube elbows, not banana bows
        interior = 0 < index < len(points) - 1
        bp.handle_left_type = bp.handle_right_type = 'AUTO' if (interior and corner_radius) else 'VECTOR'
    spline.use_cyclic_u = cyclic
    curve.resolution_u = 24
    tmp = bpy.data.objects.new(name, curve)
    link(tmp, parent)
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(deps))
    if mat is not None:
        me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    obj.parent = parent
    bpy.context.scene.collection.objects.link(obj)
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(curve)
    smooth_shade(obj, 46)
    return obj


def lathe(name, profile, mat=None, parent=None, segments=48, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Spin an (r, z) profile around Z for knobs, hubs, cylinder bodies, and couplers."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, axis=(0, 0, 1), cent=(0, 0, 0),
                   angle=2 * math.pi, steps=segments, use_merge=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = mesh_from_bm(name, bm, mat, parent)
    obj.location = loc
    obj.rotation_euler = rot
    smooth_shade(obj, 46)
    return obj


TEXT_FACING = {
    # euler rotations that present unmirrored text to a viewer on that side
    '+Y': (-math.pi / 2, math.pi, 0),
    '-Y': (math.pi / 2, 0, 0),
    '+X': (math.pi / 2, 0, math.pi / 2),
    '-X': (math.pi / 2, 0, -math.pi / 2),
    '+Z': (0, 0, 0),
}


def text_mesh(name, text, size=0.08, depth=0.0018, mat=None, parent=None, loc=(0, 0, 0),
              rot=(0, 0, 0), align='CENTER', bold=True, facing=None):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = text
    curve.size = size
    curve.extrude = depth
    curve.align_x = align
    curve.align_y = 'CENTER'
    if bold:
        curve.offset = size * 0.015
    tmp = bpy.data.objects.new(name, curve)
    link(tmp)
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(deps))
    if mat is not None:
        me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    obj.location = loc
    obj.rotation_euler = TEXT_FACING[facing] if facing else rot
    obj.parent = parent
    bpy.context.scene.collection.objects.link(obj)
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(curve)
    return obj


def mirror_x(obj):
    mod = obj.modifiers.new('mirror', 'MIRROR')
    mod.use_axis = (True, False, False)
    return obj


def bolt_ring(name, count, ring_radius, bolt_radius, depth, loc=(0, 0, 0), mat=None,
              parent=None, axis='X'):
    bm = bmesh.new()
    for i in range(count):
        a = i * 2 * math.pi / count
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=True, segments=6, radius1=bolt_radius,
                              radius2=bolt_radius * 0.92, depth=depth)
        me_t = bpy.data.meshes.new('t')
        tmp.to_mesh(me_t)
        tmp.free()
        bm.from_mesh(me_t)
        bpy.data.meshes.remove(me_t)
        moved = [v for v in bm.verts if not v.tag]
        for v in moved:
            v.co += Vector((ring_radius * math.cos(a), ring_radius * math.sin(a), 0))
            v.tag = True
    obj = mesh_from_bm(name, bm, mat or M.steel_dark(), parent)
    obj.location = loc
    if axis == 'X':
        obj.rotation_euler = (0, math.pi / 2, 0)
    elif axis == 'Y':
        obj.rotation_euler = (math.pi / 2, 0, 0)
    smooth_shade(obj)
    return obj


# ------------------------------------------------------------------ assemblies
def c_channel(name, height, web=0.16, flange=0.055, thickness=0.014, mat=None, parent=None,
              loc=(0, 0, 0), open_toward=1):
    """Vertical mast rail: C-channel, opening toward +X (open_toward=1) or -X."""
    w, f, t = web, flange, thickness
    s = open_toward
    pts = [(-s * f / 2, -w / 2), (s * f / 2, -w / 2), (s * f / 2, -w / 2 + t),
           (-s * f / 2 + s * t, -w / 2 + t), (-s * f / 2 + s * t, w / 2 - t),
           (s * f / 2, w / 2 - t), (s * f / 2, w / 2), (-s * f / 2, w / 2)]
    # pts are (x, y); extrude up Z
    return extrude_profile(name, pts, height, mat or M.mast_steel(), parent, plane='XY',
                           bevel=0.003, loc=loc)


def chain_strip(name, length, mat=None, parent=None, loc=(0, 0, 0), width=0.028):
    """Leaf-chain run: alternating link plates along Z."""
    pitch = 0.035
    bm = bmesh.new()
    n = max(2, int(length / pitch))
    for i in range(n):
        z = i * pitch
        wide = i % 2 == 0
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1)
        bmesh.ops.scale(tmp, verts=tmp.verts,
                        vec=Vector((width if wide else width * 0.7, 0.012, pitch * 1.18)))
        bmesh.ops.translate(tmp, verts=tmp.verts, vec=Vector((0, 0, z)))
        me_t = bpy.data.meshes.new('t')
        tmp.to_mesh(me_t)
        tmp.free()
        bm.from_mesh(me_t)
        bpy.data.meshes.remove(me_t)
    obj = mesh_from_bm(name, bm, mat or M.chain_steel(), parent)
    obj.location = loc
    return obj


def fork(name, length=1.07, width=0.1, blade_t=0.04, shank_h=0.42, shank_t=0.045,
         mat=None, parent=None, loc=(0, 0, 0)):
    """ITA fork: vertical shank at the rear, radiused heel, tapered blade toward
    the tip, pointing +Y."""
    heel_r = 0.075
    # shank back edge down, heel arc into the blade top, taper to tip
    pts = [(0.0, shank_h), (shank_t, shank_h)]
    for i in range(0, 7):
        a = i / 6 * (math.pi / 2)
        pts.append((shank_t + heel_r * (1 - math.cos(a)), blade_t + heel_r * (1 - math.sin(a))))
    pts += [(length * 0.66, blade_t), (length, 0.012), (length, 0.004), (0.0, 0.0)]
    centered = (loc[0] - width / 2, loc[1], loc[2])
    obj = extrude_profile(name, [(y, z) for y, z in pts], width, mat or M.steel_forks(),
                          parent, plane='YZ', bevel=0.005, loc=centered)
    return obj


def fork_pair(parent, spread=0.55, length=1.07, mat=None, z=0.0, name='forks'):
    left = fork(f'{name}_L', length=length, mat=mat, parent=parent, loc=(-spread / 2, 0, z))
    right = fork(f'{name}_R', length=length, mat=mat, parent=parent, loc=(spread / 2, 0, z))
    return left, right


def load_backrest(name, width=0.9, height=1.2, mat=None, parent=None, loc=(0, 0, 0)):
    grp_mat = mat or M.frame_black()
    bm = bmesh.new()

    def bar(size, offset):
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1)
        bmesh.ops.scale(tmp, verts=tmp.verts, vec=Vector(size))
        bmesh.ops.translate(tmp, verts=tmp.verts, vec=Vector(offset))
        me_t = bpy.data.meshes.new('t')
        tmp.to_mesh(me_t)
        tmp.free()
        bm.from_mesh(me_t)
        bpy.data.meshes.remove(me_t)

    for x in (-width / 2, width / 2):
        bar((0.05, 0.04, height), (x, 0, height / 2))
    for frac in (0.28, 0.62, 0.96):
        bar((width, 0.035, 0.045), (0, 0, height * frac))
    for x in (-width * 0.25, 0, width * 0.25):
        bar((0.03, 0.03, height * 0.9), (x, 0, height * 0.45))
    obj = mesh_from_bm(name, bm, grp_mat, parent)
    obj.location = loc
    add_bevel(obj, 0.004)
    smooth_shade(obj)
    return obj


def mast_assembly(parent, height=3.4, stages=2, outer_width=0.98, rail_web=0.17,
                  cylinder_center=True, side_cylinders=False, chains=True, mat=None):
    """Nested mast: outer stage fixed, inner stages progressively narrower and
    set slightly forward (+Y), with tie bars, cylinders, chains and pulleys."""
    mat = mat or M.mast_steel()
    inner_gap = 0.075
    for stage in range(stages):
        w = outer_width - stage * inner_gap * 2
        h = height - stage * 0.16
        y = 0.045 * stage
        for side in (-1, 1):
            c_channel(f'mast_rail_s{stage}_{ "L" if side < 0 else "R"}', h,
                      web=rail_web - stage * 0.02, flange=0.06, mat=mat, parent=parent,
                      loc=(side * w / 2, y, 0.06), open_toward=-side)
        for z, sz in ((0.14, 0.1), (h - 0.06, 0.09)):
            box(f'mast_tie_s{stage}_{int(z * 100)}', (w - 0.06, 0.05, sz), (0, y, z),
                mat, parent, bevel=0.006)
    if cylinder_center:
        lathe('mast_cyl_body', [(0.0, 0), (0.052, 0), (0.052, height * 0.52),
                                (0.045, height * 0.53), (0.045, height * 0.55), (0.0, 0.55 * height)],
              M.frame_black(), parent, loc=(0, 0.02, 0.1))
        cyl('mast_cyl_rod', 0.03, height * 0.5, (0, 0.02, height * 0.72),
            M.chrome_rod(), parent)
    if side_cylinders:
        for side in (-1, 1):
            x = side * (outer_width / 2 - 0.1)
            lathe(f'mast_cyl_{ "L" if side < 0 else "R"}',
                  [(0.0, 0), (0.042, 0), (0.042, height * 0.45), (0.035, height * 0.46),
                   (0.035, height * 0.48), (0.0, height * 0.48)],
                  M.frame_black(), parent, loc=(x, -0.02, 0.12))
            cyl(f'mast_rod_{ "L" if side < 0 else "R"}', 0.024, height * 0.42,
                (x, -0.02, height * 0.62), M.chrome_rod(), parent)
    if chains:
        for side in (-1, 1):
            chain_strip(f'mast_chain_{ "L" if side < 0 else "R"}', height * 0.76,
                        parent=parent, loc=(side * 0.3, 0.115, 0.3))
        for side in (-1, 1):
            cyl(f'mast_pulley_{ "L" if side < 0 else "R"}', 0.055, 0.03,
                (side * 0.3, 0.09, height * 0.78 + 0.3), M.steel_dark(), parent, axis='X')


def overhead_guard(parent, width=1.02, depth=1.3, height=2.28, base_z=0.0, y_center=0.25,
                   mat=None, rake=0.05, slat_count=4, radius=0.03):
    """Four curved posts into a roof frame with fore-aft slats (falling-object guard)."""
    mat = mat or M.frame_black()
    corners = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            base = Vector((sx * width / 2, y_center + sy * depth / 2 + (rake if sy > 0 else -rake), base_z))
            top = Vector((sx * width / 2, y_center + sy * depth / 2 * 0.92, height))
            mid = Vector((base.x, base.y, height * 0.72))
            tube(f'guard_post_{sx}_{sy}', [base, mid, top], radius, mat, parent,
                 corner_radius=0)
            corners.append(top)
    # roof perimeter
    fl, bl = corners[1], corners[0]
    fr, br = corners[3], corners[2]
    for name, a, b in (('guard_roof_L', bl, fl), ('guard_roof_R', br, fr),
                       ('guard_roof_F', fl, fr), ('guard_roof_B', bl, br)):
        tube(name, [a, b], radius * 0.95, mat, parent)
    for i in range(slat_count):
        x = -width / 2 + (i + 0.5) * width / slat_count
        tube(f'guard_slat_{i}', [Vector((x, bl.y, height + 0.01)), Vector((x, fl.y, height + 0.01))],
             radius * 0.55, mat, parent)


def cage_display(parent, width=0.20, height=0.125, name='forkcam'):
    """Camera monitor on the front header of the operator guard.

    A reach truck working tall slots carries a camera looking along the forks and
    a monitor high on the front of the overhead guard, so the operator can place
    a load into an 8 m slot without craning back to watch the fork tips. Without
    it the top-slot exercise is guesswork the real machine does not ask for.

    Built in the parent's frame facing -Y (toward the operator), so the caller
    supplies the tilt by rotating the parent empty. The screen mesh is named
    <name>_display and the Simulator binds a live render target to it; keep that
    name in step with FORKCAM_DISPLAY in src/sim/vehicleFactory.js.
    """
    shell = M.plastic_dark()
    # Yoke bracket up to the guard header.
    for sx in (-1, 1):
        tube(f'{name}_yoke_{sx}', [Vector((sx * width * 0.42, 0.012, height * 0.5)),
                                   Vector((sx * width * 0.42, 0.055, height * 0.5 + 0.085))],
             0.008, M.frame_black(), parent, corner_radius=0)
    rounded_box(f'{name}_bezel', (width, 0.026, height), (0, 0, 0), shell, parent,
                radius=0.010, segments=5)
    rounded_box(f'{name}_hood', (width + 0.016, 0.030, 0.014),
                (0, -0.006, height * 0.5 + 0.006), shell, parent, radius=0.005, segments=4)
    # The display face itself. Left unlit and slightly proud of the bezel.
    screen = box(f'{name}_display', (width - 0.022, 0.004, height - 0.020),
                 (0, -0.014, 0), M.screen_glass(), parent, bevel=0.001)
    planar_uv(screen)
    return screen


def wheel_poly(name, radius, width, mat=None, parent=None, loc=(0, 0, 0), hub=True):
    """Polyurethane wheel: tire band with rounded shoulders + steel hub w/ bolts."""
    obj = cyl(name, radius, width, loc, mat or M.poly_wheel(), parent, axis='X',
              verts=48, bevel=min(0.02, radius * 0.28))
    if hub and radius > 0.09:
        # children of the X-rotated tire stay in its local (Z-axle) space
        cyl(name + '_hub', radius * 0.55, width * 1.04, (0, 0, 0), M.steel_dark(), obj, axis='Z')
        bolt_ring(name + '_bolts', 6, radius * 0.34, radius * 0.07, width * 1.1,
                  (0, 0, 0), parent=obj, axis='Z')
    return obj


def tire_cushion(name, radius, width, mat=None, parent=None, loc=(0, 0, 0)):
    """Cushion press-on tire: deep rounded tire band + painted hub + bolt circle."""
    obj = cyl(name, radius, width, loc, mat or M.rubber_tire(), parent, axis='X',
              verts=56, bevel=radius * 0.32)
    cyl(name + '_hub', radius * 0.52, width * 1.06, (0, 0, 0), M.steel_dark(), obj, axis='Z', bevel=0.008)
    bolt_ring(name + '_bolts', 8, radius * 0.3, radius * 0.055, width * 1.12,
              (0, 0, 0), parent=obj, axis='Z')
    cyl(name + '_cap', radius * 0.14, width * 1.14, (0, 0, 0), M.steel_dark(), obj, axis='Z')
    return obj


def steering_wheel(name, radius=0.17, mat=None, parent=None, loc=(0, 0, 0)):
    grip = mat or M.grip_rubber()
    obj = lathe(name, [(radius - 0.016, -0.008), (radius + 0.016, -0.008),
                       (radius + 0.016, 0.008), (radius - 0.016, 0.008),
                       (radius - 0.016, -0.008)], grip, parent, loc=loc)
    # replace sharp square rim with smooth torus look
    add_subsurf(obj, 2)
    for i in range(3):
        a = i * 2 * math.pi / 3 + math.pi / 6
        spoke = box(f'{name}_spoke{i}', (radius * 0.9, 0.03, 0.012),
                    (math.cos(a) * radius * 0.45, math.sin(a) * radius * 0.45, 0),
                    M.plastic_dark(), obj, bevel=0.004)
        spoke.rotation_euler = (0, 0, a)
    lathe(f'{name}_hub', [(0.0, -0.012), (0.05, -0.012), (0.055, 0.02), (0.03, 0.03), (0.0, 0.03)],
          M.plastic_dark(), obj)
    return obj


def pedal(name, size=(0.16, 0.2), mat=None, parent=None, loc=(0, 0, 0), angle=-0.28):
    obj = box(name, (size[0], size[1], 0.016), loc, mat or M.grip_rubber(), parent, bevel=0.005)
    obj.rotation_euler = (angle, 0, 0)
    for i in range(4):
        box(f'{name}_rib{i}', (size[0] * 0.86, 0.012, 0.004),
            (0, -size[1] / 2 + (i + 0.5) * size[1] / 4, 0.01), M.plastic_dark(), obj, bevel=0.0015)
    return obj


def lever(name, length=0.26, knob_color=None, mat=None, parent=None, loc=(0, 0, 0)):
    shaft = cyl(name, 0.011, length, (0, 0, length / 2), mat or M.steel_dark(), parent)
    shaft.location = loc
    lathe(f'{name}_knob', [(0.0, 0), (0.018, 0.004), (0.024, 0.02), (0.02, 0.042), (0.0, 0.05)],
          knob_color or M.plastic_dark(), shaft, loc=(0, 0, length / 2))
    return shaft


def thumb_ball(name, radius=0.019, mat=None, parent=None, loc=(0, 0, 0), socket_mat=None,
               socket=True, seat_depth=0.68):
    """Crown Multi-Task thumb ball: a rubber-capped sphere in a molded socket.

    The operator rolls one ball on two axes. Up/down tilts the fork tips, away
    and toward reaches and retracts. It is a ball, not a rocker: the ball must
    sit proud of its socket by roughly 58% of its diameter or it reads as a
    button and loses the rolling affordance operators recognize.
    """
    if socket:
        # Shallow dish the ball nests into, with a raised lip the thumb feels.
        collar = lathe(f'{name}_socket',
                       [(0.0, -0.010), (radius * 1.72, -0.010), (radius * 1.66, 0.004),
                        (radius * 1.30, 0.011), (radius * 1.04, 0.001), (0.0, -0.002)],
                       socket_mat or M.plastic_dark(), parent, segments=36, loc=loc)
    else:
        collar = parent
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=20, radius=radius)
    ball = mesh_from_bm(name, bm, mat or M.grip_rubber(), collar if socket else parent)
    # The socket occludes the buried part, so the sphere stays whole. Trimming
    # it with a bisect is fragile: clearing the wrong side leaves an empty cup.
    # Sitting the centre this proud exposes ~58% of the diameter, which is what
    # makes it read as a ball the thumb rolls rather than a button it presses.
    ball.location = loc if not socket else (0, 0, radius * (seat_depth - 0.5) * 2)
    smooth_shade(ball, 60)
    return ball


def thumb_switch(name, size=(0.026, 0.012, 0.016), mat=None, parent=None, loc=(0, 0, 0),
                 rot=(0, 0, 0)):
    """Recessed momentary switch, e.g. the switch on the back of the Crown handle."""
    housing = rounded_box(f'{name}_housing', (size[0] * 1.35, size[1] * 1.5, size[2] * 1.4),
                          loc, M.plastic_dark(), parent, radius=0.004, segments=4, rot=rot)
    return rounded_box(name, size, (0, -size[1] * 0.45, 0), mat or M.plastic_molded(),
                       housing, radius=0.003, segments=4)


def planar_uv(obj, plane='XZ'):
    """Planar UV projection normalized to the mesh bounds.

    THIS IS NOT OPTIONAL FOR ANYTHING THAT CARRIES A TEXTURE. box() and friends
    build geometry with bmesh.ops.create_cube, which creates no uv layer at all.
    A material with a map and no UVs samples texel (0,0) for every fragment, so
    the whole panel renders as ONE FLAT COLOUR. Every instrument screen in the
    fleet was doing exactly that -- the live telemetry canvas was being drawn
    and then sampled at a single pixel -- and so was the fork camera monitor,
    which is why its feed looked like a solid colour that changed as the truck
    moved instead of like a picture.
    """
    mesh = obj.data
    if mesh.uv_layers:
        return obj
    axis_a, axis_b = {'XZ': (0, 2), 'XY': (0, 1), 'YZ': (1, 2)}[plane]
    coords = [vertex.co for vertex in mesh.vertices]
    if not coords:
        return obj
    low_a = min(c[axis_a] for c in coords)
    low_b = min(c[axis_b] for c in coords)
    span_a = max(max(c[axis_a] for c in coords) - low_a, 1e-6)
    span_b = max(max(c[axis_b] for c in coords) - low_b, 1e-6)
    uv = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        co = mesh.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co[axis_a] - low_a) / span_a,
                                  (co[axis_b] - low_b) / span_b)
    return obj


def display(name, width=0.17, height=0.115, mat_screen=None, parent=None, loc=(0, 0, 0),
            rot=(0, 0, 0), screen_name=None):
    bezel = rounded_box(name, (width, 0.03, height), loc, M.plastic_dark(), parent,
                        radius=0.012, rot=rot)
    screen = box(screen_name or f'{name}_screen', (width * 0.82, 0.004, height * 0.72),
                 (0, -0.017, 0.004), mat_screen or M.screen_glass(), bezel, bevel=0.002)
    planar_uv(screen)
    return bezel, screen


def tread_plate(name, size, mat=None, parent=None, loc=(0, 0, 0), rib_axis='Y', rib_gap=0.075):
    plate = box(name, (size[0], size[1], 0.012), loc, mat or M.floor_mat(), parent, bevel=0.004)
    count = int((size[0] if rib_axis == 'Y' else size[1]) / rib_gap)
    for i in range(count):
        off = -(size[0] if rib_axis == 'Y' else size[1]) / 2 + (i + 0.5) * rib_gap
        if rib_axis == 'Y':
            box(f'{name}_rib{i}', (0.016, size[1] * 0.92, 0.004), (off, 0, 0.008),
                M.plastic_dark(), plate, bevel=0.0015)
        else:
            box(f'{name}_rib{i}', (size[0] * 0.92, 0.016, 0.004), (0, off, 0.008),
                M.plastic_dark(), plate, bevel=0.0015)
    return plate


def grab_bar(name, points, radius=0.017, mat=None, parent=None):
    return tube(name, points, radius, mat or M.plastic_dark(), parent)


def seat(name, parent=None, loc=(0, 0, 0), mat=None):
    """Suspension seat for an operator facing +Y, so the backrest sits at -Y."""
    vinyl = mat or M.seat_vinyl()
    root = bpy.data.objects.new(name, None)
    link(root, parent)
    root.location = loc
    base = rounded_box(f'{name}_cushion', (0.5, 0.5, 0.13), (0, 0, 0.065), vinyl, root, radius=0.05)
    for i in (-1, 1):
        rounded_box(f'{name}_bolster{i}', (0.09, 0.46, 0.16), (i * 0.24, 0, 0.09), vinyl, root, radius=0.04)
    back = rounded_box(f'{name}_back', (0.48, 0.14, 0.62), (0, -0.26, 0.4), vinyl, root, radius=0.05)
    back.rotation_euler = (0.12, 0, 0)
    for i in (-1, 1):
        b = rounded_box(f'{name}_backbolster{i}', (0.1, 0.15, 0.5), (i * 0.23, -0.28, 0.38), vinyl, root, radius=0.04)
        b.rotation_euler = (0.12, 0, 0)
    rounded_box(f'{name}_headrest', (0.4, 0.13, 0.15), (0, -0.31, 0.76), vinyl, root, radius=0.045)
    rounded_box(f'{name}_frame', (0.44, 0.42, 0.07), (0, 0, -0.05), M.frame_black(), root, radius=0.012)
    return root


def label(name, size, mat, parent, loc, rot=(0, 0, 0), text=None, text_mat=None, text_size=None):
    plate = box(name, (size[0], 0.0035, size[1]), loc, mat, parent, bevel=0.0015, rot=rot)
    if text:
        text_mesh(f'{name}_txt', text, text_size or size[1] * 0.55, 0.001,
                  text_mat or M.decal_dark(), plate, loc=(0, -0.003, 0),
                  rot=(math.pi / 2, 0, 0))
    return plate
