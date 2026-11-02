"""Tighten existing hand contact offsets without rebuilding garments or poses.

Run in the open master, then refit the crossed cloth. Does not save. Small
faceted intersections are allowed instead of visibly floating cuffs and cloth.
"""
import bpy

for obj in bpy.data.objects:
    if obj.name not in ('Jacket / torso', 'Cuff / band.L', 'Cuff / band.R', 'Collar / raised band'):
        continue
    for modifier in obj.modifiers:
        if modifier.type=='SHRINKWRAP' and modifier.target and modifier.target.name.startswith('Hand / continuous.'):
            modifier.offset = .025 if obj.name.startswith('Cuff /') else .015
bpy.context.view_layer.update()
print('Tight hand contact: cuffs .025; coat .015')
