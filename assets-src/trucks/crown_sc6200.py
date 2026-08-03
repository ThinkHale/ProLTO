"""Crown SC 6200 four-wheel sit-down counterbalance (Class I).

Spec anchors (m): overall width 1.08, overhead guard 2.1, mast lowered 3.3,
cushion drive tires d0.457 front, d0.381 rear, wheelbase ~1.4, rounded
counterweight rear.

Board cues: ivory body with sculpted curves, rounded counterweight with CROWN +
SC wordmarks, charcoal seat deck, graphite curved-post overhead guard whose rear
posts flow INTO the body line, black mast, suspension seat w/ armrest, raked
steering column (round wheel + display pod), three hydraulic levers right of
seat, accelerator + brake pedals, side vent grilles in the counterweight.

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

COLUMN_RAKE = 0.60  # rad; documented rest rotation_euler.x of rig_wheelPivot

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
    # counterweight upper shell — sculpted rounded rump
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
    """Floor, seat deck, seat, cowl + dash, console, pedals."""
    molded = M.plastic_molded()
    # floor
    P.tread_plate('floor', (0.82, 0.62), M.floor_mat(), root, (0, 0.10, 0.50), rib_axis='X')
    # seat deck riser (charcoal)
    P.rounded_box('seat_deck', (0.88, 0.72, 0.46), (0, -0.55, 0.72), molded, root, radius=0.05)
    P.rounded_box('deck_cap', (0.84, 0.66, 0.05), (0, -0.55, 0.955), M.plastic_dark(), root, radius=0.02)
    # suspension seat + armrest
    seat = P.seat('seat', root, (0, -0.52, 0.98))
    arm = P.rounded_box('armrest', (0.09, 0.32, 0.06), (0.33, -0.56, 1.24), M.grip_rubber(), root, radius=0.025)
    P.box('armrest_post', (0.05, 0.05, 0.20), (0.33, -0.66, 1.12), M.plastic_dark(), root, bevel=0.008)
    presence = P.rounded_box('seat_switch', (0.055, 0.07, 0.035), (-0.26, -0.50, 0.985),
                             M.warning_amber(), root, radius=0.012)
    R.tag_control(presence, 'presence', 'Seat presence switch', 'button', False)

    # front cowl (charcoal molded, rises from floor to dash)
    sections = []
    for y, w, z0, z1, rt in ((0.26, 0.88, 0.50, 0.98, 0.08),
                             (0.44, 0.92, 0.50, 0.94, 0.10),
                             (0.60, 0.84, 0.50, 0.78, 0.12)):
        sections.append((y, rounded_rect(w, z1 - z0, 0.04, rt, z0=z0)))
    P.loft_shell('cowl', sections, molded, root, subsurf=1)
    # dash pod with display, tilted toward the operator
    pod = P.rounded_box('dash_pod', (0.56, 0.18, 0.24), (0, 0.32, 1.10), molded, root, radius=0.05)
    pod.rotation_euler = (0.28, 0, 0)
    P.display('display_sc', 0.17, 0.11, parent=root, loc=(0.03, 0.27, 1.16),
              rot=(0.36, 0, 0), screen_name='screen_sc')
    for i in range(3):
        P.cyl(f'dash_btn{i}', 0.011, 0.012, (0.14 + i * 0.04, 0.255, 1.07),
              M.warning_amber() if i == 0 else M.plastic_dark(), root, rot=(0.36, 0, 0))

    # steering column + wheel on the raked pivot
    pivot = R.empty('rig_wheelPivot', (-0.10, 0.18, 1.14), root)
    pivot.rotation_euler = (COLUMN_RAKE, 0, 0)
    P.cyl('column_shroud', 0.042, 0.44, (0, 0, -0.22), M.plastic_dark(), pivot)
    wheel = P.steering_wheel('steering_wheel', 0.17, parent=pivot, loc=(0, 0, 0.02))
    R.tag_control(wheel, 'steer', 'Steering wheel', 'horizontal', False)
    horn = P.cyl('btn_horn', 0.032, 0.018, (0, 0, 0.045), M.warning_amber(), wheel)
    R.tag_control(horn, 'horn', 'Horn button', 'button', True)

    # pedals
    accel = P.pedal('pedal_accel', (0.11, 0.18), parent=root, loc=(0.16, 0.30, 0.55), angle=-0.45)
    R.tag_control(accel, 'travel', 'Accelerator pedal', 'vertical', True)
    brake = P.pedal('pedal_brake', (0.17, 0.15), parent=root, loc=(-0.05, 0.31, 0.55), angle=-0.45)
    R.tag_control(brake, 'brake', 'Brake pedal', 'vertical', True)

    # right console with three hydraulic levers + cupholder
    P.rounded_box('console_body', (0.22, 0.72, 0.28), (0.41, -0.14, 0.86), molded, root, radius=0.06)
    P.rounded_box('lever_pod', (0.20, 0.30, 0.10), (0.41, 0.10, 1.02), M.plastic_dark(), root, radius=0.03)
    labels = ('Lift lever', 'Tilt lever', 'Sideshift lever')
    actions = ('lift', 'tilt', 'sideshift')
    knob_mats = (ORANGE(), M.plastic_dark(), M.plastic_dark())
    for i in range(3):
        piv = R.empty(f'rig_lever_{i}', (0.41, 0.18 - i * 0.09, 1.03), root)
        shaft = P.cyl(f'lever_shaft_{i}', 0.010, 0.15, (0, 0, 0.075), M.steel_dark(), piv)
        shaft.rotation_euler = (-0.30 + i * 0.10, 0, 0)
        knob = P.lathe(f'lever_knob_{i}',
                       [(0.0, 0), (0.020, 0.005), (0.026, 0.025), (0.021, 0.05), (0.0, 0.058)],
                       knob_mats[i], shaft, loc=(0, 0, 0.145))
        R.tag_control(knob, actions[i], labels[i], 'vertical', True)
    P.lathe('cupholder', [(0.045, 0.0), (0.045, 0.03), (0.052, 0.032), (0.056, 0.04), (0.0, 0.04)],
            M.plastic_dark(), root, loc=(0.42, -0.42, 0.97))


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
    # Seated eye: 1.11 m seat cushion top + 0.73 m seated eye height, which
    # leaves head clearance under the 2.1 m overhead guard.
    # Seated eye: above the cushion (top 1.11 m) and forward of the backrest.
    R.empty('rig_cameraMount', (0, -0.48, 1.84), root)
    root['spec'] = 'Crown SC 6200 four-wheel 48V'
    return {
        'name': 'crown_sc6200',
        'cab_view': {'loc': (0, -0.48, 1.69), 'target': (0.0, 0.55, 0.85), 'focal': 19},
        'closeups': {
            'console': {'loc': (0.95, -1.0, 1.6), 'target': (0.3, 0.0, 0.95), 'focal': 30},
            'forks': {'loc': (1.7, 2.4, 1.1), 'target': (0, 0.8, 0.8), 'focal': 40},
        },
    }
