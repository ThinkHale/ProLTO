"""Crown SP 1500 man-up order picker (Class II).

Spec anchors (m): overall width ~1.016, mast rails ~2.9 lowered, platform floor
0.28 lowered, overhead guard rides ON the platform (posts from the back guard),
forks protrude +Y from under the platform between fixed baselegs.

Layout along Y (forks +Y): ivory power unit at rear (-1.55..-0.60), black mast
mid-truck (center -0.42), operator platform on the mast front (floor -0.18..0.62)
with the console on its mast side. The operator faces -Y over the console, the
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
def console(platform, prefix, primary=False):
    """Build the exact 2025 SP left and right operator control pair."""
    molded = M.plastic_molded()
    inset = M.plastic_dark()
    control = M.grip_rubber()

    # Separate height-adjustable pedestals preserve the SP mid-platform view.
    for sx, side in ((-1, 'left'), (1, 'right')):
        P.rounded_box(f'{prefix}_pedestal_{side}', (0.31, 0.16, 0.82),
                      (sx * 0.245, 0.07, 0.54), molded, platform,
                      radius=0.045, segments=6, rot=(-0.035, 0, 0))
        P.rounded_box(f'{prefix}_pod_{side}', (0.36, 0.31, 0.095),
                      (sx * 0.245, -0.02, 0.96), inset, platform,
                      radius=0.075, segments=8)
    P.rounded_box(f'{prefix}_adjust_bar', (0.13, 0.12, 0.11),
                  (0, 0.08, 0.85), molded, platform, radius=0.025, segments=5)

    # Left pod: hand grip, steering disk, spinner, tilt release, and switches.
    P.tube(f'{prefix}_left_hand_grip',
           [(-0.40, 0.065, 0.93), (-0.42, -0.02, 0.99),
            (-0.39, -0.145, 1.00), (-0.34, -0.17, 0.95)],
           0.026, control, platform, corner_radius=0.055)
    steer_name = 'rig_steerPivot' if primary else f'{prefix}_steerPivot'
    steer = R.empty(steer_name, (-0.245, -0.035, 1.017), platform)
    P.cyl(f'{prefix}_steer_recess', 0.125, 0.018,
          (-0.245, -0.035, 1.005), M.plastic_molded(), platform,
          verts=56, bevel=0.003)
    disc = P.cyl(f'{prefix}_steer_disk', 0.108, 0.025, (0, 0, 0),
                 control, steer, verts=56, bevel=0.006)
    R.tag_control(disc, 'steer', 'SP dual-position steering wheel', 'radial',
                  False, motion='radial')
    P.cyl(f'{prefix}_steer_spinner', 0.033, 0.064, (-0.063, -0.055, 0.052),
          control, steer, verts=36, bevel=0.012)
    P.rounded_box(f'{prefix}_steer_tilt', (0.068, 0.032, 0.026),
                  (-0.245, -0.172, 1.02), ORANGE(), platform,
                  radius=0.009, segments=4)
    for index, x in enumerate((-0.325, -0.285, -0.245, -0.205, -0.165)):
        P.rounded_box(f'{prefix}_option_switch_{index}', (0.030, 0.052, 0.022),
                      (x, 0.085, 1.025), M.plastic_dark(), platform,
                      radius=0.005, segments=3)
    P.cyl(f'{prefix}_auto_position', 0.021, 0.014,
          (-0.378, 0.085, 1.025), ORANGE(), platform, verts=28, bevel=0.004)

    # Right pod: fixed grip with separate travel, horn and lift controls.
    P.tube(f'{prefix}_right_hand_grip',
           [(0.14, -0.13, 1.00), (0.18, -0.17, 1.02),
            (0.36, -0.17, 1.02), (0.41, -0.10, 0.99),
            (0.40, 0.005, 0.95)], 0.027, control, platform,
           corner_radius=0.07)
    travel_name = 'rig_travelPivot' if primary else f'{prefix}_travelPivot'
    travel = R.empty(travel_name, (0.16, -0.125, 1.02), platform)
    rocker = P.rounded_box(f'{prefix}_travel_rocker', (0.078, 0.068, 0.038),
                           (0, 0, 0), M.pbr(f'{prefix}_rocker_gray', 0xB5B7B4,
                                            roughness=0.52), travel,
                           radius=0.012, segments=4)
    R.tag_control(rocker, 'travel', 'Forward and reverse rocker', 'vertical',
                  True, motion='fore-aft')
    lift_name = 'rig_liftPivot' if primary else f'{prefix}_liftPivot'
    lift = R.empty(lift_name, (0.245, -0.148, 0.975), platform)
    paddle = P.rounded_box(f'{prefix}_raise_lower_paddle', (0.092, 0.065, 0.026),
                           (0, 0, 0), ORANGE(), lift, radius=0.012, segments=5)
    R.tag_control(paddle, 'lift', 'Orange raise and lower paddle', 'vertical',
                  True, motion='fore-aft')
    horn = P.rounded_box(f'{prefix}_horn', (0.045, 0.024, 0.026),
                         (0.12, -0.15, 0.99), M.warning_amber(), platform,
                         radius=0.009, segments=4)
    R.tag_control(horn, 'horn', 'Horn switch below hand grip', 'button', True,
                  motion='button')

    # Navigation options, key switch and the red mushroom disconnect.
    P.rounded_box(f'{prefix}_wire_guidance', (0.060, 0.060, 0.025),
                  (0.16, 0.085, 1.025), inset, platform, radius=0.009)
    P.rounded_box(f'{prefix}_override', (0.042, 0.055, 0.024),
                  (0.22, 0.092, 1.025), inset, platform, radius=0.007)
    P.cyl(f'{prefix}_nav_knob', 0.029, 0.034, (0.31, 0.082, 1.04),
          control, platform, verts=36, bevel=0.007)
    key_bezel = P.cyl(f'{prefix}_key_bezel', 0.018, 0.012,
                      (0.36, 0.035, 1.025), M.steel_dark(), platform,
                      verts=30, bevel=0.002)
    P.box(f'{prefix}_key', (0.009, 0.026, 0.022), (0, 0, 0.014),
          inset, key_bezel, bevel=0.003, rot=(0, 0, 0.35))
    stop_base = P.cyl(f'{prefix}_disconnect_base', 0.033, 0.018,
                      (0.415, 0.025, 1.03), M.warning_amber(), platform,
                      verts=36)
    P.cyl(f'{prefix}_disconnect', 0.027, 0.035, (0, 0, 0.025),
          M.button_red(), stop_base, verts=36, bevel=0.006)


def platform_assembly(carriage):
    platform = R.empty('rig_platform', (0, -CARRIAGE_Y, 0), carriage)  # global (0,0,0)
    # Deeper Op-Zone floor supports opposing power-unit and forks-facing sets.
    P.rounded_box('plat_base', (0.98, 1.08, 0.11), (0, 0.25, 0.225),
                  M.plastic_dark(), platform, radius=0.03)
    P.tread_plate('plat_floor', (0.88, 0.88), M.floor_mat(), platform,
                  (0, 0.25, 0.285), rib_axis='X')
    P.label('plat_edge', (0.4, 0.05), M.warning_amber(), platform, (0, 0.77, 0.24),
            rot=(0, 0, math.pi))
    P.text_mesh('plat_model', 'SP 1500', 0.035, 0.0018, M.decal_white(), platform,
                loc=(0.492, 0.25, 0.225), facing='+X')
    # guard posts from the platform, mesh screen toward the mast
    for sx in (-1, 1):
        P.rounded_box(f'guard_post_{int(sx > 0)}', (0.055, 0.07, 2.25), (sx * 0.40, -0.30, 1.315),
                      BLACK(), platform, radius=0.012)
    mesh_grid('back_mesh', 0.74, 0.85, platform, (0, -0.325, 1.42), nx=9, nz=4)
    P.rounded_box('back_panel', (0.74, 0.045, 0.62), (0, -0.29, 0.63),
                  M.plastic_molded(), platform, radius=0.02)
    P.box('back_slot', (0.28, 0.055, 0.09), (0, -0.29, 0.52),
          M.plastic_dark(), platform, bevel=0.008)
    # orange entry grab rails flanking the console
    for sx in (-1, 1):
        P.tube(f'grab_rail_{int(sx > 0)}', [(sx * 0.42, -0.23, 0.35), (sx * 0.42, -0.23, 1.42)],
               0.016, ORANGE(), platform, corner_radius=0)
    # cantilevered roof (falling-object guard) riding the posts
    P.tube('roof_frame', [(-0.44, -0.42, 2.47), (-0.44, 0.78, 2.47), (0.44, 0.78, 2.47),
                          (0.44, -0.42, 2.47)], 0.037, BLACK(), platform, corner_radius=0.09, cyclic=True)
    for i, x in enumerate((-0.33, -0.11, 0.11, 0.33)):
        P.tube(f'roof_slat_{i}', [(x, -0.38, 2.49), (x, 0.74, 2.49)], 0.015, BLACK(), platform)
    P.tube('roof_cross', [(-0.4, 0.18, 2.485), (0.4, 0.18, 2.485)], 0.015, BLACK(), platform)
    for sx in (-1, 1):
        P.box(f'roof_bracket_{int(sx > 0)}', (0.05, 0.05, 0.09), (sx * 0.40, -0.30, 2.44),
              BLACK(), platform, bevel=0.008)
        P.tube(f'roof_brace_{int(sx > 0)}', [(sx * 0.40, -0.28, 2.36), (sx * 0.40, 0.18, 2.44)],
               0.018, BLACK(), platform, corner_radius=0)
    P.rounded_box('roof_badge', (0.46, 0.035, 0.075), (0, 0.785, 2.47), M.plastic_molded(), platform, radius=0.012)
    P.text_mesh('roof_logo', 'CROWN', 0.04, 0.0018, M.decal_white(), platform,
                loc=(0, 0.805, 2.47), facing='+Y')
    # Gena display is suspended at eye level from the front overhead rail.
    P.display('display_sp', 0.28, 0.17, parent=platform,
              loc=(0.20, 0.73, 2.19), screen_name='screen_sp')
    P.tube('display_mount', [(0.20, 0.73, 2.28), (0.20, 0.73, 2.43)],
           0.018, BLACK(), platform, corner_radius=0)
    # safety-orange side gates (rig-animated: flip up around X at the rear hinge)
    for i, sx in enumerate((-1, 1)):
        gate = R.empty(f'rig_gate_{i}', (sx * 0.465, -0.22, 1.12), platform)
        P.tube(f'gate_loop_{i}', [(0, 0.03, 0), (0, 0.93, 0), (0, 0.93, -0.34), (0, 0.03, -0.34)],
               0.016, ORANGE(), gate, corner_radius=0.05, cyclic=True)
        P.tube(f'gate_mid_{i}', [(0, 0.48, -0.015), (0, 0.48, -0.325)], 0.011, ORANGE(), gate,
               corner_radius=0)
        P.box(f'gate_hinge_{i}', (0.03, 0.05, 0.1), (0, 0.01, -0.02), BLACK(), gate, bevel=0.006)
    # Opposing optional controls let the operator face either travel direction.
    forks_controls = R.empty('forks_facing_controls', (0, 0.72, 0.28), platform)
    console(forks_controls, 'forks', primary=True)
    power_controls = R.empty('power_unit_facing_controls', (0, -0.20, 0.28), platform)
    power_controls.rotation_euler = (0, 0, math.pi)
    console(power_controls, 'power', primary=False)

    # SP brake/deadman pedal: removing the foot applies the parking brake.
    presence = P.pedal('pedal_presence', (0.19, 0.22), parent=platform,
                       loc=(0.18, 0.24, 0.305), angle=0)
    R.tag_control(presence, 'presence', 'SP deadman brake pedal', 'button',
                  False, motion='button')
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
    # Eye and tracked-floor origins must remain separate. Both rise with the
    # man-up carriage, while headset tracking remains relative to the floor.
    R.empty('rig_cameraMount', (0, -0.65, 1.92), carriage)
    R.empty('rig_xrOrigin', (0, -0.65, 0.29), carriage)
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
