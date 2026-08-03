"""Crown SP 1500 man-up order picker (Class II).

Spec anchors (m): overall width ~1.016, mast rails ~2.9 lowered, platform floor
0.28 lowered, overhead guard rides ON the platform (posts from the back guard),
forks protrude +Y from under the platform between fixed baselegs.

Layout along Y (forks +Y): ivory power unit at rear (-1.55..-0.60), black mast
mid-truck (center -0.42), operator platform on the mast front (floor -0.18..0.62)
with the console on its mast side — the operator faces -Y over the console, the
board's signature safety-orange gate loops flank the platform sides.

Rig: rig_root > rig_mast > rig_carriage (global (0, 0.9, 0)) which carries
rig_platform (floor/gates/guard/console), the forks, and rig_cameraMount at
carriage-local (0, -0.6, 2.25) so the operator eye rises with the platform.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from lib import materials as M
from lib import parts as P
from lib import rig as R

IVORY = M.crown_ivory
BLACK = M.frame_black
ORANGE = M.safety_orange

CARRIAGE_Y = 0.9          # global rest position of rig_carriage
MAST_Y = -0.42            # global mast centerline
FLOOR_Z = 0.28            # platform floor height, lowered


def rounded_rect(w, h, r_bottom, r_top, z0=0.0, n=4):
    """Closed rounded-rectangle pts (x, z), CCW, for loft sections."""
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
    """Wire-mesh back guard: one mesh of thin vertical + horizontal bars."""
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


# ------------------------------------------------------------------ power unit
def power_unit(root):
    ivory = IVORY()
    sections = []
    for y, w, h, rt, z0 in ((-1.54, 0.88, 0.86, 0.20, 0.18),
                            (-1.46, 0.98, 0.95, 0.17, 0.16),
                            (-1.15, 1.00, 0.98, 0.14, 0.15),
                            (-0.78, 1.00, 0.99, 0.12, 0.14),
                            (-0.62, 0.96, 0.97, 0.14, 0.15)):
        sections.append((y, rounded_rect(w, h, 0.05, rt, z0=z0)))
    P.loft_shell('pu_shell', sections, ivory, root, subsurf=1)
    # charcoal molded top cap + service lid seam
    P.rounded_box('pu_topcap', (0.82, 0.76, 0.05), (0, -1.08, 1.145), M.plastic_molded(), root, radius=0.018)
    P.box('pu_lid_seam', (0.9, 0.006, 0.006), (0, -0.66, 1.1), M.plastic_dark(), root, bevel=0.002)
    P.box('pu_rear_seam', (0.78, 0.006, 0.006), (0, -1.548, 0.56), M.plastic_dark(), root, bevel=0.002)
    # black lower skirt / bumper
    P.rounded_box('pu_skirt', (1.0, 0.97, 0.18), (0, -1.08, 0.125), M.plastic_dark(), root, radius=0.045)
    # branding: CROWN + SP flag both sides, CROWN on the rear face
    for sx, face in ((1, '+X'), (-1, '-X')):
        P.text_mesh(f'logo_side_{face[0]}{face[1]}', 'CROWN', 0.075, 0.002, M.decal_dark(), root,
                    loc=(sx * 0.503, -1.02, 0.93), facing=face)
        P.text_mesh(f'logo_sp_{face[0]}{face[1]}', 'SP', 0.048, 0.002, M.decal_dark(), root,
                    loc=(sx * 0.503, -1.13, 0.82), facing=face)
        P.box(f'logo_chev_{face[0]}{face[1]}', (0.005, 0.05, 0.032), (sx * 0.503, -1.06, 0.82),
              ORANGE(), root, bevel=0.002)
    P.text_mesh('logo_rear', 'CROWN', 0.07, 0.002, M.decal_dark(), root,
                loc=(0, -1.552, 0.88), facing='-Y')
    P.label('pu_capacity', (0.14, 0.09), M.warning_amber(), root, (0.503, -0.78, 0.62),
            rot=(0, 0, math.pi / 2))
    P.label('pu_data', (0.12, 0.08), M.decal_white(), root, (-0.503, -0.78, 0.62),
            rot=(0, 0, -math.pi / 2))
    # drive wheel + steer casters under the skirt
    P.wheel_poly('rig_driveWheel', 0.16, 0.14, M.rubber_tire(), root, loc=(0, -1.12, 0.16))
    for i, sx in enumerate((-1, 1)):
        P.wheel_poly(f'pu_caster_{i}', 0.05, 0.06, parent=root, loc=(sx * 0.33, -0.72, 0.05), hub=False)


# ------------------------------------------------------- baselegs + load wheels
def baselegs(root):
    for index, sx in enumerate((-1, 1)):
        x = sx * 0.42
        P.extrude_profile(f'leg_{index}',
                          [(-0.055, 0.0), (0.055, 0.0), (0.055, 0.15), (-0.055, 0.15)],
                          1.27, BLACK(), root, plane='XZ', bevel=0.01, loc=(x, -0.55, 0.0))
        P.loft_shell(f'leg_tip_{index}',
                     [(0.72, [(x - 0.055, 0.015), (x + 0.055, 0.015), (x + 0.055, 0.15), (x - 0.055, 0.15)]),
                      (0.88, [(x - 0.045, 0.02), (x + 0.045, 0.02), (x + 0.045, 0.1), (x - 0.045, 0.1)])],
                     BLACK(), root, subsurf=0, bevel=0.008)
        P.wheel_poly(f'rig_loadWheel_{index}', 0.0635, 0.08, parent=root,
                     loc=(x, 0.795, 0.0635), hub=False)
        P.label(f'leg_stripe_{index}', (0.26, 0.04), ORANGE(), root,
                (x + sx * 0.056, 0.28, 0.075), rot=(0, 0, sx * math.pi / 2))


# ------------------------------------------------------------------------ mast
def mast(root):
    node = R.empty('rig_mast', (0, MAST_Y, 0), root)
    steel = M.mast_steel()
    for side in (-1, 1):
        tag = 'L' if side < 0 else 'R'
        P.c_channel(f'mast_rail_s0_{tag}', 2.9, web=0.16, flange=0.06, mat=steel,
                    parent=node, loc=(side * 0.44, 0.0, 0.04), open_toward=-side)
        P.c_channel(f'mast_rail_s1_{tag}', 2.78, web=0.13, flange=0.055, mat=steel,
                    parent=node, loc=(side * 0.35, 0.055, 0.08), open_toward=-side)
    for z, sz in ((0.2, 0.12), (1.5, 0.1), (2.78, 0.1)):
        P.box(f'mast_tie_{int(z * 100)}', (0.82, 0.05, sz), (0, -0.01, z), steel, node, bevel=0.006)
    # chunky rounded head bar on the inner stage
    P.rounded_box('mast_head', (0.72, 0.18, 0.16), (0, 0.055, 2.80), BLACK(), node, radius=0.03)
    # center lift cylinder
    P.lathe('mast_cyl_body', [(0.0, 0), (0.052, 0), (0.052, 1.45), (0.045, 1.47),
                              (0.045, 1.52), (0.0, 1.52)], BLACK(), node, loc=(0, 0.0, 0.1))
    P.cyl('mast_cyl_rod', 0.03, 1.0, (0, 0.0, 2.1), M.chrome_rod(), node)
    # lift chains + pulleys on the mast front face
    for side in (-1, 1):
        tag = 'L' if side < 0 else 'R'
        P.chain_strip(f'mast_chain_{tag}', 2.2, parent=node, loc=(side * 0.26, 0.11, 0.3))
        P.cyl(f'mast_pulley_{tag}', 0.055, 0.03, (side * 0.26, 0.09, 2.62), M.steel_dark(), node, axis='X')
    # mast base gearbox filling down to the frame
    P.box('mast_base', (0.84, 0.3, 0.26), (0, -0.03, 0.14), BLACK(), node, bevel=0.01)
    # cable reel box on the right rail + hose run
    P.rounded_box('mast_reel', (0.14, 0.12, 0.22), (0.5, 0.08, 2.42), M.plastic_dark(), node, radius=0.02)
    P.tube('mast_hose', [(0.5, 0.1, 2.3), (0.53, 0.15, 1.85), (0.5, 0.11, 1.15)], 0.012,
           M.grip_rubber(), node, corner_radius=0.1)
    P.tube('mast_hose2', [(-0.5, 0.02, 0.35), (-0.52, 0.06, 1.6), (-0.5, 0.05, 2.3)], 0.01,
           M.grip_rubber(), node, corner_radius=0.1)
    P.label('mast_marker', (0.05, 0.16), M.warning_amber(), node, (-0.475, 0.0, 2.55),
            rot=(0, 0, -math.pi / 2))
    return node


# ------------------------------------------------- carriage: platform + guard
def console(platform):
    molded = M.plastic_molded()
    dark = M.plastic_dark()
    P.rounded_box('console_body', (0.76, 0.22, 0.42), (0, -0.07, 1.10), molded, platform, radius=0.05)
    # twin round control pods facing the operator (+Y)
    for sx, tag in ((-1, 'L'), (1, 'R')):
        P.lathe(f'console_pod_{tag}', [(0.0, 0), (0.1, 0.004), (0.11, 0.028), (0.095, 0.05), (0.0, 0.056)],
                dark, platform, loc=(sx * 0.20, 0.03, 1.10), rot=(-math.pi / 2, 0, 0))
    # left pod: steering with grab loop
    steer = R.empty('rig_steerPivot', (-0.20, 0.09, 1.10), platform)
    disc = P.lathe('steer_disc', [(0.0, 0), (0.075, 0.004), (0.082, 0.02), (0.058, 0.036), (0.0, 0.04)],
                   M.grip_rubber(), steer, rot=(-math.pi / 2, 0, 0))
    R.tag_control(disc, 'steer', 'Steer palm wheel', 'horizontal', False)
    P.tube('steer_loop', [(-0.05, 0.005, -0.005), (-0.05, 0.075, 0.045), (0.0, 0.1, 0.07),
                          (0.05, 0.075, 0.045), (0.05, 0.005, -0.005)], 0.013,
           M.steel_dark(), steer, corner_radius=0.05)
    # right pod: travel twist grip + lift rocker
    travel = R.empty('rig_travelPivot', (0.20, 0.09, 1.10), platform)
    grip = P.cyl('travel_grip', 0.024, 0.13, (0.01, 0.02, 0), M.grip_rubber(), travel, axis='X', bevel=0.006)
    R.tag_control(grip, 'travel', 'Travel twist grip', 'vertical', True)
    P.lathe('travel_hub', [(0.0, 0), (0.03, 0.004), (0.034, 0.03), (0.0, 0.036)],
            dark, travel, loc=(-0.065, 0.02, 0), rot=(0, math.pi / 2, 0))
    lift = R.empty('rig_liftPivot', (0.315, 0.045, 1.06), platform)
    rocker = P.rounded_box('lift_rocker', (0.05, 0.042, 0.08), (0, 0, 0), ORANGE(), lift, radius=0.012)
    R.tag_control(rocker, 'lift', 'Platform lift rocker', 'vertical', True)
    # center cluster: display, horn, e-stop
    P.display('console_display', 0.13, 0.085, parent=platform, loc=(-0.02, 0.005, 1.27),
              rot=(-0.35, 0, math.pi), screen_name='screen_sp')
    horn = P.cyl('btn_horn', 0.026, 0.016, (0.065, 0.045, 1.03), M.warning_amber(), platform, axis='Y')
    R.tag_control(horn, 'horn', 'Horn button', 'button', True)
    P.lathe('btn_estop', [(0.0, 0), (0.018, 0), (0.018, 0.02), (0.027, 0.024), (0.027, 0.042), (0.0, 0.048)],
            M.button_red(), platform, loc=(-0.065, 0.045, 1.03), rot=(-math.pi / 2, 0, 0))
    for i in range(2):
        P.rounded_box(f'console_sw_{i}', (0.035, 0.02, 0.022), (0.10 + i * 0.05, 0.035, 1.27),
                      dark, platform, radius=0.005)
    # stowage tray behind the console top
    P.rounded_box('console_tray', (0.5, 0.1, 0.06), (0, -0.20, 1.33), dark, platform, radius=0.015)
    P.label('console_warn', (0.09, 0.06), M.decal_white(), platform, (-0.30, 0.042, 1.02),
            rot=(0, 0, math.pi))


def platform_assembly(carriage):
    platform = R.empty('rig_platform', (0, -CARRIAGE_Y, 0), carriage)  # global (0,0,0)
    # rising base pan + rubber tread floor
    P.rounded_box('plat_base', (0.98, 0.8, 0.11), (0, 0.22, 0.225), M.plastic_dark(), platform, radius=0.03)
    P.tread_plate('plat_floor', (0.88, 0.68), M.floor_mat(), platform, (0, 0.24, 0.285), rib_axis='X')
    P.label('plat_edge', (0.4, 0.05), M.warning_amber(), platform, (0, 0.615, 0.24),
            rot=(0, 0, math.pi))
    P.text_mesh('plat_model', 'SP 1500', 0.035, 0.0018, M.decal_white(), platform,
                loc=(0.492, 0.25, 0.225), facing='+X')
    # guard posts from the platform, mesh screen toward the mast
    for sx in (-1, 1):
        P.rounded_box(f'guard_post_{int(sx > 0)}', (0.055, 0.07, 2.25), (sx * 0.40, -0.15, 1.315),
                      BLACK(), platform, radius=0.012)
    mesh_grid('back_mesh', 0.74, 0.85, platform, (0, -0.175, 1.42), nx=9, nz=4)
    P.rounded_box('back_panel', (0.74, 0.045, 0.62), (0, -0.14, 0.63), M.plastic_molded(), platform, radius=0.02)
    P.box('back_slot', (0.28, 0.055, 0.09), (0, -0.14, 0.52), M.plastic_dark(), platform, bevel=0.008)
    # orange entry grab rails flanking the console
    for sx in (-1, 1):
        P.tube(f'grab_rail_{int(sx > 0)}', [(sx * 0.42, -0.08, 0.35), (sx * 0.42, -0.08, 1.42)],
               0.016, ORANGE(), platform, corner_radius=0)
    # cantilevered roof (falling-object guard) riding the posts
    P.tube('roof_frame', [(-0.44, -0.28, 2.47), (-0.44, 0.56, 2.47), (0.44, 0.56, 2.47),
                          (0.44, -0.28, 2.47)], 0.037, BLACK(), platform, corner_radius=0.09, cyclic=True)
    for i, x in enumerate((-0.33, -0.11, 0.11, 0.33)):
        P.tube(f'roof_slat_{i}', [(x, -0.24, 2.49), (x, 0.52, 2.49)], 0.015, BLACK(), platform)
    P.tube('roof_cross', [(-0.4, 0.14, 2.485), (0.4, 0.14, 2.485)], 0.015, BLACK(), platform)
    for sx in (-1, 1):
        P.box(f'roof_bracket_{int(sx > 0)}', (0.05, 0.05, 0.09), (sx * 0.40, -0.15, 2.44),
              BLACK(), platform, bevel=0.008)
        P.tube(f'roof_brace_{int(sx > 0)}', [(sx * 0.40, -0.13, 2.36), (sx * 0.40, 0.24, 2.44)],
               0.018, BLACK(), platform, corner_radius=0)
    P.rounded_box('roof_badge', (0.46, 0.035, 0.075), (0, 0.565, 2.47), M.plastic_molded(), platform, radius=0.012)
    P.text_mesh('roof_logo', 'CROWN', 0.04, 0.0018, M.decal_white(), platform,
                loc=(0, 0.585, 2.47), facing='+Y')
    # safety-orange side gates (rig-animated: flip up around X at the rear hinge)
    for i, sx in enumerate((-1, 1)):
        gate = R.empty(f'rig_gate_{i}', (sx * 0.465, -0.06, 1.12), platform)
        P.tube(f'gate_loop_{i}', [(0, 0.03, 0), (0, 0.62, 0), (0, 0.62, -0.34), (0, 0.03, -0.34)],
               0.016, ORANGE(), gate, corner_radius=0.05, cyclic=True)
        P.tube(f'gate_mid_{i}', [(0, 0.33, -0.015), (0, 0.33, -0.325)], 0.011, ORANGE(), gate,
               corner_radius=0)
        P.box(f'gate_hinge_{i}', (0.03, 0.05, 0.1), (0, 0.01, -0.02), BLACK(), gate, bevel=0.006)
    # The operator stands at the rear of the platform with their back to the
    # mesh guard. console() is authored for an operator on its +Y side, so the
    # head is carried to the front rail and turned to face back at them; the
    # half-turn puts the controls between the operator and the console body.
    console_root = R.empty('console_root', (0, 0.58, 0.28), platform)
    console_root.rotation_euler = (0, 0, math.pi)
    console(console_root)
    # operator presence deadman pedal on the floor
    presence = P.pedal('pedal_presence', (0.15, 0.18), parent=platform, loc=(0.2, 0.1, 0.305), angle=0)
    R.tag_control(presence, 'presence', 'Presence deadman pedal', 'button', False)
    return platform


def carriage_assembly(mast_node):
    carriage = R.empty('rig_carriage', (0, CARRIAGE_Y - MAST_Y, 0), mast_node)  # global (0, 0.9, 0)
    # carriage plate riding the mast front, behind the mesh guard
    P.box('carr_plate', (0.62, 0.05, 1.4), (0, -CARRIAGE_Y - 0.25, 0.8), BLACK(), carriage, bevel=0.008)
    for zi, z in enumerate((0.25, 1.35)):
        for sx in (-1, 1):
            P.cyl(f'carr_roller_{zi}_{int(sx > 0)}', 0.045, 0.05,
                  (sx * 0.33, -CARRIAGE_Y - 0.28, z), M.steel_dark(), carriage, axis='X')
    # fork hanger crossbar under the platform + forks out the front
    P.box('fork_bar', (0.68, 0.07, 0.13), (0, -CARRIAGE_Y - 0.1, 0.11), BLACK(), carriage, bevel=0.008)
    P.fork_pair(carriage, spread=0.55, length=1.1, z=0.005, name='forks')
    for f in ('forks_L', 'forks_R'):
        obj = bpy.data.objects[f]
        obj.location.y = -CARRIAGE_Y - 0.14
    platform_assembly(carriage)
    # Standing eye: 0.29 m platform floor + 1.63 m, at the rear of the platform
    # (platform-local y = 0.05) so the control head reads in the lower view.
    R.empty('rig_cameraMount', (0, -0.85, 1.92), carriage)
    return carriage


def build():
    root = R.empty('rig_root')
    power_unit(root)
    baselegs(root)
    mast_node = mast(root)
    carriage_assembly(mast_node)
    root['spec'] = 'Crown SP 1500 24V order picker'
    return {
        'name': 'crown_sp1500',
        'cab_view': {'loc': (0.0, 0.3, 2.25), 'target': (0.0, -0.85, 0.9), 'focal': 18},
        'closeups': {
            'console': {'loc': (0.42, 0.78, 1.65), 'target': (0.0, -0.02, 1.12), 'focal': 30},
            'platform': {'loc': (1.55, 1.75, 0.95), 'target': (0.0, 0.2, 0.75), 'focal': 33},
            'forks': {'loc': (0.95, 1.9, 0.4), 'target': (0.0, 0.35, 0.12), 'focal': 35},
            'masttop': {'loc': (1.7, 1.35, 2.65), 'target': (0.0, -0.35, 2.5), 'focal': 40},
        },
    }
