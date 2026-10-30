# Logan

Open **logan.blend** in Blender 5.2 or newer. It contains the character, a 32-bone
rig, editable gradient materials, neon bloom, studio lights, a portrait camera,
and the packed full-body concept image. The side and back geometry interpret the
supplied front reference.

The saved jacket and pants studies are integrated into the master. Both garments
retain their hollow construction, materials and deformation weights. The hands
and arm bones follow the jacket's inward sleeve position. The master keeps its
neutral and wave poses; the pants study's knee-bend pose remains in that study.
`integrate-clothes.py` refreshes both garments from their saved study files;
`build.py` imports them automatically after the head.

```sh
blender --background brand/logan/logan.blend --python-exit-code 1 --python brand/logan/integrate-clothes.py --python brand/logan/verify.py --python-expr "import bpy; bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)"
```

## Isolated jacket study

`jacket-study.blend` contains one continuous torso-and-sleeves mesh, plus the
collar and two cuffs, with the original logo and continuous sleeve weights. The rig
retains the neutral and wave poses at frames 1 and 40. Edit this file to refine
the jacket separately; the full-body master remains independent.
The windproof shell has a broad storm flap covering the zipper line, a folded
free edge, recessed hand pockets, a turned hem and a lined stand collar.
These garment details are part of the torso or collar surface. The original
SVG is printed on the storm flap, and the outer sleeve lining remains emissive.
The shoulders slope outward from the collar into rounded sleeve crowns, with
shared armhole vertices. The sleeves and arm rig sit laterally inward against
the full-width torso, preserving the original arm angles. The collar has twelve irregular facets and a sagging front edge; a folded
rear yoke, muted magenta seam, contrasting back panels and center pleat shape the back.
The neck, hem, sleeves and cuffs are open, with inward cloth thickness and a dark lining.

```sh
blender --background --python-exit-code 1 --python brand/logan/jacket-study.py
blender --background brand/logan/jacket-study.blend --python-exit-code 1 --python brand/logan/verify.py
blender --background brand/logan/jacket-study.blend --python-exit-code 1 --python brand/logan/render-jacket.py
```

The extraction command creates a fresh study from `logan.blend`, replacing any
existing `jacket-study.blend`. F12 renders its framed three-quarter view.
The historical `refine-jacket.py` and `join-jacket-sleeves.py` require a legacy
extraction with separate sleeves, before garment integration. Do not run them on
the current connected jacket. `refine-jacket.py` rebuilds the torso and collar and applies the fabric
finish. `join-jacket-sleeves.py` cuts torso armholes, removes the sleeve caps,
and builds curved shoulder loops with blended torso/arm skin weights. It trims
buried surfaces where the sleeves overlap the torso into one continuous mesh.
It finishes with `hollow-jacket.py`, which opens the garment and adds its lining.
Save hand edits separately before rebuilding.

## Isolated pants study

`pants-study.blend` contains one hollow cloth shell with an open waistband,
shared crotch and seat, and two continuous legs. Broad diagonal facets shape the
knee folds, the lower legs fill out above tucked hems, and short pink windows
wrap the outer calves in beveled recesses. A rear yoke shapes the upper seat.
Frame **1** is neutral; frame **40** bends the left hip and knee.

```sh
blender --background --python-exit-code 1 --python brand/logan/pants-study.py
blender --background brand/logan/pants-study.blend --python-exit-code 1 --python brand/logan/verify.py --python brand/logan/render-pants.py
```

The builder replaces the pants study from the full-body source. It leaves the
approved jacket study and full-body master unchanged. The renders are
`pants-front.png`, `pants-three-quarter.png`, `pants-rear.png` and `pants-bent.png`.

## Hands and shoes studies

`hands-study.blend` contains two continuous, articulated hands. Each has three
fingers and a thumb joined through palm webbing, broad chamfers, and flexible
knuckle creases. Frame **1** is rest, **40** curls the fingers, and **70** spreads
them. The right hand is hidden in the initial close-up; enable it in the Outliner
to inspect the pair. Both hands retain the master's bone names and wrist positions.
The palm occupies more of the hand's length; the fingers taper straight toward
their tips. Finger and thumb rest joints follow these proportions and must be
copied from the study rig when integrating the meshes into the master.

`shoes-study.blend` contains two boots with sloping insteps, faceted toe boxes,
molded soles and open ankle collars. Each boot includes its inner lining and
recessed emissive panels in one continuous mesh. Frame **40** rotates the feet
to inspect their articulation. The study contains only shoes, their rig and studio.

```sh
blender --background --python-exit-code 1 --python brand/logan/hands-shoes-study.py -- hands
blender --background --python-exit-code 1 --python brand/logan/hands-shoes-study.py -- shoes
blender --background brand/logan/hands-study.blend --python-exit-code 1 --python brand/logan/verify.py --python brand/logan/render-hands-shoes.py
blender --background brand/logan/shoes-study.blend --python-exit-code 1 --python brand/logan/verify.py --python brand/logan/render-hands-shoes.py
```

These studies remain separate from `logan.blend`. Their fit was checked in a
temporary full-body assembly. When integrating, use the hand study's outward
finger-spread angles for the wave: the legacy wave brings the outer fingers
toward the middle finger. The study's curl and spread poses pass checks for
connected surfaces, collapsed faces and self-intersections.

## Isolated head study

