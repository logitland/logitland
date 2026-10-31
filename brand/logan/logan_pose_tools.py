"""Blender sidebar controls for snapping Logan's arms between FK and IK."""
bl_info = {
    'name': 'Logan Pose Tools', 'author': 'Logitland', 'version': (1, 0, 0),
    'blender': (5, 2, 0), 'location': '3D View > Sidebar > Logan',
    'description': 'Wrist controls and pose-preserving arm IK/FK switching',
    'category': 'Rigging',
}

import bpy
from math import atan2
from bpy.props import EnumProperty
from mathutils import Quaternion, Vector
from mathutils.geometry import intersect_point_line


def get_rig(context):
    obj = context.object
    if obj and obj.type != 'ARMATURE':
        obj = obj.find_armature()
    return obj if obj and obj.get('logan_pose_controls') else None


def snap_targets(rig, side):
    """Put the IK wrist and elbow plane on the currently evaluated FK arm."""
    upper = rig.pose.bones['upper_arm.'+side]
    lower = rig.pose.bones['forearm.'+side]
    hand = rig.pose.bones['hand.'+side]
    wrist = rig.pose.bones['CTRL wrist.'+side]
    pole = rig.pose.bones['CTRL elbow.'+side]
    wrist.matrix = hand.matrix.copy()
    axis, _ = intersect_point_line(lower.head, upper.head, hand.head)
    direction = lower.head-axis
    if direction.length < .0001:
        direction = upper.matrix.to_3x3() @ Vector((0, 0, 1))
    matrix = pole.matrix.copy()
    matrix.translation = lower.head+direction.normalized()*.8
    pole.matrix = matrix
    bpy.context.view_layer.update()


def switch_arm(rig, side, mode):
    """Change solver while retaining the evaluated wrist, elbow and palm pose."""
    enabled = rig['arm_ik_'+side] > .5
    if enabled == (mode == 'IK'):
        return
    if mode == 'IK':
        upper = rig.pose.bones['upper_arm.'+side]
        lower = rig.pose.bones['forearm.'+side]
        desired_elbow = lower.head.copy()
        snap_targets(rig, side)
        rig['arm_ik_'+side] = 1.0
        rig.update_tag()
        bpy.context.view_layer.update()
        # As in Rigify's pole matching, align the solved bend plane with the
        # evaluated FK pose. The two arms have different rest-axis rolls.
        pole = rig.pose.bones['CTRL elbow.'+side]
        wrist = rig.pose.bones['CTRL wrist.'+side]
        axis = (wrist.head-upper.head).normalized()
        center, _ = intersect_point_line(desired_elbow, upper.head, wrist.head)
        desired = desired_elbow-center
        for _ in range(2):
            current = lower.head-center
            current -= axis*current.dot(axis)
            if min(current.length, desired.length) < .00001:
                break
            angle = atan2(axis.dot(current.cross(desired)), current.dot(desired))
            matrix = pole.matrix.copy()
            matrix.translation = center+Quaternion(axis, angle) @ (pole.head-center)
            pole.matrix = matrix
            bpy.context.view_layer.update()
    else:
        names = [name+'.'+side for name in ('upper_arm', 'forearm', 'hand')]
        matrices = {name: rig.pose.bones[name].matrix.copy() for name in names}
        rig['arm_ik_'+side] = 0.0
        rig.update_tag()
        bpy.context.view_layer.update()
        for name in names:
            rig.pose.bones[name].matrix = matrices[name]
            bpy.context.view_layer.update()
    names = [name+'.'+side for name in ('upper_arm', 'forearm', 'hand', 'CTRL wrist', 'CTRL elbow')]
    for name in names:
        bone = rig.pose.bones[name]
        bone.keyframe_insert('location')
        bone.keyframe_insert('rotation_euler')
    rig.keyframe_insert(data_path=f'["arm_ik_{side}"]')
    hold_keys(rig)


def hold_keys(rig):
    """Avatar presets hold their pose instead of interpolating incompatible fits."""
    action = rig.animation_data.action
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                if bag.slot_handle == rig.animation_data.action_slot.handle:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.interpolation = 'CONSTANT'


class LOGAN_OT_arm_mode(bpy.types.Operator):
    bl_idname = 'logan.arm_mode'
    bl_label = 'Switch arm control'
    bl_description = 'Snap the controls to the current arm before changing its solver'
    bl_options = {'REGISTER', 'UNDO'}
    side: EnumProperty(items=[('L', 'Left', ''), ('R', 'Right', '')])
    mode: EnumProperty(items=[('FK', 'Rotate joints', ''), ('IK', 'Move wrist', '')])

    @classmethod
    def poll(cls, context):
        return get_rig(context) is not None and context.mode == 'POSE'

    def execute(self, context):
        rig = get_rig(context)
        switch_arm(rig, self.side, self.mode)
        for bone in rig.pose.bones:
            bone.select = False
        name = ('CTRL wrist.' if self.mode == 'IK' else 'hand.')+self.side
        rig.pose.bones[name].select = True
        rig.data.bones.active = rig.data.bones[name]
        return {'FINISHED'}


class LOGAN_OT_key_pose(bpy.types.Operator):
    bl_idname = 'logan.key_pose'
    bl_label = 'Store pose'
    bl_description = 'Store the current joint transforms in this avatar preset'
    bl_options = {'REGISTER', 'UNDO'}

    @classmethod
    def poll(cls, context):
        return get_rig(context) is not None and context.mode == 'POSE'

    def execute(self, context):
        rig = get_rig(context)
        for bone in rig.pose.bones:
            if bone.rotation_mode == 'XYZ':
                bone.keyframe_insert('location')
                bone.keyframe_insert('rotation_euler')
        for side in 'LR':
            rig.keyframe_insert(data_path=f'["arm_ik_{side}"]')
            if rig['arm_ik_'+side] < .5:
                snap_targets(rig, side)
                for stem in ('CTRL wrist', 'CTRL elbow'):
                    control = rig.pose.bones[stem+'.'+side]
                    control.keyframe_insert('location')
                    control.keyframe_insert('rotation_euler')
        hold_keys(rig)
        return {'FINISHED'}


class LOGAN_PT_pose(bpy.types.Panel):
    bl_label = 'Logan posing'
    bl_idname = 'LOGAN_PT_pose'
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Logan'

    @classmethod
    def poll(cls, context):
        return get_rig(context) is not None and context.mode == 'POSE'

    def draw(self, context):
        rig = get_rig(context)
        layout = self.layout
        for side, label in (('L', 'Left arm'), ('R', 'Right arm')):
            layout.label(text=label)
            row = layout.row(align=True)
            for mode, text in (('FK', 'Rotate joints'), ('IK', 'Move wrist')):
                active = (rig['arm_ik_'+side] > .5) == (mode == 'IK')
                button = row.operator('logan.arm_mode', text=text, depress=active)
                button.side, button.mode = side, mode
        layout.operator('logan.key_pose')


CLASSES = (LOGAN_OT_arm_mode, LOGAN_OT_key_pose, LOGAN_PT_pose)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
