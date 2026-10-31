"""Prove frame 80 has forward finger curls and clearance between folded arms.

Includes the existing fit suite. Cuffs intentionally overlap their own sleeve;
opposite sleeves/cuffs, hands and the torso must stay clear.
"""
from collections import Counter
from pathlib import Path
import runpy
import bpy
from mathutils import Vector

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
        assert palm_normal.dot(toward_body)>.6, f'Palm {side} faces away from the folded arms'
        for finger in ('finger1','finger2','finger3'):
            base = rig.pose.bones[f'{finger}.01.{side}'].head
            tip = rig.pose.bones[f'{finger}.02.{side}'].tail
            assert (tip-base).dot(palm_normal)>.02, f'{finger}.{side} bends backward'
    print('PASS crossed arms: sleeves and cuffs clear; palms inward; fingers curl toward palms')
finally:
    scene.frame_set(80)
