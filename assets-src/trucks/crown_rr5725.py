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
    # rear cowl, lofted so the back is softly rounded like the real cover
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
    # Full wraparound lean pad. The RR manual shows a broad center cushion with
    # tall side bolsters, not the small rectangular pad used by the first pass.
    P.rounded_box('back_pad', (0.62, 0.075, 0.63), (0, -0.955, 1.03), M.grip_rubber(), root, radius=0.075, segments=6)
    P.rounded_box('back_pad_L', (0.17, 0.18, 0.72), (-0.39, -0.88, 1.0), M.grip_rubber(), root, radius=0.065, segments=6, rot=(0.04, 0, -0.05))
    P.rounded_box('back_pad_R', (0.17, 0.18, 0.72), (0.39, -0.88, 1.0), M.grip_rubber(), root, radius=0.065, segments=6, rot=(0.04, 0, 0.05))
    # Molded lower knee/hip pad visible when the operator turns tractor-first.
    P.rounded_box('lower_hip_pad', (0.7, 0.12, 0.22), (0, -0.91, 0.59), M.plastic_molded(), root, radius=0.06, segments=5)
    P.grab_bar('grab_entry', [(0.5, -0.98, 1.3), (0.5, -0.98, 1.9)], 0.019, ORANGE(), root)


