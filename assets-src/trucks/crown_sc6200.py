"""Crown SC 6200 four-wheel sit-down counterbalance (Class I).

Spec anchors (m): overall width 1.08, overhead guard 2.1, mast lowered 3.3,
cushion drive tires d0.457 front, d0.381 rear, wheelbase ~1.4, rounded
counterweight rear.

Board cues: ivory body with sculpted curves, rounded counterweight with CROWN +
SC wordmarks, charcoal seat deck, graphite curved-post overhead guard whose rear
posts flow INTO the body line, black mast, suspension seat, and the named
SC 6200 standard-manual-lever operator configuration shown on page 10 of Crown
operator manual 600094-000: 10 inch spinner wheel, low cowl, Crown display,
three switch row, key switch, two pedals, and four chassis-mounted levers.

Rig notes: rig_wheelPivot carries a rest rotation_euler.x = COLUMN_RAKE
(0.60 rad, ~34 deg toward the operator) so its local Z runs along the column
axis; the Simulator spins rotation.z which resolves to a spin about the column
before the rake is applied (three.js XYZ euler). All other empties unrotated.

Blender axes: forks +Y, operator -Y, up +Z, truck-right +X.
"""
import math

from lib import materials as M
from lib import parts as P
from lib import rig as R

IVORY = M.crown_ivory
BLACK = M.frame_black
ORANGE = M.safety_orange

COLUMN_RAKE = 0.67  # rad; operator-manual photo matched column rake

FRONT_AXLE_Y = 0.35
REAR_AXLE_Y = -1.05   # wheelbase 1.4
FRONT_R = 0.2285      # d 0.457 cushion
REAR_R = 0.1905       # d 0.381


def guard_gray():
    return M.pbr('sc_guard_gray', 0x43474B, roughness=0.42, metallic=0.5)


def rounded_rect(w, h, r_bottom, r_top, z0=0.0, n=4, cx=0.0):
    """Closed rounded-rectangle pts (x, z), CCW, for loft sections."""
    pts = []

    def corner(px, pz, radius, a0, a1):
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            pts.append((cx + px + radius * math.cos(a), pz + radius * math.sin(a)))

    corner(w / 2 - r_bottom, z0 + r_bottom, r_bottom, -math.pi / 2, 0)
    corner(w / 2 - r_top, z0 + h - r_top, r_top, 0, math.pi / 2)
    corner(-w / 2 + r_top, z0 + h - r_top, r_top, math.pi / 2, math.pi)
    corner(-w / 2 + r_bottom, z0 + r_bottom, r_bottom, math.pi, 1.5 * math.pi)
    return pts


def chassis(root):
    """Black lower hull: front fender line, floor band, rear wheel arches."""
    sections = []
    for y, w, z0, z1 in (
            (0.60, 0.98, 0.44, 0.58),
            (0.14, 1.04, 0.44, 0.60),
            (0.02, 1.06, 0.20, 0.60),
            (-0.55, 1.06, 0.135, 0.60),
            (-0.84, 1.06, 0.135, 0.64),
            (-0.92, 1.06, 0.30, 0.68),
            (-1.18, 1.06, 0.30, 0.70),
            (-1.26, 1.04, 0.15, 0.72),
            (-1.46, 0.96, 0.15, 0.74),
            (-1.58, 0.84, 0.18, 0.70)):
        sections.append((y, rounded_rect(w, z1 - z0, 0.045, 0.05, z0=z0)))
    P.loft_shell('hull_lower', sections, BLACK(), root, subsurf=1)
    # frame core between the front wheels carrying the mast pivot
    P.box('frame_core', (0.58, 0.55, 0.42), (0, 0.34, 0.26), BLACK(), root, bevel=0.01)


