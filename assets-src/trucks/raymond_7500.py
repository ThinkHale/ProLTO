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
    P.loft_shell('shell_rear', rear, CHAR(), root, subsurf=1)
    # The operator does not face a red wall. The battery cover and forward
    # sight-line surface are charcoal, with Raymond red visible only as the
    # painted perimeter and side bodywork.
    P.rounded_box('battery_top_cover', (1.01, 0.65, 0.075), (0, 0.17, 1.29),
                  CHAR(), root, radius=0.045, segments=7)
    P.rounded_box('battery_operator_cover', (1.02, 0.10, 0.47),
                  (0, -0.265, 1.02), CHAR(), root, radius=0.04, segments=6)
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
    """Photo-matched 7500 Universal Stance compartment controls.

    Reference configuration: the current 7000 Series Universal Stance publicity
    compartment with integrated display, primary single-axis control handle and
    optional secondary handle. Operator is at -Y, looking toward +Y.
    """
    molded = M.pbr('ray_console_charcoal', 0x292C2E, roughness=0.62)
    inset = M.pbr('ray_console_inset', 0x17191B, roughness=0.68)
    control = M.pbr('ray_control_black', 0x0E1012, roughness=0.5)
    legend = M.decal_white()

    # The real 7500 has one broad, asymmetric molded hood. Its left lobe wraps
    # around the steering disc, the center rises around the display and the
    # right lobe forms a deep pocket for the control handle.
    plan = [(-0.52, -0.58), (-0.48, -0.22), (-0.42, -0.08), (-0.12, -0.06),
            (0.06, -0.10), (0.22, -0.07), (0.44, -0.10), (0.52, -0.22),
            (0.52, -0.62), (0.39, -0.67), (0.26, -0.58), (0.12, -0.53),
            (-0.08, -0.51), (-0.22, -0.58), (-0.39, -0.66)]
    P.extrude_profile('console_hood', plan, 0.18, molded, root, plane='XY',
                      bevel=0.035, loc=(0, 0, 0.96))
    P.rounded_box('console_front_wall', (1.01, 0.12, 0.58), (0, -0.13, 0.76),
                  molded, root, radius=0.07, segments=6)
    # Raised center bridge and sculpted knee bulge visible in the official
    # overhead image. These prevent the dashboard from reading as a flat slab.
    P.rounded_box('console_center_bridge', (0.30, 0.40, 0.24), (0.05, -0.30, 1.05),
                  molded, root, radius=0.07, segments=7, rot=(-0.05, 0, 0))
    P.rounded_box('console_knee_bulge', (0.30, 0.16, 0.48), (0.04, -0.48, 0.79),
                  molded, root, radius=0.09, segments=7)

    # Large flush steering disc and spinner. This is the defining Raymond
    # control silhouette, not a conventional wheel or a Crown-style tiller.
    P.lathe('steer_recess', [(0.0, 0), (0.145, 0), (0.155, 0.018),
                             (0.155, 0.035), (0.0, 0.035)], inset, root,
            loc=(-0.31, -0.38, 1.145))
    steer = R.empty('rig_steerPivot', (-0.31, -0.38, 1.18), root)
    disc = P.lathe('steer_disc', [(0.0, 0), (0.126, 0), (0.135, 0.012),
                                  (0.132, 0.025), (0.0, 0.025)], control, steer)
    R.tag_control(disc, 'steer', 'Raymond steering disc', 'radial', False,
                  motion='radial')
    P.cyl('steer_hub', 0.014, 0.012, (0, 0, 0.026), M.steel_dark(), steer,
          verts=24, bevel=0.002)
    spinner = P.cyl('steer_spinner', 0.018, 0.072, (0.085, 0.035, 0.062),
                    control, steer, verts=32, bevel=0.008)
    spinner.rotation_euler = (-0.10, 0, 0)
    P.text_mesh('steer_brand', 'RAYMOND', 0.014, 0.001, M.decal_dark(), steer,
                loc=(0, 0, 0.031), facing='+Z')

    # Integrated center display is flush to the sloped hood and ringed by a
    # printed status band. The runtime replaces only screen_ray with telemetry.
    P.rounded_box('display_recess', (0.265, 0.19, 0.025), (0.05, -0.29, 1.165),
                  inset, root, radius=0.025, segments=6, rot=(0, 0, 0))
    screen = P.rounded_box('screen_ray', (0.185, 0.115, 0.008), (0.04, -0.29, 1.184),
                           M.screen_glass(), root, radius=0.012, segments=5)
    P.text_mesh('display_brand', 'RAYMOND', 0.016, 0.001, legend, root,
                loc=(0.04, -0.365, 1.191), facing='+Z')
    # Status lamps and membrane keys copied as separate readable hard points.
    for index, x in enumerate((-0.055, -0.02, 0.015, 0.05, 0.085, 0.12)):
        P.cyl(f'display_lamp_{index}', 0.006, 0.004, (x, -0.21, 1.193),
              M.pbr(f'ray_lamp_{index}', 0xB7C4B1 if index > 1 else 0xC48A22,
                    roughness=0.32, emission=0x6B7A68, emission_strength=0.5),
              root, verts=18)
    for index, x in enumerate((0.155, 0.19)):
        P.cyl(f'display_key_{index}', 0.011, 0.005, (x, -0.30, 1.19), control,
              root, verts=24, bevel=0.002)

    # Primary control handle in a deep right-side pocket. The handle body is
    # fixed. A separate travel paddle is the single-axis travel mechanism.
    P.rounded_box('handle_pocket', (0.22, 0.28, 0.07), (0.37, -0.43, 1.125),
                  inset, root, radius=0.055, segments=7)
    handle_root = R.empty('primary_handle_root', (0.37, -0.43, 1.14), root)
    P.lathe('handle_boot', [(0.0, 0), (0.05, 0), (0.055, 0.018),
                            (0.036, 0.055), (0.024, 0.075), (0.0, 0.075)],
            M.grip_rubber(), handle_root)
    # One pose frame carries the grip and every thumb control. Previously the
    # grip alone was raked while its controls stayed upright, which made the
    # buttons cut through the shell whenever the handle moved.
    handle_pose = R.empty('primary_handle_pose', (0, 0, 0), handle_root)
    handle_pose.rotation_euler = (-0.18, 0.16, -0.04)
    handle_outline = [(-0.031, 0.0), (0.031, 0.0), (0.045, 0.034),
                      (0.042, 0.132), (0.024, 0.184), (-0.018, 0.192),
                      (-0.045, 0.142), (-0.047, 0.045)]
    handle = P.loft_shell('primary_handle', [(-0.032, handle_outline),
                                              (0.032, handle_outline)],
                          control, handle_pose, subsurf=1, bevel=0.005)
    P.rounded_box('handle_thumb_rest', (0.074, 0.048, 0.036),
                  (0.019, -0.043, 0.154), control, handle_pose, radius=0.018,
                  segments=6)
    travel = R.empty('rig_travelPivot', (0.032, -0.068, 0.164), handle_pose)
    travel_paddle = P.rounded_box('handle_travel_paddle', (0.026, 0.012, 0.052),
                                  (0, 0, 0), M.pbr('ray_paddle_gray', 0x606568,
                                                   roughness=0.5), travel,
                                  radius=0.011, segments=6)
    # The 7000 Series brochure calls this a "single-axis control handle" with
    # "discrete, intuitively mapped controls". That is the deliberate opposite
    # of Crown: every function gets its own dedicated actuator on a FIXED grip,
    # instead of being multiplexed onto one thumb ball behind a shift switch.
    # Keeping that contrast intact is the whole point of training on both.
    R.tag_control(travel_paddle, 'travel', 'Travel direction and speed paddle',
                  'fore-aft', True, motion='fore-aft', detents=1)
    lift = R.empty('rig_liftPivot', (-0.004, -0.067, 0.176), handle_pose)
    lift_btn = P.rounded_box('handle_lift', (0.025, 0.012, 0.046), (0, 0, 0),
                             M.pbr('ray_button_gray', 0x555A5D, roughness=0.5),
                             lift, radius=0.010, segments=6)
    R.tag_control(lift_btn, 'lift', 'Lift and lower thumb control', 'vertical',
                  True, motion='vertical', detents=1)
    reach_p = R.empty('rig_reachPivot', (-0.030, -0.066, 0.138), handle_pose)
    reach_btn = P.rounded_box('handle_reach', (0.027, 0.012, 0.036), (0, 0, 0),
                              M.pbr('ray_button_black', 0x2F3335, roughness=0.5),
                              reach_p, radius=0.010, segments=6)
    # Reach and retract read as a fore-aft thumb push on the real handle.
    R.tag_control(reach_btn, 'reach', 'Reach and retract thumb control',
                  'fore-aft', True, motion='fore-aft', detents=1)
    tilt_p = R.empty('rig_tiltPivot', (0.027, -0.066, 0.119), handle_pose)
    tilt_btn = P.rounded_box('handle_tilt', (0.026, 0.012, 0.034), (0, 0, 0),
                             M.pbr('ray_button_dark', 0x45494C, roughness=0.5),
                             tilt_p, radius=0.009, segments=6)
    R.tag_control(tilt_btn, 'tilt', 'Tilt thumb control', 'vertical', True,
                  motion='vertical', detents=1)
    # Discrete sideshift rocker. The previous model had no sideshift control at
    # all, so the truck advertised an attachment the operator could not reach.
    shift_p = R.empty('rig_sideshiftPivot', (-0.004, -0.066, 0.101), handle_pose)
    shift_btn = P.rounded_box('handle_sideshift', (0.030, 0.012, 0.030), (0, 0, 0),
                              M.pbr('ray_button_blue', 0x35505E, roughness=0.5),
                              shift_p, radius=0.009, segments=6)
    R.tag_control(shift_btn, 'sideshift', 'Sideshift thumb control', 'horizontal',
                  True, motion='horizontal', detents=1)
    horn = P.cyl('btn_horn', 0.012, 0.010, (0.027, -0.067, 0.078),
                 M.button_red(), handle_pose, axis='Y', verts=28, bevel=0.003)
    R.tag_control(horn, 'horn', 'Horn button', 'button', True, motion='button')

    # Exact right-side key and red emergency disconnect hard points.
    key_bezel = P.cyl('key_bezel', 0.018, 0.012, (0.455, -0.31, 1.18),
                      M.steel_dark(), root, verts=30, bevel=0.002)
    P.box('key', (0.010, 0.030, 0.025), (0, 0, 0.016), control, key_bezel,
          bevel=0.003, rot=(0, 0, 0.35))
    estop_base = P.cyl('estop_base', 0.025, 0.014, (0.465, -0.145, 1.18),
                       M.pbr('estop_yellow', 0xC8A20A, roughness=0.45), root,
                       verts=30)
    P.cyl('estop_cap', 0.032, 0.024, (0, 0, 0.02), M.button_red(), estop_base,
          verts=32, bevel=0.004)

    # Optional secondary control handle shown in Raymond's Universal Stance
    # reference configuration. It sits in a molded right rear pocket.
    P.rounded_box('secondary_pocket', (0.15, 0.30, 0.07), (0.405, -0.90, 0.82),
                  inset, root, radius=0.055, segments=7, rot=(0, 0, -0.04))
    # This handle exists so the operator can travel tractor-first while facing
    # the direction of travel, which is the entire premise of Universal Stance.
    # It was previously dead geometry, so the truck's headline feature had no
    # control behind it. Its paddle is a real travel control on its own pivot.
    secondary_pivot = R.empty('rig_secondaryTravelPivot', (0.405, -0.90, 0.86), root)
    secondary = P.cyl('secondary_handle', 0.032, 0.20, (0, 0, 0),
                      control, secondary_pivot, axis='Y', verts=40, bevel=0.012,
                      rot=(math.pi / 2, 0, -0.16))
    P.cyl('secondary_end', 0.039, 0.05, (0, 0, 0.09), control, secondary,
          verts=32, bevel=0.009)
    secondary_paddle = P.rounded_box('secondary_travel_paddle', (0.024, 0.011, 0.046),
                                     (0.030, -0.052, 0.020),
                                     M.pbr('ray_paddle_gray', 0x606568, roughness=0.5),
                                     secondary_pivot, radius=0.010, segments=6)
    R.tag_control(secondary_paddle, 'travel', 'Secondary handle travel paddle',
                  'fore-aft', True, motion='fore-aft', detents=1)
    secondary_horn = P.cyl('secondary_horn', 0.011, 0.009, (0.030, -0.052, -0.028),
                           M.button_red(), secondary_pivot, axis='Y', verts=24,
                           bevel=0.002)
    R.tag_control(secondary_horn, 'horn', 'Secondary handle horn', 'button', True,
                  motion='button')

    # Universal Stance uses ONE low-profile deadman pedal with a padded rubber
    # mat (7000 Series brochure). Unlike the Crown, there is no separate brake
    # pedal: releasing this pedal both drops operator presence and brakes.
    deadman = P.pedal('pedal_presence', (0.14, 0.22), parent=root,
                      loc=(-0.17, -0.72, 0.263), angle=-0.10)
    R.tag_control(deadman, 'presence', 'Single deadman pedal', 'pedal', False)


