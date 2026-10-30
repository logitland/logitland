"""Render front, side and three-quarter views of the isolated head study."""
from pathlib import Path

import bpy
from mathutils import Vector

scene=bpy.data.scenes['HEAD STUDY']
target=Vector((.08,.08,6.44))
scene.render.resolution_x=1200
scene.render.resolution_y=1200
scene.render.resolution_percentage=100
scene.cycles.samples=48
for name,direction in [('front',(0,-10,0)),('side',(-10,0,0)),('three-quarter',(5,-10,2.1))]:
    scene.camera.location=target+Vector(direction)
    scene.camera.rotation_euler=(target-scene.camera.location).to_track_quat('-Z','Y').to_euler()
    scene.camera.data.ortho_scale=3.55
    scene.render.filepath=str(Path(bpy.data.filepath).parent/'renders'/f'head-{name}.png')
    bpy.ops.render.render(write_still=True)
