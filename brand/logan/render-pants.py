"""Inspect trouser silhouette, rear construction, and continuous knee deformation."""
from pathlib import Path

import bpy
from mathutils import Vector

scene = bpy.data.scenes['PANTS STUDY']
scene.render.resolution_x = scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
for name,direction,frame in [('front',(0,-12,1),1),
                             ('three-quarter',(4,-12,3),1),
                             ('rear',(4,12,2),1),
                             ('bent',(8,-12,2),40)]:
    scene.frame_set(frame)
    rotation = (-Vector(direction)).to_track_quat('-Z','Y')
    graph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in bpy.data.collections['01 · Logan / meshes'].objects:
        evaluated = obj.evaluated_get(graph)
        points.extend(rotation.inverted() @ (evaluated.matrix_world @ Vector(p)) for p in evaluated.bound_box)
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    target = rotation @ ((low+high)/2)
    scene.camera.location = target+Vector(direction)
    scene.camera.rotation_euler = rotation.to_euler()
    scene.camera.data.ortho_scale = max(high.x-low.x,high.y-low.y)*1.15
    scene.render.filepath = str(Path(bpy.data.filepath).parent/'renders'/f'pants-{name}.png')
    bpy.ops.render.render(write_still=True)
