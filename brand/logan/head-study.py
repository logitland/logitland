"""Build a separate faceted head study without changing Logan's body master.

blender --background --python brand/logan/head-study.py
The shell is a convex polyhedron around the screen, crown, side shoulders and
lower keel. The crown and keel are related by a half turn in side profile.
"""
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

HERE=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(HERE/'logan.blend'))
scene=bpy.data.scenes['LOGAN']
scene.frame_set(1)
rig=bpy.data.objects['LOGAN · Pose me']
rig.animation_data_clear()
for bone in rig.pose.bones:
    bone.rotation_euler=(0,0,0)
bpy.context.view_layer.update()
graph=bpy.context.evaluated_depsgraph_get()
parts=[]
for obj in list(scene.objects):
    if obj.type=='MESH' and obj.name.startswith(('Head /','Headset /','Face /','Screen /')):
        if obj.name=='Head / chamfered monitor housing':
            continue
        evaluated=obj.evaluated_get(graph)
        data=bpy.data.meshes.new_from_object(evaluated)
        part=bpy.data.objects.new(obj.name+' · study',data)
        part.matrix_world=obj.matrix_world.copy()
        # Fit the display inside the crystal's narrower front cross-section.
        if obj.name.startswith(('Screen /','Face /')):
            for vertex in data.vertices:
                p=part.matrix_world @ vertex.co
                original_z=(p.z-5.50)/.80+4.3
                p.z=5.50+(5.36+(original_z-5.31)*(1.40/1.50)-4.3)*.80
                vertex.co=part.matrix_world.inverted() @ p
        elif obj.name.startswith(('Head / recessed rear vent','Head / service fastener','Head / rear status')):
            part.location.z-=.11*.80
        parts.append(part)
for obj in list(scene.objects):
    if not obj.name.startswith(('Studio /','Camera /')):
        bpy.data.objects.remove(obj,do_unlink=True)
for collection in list(scene.collection.children):
    if not collection.objects:
        bpy.data.collections.remove(collection)
head_collection=bpy.data.collections.new('HEAD · isolated shape study')
scene.collection.children.link(head_collection)
for part in parts:
    head_collection.objects.link(part)


def octagon(width,bottom,top,y,cut):
    x=width/2
    return [(-x+cut,y,bottom),(x-cut,y,bottom),(x,y,bottom+cut),
            (x,y,top-cut),(x-cut,y,top),(-x+cut,y,top),
            (-x,y,top-cut),(-x,y,bottom+cut)]


def world(point):
    x,y,z=point
    return (x*.82,y*.94,5.50+(z-4.3)*.80)


front=octagon(2.50,4.60,6.24,-.67,.025)
rear=[(x,.33-y,10.94-z) for x,y,z in front]
# The widest points lie on the side shoulders, while the crown and lower keel
# narrow toward the centre. No constant section is extruded through the head.
anchors=front+rear+[
    (-1.12,-.36,6.56),(1.12,-.36,6.56),
    (-1.12,.69,4.38),(1.12,.69,4.38),
    (-1.36,.165,5.47),(1.36,.165,5.47),
]
bm=bmesh.new()
for point in anchors:
    bm.verts.new(point)
bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
caps=[f for f in bm.faces if all(abs(v.co.y+.67)<1e-5 for v in f.verts)
      or all(abs(v.co.y-1)<1e-5 for v in f.verts)]
bmesh.ops.delete(bm,geom=caps,context='FACES_ONLY')
# Dissolve triangulation inside coplanar facets; retain the actual crystal edges.
bmesh.ops.dissolve_limit(bm,angle_limit=.0001,verts=list(bm.verts),edges=list(bm.edges))


def ring(points):
    result=[]
    for point in points:
        existing=next((v for v in bm.verts if (v.co-Vector(point)).length<1e-5),None)
        result.append(existing if existing is not None else bm.verts.new(point))
    return result


def bridge(a,b):
    for j in range(len(a)):
        bm.faces.new((a[j],a[(j+1)%len(a)],b[(j+1)%len(a)],b[j]))


