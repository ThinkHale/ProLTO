"""Crown PE 4500 end-control rider pallet truck (Class III).

Spec anchors (PE 4500-60 sheet, inches -> m):
  overall width ~0.96, fork length 48 -> 1.22, lift height max 0.23,
  power unit height ~1.35 (X10 head), platform floor ~0.19, drive tire 10x5
  -> r 0.127, load wheels tandem poly.
Blender axes: forks +Y, operator platform -Y (very rear), up +Z.
Rig: rig_root / rig_carriage (fork weldment + load wheels) /
     rig_tillerPivot -> rig_headGroup (X10 head) / rig_cameraMount.
"""
import math

from lib import materials as M
from lib import parts as P
from lib import rig as R

IVORY = M.crown_ivory
BLACK = M.frame_black
ORANGE = M.safety_orange
MOLD = M.plastic_molded
DARK = M.plastic_dark


def grip_tan():
    """X10 twist-grip elastomer — warm putty tan like the reference."""
    return M.pbr('grip_tan', 0xB4A88F, roughness=0.62, metallic=0.0)


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


def dot_mat(name, size, parent, loc, pitch=0.055, dot_r=0.011):
    """Single-mesh anti-slip rubber mat with a raised dot grid."""
    import bmesh
    from mathutils import Vector
    bm = bmesh.new()
    # base slab
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1)
    bmesh.ops.scale(tmp, verts=tmp.verts, vec=Vector((size[0], size[1], 0.012)))
    me_t = __import__('bpy').data.meshes.new('t')
    tmp.to_mesh(me_t)
    tmp.free()
    bm.from_mesh(me_t)
    __import__('bpy').data.meshes.remove(me_t)
    nx = int(size[0] / pitch)
    ny = int(size[1] / pitch)
    for ix in range(nx):
        for iy in range(ny):
            x = -size[0] / 2 + (ix + 0.5) * size[0] / nx
            y = -size[1] / 2 + (iy + 0.5) * size[1] / ny
            tmp = bmesh.new()
            bmesh.ops.create_cone(tmp, cap_ends=True, segments=8, radius1=dot_r,
                                  radius2=dot_r * 0.7, depth=0.008)
            bmesh.ops.translate(tmp, verts=tmp.verts, vec=Vector((x, y, 0.008)))
            me_t = __import__('bpy').data.meshes.new('t')
            tmp.to_mesh(me_t)
            tmp.free()
            bm.from_mesh(me_t)
            __import__('bpy').data.meshes.remove(me_t)
    obj = P.mesh_from_bm(name, bm, M.floor_mat(), parent)
    obj.location = loc
    P.smooth_shade(obj, 60)
    return obj


