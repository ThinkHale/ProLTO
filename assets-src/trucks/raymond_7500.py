"""Raymond 7500 Universal Stance reach truck (Class II).

Measured basis (7500 series spec sheet, inches -> m):
  overall width 48 -> 1.219, outer straddle ~42 -> 1.07, guard ~95 -> 2.41,
  drive tire 13.5 -> 0.343, load wheels 5 -> 0.127, mast lowered ~3.5.
Board cues vs the Crown RR: boxier Raymond-red power unit with a stepped rear
profile, black battery mid-section, vertical RAYMOND wordmark on the rear side
panels, black mast/legs with faceted load-wheel housings + amber tandem wheels,
RED forks and carriage, universal-stance charcoal compartment: open flat floor,
corner console pod with a flat tiller wheel + single-axis multifunction handle,
instrument strip high on the power-unit wall under a mesh screen.
Blender axes: forks +Y, operator -Y, up +Z. See lib/rig.py for the contract.
"""
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from lib import materials as M
from lib import parts as P
from lib import rig as R

RED = M.raymond_red
BLACK = M.frame_black
CHAR = M.plastic_molded
DARK = M.plastic_dark


def amber_poly():
    return M.pbr('poly_amber_7500', 0x8A5B22, roughness=0.5, clearcoat=0.12)


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


def xz_rect(xc, w, z0, z1):
    return [(xc - w / 2, z0), (xc + w / 2, z0), (xc + w / 2, z1), (xc - w / 2, z1)]


def bar_cluster(name, bars, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.002):
    """Merge many thin boxes [(size, offset), ...] into ONE mesh (vents, grids,
    switch banks) to stay inside the object budget."""
    bm = bmesh.new()
    for size, offset in bars:
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1)
        bmesh.ops.scale(tmp, verts=tmp.verts, vec=Vector(size))
        bmesh.ops.translate(tmp, verts=tmp.verts, vec=Vector(offset))
        me_t = bpy.data.meshes.new('t')
        tmp.to_mesh(me_t)
        tmp.free()
        bm.from_mesh(me_t)
        bpy.data.meshes.remove(me_t)
    obj = P.mesh_from_bm(name, bm, mat, parent)
    obj.location = loc
    obj.rotation_euler = rot
    if bevel:
        P.add_bevel(obj, bevel)
    P.smooth_shade(obj)
    return obj


def vertical_text(name, text, side, loc, size, mat, parent):
    """RAYMOND wordmark reading top-to-bottom on a +X (side=1) or -X face."""
    base = Euler((math.pi / 2, 0, side * math.pi / 2), 'XYZ').to_matrix()
    rolled = Matrix.Rotation(-side * math.pi / 2, 3, 'X') @ base
    return P.text_mesh(name, text, size, 0.0022, mat, parent, loc=loc,
                       rot=rolled.to_euler())


# ------------------------------------------------------------------- frame/legs
def frame_and_legs(root):
    load_wheels = []
    profile = [(-0.15, 0.03), (1.62, 0.03), (1.62, 0.145), (1.10, 0.165),
               (0.88, 0.305), (-0.15, 0.305)]
    for index, sx in enumerate((-1, 1)):
        x0 = -0.535 if sx < 0 else 0.44
        xc = sx * 0.4875
        P.extrude_profile(f'leg_{index}', profile, 0.095, BLACK(), root,
                          plane='YZ', bevel=0.01, loc=(x0, 0, 0))
        # faceted load-wheel end housing (board: chunky chamfered nose caps)
        P.loft_shell(f'leg_housing_{index}',
                     [(1.56, xz_rect(xc, 0.105, 0.03, 0.20)),
                      (1.70, xz_rect(xc, 0.125, 0.045, 0.185)),
                      (1.82, xz_rect(xc, 0.125, 0.06, 0.165)),
                      (1.90, xz_rect(xc, 0.085, 0.10, 0.15))],
                     BLACK(), root, subsurf=0, bevel=0.01)
        for wi, wy in enumerate((1.60, 1.76)):
            wheel = P.wheel_poly(f'rig_loadWheel_{index * 2 + wi}', 0.0635, 0.082,
                                 amber_poly(), root, loc=(xc, wy, 0.0635), hub=False)
            load_wheels.append(wheel)
    P.box('baseplate', (1.02, 0.5, 0.13), (0, 0.42, 0.105), BLACK(), root, bevel=0.01)
    return load_wheels


