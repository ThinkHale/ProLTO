"""Raymond 4460 three-wheel sit-down counterbalance (Class I).

Spec anchors (m): overall width 1.07, overhead guard 2.1, mast lowered 3.3,
cushion front tires d0.457 (outer faces at +-0.5335), single centered rear
steer wheel d0.35, tapered red counterweight, head length ~2.0.

Operator configuration: legacy 4460 cowl shown in Raymond's official
operator-eye photograph, with left-offset three-spoke spinner wheel, tapered
sculpted column, three long cowl-mounted levers in accordion boots, and a small
right-side monochrome display. This file does not mix in the later 4750 color
touchscreen or armrest fingertip-control package.

Blender axes: forks +Y, operator -Y, up +Z, truck-right +X.

RIG NOTES
  rig_wheelPivot sits at the steering-wheel hub with a documented rest
  rotation of +0.745 rad (42.7 deg) about +X, the tilt-column rake toward
  the operator. Its local Z runs along the column axis; the Simulator spins
  local Z for steering and preserves the X rake. All other rig empties are
  unrotated; rest tilts live on child meshes.
"""
import math

from lib import materials as M
from lib import parts as P
from lib import rig as R

RED = M.raymond_red
BLACK = M.frame_black

COLUMN_RAKE = 0.70  # rad about +X, photo matched legacy column rake


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


# ------------------------------------------------------------------ chassis
def chassis_and_wheels(root):
    """Frame tub, fenders, cushion tires, centered rear steer wheel."""
    # black chassis tub between the axles
    P.rounded_box('frame_tub', (0.74, 0.86, 0.30), (0, -0.06, 0.27), BLACK(), root, radius=0.02)
    # black valance behind the mast, between the front tires
    P.rounded_box('frame_nosebox', (0.66, 0.44, 0.38), (0, 0.56, 0.27), BLACK(), root, radius=0.02)
    # red nose panel bridging the fender tops in front of the cowl
    P.rounded_box('body_nose', (0.92, 0.34, 0.16), (0, 0.70, 0.54), RED(), root, radius=0.03)

    # arched fenders: silhouette in (y, z), extruded across X over each tire
    arch_c, arch_r = (0.55, 0.2285), 0.27
    pts = [(0.88, 0.30), (0.88, 0.54), (0.76, 0.615), (0.26, 0.615),
           (0.17, 0.54), (0.17, 0.30)]
    for i in range(11):
        a = math.radians(168 - i * 15.6)
        pts.append((arch_c[0] + arch_r * math.cos(a), arch_c[1] + arch_r * math.sin(a)))
    for side, x0 in ((1, 0.37), (-1, -0.54)):
        P.extrude_profile(f'fender_{"R" if side > 0 else "L"}', pts, 0.17, RED(), root,
                          plane='YZ', bevel=0.012, loc=(x0, 0, 0))

    # Cushion front tires, with outer faces at +-0.5335 (overall width 1.07).
    wheels = []
    for index, sx in enumerate((-1, 1)):
        wheels.append(P.tire_cushion(f'rig_frontWheel_{index}', 0.2285, 0.152,
                                     parent=root, loc=(sx * 0.4575, 0.55, 0.2285)))
    # centered rear steer wheel + fork housing
    rear = P.tire_cushion('rig_rearWheel_0', 0.175, 0.22, parent=root, loc=(0, -0.66, 0.175))
    P.lathe('steer_turret', [(0.0, 0.0), (0.10, 0.0), (0.10, 0.09), (0.0, 0.09)],
            M.steel_dark(), root, loc=(0, -0.66, 0.34))
    for sx in (-1, 1):
        P.box(f'steer_fork_{"R" if sx > 0 else "L"}', (0.024, 0.26, 0.22),
              (sx * 0.135, -0.66, 0.26), BLACK(), root, bevel=0.005)
    P.cyl('steer_axle', 0.03, 0.31, (0, -0.66, 0.175), M.steel_dark(), root, axis='X')
    return wheels, rear


