"""Tailor the continuous coat to the static crossed-arms preset. Does not save.

Shoulder motion spreads across the sewn armhole. Sleeve openings seat inside
the posed cuffs without inheriting wrist roll. This is a pose-specific shape,
not a cloth simulation: tucked fingers may overlap hidden cloth instead of
inflating the sleeve to force separation. Other presets retain their live fit.
"""
from collections import Counter
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_point_line

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
        for axis in range(3):
            points = basis_points.copy()
            points[:, axis] += .01
            probe.data.foreach_set('co', points.ravel())
            axes.append((evaluate()-initial)/.01)
        obj.shape_key_remove(probe)
        skin = np.stack(axes, axis=2)
        target = build(rest, initial)
        correction = np.linalg.solve(skin, (target-initial)[:, :, None])[:, :, 0]
        key = obj.shape_key_add(name=name, from_mix=False)
        key.data.foreach_set('co', (basis_points+correction).ravel())
        key.value = 1
        residual = np.linalg.norm(evaluate()-target, axis=1).max()
        assert residual < .001, f'{name}: mapping error {residual:.6f}'
        crossed_driver(key, 'value', 'c')
    finally:
        for modifier in obj.modifiers:
            modifier.show_viewport = enabled[modifier.name]
        bpy.context.view_layer.update()


def smoothstep(low, high, value):
    t = max(0, min(1, (value-low)/(high-low)))
    return t*t*(3-2*t)


