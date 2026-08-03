"""Raymond 8210 walkie pallet truck (Class III walk-behind).

Measured basis (8210 spec sheet + fleet reference board, column 3):
  overall width 0.77, fork length 1.22 (48 in), fork OD ~0.67, lowered fork top
  0.085, drive tire ~10 in -> r 0.127, load wheels ~3.25 in -> r 0.041,
  power unit shell top ~0.92, tiller head (rest, raised) ~1.38, backrest ~1.38.
Blender axes: forks +Y, operator -Y, up +Z. See lib/rig.py for the node contract.
Rig: rig_root, rig_carriage (forks + load wheels + apron + backrest),
  rig_tillerPivot (top rear of power unit) > rig_headGroup, rig_cameraMount.
"""
import math

from mathutils import Euler, Matrix

from lib import materials as M
from lib import parts as P
from lib import rig as R

RED = M.raymond_red
BLACK = M.frame_black

ARM_TILT = -0.744          # rest tilt of the tiller arm (on meshes, never empties)
ARM_LEN = 0.68
PIVOT = (0.0, -0.44, 0.92)  # world position of rig_tillerPivot
HEAD_LOCAL = (0.0, -0.50, 0.46)  # rig_headGroup local offset = arm dir * ARM_LEN


def fork_red():
    return M.pbr('raymond_fork_red', 0xA82521, roughness=0.5, metallic=0.0, clearcoat=0.15)


def alu():
    return M.pbr('alu_canister', 0xAEB2B4, roughness=0.32, metallic=0.9)


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


def vertical_text(name, text, size, mat, parent, loc, side):
    """Brand text reading top-to-bottom on a +X or -X face."""
    base = Euler(P.TEXT_FACING['+X' if side > 0 else '-X']).to_matrix()
    roll = Matrix.Rotation(-math.pi / 2, 3, 'Z')
    rot = (base @ roll).to_euler()
    return P.text_mesh(name, text, size, 0.0018, mat, parent, loc=loc, rot=rot)


# ------------------------------------------------------------------ power unit
def power_unit(root):
    # black wrap-around bumper skirt (protrudes past the shell at the rear)
    skirt = []
    for y, w, h in ((-0.665, 0.70, 0.15), (-0.63, 0.76, 0.16), (-0.40, 0.79, 0.165),
                    (-0.10, 0.79, 0.165), (-0.03, 0.75, 0.16)):
        skirt.append((y, rounded_rect(w, h, 0.045, 0.05, z0=0.03)))
    P.loft_shell('pu_skirt', skirt, M.plastic_dark(), root, subsurf=1)

    # bulbous red shell, domed shoulders, rounded rear
    shell = []
    for y, w, h, rb, rt, z0 in ((-0.615, 0.56, 0.50, 0.08, 0.14, 0.22),
                                (-0.58, 0.66, 0.62, 0.07, 0.16, 0.18),
                                (-0.48, 0.74, 0.72, 0.06, 0.17, 0.16),
                                (-0.30, 0.77, 0.775, 0.055, 0.18, 0.145),
                                (-0.12, 0.765, 0.785, 0.05, 0.17, 0.14),
                                (-0.035, 0.72, 0.76, 0.05, 0.14, 0.14)):
        shell.append((y, rounded_rect(w, h, rb, rt, z0=z0)))
    P.loft_shell('pu_shell', shell, RED(), root, subsurf=1)

    # charcoal molded top pad where the tiller mounts
    P.rounded_box('pu_topcap', (0.5, 0.44, 0.06), (0, -0.28, 0.925), M.plastic_molded(),
                  root, radius=0.024)
    P.box('pu_top_seam', (0.46, 0.005, 0.006), (0, -0.06, 0.90), M.plastic_dark(), root,
          bevel=0.002)

    # black corner trim strips flanking the battery box, RAYMOND runs vertically
    for sx in (-1, 1):
        P.rounded_box(f'pu_corner_{sx}', (0.10, 0.12, 0.78), (sx * 0.33, -0.03, 0.52),
                      M.plastic_dark(), root, radius=0.035)
        vertical_text(f'pu_brand_{sx}', 'RAYMOND', 0.052, M.decal_white(), root,
                      (sx * 0.385, -0.03, 0.52), sx)

    # louver vents low on the skirt (drive motor cooling)
    for sx in (-1, 1):
        P.box(f'pu_vent_{sx}', (0.014, 0.20, 0.12), (sx * 0.392, -0.16, 0.125),
              M.plastic_dark(), root, bevel=0.003)
        for i in range(4):
            P.box(f'pu_fin_{sx}_{i}', (0.012, 0.17, 0.013),
                  (sx * 0.399, -0.16, 0.085 + i * 0.028), M.steel_dark(), root, bevel=0.002)

    # flank label cluster + capacity plate
    for sx in (-1, 1):
        P.label(f'pu_label_{sx}', (0.15, 0.115), M.decal_white(), root,
                (sx * 0.373, -0.36, 0.70), rot=(math.pi / 2, 0, sx * math.pi / 2))
        P.label(f'pu_amber_{sx}', (0.15, 0.045), M.warning_amber(), root,
                (sx * 0.376, -0.36, 0.60), rot=(math.pi / 2, 0, sx * math.pi / 2))

    # rear branding
    P.text_mesh('pu_rear_brand', 'RAYMOND', 0.062, 0.0018, M.decal_white(), root,
                loc=(0, -0.622, 0.52), facing='-Y')
    P.text_mesh('pu_rear_model', '8210', 0.05, 0.0018, M.decal_dark(), root,
                loc=(0, -0.617, 0.40), facing='-Y')

    # drive wheel + stabilizer casters, mostly shrouded by the skirt
    P.wheel_poly('rig_driveWheel', 0.127, 0.10, M.rubber_tire(), root,
                 loc=(0, -0.33, 0.127))
    for i, sx in enumerate((-1, 1)):
        P.wheel_poly(f'pu_caster_{i}', 0.045, 0.05, parent=root,
                     loc=(sx * 0.30, -0.30, 0.045), hub=False)


