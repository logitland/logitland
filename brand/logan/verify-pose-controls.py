"""Prove wrist-centered posing and IK/FK switching without hand distortion.

Run in a background copy: switching writes pose keys, but this check never saves.
"""
from pathlib import Path
import runpy

import bpy
import addon_utils
import numpy as np
from mathutils import Matrix, Vector

helpers = runpy.run_path(str(Path(__file__).with_name('logan_pose_tools.py')))
scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
addon_utils.disable('logan_pose_tools')
helpers['register']()
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')


def update():
    rig.update_tag()
    bpy.context.view_layer.update()


def hand_geometry(side):
    obj = bpy.data.objects['Hand / continuous.'+side]
    mesh = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    points = np.array([obj.matrix_world @ v.co for v in mesh.vertices])
    edges = np.array([e.vertices[:] for e in mesh.edges])
    lengths = np.linalg.norm(points[edges[:, 0]]-points[edges[:, 1]], axis=1)
    return points, lengths


for frame in (1, 40, 80):
    scene.frame_set(frame)
    update()
    for side in 'LR':
        hand = rig.pose.bones['hand.'+side]
        lower = rig.pose.bones['forearm.'+side]
        wrist = rig.pose.bones['CTRL wrist.'+side]
        assert (lower.tail-hand.head).length < 1e-5, f'{side}: forearm does not end at wrist'
        assert (wrist.head-hand.head).length < 1e-5, f'{side}: control is detached from wrist'
        assert wrist.hide and not hand.hide, 'Inactive IK controls must be hidden'
        before, lengths = hand_geometry(side)
        elbow, pivot = lower.head.copy(), hand.head.copy()
        assert bpy.ops.logan.arm_mode(side=side, mode='IK') == {'FINISHED'}
        scene.frame_set(frame)
        update()
        after, _ = hand_geometry(side)
        assert (lower.head-elbow).length < .005, f'{frame}/{side}: switching changes elbow position {(lower.head-elbow).length:.6f}'
        assert (hand.head-pivot).length < .002, f'{frame}/{side}: switching changes wrist position'
        error = np.max(np.linalg.norm(after-before, axis=1))
        assert error < .005, f'{frame}/{side}: switching jumps hand {error:.6f}'
        assert not wrist.hide and hand.hide, 'Only the active wrist control should show'
        # Moving the wrist must solve the arm while keeping the articulated hand intact.
        matrix = wrist.matrix.copy()
        matrix.translation += Vector((-.035 if side == 'L' else .035, -.025, .04))
        wrist.matrix = matrix
        update()
        assert (hand.head-wrist.head).length < .002, f'{side}: hand does not follow wrist control'
        moved, moved_lengths = hand_geometry(side)
        assert np.max(np.abs(moved_lengths-lengths)) < 1e-5, f'{side}: IK move stretches hand'
        # Rotate around the control's origin: the joint stays fixed, fingers rotate with it.
        pivot = hand.head.copy()
        matrix = wrist.matrix.copy()
        wrist.matrix = matrix @ Matrix.Rotation(.35, 4, 'Y')
        update()
        assert (hand.head-pivot).length < .002, f'{side}: wrist rotation orbits a distant origin'
        rotated, rotated_lengths = hand_geometry(side)
        assert np.max(np.abs(rotated_lengths-lengths)) < 1e-5, f'{side}: wrist rotation distorts hand'
        assert bpy.ops.logan.arm_mode(side=side, mode='FK') == {'FINISHED'}
        scene.frame_set(frame)
        update()
        returned, _ = hand_geometry(side)
        assert np.max(np.linalg.norm(returned-rotated, axis=1)) < .005, f'{side}: IK to FK jumps'
        pivot = hand.head.copy()
        hand.rotation_euler.x += .2
        update()
        assert (hand.head-pivot).length < 1e-5, f'{side}: FK does not rotate at wrist'
        edited, fk_lengths = hand_geometry(side)
        assert np.max(np.abs(fk_lengths-lengths)) < 1e-5, f'{side}: FK rotation distorts hand'
        assert bpy.ops.logan.key_pose() == {'FINISHED'}
        scene.frame_set(frame)
        update()
        stored, _ = hand_geometry(side)
        assert np.max(np.linalg.norm(stored-edited, axis=1)) < 1e-5, f'{side}: Store pose loses edits'
        assert (wrist.head-hand.head).length < 1e-5, f'{side}: Store pose leaves a stale wrist target'
        print(f'PASS frame {frame} {side}: wrist pivot, IK move/rotate, FK rotation, solver switching, stored edits')

for obj in bpy.data.collections['01 · Logan / meshes'].objects:
    if obj.type == 'MESH':
        assert obj.hide_select and all(obj.lock_location) and all(obj.lock_rotation) and all(obj.lock_scale), obj.name
print('PASS skinned meshes cannot be mistaken for object-mode pose controls')