def counterweight(root):
    """Tapered red counterweight wrapping the rear steer wheel."""
    rr = rounded_rect
    sections = [(-0.66, rr(1.00, 0.50, 0.05, 0.09, z0=0.40)),
                (-0.78, rr(1.03, 0.52, 0.05, 0.10, z0=0.38)),
                (-0.90, rr(0.98, 0.48, 0.06, 0.12, z0=0.39)),
                (-1.00, rr(0.86, 0.40, 0.07, 0.14, z0=0.41)),
                (-1.08, rr(0.70, 0.28, 0.08, 0.12, z0=0.44))]
    P.loft_shell('cw_body', sections, RED(), root, subsurf=1)
    # lower red corner pods flanking the steer wheel + black bumper behind it
    for sx in (-1, 1):
        P.rounded_box(f'cw_pod_{"R" if sx > 0 else "L"}', (0.26, 0.40, 0.28),
                      (sx * 0.375, -0.86, 0.28), RED(), root, radius=0.04)
    P.rounded_box('cw_bumper', (0.46, 0.18, 0.24), (0, -0.97, 0.28), BLACK(), root, radius=0.03)
    # model badge on the tapered flanks + tail wordmark
    for sx, face in ((1, '+X'), (-1, '-X')):
        P.text_mesh(f'badge_4460_{"R" if sx > 0 else "L"}', '4460', 0.035, 0.012,
                    M.decal_white(), root, loc=(sx * 0.498, -0.86, 0.60), facing=face)
    P.text_mesh('logo_tail', 'RAYMOND', 0.045, 0.003, M.decal_white(), root,
                loc=(0, -1.083, 0.60), facing='-Y')
    # rear marker lights
    for sx in (-1, 1):
        P.rounded_box(f'tail_light_{"R" if sx > 0 else "L"}', (0.06, 0.025, 0.035),
                      (sx * 0.28, -1.035, 0.78), M.pbr('tail_red', 0x8E1210, 0.25), root, radius=0.008)


def body_and_deck(root):
    """Battery side covers, seat deck, floor, entry steps."""
    # red battery side covers with RAYMOND wordmark (board: white text under seat)
    for sx, face in ((1, '+X'), (-1, '-X')):
        tag = 'R' if sx > 0 else 'L'
        P.rounded_box(f'side_cover_{tag}', (0.06, 0.50, 0.34), (sx * 0.485, -0.42, 0.60),
                      RED(), root, radius=0.02)
        P.box(f'side_seam_{tag}', (0.005, 0.004, 0.30), (sx * 0.516, -0.30, 0.60),
              M.plastic_dark(), root, bevel=0.0015)
        P.text_mesh(f'logo_side_{tag}', 'RAYMOND', 0.048, 0.003, M.decal_white(), root,
                    loc=(sx * 0.517, -0.44, 0.68), facing=face)
    # black molded seat deck (battery hood)
    P.rounded_box('deck_hood', (0.80, 0.46, 0.34), (0, -0.46, 0.595), M.plastic_molded(),
                  root, radius=0.03)
    P.lathe('cupholder', [(0.030, 0.0), (0.048, 0.0), (0.053, 0.010), (0.048, 0.022),
                          (0.030, 0.022), (0.028, 0.004)],
            M.plastic_dark(), root, loc=(-0.29, -0.31, 0.765))
    # floor + entry steps
    P.tread_plate('floor', (0.78, 0.42), M.floor_mat(), root, (0, -0.05, 0.425),
                  rib_axis='X', rib_gap=0.11)
    for sx in (-1, 1):
        P.box(f'step_{"R" if sx > 0 else "L"}', (0.18, 0.30, 0.03),
              (sx * 0.42, 0.0, 0.44), M.plastic_dark(), root, bevel=0.006)
    P.label('label_data', (0.11, 0.08), M.decal_white(), root, (0.412, -0.35, 0.60),
            rot=(0, 0, math.pi / 2))


