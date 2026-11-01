"""Add optional two-bone arm IK, elbow poles and connected elbow hinges."""
from math import pi, cos, sin
import bpy
from mathutils import Matrix, Vector

scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
scene.frame_set(1)
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
controls = rig.data.collections.get('Arm controls') or rig.data.collections.new('Arm controls')
shapes = bpy.data.collections.get('06 · Rig shapes')
if shapes is None:
    shapes = bpy.data.collections.new('06 · Rig shapes')
    scene.collection.children.link(shapes)
shapes.hide_render = True


def widget(name, points):
    obj = bpy.data.objects.get(name)
    if obj is None:
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(points, [(i,(i+1)%len(points)) for i in range(len(points))], [])
        obj = bpy.data.objects.new(name, mesh)
        shapes.objects.link(obj)
    obj.hide_set(True)
    return obj


hand_shape = widget('Widget / wrist', [(cos(i*pi/8)*.30,0,sin(i*pi/8)*.30) for i in range(16)])
pole_shape = widget('Widget / elbow', [(-.16,0,0),(0,0,.16),(.16,0,0),(0,0,-.16)])
for side, sign in (('L',1),('R',-1)):
    property_name = 'arm_ik_'+side
    if property_name not in rig:
        rig[property_name] = 0.0
    rig.id_properties_ui(property_name).update(min=0, max=1, description='0: rotate FK arm bones. 1: move CTRL wrist and CTRL elbow.')
    bpy.ops.object.mode_set(mode='EDIT')
    lower = rig.data.edit_bones['forearm.'+side]
    lower.use_connect = True
    for name, position in [('CTRL wrist.'+side, lower.tail.copy()),
                           ('CTRL elbow.'+side, lower.head+Vector((-sign*.8,0,-.5)))]:
        bone = rig.data.edit_bones.get(name) or rig.data.edit_bones.new(name)
        bone.matrix = rig.data.edit_bones['hand.'+side].matrix.copy()
        bone.head = position
        bone.tail = position+Vector((0,0,.25))
        bone.parent = rig.data.edit_bones['root']
        bone.use_deform = False
        controls.assign(bone)
    bpy.ops.object.mode_set(mode='OBJECT')
    forearm = rig.pose.bones['forearm.'+side]
    forearm.lock_location = (True,True,True)
    forearm.lock_rotation = (True,True,False)
    forearm.lock_scale = (True,True,True)
    # The pole defines the IK bend plane; locking local solver axes would
    # overconstrain that plane when the shoulder turns in three dimensions.
    forearm.lock_ik_x = forearm.lock_ik_y = False
    forearm.use_ik_limit_z = False
    ik = forearm.constraints.get('Arm IK') or forearm.constraints.new('IK')
    ik.name = 'Arm IK'
    ik.target = rig
    ik.subtarget = 'CTRL wrist.'+side
    ik.pole_target = rig
    ik.pole_subtarget = 'CTRL elbow.'+side
    ik.chain_count = 2
    ik.use_stretch = False
    ik.iterations = 128
    driver = ik.driver_add('influence').driver
    driver.type = 'SCRIPTED'
    driver.expression = 'enabled'
    while driver.variables:
        driver.variables.remove(driver.variables[0])
    variable = driver.variables.new()
    variable.name = 'enabled'
    variable.targets[0].id = rig
    variable.targets[0].data_path = f'["{property_name}"]'
    for name, shape in [('CTRL wrist.'+side,hand_shape),('CTRL elbow.'+side,pole_shape)]:
        control = rig.pose.bones[name]
        control.custom_shape = shape
        control.use_custom_shape_bone_size = False
        control.lock_scale = (True,True,True)
        control.lock_rotation = (True,True,True)
        control.bone.color.palette = 'THEME04'
    # Calibrate pole roll against a known 90-degree FK bend. This avoids mirror
    # side guesses and verifies that switching solvers reproduces the elbow.
    rig[property_name] = 0.0
    scene.frame_set(1)
    forearm.rotation_euler.z = sign*pi/2
    rig.update_tag()
    bpy.context.view_layer.update()
    elbow, wrist = forearm.head.copy(), forearm.tail.copy()
    shoulder = rig.pose.bones['upper_arm.'+side].head.copy()
    pole = elbow+(elbow-(shoulder+wrist)/2).normalized()*1.0
    scene.frame_set(1)
    for name, position in [('CTRL wrist.'+side,wrist),('CTRL elbow.'+side,pole)]:
        matrix = rig.pose.bones[name].matrix.copy()
        matrix.translation = position
        rig.pose.bones[name].matrix = matrix
    rig[property_name] = 1.0
    def error(angle):
        ik.pole_angle = angle
        rig.update_tag()
        bpy.context.view_layer.update()
        return (forearm.head-elbow).length+(forearm.tail-wrist).length
    coarse = min([(-pi+i*pi/36) for i in range(73)], key=error)
    best = min([coarse+(i-10)*pi/360 for i in range(21)], key=error)
    assert error(best)<.005, f'{side}: IK bend error {error(best):.6f}; pole {best:.6f}; wrist {tuple(forearm.tail)} vs {tuple(wrist)}; target {tuple(rig.pose.bones[ik.subtarget].head)}'
    print(f'Arm {side}: calibrated IK pole, endpoint error {error(best):.6f}')
    # The pole stays at its useful bend direction. Reset the wrist target to rest
    # and leave FK active so all existing keyframes retain their original poses.
    rig[property_name] = 0.0
    rig.pose.bones['CTRL wrist.'+side].matrix_basis = Matrix.Identity(4)
    scene.frame_set(1)
rig.update_tag()
bpy.context.view_layer.update()
scene['arm_controls'] = True
