"""Make Logan's wrist controls match its joints and protect skinned mesh transforms.

Run in the master. The three saved presets keep FK and their existing geometry;
IK targets are snapped to each preset, not left at the neutral rest positions.
Does not save. The optional logan_pose_tools add-on supplies snapping buttons.
"""
from math import cos, sin, pi
from pathlib import Path
import runpy

import bpy

scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
original_frame = scene.frame_current
helpers = runpy.run_path(str(Path(__file__).with_name('logan_pose_tools.py')))
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
rig.hide_set(False)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig

# The imported hand was seated .12 beyond the old forearm end. Extend that
# bone along its existing axis so its endpoint and the wrist pivot coincide.
# This changes length, not the rest orientation or weighted vertex positions.
bpy.ops.object.mode_set(mode='EDIT')
for side in 'LR':
    hand = rig.data.edit_bones['hand.'+side]
    rig.data.edit_bones['forearm.'+side].tail = hand.head.copy()
    hand.use_connect = True
    wrist = rig.data.edit_bones['CTRL wrist.'+side]
    wrist.matrix = hand.matrix.copy()
    wrist.length = .25
bpy.ops.object.mode_set(mode='OBJECT')

shapes = bpy.data.collections['06 · Rig shapes']
name = 'Widget / wrist pivot'
widget = bpy.data.objects.get(name)
if widget is None:
    mesh = bpy.data.meshes.new(name)
    points = [(cos(i*pi/12)*.24, 0, sin(i*pi/12)*.24) for i in range(24)]
    mesh.from_pydata(points, [(i, (i+1)%24) for i in range(24)], [])
    widget = bpy.data.objects.new(name, mesh)
    shapes.objects.link(widget)
    widget.hide_set(True)
    widget.hide_render = True


def mode_driver(owner, path, side, expression):
    owner.driver_remove(path)
    driver = owner.driver_add(path).driver
    driver.type = 'SCRIPTED'
    driver.expression = expression
    variable = driver.variables.new()
    variable.name = 'ik'
    variable.targets[0].id = rig
    variable.targets[0].data_path = f'["arm_ik_{side}"]'


for side in 'LR':
    hand = rig.pose.bones['hand.'+side]
    wrist = rig.pose.bones['CTRL wrist.'+side]
    for bone in (hand, wrist):
        bone.custom_shape = widget
        bone.use_custom_shape_bone_size = False
        bone.lock_scale = (True, True, True)
        bone.lock_rotation = (False, False, False)
    hand.lock_location = (True, True, True)
    wrist.lock_location = (False, False, False)
    hand.bone.color.palette = 'THEME03'
    wrist.bone.color.palette = 'THEME04'
    rotation = hand.constraints.get('IK wrist orientation') or hand.constraints.new('COPY_ROTATION')
    rotation.name = 'IK wrist orientation'
    rotation.target, rotation.subtarget = rig, wrist.name
    rotation.owner_space = rotation.target_space = 'WORLD'
    rotation.mix_mode = 'REPLACE'
    mode_driver(rotation, 'influence', side, 'ik')
    for stem in ('upper_arm', 'forearm', 'hand'):
        rig.data.bones[stem+'.'+side].driver_remove('hide')
        rig.data.bones[stem+'.'+side].hide = False
        mode_driver(rig.pose.bones[stem+'.'+side], 'hide', side, 'ik > .5')
    for stem in ('CTRL wrist', 'CTRL elbow'):
        rig.data.bones[stem+'.'+side].driver_remove('hide')
        rig.data.bones[stem+'.'+side].hide = False
        mode_driver(rig.pose.bones[stem+'.'+side], 'hide', side, 'ik < .5')
    rig['arm_ik_'+side] = 0.0

for frame in (1, 40, 80):
    scene.frame_set(frame)
    for side in 'LR':
        rig['arm_ik_'+side] = 0.0
        rig.update_tag()
        bpy.context.view_layer.update()
        helpers['snap_targets'](rig, side)
        rig.keyframe_insert(data_path=f'["arm_ik_{side}"]', frame=frame)
        for stem in ('CTRL wrist', 'CTRL elbow'):
            bone = rig.pose.bones[stem+'.'+side]
            bone.keyframe_insert('location', frame=frame)
            bone.keyframe_insert('rotation_euler', frame=frame)
helpers['hold_keys'](rig)

for obj in bpy.data.collections['01 · Logan / meshes'].objects:
    if obj.type == 'MESH':
        obj.lock_location = obj.lock_rotation = obj.lock_scale = (True, True, True)
        obj.hide_select = True
rig['logan_pose_controls'] = 1
rig.show_in_front = True
readme = bpy.data.texts.get('START HERE · Logan')
if readme and 'N → Logan' not in readme.as_string():
    readme.write('''
MANUAL ARM POSING
Pose Mode → N → Logan opens the arm controls.
Rotate joints: R rotates a selected joint; each hand pivots at its wrist.
Move wrist: G positions the wrist and solves the arm; R turns the palm.
The elbow diamond sets the bend direction. Mode buttons preserve the current pose.
Store pose, then save the blend. Character mesh transforms are protected.
The crossed coat fit is authored for frame 80; large pose changes need a garment refit.
''')
scene.frame_set(original_frame)
bpy.context.view_layer.update()
print('Wrist pivots aligned; inactive controls hidden; character meshes protected')
