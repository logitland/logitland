"""Hold each saved avatar pose until the next preset, including its cloth fit.

Frames 1, 40 and 80 are independent still poses. Interpolating the arm rotations
and a pose-specific garment correction creates meaningless intermediate meshes.
"""
import bpy

rig = bpy.data.objects['LOGAN · Pose me']
action = rig.animation_data.action
for layer in action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            if bag.slot_handle != rig.animation_data.action_slot.handle:
                continue
            for curve in bag.fcurves:
                for key in curve.keyframe_points:
                    key.interpolation = 'CONSTANT'
action.name = 'Logan · Static pose presets'
bpy.context.scene.frame_set(80)
bpy.context.view_layer.update()