def bodywork(root):
    """Ivory sculpted side sills + rounded counterweight shell."""
    ivory = IVORY()
    # per-side sill panels (proud of the black hull, carry the CROWN wordmark)
    for sx, tag in ((-1, 'L'), (1, 'R')):
        sections = []
        for y, z0, z1 in ((0.10, 0.26, 0.60), (-0.12, 0.24, 0.64),
                          (-0.42, 0.26, 0.70), (-0.62, 0.28, 0.80)):
            sections.append((y, rounded_rect(0.16, z1 - z0, 0.03, 0.045, z0=z0, cx=sx * 0.462)))
        P.loft_shell(f'sill_{tag}', sections, ivory, root, subsurf=1)
    # Counterweight upper shell with a sculpted, rounded rump.
    sections = []
    for y, w, z0, z1, rt in (
            (-0.58, 1.04, 0.55, 1.04, 0.10),
            (-0.80, 1.06, 0.58, 1.07, 0.14),
            (-1.05, 1.06, 0.60, 1.05, 0.20),
            (-1.30, 1.00, 0.62, 0.97, 0.26),
            (-1.48, 0.88, 0.66, 0.88, 0.28),
            (-1.57, 0.72, 0.70, 0.80, 0.22)):
        sections.append((y, rounded_rect(w, z1 - z0, 0.05, rt, z0=z0)))
    P.loft_shell('cw_shell', sections, ivory, root, subsurf=1)
    # side vent grilles (stacked pills on both counterweight shoulders)
    for sx in (-1, 1):
        for i in range(4):
            P.rounded_box(f'vent_{"L" if sx < 0 else "R"}{i}',
                          (0.016, 0.09, 0.048), (sx * 0.528, -0.70 - i * 0.016, 0.62 + i * 0.088),
                          M.plastic_dark(), root, radius=0.02)
    # wordmarks
    P.text_mesh('logo_side_L', 'CROWN', 0.075, 0.0018, M.decal_dark(), root,
                loc=(-0.548, -0.18, 0.50), facing='-X')
    P.text_mesh('logo_side_R', 'CROWN', 0.075, 0.0018, M.decal_dark(), root,
                loc=(0.548, -0.18, 0.50), facing='+X')
    rear_logo = P.text_mesh('logo_rear', 'CROWN', 0.095, 0.0018, M.decal_dark(), root,
                            loc=(0, -1.565, 0.84))
    rear_logo.rotation_euler = (math.pi / 2 - 0.30, 0, 0)
    sc_logo = P.text_mesh('logo_sc', 'SC', 0.06, 0.0018, M.decal_dark(), root,
                          loc=(0.20, -1.52, 0.70))
    sc_logo.rotation_euler = (math.pi / 2 - 0.22, 0, 0)
    chev = P.rounded_box('logo_sc_chev', (0.05, 0.004, 0.024), (0.27, -1.52, 0.70),
                         ORANGE(), root, radius=0.01)
    chev.rotation_euler = (-0.22, 0, 0)


