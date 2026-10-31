"""Key the crossed-arms pose at frame 80, after the wave, in the open master.

blender --background brand/logan/logan.blend --python brand/logan/pose-crossed-arms.py
Saves the file. The body turns 30° while the head looks back at the camera. The
right forearm crosses above the left. Its palm rests on the left sleeve over
the bicep; the left hand tucks behind the right upper arm. Elbows use their
anatomical hinges; the sleeves follow a roll-free drape armature and a fitted
crossed-arms coat shape. Every preset is held, not interpolated.
"""
from math import radians
from pathlib import Path
import runpy
import bpy

FRAME = 80
DEGREES = {
    'root': (0.0, 30.0, 0.0),
    'head': (-6.0, -24.0, 5.0),
    'upper_arm.L': (-36.863846, 174.255324, -36.219380),
    'forearm.L': (0.0, 0.0, 109.099841),
    'hand.L': (-10.850855, 80.943725, 7.054290),
    'thumb.01.L': (30.529562, 4.026630, -14.679747),
    'thumb.02.L': (-3.135258, 0.730205, 26.215557),
    'upper_arm.R': (-57.305178, -162.246595, 57.875027),
    'forearm.R': (0.0, 0.0, -96.482822),
    'hand.R': (-10.597061, 143.473916, -25.714481),
    **{f'{finger}.{joint}.{side}': (18.0 if side=='L' else 28.0 if joint=='01' else 22.0, 0.0, 0.0)
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