# ------------------------------------------------------------------- power unit
def power_unit(root):
    red = RED()
    # main red shell: boxy, small corner radii, front rolls down toward the mast
    sections = []
    for y, w, h, z0, rt in ((-0.12, 1.10, 0.74, 0.58, 0.09),
                            (0.10, 1.10, 0.74, 0.58, 0.09),
                            (0.30, 1.10, 0.72, 0.58, 0.12),
                            (0.42, 1.06, 0.62, 0.60, 0.18),
                            (0.48, 0.96, 0.44, 0.66, 0.16)):
        sections.append((y, rounded_rect(w, h, 0.04, rt, z0=z0)))
    P.loft_shell('shell_main', sections, red, root, subsurf=1)
    # stepped rear panel section (slightly narrower + lower = visible seam)
    rear = []
    for y, w, h, z0 in ((-0.35, 1.06, 0.64, 0.62), (-0.30, 1.07, 0.66, 0.61),
                        (-0.12, 1.07, 0.66, 0.61), (-0.07, 1.03, 0.62, 0.62)):
        rear.append((y, rounded_rect(w, h, 0.04, 0.07, z0=z0)))
    P.loft_shell('shell_rear', rear, red, root, subsurf=1)
    # black battery mid-section with angled recess panels each side
    P.rounded_box('battery_box', (1.06, 0.78, 0.50), (0, 0.04, 0.40), CHAR(), root,
                  radius=0.025)
    for sx in (-1, 1):
        P.extrude_profile(f'battery_panel_{"L" if sx < 0 else "R"}',
                          [(-0.30, 0.26), (0.10, 0.26), (0.24, 0.40),
                           (0.24, 0.60), (-0.30, 0.60)],
                          0.016, DARK(), root, plane='YZ', bevel=0.004,
                          loc=(sx * 0.53 - (0.016 if sx < 0 else 0), 0, 0))
        # vent slits high on the rear panel
        bar_cluster(f'vents_{"L" if sx < 0 else "R"}',
                    [((0.008, 0.085, 0.012), (0, 0, i * 0.03)) for i in range(5)],
                    DARK(), root, loc=(sx * 0.528, -0.155, 1.06), bevel=0.0015)
        vertical_text(f'wordmark_{"L" if sx < 0 else "R"}', 'RAYMOND', sx,
                      (sx * 0.534, -0.215, 0.94), 0.058, M.decal_white(), root)
        P.text_mesh(f'decal_7500_{"L" if sx < 0 else "R"}', '7500', 0.048, 0.002,
                    M.decal_white(), root, loc=(sx * 0.552, 0.28, 1.18),
                    facing='+X' if sx > 0 else '-X')
    # black lower skirt around the drive end
    P.rounded_box('skirt_power', (1.16, 0.64, 0.13), (0, 0.16, 0.095), DARK(), root,
                  radius=0.03)
    P.label('label_capacity', (0.15, 0.11), M.warning_amber(), root,
            (0.30, 0.452, 0.82))


