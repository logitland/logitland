"""Render the internal body and live garment corrections without saving the scene."""
from math import radians
from pathlib import Path
import bpy
from mathutils import Vector

scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
directory = Path(bpy.data.filepath).parent/'renders'
directory.mkdir(exist_ok=True)
scene.frame_set(1)
rest = {bone.name: bone.matrix_basis.copy() for bone in rig.pose.bones}
# Rendering reevaluates the current frame. Detach the action in this disposable
# process so it cannot overwrite the inspection poses just before rendering.
rig.animation_data_clear()
scene.render.resolution_x = scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.cycles.samples = 64
views = [
    ('wrist-forward', 'hand.L', 0, 40, 2.15, (3,-10,2)),
    ('wrist-back', 'hand.L', 0, -40, 2.15, (3,-10,2)),
    ('wrist-side', 'hand.L', 2, -25, 2.15, (3,-10,2)),
    ('ankle-up', 'foot.L', 0, 35, 2.6, (4,-10,3)),
    ('ankle-down', 'foot.L', 0, -35, 2.6, (4,-10,3)),
    ('head-forward', 'head', 0, 35, 4.2, (4,-10,1)),
    ('head-side', 'head', 2, -35, 4.2, (4,-10,1)),
]
for label,bone,axis,angle,scale,direction in views:
    for name,matrix in rest.items():
        rig.pose.bones[name].matrix_basis = matrix
    rig.pose.bones[bone].rotation_euler[axis] = radians(angle)
    rig.update_tag()
    bpy.context.view_layer.update()
    target = rig.matrix_world@rig.pose.bones[bone].head
    scene.camera.location = target+Vector(direction)
    scene.camera.rotation_euler = (target-scene.camera.location).to_track_quat('-Z','Y').to_euler()
    scene.camera.data.ortho_scale = scale
    scene.render.filepath = str(directory/f'fit-{label}.png')
    bpy.ops.render.render(write_still=True)

for name,matrix in rest.items():
    rig.pose.bones[name].matrix_basis = matrix
rig.update_tag()
for obj in bpy.data.collections['01 · Logan / meshes'].objects:
    if obj.name.startswith(('Jacket /','Cuff /','Collar /','Trouser /')):
        obj.hide_render = True
scene.camera.location = (8,-18,8)
scene.camera.rotation_euler = (Vector((0,0,3.7))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.ortho_scale = 8.5
scene.render.filepath = str(directory/'logan-body.png')
bpy.ops.render.render(write_still=True)
