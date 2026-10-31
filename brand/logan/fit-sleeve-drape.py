"""Let the sleeves follow the arms without inheriting humerus roll.

blender --background brand/logan/logan.blend --python brand/logan/fit-sleeve-drape.py
Does not save. A hidden drape armature mirrors the torso, arm and hand bones.
Its upper arm and forearm only aim at the elbow and wrist: fabric swings with
the arm but does not twist around it, so a rolled shoulder cannot wring the
sleeve into a spiral. Pure hinge, raise and forward/back rotations match the
pose rig exactly, so the neutral and wave poses are unchanged. The jacket, its
pose-driven cloth shapes and the body arms use this armature; its hands copy
the pose rig, so the body arms still meet the hands. The cuffs, hands, legs
and boots keep the pose rig.
"""
import bpy

NAME = 'LOGAN · Sleeve drape'
SIDES = 'LR'
rig = bpy.data.objects['LOGAN · Pose me']
garments = [bpy.data.objects['Jacket / torso']]
body_arms = [bpy.data.objects['Body / arm.'+side] for side in SIDES]

old = bpy.data.objects.get(NAME)
if old:
    data = old.data
    bpy.data.objects.remove(old)
    bpy.data.armatures.remove(data)
drape = bpy.data.objects.new(NAME, bpy.data.armatures.new(NAME))
for collection in rig.users_collection:
    collection.objects.link(drape)
drape.matrix_world = rig.matrix_world
drape.hide_render = True
mode = bpy.context.object.mode if bpy.context.object else 'OBJECT'
if mode!='OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
active = bpy.context.view_layer.objects.active
selected = list(bpy.context.selected_objects)
for obj in selected:
    obj.select_set(False)
bpy.context.view_layer.objects.active = drape
drape.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, parent in [('torso', None)] + [(f'{bone}.{side}', parent) for side in SIDES for bone, parent in (
        ('upper_arm', 'torso'), ('forearm', 'upper_arm.'+side), ('hand', 'forearm.'+side))]:
    source = rig.data.bones[name]
    bone = drape.data.edit_bones.new(name)
    bone.head, bone.tail = source.head_local, source.tail_local
    bone.matrix = source.matrix_local
    bone.parent = drape.data.edit_bones.get(parent) if parent else None
    bone.use_connect = source.use_connect and parent is not None
bpy.ops.object.mode_set(mode='OBJECT')
drape.select_set(False)
for obj in selected:
    obj.select_set(True)
bpy.context.view_layer.objects.active = active


def constrain(bone, kind, subtarget, head_tail=0.0):
    constraint = drape.pose.bones[bone].constraints.new(kind)
    constraint.target, constraint.subtarget = rig, subtarget
    if kind=='DAMPED_TRACK':
        constraint.head_tail = head_tail
    return constraint


constrain('torso', 'COPY_TRANSFORMS', 'torso')
for side in SIDES:
    constrain('upper_arm.'+side, 'DAMPED_TRACK', 'forearm.'+side)
    constrain('forearm.'+side, 'DAMPED_TRACK', 'forearm.'+side, 1.0)
    constrain('hand.'+side, 'COPY_TRANSFORMS', 'hand.'+side)

for obj in garments+body_arms:
    for modifier in obj.modifiers:
        if modifier.type=='ARMATURE':
            modifier.object = drape
    # Shoulder-elevation correctives measure the sleeve, not the humerus roll.
    keys = obj.data.shape_keys
    for driver in (keys.animation_data.drivers if keys and keys.animation_data else []):
        for variable in driver.driver.variables:
            for target in variable.targets:
                # A previous drape was just deleted, leaving its drivers without a target.
                if target.id in (rig, None) and target.bone_target.startswith('upper_arm.'):
                    target.id = drape
drape.hide_set(True)
bpy.context.view_layer.update()
print('Sleeves follow a roll-free drape armature')