# ------------------------------------------------------------------ compartment
def compartment(root):
    char = CHAR()
    # rear cowl: boxier charcoal loft
    cowl = []
    for y, w, h, z0 in ((-1.17, 0.96, 0.90, 0.10), (-1.06, 1.09, 1.00, 0.09),
                        (-0.94, 1.12, 1.04, 0.08)):
        cowl.append((y, rounded_rect(w, h, 0.08, 0.10, z0=z0)))
    P.loft_shell('cowl_rear', cowl, char, root, subsurf=1)
    P.rounded_box('bumper_rear', (1.14, 0.40, 0.16), (0, -1.02, 0.11), DARK(), root,
                  radius=0.03)
    # side towers: left closed, right shorter for the entry
    P.rounded_box('tower_left', (0.10, 0.85, 1.13), (-0.51, -0.75, 0.80), char, root,
                  radius=0.04)
    P.rounded_box('tower_right', (0.10, 0.44, 1.13), (0.51, -0.98, 0.80), char, root,
                  radius=0.04)
    P.rounded_box('pad_right', (0.035, 0.34, 0.72), (0.455, -0.98, 0.85),
                  M.grip_rubber(), root, radius=0.015)
    P.rounded_box('pad_back', (0.46, 0.05, 0.42), (0, -0.93, 0.88),
                  M.grip_rubber(), root, radius=0.02)
    # open flat floor (universal stance)
    P.tread_plate('floor', (0.94, 0.66), M.floor_mat(), root, (0, -0.68, 0.235),
                  rib_axis='X', rib_gap=0.11)
    P.rounded_box('entry_sill', (0.12, 0.38, 0.05), (0.50, -0.56, 0.26), DARK(), root,
                  radius=0.012)
    # D-shaped grab handles both sides + vertical entry bar
    P.grab_bar('grab_left', [(-0.44, -0.62, 1.02), (-0.40, -0.68, 1.12),
                             (-0.40, -0.88, 1.12), (-0.44, -0.94, 1.02)], 0.016,
               DARK(), root)
    P.grab_bar('grab_right', [(0.44, -0.82, 1.00), (0.40, -0.88, 1.10),
                              (0.40, -1.02, 1.10), (0.44, -1.08, 1.00)], 0.016,
               DARK(), root)
    P.grab_bar('grab_entry', [(0.52, -0.80, 0.95), (0.52, -0.80, 1.9)], 0.018,
               DARK(), root)
    P.text_mesh('logo_rear', 'RAYMOND', 0.062, 0.002, M.decal_white(), root,
                loc=(0, -1.172, 0.74), facing='-Y')
    P.label('label_warn', (0.12, 0.16), M.warning_amber(), root,
            (-0.455, -0.75, 0.85), rot=(0, 0, -math.pi / 2))


