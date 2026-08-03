"""Crown RR 5725-45 narrow-aisle reach truck.

Measured basis (RR 5700 spec sheet, inches -> m):
  overall width 48 -> 1.219, outer straddle 42 -> 1.067, head length 58 -> 1.474,
  floor height 9.4 -> 0.239, guard height ~95 -> 2.41, drive tire ~13.5 -> 0.343,
  load wheels 5 -> 0.127, mast lowered ~134 -> 3.4 (TT210 class).
Blender axes: forks +Y, operator -Y, up +Z. See lib/rig.py for the node contract.
"""
import math

from lib import materials as M
from lib import parts as P
from lib import rig as R

IVORY = M.crown_ivory
BLACK = M.frame_black
ORANGE = M.safety_orange


def rounded_rect(w, h, r_bottom, r_top, z0=0.0, n=4):
    """Closed rounded-rectangle pts (x, z), CCW, for loft sections."""
    pts = []

    def corner(cx, cz, radius, a0, a1):
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            pts.append((cx + radius * math.cos(a), cz + radius * math.sin(a)))

    corner(w / 2 - r_bottom, z0 + r_bottom, r_bottom, -math.pi / 2, 0)          # bottom right
    corner(w / 2 - r_top, z0 + h - r_top, r_top, 0, math.pi / 2)                # top right
    corner(-w / 2 + r_top, z0 + h - r_top, r_top, math.pi / 2, math.pi)         # top left
    corner(-w / 2 + r_bottom, z0 + r_bottom, r_bottom, math.pi, 1.5 * math.pi)  # bottom left
    return pts


def power_shell(root):
    """Battery/power section between the compartment and the mast."""
    sections = []
    for y, w, h, rt in ((-0.24, 1.06, 1.18, 0.16), (-0.1, 1.08, 1.21, 0.17),
                        (0.18, 1.08, 1.22, 0.17), (0.44, 1.04, 1.18, 0.2),
                        (0.52, 0.98, 1.1, 0.24)):
        sections.append((y, rounded_rect(w, h, 0.05, rt, z0=0.1)))
    P.loft_shell('shell_battery', sections, IVORY(), root, subsurf=1)
    # charcoal top cap with rounded edges + battery lid seam
    P.rounded_box('shell_topcap', (0.94, 0.68, 0.05), (0, 0.12, 1.24), M.plastic_molded(), root, radius=0.02)
    P.box('shell_lid_seam', (0.9, 0.005, 0.006), (0, -0.02, 1.23), M.plastic_dark(), root, bevel=0.002)
    # black lower skirt wrapping the drive end
    P.rounded_box('skirt_front', (1.14, 0.75, 0.16), (0, 0.14, 0.1), M.plastic_dark(), root, radius=0.04)
    P.label('label_capacity', (0.16, 0.1), M.warning_amber(), root, (0.44, -0.235, 0.9),
            rot=(math.pi / 2, 0, 0))


def compartment(root):
    """Side-stance operator compartment at the rear."""
    ivory = IVORY()
    pads = M.plastic_molded()
    # rear cowl — lofted so the back is softly rounded like the real cover
    sections = []
    for y, w, h in ((-1.02, 0.9, 0.98), (-0.98, 1.02, 1.03), (-0.9, 1.06, 1.05)):
        sections.append((y, rounded_rect(w, h, 0.07, 0.12, z0=0.08)))
    P.loft_shell('cowl_rear', sections, ivory, root, subsurf=1)
    # side towers: left closed, right lower for the entry opening
    P.rounded_box('tower_left', (0.11, 0.82, 1.28), (-0.5, -0.6, 0.72), ivory, root, radius=0.045)
    P.rounded_box('tower_left_pad', (0.03, 0.66, 0.9), (-0.44, -0.6, 0.82), pads, root, radius=0.015)
    P.rounded_box('tower_right', (0.11, 0.5, 1.28), (0.5, -0.78, 0.72), ivory, root, radius=0.045)
    P.rounded_box('tower_right_pad', (0.03, 0.38, 0.85), (0.44, -0.78, 0.8), pads, root, radius=0.015)
    # entry step edge + floor
    P.tread_plate('floor', (0.92, 0.66), M.floor_mat(), root, (0, -0.58, 0.24), rib_axis='X')
    P.rounded_box('entry_sill', (0.16, 0.3, 0.05), (0.48, -0.45, 0.245), M.plastic_dark(), root, radius=0.012)
    # rear face: logo + orange chevron accent
    P.text_mesh('logo_rear', 'CROWN', 0.085, 0.002, M.decal_dark(), root,
                loc=(0, -1.078, 0.78), facing='-Y')
    P.rounded_box('accent_rear', (0.84, 0.05, 0.1), (0, -1.045, 0.32), ORANGE(), root, radius=0.02)
    # interior back pad the operator leans on
    P.rounded_box('back_pad', (0.5, 0.06, 0.5), (0, -0.94, 1.0), M.grip_rubber(), root, radius=0.03)
    P.grab_bar('grab_entry', [(0.5, -0.98, 1.3), (0.5, -0.98, 1.9)], 0.019, ORANGE(), root)