# ------------------------------------------------------------------ power unit
def power_unit(root):
    ivory = IVORY()
    # black chassis skirt wrapping the drive end, slight ground clearance
    P.rounded_box('skirt', (0.96, 1.0, 0.16), (0, -0.06, 0.14), DARK(), root, radius=0.035)
    # ivory shell: bulldog nose lofted toward +Y
    sections = []
    for y, w, h, rb, rt, z0 in ((-0.52, 0.86, 0.86, 0.06, 0.10, 0.16),
                                (-0.28, 0.90, 0.88, 0.06, 0.13, 0.15),
                                (0.02, 0.90, 0.88, 0.06, 0.15, 0.15),
                                (0.20, 0.86, 0.78, 0.07, 0.20, 0.16),
                                (0.31, 0.72, 0.55, 0.10, 0.20, 0.18),
                                (0.37, 0.52, 0.30, 0.10, 0.12, 0.22)):
        sections.append((y, rounded_rect(w, h, rb, rt, z0=z0)))
    P.loft_shell('shell_power', sections, ivory, root, subsurf=1)
    # charcoal molded deck on top w/ raised rim
    deck = P.rounded_box('deck', (0.80, 0.74, 0.10), (0, -0.15, 1.00), MOLD(), root, radius=0.035)
    P.rounded_box('deck_rim', (0.72, 0.60, 0.03), (0, -0.13, 1.055), DARK(), deck.parent, radius=0.012)
    # ivory horns wrapping the deck rear corners (seen flanking the operator)
    for sx in (-1, 1):
        h = P.rounded_box(f'horn_{sx}', (0.17, 0.34, 0.18), (sx * 0.355, -0.44, 1.015),
                          ivory, root, radius=0.055)
        h.rotation_euler = (0.08, 0, 0)
    # knee / lean cushion on the operator face
    pad = P.rounded_box('knee_pad', (0.52, 0.11, 0.46), (0, -0.545, 0.78), M.grip_rubber(), root, radius=0.05)
    pad.rotation_euler = (0.1, 0, 0)
    # twin dark grilles on the nose front
    for sx in (-1, 1):
        g = P.rounded_box(f'grille_{sx}', (0.10, 0.025, 0.24), (sx * 0.12, 0.315, 0.62),
                          DARK(), root, radius=0.012)
        g.rotation_euler = (-0.45, 0, 0)
    # oval cooling vents on both nose shoulders
    for sx in (-1, 1):
        for i, z in enumerate((0.86, 0.78, 0.70)):
            v = P.rounded_box(f'vent_{sx}_{i}', (0.095, 0.014, 0.05), (sx * 0.345, 0.185 + i * 0.012, z),
                              DARK(), root, radius=0.02)
            v.rotation_euler = (0, sx * 0.12, sx * -0.5)
    # panel seam grooves
    for sx in (-1, 1):
        P.box(f'seam_side_{sx}', (0.004, 0.72, 0.005), (sx * 0.452, -0.12, 0.62), DARK(), root, bevel=0.0015)
    # branding
    for sx, facing in ((-1, '-X'), (1, '+X')):
        P.text_mesh(f'logo_crown_{sx}', 'CROWN', 0.085, 0.0018, M.decal_dark(), root,
                    loc=(sx * 0.4525, -0.10, 0.56), facing=facing)
        P.text_mesh(f'logo_pe_{sx}', 'PE', 0.052, 0.0018, M.decal_dark(), root,
                    loc=(sx * 0.4525, 0.02, 0.42), facing=facing)
        disc = P.cyl(f'logo_swoosh_{sx}', 0.032, 0.003, (sx * 0.4525, 0.085, 0.42), ORANGE(), root, axis='X')
        disc.scale = (1, 1.6, 1)
    P.label('label_capacity', (0.13, 0.08), M.warning_amber(), root, (0.4525, -0.35, 0.82),
            rot=(0, 0, math.pi / 2), text='4500', text_mat=M.decal_dark())
    # entry grab handles on the horns
    for sx in (-1, 1):
        P.tube(f'grab_{sx}', [(sx * 0.30, -0.585, 1.03), (sx * 0.40, -0.60, 1.10),
                              (sx * 0.40, -0.60, 0.94)], 0.015, ORANGE(), root)


# ------------------------------------------------------------ tiller + X10 head
def tiller(root):
    pivot = R.empty('rig_tillerPivot', (0, -0.16, 1.05), root)
    # round console dome the tiller rises from
    P.lathe('tiller_dome', [(0.0, 0.0), (0.205, 0.0), (0.215, 0.025), (0.19, 0.055),
                            (0.115, 0.08), (0.07, 0.088), (0.07, 0.0)], MOLD(), pivot)
    P.lathe('tiller_boot', [(0.0, 0.06), (0.055, 0.06), (0.045, 0.12), (0.035, 0.16), (0.0, 0.16)],
            DARK(), pivot)
    # amber half-ring detail on the dome face toward the operator
    P.tube('dome_handle', [(-0.07, -0.185, 1.055 - 1.05), (0, -0.215, 1.03 - 1.05),
                           (0.07, -0.185, 1.055 - 1.05)], 0.011, ORANGE(), pivot)
    # arm: two-segment crane toward the operator
    P.tube('tiller_arm', [(0, 0, 0.10), (0, -0.035, 0.20), (0, -0.16, 0.245)], 0.027, DARK(), pivot)
    P.rounded_box('arm_elbow', (0.075, 0.10, 0.075), (0, -0.055, 0.205), DARK(), pivot, radius=0.03)

    head = R.empty('rig_headGroup', (0, -0.20, 0.255), pivot)
    body = P.rounded_box('head_body', (0.11, 0.15, 0.095), (0, 0, 0.01), DARK(), head, radius=0.035)
    body.rotation_euler = (0.25, 0, 0)
    R.tag_control(body, 'steer', 'X10 handle — steer', 'horizontal', False)
    for sx in (-1, 1):
        cap = P.rounded_box(f'head_cap_{sx}', (0.035, 0.115, 0.075), (sx * 0.062, 0.005, 0.012),
                            grip_tan(), head, radius=0.016)
        cap.rotation_euler = (0.25, 0, 0)
        # butterfly twist grip loop
        grip = P.tube(f'head_grip_{"L" if sx < 0 else "R"}',
                      [(sx * 0.055, -0.045, 0.015), (sx * 0.155, -0.075, 0.03),
                       (sx * 0.195, 0.01, 0.015), (sx * 0.075, 0.065, -0.005)],
                      0.021, grip_tan(), head, corner_radius=0.09)
        R.tag_control(grip, 'travel', 'Twist grip — travel', 'horizontal', True)
    # belly-button emergency reverse bar on the head front
    belly = P.rounded_box('head_belly', (0.15, 0.04, 0.055), (0, 0.093, -0.012), M.button_red(), head, radius=0.018)
    belly.rotation_euler = (0.3, 0, 0)
    R.tag_control(belly, 'belly', 'Emergency reverse belly button', 'button', True)
    # horn button top center
    horn = P.cyl('head_horn', 0.020, 0.018, (0, -0.015, 0.062), M.button_red(), head, bevel=0.004)
    R.tag_control(horn, 'horn', 'Horn', 'button', True)
    # lift rocker (amber, right wing) + matching lower paddle left
    lift = P.rounded_box('head_lift', (0.05, 0.05, 0.024), (0.052, -0.032, 0.052), M.warning_amber(), head, radius=0.01)
    lift.rotation_euler = (0.3, 0, -0.15)
    R.tag_control(lift, 'lift', 'Lift / lower rocker', 'vertical', True)
    paddle = P.rounded_box('head_paddle', (0.05, 0.05, 0.024), (-0.052, -0.032, 0.052), DARK(), head, radius=0.01)
    paddle.rotation_euler = (0.3, 0, 0.15)
    P.label('head_icons', (0.05, 0.03), M.decal_dark(), head, (0, -0.062, 0.035),
            rot=(1.25, 0, 0))


