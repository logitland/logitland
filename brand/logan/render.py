"""Render a saved Logan pose without changing the master .blend file.

blender --background brand/logan/logan.blend --python brand/logan/render.py -- neutral
The other outputs are 'hello', 'three-quarter', 'rear', and 'transparent'.
"""
from pathlib import Path
import sys
import bpy
from mathutils import Vector

pose=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'neutral'
if pose not in {'neutral','hello','three-quarter','rear','transparent'}:
    raise ValueError('Choose neutral, hello, three-quarter, rear, or transparent')
scene=bpy.data.scenes['LOGAN']
if bpy.context.window:
    bpy.context.window.scene=scene
scene.frame_set(40 if pose=='hello' else 1)
if pose in {'three-quarter','rear'}:
    scene.camera.location=(10,-16,8) if pose=='three-quarter' else (10,18,8)
    scene.camera.rotation_euler=(Vector((0,0,3.65))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.film_transparent=pose=='transparent'
bpy.data.objects['Studio / floor'].hide_render=pose=='transparent'
scene.render.resolution_x=1600
scene.render.resolution_y=1600
scene.render.resolution_percentage=100
scene.cycles.samples=96
scene.render.filepath=str(Path(bpy.data.filepath).parent/'renders'/f'logan-{pose}.png')
bpy.ops.render.render(write_still=True)