def guard(root):
    """Black overhead guard: straight raked front posts, vertical rear posts."""
    mat = BLACK()
    for sx in (-1, 1):
        tag = 'R' if sx > 0 else 'L'
        P.tube(f'guard_front_{tag}',
               [(sx * 0.455, 0.38, 0.60), (sx * 0.445, 0.27, 1.72), (sx * 0.44, 0.22, 2.06)],
               0.032, mat, root)
        P.tube(f'guard_rear_{tag}',
               [(sx * 0.40, -0.72, 0.86), (sx * 0.40, -0.74, 2.06)], 0.032, mat, root)
        P.tube(f'guard_side_{tag}',
               [(sx * 0.44, 0.22, 2.06), (sx * 0.40, -0.74, 2.06)], 0.030, mat, root)
        # entry grab grip on the front posts
        P.grab_bar(f'grip_entry_{tag}', [(sx * 0.46, 0.33, 1.02), (sx * 0.46, 0.37, 1.46)],
                   0.016, M.grip_rubber(), root)
    P.tube('guard_roof_F', [(-0.44, 0.22, 2.06), (0.44, 0.22, 2.06)], 0.030, mat, root)
    P.tube('guard_roof_B', [(-0.40, -0.74, 2.06), (0.40, -0.74, 2.06)], 0.030, mat, root)
    for i in range(5):
        x = -0.34 + i * 0.17
        P.tube(f'guard_slat_{i}', [(x, -0.70, 2.075), (x, 0.20, 2.075)], 0.016, mat, root)
    # forward work lights under the roof front rail
    for sx in (-1, 1):
        tag = 'R' if sx > 0 else 'L'
        P.cyl(f'worklight_{tag}', 0.042, 0.08, (sx * 0.34, 0.26, 1.97), BLACK(), root, axis='Y')
        P.cyl(f'worklight_lens_{tag}', 0.030, 0.012, (sx * 0.34, 0.31, 1.97),
              M.decal_white(), root, axis='Y')


def mast_and_carriage(root):
    mast = R.empty('rig_mast', (0, 0.84, 0), root)
    P.mast_assembly(mast, height=3.3, stages=2, outer_width=0.90, rail_web=0.16,
                    cylinder_center=False, side_cylinders=True, chains=True)
    # Hydraulic hoses stay at the rail edges. The official operator-eye image
    # has twin chain runs and an open center window with no center cylinder.
    for sx in (-1, 1):
        P.tube(f'mast_hose_{"R" if sx > 0 else "L"}',
               [(sx * 0.405, 0.10, 0.35), (sx * 0.405, 0.14, 1.6),
                (sx * 0.405, 0.10, 2.5)],
               0.011, M.grip_rubber(), mast)
    carriage = R.empty('rig_carriage', (0, 0.16, 0.02), mast)
    P.box('carriage_plate', (0.88, 0.045, 0.40), (0, 0.10, 0.42), BLACK(), carriage, bevel=0.006)
    P.rounded_box('carriage_bar', (0.86, 0.05, 0.10), (0, 0.09, 0.585), RED(), carriage, radius=0.015)
    P.load_backrest('backrest', 0.90, 1.10, parent=carriage, loc=(0, 0.14, 0.62))
    for sx in (-1, 1):
        P.fork(f'fork_{"R" if sx > 0 else "L"}', length=1.07, mat=RED(), parent=carriage,
               loc=(sx * 0.28, 0.155, 0.05))
    # tilt cylinders from the frame to the mast base (rest pose visual)
    ang = -1.768  # rad about X: +Z maps onto (0, 0.980, -0.196)
    for sx in (-1, 1):
        tag = 'R' if sx > 0 else 'L'
        P.lathe(f'tiltcyl_{tag}', [(0.0, 0.0), (0.032, 0.0), (0.032, 0.24), (0.024, 0.25),
                                   (0.024, 0.26), (0.0, 0.26)],
                BLACK(), root, loc=(sx * 0.35, 0.40, 0.44), rot=(ang, 0, 0))
        P.cyl(f'tiltrod_{tag}', 0.015, 0.20, (sx * 0.35, 0.714, 0.377), M.chrome_rod(),
              root, rot=(ang, 0, 0))
    return mast, carriage


