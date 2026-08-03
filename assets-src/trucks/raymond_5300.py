"""Raymond 5300 man-up order picker (Class II).

Spec anchors (m): overall width ~1.02, mast rails ~2.9 lowered, platform floor
0.28 lowered, overhead guard rides on the platform, forks protrude +Y from under
the platform between fixed baselegs.

Against the Crown SP 1500 the board shows a different design language: charcoal
is the dominant colour with a Raymond-red power-unit body and skirt, the console
is a wide molded charcoal wall carrying the signature large round fan grille and
a red control strip, the side gates are dark rather than safety orange, and the
overhead guard is a flat black frame.

Rig: rig_root > rig_mast > rig_carriage (global (0, 0.9, 0)) which carries
rig_platform, the forks, and rig_cameraMount so the eye rises with the platform.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from lib import materials as M
from lib import parts as P
from lib import rig as R

RED = M.raymond_red
BLACK = M.frame_black
CHARCOAL = M.plastic_molded

CARRIAGE_Y = 0.9
MAST_Y = -0.42


def rounded_rect(w, h, r_bottom, r_top, z0=0.0, n=4):
    pts = []

    def corner(cx, cz, radius, a0, a1):
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            pts.append((cx + radius * math.cos(a), cz + radius * math.sin(a)))

    corner(w / 2 - r_bottom, z0 + r_bottom, r_bottom, -math.pi / 2, 0)
    corner(w / 2 - r_top, z0 + h - r_top, r_top, 0, math.pi / 2)
    corner(-w / 2 + r_top, z0 + h - r_top, r_top, math.pi / 2, math.pi)
    corner(-w / 2 + r_bottom, z0 + r_bottom, r_bottom, math.pi, 1.5 * math.pi)
    return pts


def mesh_grid(name, width, height, parent, loc, bar=0.006, nx=8, nz=5, mat=None):
    bm = bmesh.new()

    def rod(size, offset):
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1)
        bmesh.ops.scale(tmp, verts=tmp.verts, vec=Vector(size))
        bmesh.ops.translate(tmp, verts=tmp.verts, vec=Vector(offset))
        me_t = bpy.data.meshes.new('t')
        tmp.to_mesh(me_t)
        tmp.free()
        bm.from_mesh(me_t)
        bpy.data.meshes.remove(me_t)

    for i in range(nx):
        x = -width / 2 + (i + 0.5) * width / nx
        rod((bar, bar, height), (x, 0, height / 2))
    for j in range(nz):
        z = (j + 0.5) * height / nz
        rod((width, bar, bar), (0, 0, z))
    obj = P.mesh_from_bm(name, bm, mat or M.steel_dark(), parent)
    obj.location = loc
    return obj


def power_unit(root):
    red = RED()
    sections = []
    for y, w, h, rt, z0 in ((-1.52, 0.90, 0.80, 0.14, 0.20),
                            (-1.44, 0.99, 0.90, 0.11, 0.18),
                            (-1.10, 1.01, 0.94, 0.09, 0.17),
                            (-0.76, 1.01, 0.95, 0.08, 0.16),
                            (-0.62, 0.97, 0.93, 0.10, 0.17)):
        sections.append((y, rounded_rect(w, h, 0.045, rt, z0=z0)))
    P.loft_shell('pu_shell', sections, red, root, subsurf=1)
    # charcoal battery lid and service seams
    P.rounded_box('pu_topcap', (0.86, 0.8, 0.055), (0, -1.06, 1.135), CHARCOAL(), root, radius=0.016)
    P.box('pu_lid_seam', (0.92, 0.006, 0.006), (0, -0.64, 1.08), M.plastic_dark(), root, bevel=0.002)
    P.rounded_box('pu_skirt', (1.02, 0.98, 0.2), (0, -1.06, 0.13), M.plastic_dark(), root, radius=0.04)
    # vented charcoal panel low on each flank
    for sx in (-1, 1):
        P.rounded_box(f'pu_vent_{int(sx > 0)}', (0.012, 0.42, 0.2), (sx * 0.507, -1.2, 0.5),
                      M.plastic_dark(), root, radius=0.008)
        for i in range(5):
            P.box(f'pu_louvre_{int(sx > 0)}_{i}', (0.014, 0.36, 0.014),
                  (sx * 0.512, -1.2, 0.43 + i * 0.036), M.steel_dark(), root, bevel=0.003)
    # branding: RAYMOND runs vertically up the flank on this series
    for sx, face in ((1, '+X'), (-1, '-X')):
        P.text_mesh(f'logo_side_{face[0]}{face[1]}', 'RAYMOND', 0.062, 0.002, M.decal_white(), root,
                    loc=(sx * 0.506, -0.95, 0.86), rot=(math.pi / 2, math.pi / 2, sx * math.pi / 2))
        P.text_mesh(f'logo_model_{face[0]}{face[1]}', '5300', 0.042, 0.002, M.decal_white(), root,
                    loc=(sx * 0.506, -1.42, 0.86), facing=face)
    P.text_mesh('logo_rear', 'RAYMOND', 0.062, 0.002, M.decal_white(), root,
                loc=(0, -1.534, 0.86), facing='-Y')
    P.label('pu_data', (0.13, 0.09), M.decal_white(), root, (-0.507, -0.76, 0.66),
            rot=(0, 0, -math.pi / 2))
    P.label('pu_capacity', (0.13, 0.09), M.warning_amber(), root, (0.507, -0.76, 0.66),
            rot=(0, 0, math.pi / 2))
    P.wheel_poly('rig_driveWheel', 0.16, 0.14, M.rubber_tire(), root, loc=(0, -1.1, 0.16))
    for i, sx in enumerate((-1, 1)):
        P.wheel_poly(f'pu_caster_{i}', 0.05, 0.06, parent=root, loc=(sx * 0.34, -0.7, 0.05), hub=False)


def baselegs(root):
    for index, sx in enumerate((-1, 1)):
        x = sx * 0.43
        P.extrude_profile(f'leg_{index}',
                          [(-0.055, 0.0), (0.055, 0.0), (0.055, 0.15), (-0.055, 0.15)],
                          1.27, BLACK(), root, plane='XZ', bevel=0.01, loc=(x, -0.55, 0.0))
        P.loft_shell(f'leg_tip_{index}',
                     [(0.72, [(x - 0.055, 0.015), (x + 0.055, 0.015), (x + 0.055, 0.15), (x - 0.055, 0.15)]),
                      (0.88, [(x - 0.045, 0.02), (x + 0.045, 0.02), (x + 0.045, 0.1), (x - 0.045, 0.1)])],
                     BLACK(), root, subsurf=0, bevel=0.008)
        P.wheel_poly(f'rig_loadWheel_{index}', 0.0635, 0.08, parent=root,
                     loc=(x, 0.795, 0.0635), hub=False)
        P.label(f'leg_stripe_{index}', (0.24, 0.04), M.button_red(), root,
                (x + sx * 0.056, 0.28, 0.075), rot=(0, 0, sx * math.pi / 2))


def mast(root):
    node = R.empty('rig_mast', (0, MAST_Y, 0), root)
    steel = M.mast_steel()
    for side in (-1, 1):
        tag = 'L' if side < 0 else 'R'
        P.c_channel(f'mast_rail_s0_{tag}', 2.9, web=0.16, flange=0.062, mat=steel,
                    parent=node, loc=(side * 0.45, 0.0, 0.04), open_toward=-side)
        P.c_channel(f'mast_rail_s1_{tag}', 2.78, web=0.13, flange=0.055, mat=steel,
                    parent=node, loc=(side * 0.36, 0.055, 0.08), open_toward=-side)
    for z, sz in ((0.2, 0.12), (1.48, 0.1), (2.78, 0.11)):
        P.box(f'mast_tie_{int(z * 100)}', (0.84, 0.05, sz), (0, -0.01, z), steel, node, bevel=0.006)
    P.rounded_box('mast_head', (0.74, 0.19, 0.15), (0, 0.055, 2.81), BLACK(), node, radius=0.025)
    P.lathe('mast_cyl_body', [(0.0, 0), (0.052, 0), (0.052, 1.45), (0.045, 1.47),
                              (0.045, 1.52), (0.0, 1.52)], BLACK(), node, loc=(0, 0.0, 0.1))
    P.cyl('mast_cyl_rod', 0.03, 1.0, (0, 0.0, 2.1), M.chrome_rod(), node)
    for side in (-1, 1):
        tag = 'L' if side < 0 else 'R'
        P.chain_strip(f'mast_chain_{tag}', 2.2, parent=node, loc=(side * 0.26, 0.11, 0.3))
        P.cyl(f'mast_pulley_{tag}', 0.055, 0.03, (side * 0.26, 0.09, 2.63), M.steel_dark(), node, axis='X')
    P.box('mast_base', (0.86, 0.3, 0.26), (0, -0.03, 0.14), BLACK(), node, bevel=0.01)
    P.tube('mast_hose', [(0.5, 0.1, 0.35), (0.53, 0.15, 1.7), (0.5, 0.11, 2.3)], 0.012,
           M.grip_rubber(), node, corner_radius=0.1)
    P.tube('mast_hose2', [(-0.5, 0.02, 0.35), (-0.52, 0.06, 1.6), (-0.5, 0.05, 2.3)], 0.01,
           M.grip_rubber(), node, corner_radius=0.1)
    return node


def console(platform):
    """Wide molded charcoal console wall with the round fan grille."""
    molded = CHARCOAL()
    dark = M.plastic_dark()
    P.rounded_box('console_wall', (0.96, 0.2, 0.98), (0, -0.09, 0.83), molded, platform, radius=0.05)
    P.rounded_box('console_top', (0.94, 0.3, 0.1), (0, -0.02, 1.33), molded, platform, radius=0.03)
    P.box('console_seam', (0.9, 0.006, 0.008), (0, 0.008, 0.62), dark, platform, bevel=0.002)

    # signature recessed circular fan grille, left of centre
    P.lathe('fan_recess', [(0.0, 0), (0.15, 0), (0.155, 0.022), (0.14, 0.03), (0.0, 0.03)],
            dark, platform, loc=(-0.24, 0.012, 0.98), rot=(-math.pi / 2, 0, 0))
    P.lathe('fan_hub', [(0.0, 0), (0.05, 0.004), (0.055, 0.02), (0.0, 0.026)],
            M.steel_dark(), platform, loc=(-0.24, -0.01, 0.98), rot=(-math.pi / 2, 0, 0))
    # grille spokes lie in the console face (XZ) and radiate about the Y axis
    for i in range(9):
        bar = P.box(f'fan_bar_{i}', (0.012, 0.012, 0.27), (-0.24, 0.004, 0.98), M.steel_dark(),
                    platform, bevel=0.002)
        bar.rotation_euler = (0, i * math.pi / 9, 0)

    # red control strip low-left, instrument cluster and switches to the right
    P.rounded_box('console_strip', (0.3, 0.06, 0.07), (-0.24, 0.02, 1.26), M.button_red(),
                  platform, radius=0.012)
    for i in range(3):
        P.rounded_box(f'console_sw_{i}', (0.032, 0.03, 0.026), (-0.03 + i * 0.06, 0.03, 1.26),
                      dark, platform, radius=0.006)
    P.display('console_display', 0.16, 0.1, parent=platform, loc=(0.28, 0.02, 1.25),
              rot=(-0.3, 0, math.pi), screen_name='screen_5300')

    # left pod: steering disc with grab loop, at working height on the wall
    steer = R.empty('rig_steerPivot', (-0.24, 0.1, 1.42), platform)
    disc = P.lathe('steer_disc', [(0.0, 0), (0.08, 0.004), (0.087, 0.02), (0.06, 0.038), (0.0, 0.044)],
                   M.grip_rubber(), steer, rot=(-math.pi / 2, 0, 0))
    R.tag_control(disc, 'steer', 'Raymond order-picker steering control', 'horizontal', False)
    P.tube('steer_loop', [(-0.055, 0.005, -0.005), (-0.055, 0.08, 0.05), (0.0, 0.105, 0.075),
                          (0.055, 0.08, 0.05), (0.055, 0.005, -0.005)], 0.013,
           M.steel_dark(), steer, corner_radius=0.05)

    # right pod: multifunction travel/lift handle
    travel = R.empty('rig_travelPivot', (0.26, 0.1, 1.42), platform)
    P.lathe('travel_boss', [(0.0, 0), (0.07, 0.004), (0.075, 0.03), (0.06, 0.05), (0.0, 0.056)],
            dark, travel, rot=(-math.pi / 2, 0, 0))
    grip = P.lathe('travel_grip', [(0.0, 0), (0.036, 0.004), (0.04, 0.05), (0.034, 0.1),
                                   (0.038, 0.15), (0.022, 0.185), (0.0, 0.19)],
                   M.plastic_dark(), travel, loc=(0, 0.055, 0.0), rot=(-math.pi / 2 + 0.3, 0, 0))
    R.tag_control(grip, 'travel', 'Travel / lift multifunction handle', 'vertical', True)
    lift = R.empty('rig_liftPivot', (0.26, 0.19, 1.50), platform)
    rocker = P.rounded_box('lift_rocker', (0.052, 0.05, 0.075), (0, 0, 0), M.button_red(), lift, radius=0.012)
    R.tag_control(rocker, 'lift', 'Platform lift and lower rocker', 'vertical', True)
    horn = P.cyl('btn_horn', 0.026, 0.016, (-0.07, 0.048, 1.24), M.warning_amber(), platform, axis='Y')
    R.tag_control(horn, 'horn', 'Horn button', 'button', True)
    P.lathe('btn_estop', [(0.0, 0), (0.018, 0), (0.018, 0.02), (0.027, 0.024), (0.027, 0.042), (0.0, 0.048)],
            M.button_red(), platform, loc=(-0.42, 0.045, 1.24), rot=(-math.pi / 2, 0, 0))
    P.label('console_warn', (0.1, 0.07), M.decal_white(), platform, (0.42, 0.042, 1.16),
            rot=(0, 0, math.pi))


def platform_assembly(carriage):
    platform = R.empty('rig_platform', (0, -CARRIAGE_Y, 0), carriage)
    P.rounded_box('plat_base', (1.0, 0.86, 0.11), (0, 0.26, 0.225), M.plastic_dark(), platform, radius=0.03)
    P.tread_plate('plat_floor', (0.9, 0.74), M.floor_mat(), platform, (0, 0.28, 0.285), rib_axis='X')
    P.label('plat_edge', (0.42, 0.05), M.warning_amber(), platform, (0, 0.685, 0.24),
            rot=(0, 0, math.pi))
    # dark side gates (Raymond does not use the orange loop)
    for i, sx in enumerate((-1, 1)):
        gate = R.empty(f'rig_gate_{i}', (sx * 0.475, 0.0, 1.05), platform)
        P.tube(f'gate_loop_{i}', [(0, 0.04, 0), (0, 0.6, 0), (0, 0.6, -0.32), (0, 0.04, -0.32)],
               0.017, BLACK(), gate, corner_radius=0.05, cyclic=True)
        P.tube(f'gate_mid_{i}', [(0, 0.32, -0.015), (0, 0.32, -0.305)], 0.012, BLACK(), gate,
               corner_radius=0)
        P.box(f'gate_hinge_{i}', (0.03, 0.05, 0.1), (0, 0.02, -0.02), M.steel_dark(), gate, bevel=0.006)
    # guard posts + mesh screen toward the mast
    for sx in (-1, 1):
        P.rounded_box(f'guard_post_{int(sx > 0)}', (0.055, 0.07, 2.25), (sx * 0.41, -0.16, 1.315),
                      BLACK(), platform, radius=0.012)
    mesh_grid('back_mesh', 0.76, 0.72, platform, (0, -0.185, 1.52), nx=9, nz=4)
    # flat black overhead guard frame
    P.tube('roof_frame', [(-0.45, -0.3, 2.47), (-0.45, 0.6, 2.47), (0.45, 0.6, 2.47),
                          (0.45, -0.3, 2.47)], 0.034, BLACK(), platform, corner_radius=0.05, cyclic=True)
    for i, x in enumerate((-0.34, -0.115, 0.115, 0.34)):
        P.tube(f'roof_slat_{i}', [(x, -0.26, 2.49), (x, 0.56, 2.49)], 0.014, BLACK(), platform)
    for i, y in enumerate((0.0, 0.3)):
        P.tube(f'roof_cross_{i}', [(-0.41, y, 2.485), (0.41, y, 2.485)], 0.014, BLACK(), platform)
    for sx in (-1, 1):
        P.box(f'roof_bracket_{int(sx > 0)}', (0.05, 0.05, 0.09), (sx * 0.41, -0.16, 2.44),
              BLACK(), platform, bevel=0.008)
    P.text_mesh('roof_logo', 'RAYMOND', 0.038, 0.0018, M.decal_white(), platform,
                loc=(0, 0.62, 2.47), facing='+Y')
    # Operator stands at the rear of the platform. console() is authored for an
    # operator on its +Y side, so the wall is carried to the front rail and
    # turned to face back at them, putting the pods on the operator's side.
    console_root = R.empty('console_root', (0, 0.60, 0.05), platform)
    console_root.rotation_euler = (0, 0, math.pi)
    console(console_root)
    presence = P.pedal('pedal_presence', (0.16, 0.2), parent=platform, loc=(0.2, 0.12, 0.305), angle=0)
    R.tag_control(presence, 'presence', 'Deadman brake pedal', 'button', False)
    return platform


def carriage_assembly(mast_node):
    carriage = R.empty('rig_carriage', (0, CARRIAGE_Y - MAST_Y, 0), mast_node)
    P.box('carr_plate', (0.64, 0.05, 1.4), (0, -CARRIAGE_Y - 0.25, 0.8), BLACK(), carriage, bevel=0.008)
    for zi, z in enumerate((0.25, 1.35)):
        for sx in (-1, 1):
            P.cyl(f'carr_roller_{zi}_{int(sx > 0)}', 0.045, 0.05,
                  (sx * 0.34, -CARRIAGE_Y - 0.28, z), M.steel_dark(), carriage, axis='X')
    P.box('fork_bar', (0.7, 0.07, 0.13), (0, -CARRIAGE_Y - 0.1, 0.11), BLACK(), carriage, bevel=0.008)
    P.fork_pair(carriage, spread=0.56, length=1.1, z=0.005, name='forks')
    for name in ('forks_L', 'forks_R'):
        bpy.data.objects[name].location.y = -CARRIAGE_Y - 0.14
    platform_assembly(carriage)
    # Standing eye: 0.29 m platform floor + 1.63 m, at the rear of the platform
    # (platform-local y = 0.05) so the console reads in the lower view.
    R.empty('rig_cameraMount', (0, -0.85, 1.92), carriage)
    return carriage


def build():
    root = R.empty('rig_root')
    power_unit(root)
    baselegs(root)
    mast_node = mast(root)
    carriage_assembly(mast_node)
    root['spec'] = 'Raymond 5300 order picker'
    return {
        'name': 'raymond_5300',
        'cab_view': {'loc': (0.0, 0.35, 2.25), 'target': (0.0, -0.85, 0.95), 'focal': 18},
        'closeups': {
            'console': {'loc': (0.45, 0.9, 1.6), 'target': (0.0, -0.02, 1.0), 'focal': 30},
            'platform': {'loc': (1.6, 1.8, 1.0), 'target': (0.0, 0.2, 0.8), 'focal': 33},
        },
    }