`head-study.blend` is a separate head-shape study. Its casing is a convex,
faceted volume with a narrow crown, wide side shoulders and a narrow lower keel.
The front and rear cross-sections and crown/keel retain half-turn symmetry.
Magenta-to-graphite gradients continue across the roof and underside and through
the depth of the side facets.
The display, facial features and headset remain attached to the casing.
The approved head is integrated into `logan.blend` and follows its head bone,
with blink and screen-brightness controls restored. `head-study.blend` remains
the editable source for the head. `integrate-head.py` replaces only the head in
an open full-body scene; `build.py` uses it automatically when rebuilding.
The original `head-study.py` is a historical generator for the pre-integration
body master and refuses to reshape an already integrated character.

```sh
blender --background brand/logan/head-study.blend --python-exit-code 1 --python brand/logan/render-head.py
blender --background brand/logan/head-study.blend --python-exit-code 1 --python brand/logan/verify.py
```

The renders are `head-front.png`, `head-side.png`, `head-three-quarter.png` and
`head-rear.png`; the high rear view exposes the roof and side finish.
The side view shows the side without the headset so the shell silhouette is visible.

## Construction rules

- Every visible part must share surface geometry, be extruded from it, or overlap
  its supporting part. Flat colour and logo details use materials. Parenting to a bone
  alone does not attach geometry.
- Garment details follow the cloth: pocket openings, folded hems, sleeve panels,
  collar colour and coat seams must remain attached through posing.
- Check front, side, rear and bent poses. Contact is necessary; protruding edges
  and the silhouette still need close-up render inspection against the reference.

`verify.py` checks evaluated geometry for a connected assembly in neutral and
wave poses, and closed sleeve, trouser and torso meshes. It catches separated
parts even when they line up convincingly in the front view.

## Pose and render

1. Choose frame **1** for neutral or **40** for the wave.
2. Select **LOGAN · Pose me** in the Pose rig collection. Enable viewport Overlays
   and enter **Pose Mode**. Rotate the named body, arm, leg, hand, and finger bones.
   This is an FK rig: move the legs and feet with their bones.
3. Set **blink_L**, **blink_R** (0–1), and **screen_brightness** under the rig's
   **Object Properties → Custom Properties**. Insert keyframes after editing the
   animated pose, before rendering or moving along the timeline.
4. Press **F12** to render. The PNGs in `renders/` are 1600 × 1600; the master is
   set to 1200 × 1200 for quicker previews.

`root` moves the whole character. `torso` carries the jacket and arms; `head`
carries the face and headset. Torso and sleeves share one mesh; both trouser legs
share one pants mesh, with blended joint weights and volume-preserving deformation
at elbows and knees.
The head, boots, cuffs, and hand segments remain rigid.
The sleeves have fitted shoulder caps, stepped surface panels, and recessed emissive
lining across the whole outer side, wrapping onto the front and rear seams.
The lining and its dark cavity walls share the sleeve's deforming mesh.
The coat is one continuous elliptical body, including the fitted waist, flared hem,
pocket linings, folded pocket hems, rear yoke, centre seam and pleats. The hollow collar overlaps the
coat and neck, with its pink stripe assigned to its own faces. The chest logo uses the
original `apps/web/src/lib/assets/logit.svg`, rasterized intact with resvg into
`reference/logit-texture.png` and packed into the Blender material. UVs preserve
the mark's proportions; its black canvas leaves the underlying cloth visible.
The head has broad crystal facets with a narrow crown and lower keel related by
a 180-degree rotation in side profile, continuous magenta gradients and an inset rear
service panel, vent rows and fasteners.
The hidden Reference collection contains the source image. The original image
also lives in `reference/logan.png`; `logan-original.png` retains the first concept.
The crown and head edges use surface gradients. The compositor adds bloom from
emissive surfaces, with the halo included in the transparent PNG's alpha.

## Rebuild or render from the terminal

On macOS, use `/Applications/Blender.app/Contents/MacOS/Blender` for `blender`:

```sh
blender --background --python brand/logan/build.py
blender --background brand/logan/logan.blend --python brand/logan/render.py -- neutral
blender --background brand/logan/logan.blend --python brand/logan/render.py -- hello
blender --background brand/logan/logan.blend --python brand/logan/render.py -- three-quarter
blender --background brand/logan/logan.blend --python brand/logan/render.py -- rear
blender --background brand/logan/logan.blend --python brand/logan/render.py -- transparent
blender --background brand/logan/logan.blend --python-exit-code 1 --python brand/logan/verify.py
```

Rebuilding replaces `logan.blend`; save hand-edited work under another name first.
Rendering reads the master without saving changes. The transparent output hides
the studio floor and uses an alpha background.

## Blender Lab connection on Mia's Mac

The official [Blender Lab MCP](https://projects.blender.org/lab/blender_mcp) is
installed at `~/.local/share/blender-lab-mcp`, revision
`dbbf836ad4b1025f14a2b3b504c43903f39e0b04`. Its Blender add-on is enabled with
automatic startup, bound to `127.0.0.1:9876`. Blender online access is enabled
because the add-on requires it, including for localhost.

Codex has a global `blender-lab` entry launching
`~/.local/share/blender-lab-mcp/.venv/bin/blender-mcp`. Newly started Codex sessions
can discover its tools. The connection has been verified through an MCP handshake,
scene queries, and execution of the builder in the running Blender instance.
