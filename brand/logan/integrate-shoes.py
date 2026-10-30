"""Replace the master's boots with the approved shoe study, retaining foot poses."""
from pathlib import Path
import bpy

HERE = Path(__file__).resolve().parent
scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
collection = bpy.data.collections['01 · Logan / meshes']
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
scene.frame_set(1)
old = [obj for obj in collection.objects if obj.name.startswith('Boot /')]
before = set(bpy.data.objects)
names = ['Boot / continuous.L', 'Boot / continuous.R']
with bpy.data.libraries.load(str(HERE / 'shoes-study.blend'), link=False) as (source, target):
    assert all(name in source.objects for name in names)
    target.objects = names.copy()
parts = target.objects
study_rig = parts[0].parent
for side in ('L', 'R'):
    difference = rig.data.bones['foot.' + side].matrix_local - study_rig.data.bones['foot.' + side].matrix_local
    assert all(abs(value) < 1e-5 for row in difference for value in row), 'Shoe study must match the master foot rig'
for obj in old:
    bpy.data.objects.remove(obj, do_unlink=True)
for name, obj in zip(names, parts):
    obj.name = name
    obj.parent = rig
    obj.hide_render = False
    collection.objects.link(obj)
    obj.hide_set(False)
    for modifier in obj.modifiers:
        if modifier.type == 'ARMATURE':
            modifier.object = rig
for obj in set(bpy.data.objects) - before - set(parts):
    bpy.data.objects.remove(obj, do_unlink=True)
scene['approved_shoes'] = 'shoes-study.blend'
bpy.context.view_layer.update()
print('Integrated approved boots with the master foot poses')