def operator_station(root):
    """SC 6200 standard manual-lever cockpit, operator-manual page 10.

    This is intentionally one configuration. It does not mix the optional D4
    armrest, dual-axis, mini-lever, or foot-direction-control packages into the
    standard chassis-mounted manual-lever layout.
    """
    molded = M.plastic_molded()

    # Wide dual-entry rubber floor. The manual photo shows the wheel and cowl
    # floating above an uninterrupted floor mat, not a center console.
    P.tread_plate('floor', (0.82, 0.70), M.floor_mat(), root,
                  (0, 0.06, 0.50), rib_axis='X', rib_gap=0.085)

    # Seat deck and standard suspension seat. No D4 armrest is authored on
    # this configuration because its presence would identify a different cab.
    P.rounded_box('seat_deck', (0.88, 0.72, 0.46), (0, -0.55, 0.72), molded, root, radius=0.05)
    P.rounded_box('deck_cap', (0.84, 0.66, 0.05), (0, -0.55, 0.955), M.plastic_dark(), root, radius=0.02)
    P.seat('seat', root, (0, -0.52, 0.98))
    presence = P.rounded_box('seat_switch', (0.055, 0.07, 0.035), (-0.26, -0.50, 0.985),
                             M.warning_amber(), root, radius=0.012)
    R.tag_control(presence, 'presence', 'Seat presence switch', 'button', False,
                  motion='vertical')

    # Low, shallow molded cowl from the official operator-eye plate. Its top
    # stays below the wheel hub so the forks remain visible over it.
    cowl_sections = []
    for y, w, z0, z1, rt in ((0.09, 0.98, 0.50, 0.78, 0.06),
                             (0.22, 1.02, 0.50, 0.84, 0.07),
                             (0.38, 0.96, 0.50, 0.80, 0.09),
                             (0.53, 0.84, 0.50, 0.69, 0.09)):
        cowl_sections.append((y, rounded_rect(w, z1 - z0, 0.035, rt, z0=z0)))
    P.loft_shell('cowl_low', cowl_sections, molded, root, subsurf=1)
    P.rounded_box('cowl_top_shelf', (0.92, 0.23, 0.055), (0, 0.15, 0.805),
                  molded, root, radius=0.025, segments=5, rot=(-0.035, 0, 0))

    # Compact sculpted column housing. The top leans toward the seat and the
    # tapered sides match the narrow Crown column visible through the wheel.
    column_profile = [(-0.01, 0.64), (0.24, 0.64), (0.25, 0.79),
                      (0.13, 1.04), (-0.035, 1.10), (-0.10, 0.98),
                      (-0.065, 0.76)]
    P.extrude_profile('column_housing', column_profile, 0.22, molded, root,
                      plane='YZ', bevel=0.025, loc=(-0.23, 0, 0))
    P.rounded_box('column_upper_cap', (0.24, 0.13, 0.105), (-0.12, -0.025, 1.04),
                  M.plastic_dark(), root, radius=0.035, segments=6,
                  rot=(COLUMN_RAKE, 0, 0))

    # Crown Access display is right of the wheel in the exact standard layout.
    P.rounded_box('display_sc_recess', (0.25, 0.055, 0.145), (0.19, 0.075, 0.84),
                  M.plastic_dark(), root, radius=0.025, segments=6,
                  rot=(0.44, 0, 0))
    _, screen = P.display('display_sc', 0.205, 0.105, parent=root,
                          loc=(0.19, 0.042, 0.855), rot=(0.44, 0, 0),
                          screen_name='screen_sc')
    P.text_mesh('display_crown_wordmark', 'CROWN', 0.014, 0.001,
                M.decal_white(), root, loc=(0.15, 0.004, 0.906),
                facing='-Y')
    for i, x in enumerate((0.275, 0.305, 0.335)):
        P.cyl(f'display_key_{i}', 0.009, 0.006, (x, 0.006, 0.858),
              M.plastic_dark(), root, rot=(math.pi / 2 + 0.44, 0, 0),
              verts=20, bevel=0.002)

    # Fan, rear work light, and front work light rocker row on the left cowl.
    for i, (name, x) in enumerate((('fan', -0.39), ('rear_work', -0.33),
                                    ('front_work', -0.27))):
        P.rounded_box(f'switch_{name}', (0.044, 0.018, 0.063),
                      (x, 0.040, 0.817), M.plastic_dark(), root, radius=0.008,
                      segments=4, rot=(0.44, 0, 0))
        P.box(f'switch_{name}_mark', (0.018, 0.004, 0.006),
              (x, 0.027, 0.833), M.decal_white(), root, bevel=0.001,
              rot=(0.44, 0, 0))

    # 10 inch diameter wheel with spinner, exactly the standard SC 6200 item.
    pivot = R.empty('rig_wheelPivot', (-0.12, -0.075, 1.075), root)
    pivot.rotation_euler = (COLUMN_RAKE, 0, 0)
    wheel = P.steering_wheel('steering_wheel_10in', 0.127, parent=pivot,
                             loc=(0, 0, 0.02))
    R.tag_control(wheel, 'steer', '10 inch steering wheel', 'radial', False,
                  motion='radial')
    spinner = P.lathe('steering_spinner',
                      [(0.0, 0), (0.019, 0.004), (0.024, 0.027),
                       (0.021, 0.052), (0.0, 0.058)],
                      M.grip_rubber(), wheel, loc=(0.083, -0.078, 0.015))
    # Seat the horn pad directly on the wheel hub. The previous 22 mm air gap
    # made it look detached from the steering wheel at oblique view angles.
    horn = P.cyl('btn_horn', 0.041, 0.018, (0, 0, 0.039),
                 M.plastic_dark(), pivot, bevel=0.008)
    R.tag_control(horn, 'horn', 'Steering wheel horn', 'button', True,
                  motion='vertical')

    # Direction paddle and wheel-tilt release flank the column in the manual.
    P.tube('direction_stalk', [(-0.015, 0.0, 0.0), (0.165, 0.0, 0.0)],
           0.010, M.steel_dark(), pivot)
    direction = P.rounded_box('direction_control', (0.040, 0.024, 0.046),
                              (0.185, 0, 0), M.plastic_dark(), pivot,
                              radius=0.011, segments=6)
    R.tag_control(direction, 'travel', 'Forward and reverse direction control',
                  'horizontal', False, motion='horizontal')
    P.rounded_box('steer_tilt_release', (0.032, 0.050, 0.085),
                  (-0.215, 0.018, 0.84), M.plastic_dark(), root, radius=0.01,
                  segments=4, rot=(0.18, 0, 0))

    # Key switch sits below the display at the inner edge of the right cowl.
    P.cyl('key_switch_bezel', 0.018, 0.012, (0.055, 0.012, 0.786),
          M.steel_dark(), root, rot=(math.pi / 2 + 0.40, 0, 0), verts=28)
    key = P.box('key_blade', (0.009, 0.006, 0.038), (0.055, -0.004, 0.805),
                M.steel_dark(), root, bevel=0.002, rot=(0.40, 0, -0.18))

    # Automotive-type service brake and accelerator, with distinct widths and
    # exact left/right ordering from the manual photograph.
    brake = P.pedal('pedal_brake', (0.145, 0.15), parent=root,
                    loc=(-0.025, 0.17, 0.535), angle=-0.38)
    R.tag_control(brake, 'brake', 'Service brake pedal', 'pedal', True,
                  motion='fore-aft')
    accel = P.pedal('pedal_accel', (0.085, 0.19), parent=root,
                    loc=(0.205, 0.17, 0.53), angle=-0.42)
    R.tag_control(accel, 'travel', 'Accelerator pedal', 'pedal', True,
                  motion='fore-aft')

    # Four chassis-mounted urethane manual hydraulic levers. Their bases are
    # separate accordion boots and their offset handles carry tactile icons.
    # Keep the hydraulic pod outside the display recess. The former 310 mm pod
    # crossed 85 mm into the display volume and was visibly clipping the bezel.
    P.rounded_box('manual_lever_pod', (0.22, 0.22, 0.075), (0.405, 0.13, 0.80),
                  molded, root, radius=0.025, segments=5)
    lever_specs = (('lift', 'Lift and lower manual lever'),
                   ('tilt', 'Mast tilt manual lever'),
                   ('sideshift', 'Sideshift manual lever'),
                   ('reach', 'Auxiliary hydraulic manual lever'))
    for i, (action, label) in enumerate(lever_specs):
        x = 0.315 + i * 0.055
        piv = R.empty(f'rig_lever_{i}', (x, 0.10, 0.815), root)
        P.lathe(f'lever_boot_{i}',
                [(0.0, 0), (0.030, 0), (0.034, 0.012), (0.027, 0.024),
                 (0.030, 0.036), (0.021, 0.048), (0.023, 0.058),
                 (0.013, 0.072), (0.0, 0.074)],
                M.grip_rubber(), piv)
        shaft = P.cyl(f'lever_shaft_{i}', 0.009, 0.205,
                      (0, -0.024, 0.105), M.steel_dark(), piv,
                      rot=(0.23, 0, 0), verts=24)
        knob_outline = [(-0.018, 0.0), (0.018, 0.0), (0.024, 0.018),
                        (0.022, 0.064), (0.012, 0.084), (-0.012, 0.084),
                        (-0.022, 0.064), (-0.024, 0.018)]
        handle = P.loft_shell(f'lever_handle_{i}',
                              [(-0.018, knob_outline), (0.018, knob_outline)],
                              M.grip_rubber(), piv, subsurf=1, bevel=0.003)
        handle.location = (0, -0.052, 0.175)
        handle.rotation_euler = (0.23, 0, 0)
        R.tag_control(handle, action, label, 'vertical', True,
                      motion='fore-aft')
        P.box(f'lever_icon_{i}', (0.020, 0.004, 0.013),
              (0, -0.021, 0.052), M.decal_white(), handle, bevel=0.002)


