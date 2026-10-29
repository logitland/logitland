# Logan

Open **logan.blend** in Blender 5.2 or newer. It contains the character, a 32-bone
rig, editable materials, studio lights, a portrait camera, and the packed concept
image. The side and back geometry interpret the single supplied front reference.

## Pose and render

1. Choose frame **1** for neutral or **40** for the wave.
2. Select **LOGAN · Pose me** in the Pose rig collection. Enable viewport Overlays
   and enter **Pose Mode**. Rotate the named body, arm, leg, hand, and finger bones.
   This is an FK rig: move the legs and feet with their bones.
3. Set **blink_L**, **blink_R** (0–1), and **screen_brightness** under the rig's
   **Object Properties → Custom Properties**. Insert keyframes to keep pose edits
   when moving along the timeline.
4. Press **F12** to render. The PNGs in `renders/` are 1600 × 1600; the master is
   set to 1200 × 1200 for quicker previews.

`root` moves the whole character. `torso` carries the jacket and arms; `head`
carries the face and headset. Each mesh has a single rigid bone assignment.
The hidden Reference collection contains the source image. The original image
also lives in `reference/logan.png`.

## Rebuild or render from the terminal

On macOS, use `/Applications/Blender.app/Contents/MacOS/Blender` for `blender`:

```sh
blender --background --python brand/logan/build.py
blender --background brand/logan/logan.blend --python brand/logan/render.py -- neutral
blender --background brand/logan/logan.blend --python brand/logan/render.py -- hello
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
can discover its tools. The current session used the same official bridge through
its Python client; a separate MCP handshake and scene query verified all 26 tools
were discoverable.
