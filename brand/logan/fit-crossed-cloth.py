"""Tailor the continuous coat to the static crossed-arms preset. Does not save.

The stored posed surfaces include shoulder protraction, a full torso, seated
cuffs and an attached collar. Reconstructing their rest-space keys through the
armature follows the posed-mesh corrective workflow; distance-to-bone guesses
must not drag torso vertices into the sleeve. Other presets retain their fit.
These targets belong to the frame-80 pose in pose-crossed-arms.py. A different
crossed pose requires reauthoring the targets, not merely changing bone angles.
"""
from pathlib import Path
import bpy
import numpy as np

FRAME = 80
KEY = 'Crossed arms cloth'
scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
drape = bpy.data.objects['LOGAN · Sleeve drape']
jacket = bpy.data.objects['Jacket / torso']
scene.frame_set(FRAME)
rig['crossed_cloth'] = 1.0
rig.id_properties_ui('crossed_cloth').update(min=0, max=1, description='Garment fit for the crossed-arms preset')


def crossed_driver(owner, path, expression):
    """Switch a contact correction with the static crossed preset."""
    owner.driver_remove(path)
    driver = owner.driver_add(path).driver
    driver.type = 'SCRIPTED'
    driver.expression = expression
    variable = driver.variables.new()
    variable.name = 'c'
    variable.targets[0].id = rig
    variable.targets[0].data_path = '["crossed_cloth"]'


def crossed_factor(driver, factor):
    """Scale an existing raise correction only in the crossed pose."""
    variables = driver.driver.variables
    if 'c' not in variables:
        variable = variables.new()
        variable.name = 'c'
        variable.targets[0].id = rig
        variable.targets[0].data_path = '["crossed_cloth"]'
        base = driver.driver.expression
    else:
        base = driver.driver.expression.rsplit(')*(1-', 1)[0][1:]
    driver.driver.expression = f'({base})*(1-{1-factor:g}*c)'


for side in 'LR':
    cuff = bpy.data.objects['Cuff / band.'+side]
    bone = rig.pose.bones['wrist_cuff.'+side]
    copy = next(c for c in bone.constraints if c.type == 'COPY_ROTATION')
    crossed_driver(copy, 'influence', '1-c')
    swing = bone.constraints.get('Crossed swing') or bone.constraints.new('DAMPED_TRACK')
    swing.name = 'Crossed swing'
    swing.target, swing.subtarget, swing.head_tail = rig, 'hand.'+side, 1.0
    crossed_driver(swing, 'influence', 'c')
    for driver in cuff.data.shape_keys.animation_data.drivers:
        if driver.data_path == 'key_blocks["Wrist side clearance"].value':
            crossed_factor(driver, 0)
for driver in jacket.data.shape_keys.animation_data.drivers:
    if 'Raised arm cloth' in driver.data_path:
        crossed_factor(driver, .25)

# Outside-only shrinkwrap cannot distinguish a tucked hand from a collision.
for name in ('Jacket / torso', 'Collar / raised band', 'Cuff / band.L', 'Cuff / band.R'):
    for modifier in list(bpy.data.objects[name].modifiers):
        if modifier.name == 'Crossed sleeve settle':
            bpy.data.objects[name].modifiers.remove(modifier)
        elif modifier.type == 'SHRINKWRAP' and modifier.target and modifier.target.name.startswith('Hand /'):
            crossed_driver(modifier, 'show_viewport', 'c < .5')
            crossed_driver(modifier, 'show_render', 'c < .5')
bpy.context.view_layer.update()


def pose_shape(obj, name, build):
    """Bake a posed surface into an editable rest-space key without adding faces."""
    if not obj.data.shape_keys:
        obj.shape_key_add(name='Basis')
    keys = obj.data.shape_keys
    if keys.key_blocks.get(name):
        keys.key_blocks[name].driver_remove('value')
        obj.shape_key_remove(keys.key_blocks[name])
    basis = keys.key_blocks[0]
    basis_points = np.array([p.co[:] for p in basis.data])
    enabled = {m.name: m.show_viewport for m in obj.modifiers}

    def evaluate(skinning=True):
        for modifier in obj.modifiers:
            modifier.show_viewport = skinning and modifier.type == 'ARMATURE'
        obj.data.update()
        obj.update_tag(refresh={'DATA'})
        bpy.context.view_layer.update()
        mesh = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
        assert len(mesh.vertices) == len(basis_points)
        return np.array([v.co[:] for v in mesh.vertices])

    try:
        rest, initial = evaluate(False), evaluate()
        probe = obj.shape_key_add(name='Temporary deformation probe', from_mix=False)
        probe.value = 1
        axes = []
        # Fixed armature weights are affine per vertex. A unit probe avoids the
        # cancellation error of tiny offsets around model coordinates near 5.
        for axis in range(3):
            points = basis_points.copy()
            points[:, axis] += 1.0
            probe.data.foreach_set('co', points.ravel())
            axes.append(evaluate()-initial)
        obj.shape_key_remove(probe)
        skin = np.stack(axes, axis=2)
        target = build(rest, initial)
        correction = np.linalg.solve(skin, (target-initial)[:, :, None])[:, :, 0]
        key = obj.shape_key_add(name=name, from_mix=False)
        key.data.foreach_set('co', (basis_points+correction).ravel())
        key.value = 1
        residual = np.linalg.norm(evaluate()-target, axis=1).max()
        assert residual < .00001, f'{name}: mapping error {residual:.6f}'
        crossed_driver(key, 'value', 'c')
    finally:
        for modifier in obj.modifiers:
            modifier.show_viewport = enabled[modifier.name]
        bpy.context.view_layer.update()


# Sculpted outer surfaces are the source of truth for this static avatar.
# Keeping posed targets lets the corrective be recalculated after weight edits.
with np.load(Path(__file__).with_name('crossed-tailoring.npz')) as targets:
    for name, key_name in (
        ('Jacket / torso', KEY),
        ('Collar / raised band', 'Crossed collar seam'),
        ('Body / arm.L', 'Crossed shoulder cap'),
        ('Body / arm.R', 'Crossed shoulder cap'),
    ):
        obj = bpy.data.objects[name]
        basis = obj.data.shape_keys.key_blocks[0].data if obj.data.shape_keys else obj.data.vertices
        coordinates = np.array([p.co[:] for p in basis])
        saved_basis = targets[name+' / basis']
        if coordinates.shape != saved_basis.shape or not np.allclose(coordinates, saved_basis, atol=1e-6, rtol=0):
            raise ValueError(f'{name}: garment topology changed; reauthor the crossed tailoring target')
        target = targets[name+' / posed'].copy()
        pose_shape(obj, key_name, lambda rest, initial: target)

for frame, value in ((1, 0.0), (40, 0.0), (FRAME, 1.0)):
    rig['crossed_cloth'] = value
    rig.keyframe_insert(data_path='["crossed_cloth"]', frame=frame)
scene.frame_set(FRAME)
bpy.context.view_layer.update()
print('Applied authored crossed-pose garment surfaces without adding geometry')