# ------------------------------------------------------------- operator area
def cowl_and_controls(root):
    """Legacy Raymond 4460 cockpit from the official operator-eye photo."""
    molded = M.plastic_molded()
    rr = rounded_rect
    # Low cowl bridges the full entry width, then narrows around the column.
    # It stays below the display and lever boots just as it does in the photo.
    cowl_sections = [(0.05, rr(0.86, 0.30, 0.03, 0.07, z0=0.40)),
                     (0.20, rr(0.92, 0.38, 0.03, 0.08, z0=0.40)),
                     (0.38, rr(0.90, 0.35, 0.03, 0.08, z0=0.40)),
                     (0.53, rr(0.82, 0.24, 0.03, 0.06, z0=0.40))]
    P.loft_shell('cowl_low', cowl_sections, molded, root, subsurf=1)
    P.box('cowl_kick', (0.84, 0.06, 0.34), (0, 0.52, 0.23),
          M.plastic_dark(), root, bevel=0.008)
    P.rounded_box('cowl_control_shelf', (0.70, 0.34, 0.09),
                  (0.08, 0.105, 0.725), molded, root, radius=0.035,
                  segments=6, rot=(-0.04, 0, 0))

    # Tapered column molded as one housing. Its upper section leans rearward
    # toward the operator instead of reading as a bare cylindrical post.
    column_root = R.empty('column_housing_root', (-0.15, 0, 0), root)
    column_sections = [(0.22, rr(0.26, 0.37, 0.035, 0.065, z0=0.45)),
                       (0.12, rr(0.25, 0.47, 0.035, 0.065, z0=0.46)),
                       (0.02, rr(0.24, 0.51, 0.035, 0.070, z0=0.52)),
                       (-0.08, rr(0.22, 0.43, 0.035, 0.075, z0=0.66))]
    P.loft_shell('column_housing', column_sections, molded, column_root,
                 subsurf=1, bevel=0.008)
    P.rounded_box('column_neck', (0.22, 0.16, 0.11), (-0.15, -0.075, 1.075),
                  M.plastic_dark(), root, radius=0.04, segments=6,
                  rot=(COLUMN_RAKE, 0, 0))
    # Concentric bellows around the column tilt joint.
    for i, radius in enumerate((0.075, 0.068, 0.060, 0.052)):
        P.lathe(f'column_bellow_{i}', [(0.0, 0), (radius, 0),
                                      (radius, 0.012), (0.0, 0.012)],
                M.grip_rubber(), root,
                loc=(-0.15, -0.015 - i * 0.018, 0.995 + i * 0.020),
                rot=(COLUMN_RAKE, 0, 0))

    # Left-offset three-spoke steering wheel with large lower-left spinner.
    pivot = R.empty('rig_wheelPivot', (-0.15, -0.11, 1.12), root)
    pivot.rotation_euler = (COLUMN_RAKE, 0, 0)  # documented rake; local Z = column axis
    wheel = P.steering_wheel('steer_wheel_legacy', radius=0.16,
                             parent=pivot, loc=(0, 0, 0.03))
    R.tag_control(wheel, 'steer', 'Legacy three-spoke steering wheel',
                  'radial', False, motion='radial')
    P.text_mesh('wheel_brand', 'RAYMOND', 0.016, 0.001,
                M.decal_dark(), wheel, loc=(0, 0, 0.034), facing='+Z')
    spinner = P.lathe('steer_spinner',
                      [(0.0, 0.0), (0.022, 0.004), (0.026, 0.024),
                       (0.024, 0.052), (0.018, 0.061), (0.0, 0.064)],
                      M.plastic_dark(), wheel,
                      loc=(-0.105, -0.085, 0.020))
    R.tag_control(spinner, 'steer', 'Steering spinner knob', 'radial', False,
                  motion='radial')
    horn = P.cyl('btn_horn', 0.05, 0.022, (0, 0, 0.075), M.grip_rubber(), pivot, bevel=0.006)
    R.tag_control(horn, 'horn', 'Horn pad', 'button', True,
                  motion='button')

    # Three long cowl-mounted levers in individual accordion boots. This is
    # the named three-function legacy configuration, not an optional fourth
    # auxiliary lever or any later fingertip-control package.
    lever_specs = (('lift', 'Lift and lower lever', 0.16),
                   ('tilt', 'Mast tilt lever', 0.27),
                   ('sideshift', 'Integral sideshift lever', 0.38))
    for i, (action, label, x) in enumerate(lever_specs):
        piv = R.empty(f'rig_lever_{i}', (x, 0.17, 0.765), root)
        P.lathe(f'lever_boot_{i}',
                [(0.0, 0), (0.037, 0), (0.041, 0.012), (0.032, 0.026),
                 (0.036, 0.040), (0.027, 0.054), (0.030, 0.068),
                 (0.018, 0.084), (0.0, 0.086)],
                M.grip_rubber(), piv)
        P.cyl(f'lever_shaft_{i}', 0.009, 0.235,
              (0, -0.029, 0.124), M.steel_dark(), piv,
              rot=(0.25, 0, 0), verts=24)
        # Raymond's legacy lever caps are narrow molded hand pieces, not the
        # large rectangular blocks used in the first reconstruction.
        knob = P.lathe(f'lever_knob_{i}',
                       [(0.0, 0.0), (0.016, 0.002), (0.021, 0.012),
                        (0.022, 0.040), (0.019, 0.055), (0.013, 0.064),
                        (0.0, 0.066)],
                       M.plastic_dark(), piv,
                       loc=(0, -0.060, 0.238), rot=(0.25, 0, 0))
        R.tag_control(knob, action, label, 'vertical', True,
                      motion='fore-aft')
        P.rounded_box(f'lever_pictogram_{i}', (0.018, 0.003, 0.012),
              (0, -0.079, 0.273), M.decal_white(), piv, radius=0.003,
              segments=4,
              rot=(0.25, 0, 0))

    # Small monochrome display sits below and to the right of the lever bank.
    # It is deliberately not the large later-generation color touchscreen.
    P.rounded_box('display_4460_recess', (0.205, 0.055, 0.125),
                  (0.315, -0.025, 0.738), M.plastic_dark(), root,
                  radius=0.018, segments=5, rot=(0.62, 0, 0))
    P.display('display_4460', 0.165, 0.082, parent=root,
              loc=(0.315, -0.055, 0.752), rot=(0.62, 0, 0),
              screen_name='screen_4460')
    for i, x in enumerate((0.265, 0.300, 0.335, 0.370)):
        P.cyl(f'display_button_{i}', 0.007, 0.005,
              (x, -0.102, 0.716), M.plastic_dark(), root,
              rot=(math.pi / 2 + 0.62, 0, 0), verts=18)

    # Legacy key switch and parking-brake rocker on the inner cowl face.
    P.lathe('key_switch', [(0.0, 0.0), (0.020, 0.0), (0.022, 0.014), (0.007, 0.02),
                           (0.007, 0.032), (0.0, 0.032)],
            M.steel_dark(), root, loc=(-0.01, 0.08, 0.725),
            rot=(0.48, 0, 0))
    P.rounded_box('parking_brake_switch', (0.045, 0.020, 0.060),
                  (0.055, 0.055, 0.725), M.plastic_dark(), root,
                  radius=0.008, segments=4, rot=(0.48, 0, 0))
    P.label('label_warn', (0.07, 0.09), M.warning_amber(), root,
            (0.46, 0.12, 0.62))

    # pedals: accelerator right, service brake center-left
    accel = P.pedal('pedal_accel', (0.10, 0.20), parent=root,
                    loc=(0.20, 0.05, 0.44), angle=-0.35)
    R.tag_control(accel, 'travel', 'Accelerator pedal', 'pedal', True,
                  motion='pedal')
    brake = P.pedal('pedal_brake', (0.12, 0.15), parent=root,
                    loc=(-0.02, 0.05, 0.455), angle=-0.30)
    R.tag_control(brake, 'brake', 'Service brake pedal', 'pedal', True,
                  motion='pedal')