# ---------------------------------------------------------------------- console
def console(root):
    char = CHAR()
    # corner console pod, flush against the power-unit wall
    P.rounded_box('pod_column', (0.28, 0.30, 0.36), (-0.31, -0.50, 0.80), char, root,
                  radius=0.06)
    P.rounded_box('pod_head', (0.34, 0.36, 0.18), (-0.31, -0.52, 0.99), char, root,
                  radius=0.07)
    P.rounded_box('pod_pedestal', (0.12, 0.14, 0.42), (-0.40, -0.44, 0.44), DARK(),
                  root, radius=0.03)
    P.box('corner_post', (0.07, 0.09, 1.25), (-0.46, -0.38, 0.86), BLACK(), root,
          bevel=0.008)
    # flat tiller steering wheel recessed in the pod top
    P.lathe('steer_cup', [(0.100, 0.0), (0.118, 0.0), (0.122, 0.012), (0.118, 0.040),
                          (0.104, 0.044), (0.100, 0.030)], char, root,
            loc=(-0.31, -0.49, 1.055))
    steer = R.empty('rig_steerPivot', (-0.31, -0.49, 1.095), root)
    wheel = P.steering_wheel('steer_wheel', 0.085, parent=steer, loc=(0, 0, 0))
    wheel.rotation_euler = (0.10, 0, 0)
    P.cyl('steer_spinner', 0.013, 0.05, (0.058, 0, 0.030), DARK(), wheel)
    R.tag_control(wheel, 'steer', 'Tiller steering wheel', 'horizontal', False)
    # single-axis multifunction handle with red head
    travel = R.empty('rig_travelPivot', (-0.155, -0.51, 1.03), root)
    P.lathe('mf_boot', [(0.0, 0), (0.045, 0), (0.05, 0.02), (0.032, 0.05),
                        (0.026, 0.08), (0.0, 0.08)], M.grip_rubber(), travel,
            loc=(0, 0, -0.01))
    shaft = P.cyl('mf_shaft', 0.015, 0.16, (0, 0, 0.07), DARK(), travel)
    shaft.rotation_euler = (0, 0.22, 0)
    head = P.lathe('mf_head', [(0.0, 0), (0.030, 0.003), (0.040, 0.025),
                               (0.044, 0.075), (0.034, 0.115), (0.016, 0.13),
                               (0.0, 0.132)], M.button_red(), shaft, loc=(0, 0, 0.065))
    R.tag_control(head, 'travel', 'Multifunction control handle', 'vertical', True)
    lift = R.empty('rig_liftPivot', (-0.235, -0.44, 1.08), root)
    rocker = P.rounded_box('mf_lift', (0.055, 0.06, 0.032), (0, 0, 0), M.button_red(),
                           lift, radius=0.012)
    R.tag_control(rocker, 'lift', 'Lift / lower rocker', 'vertical', True)
    reach_p = R.empty('rig_reachPivot', (-0.235, -0.565, 1.08), root)
    rocker2 = P.rounded_box('mf_reach', (0.055, 0.055, 0.030), (0, 0, 0),
                            M.pbr('rocker_dark', 0x3A3D40, 0.45), reach_p, radius=0.01)
    R.tag_control(rocker2, 'reach', 'Reach / retract rocker', 'horizontal', True)
    horn = P.cyl('btn_horn', 0.024, 0.016, (-0.385, -0.44, 1.09), M.button_red(), root)
    R.tag_control(horn, 'horn', 'Horn button', 'button', True)
    # instrument strip high on the power-unit wall, under the mesh screen
    P.rounded_box('cap_strip', (1.04, 0.12, 0.06), (0, -0.31, 1.285), CHAR(), root,
                  radius=0.02)
    P.rounded_box('panel_instr', (0.72, 0.05, 0.17), (0, -0.365, 1.43), DARK(), root,
                  radius=0.02, rot=(-0.42, 0, 0))
    P.display('display_ray', 0.17, 0.115, parent=root, loc=(0.20, -0.40, 1.445),
              rot=(-0.42, 0, 0), screen_name='screen_ray')
    estop_base = P.cyl('estop_base', 0.020, 0.026, (-0.26, -0.405, 1.45),
                       M.pbr('estop_yellow', 0xC8A20A, 0.45), root,
                       rot=(math.pi / 2 - 0.42, 0, 0))
    P.cyl('estop_cap', 0.026, 0.018, (0, 0, 0.02), M.button_red(), estop_base)
    bar_cluster('switch_bank',
                [((0.018, 0.02, 0.030), (i * 0.045 - 0.065, 0, 0)) for i in range(4)],
                DARK(), root, loc=(-0.05, -0.398, 1.425), rot=(-0.42, 0, 0))
    # Battery / mast screen: one merged grid mesh. It sits forward against the
    # power-unit wall rather than at the console, so the operator looks through
    # it at a working distance instead of having it up against their face.
    grid = [((0.010, 0.010, 0.72), (i * 0.15 - 0.45, 0, 1.66)) for i in range(7)]
    grid += [((0.90, 0.010, 0.012), (0, 0, z)) for z in (1.36, 1.66, 1.96)]
    bar_cluster('mast_screen', grid, M.steel_dark(), root, loc=(0, -0.02, 0),
                bevel=0.0015)
    # pedals on the open floor
    brake = P.pedal('pedal_brake', (0.16, 0.14), parent=root, loc=(-0.20, -0.52, 0.262),
                    angle=-0.22)
    R.tag_control(brake, 'brake', 'Brake pedal', 'pedal', True)
    presence = P.pedal('pedal_presence', (0.30, 0.22), parent=root,
                       loc=(0.16, -0.70, 0.252), angle=0)
    R.tag_control(presence, 'presence', 'Operator presence pedal', 'button', False)


