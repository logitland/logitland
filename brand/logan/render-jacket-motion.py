"""Inspect the fitted coat's draw-up from front, side and rear through a wave."""
from pathlib import Path
import bpy
from mathutils import Vector

scene = bpy.data.scenes['LOGAN']
directory = Path(bpy.data.filepath).parent/'renders'
directory.mkdir(exist_ok=True)
scene.render.resolution_x = scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
target = Vector((0,0,4.65))
scene.camera.data.ortho_scale = 6.1
for label, frame, direction in [('half',20,(3,-12,2)), ('front',40,(0,-12,1)),
                                ('side',40,(12,-3,2)), ('rear',40,(4,12,2))]:
    scene.frame_set(frame)
    scene.camera.location = target+Vector(direction)
    scene.camera.rotation_euler = (target-scene.camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath = str(directory/f'coat-motion-{label}.png')
    bpy.ops.render.render(write_still=True)
