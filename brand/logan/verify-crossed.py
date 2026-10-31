"""Prove frame 80 folds the forearms across the chest with clear garment contact.

Includes the existing fit suite. Cuffs intentionally overlap their own sleeve;
opposite sleeves/cuffs, hands and the torso must stay clear. The upper sleeves
must not wring around the arm: each one's pink inlay panel stays within 15° of
where the arm's swing alone carries it, and keeps most of its area. The poses
are held presets: frame 66 between the wave and the crossed arms must still
show the wave exactly.
"""
from collections import Counter
from math import degrees
from pathlib import Path
import runpy
import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

checks = runpy.run_path(str(Path(__file__).with_name('verify-fit.py')))
scene, rig = checks['scene'], checks['rig']
try:
    scene.frame_set(80)
    checks['check_pose']('crossed arms')
    graph = bpy.context.evaluated_depsgraph_get()
    jacket = bpy.data.objects['Jacket / torso']
    evaluated = jacket.evaluated_get(graph)
    regions = []
    for polygon in evaluated.data.polygons:
        weights = Counter()
        for index in polygon.vertices:
            for weight in evaluated.data.vertices[index].groups:
                name = jacket.vertex_groups[weight.group].name
                region = 'L' if name.endswith('.L') else 'R' if name.endswith('.R') else 'torso'
                weights[region] += weight.weight
        regions.append(weights.most_common(1)[0][0] if weights else 'torso')
    mesh = checks['geometry'](jacket,graph)
    assert not any({regions[a],regions[b]}=={'L','R'} for a,b in mesh['tree'].overlap(mesh['tree'])), 'Opposite sleeves intersect'
    cuffs = {side:checks['geometry'](bpy.data.objects['Cuff / band.'+side],graph) for side in 'LR'}
    assert not cuffs['L']['tree'].overlap(cuffs['R']['tree']), 'Cuffs intersect'
    for side in 'LR':
        assert all(regions[a]==side for a,b in mesh['tree'].overlap(cuffs[side]['tree'])), f'Cuff {side} clips torso or opposite sleeve'
        hand = rig.pose.bones['hand.'+side]
        palm_normal = hand.matrix.to_3x3() @ Vector((0,0,1))
        toward_body = rig.pose.bones['root'].matrix.to_3x3() @ Vector((0,0,-1))
        # The upper hand rests on the outside; the lower hand slips behind the
        # opposite bicep, so its palm faces forward into the back of that sleeve.
        contact_direction = toward_body if side=='R' else -toward_body
        assert palm_normal.dot(contact_direction)>.6, f'Palm {side} faces away from its sleeve contact'
        upper = rig.pose.bones['upper_arm.'+side]
        lower = rig.pose.bones['forearm.'+side]
        sign = 1 if side=='L' else -1
        assert lower.rotation_euler.z*sign>0, f'Elbow {side} bends backward'
        across = rig.pose.bones['root'].matrix.to_3x3() @ Vector((-sign,0,0))
        assert (lower.tail-lower.head).normalized().dot(across)>.85, f'Forearm {side} does not fold across the chest'
        assert hand.head.z>lower.head.z and hand.head.z>upper.head.z-.9, f'Hand {side} hangs below the crossed-arm fold'
        for finger in ('finger1','finger2','finger3'):
            base = rig.pose.bones[f'{finger}.01.{side}'].head
            tip = rig.pose.bones[f'{finger}.02.{side}'].tail
            assert (tip-base).dot(palm_normal)>.02, f'{finger}.{side} bends backward'
    inlay = next(i for i, m in enumerate(jacket.data.materials) if m.name.startswith('Pink · lit inlay'))
    world = rig.matrix_world
    torso = rig.pose.bones['torso']
    carry = (world @ torso.matrix @ torso.bone.matrix_local.inverted() @ world.inverted()).to_3x3()
    lining = jacket.modifiers['Cloth thickness around open garment']
    lining.show_viewport = False
    bpy.context.view_layer.update()
    cloth = jacket.evaluated_get(bpy.context.evaluated_depsgraph_get())
    for side in 'LR':
        bone, posed = rig.data.bones['upper_arm.'+side], rig.pose.bones['upper_arm.'+side]
        head, tail = world @ bone.head_local, world @ bone.tail_local
        rest_axis = (carry @ (tail-head)).normalized()
        axis = ((world @ posed.tail)-(world @ posed.head)).normalized()
        owners = [rig.data.bones[name] for name in ('torso', 'upper_arm.'+side, 'forearm.'+side)]
        rest_offset, offset, rest_area, area = Vector(), Vector(), 0, 0
        for polygon in cloth.data.polygons:
            if polygon.material_index!=inlay:
                continue
            original = jacket.data.polygons[polygon.index]
            centre = jacket.matrix_world @ original.center
            spans = []
            for owner in owners:
                start, end = world @ owner.head_local, world @ owner.tail_local
                along = max(0, min(1, intersect_point_line(centre, start, end)[1]))
                spans.append(((centre-start.lerp(end, along)).length, owner, along))
            _, owner, along = min(spans, key=lambda span: span[0])
            if owner!=bone or not .15<along<.95:
                continue
            rest_offset += carry @ (centre-intersect_point_line(centre, head, tail)[0])*original.area
            centre = jacket.matrix_world @ polygon.center
            offset += (centre-intersect_point_line(centre, world @ posed.head, world @ posed.tail)[0])*polygon.area
            rest_area += original.area
            area += polygon.area
        swung = rest_axis.rotation_difference(axis) @ rest_offset
        swung, offset = swung-axis*swung.dot(axis), offset-axis*offset.dot(axis)
        twist = degrees(swung.angle(offset))
        assert twist<15, f'Upper sleeve {side} wrings {twist:.0f}° around the arm'
        assert area>.6*rest_area, f'Upper sleeve {side} inlay pinched to {area/rest_area:.0%} of its area'
    lining.show_viewport = True
    print('PASS crossed arms: anatomical elbow bends; forearms across chest; opposed palm contacts; '
          'untwisted upper sleeves; clear sleeves, cuffs and hands')
    # Presets hold: no interpolated rig or garment between the wave and the fold.
    action = rig.animation_data.action
    assert all(key.interpolation=='CONSTANT' for layer in action.layers for strip in layer.strips
               for bag in strip.channelbags for curve in bag.fcurves for key in curve.keyframe_points), 'Pose keys interpolate'
    held = {}
    for frame in (40, 66):
        scene.frame_set(frame)
        graph = bpy.context.evaluated_depsgraph_get()
        held[frame] = ([bone.matrix.copy() for bone in rig.pose.bones],
                       {obj.name: [v.co.copy() for v in obj.evaluated_get(graph).data.vertices]
                        for obj in scene.objects if obj.type=='MESH' and obj.visible_get()})
    assert all(abs(x)<1e-6 for a, b in zip(held[40][0], held[66][0]) for row in a-b for x in row), 'Frame 66 interpolates the rig'
    for name, points in held[40][1].items():
        assert max(((a-b).length for a, b in zip(points, held[66][1][name])), default=0)<1e-6, f'Frame 66 interpolates {name}'
    print('PASS presets: frame 66 holds the wave pose and garments')
finally:
    scene.frame_set(80)