# --------------------------------------------------------------- mast and reach
def mast_and_reach(root):
    mast = R.empty('rig_mast', (0, 0.60, 0), root)
    P.mast_assembly(mast, height=3.5, stages=2, outer_width=0.86, cylinder_center=True)
    for sx in (-1, 1):
        P.tube(f'hose_{"L" if sx < 0 else "R"}',
               [(sx * 0.09, 0.10, 0.18), (sx * 0.09, 0.12, 1.5),
                (sx * 0.07, 0.10, 2.6), (sx * 0.05, 0.06, 3.1)],
               0.011, M.grip_rubber(), mast)
    P.label('label_mast', (0.10, 0.14), M.warning_amber(), mast,
            (0.435, 0.0, 1.5), rot=(0, 0, math.pi / 2))
    carriage = R.empty('rig_carriage', (0, -0.06, 0.06), mast)
    reach_grp = R.empty('rig_reachGroup', (0, 0, 0), carriage)
    # pantograph scissor
    for sx in (-1, 1):
        arm1 = P.box(f'panto_a_{sx}', (0.045, 0.5, 0.06), (sx * 0.33, 0.1, 0.42),
                     BLACK(), reach_grp, bevel=0.008)
        arm1.rotation_euler = (0.75, 0, 0)
        arm2 = P.box(f'panto_b_{sx}', (0.045, 0.5, 0.06), (sx * 0.33, 0.1, 0.24),
                     BLACK(), reach_grp, bevel=0.008)
        arm2.rotation_euler = (-0.75, 0, 0)
        P.cyl(f'panto_pin_{sx}', 0.03, 0.06, (sx * 0.33, 0.1, 0.33), M.steel_dark(),
              reach_grp, axis='X')
    # RED fork carriage: two crossbars + side plates + red forks (board cue)
    red = RED()
    P.box('carriage_bar_top', (0.92, 0.05, 0.13), (0, 0.31, 0.52), red, reach_grp,
          bevel=0.008)
    P.box('carriage_bar_low', (0.92, 0.04, 0.09), (0, 0.31, 0.18), red, reach_grp,
          bevel=0.008)
    for sx in (-1, 1):
        P.box(f'carriage_plate_{"L" if sx < 0 else "R"}', (0.05, 0.06, 0.55),
              (sx * 0.44, 0.31, 0.35), red, reach_grp, bevel=0.006)
    P.fork_pair(reach_grp, spread=0.56, length=1.07, mat=red, z=0.06)
    for side in (-1, 1):
        f = bpy.data.objects.get(f'forks_{"L" if side < 0 else "R"}')
        if f is not None:
            f.location.y = 0.34
    return mast, carriage, reach_grp


# -------------------------------------------------------------- guard and drive
def guard_and_drive(root):
    P.overhead_guard(root, width=0.98, depth=1.04, height=2.41, y_center=-0.55,
                     rake=0.05, slat_count=7)
    drive = P.wheel_poly('rig_driveWheel', 0.1715, 0.15, M.rubber_tire(), root,
                         loc=(0.16, -0.16, 0.1715))
    P.wheel_poly('caster', 0.075, 0.08, parent=root, loc=(-0.30, -0.70, 0.075),
                 hub=False)
    return drive


def build():
    root = R.empty('rig_root')
    frame_and_legs(root)
    power_unit(root)
    compartment(root)
    console(root)
    mast_and_reach(root)
    guard_and_drive(root)
    # Standing eye: 0.235 m compartment floor + 1.63 m standing eye height.
    R.empty('rig_cameraMount', (0.02, -0.67, 1.87), root)
    root['spec'] = 'Raymond 7500 Universal Stance 36V'
    return {
        'name': 'raymond_7500',
        'cab_view': {'loc': (0.02, -0.67, 1.68), 'target': (-0.06, 0.3, 0.98),
                     'focal': 19},
        'closeups': {
            'console': {'loc': (0.75, -1.05, 1.45), 'target': (-0.30, -0.50, 1.02),
                        'focal': 28},
            'forks': {'loc': (1.9, 2.5, 1.05), 'target': (0, 0.8, 0.5), 'focal': 38},
        },
    }