def seat_4460(root):
    """High-back black vinyl suspension seat; cushion doubles as presence switch."""
    vinyl = M.seat_vinyl()
    base = R.empty('seat', (0, -0.44, 0.80), root)
    P.rounded_box('seat_frame', (0.42, 0.44, 0.07), (0, 0, -0.02), BLACK(), base, radius=0.012)
    cushion = P.rounded_box('seat_cushion', (0.50, 0.48, 0.13), (0, 0.01, 0.08), vinyl,
                            base, radius=0.05)
    R.tag_control(cushion, 'presence', 'Operator presence (seat switch)',
                  'button', False, motion='button')
    for sx in (-1, 1):
        P.rounded_box(f'seat_bolster_{"R" if sx > 0 else "L"}', (0.09, 0.44, 0.15),
                      (sx * 0.235, 0.0, 0.10), vinyl, base, radius=0.04)
    back = P.rounded_box('seat_back', (0.48, 0.13, 0.60), (0, -0.20, 0.48), vinyl, base, radius=0.05)
    back.rotation_euler = (-0.10, 0, 0)
    for sx in (-1, 1):
        b = P.rounded_box(f'seat_backbolster_{"R" if sx > 0 else "L"}', (0.10, 0.14, 0.48),
                          (sx * 0.225, -0.215, 0.46), vinyl, base, radius=0.04)
        b.rotation_euler = (-0.10, 0, 0)
    top = P.rounded_box('seat_headrest', (0.40, 0.12, 0.14), (0, -0.255, 0.80), vinyl, base, radius=0.045)
    top.rotation_euler = (-0.10, 0, 0)


