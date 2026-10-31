"""Key the crossed-arms pose at frame 80, after the wave, in the open master.

blender --background brand/logan/logan.blend --python brand/logan/pose-crossed-arms.py
Saves the file. The body turns 30° while the head looks back at the camera.
The right forearm crosses below and behind the left, with its hand on the
left bicep. The left hand wraps across the right sleeve. The stored joint
angles preserve Mia's manually posed wrists, fingertips and thumb.
The shoulders advance to make room for the fold.
Small hidden cloth intersections are intentional.
The sleeves follow a roll-free drape armature and a fitted crossed-arms coat
shape. Every preset is held, not interpolated.
"""
from math import radians
from pathlib import Path
import runpy
import bpy

FRAME = 80
DEGREES = {
    'root': (0.0000, 30.0000, 0.0000),
    'head': (-6.0000, -24.0000, 5.0000),
    'upper_arm.L': (-52.9536, -183.4131, -31.9080),
    'forearm.L': (0, 0, 105.411204),
    'hand.L': (-13.674744, -118.864116, -1.601211),
    'upper_arm.R': (-15.203752, -166.401563, 34.633236),
    'forearm.R': (0, 0, -109.017571),
    'hand.R': (119.920787, 143.225693, 160.957000),
    'finger1.01.L': (-5.7302, -.2896, -2.8830),
    'finger1.02.L': (29.851048, -1.531975, .621301),
    'finger2.01.L': (-4.9530, -.2504, -2.8866),
    'finger2.02.L': (46.935694, -3.847197, -1.702524),
    'finger3.01.L': (-5.9127, -.2301, -2.2204),
    'finger3.02.L': (20.346539, 1.391206, -3.504112),
    'finger1.01.R': (8.0873, .2300, 2.2204),
    'finger1.02.R': (13.6944, .2299, .6242),
    'finger2.01.R': (9.0470, .2504, 2.8866),
    'finger2.02.R': (15.3100, 0, 0),
    'finger3.01.R': (8.2698, .2895, 2.8830),
    'finger3.02.R': (13.5135, 0, 0),
    'thumb.01.L': (-5.625729, 16.144462, -25.187228),
    'thumb.02.L': (10.885727, 1.560109, 20.291485),
    'thumb.01.R': (1.3578, 3.6419, 33.8512),
    'thumb.02.R': (-3.1458, -4.7631, -25.9940),
}
# Local translations protract the shoulders and close the outer finger spacing.
LOCATIONS = {
    'upper_arm.L': (-.03057194, .02579474, .2),
    'upper_arm.R': (.03057170, .02579474, .3),
    'finger1.01.L': (.05492949, -.00276622, .00027823),
    'finger3.01.L': (-.05495787, .00213087, -.00022078),
    'finger1.01.R': (.05495805, .00213087, -.00022030),
    'finger3.01.R': (-.05492976, -.00276649, .00027800),
}

scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
# An isolated frame-80 location key extrapolates backwards. Anchor the existing
# poses before adding the shoulder and knuckle translations.
for frame in (1, 40):
    scene.frame_set(frame)
    for name in LOCATIONS:
        rig.pose.bones[name].keyframe_insert('location', frame=frame)
scene.frame_set(FRAME)
for side in 'LR':
    rig['arm_ik_'+side] = 0.0
    rig.keyframe_insert(data_path=f'["arm_ik_{side}"]', frame=FRAME)
rig.update_tag()
bpy.context.view_layer.update()
for bone in rig.pose.bones:
    if bone.rotation_mode != 'XYZ' or bone.name.startswith('CTRL '):
        continue
    bone.location = LOCATIONS.get(bone.name, (0, 0, 0))
    bone.rotation_euler = [radians(angle) for angle in DEGREES.get(bone.name, (0, 0, 0))]
    bone.keyframe_insert('location', frame=FRAME)
    bone.keyframe_insert('rotation_euler', frame=FRAME)
marker = scene.timeline_markers.get('CROSSED ARMS') or scene.timeline_markers.new('CROSSED ARMS')
marker.frame = FRAME
scene.frame_end = max(scene.frame_end, FRAME)
here = Path(__file__).parent
for script in ('fit-sleeve-drape.py', 'fit-crossed-cloth.py', 'pose-presets.py'):
    runpy.run_path(str(here/script))
if rig.get('logan_pose_controls'):
    controls = runpy.run_path(str(here/'logan_pose_tools.py'))
    for side in 'LR':
        controls['snap_targets'](rig, side)
        for stem in ('CTRL wrist', 'CTRL elbow'):
            bone = rig.pose.bones[stem+'.'+side]
            bone.keyframe_insert('location', frame=FRAME)
            bone.keyframe_insert('rotation_euler', frame=FRAME)
    controls['hold_keys'](rig)
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)
print('Keyed CROSSED ARMS at frame', FRAME)
