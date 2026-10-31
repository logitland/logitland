# Logan

The current deliverable is a static avatar render. Frames 1, 40 and 80 select
individual pose presets; motion between them is not an animation deliverable.
GIF work is deferred until requested.

Open **logan.blend** in Blender 5.2 or newer. It contains the character, a 38-bone
rig, editable gradient materials, neon bloom, studio lights, a portrait camera,
and the packed full-body concept image. The side and back geometry interpret the
supplied front reference.

The saved jacket and pants studies are integrated into the master. Both garments
retain their hollow construction, materials and deformation weights. The hands
and arm bones follow the jacket's inward sleeve position. The master keeps its
neutral, wave and crossed-arms poses; the pants study's knee-bend pose remains in that study.
`integrate-clothes.py` refreshes both garments from their saved study files;
`build.py` imports them automatically after the head, followed by the approved hands
and shoes. `integrate-shoes.py` refreshes the boots from their saved study while
preserving the master's foot poses. Run `fit-body.py` after refreshing studies
to rebuild the internal body and reconnect clothing clearance modifiers.

```sh
blender --background brand/logan/logan.blend --python-exit-code 1 --python brand/logan/integrate-clothes.py --python brand/logan/fit-body.py --python brand/logan/fit-jacket-motion.py --python brand/logan/verify-fit.py --python-expr "import bpy; bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)"
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
to inspect the pair. Both hands use the master's bone names; integration fits their wrists to the cuffs.
The palm occupies more of the hand's length; the fingers taper straight toward
their tips. The approved hands are integrated into `logan.blend` at the fitted
cuffs. `integrate-hands.py` aligns their wrists with the forearms and seats their
palms beyond the cuff rims. In the A-pose the thumbs face forward and palms face
down; the wave turns its raised palm toward the viewer. The underlying arms extend into the hands.
It imports matching finger/thumb rest joints and sets the wave's outward finger
spread while preserving the body animation.

`shoes-study.blend` contains two boots with sloping insteps, two integral raised
straps, faceted toe boxes, layered soles and open ankle collars. Four transverse
tread pads are extruded from each sole. Aubergine heel panels and recessed pink
lights shape the rear and outer quarters. Each boot includes its inner lining and
all details in one continuous mesh. Frame **40** rotates the feet
to inspect their articulation. The study contains only shoes, their rig and studio.

```sh
blender --background --python-exit-code 1 --python brand/logan/hands-shoes-study.py -- hands
blender --background --python-exit-code 1 --python brand/logan/hands-shoes-study.py -- shoes
blender --background brand/logan/hands-study.blend --python-exit-code 1 --python brand/logan/verify.py --python brand/logan/render-hands-shoes.py
blender --background brand/logan/shoes-study.blend --python-exit-code 1 --python brand/logan/verify.py --python brand/logan/render-hands-shoes.py
```

Both approved studies are integrated into `logan.blend` and remain separate
editable sources. Refreshing garments preserves the fitted hand rest joints.
The hand study's curl and spread poses and the master's
neutral and wave poses pass geometry checks. The shoe renders include an underside
view in `renders/shoes-sole.png`. `renders/logan-wrists.png` records front, side
and rear close-ups of the fitted hands in neutral and wave poses.

```sh
blender --background brand/logan/logan.blend --python-exit-code 1 --python brand/logan/integrate-hands.py --python brand/logan/fit-body.py --python brand/logan/verify-fit.py --python-expr "import bpy; bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)"
```

## Internal body and clothing clearance

The `Body /` meshes form a simple graphite torso, continuous arms and continuous
legs. They overlap the pelvis, hands and boots and follow the existing rig,
with blended elbow, knee and wrist weights. The head deliberately floats above
the collar; there is no neck mesh. Hide the jacket, collar, cuffs and
trousers to inspect them; `renders/logan-body.png` shows this view.

Cuffs flex with the wrists and have a driven corrective shape for sideways bends.
Two hidden clothing bones transfer wrist bending without twisting the cuffs when
the palms turn.
Raising either arm slides its sleeve and cuff slightly up the forearm and draws
the coat's side, back and hem upward. `fit-jacket-motion.py` spreads armhole weights
and builds editable pose-driven cloth corrections; this is not a cloth simulation.
The sleeve sections retain their width during the cloth solve, with volume-preserving
armature deformation at the shoulder and elbow.
The neutral garment keeps its approved shape. `render-jacket-motion.py` provides
front, side, rear and halfway-wave views; `verify-fit.py` also checks intermediate,
mirrored and forward/back arm raises.
The tucked trouser hems follow the feet, blending into the shins. Shrinkwrap
modifiers keep the garment openings clear of hands and boots.
`fit-clearance.py` resolves head contact locally on the existing garment vertices,
sampling faces and edges as well as vertices. The shell allowance is .045 scene
units, including its .018 lining. The contact proxy is the convex envelope of
the head assembly. Deeply concave gaps still need visual inspection.
These are live, editable corrections with no subdivision or simulation bake.

Hand contact uses .025 scene units at the cuffs and .015 at the coat and collar.
Close cloth contact takes priority over perfect separation: slight hand/sleeve
intersections are acceptable in the static avatar. To update an existing master,
run `fit-contact-margins.py`, then `fit-crossed-cloth.py` and `pose-presets.py`,
inspect frame 80 and save. These scripts do not save automatically.

`verify-fit.py` checks that the body supports its extremities without clothing
and that the cuffs/hands, sleeves/hands, hems/boots and collar/head do not intersect
across 45 sampled poses, including wrist flexion ±40°, sideways wrist
bends ±25°, ankle flexion ±35°, and head pitch/tilt ±35°. These individual samples
do not guarantee every intermediate, combined or more extreme pose; inspect
those before rendering. `render-fit.py` produces close-ups of the corrections.
The arm checks also cover 90°/120° elbow bends and IK reaches in two planes on
both sides. `render-arms.py` shows those elbows with the sleeves on and off.
The checks also enforce a clothing face budget and zero head-contact displacement
in the clear half-wave pose.
Its zero-intersection checks remain strict
diagnostics; small hand/sleeve overlaps need visual assessment under the close-fit
policy above.

```sh
blender --background brand/logan/logan.blend --python-exit-code 1 --python brand/logan/verify-fit.py
blender --background brand/logan/logan.blend --python-exit-code 1 --python brand/logan/render-fit.py
```

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
  alone does not attach geometry. The floating head is the deliberate exception;
  its face and headset remain attached to its casing.
- Garment details follow the cloth: pocket openings, folded hems, sleeve panels,
  collar colour and coat seams must remain attached through posing.
- Check front, side, rear and bent poses. Contact is necessary; protruding edges
  and the silhouette still need close-up render inspection against the reference.

`verify.py` checks evaluated geometry for connected body and head assemblies in neutral and
wave poses, and closed sleeve, trouser and torso meshes. It catches separated
parts even when they line up convincingly in the front view.

## Pose and render

The face is 2D artwork on `Screen / glass`. Edit `face/face.svg`, then run
`python3 brand/logan/face/render-textures.py` and `style-face.py` in Blender to
refresh the packed PNG layers. The rig's blink controls squash the eye textures.
The `LOGAN / CRT display` shader group applies scanlines and phosphor variation
after the artwork is combined. Its **Image** input can instead take the Color
output of an Image Texture node loaded with a movie or PNG sequence; connect
the `CRT face` UV map to that texture, enable Auto Refresh, and set its frame
start/duration. The screen UV canvas is 1804 × 1128.

1. Choose frame **1** for neutral, **40** for the wave, or **80** for crossed arms.
   `pose-crossed-arms.py` keys the crossed-arms pose and refits its cloth;
   `render.py -- crossed` renders it, and `-- crossed-three-quarter` and
   `-- crossed-rear` render it from the other studio angles. Both elbows bend
   anatomically. The lower right forearm sits inside against the chest, with its
   hand pointing up onto the left bicep. The upper left forearm crosses in front
   and its hand points down into the right arm gap, palm toward the torso.
   The upward hand's bundled fingers curl around the bicep; the tucked fingers
   stay straight. Wrists bend about 40–43°. The poses are held presets:
   `pose-presets.py` makes every rig key constant, so frames between presets
   repeat the previous pose and garment.
   `fit-sleeve-drape.py` adds the hidden **LOGAN · Sleeve drape** armature. The
   jacket and body arms follow it: its shoulders track the pose rig's forward
   movement, and its arm bones aim at the elbow and wrist,
   so the fabric swings with the arm without inheriting the humerus roll that the
   elbow hinge needs. `fit-crossed-cloth.py` reconstructs the driven
   `Crossed arms cloth` shape key from authored posed surfaces stored in
   `crossed-tailoring.npz`. They carry the shoulder forward while retaining coat
   volume, keep the collar base against the neckline, and seat the sleeve mouths
   in the cuffs. The simple body's upper arms fit beneath the padded sleeves.
   The rig's `crossed_cloth`
   property blends the fit and is zero in the neutral and wave poses. In the
   crossed preset it also swings the cuffs after the hands without twist, drops
   their sideways-bend bulge and eases the raised-arm correctives to a quarter,
   which otherwise drag the coat front over the shoulders and pull the sleeves
   out of their cuffs. Hand shrinkwrap is disabled in this preset so the tucked
   fingers can overlap hidden fabric without inflating the sleeve. Small hidden
   overlaps remain intentional; the left fingertips can show from behind.
   Reauthor after changing the crossed pose or garment topology: sculpt the
   corrective keys in frame 80, then run `export-crossed-tailoring.py` to store
   the posed targets. The fitter rejects changed base topology. These targets
   are specific to this still pose, not a live cloth simulation.
   `verify-crossed.py` checks the vertical and depth order, opposite hand directions,
   finger bundling and curl, elbow hinges, wrists under 45°, palm direction,
   hand placement, waist distortion and sleeve openings seated in their cuffs.
   It also checks that frame 66 holds the
   wave exactly. Use solid, wireframe and material views to judge the cloth fit;
   this check does not certify collision-free geometry.
2. Select **LOGAN · Pose me** in the Pose rig collection. Enable viewport Overlays
   and enter **Pose Mode**. Rotate the named body, arm, leg, hand, and finger bones.
   The saved poses use FK: rotate `upper_arm` at the shoulder and `forearm` around
   local Z at the elbow. Move the legs and feet with their bones.
3. Set **blink_L**, **blink_R** (0–1), and **screen_brightness** under the rig's
   **Object Properties → Custom Properties**. Insert keyframes after editing the
   animated pose, before rendering or moving along the timeline.
4. Press **F12** to render. The PNGs in `renders/` are 1600 × 1600; the master is
   set to 1200 × 1200 for quicker previews.

`root` moves the whole character. `torso` carries the jacket and arms; `head`
carries the face and headset. Torso and sleeves share one mesh; both trouser legs
share one pants mesh, with blended joint weights and volume-preserving deformation
at elbows and knees.
The head and boots remain rigid; the cuffs flex at the wrists.
Pose the **armature in Pose Mode**, not the character's mesh objects. Skinned mesh
object transforms are locked and viewport selection is disabled: those transforms
move the bind geometry before its armature deformation; their origins are not joints.
The actual hand bones pivot at the wrists, where their forearms end.

In the 3D View sidebar (**N → Logan**), each arm has two modes:

- **Rotate joints (FK):** select the wrist ring and press **R** to turn the hand.
  Rotate the upper arm and forearm bones to place the arm. Wrist translation is locked.
- **Move wrist (IK):** select the wrist ring and press **G** to place the arm,
  or **R** to orient the palm. The elbow diamond chooses the bend direction.

The buttons snap the controls before switching; inactive controls are hidden.
Press **Store pose**, then save the blend, to retain edits in the current preset.
Saved presets use FK. The crossed coat corrective remains specific to frame 80;
large arm-pose changes require refitting its garment surface.

`setup-pose-controls.py` creates this setup after `rig-arms.py` and aligns the
controls to each preset. Install and enable `logan_pose_tools.py` as a Blender
add-on for the sidebar and IK/FK snapping buttons; it is installed on Mia's Mac.
The bone controls and their drivers are stored in the blend and work without
the add-on, but manually changing the IK properties does not snap arbitrary poses.

`verify-pose-controls.py` checks wrist pivots, hand integrity, solver switching and
stored edits in all three presets. `verify-crossed.py` still encodes the earlier
straight, downward left-hand pose; its hand-direction assertions do not describe
the manually posed crossed preset currently saved in the master.

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