outer=ring(front)
lip=ring(octagon(2.36,4.64,6.14,-.678,.020))
opening=ring(octagon(2.19,4.66,6.06,-.675,.012))
recess=ring(octagon(2.19,4.66,6.06,-.57,.012))
bridge(outer,lip)
bridge(lip,opening)
bridge(opening,recess)
back=ring(octagon(2.50,4.70,6.34,1,.025))
service=ring(octagon(1.98,4.94,6.18,1,.09))
service_floor=ring(octagon(1.98,4.94,6.18,.95,.09))
bridge(back,service)
bridge(service,service_floor)
bm.faces.new(service_floor)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
data=bpy.data.meshes.new('Head / broad crystal facets')
bm.to_mesh(data)
bm.free()
data.materials.append(bpy.data.materials['Head · brushed graphite casing'])
data.materials.append(bpy.data.materials['Head · twin magenta fades'])
data.materials.append(bpy.data.materials['Head · edge fade'])
data.update()
for face in data.polygons:
    n=face.normal
    centre=face.center
    if (centre.z>6.15 and n.y<-.12 and n.z>.2) or (centre.z<4.82 and n.y>.12 and n.z<-.2):
        face.material_index=1
    elif abs(n.x)>.3:
        face.material_index=2
for vertex in data.vertices:
    vertex.co=world(vertex.co)
shell=bpy.data.objects.new('Head / faceted shell study',data)
head_collection.objects.link(shell)
bevel=shell.modifiers.new('Fine edge highlight','BEVEL')
bevel.width=.004
bevel.segments=1

# Everything remains part of the same physical head assembly. The socket sits
# in the sloping side, and the original face and magenta surface fades remain.
controller=bpy.data.objects.new('HEAD · rotate to inspect',None)
head_collection.objects.link(controller)
controller.location=world((0,.165,5.47))
bpy.context.view_layer.update()
for obj in head_collection.objects:
    if obj is not controller:
        matrix=obj.matrix_world.copy()
        obj.parent=controller
        obj.matrix_world=matrix

floor=bpy.data.objects['Studio / floor']
floor.hide_render=True
# A camera-only neutral background keeps orthographic inspections free of a
# floor horizon, while retaining the master's environment lighting.
world_nodes=scene.world.node_tree.nodes
world_links=scene.world.node_tree.links
background=world_nodes.new('ShaderNodeBackground')
background.inputs['Color'].default_value=(.44,.45,.48,1)
background.inputs['Strength'].default_value=1.2
light_path=world_nodes.new('ShaderNodeLightPath')
world_mix=world_nodes.new('ShaderNodeMixShader')
world_links.new(light_path.outputs['Is Camera Ray'],world_mix.inputs[0])
world_links.new(world_nodes.get('Background').outputs[0],world_mix.inputs[1])
world_links.new(background.outputs[0],world_mix.inputs[2])
world_links.new(world_mix.outputs[0],world_nodes.get('World Output').inputs['Surface'])
camera=scene.camera
target=Vector(world((.12,.05,5.47)))
camera.location=target+Vector((2.2,-10,1.8))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.ortho_scale=3.55
scene.render.resolution_x=1400
scene.render.resolution_y=1400
scene.cycles.samples=64
scene.render.filepath=str(HERE/'renders/head-three-quarter.png')
scene.frame_start=scene.frame_end=1
scene.name='HEAD STUDY'
notes=bpy.data.texts.get('START HERE · Logan')
if notes:
    notes.name='START HERE · Head study'
    notes.clear()
    notes.write('''HEAD STUDY

This is a separate shape study; the full-body master is logan.blend.
Select HEAD · rotate to inspect to rotate the entire assembled head.
The casing is Head / faceted shell study: broad convex facets with a narrow
crown and lower keel, wide side shoulders and a recessed rectangular display.
The face and headset are attached meshes. This study has no pose animation.
The camera and studio remain editable. F12 renders the head.
''')
bpy.ops.object.select_all(action='DESELECT')
shell.select_set(True)
bpy.context.view_layer.objects.active=shell
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active
            space.region_3d.view_perspective='CAMERA'
            space.region_3d.view_camera_zoom=0
            space.region_3d.view_camera_offset=(0,0)
            space.overlay.show_overlays=False
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'head-study.blend'),compress=True)
