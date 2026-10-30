"""Proves body support and garment clearance in the saved and sampled joint poses.

This is a bounded pose check, not a collision guarantee for arbitrary animation.
Runs on the master after fit-body.py; does not save or change its animation.
"""
from itertools import combinations
from math import radians
from pathlib import Path
import runpy
import bpy

checks = runpy.run_path(str(Path(__file__).with_name('verify.py')))
geometry, touches = checks['geometry'], checks['touches']
scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
parts = [obj for obj in bpy.data.collections['01 · Logan / meshes'].objects
         if obj.name.startswith(('Body /', 'Neck /', 'Pelvis /', 'Hand /', 'Boot /', 'Head / faceted shell'))]
pairs = [('Collar / raised band', 'Head / faceted shell')]
for side in ('L', 'R'):
    pairs.extend([(f'Cuff / band.{side}', f'Hand / continuous.{side}'),
                  ('Jacket / torso', f'Hand / continuous.{side}'),
                  ('Trouser / continuous pants', f'Boot / continuous.{side}')])


def check_pose(label):
    """Check support without clothes and surface intersections at each garment opening."""
    rig.update_tag()
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    names = {obj.name for obj in parts} | {name for pair in pairs for name in pair}
    meshes = {name: geometry(bpy.data.objects[name], graph) for name in names}
    adjacent = {obj.name: set() for obj in parts}
    for a, b in combinations(adjacent, 2):
        if touches(meshes[a], meshes[b]):
            adjacent[a].add(b)
            adjacent[b].add(a)
    reached, pending = set(), ['Body / torso core']
    while pending:
        name = pending.pop()
        if name not in reached:
            reached.add(name)
            pending.extend(adjacent[name] - reached)
    assert reached == set(adjacent), f'{label}: unsupported body parts {set(adjacent)-reached}'
    for a, b in pairs:
        assert not meshes[a]['tree'].overlap(meshes[b]['tree']), f'{label}: {a} clips {b}'
    print(f'PASS {label}: body supports extremities; cuffs, hems and collar clear')


try:
    for frame in (1, 40):
        scene.frame_set(frame)
        check_pose(f'frame {frame}')
    for bone, axes, angle in [('hand.L', (0,), 40), ('hand.R', (0,), 40),
                              ('hand.L', (2,), 25), ('hand.R', (2,), 25),
                              ('foot.L', (0,), 35), ('foot.R', (0,), 35),
                              ('head', (0, 2), 35)]:
        for axis in axes:
            for sign in (-1, 1):
                scene.frame_set(1)
                rig.pose.bones[bone].rotation_euler[axis] = radians(sign*angle)
                check_pose(f'{bone} {"XYZ"[axis]} {sign*angle} degrees')
finally:
    scene.frame_set(1)