# ----------------------------------------------------------------- battery box
def battery_box(root):
    P.rounded_box('bat_body', (0.71, 0.34, 0.70), (0, 0.145, 0.42), RED(), root, radius=0.03)
    P.rounded_box('bat_lid', (0.72, 0.35, 0.07), (0, 0.145, 0.80), M.plastic_molded(),
                  root, radius=0.025)
    P.box('bat_lid_scoop', (0.16, 0.05, 0.03), (0, 0.30, 0.80), M.plastic_dark(), root,
          bevel=0.008)
    P.box('bat_seam', (0.70, 0.005, 0.006), (0, -0.023, 0.60), M.plastic_dark(), root,
          bevel=0.002)
    for sx in (-1, 1):
        P.label(f'bat_amber_{sx}', (0.26, 0.04), M.warning_amber(), root,
                (sx * 0.356, 0.14, 0.15), rot=(math.pi / 2, 0, sx * math.pi / 2))
    P.label('bat_label_front', (0.30, 0.05), M.warning_amber(), root, (0, 0.318, 0.14),
            rot=(math.pi / 2, 0, math.pi))
    # silver canister accessory with red mushroom cap on the lid
    can = P.cyl('bat_canister', 0.052, 0.15, (0.17, 0.10, 0.91), alu(), root, bevel=0.006)
    P.lathe('bat_can_cap', [(0.0, 0), (0.026, 0.0), (0.03, 0.02), (0.02, 0.034), (0.0, 0.038)],
            M.button_red(), can, loc=(0, 0, 0.075))