def console(root):
    """Front console: display + palm-steer left, Multi-Task handle right."""
    molded = M.plastic_molded()
    face = P.rounded_box('console_body', (0.98, 0.3, 0.3), (0, -0.28, 1.06), molded, root, radius=0.06)
    face.rotation_euler = (0.14, 0, 0)
    P.display('display_crown', 0.19, 0.13, parent=root, loc=(-0.14, -0.4, 1.24),
              rot=(0.32, 0, 0), screen_name='screen_crown')

    steer = R.empty('rig_steerPivot', (-0.35, -0.36, 1.1), root)
    P.lathe('steer_base', [(0.0, 0), (0.065, 0), (0.07, 0.05), (0.05, 0.08), (0.0, 0.09)],
            molded, steer)
    palm = P.lathe('steer_palm', [(0.0, 0.0), (0.085, 0.004), (0.095, 0.02), (0.075, 0.05),
                                  (0.028, 0.062), (0.0, 0.062)], M.grip_rubber(), steer,
                   loc=(0, 0, 0.07))
    P.lathe('steer_knob', [(0.0, 0), (0.017, 0.004), (0.02, 0.028), (0.0, 0.036)],
            M.plastic_dark(), palm, loc=(0.05, 0, 0.055))
    R.tag_control(palm, 'steer', 'Crown palm steering tiller', 'horizontal', False)

    travel = R.empty('rig_travelPivot', (0.37, -0.36, 1.08), root)
    P.rounded_box('armrest', (0.26, 0.34, 0.09), (0, -0.05, -0.02), M.grip_rubber(), travel, radius=0.035)
    grip = P.lathe('mt_grip', [(0.0, 0), (0.045, 0.004), (0.05, 0.05), (0.042, 0.1),
                               (0.048, 0.16), (0.028, 0.2), (0.0, 0.21)],
                   M.plastic_dark(), travel, loc=(0.02, 0.08, 0.02))
    grip.rotation_euler = (-0.35, 0, 0)
    R.tag_control(grip, 'travel', 'Crown Multi-Task Control Handle', 'vertical', True)
    lift = R.empty('rig_liftPivot', (0.02, 0.14, 0.16), travel)
    rocker = P.rounded_box('mt_lift', (0.05, 0.06, 0.03), (0, 0, 0), ORANGE(), lift, radius=0.01)
    R.tag_control(rocker, 'lift', 'Lift / lower thumb wheel', 'vertical', True)
    reach_p = R.empty('rig_reachPivot', (0.07, 0.12, 0.13), travel)
    rocker2 = P.rounded_box('mt_reach', (0.04, 0.05, 0.025), (0, 0, 0), M.pbr('orange_dark', 0xB56A08, 0.42), reach_p, radius=0.008)
    R.tag_control(rocker2, 'reach', 'Reach / retract rocker', 'horizontal', True)
    tilt_p = R.empty('rig_tiltPivot', (-0.04, 0.13, 0.13), travel)
    rocker3 = P.rounded_box('mt_tilt', (0.04, 0.05, 0.025), (0, 0, 0), M.plastic_dark(), tilt_p, radius=0.008)
    R.tag_control(rocker3, 'tilt', 'Tilt rocker', 'horizontal', True)
    horn = P.cyl('btn_horn', 0.016, 0.012, (-0.09, 0.1, 0.045), M.warning_amber(), travel)
    R.tag_control(horn, 'horn', 'Horn button', 'button', True)

    brake = P.pedal('pedal_brake', (0.2, 0.16), parent=root, loc=(-0.24, -0.42, 0.27))
    R.tag_control(brake, 'brake', 'Left brake pedal', 'pedal', True)
    presence = P.pedal('pedal_presence', (0.3, 0.24), parent=root, loc=(0.2, -0.6, 0.265), angle=0)
    R.tag_control(presence, 'presence', 'Operator presence pedal', 'button', False)


