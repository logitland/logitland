"""Fit the saved garment studies to the full-body master and its existing animation.

Run in LOGAN, then save explicitly. Study meshes, materials, thickness and weights
are imported intact; only the master's arm rest positions and hands follow the
jacket fit. Repeating the import computes the remaining offset, so it cannot drift.
"""
from pathlib import Path

import bpy
from mathutils import Matrix

HERE = Path(__file__).resolve().parent
scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
collection = bpy.data.collections['01 · Logan / meshes']
scene.frame_set(1)
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')

for filename, prefixes, expected in (
    ('jacket-study.blend', ('Jacket /', 'Collar /', 'Sleeve /', 'Cuff /'), 4),
    ('pants-study.blend', ('Trouser /',), 1),
):
    old_parts = [o for o in collection.objects if o.name.startswith(prefixes)]
    before = set(bpy.data.objects)
    with bpy.data.libraries.load(str(HERE / filename), link=False) as (source, target):
        names = [name for name in source.objects if name.startswith(prefixes)]
        target.objects = names.copy()
    parts = target.objects
    assert len(parts) == expected, f'Incomplete garment study: {filename}'
    study_rig = parts[0].parent
    assert study_rig.type == 'ARMATURE'

    if filename == 'jacket-study.blend':
        # The approved sleeve fit changed the arm rest locations. Move the hands
        # with them, while keeping the master's action and facial controls.
        for side in ('L', 'R'):
            bone_name = 'hand.' + side
            offset = (study_rig.data.bones[bone_name].head_local
                      - rig.data.bones[bone_name].head_local)
            for obj in collection.objects:
                if obj.name.startswith(('Hand /', 'Knuckle /')) and obj.name.endswith('.' + side):
                    local_offset = obj.matrix_world.inverted().to_3x3() @ (rig.matrix_world.to_3x3() @ offset)
                    obj.data.transform(Matrix.Translation(local_offset))
        bpy.context.view_layer.objects.active = rig
        rig.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        for side in ('L', 'R'):
            upper = rig.data.edit_bones['upper_arm.' + side]
            for bone in [upper] + list(upper.children_recursive):
                source_bone = study_rig.data.bones[bone.name]
                bone.matrix = source_bone.matrix_local.copy()
                bone.length = source_bone.length
        bpy.ops.object.mode_set(mode='OBJECT')
    else:
        for name in ('pelvis', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R'):
            difference = rig.data.bones[name].matrix_local - study_rig.data.bones[name].matrix_local
            assert all(abs(value) < 1e-5 for row in difference for value in row), f'Pants rest pose mismatch: {name}'

    for obj in old_parts:
        bpy.data.objects.remove(obj, do_unlink=True)
    for name, obj in zip(names, parts):
        obj.name = name
        obj.parent = rig
        for modifier in obj.modifiers:
            if modifier.type == 'ARMATURE':
                modifier.object = rig
        collection.objects.link(obj)
    for obj in set(bpy.data.objects) - before - set(parts):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene['approved_' + ('jacket' if filename.startswith('jacket') else 'pants')] = filename

# Seat the existing neck inside the lined collar. Its narrow former base was
# supported by the old torso's solid cap, which the hollow garment no longer has.
neck = bpy.data.objects['Neck / swivel']
bottom = min(v.co.z for v in neck.data.vertices)
base = [v for v in neck.data.vertices if abs(v.co.z - bottom) < 1e-5]
depth = max(abs(v.co.y) for v in base)
for vertex in base:
    vertex.co.y *= .44 / depth
bpy.context.view_layer.update()
print('Integrated jacket and pants studies; retained master poses, head and shoes')