# ------------------------------------------------- carriage: forks + backrest
def carriage_group(root):
    carriage = R.empty('rig_carriage', (0, 0, 0), root)
    red = fork_red()

    # pallet forks: side profile extruded across X, with load-wheel notch
    profile = [(0.0, 0.0), (0.0, 0.075), (1.05, 0.075), (1.19, 0.028), (1.215, 0.02),
               (1.22, 0.012), (1.22, 0.007), (1.09, 0.006), (1.09, 0.068),
               (0.83, 0.068), (0.83, 0.006), (0.0, 0.004)]
    for i, cx in enumerate((-0.245, 0.245)):
        P.extrude_profile(f'fork_{i}', profile, 0.18, red, carriage, plane='YZ',
                          bevel=0.005, loc=(cx - 0.09, 0.36, 0.01))
        # tandem load wheels + bogie link inside the notch
        for wi, wy in enumerate((1.26, 1.38)):
            P.wheel_poly(f'rig_loadWheel_{i * 2 + wi}', 0.041, 0.055, parent=carriage,
                         loc=(cx, wy, 0.041), hub=False)
        P.box(f'fork_bogie_{i}', (0.05, 0.15, 0.045), (cx, 1.32, 0.055),
              M.steel_dark(), carriage, bevel=0.005)

    # black apron the forks weld into (slides up the power unit face)
    P.rounded_box('apron', (0.70, 0.05, 0.50), (0, 0.34, 0.30), BLACK(), carriage,
                  radius=0.015)

    # load backrest: black tube loop + cross rail + vertical slats
    yb = 0.40
    P.tube('backrest_loop', [(-0.34, yb, 0.52), (-0.34, yb, 1.32), (0.34, yb, 1.32),
                             (0.34, yb, 0.52)], 0.018, BLACK(), carriage, corner_radius=0.09)
    P.box('backrest_rail', (0.66, 0.035, 0.05), (0, yb, 0.97), BLACK(), carriage, bevel=0.006)
    for i, x in enumerate((-0.24, -0.09, 0.09, 0.24)):
        P.box(f'backrest_slat_{i}', (0.035, 0.028, 0.33), (x, yb, 1.145), BLACK(),
              carriage, bevel=0.004)
    # work light on a stalk over the cross rail
    P.box('light_stalk', (0.028, 0.028, 0.14), (0.14, yb, 1.05), M.steel_dark(), carriage,
          bevel=0.004)
    lamp = P.cyl('light_body', 0.03, 0.06, (0.14, yb - 0.02, 1.13), M.plastic_dark(),
                 carriage, axis='Y', bevel=0.006)
    P.cyl('light_lens', 0.022, 0.006, (0, 0, -0.034), M.screen_glass(), lamp, axis='Z')
    return carriage


# ---------------------------------------------------------------- tiller + head
def tiller(root):
    pivot = R.empty('rig_tillerPivot', PIVOT, root)

    # cast pivot boss + rubber bellows boot at the arm base
    P.cyl('tiller_boss', 0.055, 0.17, (0, 0, 0), M.steel_dark(), pivot, axis='X', bevel=0.008)
    bellows = P.lathe('tiller_bellows',
                      [(0.0, 0.0), (0.052, 0.0), (0.044, 0.03), (0.056, 0.05),
                       (0.044, 0.07), (0.054, 0.09), (0.042, 0.11), (0.0, 0.12)],
                      M.grip_rubber(), pivot, loc=(0, -0.055, 0.05))
    bellows.rotation_euler = (0.827, 0, 0)

    # tall molded arm, built along -Y and tilted back on the mesh (not the empty)
    arm_secs = []
    for t, w, d, zc in ((0.04, 0.10, 0.16, 0.0), (-0.10, 0.092, 0.155, 0.008),
                        (-0.30, 0.085, 0.14, 0.018), (-0.50, 0.078, 0.125, 0.014),
                        (-0.66, 0.072, 0.115, 0.004), (-0.71, 0.068, 0.11, 0.0)):
        arm_secs.append((t, rounded_rect(w, d, 0.028, 0.028, z0=zc - d / 2)))
    arm = P.loft_shell('tiller_arm', arm_secs, M.plastic_dark(), pivot, subsurf=1)
    arm.rotation_euler = (ARM_TILT, 0, 0)

    head_grp = R.empty('rig_headGroup', HEAD_LOCAL, pivot)
    tiller_head(head_grp)
    return pivot


