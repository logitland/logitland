"""Fit the approved hands and their rest joints to the master's existing wrists."""
from pathlib import Path
from math import radians
import bpy
import bmesh
from mathutils import Matrix

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
fits = {}
# The approved study labels are anatomically reversed: transfer each complete
# hand to the opposite wrist, including its finger joints and skin weights.
source_side = {'L': 'R', 'R': 'L'}
for side in ('L','R'):
    difference = rig.data.bones['forearm.'+side].matrix_local - study_rig.data.bones['forearm.'+side].matrix_local
    assert all(abs(v)<1e-5 for row in difference for v in row), 'Hand study forearm must match the fitted cuff'
    # The study's palm starts inside the cuff. Seat its narrow wrist in the
    # opening, with the broad palm and thumb root beyond the sleeve rim.
    forearm = rig.data.bones['forearm.'+side]
    wrist = study_rig.data.bones['hand.'+source_side[side]]
    direction = (forearm.tail_local-forearm.head_local).normalized()
    rotation = (wrist.tail_local-wrist.head_local).normalized().rotation_difference(direction).to_matrix().to_4x4()
    fits[side] = Matrix.Translation(forearm.tail_local+direction*.12) @ rotation @ Matrix.Translation(-wrist.head_local)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for bone in rig.data.edit_bones:
    if bone.name.startswith(('hand.','finger','thumb')):
        source = study_rig.data.bones[bone.name[:-1]+source_side[bone.name[-1]]]
        bone.matrix = fits[bone.name[-1]] @ source.matrix_local
        bone.length = source.length
bpy.ops.object.mode_set(mode='OBJECT')
for obj in old:
    bpy.data.objects.remove(obj,do_unlink=True)
for name,obj in zip(names,reversed(parts)):
    for group in obj.vertex_groups:
        if group.name.endswith(('.L','.R')):
            group.name = group.name[:-1]+name[-1]
    obj.name = name
    obj.parent = rig
    obj.data.transform(fits[name[-1]])
    obj.hide_render = False
    collection.objects.link(obj)
    obj.hide_set(False)
    for modifier in obj.modifiers:
        if modifier.type=='ARMATURE':
            modifier.object = rig
    # The clamped bevel produces microscopic slivers at finger webbing that
    # collapse under float precision when rotated. Remove them before skinning.
    bevel = obj.modifiers.get('Broad edge chamfers')
    if bevel:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=bevel.name)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.dissolve_degenerate(bm, dist=.0001, edges=list(bm.edges))
        bm.to_mesh(obj.data)
        bm.free()
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
