"""Replace only the current character's head with the approved head-study asset.

Run in the full-body scene. Keeps the body, pose animation, studio and UI state;
rebinds the imported head to the existing rig and restores its face controls.
"""
from pathlib import Path

import bpy
from mathutils import Matrix

HERE = Path(__file__).resolve().parent
scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
collection = bpy.data.collections['01 · Logan / meshes']
prefixes = ('Head /', 'Headset /', 'Face /', 'Screen /')
old_parts = [o for o in collection.objects if o.name.startswith(prefixes)]
before = set(bpy.data.objects)
with bpy.data.libraries.load(str(HERE / 'head-study.blend'), link=False) as (source, target):
    target.collections = ['HEAD · isolated shape study']
study = target.collections[0]
scene.collection.children.link(study)
bpy.context.view_layer.update()
parts = [o for o in study.objects if o.type == 'MESH']
assert len(parts) == 31, 'The approved head must contain its complete assembly'
matrices = {o: o.matrix_world.copy() for o in parts}

for obj in old_parts:
    bpy.data.objects.remove(obj, do_unlink=True)
for obj in parts:
    # The study stores the neutral geometry in world space. Bake its controller
    # transform before binding, so the current head pose applies exactly once.
    world = matrices[obj]
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    obj.data.transform(world)
    obj.name = obj.name.removesuffix(' · study')
    if obj.name == 'Head / faceted shell study':
        obj.name = 'Head / faceted shell'
    obj.vertex_groups.clear()
    group = obj.vertex_groups.new(name='head')
    group.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    obj.parent = rig
    obj.matrix_parent_inverse = Matrix.Identity(4)
    modifier = obj.modifiers.new('Head pose', 'ARMATURE')
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    collection.objects.link(obj)
    study.objects.unlink(obj)

    # Material drivers loaded from another file must use this character's rig.
    for material in obj.data.materials:
        tree = material.node_tree if material else None
        if tree and tree.animation_data:
            for curve in tree.animation_data.drivers:
                for variable in curve.driver.variables:
                    for target in variable.targets:
                        if target.data_path == '["screen_brightness"]':
                            target.id = rig

for side in ('L', 'R'):
    eye = bpy.data.objects['Face / eye.' + side]
    glint = bpy.data.objects['Face / eye pixel.' + side]
    eye_z = sum(v.co.z for v in eye.data.vertices) / len(eye.data.vertices)
    glint_z = sum(v.co.z for v in glint.data.vertices) / len(glint.data.vertices)
    for obj, centre in ((eye, eye_z), (glint, glint_z)):
        for vertex in obj.data.vertices:
            vertex.co.z -= centre
        obj.location.z = centre
        driver = obj.driver_add('scale', 2).driver
        driver.expression = 'max(0.06, 1-blink)'
        variable = driver.variables.new()
        variable.name = 'blink'
        variable.targets[0].id = rig
        variable.targets[0].data_path = f'["blink_{side}"]'
    driver = glint.driver_add('location', 2).driver
    driver.expression = f'{eye_z} + {glint_z - eye_z} * (1-blink)'
    variable = driver.variables.new()
    variable.name = 'blink'
    variable.targets[0].id = rig
    variable.targets[0].data_path = f'["blink_{side}"]'

# Remove imported controller/dependency objects, never existing scene objects.
for obj in set(bpy.data.objects) - before - set(parts):
    bpy.data.objects.remove(obj, do_unlink=True)
bpy.data.collections.remove(study)
# The crystal underside no longer reaches the collar's outer rim. Extend the
# existing neck down inside the closed torso instead of leaving it suspended
# inside the hollow collar. Keep the head and the upper neck surface unchanged.
neck = bpy.data.objects['Neck / swivel']
if not neck.get('seated_in_torso'):
    bottom = min(v.co.z for v in neck.data.vertices)
    top = max(v.co.z for v in neck.data.vertices)
    for vertex in neck.data.vertices:
        vertex.co.z -= .25 * (top - vertex.co.z) / (top - bottom)
    neck['seated_in_torso'] = True
bpy.context.view_layer.update()
scene['approved_head'] = 'head-study.blend'
print(f'Integrated {len(parts)} approved head meshes into {scene.name}')
