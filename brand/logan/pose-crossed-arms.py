"""Key the crossed-arms pose at frame 80, after the wave, in the open master.

blender --background brand/logan/logan.blend --python brand/logan/pose-crossed-arms.py
Saves the file. The body turns 30° while the head looks back at the camera. The
right forearm crosses above the left, with room for the sleeves and cuffs. The
elbows bend backward around local Z so the upper arms roll only slightly and
their pink panels stay on the outside of the sleeves.
"""
from math import radians
from pathlib import Path
import runpy
import bpy

FRAME = 80
DEGREES = {
    'root': (0.0, 30.0, 0.0),
    'head': (-6.0, -24.0, 5.0),
    'upper_arm.L': (36.39255, -19.85475, -41.13433),
    'forearm.L': (0.2, -1.0, -76.55915),
    'hand.L': (0.0, 58.87076, -10.0),
    'upper_arm.R': (63.83820, 15.99976, 42.74237),
    'forearm.R': (-0.1, 1.0, 98.42323),
    'hand.R': (0.0, -24.36802, -10.0),
    **{f'{finger}.{joint}.{side}': (35.0, 0.0, 0.0)
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
runpy.run_path(str(Path(__file__).with_name('fit-crossed-cloth.py')))
scene.frame_set(FRAME)
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)
print('Keyed CROSSED ARMS at frame', FRAME)
