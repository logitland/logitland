"""Render a 17:6 Logan banner from the saved portrait, without changing the studio.

Run in background Blender with avatar-studio.blend. Add -- preview for a draft.
The existing crossed pose and materials carry through; only framing changes.
"""
from pathlib import Path
import runpy
import sys
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
preview = 'preview' in args
scene = bpy.data.scenes['AVATAR · Production']
bpy.context.window.scene = scene
scene.frame_set(80)
camera = scene.camera
camera.data.sensor_fit = 'VERTICAL'
camera.data.sensor_height = 20
camera.data.shift_x = -.65
camera.data.shift_y = -.08
camera.location += camera.rotation_euler.to_matrix() @ Vector((0,0,.7))
scene.render.resolution_x = 1360 if preview else 3400
scene.render.resolution_y = 480 if preview else 1200
scene.render.resolution_percentage = 100
scene.render.use_border = False
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
runpy.run_path(str(HERE/'fit-avatar-background.py'))['fit_background'](scene)
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24 if preview else 64
scene.cycles.use_denoising = True
scene.render.threads_mode = 'FIXED'
scene.render.threads = 8
scene.render.filepath = '/tmp/logan-banner-preview.png' if preview else str(HERE/'renders/logan-banner-3400x1200.png')
bpy.ops.render.render(write_still=True)