def tiller_head(head_grp):
    """Butterfly head: red cap, loop grips, throttle wings, rockers, belly button."""
    molded = M.plastic_molded()
    dark = M.plastic_dark()

    # main body carries the rest tilt; everything else is a child in its frame
    body = P.rounded_box('head_body', (0.16, 0.24, 0.13), (0, 0, 0), dark, head_grp,
                         radius=0.045)
    body.rotation_euler = (-0.62, 0, 0)
    R.tag_control(body, 'steer', 'Tiller head - steer', 'horizontal', False)

    # red bumper cap on the top, toward the truck
    P.rounded_box('head_cap', (0.155, 0.11, 0.062), (0, 0.075, 0.085), M.button_red(),
                  body, radius=0.026)

    # loop grips both sides (closed D-loops, grip rubber)
    for sx in (-1, 1):
        P.tube(f'head_loop_{ "L" if sx < 0 else "R"}',
               [(sx * 0.065, 0.075, 0.03), (sx * 0.20, 0.06, 0.01),
                (sx * 0.235, -0.03, -0.01), (sx * 0.16, -0.10, -0.015),
                (sx * 0.065, -0.075, 0.0)],
               0.020, M.grip_rubber(), body, corner_radius=0.05, cyclic=True)

    # butterfly throttle wings (both tagged travel)
    for sx in (-1, 1):
        wing = P.rounded_box(f'head_wing_{ "L" if sx < 0 else "R"}', (0.075, 0.05, 0.02),
                             (sx * 0.10, -0.065, 0.052), molded, body, radius=0.008)
        wing.rotation_euler = (-0.25, 0, sx * -0.18)
        R.tag_control(wing, 'travel', 'Butterfly throttle', 'horizontal', True)

    # face panel: display, lift/lower rockers, horn
    P.display('head_display', 0.085, 0.06, parent=body, loc=(0, -0.105, 0.026),
              rot=(math.pi / 2 - 0.25, 0, 0), screen_name='head_screen')
    for sx in (-1, 1):
        rocker = P.rounded_box(f'head_rocker_{ "L" if sx < 0 else "R"}',
                               (0.042, 0.022, 0.05), (sx * 0.052, -0.122, -0.032),
                               molded, body, radius=0.007)
        rocker.rotation_euler = (-0.25, 0, 0)
        R.tag_control(rocker, 'lift', 'Lift / lower rocker', 'vertical', True)
    horn = P.cyl('head_horn', 0.02, 0.014, (0, -0.125, -0.035), M.button_red(), body,
                 axis='Y')
    horn.rotation_euler = (math.pi / 2 - 0.25, 0, 0)
    R.tag_control(horn, 'horn', 'Horn button', 'button', True)

    # belly-button emergency reverse across the head's lower front
    belly = P.rounded_box('head_belly', (0.17, 0.10, 0.05), (0, -0.045, -0.098),
                          M.grip_rubber(), body, radius=0.02)
    belly.rotation_euler = (0.35, 0, 0)
    R.tag_control(belly, 'belly', 'Emergency reverse belly button', 'button', True)


# ------------------------------------------------------------------------ build
def build():
    root = R.empty('rig_root')
    power_unit(root)
    battery_box(root)
    carriage_group(root)
    tiller(root)
    # Walk-behind: the operator stands on the floor beside the tiller, so the
    # eye is a plain standing eye height above ground.
    cam = R.empty('rig_cameraMount', (0.34, -1.45, 1.64), root)
    cam.rotation_euler = (0, 0, -0.12)  # walk-beside stance (allowed on this empty)
    root['spec'] = 'Raymond 8210 walkie pallet truck 24V'
    return {
        'name': 'raymond_8210',
        'cab_view': {'loc': (0.34, -1.45, 1.57), 'target': (0.0, -0.2, 0.75), 'focal': 21},
        'closeups': {
            'head': {'loc': (0.5, -1.6, 1.6), 'target': (0.0, -0.94, 1.32), 'focal': 40},
            'forks': {'loc': (1.3, 2.3, 0.7), 'target': (0.0, 0.9, 0.25), 'focal': 35},
        },
    }