def coat_shape(rest, initial):
    """Keep shoulder volume, relax the sewn seam, and swing the sleeve mouths."""
    to_jacket = jacket.matrix_world.inverted()
    to_object = to_jacket @ drape.matrix_world
    to_rig = to_jacket @ rig.matrix_world
    bones = ('torso', 'upper_arm.L', 'forearm.L', 'upper_arm.R', 'forearm.R')
    matrices = {name: to_object @ drape.pose.bones[name].matrix @
                drape.data.bones[name].matrix_local.inverted() @ to_object.inverted() for name in bones}

    def segment(name):
        bone = drape.data.bones[name]
        return to_object @ bone.head_local, to_object @ bone.tail_local

    def distance(point, name):
        h, t = segment(name)
        _, along = intersect_point_line(point, h, t)
        return (point-h.lerp(t, max(0, min(1, along)))).length

    axes = {s: tuple(matrices['forearm.'+s] @ p for p in segment('forearm.'+s)) for s in 'LR'}
    reference = initial.copy()
    for i, point in enumerate(map(Vector, rest)):
        side = 'L' if point.x > 0 else 'R'
        h, t = segment('upper_arm.'+side)
        along = (point-h).dot(t-h)/(t-h).length_squared
        radial = distance(point, 'upper_arm.'+side)
        if along < -.25 or along > 1.05 or radial > .75:
            continue
        amount = smoothstep(-.35, .25, along)
        mt, mu = matrices['torso'], matrices['upper_arm.'+side]
        rotation = mt.to_quaternion().slerp(mu.to_quaternion(), amount)
        advance = max(amount, 1-smoothstep(.45, .9, (point-h).length))
        origin = (mt @ h).lerp(mu @ h, advance)
        target = origin + rotation @ (point-h)
        blend = (1-smoothstep(.75, 1.05, along))*(1-smoothstep(.6, .75, radial))
        reference[i] += blend*(np.array(target)-initial[i])
        # The cap stays over the joint instead of rotating down with the arm.
        cap = smoothstep(-.18, .03, point.z-h.z)*(1-smoothstep(.5, .8, (point-h).length))
        cap_point = mt @ point + (mu @ h-mt @ h)
        reference[i] += cap*(np.array(cap_point)-reference[i])

    group_names = {jacket.vertex_groups[name].index: name for name in bones}
    carriers = []
    for vertex in jacket.data.vertices:
        weights = Counter({'': 0})
        for group in vertex.groups:
            name = group_names.get(group.group)
            if name:
                weights['' if name == 'torso' else name[-1]] += group.weight
        carriers.append(weights.most_common(1)[0][0])
    basis = jacket.data.shape_keys.key_blocks[0]
    for side in 'LR':
        cuff = bpy.data.objects['Cuff / band.'+side]
        cuff.data.calc_loop_triangles()
        triangles = [tuple(t.vertices) for t in cuff.data.loop_triangles]
        enabled = {m.name: m.show_viewport for m in cuff.modifiers}
        # Bevel and lining change indices. Sample the original cuff cage.
        for modifier in cuff.modifiers:
            if modifier.type in ('BEVEL', 'SOLIDIFY'):
                modifier.show_viewport = False
        bpy.context.view_layer.update()
        mesh = cuff.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
        points = [to_jacket @ cuff.matrix_world @ v.co for v in mesh.vertices]
        assert len(points) == len(cuff.data.vertices)
        for modifier in cuff.modifiers:
            modifier.show_viewport = enabled[modifier.name]
        bpy.context.view_layer.update()
        tree = BVHTree.FromPolygons(points, triangles, all_triangles=True)
        center = sum(points, Vector())/len(points)
        bone = rig.pose.bones['wrist_cuff.'+side]
        cuff_axis = (to_rig.to_3x3() @ (bone.tail-bone.head)).normalized()
        forearm_axis = (axes[side][1]-axes[side][0]).normalized()
        swing = forearm_axis.rotation_difference(cuff_axis)
        h, t = segment('forearm.'+side)
        for i, own in enumerate(carriers):
            if own != side:
                continue
            point = Vector(rest[i])
            if distance(point, 'forearm.'+side) > distance(point, 'upper_arm.'+side):
                continue
            along = (basis.data[i].co-h).dot(t-h)/(t-h).length_squared
            blend = smoothstep(.5, .85, along)
            if not blend:
                continue
            axis_point, _ = intersect_point_line(Vector(initial[i]), *axes[side])
            radial = swing @ (Vector(initial[i])-axis_point)
            radial = (radial-cuff_axis*radial.dot(cuff_axis)).normalized()
            target, normal, _, _ = tree.ray_cast(center, radial, 2)
            if target is None:
                target, normal, _, _ = tree.find_nearest(center+radial*.4)
            reference[i] += blend*(np.array(target-normal*.012)-reference[i])

    edges = {tuple(sorted(e.vertices)) for e in jacket.data.edges}
    for face in jacket.data.polygons:
        if len(face.vertices) == 4:
            a, b, c, d = face.vertices
            edges.update((tuple(sorted((a, c))), tuple(sorted((b, d)))))
    edges = np.array(sorted(edges))
    a, b = edges[:, 0], edges[:, 1]
    degree = np.bincount(edges.ravel(), minlength=len(rest))
    mask = np.zeros(len(rest))
    for i, point in enumerate(map(Vector, rest)):
        h, _ = segment('upper_arm.'+('L' if point.x > 0 else 'R'))
        cap = smoothstep(-.18, .03, point.z-h.z)
        mask[i] = (1-smoothstep(.7, 1.05, (point-h).length))*.55*(1-cap*.7)
    for _ in range(8):
        delta = np.zeros_like(reference)
        np.add.at(delta, a, reference[b]-reference[a])
        np.add.at(delta, b, reference[a]-reference[b])
        reference += mask[:, None]*delta/np.maximum(degree, 1)[:, None]
    return reference


pose_shape(jacket, KEY, coat_shape)

# The simple body's proximal caps extend beyond the shoulder joints. Retract
# their excess in this folded pose so they remain underneath the coat.
torso = rig.matrix_world @ rig.pose.bones['torso'].matrix
for side in 'LR':
    obj = bpy.data.objects['Body / arm.'+side]
    to_torso = torso.inverted() @ obj.matrix_world
    from_torso = to_torso.inverted()
    shoulder = torso.inverted() @ rig.matrix_world @ rig.pose.bones['upper_arm.'+side].head

    def cap_shape(rest, initial):
        target = initial.copy()
        for i, point in enumerate(map(Vector, initial)):
            point = to_torso @ point
            if point.y > shoulder.y+.07 and (point-shoulder).length < .5:
                point.y = shoulder.y+.07+.15*(point.y-shoulder.y-.07)
                target[i] = from_torso @ point
        return target

    pose_shape(obj, 'Crossed shoulder cap', cap_shape)
for frame, value in ((1, 0.0), (40, 0.0), (FRAME, 1.0)):
    rig['crossed_cloth'] = value
    rig.keyframe_insert(data_path='["crossed_cloth"]', frame=frame)
scene.frame_set(FRAME)
bpy.context.view_layer.update()
print('Baked close crossed-arm fit without adding geometry')
