"""Store the edited frame-80 corrective surfaces for fit-crossed-cloth.py.

Run in the master after sculpting its crossed-pose shape keys. Only the armature
is sampled: cloth thickness and contact modifiers must not be baked twice.
The master file is not saved, and modifier visibility and frame are restored.
"""
from pathlib import Path

import bpy
import numpy as np

scene = bpy.data.scenes['LOGAN']
frame = scene.frame_current
targets = {}
try:
    scene.frame_set(80)
    for name in ('Jacket / torso', 'Collar / raised band', 'Body / arm.L', 'Body / arm.R'):
        obj = bpy.data.objects[name]
        enabled = {modifier.name: modifier.show_viewport for modifier in obj.modifiers}
        try:
            for modifier in obj.modifiers:
                modifier.show_viewport = modifier.type == 'ARMATURE'
            bpy.context.view_layer.update()
            basis = obj.data.shape_keys.key_blocks[0].data
            mesh = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
            if len(mesh.vertices) != len(basis):
                raise ValueError(f'{name}: corrective surface must retain the base topology')
            targets[name+' / basis'] = np.array([p.co[:] for p in basis])
            targets[name+' / posed'] = np.array([p.co[:] for p in mesh.vertices])
        finally:
            for modifier in obj.modifiers:
                modifier.show_viewport = enabled[modifier.name]
            bpy.context.view_layer.update()
finally:
    scene.frame_set(frame)

path = Path(__file__).with_name('crossed-tailoring.npz')
np.savez_compressed(path, **targets)
print('Stored authored crossed-pose surfaces:', path)
