"""Render elbow deformation and the floating head without altering the saved rig."""
from math import radians
from pathlib import Path
import bpy
from mathutils import Vector

scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
scene.frame_set(1)
rig.animation_data_clear()
scene.render.resolution_x = scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.cycles.samples = 64
directory = Path(bpy.data.filepath).parent/'renders'
directory.mkdir(exist_ok=True)
garments = [obj for obj in bpy.data.collections['01 · Logan / meshes'].objects
            if obj.name.startswith(('Jacket /','Cuff /','Collar /','Trouser /'))]
for angle in (90,120):
    rig.pose.bones['forearm.L'].rotation_euler.z = radians(angle)
    rig.pose.bones['forearm.R'].rotation_euler.z = -radians(angle)
    rig.update_tag()
    bpy.context.view_layer.update()
    for dressed in (True,False):
        for obj in garments:
            obj.hide_render = not dressed
        target = Vector((0,0,3.65)) if dressed else rig.pose.bones['forearm.L'].head+Vector((.35,0,.2))
        scene.camera.location = target+Vector((1,-12,2))
        scene.camera.rotation_euler = (target-scene.camera.location).to_track_quat('-Z','Y').to_euler()
        scene.camera.data.ortho_scale = 8.4 if dressed else 2.6
        scene.render.filepath = str(directory/f'elbow-{angle}-{"clothed" if dressed else "joint"}.png')
        bpy.ops.render.render(write_still=True)