def build():
    root = R.empty('rig_root')
    chassis_and_wheels(root)
    counterweight(root)
    body_and_deck(root)
    guard(root)
    mast_and_carriage(root)
    cowl_and_controls(root)
    seat_4460(root)
    # Tracked-floor origin and desktop eye stay separate. WebXR supplies the
    # seated user's real tracked eye height above the 0.431 m floorboard.
    R.empty('rig_xrOrigin', (0, -0.44, 0.431), root)
    # Seated eye point: seat_cushion tops out at 0.945, plus 0.79 m of
    # 50th-percentile sitting eye height.
    R.empty('rig_cameraMount', (0, -0.44, 1.735), root)
    root['spec'] = 'Raymond 4460 three-wheel sit-down 36V, legacy three-lever cowl'
    root['control_configuration'] = 'RAYMOND4460_LEGACY_3LEVER_MONO_DISPLAY'
    return {
        'name': 'raymond_4460',
        'cab_view': {'loc': (0, -0.48, 1.69), 'target': (0.0, 0.9, 0.55), 'focal': 19},
        'closeups': {
            'cockpit': {'loc': (0.0, -0.48, 1.68), 'target': (0.10, 0.14, 0.84), 'focal': 22},
            'forks': {'loc': (1.7, 2.4, 1.0), 'target': (0, 1.0, 0.5), 'focal': 35},
        },
    }
