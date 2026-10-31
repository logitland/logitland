"""Render the CRT face close enough to inspect its raster and expression."""
from pathlib import Path
import bpy
from mathutils import Vector

scene = bpy.data.scenes['LOGAN']
scene.frame_set(1)
target = Vector((0,0,6.35))
scene.camera.location = target+Vector((.6,-10,.6))
scene.camera.rotation_euler = (target-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.ortho_scale = 3.35
scene.render.resolution_x = scene.render.resolution_y = 1400
scene.render.resolution_percentage = 100
scene.render.filepath = str(Path(bpy.data.filepath).parent/'renders'/'logan-crt-face.png')
bpy.ops.render.render(write_still=True)