def guard(root):
    """Curved-post overhead guard; rear posts flow into the counterweight."""
    gray = guard_gray()
    r = 0.034
    for sx in (-1, 1):
        P.tube(f'guard_front_{sx}', [(sx * 0.46, 0.50, 0.60), (sx * 0.47, 0.38, 1.45),
                                     (sx * 0.45, 0.14, 2.04)], r, gray, root)
        P.tube(f'guard_rear_{sx}', [(sx * 0.44, -0.88, 2.04), (sx * 0.47, -1.08, 1.55),
                                    (sx * 0.48, -1.24, 0.90)], r, gray, root)
    # roof perimeter + fore-aft slats
    fl, fr = (-0.45, 0.14, 2.04), (0.45, 0.14, 2.04)
    bl, br = (-0.44, -0.88, 2.04), (0.44, -0.88, 2.04)
    P.tube('guard_roof_F', [fl, fr], r * 0.95, gray, root)
    P.tube('guard_roof_B', [bl, br], r * 0.95, gray, root)
    P.tube('guard_roof_L', [bl, fl], r * 0.95, gray, root)
    P.tube('guard_roof_R', [br, fr], r * 0.95, gray, root)
    for i in range(5):
        x = -0.36 + i * 0.18
        P.tube(f'guard_slat_{i}', [(x, -0.84, 2.07), (x, 0.10, 2.07)], r * 0.5, gray, root)
    # entry grab handle on the left front post
    P.grab_bar('grab_entry', [(-0.40, 0.44, 0.95), (-0.41, 0.36, 1.42)], 0.016, M.plastic_dark(), root)


