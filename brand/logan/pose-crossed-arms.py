"""Key the crossed-arms pose at frame 80, after the wave, in the open master.

blender --background brand/logan/logan.blend --python brand/logan/pose-crossed-arms.py
Saves the file. The body turns 30° while the head looks back at the camera.
The forearms stack across the chest, the right one above and in front, both
held clear of the padded coat so the rigid cuffs ride free of it. The right
hand grips the left arm at the elbow; the left hand cups the right forearm from
below. Both palms rest on the outside of the other sleeve, fingers curled
toward it. Elbows use their anatomical hinges; wrists bend at most about 30°.
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
    'upper_arm.L': (-40.3733, 166.0018, -40.2781),
    'forearm.L': (0.0000, 0.0000, 75.5344),
    'hand.L': (21.7224, 164.6006, 29.3290),
    'thumb.01.L': (30.5296, 4.0266, -14.6797),
    'thumb.02.L': (-3.1353, 0.7302, 26.2156),
    'upper_arm.R': (-72.7171, -172.7259, 48.3263),
    'forearm.R': (0.0000, 0.0000, -89.6793),
    'hand.R': (-90.4077, 67.7095, -86.9629),
    **{f'{finger}.{joint}.{side}': (30.0, 0.0, 0.0)
       for finger in ('finger1', 'finger2', 'finger3') for joint in ('01', '02') for side in 'LR'},
}

scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
for bone in rig.pose.bones:
    if bone.rotation_mode != 'XYZ':
        continue
    bone.location = (0, 0, 0)
    bone.rotation_euler = [radians(angle) for angle in DEGREES.get(bone.name, (0, 0, 0))]
    bone.keyframe_insert('location', frame=FRAME)
    bone.keyframe_insert('rotation_euler', frame=FRAME)
marker = scene.timeline_markers.get('CROSSED ARMS') or scene.timeline_markers.new('CROSSED ARMS')
marker.frame = FRAME
scene.frame_end = max(scene.frame_end, FRAME)
here = Path(__file__).parent
for script in ('fit-sleeve-drape.py', 'fit-crossed-cloth.py', 'pose-presets.py'):
    runpy.run_path(str(here/script))
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)
print('Keyed CROSSED ARMS at frame', FRAME)
