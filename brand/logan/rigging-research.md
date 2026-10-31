# Logan: established rigging and garment workflows

Researched 2026-10-31. Recommendation, not an implemented rig migration.

## Recommendation

Use **CloudRig for the reusable control rig, deliberate shoulder weights, and
Pose Shape Keys for the final garment corrections**. Connect the collar to the
coat geometrically. Finish the crossed pose with normal arm and finger controls;
use a short cloth settle only if it improves the contact folds. Preserve the
approved meshes, materials, floating head and static pose deliverable.

This follows [Blender Studio's published rigging workflow][studio]: generated
controls, manual weights, then authored corrective shapes. Its tools automate
rig construction and corrective-shape management; they do not automatically
find an attractive crossed-arm pose or repair garment topology.

## What the current file actually has

Read-only inspection of the open `logan.blend`, Blender **5.2.3 LTS**, frame 80:

- Jacket cage: **1,043 vertices**; each hand: **410**. The jacket and hands already
  use Armature Preserve Volume. Enabling it again cannot solve the remaining fit.
- No bone names containing `shoulder` or `clav`. The scripts parent upper arms
  directly to the torso and translate them for protraction. A separate drape
  armature removes sleeve roll, with a scripted crossed-pose garment shape.
- Collar: a separate **72-vertex** mesh with its own armature and contact stack.
  `fit-crossed-cloth.py` corrects the jacket, not the collar seam. This explains
  why matching them at rest does not guarantee attachment when posed.
- Neither hand has a lattice modifier: each has only its Armature modifier.
  The coat currently has shrinkwrap/contact nodes, not a Cloth simulation.
  Hand-target shrinkwrap modifiers are disabled in the crossed preset.
- The live file reported unsaved changes. This research did not save, reload,
  or change it. Source inspection was against commit `7417022`.

## Which established tools address which problems

| Problem | Documented mechanism | Application to Logan / limit |
| --- | --- | --- |
| Awkward arm placement and wrist orientation | CloudRig has shoulder, IK-chain, finger and limb components, pole controls, IK/FK snapping and elbow-axis limits. [Components][cloud-components] | Fit a metarig to Logan's actual joints. Raise/protract the shoulders, place wrists, then choose elbow directions. Controls still need intentional posing and weights. |
| Pinched shoulders and twisted upper sleeves | Weighted armature deformation, segmented deform controls, local correction. Rigify also exposes limb segments and tweaks. [Rigify limbs][limbs] | Spread shoulder deformation over suitable loops. Use a modest number of deform segments; preserve the faceted silhouette. More bones do not repair bad edge flow. |
| Final crossed-pose coat shape | Pose Shape Keys preserves authored corrective results when weights or the rig change. [Studio workflow][studio] | Sculpt the visible shoulder, armpit and elbow forms in the actual pose. Replace the numerical fit where the authored result is better; retain a recoverable baseline. |
| Detached collar | Bridge Edge Loops makes connecting faces or merges boundary loops. [Bridge][bridge] | Reconcile the collar base and neckline into a continuous seam and give them consistent deformation. Joining objects alone does not weld vertices. A hollow garment can have an attached collar while retaining its neck opening. |
| Cloth hovering away from hands/body | Cloth object/self-collision distance explicitly controls separation. Larger distances can produce an air gap. [Collisions][collisions] | Use scale-appropriate small distances and improve solver quality when necessary. Respect the allowed slight hidden overlaps; do not inflate sleeves to satisfy a zero-intersection target. |

### CloudRig versus Rigify

[CloudRig][cloud] is Blender Studio's current rig generator. Its shoulder component
is a simple FK-chain extension, not an automatic anatomical shoulder solver.
Its finger chains and elbow-axis controls provide the ordinary controls missing
from the current ad hoc posing workflow. Local lattice controls are also supported
for small artistic nudges; they are not collision solvers. [Component reference][cloud-components]

[Rigify][rig-features] is a viable alternative with IK/FK snapping, elbow poles,
stretch control and tweak bones. Its finger workflow is particularly explicit:
pose in FK, then optionally use fingertip IK to hold contact. For Logan, that means
orient the palm first, then curl each bundled finger around the bicep; do not bend
the whole hand to fake that contact. [Finger/arm components][limbs]

Choose one generated control rig. **CloudRig is the recommended candidate** because
it aligns with the documented Studio workflow. Porting requires fitting the
metarig, mapping deform weights, rebuilding the three poses, and reconnecting
Logan's head, cuff and face drivers. It is not a drop-in modifier. For a single
still, the smaller alternative is to retain the current rig, add proper shoulder
controls and author the cloth corrective with Pose Shape Keys.

The extension listings currently show **CloudRig 2.2.31** and **Pose Shape Keys
1.1.1**, with Blender 5.0 as the minimum and 6.0+ unsupported. Logan's 5.2.3 falls
within that declared range. Neither extension was installed or exercised on Logan
during this research. [CloudRig listing][cloud-extension], [Pose Shape Keys listing][pose-extension]

### Cloth simulation for a static pose

Blender documents this workflow: clothing starts outside the body in the bind
pose; an Armature modifier precedes Cloth; pin weights retain selected attachment
areas; the body gets Collision physics. Move into the target pose over several
simulation frames rather than teleporting there. Freeze the useful result at the
chosen frame. This temporary settling sequence is an authoring tool, not a new
animation deliverable. [Cloth examples][cloth-examples]

For Logan, try this only after the pose and seam work:

1. Use a clean cloth proxy without solidified thickness or decorative cavities.
   Pin attachment regions and allow sleeve/torso fabric to settle between them.
2. Use the body, hands and head as appropriate collision surfaces; enable cloth
   self-collision for the crossed sleeves. Begin with a non-intersecting state.
3. Transfer useful deformation to the visible jacket with **Surface Deform**,
   which the manual explicitly recommends for cloth proxies. It transfers shape;
   it does not guarantee the visible mesh itself is collision-free. The proxy
   must satisfy its binding constraints. [Surface Deform][surface]
4. Freeze the result as a pose correction, then check the low-poly silhouette and
   make local artistic adjustments. Keep cloth thickness after surface deformation.

Cloth's **Dynamic Mesh** option can update its rest shape from preceding armature
or shape-key deformation for stylized squash/stretch. Pinning controls attachment
strength. Neither is a minimum sleeve-radius constraint. Sleeve volume needs
appropriate starting geometry, body support, stiffness and, where necessary,
an authored corrective. [Cloth shape settings][cloth-shape]

### Useful helpers, not primary fixes

**Corrective Smooth**, placed after the Armature and limited to the shoulder area,
can reduce deformation artifacts without subdividing the model. It can also lose
volume; the manual exposes a scale compensation for this. It cannot reconnect
the collar or resolve contact. Test locally before keeping it. [Corrective Smooth][smooth]

**Lattice / Mesh Deform** provide economical deformation cages. They are useful
for broad shape corrections, but do not know whether a hand is touching a sleeve.
A smaller cage narrows influence; it does not establish physical contact.
[Mesh Deform][mesh-deform], [CloudRig lattice controls][cloud-components]

## First implementation slice and acceptance

The next bounded slice is a separate candidate using CloudRig's shoulders, arms
and fingers with Logan's existing geometry. Establish the crossed pose with
garment contact effects disabled, then repair the collar seam and garment weights.
Author one crossed-pose correction; add simulation only if it earns its complexity.

The upward hand rests on the opposite bicep, with bundled fingers curved around
it. The upper arm's downward hand turns its palm against the torso. Raise the arms
enough to accommodate the thick sleeves. Inspect front, both sides, rear and top:
no collar separation, shoulder collapse, reversed fingers or conspicuous air gaps.
Small hidden hand/cloth overlap is acceptable. Preserve neutral and wave poses,
the floating head and approved art. Replace the live master only after comparing
that candidate visually; preserve the live unsaved state first.

[studio]: https://studio.blender.org/tools/artist-guide/asset-creation/rigging
[cloud]: https://studio.blender.org/tools/addons/cloudrig/introduction
[cloud-components]: https://studio.blender.org/tools/addons/cloudrig/cloudrig-types
[cloud-extension]: https://extensions.blender.org/add-ons/cloudrig/
[pose-extension]: https://extensions.blender.org/add-ons/pose-shape-keys/
[rig-features]: https://docs.blender.org/manual/en/latest/addons/rigify/rig_features.html
[limbs]: https://docs.blender.org/manual/en/latest/addons/rigify/rig_types/limbs.html
[bridge]: https://docs.blender.org/manual/en/latest/modeling/meshes/editing/edge/bridge_edge_loops.html
[collisions]: https://docs.blender.org/manual/en/latest/physics/cloth/settings/collisions.html
[cloth-examples]: https://docs.blender.org/manual/en/latest/physics/cloth/examples.html
[cloth-shape]: https://docs.blender.org/manual/en/latest/physics/cloth/settings/shape.html
[surface]: https://docs.blender.org/manual/en/latest/modeling/modifiers/deform/surface_deform.html
[smooth]: https://docs.blender.org/manual/en/latest/modeling/modifiers/deform/corrective_smooth.html
[mesh-deform]: https://docs.blender.org/manual/en/latest/modeling/modifiers/deform/mesh_deform.html
