# ProLTO truck asset builder. Run inside Blender:
#   blender -b -P assets-src/build.py -- --truck crown_rr5725 [--render] [--export] [--views hero,side]
#
# Truck modules live in assets-src/trucks/<name>.py and expose build() -> rig dict
# (see lib/rig.py for the node-naming contract shared with src/sim/vehicleFactory.js).
import argparse
import importlib
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from lib import qa, rig, scene  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--truck', required=True)
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--export', action='store_true')
    parser.add_argument('--views', default='hero,side,rear34,cab')
    parser.add_argument('--samples', type=int, default=48)
    parser.add_argument('--out', default=os.path.join(REPO, 'qa', 'blender'))
    args = parser.parse_args(argv)

    scene.reset()
    module = importlib.import_module(f'trucks.{args.truck}')
    truck = module.build()

    if args.render:
        out_dir = os.path.join(args.out, args.truck)
        qa.render_views(truck, out_dir, views=args.views.split(','), samples=args.samples)
    if args.export:
        export_dir = os.path.join(REPO, 'public', 'models')
        os.makedirs(export_dir, exist_ok=True)
        rig.export_glb(os.path.join(export_dir, f'{args.truck}.glb'))
    print(f'BUILD OK {args.truck}')


main()
