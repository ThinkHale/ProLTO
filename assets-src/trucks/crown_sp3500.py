"""Crown SP 3500 high-level stockpicker, reconstructed from site video.

This is intentionally a parallel asset. It does not replace crown_sp1500.
The chassis and mast inherit the proven SP geometry and rig contract while the
operator station, controls, glazing and site-era details are rebuilt to match
the supplied older SP 3500 truck.
"""
import math

import bpy

from lib import materials as M
from lib import parts as P
from lib import rig as R
from trucks import crown_sp1500 as base


BLACK = M.frame_black
ORANGE = M.safety_orange


def console(platform, prefix, primary=False):
    """Build the fixed full-width SP 3500 console visible in the site video."""
    molded = M.pbr('sp3500_console_gray', 0x575957, roughness=0.60)
    inset = M.pbr('sp3500_console_inset', 0x252827, roughness=0.72)
    rubber = M.grip_rubber()
    old_amber = M.pbr('sp3500_button_amber', 0xD69B22, roughness=0.52)

    # Deep steel-backed fascia with the slightly crowned top and recessed
    # lower shelf characteristic of the older SP compartment.
    P.rounded_box(f'{prefix}_console_back', (0.91, 0.18, 0.53),
                  (0, -0.05, 0.75), molded, platform, radius=0.026, segments=5)
    P.rounded_box(f'{prefix}_console_top', (0.90, 0.25, 0.10),
                  (0, -0.04, 1.02), molded, platform, radius=0.025, segments=5)
    P.rounded_box(f'{prefix}_lower_pocket', (0.76, 0.17, 0.18),
                  (0, -0.02, 0.44), inset, platform, radius=0.018, segments=5)
    P.box(f'{prefix}_pocket_lip', (0.80, 0.035, 0.045),
          (0, -0.125, 0.53), molded, platform, bevel=0.008)

    # Large left palm steering disk and spinner. The disk is proud of the
    # fascia, not a modern horizontal pod.
    steer = R.empty('rig_steerPivot' if primary else f'{prefix}_steerPivot',
                    (-0.245, -0.155, 0.80), platform)
    P.cyl(f'{prefix}_steer_bezel', 0.174, 0.036, (-0.245, -0.135, 0.80),
          inset, platform, axis='Y', verts=64, bevel=0.008)
    disc = P.cyl(f'{prefix}_steer_disk', 0.151, 0.043, (0, 0, 0),
                 molded, steer, axis='Y', verts=64, bevel=0.009)
    R.tag_control(disc, 'steer', 'SP 3500 steering handwheel', 'radial',
                  False, motion='radial')
    P.cyl(f'{prefix}_steer_spinner', 0.029, 0.075,
          (-0.085, -0.055, -0.075), rubber, steer, axis='Y', verts=36,
          bevel=0.010)
    P.text_mesh(f'{prefix}_steer_brand', 'CROWN', 0.018, 0.0015,
                M.decal_dark(), steer, loc=(0.005, -0.026, -0.022), facing='-Y')

    # Small Access-era status window and indicator row across the top.
    display = P.rounded_box(f'{prefix}_display_bezel', (0.23, 0.030, 0.105),
                            (0.05, -0.155, 0.965), inset, platform,
                            radius=0.011, segments=5)
    screen = P.rounded_box('screen_sp3500', (0.15, 0.009, 0.055),
                           (-0.020, -0.018, 0.004), M.screen_glass(), display,
                           radius=0.006, segments=4)
    P.planar_uv(screen, plane='XZ')
    for index, colour in enumerate((0xB64031, 0xD39C2B, 0xD39C2B, 0x7D9F62)):
        P.cyl(f'{prefix}_indicator_{index}', 0.010, 0.008,
              (0.065 + index * 0.026, -0.018, 0.010),
              M.pbr(f'sp3500_indicator_{index}', colour, roughness=0.32,
                    emission=colour, emission_strength=0.55),
              display, axis='Y', verts=24)

    # Right-hand horizontal multi-task grip in its rectangular recess.
    P.rounded_box(f'{prefix}_handle_recess', (0.31, 0.055, 0.23),
                  (0.255, -0.155, 0.77), inset, platform,
                  radius=0.014, segments=5)
    travel = R.empty('rig_travelPivot' if primary else f'{prefix}_travelPivot',
                     (0.27, -0.205, 0.79), platform)
    grip = P.cyl(f'{prefix}_travel_grip', 0.031, 0.205, (0, 0, 0),
                 rubber, travel, axis='X', verts=40, bevel=0.009)
    R.tag_control(grip, 'travel', 'SP 3500 travel twist grip', 'fore-aft',
                  True, motion='fore-aft', detents=1)
    P.cyl(f'{prefix}_grip_end', 0.041, 0.030, (-0.105, 0, 0),
          rubber, travel, axis='X', verts=36, bevel=0.009)

    # Discrete raise/lower stack immediately inboard of the travel grip.
    lift = R.empty('rig_liftPivot' if primary else f'{prefix}_liftPivot',
                   (0.075, -0.190, 0.80), platform)
    raise_btn = P.rounded_box(f'{prefix}_raise', (0.052, 0.022, 0.058),
                              (0, 0, 0.036), old_amber, lift,
                              radius=0.008, segments=4)
    R.tag_control(raise_btn, 'lift', 'Raise platform', 'vertical', True,
                  motion='vertical', scale=1)
    lower_btn = P.rounded_box(f'{prefix}_lower', (0.052, 0.022, 0.058),
                              (0, 0, -0.036), old_amber, lift,
                              radius=0.008, segments=4)
    R.tag_control(lower_btn, 'lift', 'Lower platform', 'vertical', True,
                  motion='vertical', scale=-1)

    horn = P.rounded_box(f'{prefix}_horn', (0.052, 0.020, 0.040),
                         (0.075, -0.190, 0.89), M.button_red(), platform,
                         radius=0.007, segments=4)
    R.tag_control(horn, 'horn', 'Horn button', 'button', True, motion='button')

    # Older vertical switch bank, key and mushroom disconnect.
    for index, z in enumerate((0.905, 0.855, 0.805, 0.755)):
        P.rounded_box(f'{prefix}_switch_{index}', (0.050, 0.020, 0.030),
                      (0.425, -0.185, z), inset if index != 1 else old_amber,
                      platform, radius=0.005, segments=4)
    key = P.cyl(f'{prefix}_key_bezel', 0.017, 0.012,
                (0.405, -0.180, 0.665), M.steel_dark(), platform,
                axis='Y', verts=28)
    P.box(f'{prefix}_key', (0.009, 0.024, 0.025), (0, -0.010, 0.012),
          inset, key, bevel=0.003, rot=(0, 0, 0.35))
    stop_base = P.cyl(f'{prefix}_disconnect_base', 0.027, 0.014,
                      (0.420, -0.180, 0.970), old_amber, platform,
                      axis='Y', verts=30)
    P.cyl(f'{prefix}_disconnect', 0.032, 0.024, (0, -0.018, 0),
          M.button_red(), stop_base, axis='Y', verts=32, bevel=0.004)


