"""Video-matched Raymond 7500 Universal Stance variant.

This module augments the existing validated Raymond 7500 model and exports to a
parallel filename. The production raymond_7500 asset remains unchanged.
"""
import math

import bpy

from lib import materials as M
from lib import parts as P
from trucks import raymond_7500 as base


def site_details(root):
    red = M.raymond_red()
    white = M.decal_white()
    dark = M.plastic_dark()

    # Lithium battery enclosure and labeling visible on the left walkthrough.
    P.rounded_box('video_lithium_battery_case', (0.75, 0.065, 0.54),
                  (-0.03, 0.455, 0.57), dark, root, radius=0.018,
                  segments=5)
    P.text_mesh('video_lithium_wordmark', 'LITHIUM', 0.065, 0.0022,
                white, root, loc=(-0.39, 0.42, 0.67), facing='-X',
                rot=(0, 0, math.pi / 2))
    P.text_mesh('video_acr_mark', 'ACR', 0.070, 0.0022, white, root,
                loc=(-0.556, 0.16, 1.12), facing='-X')
    P.text_mesh('video_acr_system', 'SYSTEM', 0.025, 0.0018, white, root,
                loc=(-0.556, 0.13, 1.04), facing='-X')

    # Seat-like universal-stance lean pad and crown-shaped headrest from the
    # supplied truck, distinct from a seated operator chair.
    P.rounded_box('video_lean_pad', (0.39, 0.14, 0.52),
                  (0.14, -0.88, 0.82), M.seat_vinyl(), root,
                  radius=0.075, segments=7, rot=(0.06, 0, 0))
    P.rounded_box('video_head_pad', (0.29, 0.14, 0.16),
                  (0.14, -0.91, 1.14), M.seat_vinyl(), root,
                  radius=0.055, segments=7)
    for sx in (-1, 1):
        P.box(f'video_head_slot_{int(sx > 0)}', (0.055, 0.012, 0.050),
              (0.14 + sx * 0.065, -0.985, 1.14), dark, root,
              bevel=0.012)

    # Tablet/terminal mount and articulated bracket shown ahead of the cowl.
    mount = P.tube('video_terminal_arm',
                   [(0.05, -0.10, 1.53), (0.08, -0.02, 1.67),
                    (0.02, 0.06, 1.74)], 0.018, M.frame_black(), root,
                   corner_radius=0.025)
    terminal = P.rounded_box('video_terminal', (0.31, 0.055, 0.23),
                             (0.02, 0.02, 1.78), dark, root,
                             radius=0.022, segments=6, rot=(-0.20, 0, 0))
    screen = P.rounded_box('video_terminal_screen', (0.255, 0.009, 0.174),
                           (0, -0.031, 0), M.screen_glass(), terminal,
                           radius=0.010, segments=5)
    P.planar_uv(screen, plane='XZ')

    # Overhead camera/sensor pods repeated across the truck fleet in the video.
    for index, (x, y) in enumerate(((-0.33, -0.18), (0.33, -0.18),
                                    (-0.33, 0.42), (0.33, 0.42))):
        pod = P.rounded_box(f'video_sensor_pod_{index}', (0.18, 0.12, 0.075),
                            (x, y, 2.37), dark, root, radius=0.025,
                            segments=6)
        P.cyl(f'video_sensor_lens_{index}', 0.023, 0.014,
              (0, -0.065, -0.012), M.screen_glass(), pod,
              axis='Y', verts=32, bevel=0.003)

    # Model-specific warning and data plates on the side shell.
    P.label('video_data_plate', (0.15, 0.11), M.decal_white(), root,
            (0.552, -0.22, 0.78), rot=(0, 0, math.pi / 2))
    P.label('video_warning_plate', (0.15, 0.11), M.warning_amber(), root,
            (-0.552, -0.22, 0.78), rot=(0, 0, -math.pi / 2))


def build():
    truck = base.build()
    root = bpy.data.objects.get('rig_root')
    site_details(root)
    root['spec'] = 'Raymond 7500 Universal Stance 36V, site-video replica'
    truck['name'] = 'raymond_7500_video_replica'
    truck.setdefault('closeups', {})['video_side'] = {
        'loc': (-2.2, -0.35, 1.50), 'target': (0, 0.12, 0.90), 'focal': 52,
    }
    truck['closeups']['video_operator'] = {
        'loc': (0.95, -1.45, 1.88), 'target': (0, -0.38, 1.10), 'focal': 42,
    }
    return truck

