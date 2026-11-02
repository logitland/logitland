"""Render in Cycles; -- staging inverts the face, -- master exports a 4096px source.

Open avatar-studio.blend with Blender --background and run this script.
The saved studio is never modified by rendering.
"""
from pathlib import Path
import sys
import runpy
import bpy

args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
variant = 'Staging' if 'staging' in args else 'Production'
if variant == 'Staging':
    runpy.run_path(str(Path(__file__).resolve().parent/'sync-staging.py'))['sync_staging']()
scene = bpy.data.scenes['AVATAR · '+variant]
bpy.context.window.scene = scene
# The live studio may use Eevee and another preset for responsive editing.
# These overrides only affect this render process, never the saved studio.
scene.frame_set(80)
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.render.threads_mode = 'FIXED'
scene.render.threads = 8
if 'preview' in args:
    scene.cycles.samples = 32
    scene.render.resolution_x = scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.filepath = '/tmp/logan-avatar-'+variant.lower()+'-preview.png'
else:
    name = 'logan-staging-avatar' if variant == 'Staging' else 'logan-avatar'
    if 'master' in args:
        scene.cycles.samples = 64
        scene.cycles.use_denoising = True
        scene.render.resolution_x = scene.render.resolution_y = 4096
        scene.render.resolution_percentage = 100
        name += '-4096'
    scene.render.filepath = str(Path(__file__).resolve().parent/'renders'/(name+'.png'))
bpy.ops.render.render(write_still=True)
