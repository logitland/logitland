"""Fit the approved hands and their rest joints to the master's existing wrists."""
from pathlib import Path
from math import radians
import bpy

HERE = Path(__file__).resolve().parent
scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
collection = bpy.data.collections['01 · Logan / meshes']
if bpy.context.object and bpy.context.object.mode!='OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
scene.frame_set(1)
old = [o for o in collection.objects if o.name.startswith(('Hand /','Knuckle /'))]
before = set(bpy.data.objects)
names = ['Hand / continuous.L','Hand / continuous.R']
with bpy.data.libraries.load(str(HERE/'hands-study.blend'),link=False) as (source,target):
    assert all(name in source.objects for name in names)
    target.objects = names.copy()
parts = target.objects
study_rig = parts[0].parent
for side in ('L','R'):
    difference = rig.data.bones['hand.'+side].matrix_local - study_rig.data.bones['hand.'+side].matrix_local
    assert all(abs(v)<1e-5 for row in difference for v in row), 'Hand study wrist must match the fitted cuff'
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for bone in rig.data.edit_bones:
    if bone.name.startswith(('finger','thumb')):
        source = study_rig.data.bones[bone.name]
        bone.matrix = source.matrix_local.copy()
        bone.length = source.length
bpy.ops.object.mode_set(mode='OBJECT')
for obj in old:
    bpy.data.objects.remove(obj,do_unlink=True)
for name,obj in zip(names,parts):
    obj.name = name
    obj.parent = rig
    obj.hide_render = False
    collection.objects.link(obj)
    obj.hide_set(False)
    for modifier in obj.modifiers:
        if modifier.type=='ARMATURE':
            modifier.object = rig
for obj in set(bpy.data.objects)-before-set(parts):
    bpy.data.objects.remove(obj,do_unlink=True)
# The original wave closed the outer fingers toward each other. Use the study's
# spread angles while retaining the master's arm, wrist, head and facial action.
scene.frame_set(40)
for digit,angle in ((1,8),(3,-10)):
    bone = rig.pose.bones[f'finger{digit}.01.L']
    bone.rotation_euler.z = radians(angle)
    bone.keyframe_insert('rotation_euler',frame=40,group=bone.name)
scene.frame_set(1)
scene['approved_hands'] = 'hands-study.blend'
bpy.context.view_layer.update()
print('Integrated approved hands and finger joints at the fitted wrists')