# --------------------------------------------------------------------- deck pods
def deck_pods(root):
    for sx in (-1, 1):
        pod = P.rounded_box(f'pod_{sx}', (0.17, 0.22, 0.09), (sx * 0.27, -0.36, 1.05), MOLD(), root, radius=0.03)
        pod.rotation_euler = (0.22, 0, sx * 0.12)
        rk = P.rounded_box(f'pod_rocker_{sx}', (0.045, 0.075, 0.03), (sx * 0.27, -0.37, 1.105),
                           DARK(), root, radius=0.012)
        rk.rotation_euler = (0.22, 0, sx * 0.12)
        P.label(f'pod_icon_{sx}', (0.05, 0.028), M.decal_white(), root, (sx * 0.235, -0.315, 1.10),
                rot=(1.35, 0, sx * 0.12))
    # red battery disconnect on the right pod
    knob = P.rounded_box('disconnect', (0.045, 0.035, 0.065), (0.335, -0.34, 1.115), M.button_red(), root, radius=0.012)
    knob.rotation_euler = (0.35, 0, 0.1)
    # small status display left of the dome, angled to the operator
    P.display('display_pe', 0.11, 0.075, parent=root, loc=(-0.16, -0.315, 1.10),
              rot=(1.15, 0, -0.18), screen_name='screen_pe')


# ------------------------------------------------------- fork carriage + wheels
def carriage(root):
    car = R.empty('rig_carriage', (0, 0, 0), root)
    profile = [(0.30, 0.36), (0.385, 0.36), (0.41, 0.10), (0.46, 0.085),
               (1.70, 0.085), (1.82, 0.072), (1.82, 0.050), (1.64, 0.025),
               (0.36, 0.025), (0.30, 0.10)]
    for sx in (-1, 1):
        P.extrude_profile(f'fork_{"L" if sx < 0 else "R"}', profile, 0.18,
                          M.steel_forks(), car, plane='YZ', bevel=0.006,
                          loc=(sx * 0.25 - 0.09, 0, 0))
        # dark wheel-slot inset on the blade top near the tip
        P.box(f'fork_slot_{sx}', (0.07, 0.24, 0.006), (sx * 0.25, 1.60, 0.084), DARK(), car, bevel=0.002)
    # tie plate between the shanks (hidden under the nose)
    P.box('fork_tie', (0.62, 0.06, 0.26), (0, 0.36, 0.20), M.steel_forks(), car, bevel=0.006)
    # tandem poly load wheels under the tips
    idx = 0
    for sx in (-1, 1):
        for wy in (1.54, 1.66):
            P.wheel_poly(f'rig_loadWheel_{idx}', 0.034, 0.055, parent=car,
                         loc=(sx * 0.25, wy, 0.034), hub=False)
            idx += 1
    # black load backrest bolted to the weldment, in front of the nose
    P.load_backrest('load_backrest', 0.80, 1.02, parent=car, loc=(0, 0.475, 0.10))
    # lift cylinders + hoses in the gap behind the backrest
    for sx in (-1, 1):
        P.cyl(f'lift_cyl_{sx}', 0.021, 0.20, (sx * 0.17, 0.42, 0.30), BLACK(), car)
        P.cyl(f'lift_rod_{sx}', 0.012, 0.14, (sx * 0.17, 0.42, 0.46), M.chrome_rod(), car)
    P.tube('hose_run', [(0.24, 0.38, 0.55), (0.27, 0.45, 0.38), (0.24, 0.47, 0.20)],
           0.008, M.grip_rubber(), root)
    return car


