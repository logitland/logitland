"""Render each extremity study in front, rear, side and articulated close-ups."""
from pathlib import Path
import bpy
from mathutils import Vector

scene = bpy.context.scene
kind = scene['study_kind']
collection = bpy.data.collections['01 · Logan / meshes']
scene.render.resolution_x = scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
views = [
    ('pair',(0,-12,3),1,False),
    ('three-quarter',(4,-12,5),1,True),
    ('rear',(3,12,3),1,True),
    ('side',(12,-1,2),1,True),
    ('posed',(3,-12,5),40,True),
]
if kind=='hands':
    views.append(('spread',(3,-12,5),70,True))
for name,direction,frame,single in views:
    scene.frame_set(frame)
    for obj in collection.objects:
        obj.hide_render = single and obj.name.endswith('.R')
    rotation = (-Vector(direction)).to_track_quat('-Z','Y')
    graph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in collection.objects:
        if obj.hide_render:
            continue
        evaluated = obj.evaluated_get(graph)
        points.extend(rotation.inverted()@(evaluated.matrix_world@Vector(p)) for p in evaluated.bound_box)
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    target = rotation@((low+high)/2)
    scene.camera.location = target+Vector(direction)
    scene.camera.rotation_euler = rotation.to_euler()
    scene.camera.data.ortho_scale = max(high.x-low.x,high.y-low.y)*1.2
    scene.render.filepath = str(Path(bpy.data.filepath).parent/'renders'/f'{kind}-{name}.png')
    bpy.ops.render.render(write_still=True)
