"""Proves body support and garment clearance in the saved and sampled joint poses.

This is a bounded pose check, not a collision guarantee for arbitrary animation.
Runs on the master after fit-body.py; does not save or change its animation.
"""
from itertools import combinations
from math import radians
from pathlib import Path
import runpy
import bpy
from mathutils import Vector

checks = runpy.run_path(str(Path(__file__).with_name('verify.py')))
geometry, touches = checks['geometry'], checks['touches']
scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
# Contact deformation must keep the clothes inexpensive to pose and edit.
garments = ['Jacket / torso', 'Trouser / continuous pants', 'Cuff / band.L',
            'Cuff / band.R', 'Collar / raised band']
graph = bpy.context.evaluated_depsgraph_get()
face_count = sum(len(bpy.data.objects[name].evaluated_get(graph).data.polygons) for name in garments)
assert face_count<=5000, f'Clothing exceeds the low-poly budget: {face_count} faces'
parts = [obj for obj in bpy.data.collections['01 · Logan / meshes'].objects
         if obj.name.startswith(('Body /', 'Pelvis /', 'Hand /', 'Boot /'))]
assert not any(obj.name.startswith('Neck /') for obj in scene.objects), 'The head must float above the collar'
pairs = [('Collar / raised band', 'Head / faceted shell')]
# Raised sleeves must yield to the complete rigid head, including the headset.
for garment in ('Jacket / torso', 'Cuff / band.L', 'Cuff / band.R', 'Collar / raised band'):
    for target in ['Head / faceted shell', 'Screen / glass'] + [
            obj.name for obj in bpy.data.objects if obj.name.startswith('Headset /')]:
        if (garment,target) not in pairs:
            pairs.append((garment,target))
for side in ('L', 'R'):
    pairs.extend([(f'Cuff / band.{side}', f'Hand / continuous.{side}'),
                  ('Jacket / torso', f'Hand / continuous.{side}'),
                  ('Trouser / continuous pants', f'Boot / continuous.{side}')])
    pairs.extend([(f'Cuff / band.{side}', f'Hand / continuous.{"R" if side=="L" else "L"}'),
                  ('Collar / raised band', f'Hand / continuous.{side}')])


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
    print(f'PASS {label}: body supported; garments clear head, headset, hands and boots')


try:
    for frame in (1, 40):
        scene.frame_set(frame)
        check_pose(f'frame {frame}')
    if scene.get('garment_contact'):
        # A clear sleeve must not anticipate contact by bulging away from the head.
        scene.frame_set(20)
        jacket = bpy.data.objects['Jacket / torso']
        modifier = jacket.modifiers['Local head contact']
        graph = bpy.context.evaluated_depsgraph_get()
        active = [v.co.copy() for v in jacket.evaluated_get(graph).data.vertices]
        try:
            modifier.show_viewport = False
            bpy.context.view_layer.update()
            graph = bpy.context.evaluated_depsgraph_get()
            inactive = [v.co.copy() for v in jacket.evaluated_get(graph).data.vertices]
            assert len(active)==len(inactive), 'Contact must preserve garment topology'
            assert max((a-b).length for a,b in zip(active,inactive))<1e-6, 'Clear sleeve deforms before head contact'
        finally:
            modifier.show_viewport = True
            bpy.context.view_layer.update()
        print('PASS clear sleeve: zero head-contact displacement before contact')
        # Proves that a moving head pushes the raised sleeve clear, rather than
        # relying on a correction sculpted only for the saved waving pose.
        for axis in (0,1,2):
            for angle in (-20,20):
                scene.frame_set(40)
                rig.pose.bones['head'].rotation_euler[axis] = radians(angle)
                check_pose(f'wave with head {"XYZ"[axis]} {angle} degrees')
    if scene.get('jacket_motion'):
        for frame in (10,20,30):
            scene.frame_set(frame)
            check_pose(f'coat draw-up frame {frame}')
        for side, sign in (('L',1),('R',-1)):
            for angle in (30,60,78):
                scene.frame_set(1)
                rig.pose.bones['upper_arm.'+side].rotation_euler.z = radians(sign*angle)
                rig.pose.bones['forearm.'+side].rotation_euler.z = radians(sign*38*angle/78)
                check_pose(f'coat shoulder.{side} {angle} degrees')
            for angle in (-45,45):
                scene.frame_set(1)
                rig.pose.bones['upper_arm.'+side].rotation_euler.x = radians(angle)
                check_pose(f'coat forward/back.{side} {angle} degrees')
    for bone, axes, angle in [('hand.L', (0,), 40), ('hand.R', (0,), 40),
                              ('hand.L', (2,), 25), ('hand.R', (2,), 25),
                              ('foot.L', (0,), 35), ('foot.R', (0,), 35),
                              ('head', (0, 2), 35)]:
        for axis in axes:
            for sign in (-1, 1):
                scene.frame_set(1)
                rig.pose.bones[bone].rotation_euler[axis] = radians(sign*angle)
                check_pose(f'{bone} {"XYZ"[axis]} {sign*angle} degrees')
    if scene.get('arm_controls'):
        for side, sign in (('L',1),('R',-1)):
            lower = rig.pose.bones['forearm.'+side]
            for angle in (90,120):
                scene.frame_set(1)
                lower.rotation_euler.z = radians(sign*angle)
                check_pose(f'elbow.{side} FK {angle} degrees')
            # Ask IK to reproduce a reachable FK endpoint and elbow plane.
            scene.frame_set(1)
            lower.rotation_euler.z = radians(sign*90)
            rig.update_tag()
            bpy.context.view_layer.update()
            endpoint = lower.tail.copy()
            scene.frame_set(1)
            control = rig.pose.bones['CTRL wrist.'+side]
            original = control.matrix_basis.copy()
            matrix = control.matrix.copy()
            matrix.translation = endpoint
            control.matrix = matrix
            rig['arm_ik_'+side] = 1.0
            check_pose(f'elbow.{side} IK reach')
            assert (lower.tail-endpoint).length < .005, f'{side}: IK missed its wrist target'
            endpoint += Vector((0,-.4,0))
            matrix = control.matrix.copy()
            matrix.translation = endpoint
            control.matrix = matrix
            check_pose(f'elbow.{side} IK forward reach')
            assert (lower.tail-endpoint).length < .005, f'{side}: IK missed its forward target'
            rig['arm_ik_'+side] = 0.0
            control.matrix_basis = original
finally:
    for side in ('L','R'):
        if 'arm_ik_'+side in rig:
            rig['arm_ik_'+side] = 0.0
    scene.frame_set(1)