def running_gear(root):
    P.wheel_poly('rig_driveWheel', 0.125, 0.10, M.rubber_tire(), root, loc=(0, -0.02, 0.125))
    for i, sx in enumerate((-1, 1)):
        P.wheel_poly(f'caster_{i}', 0.054, 0.045, parent=root, loc=(sx * 0.37, -0.33, 0.054), hub=False)


# ------------------------------------------------------------- rider platform
def platform(root):
    # structural floor box, low skirt so it reads grounded
    P.rounded_box('platform_floor', (0.94, 0.84, 0.15), (0, -0.955, 0.115), BLACK(), root, radius=0.02)
    dot_mat('platform_mat', (0.78, 0.62), root, (0, -0.96, 0.196))
    pad = P.rounded_box('presence_pad', (0.42, 0.50, 0.035), (0, -0.97, 0.215), M.grip_rubber(), root, radius=0.015)
    R.tag_control(pad, 'presence', 'Operator presence floor pad', 'button', False)
    # rear bumper
    P.rounded_box('bumper', (0.94, 0.12, 0.13), (0, -1.44, 0.11), DARK(), root, radius=0.045)
    # tall padded side wings
    for sx in (-1, 1):
        P.rounded_box(f'wing_{sx}', (0.055, 0.86, 1.06), (sx * 0.4475, -1.02, 0.72), MOLD(), root, radius=0.025)
        P.box(f'wing_seam_{sx}', (0.004, 0.005, 0.9), (sx * 0.477, -1.02, 0.68), DARK(), root, bevel=0.0015)
        P.rounded_box(f'wing_pad_{sx}', (0.022, 0.52, 0.5), (sx * 0.428, -1.06, 0.85), M.grip_rubber(), root, radius=0.01)
        P.rounded_box(f'wing_amber_{sx}', (0.012, 0.19, 0.04), (sx * 0.478, -1.33, 1.19), ORANGE(), root, radius=0.005)
        # molded storage tray on the wing top front
        P.rounded_box(f'tray_{sx}', (0.15, 0.30, 0.09), (sx * 0.42, -0.76, 1.29), MOLD(), root, radius=0.03)
        P.box(f'tray_inset_{sx}', (0.10, 0.22, 0.03), (sx * 0.42, -0.73, 1.325), DARK(), root, bevel=0.008)
    # cup holder on the right tray
    P.cyl('cup_holder', 0.042, 0.05, (0.42, -0.88, 1.32), DARK(), root, bevel=0.006)
    # rear backrest: frame, twin cushions, curved cap, amber strip
    P.rounded_box('backrest_frame', (0.68, 0.10, 0.95), (0, -1.47, 0.95), MOLD(), root, radius=0.04)
    P.rounded_box('backrest_col', (0.30, 0.09, 0.34), (0, -1.46, 0.32), BLACK(), root, radius=0.02)
    for sx in (-1, 1):
        P.rounded_box(f'backrest_pad_{sx}', (0.28, 0.09, 0.74), (sx * 0.165, -1.425, 0.99),
                      M.seat_vinyl(), root, radius=0.045)
    P.rounded_box('backrest_cap', (0.70, 0.13, 0.15), (0, -1.465, 1.44), MOLD(), root, radius=0.06)
    P.rounded_box('backrest_amber', (0.56, 0.02, 0.045), (0, -1.408, 1.38), ORANGE(), root, radius=0.008)
    P.text_mesh('logo_rear', 'CROWN', 0.06, 0.0018, M.decal_dark(), root,
                loc=(0, -1.532, 1.18), facing='-Y')
    P.label('label_platform', (0.11, 0.07), M.warning_amber(), root, (-0.30, -0.60, 0.9),
            rot=(0, 0, 0), text='!', text_mat=M.decal_dark())


def build():
    root = R.empty('rig_root')
    power_unit(root)
    tiller(root)
    deck_pods(root)
    carriage(root)
    running_gear(root)
    platform(root)
    # Standing eye: 0.196 m rider platform mat + 1.63 m standing eye height.
    R.empty('rig_cameraMount', (0, -1.2, 1.83), root)
    root['spec'] = 'Crown PE 4500-60'
    root['walkie'] = False
    root['platform'] = True
    return {
        'name': 'crown_pe4500',
        'cab_view': {'loc': (0.0, -1.35, 1.55), 'target': (0.0, 0.1, 0.85), 'focal': 19},
        'closeups': {
            'head': {'loc': (0.55, -1.1, 1.62), 'target': (0.0, -0.38, 1.28), 'focal': 40},
            'platform': {'loc': (-1.5, -2.3, 1.5), 'target': (0.0, -0.9, 0.7), 'focal': 32},
            'nose': {'loc': (1.35, 1.9, 0.95), 'target': (0.0, 0.4, 0.5), 'focal': 35},
        },
    }