# --------------------------------------------------------------- mast and reach
def mast_and_reach(root):
    mast = R.empty('rig_mast', (0, 0.60, 0), root)
    # Raymond's open-view mast deliberately removes the center cylinder from
    # the operator sight line. Hydraulic cylinders and hose runs live outboard.
    P.mast_assembly(mast, height=3.5, stages=2, outer_width=0.96, cylinder_center=False)
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
    # XR stays floor referenced, so the headset supplies each operator's true
    # eye height. The desktop mount uses a representative 1.55 m standing eye
    # height above the compartment floor for a neutral training sightline.
    R.empty('rig_xrOrigin', (0.02, -0.98, 0.235), root)
    R.empty('rig_cameraMount', (0.02, -0.98, 1.785), root)
    root['spec'] = 'Raymond 7500 Universal Stance 36V'
    return {
        'name': 'raymond_7500',
        'cab_view': {'loc': (0.02, -0.98, 1.785), 'target': (0.0, -0.18, 1.05),
                     'focal': 22},
        'closeups': {
            'console': {'loc': (0.75, -1.05, 1.45), 'target': (-0.30, -0.50, 1.02),
                        'focal': 28},
            'forks': {'loc': (1.9, 2.5, 1.05), 'target': (0, 0.8, 0.5), 'focal': 38},
        },
    }
