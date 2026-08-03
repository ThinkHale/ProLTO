# Web reference modeling record

ProLTO's truck meshes are original parametric Blender models reconstructed from publicly available manufacturer product photography, specification sheets, brochures, and operator-area imagery. Manufacturer images are used as visual reference only. They are not copied into the shipped application.

The reconstruction process uses published dimensions where available, repeated visual landmarks across multiple views, known component sizes such as standard fork sections, and perspective comparison from the operator eye point. The resulting assets are designed for interactive assessment and Quest performance. They are not manufacturer CAD and should not be described as manufacturer-approved digital twins.

The build system, rig contract, and visual QA loops are documented in [the asset pipeline](asset-pipeline.md). Source modules live in `assets-src/trucks/`; exported runtime assets live in `public/models/`.

## Reference matrix

| Simulation profile | Primary public references | Geometry and control evidence used |
| --- | --- | --- |
| Crown RR 5725-45 | [RR 5700 specifications](https://www.crown.com/content/dam/crown/pdfs/en-us/brochures/reach-trucks/rr-5700-specifications.pdf) | Published envelope, straddle spacing, standard forks, side-stance compartment, mast, reach mechanism, steering tiller, Multi-Task Control Handle, and foot controls |
| Raymond 7500 Universal Stance | [7500 product page](https://www.raymondcorp.com/forklifts/reach-fork-trucks/7500-universal-stance), [7000 Series brochure](https://www.raymondcorp.com/-/media/raymond/literature/truck-literature/reach-trucks/raymond7000-series-reach-trucks-brochure.pdf?rev=64fe902058ed4c0eacc16698ae86f685) | Universal-stance compartment, red power unit, black mast, outriggers, pantograph, steering control, single-axis control handle, and deadman pedal |
| Crown SP 1500 | [SP 1500 specification sheet](https://www.crown.com/content/dam/crown/pdfs/en-us/specifications/SP-1500-Spec-Sheet-EN-US.pdf), [official overview video](https://www.youtube.com/watch?v=QD3-KCjDMR8) | Man-up platform, nested mast, overhead guard, side gates, operator enclosure, steering and travel controls, and elevated eye point |
| Raymond 5300 | [5300 product page](https://www.raymondcorp.com/forklifts/orderpickers/5300-orderpicker), [5000 Series brochure](https://www.raymondcorp.com/-/media/raymond/literature/truck-literature/order-pickers/raymond5000seriesorderpickersbrochuresipb0107_0406.pdf?rev=43d631e313134d10a4221bd7ce6d7d53) | Front operator enclosure, mast and carriage proportions, overhead guard, side barriers, control console, and elevating platform |
| Crown PE 4500 | [PE product page](https://www.crown.com/en-ca/forklifts/pallet-trucks/pe-end-controlled-rider-pallet-truck.html), [PE 4500 brochure](https://www.crown.com/content/dam/crown/pdfs/en-us/brochures/pallet-trucks/pe-4500-brochure.pdf) | Rounded power unit, end-rider platform, twin front grilles, X10-style control handle, forks, load wheels, and presence area |
| Raymond 8210 | [8210 product page](https://www.raymondcorp.com/forklifts/electric-pallet-jack/8210-walkie-pallet-truck), [8210 brochure](https://www.raymondcorp.com/-/media/raymond/literature/truck-literature/pallet-trucks/8210/raymond-8210-walkie-pallet-truck-brochure-sipb1046.pdf?rev=a68523818d1b4b168c25d7975e173051) | Walk-behind stance, rounded red power unit, tall loop tiller, butterfly throttles, lift rocker, emergency reverse switch, load backrest, forks, and load wheels |
| Crown SC 6200 | [SC product page](https://www.crown.com/en-us/forklifts/electric-counterbalance-forklifts/sc-sit-down-counterbalanced-truck.html), [SC 6200 specification sheet](https://www.crown.com/content/dam/crown/pdfs/en-us/brochures/counterbalance-trucks/sc-6200-spec-sheet.pdf) | Four-wheel counterbalance chassis, rear counterweight, overhead guard, suspension seat, steering column, pedals, hydraulic controls, mast, and carriage |
| Raymond 4460 | [4460 product page](https://www.raymondcorp.com/forklifts/counterbalanced-trucks/4460-sit-down-forklift), [4000 Series sell sheet](https://www.raymondcorp.com/-/media/raymond/literature/truck-literature/counterbalanced-trucks/raymond_4000_series_sit_down_sell_sheet.pdf?rev=e5481d4f7a3f400d8052052f633bab7b) | Three-wheel chassis, tapered red counterweight, black overhead guard, seated control layout, steering wheel, pedals, hydraulic levers, mast, and forks |

## Modeling decisions

- Every family has a separate first-person station, eye point, chassis, control set, interlock behavior, and hydraulic animation.
- Crown and Raymond variants use separate body geometry, stance, wheel arrangement, control placement, color treatment, and model labels.
- Bodywork is lofted from cross-sections and subdivided, so power units carry the compound curvature of pressed and molded covers rather than beveled boxes. Structural members are extruded profiles: mast rails are C-channels, forks are tapered ITA sections with radiused heels.
- Hardware that operators use to recognize a truck is modeled explicitly: mast chains and pulleys, hydraulic cylinders with chrome rods, bolt circles, guard tubing, tread plate, grab bars, labels, and display bezels.
- Nested mast rails, cylinders, chains, carriages, load backrests, outriggers, forks, wheels, guards, seats, pedals, and hand controls are separate meshes so their motion and collision behavior remain legible.
- Only the selected truck is instantiated, and it loads as a single glTF binary. This preserves runtime headroom for warehouse traffic, WebXR rendering, and future sound and training scenarios.

## Visual development references

The modeling boards in `design/stage4-crown-fleet-reference.png` and `design/stage4-raymond-fleet-reference.png` consolidate the observed exterior and operator-area features into consistent perspective sheets. They are design references, not runtime textures.

## Validation boundary

Public sources support recognizable geometry, published dimensions, control families, and rated performance. They do not expose every production option, control detent force, steering map, hydraulic response curve, sound signature, or attachment configuration. Before this simulator contributes to a hiring or authorization decision, the evaluator must confirm the selected profile against the exact truck's current operator manual, data plate, installed options, and workplace conditions.