def mast_and_forks(root):
    mast = R.empty('rig_mast', (0, 0.52, 0), root)
    P.mast_assembly(mast, height=3.3, stages=2, outer_width=0.88, rail_web=0.16,
                    cylinder_center=False, side_cylinders=True, chains=True)
    carriage = R.empty('rig_carriage', (0, 0.14, 0.12), mast)
    P.box('carriage_plate', (0.90, 0.045, 0.40), (0, 0.16, 0.32), BLACK(), carriage, bevel=0.006)
    P.load_backrest('backrest', 0.88, 1.0, parent=carriage, loc=(0, 0.20, 0.44))
    P.fork_pair(carriage, spread=0.62, length=1.07, z=0.02)
    # tilt cylinders from the body to the mast (chrome rods forward)
    for sx in (-1, 1):
        body = P.cyl(f'tiltcyl_{sx}', 0.032, 0.24, (sx * 0.38, 0.28, 0.72),
                     BLACK(), root, rot=(-0.80, 0, 0))
        P.cyl(f'tiltrod_{sx}', 0.016, 0.16, (sx * 0.38, 0.41, 0.86),
              M.chrome_rod(), root, rot=(-0.80, 0, 0))
    return mast, carriage


def wheels(root):
    for i, sx in enumerate((-1, 1)):
        P.tire_cushion(f'rig_frontWheel_{i}', FRONT_R, 0.17, parent=root,
                       loc=(sx * 0.44, FRONT_AXLE_Y, FRONT_R))
        P.tire_cushion(f'rig_rearWheel_{i}', REAR_R, 0.14, parent=root,
                       loc=(sx * 0.34, REAR_AXLE_Y, REAR_R))


def build():
    root = R.empty('rig_root')
    chassis(root)
    bodywork(root)
    operator_station(root)
    guard(root)
    mast_and_forks(root)
    wheels(root)
    # Tracked-floor origin and authored desktop eye are separate. The headset
    # supplies the seated user's real eye height above the 0.506 m floor.
    R.empty('rig_xrOrigin', (0, -0.48, 0.506), root)
    R.empty('rig_cameraMount', (0, -0.48, 1.84), root)
    root['spec'] = 'Crown SC 6200 four-wheel 48V, standard manual-lever configuration'
    root['control_configuration'] = 'SC6200_STD_MANUAL_4LEVER_10IN_WHEEL'
    return {
        'name': 'crown_sc6200',
        'cab_view': {'loc': (0, -0.48, 1.84), 'target': (0.0, 0.42, 0.78), 'focal': 19},
        'closeups': {
            'console': {'loc': (0.95, -1.0, 1.6), 'target': (0.3, 0.0, 0.95), 'focal': 30},
            'forks': {'loc': (1.7, 2.4, 1.1), 'target': (0, 0.8, 0.8), 'focal': 40},
        },
    }
