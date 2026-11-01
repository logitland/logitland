"""Experimental raised-arm fit with 18% extra forearm reach; not the approved pose."""
import bpy, numpy as np, json, runpy
from pathlib import Path
from math import degrees, radians
from mathutils import Vector, Matrix, Euler

ROOT = Path(__file__).resolve().parent.parent

scene=bpy.data.scenes['AVATAR · Production']
bpy.context.window.scene=scene
scene.frame_set(80)
rig=next(o for o in scene.objects if o.get('logan_pose_controls'))
rig.animation_data.action=rig.animation_data.action.copy()
root=rig.pose.bones['root'].matrix @ rig.data.bones['root'].matrix_local.inverted()
hand_matrices={side:rig.pose.bones['hand.'+side].matrix.copy() for side in 'LR'}
for side in 'LR':
    rig.pose.bones['forearm.'+side].scale.y=1.18
    rig.pose.bones['forearm.'+side].keyframe_insert('scale',frame=80)
    for stem in ('hand','wrist_cuff'):
        rig.data.bones[stem+'.'+side].inherit_scale='NONE'
    drape=scene.objects['LOGAN · Sleeve drape']
    drape.pose.bones['forearm.'+side].scale.y=1.18
    drape.data.bones['hand.'+side].inherit_scale='NONE'
bpy.context.view_layer.update()

def update():
    rig.update_tag()
    bpy.context.view_layer.update()

def solve(side,wrist,elbow):
    upper=rig.pose.bones['upper_arm.'+side];lower=rig.pose.bones['forearm.'+side]
    w,e=root@Vector(wrist),root@Vector(elbow)
    x=np.array([*upper.rotation_euler,lower.rotation_euler.z])
    def residual(v):
        upper.rotation_euler=Euler(v[:3],'XYZ')
        lower.rotation_euler=Euler((0,0,v[3]),'XYZ')
        update()
        return np.array([*(lower.tail-w),*((lower.head-e)*.65)])
    for i in range(45):
        r=residual(x)
        jac=np.empty((6,4))
        for k in range(4):
            offset=np.zeros(4);offset[k]=.0003
            jac[:,k]=(residual(x+offset)-r)/.0003
        step=np.linalg.lstsq(jac,-r,rcond=None)[0]
        x+=np.clip(step,-.2,.2)
        if np.linalg.norm(step)<1e-6:break
    residual(x)
    assert 0 < degrees(x[3])*(1 if side=='L' else -1) < 160
    for b in (upper,lower):b.keyframe_insert('rotation_euler',frame=80)

def hand(side,fingers,palm):
    bone=rig.pose.bones['hand.'+side]
    y=(root.to_3x3()@Vector(fingers)).normalized()
    z=root.to_3x3()@Vector(palm);z=(z-y*z.dot(y)).normalized()
    m=Matrix((y.cross(z),y,z)).transposed().to_4x4();m.translation=bone.head
    bone.matrix=m;update()
    bone.keyframe_insert('rotation_euler',frame=80)

solve('R',(.12,-1.05,4.45),(-1.20,-1.10,4.20))
solve('L',(-.05,-1.30,4.10),(1.30,-.95,4.10))
hand('R',(.94,.1,.32),(-.15,.95,-.2))
hand('L',(-.88,.40,.05),(.25,.9,-.2))
for side in 'LR':
    for index in (1,2,3):
        for joint,angle in ((1,15 if side=='R' else 3),(2,30 if side=='R' else 8)):
            bone=rig.pose.bones[f'finger{index}.0{joint}.{side}']
            bone.rotation_euler.x=radians(angle)
            bone.keyframe_insert('rotation_euler',frame=80)
helpers=runpy.run_path(str(ROOT/'logan_pose_tools.py'))
for side in 'LR':helpers['snap_targets'](rig,side)
helpers['hold_keys'](rig)
update()
camera=scene.camera
camera.location=(3.3,-6.2,6.6)
camera.rotation_euler=(Vector((0,-.15,5.45))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens=48;camera.data.sensor_width=32;camera.data.sensor_fit='AUTO'
camera.data.shift_x=camera.data.shift_y=0
camera.data.dof.aperture_fstop=4
scene.render.resolution_x=scene.render.resolution_y=1000
scene.render.resolution_percentage=100
scene.render.use_border=False
runpy.run_path(str(ROOT/'fit-avatar-background.py'))['fit_background'](scene)
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24
scene.render.threads_mode='FIXED';scene.render.threads=8
scene.render.filepath='/tmp/logan-banner-pose-v6.png'
bpy.ops.wm.save_as_mainfile(filepath='/tmp/logan-banner-pose-study.blend',compress=True)
print('JOINTS',json.dumps({side:{n:list(root.inverted()@rig.pose.bones[n+'.'+side].head) for n in ('upper_arm','forearm','hand')} for side in 'LR'}))
bpy.ops.render.render(write_still=True)