def video_specific_details(root):
    platform = bpy.data.objects.get('rig_platform')
    if platform is None:
        return
    glass = M.pbr('sp3500_safety_glass', 0x26363A, roughness=0.16,
                  clearcoat=0.85, clearcoat_roughness=0.08)
    gray = M.pbr('sp3500_structure_gray', 0x4D504F, roughness=0.57,
                 metallic=0.18)

    # Full forward protective pane from the supplied truck, including the heavy
    # perimeter frame and lower warning-label strip.
    P.box('sp3500_window', (0.87, 0.018, 0.68),
          (0, -0.31, 1.52), glass, platform, bevel=0.008)
    for sx in (-1, 1):
        P.rounded_box(f'sp3500_window_post_{int(sx > 0)}',
                      (0.050, 0.050, 0.82), (sx * 0.46, -0.30, 1.52),
                      BLACK(), platform, radius=0.010)
    P.rounded_box('sp3500_window_header', (0.96, 0.055, 0.055),
                  (0, -0.30, 1.91), BLACK(), platform, radius=0.010)
    P.rounded_box('sp3500_window_sill', (0.96, 0.055, 0.055),
                  (0, -0.30, 1.13), BLACK(), platform, radius=0.010)
    P.label('sp3500_fall_warning', (0.24, 0.12), M.warning_amber(),
            platform, (-0.22, -0.323, 1.24))
    P.label('sp3500_operation_warning', (0.24, 0.12), M.decal_white(),
            platform, (0.21, -0.323, 1.24))

    # Left accessory scanner/camera, yellow tether and cord reel visible in the
    # walkthrough. They matter because they sit directly in the operator view.
    P.rounded_box('sp3500_scanner_body', (0.15, 0.12, 0.16),
                  (-0.50, -0.26, 1.82), M.plastic_dark(), platform,
                  radius=0.035, segments=6)
    P.cyl('sp3500_scanner_lens', 0.030, 0.018,
          (-0.50, -0.335, 1.82), M.screen_glass(), platform,
          axis='Y', verts=36, bevel=0.004)
    P.tube('sp3500_yellow_tether',
           [(-0.52, -0.25, 1.75), (-0.55, -0.23, 1.56),
            (-0.50, -0.22, 1.38), (-0.53, -0.21, 1.18)],
           0.009, ORANGE(), platform, corner_radius=0.06)

    # Clipboard/storage trough and lower structural panel exactly where they
    # dominate the supplied close pass.
    P.rounded_box('sp3500_clipboard_trough', (0.76, 0.16, 0.20),
                  (0, -0.11, 0.31), gray, platform, radius=0.018)
    P.box('sp3500_clipboard', (0.24, 0.012, 0.16),
          (-0.18, -0.205, 0.36), M.pbr('clipboard_brown', 0x8B6744,
                                      roughness=0.78), platform,
          bevel=0.008, rot=(-0.12, 0, 0))

    # The site truck has black safety rails. The orange foreground in the video
    # belongs to a separate cart, not the Crown platform.
    for name in ('gate_loop_0', 'gate_loop_1', 'gate_mid_0', 'gate_mid_1'):
        obj = bpy.data.objects.get(name)
        if obj and obj.data and obj.data.materials:
            obj.data.materials[0] = BLACK()

    # Serial-era side marking. Kept as modeled geometry, not a raster decal.
    P.text_mesh('sp3500_side_model', 'SP 3500', 0.041, 0.0018,
                M.decal_dark(), root, loc=(0.505, -1.05, 0.79), facing='+X')


def build():
    # The base module resolves these globals at runtime, allowing the SP 3500
    # cockpit to share proven mast and platform rigging without copying it.
    original_console = base.console
    base.console = console
    try:
        truck = base.build()
    finally:
        base.console = original_console

    root = bpy.data.objects.get('rig_root')
    video_specific_details(root)
    model_text = bpy.data.objects.get('plat_model')
    if model_text is not None and hasattr(model_text.data, 'body'):
        model_text.data.body = 'SP 3500'
    root['spec'] = 'Crown SP 3500 24V high-level stockpicker, video-matched'
    truck['name'] = 'crown_sp3500'
    truck['closeups'] = {
        'console': {'loc': (1.05, -0.95, 1.50),
                    'target': (0.0, -0.15, 0.85), 'focal': 42},
        'operator': {'loc': (0.75, -1.35, 2.10),
                     'target': (0.0, -0.20, 1.15), 'focal': 38},
        'mast': {'loc': (1.55, 1.40, 1.75),
                 'target': (0.0, -0.15, 1.35), 'focal': 48},
    }
    return truck

