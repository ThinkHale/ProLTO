"""Raymond 5300 man-up order picker (Class II).

Spec anchors (m): overall width ~1.02, mast rails ~2.9 lowered, platform floor
0.28 lowered, overhead guard rides on the platform, forks protrude +Y from under
the platform between fixed baselegs.

Against the Crown SP 1500 the board shows a different design language: charcoal
is the dominant colour with a Raymond-red power-unit body and skirt, the console
is a wide molded charcoal wall carrying the large steering disc, recessed
multifunction handle and compact top display, the side gates are dark rather
than safety orange, and the overhead guard is a flat black frame.

Rig: rig_root > rig_mast > rig_carriage (global (0, 0.9, 0)) which carries
rig_platform, the forks, and rig_cameraMount so the eye rises with the platform.
rig_xrOrigin marks the tracked-floor origin on the moving operator platform.
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
    """Raymond 5300 operator wall, authored from the factory compartment view."""
    molded = CHARCOAL()
    dark = M.plastic_dark()

    # One-piece molded surround. The narrow waist and raised shoulders match the
    # 5300 console instead of reading as a generic rectangular dashboard.
    outline = [(-0.47, 0.38), (-0.48, 1.20), (-0.43, 1.34), (-0.29, 1.39),
               (0.29, 1.39), (0.43, 1.34), (0.48, 1.20), (0.47, 0.38),
               (0.36, 0.31), (-0.36, 0.31)]
    P.extrude_profile('console_shell', outline, 0.19, molded, platform, plane='XZ',
                      bevel=0.024, loc=(0, -0.14, 0))
    P.rounded_box('console_brow', (0.76, 0.08, 0.085), (0, 0.015, 1.335), molded,
                  platform, radius=0.025)
    P.box('console_lower_seam', (0.72, 0.006, 0.007), (0, 0.057, 0.51),
          M.steel_dark(), platform, bevel=0.002)

    # Upper-left grab rail, fixed at both ends and clear of the steering disc.
    P.tube('console_grab_rail', [(0.42, 0.085, 1.30), (0.40, 0.145, 1.36),
                                 (0.16, 0.145, 1.36), (0.13, 0.085, 1.31)],
           0.016, M.grip_rubber(), platform, corner_radius=0.025)
    for x in (0.42, 0.13):
        P.cyl(f'console_grab_mount_{x}', 0.026, 0.016, (x, 0.075, 1.305),
              dark, platform, axis='Y', bevel=0.004)

    # Compact top display with the adjacent membrane status switches and lamps.
    P.display('console_display', 0.145, 0.082, parent=platform,
              loc=(0.055, 0.069, 1.302), rot=(0, 0, math.pi),
              screen_name='screen_5300')
    for i, x in enumerate((0.158, 0.194, 0.230)):
        P.rounded_box(f'console_status_switch_{i}', (0.022, 0.009, 0.019),
                      (x, 0.071, 1.302), dark, platform, radius=0.006)
        P.cyl(f'console_status_lamp_{i}', 0.006, 0.006,
              (x, 0.080, 1.324), M.warning_amber() if i == 1 else M.screen_glass(),
              platform, axis='Y')

    # Factory instruction plate, key switch and red emergency power disconnect.
    P.label('console_instruction', (0.205, 0.155), M.decal_white(), platform,
            (0.01, 0.065, 0.985), rot=(0, 0, math.pi), text='OPERATING\nINSTRUCTIONS',
            text_size=0.020)
    P.cyl('console_key_bezel', 0.025, 0.018, (0.10, 0.079, 0.825),
          M.steel_dark(), platform, axis='Y', bevel=0.003)
    key = P.box('console_key', (0.012, 0.036, 0.034), (0.10, 0.097, 0.825),
                M.steel_dark(), platform, bevel=0.003, rot=(0, 0, -0.35))
    key['control_label'] = 'Key switch'
    P.lathe('console_epo', [(0.0, 0), (0.024, 0), (0.024, 0.016),
                            (0.040, 0.022), (0.040, 0.043), (0.0, 0.049)],
            M.button_red(), platform, loc=(0.205, 0.082, 0.835),
            rot=(-math.pi / 2, 0, 0))
    P.text_mesh('console_epo_label', 'POWER', 0.018, 0.0012, M.decal_white(),
                platform, loc=(0.205, 0.067, 0.778), facing='+Y')

    # Large left steering disc with an offset spinner knob. It is a steering
    # control, not a fan grille.
    # The steering disc is vertical in the compartment, but its working plane
    # must remain local XY so WebXR radial travel resolves around its true
    # center. A raked mount supplies the visible orientation while the rig
    # pivot remains an unrotated child in the disc's mechanical frame.
    steer_mount = R.empty('steer_disc_mount', (0.285, 0.105, 1.055), platform)
    steer_mount.rotation_euler = (-math.pi / 2, 0, 0)
    P.lathe('steer_recess', [(0.0, 0), (0.125, 0), (0.135, 0.010),
                             (0.135, 0.027), (0.0, 0.032)],
            dark, steer_mount)
    steer = R.empty('rig_steerPivot', (0, 0, 0.016), steer_mount)
    disc = P.lathe('steer_disc', [(0.0, 0), (0.098, 0.002), (0.108, 0.016),
                                  (0.100, 0.031), (0.0, 0.038)],
                   M.grip_rubber(), steer)
    R.tag_control(disc, 'steer', 'Raymond 5300 steering disc', 'radial', False,
                  motion='radial')
    P.cyl('steer_center', 0.026, 0.018, (0, 0, 0.047), molded, steer,
          bevel=0.004)
    spinner = P.cyl('steer_spinner', 0.020, 0.060, (0.068, 0.068, 0.063),
                    M.grip_rubber(), steer, bevel=0.008)
    R.tag_control(spinner, 'steer', 'Steering spinner knob', 'radial', False,
                  motion='radial')

    # Deep right-hand molded recess and contoured multifunction handle.
    P.rounded_box('control_recess', (0.285, 0.030, 0.40), (-0.285, 0.065, 1.055),
                  dark, platform, radius=0.035)
    travel = R.empty('rig_travelPivot', (-0.285, 0.092, 1.035), platform)
    grip_outline = [(-0.053, -0.145), (-0.060, 0.045), (-0.048, 0.145),
                    (-0.014, 0.180), (0.045, 0.132), (0.053, -0.072),
                    (0.028, -0.150)]
    grip = P.extrude_profile('travel_grip', grip_outline, 0.074, M.grip_rubber(),
                             travel, plane='XZ', bevel=0.018,
                             loc=(0, -0.012, 0), rot=(0, 0, -0.04))
    R.tag_control(grip, 'travel', 'Raymond multifunction travel handle',
                  'vertical', True, motion='fore-aft')
    P.rounded_box('travel_paddle', (0.058, 0.016, 0.034),
                  (0.008, 0.065, 0.102), molded, travel, radius=0.011,
                  segments=6)
    # Lift and horn belong to the handle, rather than floating from the cowl.
    # Parenting them to the travel grip also keeps every switch clear through
    # the handle's full fore and aft travel.
    lift = R.empty('rig_liftPivot', (0.000, 0.074, 0.125), travel)
    rocker = P.rounded_box('lift_rocker', (0.040, 0.014, 0.054), (0, 0, 0),
                           M.button_red(), lift, radius=0.012, segments=6)
    R.tag_control(rocker, 'lift', 'Platform lift and lower rocker', 'vertical',
                  True, motion='vertical')
    horn = P.cyl('btn_horn', 0.014, 0.010, (0.042, 0.072, 0.045),
                 M.warning_amber(), travel, axis='Y', verts=28, bevel=0.003)
    R.tag_control(horn, 'horn', 'Horn button', 'button', True, motion='button')

    # Lower storage pocket and branding molded into the operator wall.
    P.rounded_box('storage_cavity', (0.37, 0.022, 0.19), (0, 0.067, 0.625),
                  dark, platform, radius=0.028)
    P.rounded_box('storage_lip', (0.39, 0.055, 0.045), (0, 0.101, 0.545),
                  molded, platform, radius=0.015)
    P.text_mesh('console_brand', 'RAYMOND', 0.044, 0.0018, M.decal_white(),
                platform, loc=(0.285, 0.069, 0.765), facing='+Y')


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
    mesh_grid('back_mesh', 0.80, 1.10, platform, (0, -0.185, 1.20),
              bar=0.005, nx=12, nz=8)
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
    # Station sits at the POWER-UNIT end, not the fork end. The operator drives
    # facing the power unit and turns to pick, so the controls are behind them
    # while they work the pallet -- the same topology as the Crown SP.
    # Unrotated here so the pods face the power unit rather than the forks.
    console_root = R.empty('console_root', (0, -0.25, 0.05), platform)
    console(console_root)
    presence = P.pedal('pedal_presence', (0.21, 0.24), parent=platform,
                       loc=(0.18, 0.10, 0.305), angle=0)
    R.tag_control(presence, 'presence', 'Single operator presence pedal',
                  'pedal', False, motion='pedal')
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
    # XR remains floor referenced so the headset supplies the actual operator
    # height. The desktop eye uses a representative 1.55 m standing eye height
    # above the platform instead of the earlier upper-percentile 1.63 m value.
    R.empty('rig_xrOrigin', (0, -0.85, 0.29), carriage)
    R.empty('rig_cameraMount', (0, -0.85, 1.84), carriage)
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
        'cab_view': {'loc': (0.0, 0.05, 1.84), 'target': (0.0, 0.58, 1.06), 'focal': 20},
        'closeups': {
            'console': {'loc': (0.45, 0.03, 1.52), 'target': (0.0, 0.58, 1.04), 'focal': 32},
            'platform': {'loc': (1.6, 1.8, 1.0), 'target': (0.0, 0.2, 0.8), 'focal': 33},
        },
    }