def straddle_legs(root):
    load_wheels = []
    for index, sx in enumerate((-1, 1)):
        x = sx * 0.4785  # 42 in outer straddle, 0.11 leg width
        leg = P.extrude_profile(
            f'leg_{index}',
            [(-0.055, 0.0), (0.055, 0.0), (0.055, 0.28), (-0.055, 0.28)],
            1.42, BLACK(), root, plane='XZ', bevel=0.012, loc=(x, 0.22, 0.0))
        # tapered nose over the load wheels
        nose = P.loft_shell(f'leg_tip_{index}',
                            [(1.64, [(x - 0.055, 0.02), (x + 0.055, 0.02), (x + 0.055, 0.28), (x - 0.055, 0.28)]),
                             (1.84, [(x - 0.05, 0.02), (x + 0.05, 0.02), (x + 0.05, 0.1), (x - 0.05, 0.1)])],
                            BLACK(), root, subsurf=0, bevel=0.01)
        for wi, wy in enumerate((1.52, 1.72)):
            wheel = P.wheel_poly(f'rig_loadWheel_{index * 2 + wi}', 0.0635, 0.09,
                                 parent=root, loc=(x, wy, 0.0635), hub=False)
            load_wheels.append(wheel)
        P.label(f'leg_stripe_{index}', (0.3, 0.045), ORANGE(), root,
                (x + sx * 0.056, 1.05, 0.2), rot=(math.pi / 2, 0, sx * math.pi / 2))
    return load_wheels


def mast_and_reach(root):
    mast = R.empty('rig_mast', (0, 0.64, 0), root)
    P.mast_assembly(mast, height=3.4, stages=2, outer_width=0.98, cylinder_center=True)
    carriage = R.empty('rig_carriage', (0, -0.08, 0.05), mast)
    reach_grp = R.empty('rig_reachGroup', (0, 0, 0), carriage)
    # pantograph scissor
    for sx in (-1, 1):
        arm1 = P.box(f'panto_a_{sx}', (0.045, 0.5, 0.06), (sx * 0.36, 0.1, 0.42),
                     BLACK(), reach_grp, bevel=0.008)
        arm1.rotation_euler = (0.75, 0, 0)
        arm2 = P.box(f'panto_b_{sx}', (0.045, 0.5, 0.06), (sx * 0.36, 0.1, 0.24),
                     BLACK(), reach_grp, bevel=0.008)
        arm2.rotation_euler = (-0.75, 0, 0)
        P.cyl(f'panto_pin_{sx}', 0.03, 0.06, (sx * 0.36, 0.1, 0.33), M.steel_dark(), reach_grp, axis='X')
    # fork carriage plate + backrest + forks
    P.box('carriage_plate', (0.98, 0.05, 0.42), (0, 0.32, 0.4), BLACK(), reach_grp, bevel=0.006)
    P.load_backrest('backrest', 0.92, 1.15, parent=reach_grp, loc=(0, 0.36, 0.55))
    P.fork_pair(reach_grp, spread=0.55, length=1.07, z=0.05)
    return mast, carriage, reach_grp


def guard_and_drive(root):
    P.overhead_guard(root, width=1.0, depth=1.0, height=2.41, y_center=-0.5,
                     rake=0.06, slat_count=5)
    drive = P.wheel_poly('rig_driveWheel', 0.1715, 0.14, M.rubber_tire(), root,
                         loc=(0.16, -0.6, 0.1715))
    P.wheel_poly('caster', 0.0635, 0.08, parent=root, loc=(-0.34, -0.62, 0.0635), hub=False)
    return drive


def build():
    root = R.empty('rig_root')
    power_shell(root)
    compartment(root)
    console(root)
    load_wheels = straddle_legs(root)
    mast_and_reach(root)
    guard_and_drive(root)
    # Standing eye: 0.246 m compartment floor + 1.63 m standing eye height.
    R.empty('rig_cameraMount', (0.03, -0.69, 1.88), root)
    root['spec'] = 'Crown RR 5725-45 36V'
    return {
        'name': 'crown_rr5725',
        'cab_view': {'loc': (0.03, -0.69, 1.67), 'target': (0.0, 0.6, 0.85), 'focal': 19},
        'closeups': {
            'console': {'loc': (0.55, -1.3, 1.6), 'target': (0.0, -0.3, 1.05), 'focal': 32},
            'mast': {'loc': (1.6, 2.6, 1.2), 'target': (0, 0.64, 1.4), 'focal': 40},
        },
    }