def console(root):
    """Photo-matched RR 5700 operator console.

    Visual contract: Crown RR 5700 operator manual pp. 9-10 and Crown's
    rr5700-precise-control.jpg. Operator is at -Y, looking toward +Y.
    """
    molded = M.plastic_molded()
    charcoal = M.pbr('rr_console_charcoal', 0x242629, roughness=0.58)
    medium = M.pbr('rr_control_gray', 0x55585A, roughness=0.68)
    switch_black = M.pbr('rr_switch_black', 0x101214, roughness=0.5)

    # The real cockpit-facing surface is a tall sculpted black wall. It hides
    # the ivory battery lid from the operator and rises into an arched binnacle.
    dash_outline = [(-0.49, 0.85), (0.49, 0.85), (0.49, 1.27), (0.45, 1.39),
                    (0.33, 1.48), (0.15, 1.52), (-0.15, 1.52), (-0.33, 1.48),
                    (-0.45, 1.39), (-0.49, 1.27)]
    dash = P.extrude_profile('console_body', dash_outline, 0.24, charcoal, root,
                             plane='XZ', bevel=0.035, loc=(0, -0.36, 0))
    P.rounded_box('console_lower', (0.88, 0.16, 0.3), (0, -0.31, 0.83), molded, root,
                  radius=0.07, segments=6)
    # Shallow Crown-gold reveal around the top, visible in the official photo.
    P.tube('console_reveal', [(-0.39, -0.372, 1.39), (-0.27, -0.375, 1.47),
                              (0.21, -0.375, 1.47), (0.34, -0.372, 1.39)],
           0.004, ORANGE(), root, resolution=8, corner_radius=0.02)

    # Instrument cluster is a shallow arched insert molded into the dash. It is
    # not the raised rectangular tablet used by the previous pass.
    cluster_outline = [(-0.29, 1.29), (0.24, 1.29), (0.235, 1.41),
                       (0.20, 1.47), (0.10, 1.495), (-0.18, 1.495),
                       (-0.26, 1.46), (-0.30, 1.39)]
    P.extrude_profile('cluster_bezel', cluster_outline, 0.026, M.plastic_dark(),
                      root, plane='XZ', bevel=0.018, loc=(0, -0.405, 0))
    P.display('display_crown', 0.18, 0.075, parent=root, loc=(-0.08, -0.435, 1.40),
              rot=(0.03, 0, 0), screen_name='screen_crown')
    for index in range(4):
        # The manual plate shows four compact appliance-size rockers. Keeping
        # them below 45 mm wide prevents the switch bank from reading as four
        # oversized blocks or crossing the edge of the cluster recess.
        x = -0.12 + index * 0.055
        sw = P.rounded_box(f'dash_switch_{index}', (0.043, 0.027, 0.058),
                           (x, -0.377, 1.238), switch_black, root, radius=0.009, segments=5,
                           rot=(0.08, 0, 0))
        P.box(f'dash_switch_mark_{index}', (0.018, 0.004, 0.004), (0, -0.016, 0.013),
              M.decal_white(), sw, bevel=0.001)
    for index, z in enumerate((1.43, 1.385, 1.34)):
        P.cyl(f'cluster_status_{index}', 0.006, 0.007, (0.205, -0.407, z),
              (M.warning_amber() if index == 0 else M.button_red()), root, axis='Y', verts=20)
    for index, (x, z) in enumerate(((0.12, 1.435), (0.16, 1.405), (0.16, 1.355), (0.12, 1.325))):
        P.cyl(f'cluster_key_{index}', 0.01, 0.007, (x, -0.41, z), medium, root, axis='Y', verts=20)
    P.text_mesh('cluster_brand', 'CROWN', 0.013, 0.001, M.decal_white(), root,
                loc=(0.10, -0.438, 1.462), facing='-Y')

    # Left palm steering pod. Its large soft-gray oval and thumb nub dominate
    # the left half of the operator photograph.
    steer = R.empty('rig_steerPivot', (-0.33, -0.415, 1.06), root)
    P.rounded_box('steer_pedestal', (0.17, 0.12, 0.19), (0, 0.025, 0.075),
                  charcoal, steer, radius=0.055, segments=7, rot=(0.05, 0, 0))
    palm_outline = [(-0.115, 0.0), (0.07, 0.0), (0.12, 0.045),
                    (0.11, 0.145), (0.055, 0.205), (-0.07, 0.205),
                    (-0.12, 0.15), (-0.135, 0.055)]
    palm = P.loft_shell('steer_palm', [(-0.055, palm_outline),
                                       (0.055, palm_outline)], medium, steer,
                        subsurf=1, bevel=0.005)
    palm.rotation_euler = (0.05, 0, -0.02)
    P.lathe('steer_knob', [(0.0, 0), (0.025, 0.004), (0.031, 0.035),
                            (0.022, 0.07), (0.0, 0.075)],
            M.grip_rubber(), steer, loc=(0.07, -0.01, 0.20))
    R.tag_control(palm, 'steer', 'Crown palm steering tiller', 'horizontal',
                  False, motion='radial')

    # Right orange Multi-Task Control Handle, reconstructed as a tapered molded
    # shell with black grip insert and separate thumb controls.
    # Pull the complete handle toward the operator. The earlier pivot placed
    # its grip center inside the console extrusion, which caused visible
    # clipping as the handle rocked fore and aft.
    # Operator manual PF18340-F pages 24, 30 and 32 define the mechanism, and
    # the earlier model got it wrong. The Multi-Task handle is ONE part the
    # operator moves on TWO axes, and its hydraulic functions live on a thumb
    # BALL, not on separate rockers:
    #
    #   handle pushed away / pulled back  -> travel forks-first / power-unit-first
    #   handle lifted up  / pushed down   -> raise / lower              (page 30)
    #   thumb ball rolled up / down       -> tilt fork tips up / down   (page 32)
    #   thumb ball rolled away / toward   -> reach / retract            (page 33)
    #   back switch held + ball away/toward -> sideshift left / right   (page 33)
    #
    # So rig_liftPivot nests inside rig_travelPivot and carries the whole grip,
    # and rig_reachPivot nests inside rig_tiltPivot and carries the one ball.
    travel = R.empty('rig_travelPivot', (0.34, -0.465, 1.02), root)
    P.rounded_box('mt_armrest', (0.23, 0.25, 0.085), (0, -0.015, -0.005),
                  M.grip_rubber(), travel, radius=0.04, segments=6, rot=(-0.08, 0, 0))
    # Lift rides on the handle body itself, so it pivots about the same base.
    lift = R.empty('rig_liftPivot', (0, 0, 0), travel)
    handle_pts = [(-0.055, 0.0), (0.04, 0.0), (0.072, 0.045), (0.06, 0.15),
                  (0.025, 0.22), (-0.035, 0.22), (-0.07, 0.15), (-0.075, 0.045)]
    grip = P.loft_shell('mt_grip', [(-0.12, handle_pts), (-0.025, handle_pts)],
                         ORANGE(), lift, subsurf=1, bevel=0.006)
    grip.rotation_euler = (-0.2, 0, -0.08)
    P.rounded_box('mt_grip_insert', (0.072, 0.022, 0.13), (-0.06, -0.132, 0.105),
                  M.grip_rubber(), lift, radius=0.025, segments=5, rot=(-0.2, 0, -0.08))
    # One mesh, two axes: fore-aft drives travel, vertical drives raise/lower.
    R.tag_control(grip, 'travel', 'Crown Multi-Task Control Handle',
                  'fore-aft', True, motion='fore-aft',
                  action2='lift', motion2='vertical', detents=1)

    # Thumb ball. Tilt on the vertical roll, reach on the fore-aft roll, and
    # sideshift on that same fore-aft roll while the back switch is held.
    # Seated on the crown of the grip where the thumb naturally falls, not on
    # the outboard face. The grip is raked -0.2 rad, so the ball tips with it.
    tilt_p = R.empty('rig_tiltPivot', (0.006, -0.128, 0.213), lift)
    tilt_p.rotation_euler = (0, 0, 0)
    reach_p = R.empty('rig_reachPivot', (0, 0, 0), tilt_p)
    ball = P.thumb_ball('mt_thumb_ball', 0.021, M.grip_rubber(), reach_p,
                        loc=(0, 0, 0), socket_mat=M.plastic_dark())
    R.tag_control(ball, 'tilt', 'Multi-Task thumb ball',
                  'vertical', True, motion='vertical',
                  action2='reach', motion2='fore-aft', shift2='sideshift', detents=1)

    # Switch on the BACK face of the handle. Held, it re-maps the ball's reach
    # axis to sideshift and gates Rack Height Select / Tilt Position Assist.
    back = P.thumb_switch('mt_back_switch', (0.030, 0.013, 0.018), M.plastic_dark(),
                          lift, loc=(0.018, -0.083, 0.150), rot=(-0.2, 0, -0.08))
    R.tag_modifier(back, 'Multi-Task back switch (hold for sideshift)')

    horn = P.cyl('btn_horn', 0.017, 0.011, (-0.065, -0.135, 0.09),
                 M.warning_amber(), lift, axis='Y', verts=24)
    R.tag_control(horn, 'horn', 'Horn button', 'button', True)

    # Right-side power disconnect and vertically stacked indicator lamps.
    disconnect_base = P.cyl('power_disconnect_base', 0.024, 0.012,
                            (0.445, -0.380, 1.12), M.warning_amber(), root,
                            axis='Y', verts=32, bevel=0.003)
    P.cyl('power_disconnect', 0.017, 0.018, (0, -0.014, 0),
          switch_black, disconnect_base, axis='Y', verts=32, bevel=0.004)
    for index, (z, mat) in enumerate(((1.245, M.warning_amber()), (1.215, M.pbr('led_green', 0x48A04B, 0.28, emission=0x48A04B, emission_strength=1.2)),
                                      (1.185, M.button_red()))):
        P.cyl(f'console_led_{index}', 0.008, 0.008, (0.385, -0.365, z), mat, root,
              axis='Y', verts=18)

    # Exact dual-pedal floor arrangement from the operator manual.
    # Manual page 20: LEFT foot on the brake pedal, RIGHT foot on the sensor pad.
    # Page 22: the brake is reverse-acting. Held down = brake off. Foot lifted
    # = brake applied. Modeled with a longer travel than a normal pedal so the
    # released position is visibly proud of the floorboard.
    brake = P.pedal('pedal_brake', (0.15, 0.14), parent=root, loc=(-0.22, -0.47, 0.285), angle=-0.12)
    R.tag_control(brake, 'brake', 'Left foot brake (hold down to release)',
                  'pedal', True, inverted=True)
    presence = P.pedal('pedal_presence', (0.26, 0.22), parent=root, loc=(0.18, -0.58, 0.275), angle=0)
    R.tag_control(presence, 'presence', 'Operator presence sensor pad', 'button', False)
    # Entry Bar safety switch. Page 20: a foot on this bar while traveling
    # sounds the alarm and brings the truck to a stop. It is a hazard surface,
    # not a commanded control, so it is tagged 'belly' - the sim's existing
    # action for a stop-the-truck contact switch.
    entry = P.tube('entry_bar', [(0.46, -0.81, 0.28), (0.46, -0.48, 0.31)], 0.025,
                   M.warning_amber(), root, corner_radius=0.02)
    R.tag_control(entry, 'belly', 'Entry Bar safety switch', 'button', True)


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
    # Fork camera looking along the blades toward the tips. It sits AHEAD of
    # the carriage bars and ABOVE the blades: mounted level with them the red
    # forks filled the whole feed, and behind them the low carriage bar filled
    # of the feed with red steel. Rides the reach
    # group so it tracks the carriage through lift and reach, which is what makes
    # the guard monitor useful when placing into a top slot.
    R.empty('rig_forkCam', (0, 0.50, 0.68), reach_grp)

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
    # Fork camera monitor on the guard header, matching the Raymond. Operator eye
    # is at y=-0.86, z=1.82, so this sits about 27 degrees up in the sightline.
    monitor = R.empty('forkcam_mount', (0, -0.10, 2.20), root)
    monitor.rotation_euler = (0.46, 0, 0)
    P.cage_display(monitor)
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
    # XR local-floor origin and desktop standing eye are separate. This avoids
    # adding an authored eye height on top of the headset's tracked eye height.
    R.empty('rig_xrOrigin', (0.03, -0.86, 0.246), root)
    R.empty('rig_cameraMount', (0.03, -0.86, 1.82), root)
    root['spec'] = 'Crown RR 5725-45 36V'
    return {
        'name': 'crown_rr5725',
        'cab_view': {'loc': (0.03, -0.86, 1.82), 'target': (0.0, -0.1, 1.12), 'focal': 22},
        'closeups': {
            'console': {'loc': (0.55, -1.3, 1.6), 'target': (0.0, -0.3, 1.05), 'focal': 32},
            # The Multi-Task handle sits behind the operator cushion from the
            # console camera, so it needs its own view. This is the one part an
            # operator recognizes the truck by, and the axes it carries (travel
            # fore-aft, lift vertical, thumb ball tilt/reach, back switch) are
            # what the practical assessment scores.
            # Shot from the operator's own eye point looking down at their right
            # hand, because that is the only angle the towers do not block.
            'handle': {'loc': (0.10, -0.97, 1.63), 'target': (0.34, -0.45, 1.14), 'focal': 50},
            'mast': {'loc': (1.6, 2.6, 1.2), 'target': (0, 0.64, 1.4), 'focal': 40},
        },
    }
