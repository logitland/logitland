"""Check the static fold: right arm below left, straight bundled fingers,
right palm on the left bicep, left fingers under the right bicep, seated cuffs.

Small hidden hand/cloth overlaps are allowed. Inspect solid and material views
for folds and visible clipping; the strict general clearance suite remains in
verify-fit.py. This check does not certify collision-free cloth.
"""
from collections import Counter
from math import degrees
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_point_line

scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
original_frame = scene.frame_current


def nearest_segment(point, bone):
    _, t = intersect_point_line(point, bone.head, bone.tail)
    return bone.head.lerp(bone.tail, max(0, min(1, t)))


def geometry(obj):
    mesh = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    vertices = [obj.matrix_world @ v.co for v in mesh.vertices]
    return vertices, BVHTree.FromPolygons(vertices, [tuple(p.vertices) for p in mesh.polygons])


try:
    scene.frame_set(80)
    torso = rig.pose.bones['torso'].matrix.inverted()
    midpoint = {s: torso @ rig.pose.bones['forearm.'+s].head.lerp(rig.pose.bones['forearm.'+s].tail, .5) for s in 'LR'}
    assert midpoint['L'].y > midpoint['R'].y+.1, 'The right forearm must pass below the left'
    assert midpoint['L'].z > midpoint['R'].z+.1, 'The upper left forearm must cross in front of the lower right forearm'
    for side, direction in (('R', 1), ('L', -1)):
        hand = rig.pose.bones['hand.'+side]
        fingers = (torso.to_3x3() @ (hand.tail-hand.head)).normalized()
        assert fingers.y*direction > .3, f'{side} hand points the wrong way: lower hand up, upper hand down'
    for side, sign in (('L', 1), ('R', -1)):
        arm = rig.pose.bones['forearm.'+side]
        hand = rig.pose.bones['hand.'+side]
        hinge = degrees(arm.rotation_euler.z)*sign
        assert 0 < hinge < 155, f'{side} elbow bends backward or folds shut'
        direction = (torso.to_3x3() @ (arm.tail-arm.head)).normalized()
        assert direction.x*-sign > .65, f'{side} forearm does not cross the chest'
        bend = degrees((arm.tail-arm.head).angle(hand.tail-hand.head))
        assert bend < 45, f'{side} wrist bends {bend:.1f} degrees'
        digits = [rig.pose.bones[f'finger{i}.01.{side}'] for i in (1, 2, 3)]
        middle = (digits[1].tail-digits[1].head).normalized()
        for first in digits:
            second = rig.pose.bones[first.name.replace('.01.', '.02.')]
            d1, d2 = (first.tail-first.head).normalized(), (second.tail-second.head).normalized()
            assert d1.dot(d2) > .999, f'{first.name}: finger is curled'
            assert d1.dot(middle) > .999, f'{first.name}: fingers are spread'
        for a, b in zip(digits, digits[1:]):
            delta = b.head-a.head
            spacing = (delta-middle*delta.dot(middle)).length
            assert spacing < .22, f'{side}: fingers are not bundled ({spacing:.3f})'
        print(f'PASS {side}: anatomical elbow, wrist {bend:.1f} degrees, straight bundled fingers')

    right = rig.pose.bones['hand.R']
    palm = right.matrix @ Vector((0, .55, .10))
    support = nearest_segment(palm, rig.pose.bones['upper_arm.L'])
    normal = (right.matrix.to_3x3() @ Vector((0, 0, 1))).normalized()
    assert normal.dot((support-palm).normalized()) > .5, 'Right palm faces away from the left bicep'
    assert (palm-support).length < .7, 'Right hand floats away from the left bicep'
    tips = sum((rig.pose.bones[f'finger{i}.02.L'].tail for i in (1, 2, 3)), Vector())/3
    upper = rig.pose.bones['upper_arm.R']
    # The bicep is the upper-arm belly, not the nearest point at the elbow tip.
    support = upper.head.lerp(upper.tail, .6)
    assert (torso @ tips).y < (torso @ support).y-.1, 'Left fingers are not underneath the right bicep'
    assert (tips-support).length < .8, 'Left fingers miss the right arm gap'
    print('PASS hands: right palm rests on left bicep; left fingers tuck under right bicep')

    jacket = bpy.data.objects['Jacket / torso']
    edge_counts = Counter(tuple(sorted(edge)) for face in jacket.data.polygons for edge in face.edge_keys)
    boundary = {i for edge, count in edge_counts.items() if count == 1 for i in edge}
    # Complex solidify reorders vertices; compare the original open outer rim.
    lining = jacket.modifiers['Cloth thickness around open garment']
    was_enabled = lining.show_viewport
    lining.show_viewport = False
    bpy.context.view_layer.update()
    points, _ = geometry(jacket)
    lining.show_viewport = was_enabled
    bpy.context.view_layer.update()
    for side, sign in (('L', 1), ('R', -1)):
        mouth = [i for i in boundary if sign*jacket.data.vertices[i].co.x > 1.1]
        assert mouth, f'No open sleeve mouth on {side}'
        _, cuff = geometry(bpy.data.objects['Cuff / band.'+side])
        gap = max(cuff.find_nearest(points[i])[3] for i in mouth)
        assert gap < .06, f'{side} sleeve opening separates from cuff ({gap:.3f})'
        print(f'PASS {side}: sleeve mouth seated in cuff, maximum surface gap {gap:.3f}')

    def meshes(frame):
        scene.frame_set(frame)
        return {o.name: np.array(geometry(o)[0]) for o in scene.objects if o.type == 'MESH'}

    wave, held = meshes(40), meshes(66)
    assert all(np.array_equal(wave[name], held[name]) for name in wave), 'Frame 66 must hold the wave exactly'
    action = rig.animation_data.action
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                if bag.slot_handle == rig.animation_data.action_slot.handle:
                    assert all(k.interpolation == 'CONSTANT' for f in bag.fcurves for k in f.keyframe_points), 'Pose presets must not interpolate'
    print('PASS static presets: frame 66 equals frame 40, all keys held')
finally:
    scene.frame_set(original_frame)
