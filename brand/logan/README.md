# Logan

Open **logan.blend** in Blender 5.2 or newer. It contains the character, a 32-bone
rig, editable gradient materials, neon bloom, studio lights, a portrait camera,
and the packed full-body concept image. The side and back geometry interpret the
supplied front reference.

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
carries the face and headset. Each sleeve and trouser leg is one connected mesh,
with blended joint weights and volume-preserving deformation at elbows and knees.
The head, boots, cuffs, and hand segments remain rigid.
The sleeves widen through the forearms and taper into octagonal cuffs. Rounded
cross sections give the jacket and trousers volume while retaining flat facets.
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
blender --background brand/logan/logan.blend --python brand/logan/render.py -- transparent
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
