"""PBR material library.

Only flat Principled values survive glTF export (procedural node trees do not),
so every material here is built from exportable channels: base color, metallic,
roughness, clearcoat (KHR_materials_clearcoat), emission. Realism comes from
geometry quality plus disciplined physical values. Paint is clearcoated and
tight, structural steel is semi-gloss, rubber is near-matte, plastics sit in
between. Keep the palette consistent across the fleet.

SURFACE DETAIL IS ADDED AT RUNTIME, AND MATERIAL NAMES ARE A CONTRACT.
Because nothing here bakes to an image, the exported GLBs contain no textures at
all, and flat roughness across a whole vehicle is the strongest "this is CG" tell
there is. src/sim/surfacing.js compensates by baking procedural roughness, relief
and grime in the browser and binding it to materials BY NAME. Renaming a material
below therefore silently changes how it looks in the simulator. That is a build
failure, not a warning: scripts/verify-surfacing.mjs asserts every shipped
material is explicitly mapped or explicitly excluded. Add new materials there in
the same change.
"""
import bpy

_cache = {}


def _srgb(hexcode):
    c = [((hexcode >> shift) & 0xFF) / 255 for shift in (16, 8, 0)]
    # sRGB -> linear
    return tuple((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1.0,)


def _set(node, name, value, *fallbacks):
    for key in (name,) + fallbacks:
        socket = node.inputs.get(key)
        if socket is not None:
            socket.default_value = value
            return


def pbr(name, color, roughness=0.5, metallic=0.0, clearcoat=0.0, clearcoat_roughness=0.25,
        emission=None, emission_strength=0.0):
    key = name
    if key in _cache:
        return _cache[key]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    rgba = _srgb(color) if isinstance(color, int) else color
    _set(bsdf, 'Base Color', rgba)
    _set(bsdf, 'Roughness', roughness)
    _set(bsdf, 'Metallic', metallic)
    if clearcoat:
        _set(bsdf, 'Coat Weight', clearcoat, 'Clearcoat')
        _set(bsdf, 'Coat Roughness', clearcoat_roughness, 'Clearcoat Roughness')
    if emission is not None:
        ergba = _srgb(emission) if isinstance(emission, int) else emission
        _set(bsdf, 'Emission Color', ergba, 'Emission')
        _set(bsdf, 'Emission Strength', emission_strength or 1.0)
    _cache[key] = mat
    return mat


# ---- Fleet palette -----------------------------------------------------------
def crown_ivory():
    return pbr('crown_ivory', 0xD8D5CA, roughness=0.32, metallic=0.0, clearcoat=0.6, clearcoat_roughness=0.18)

def raymond_red():
    return pbr('raymond_red', 0xB9231F, roughness=0.34, metallic=0.0, clearcoat=0.6, clearcoat_roughness=0.2)

def safety_orange():
    return pbr('safety_orange', 0xE8930C, roughness=0.4, metallic=0.0, clearcoat=0.35)

def mast_steel():
    """Rolled mast channel: near-black satin structural steel."""
    return pbr('mast_steel', 0x17191B, roughness=0.42, metallic=0.75)

def frame_black():
    """Painted black frame / guard steel."""
    return pbr('frame_black', 0x1B1E20, roughness=0.5, metallic=0.35)

def steel_dark():
    return pbr('steel_dark', 0x2E3437, roughness=0.45, metallic=0.7)

def chrome_rod():
    """Polished hydraulic cylinder rod."""
    return pbr('chrome_rod', 0xC8CCCE, roughness=0.08, metallic=1.0)

def steel_forks():
    """Fork steel. Worn tips read lighter; keep mid-dark satin."""
    return pbr('steel_forks', 0x3A3E41, roughness=0.38, metallic=0.85)

def chain_steel():
    return pbr('chain_steel', 0x505456, roughness=0.35, metallic=0.9)

def rubber_tire():
    return pbr('rubber_tire', 0x0E0F10, roughness=0.92, metallic=0.0)

def poly_wheel():
    """Polyurethane load/drive wheel: deep amber-black, slight sheen."""
    return pbr('poly_wheel', 0x241A12, roughness=0.55, metallic=0.0)

def plastic_molded():
    """Molded compartment plastic: dark warm gray."""
    return pbr('plastic_molded', 0x24272A, roughness=0.62, metallic=0.0)

def plastic_dark():
    return pbr('plastic_dark', 0x131618, roughness=0.55, metallic=0.0)

def grip_rubber():
    return pbr('grip_rubber', 0x191C1E, roughness=0.85, metallic=0.0)

def floor_mat():
    return pbr('floor_mat', 0x1A1D1F, roughness=0.95, metallic=0.0)

def seat_vinyl():
    return pbr('seat_vinyl', 0x141618, roughness=0.75, metallic=0.0)

def decal_white():
    return pbr('decal_white', 0xF2F3F3, roughness=0.35, metallic=0.0)

def decal_dark():
    return pbr('decal_dark', 0x26292B, roughness=0.35, metallic=0.0)

def screen_glass():
    return pbr('screen_glass', 0x0A1214, roughness=0.15, metallic=0.0, emission=0x1E4C50, emission_strength=0.9)

def warning_amber():
    return pbr('warning_amber', 0xD9A126, roughness=0.4, metallic=0.0)

def button_red():
    return pbr('button_red', 0xC22B24, roughness=0.42, metallic=0.0)
