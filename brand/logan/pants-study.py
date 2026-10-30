"""Build an isolated, continuous pair of Logan's trousers around the existing rig.

Reads logan.blend without modifying it. Boots remain as fitting references.
"""
from math import cos, sin, radians
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(HERE/'logan.blend'))
scene = bpy.data.scenes['LOGAN']
scene.name = 'PANTS STUDY'
scene.frame_set(1)
rig = bpy.data.objects['LOGAN · Pose me']
source = bpy.data.objects['Trouser / continuous.L']
materials = list(source.data.materials)
for obj in list(scene.objects):
    if not (obj.name.startswith(('Boot /','Studio /','Camera /','Reference /')) or obj.type=='ARMATURE'):
        bpy.data.objects.remove(obj,do_unlink=True)
if 'approved_head' in scene:
    del scene['approved_head']

for material in materials[:3]:
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Metallic'].default_value = .035
    shader.inputs['Roughness'].default_value = .64
    for node in material.node_tree.nodes:
        if node.type=='BUMP':
            node.inputs['Strength'].default_value = .11
            node.inputs['Distance'].default_value = .004
materials[2].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.020,.022,.028,1)

groups = ['pelvis','thigh.L','shin.L','thigh.R','shin.R']
collection = bpy.data.collections['01 · Logan / meshes']


def cloth_mesh(name, vertices, faces, indices):
    """Create cloth with consistent material indices for sewing."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices,[],faces)
    for material in materials:
        mesh.materials.append(material)
    for face,index in zip(mesh.polygons,indices):
        face.material_index = index
    obj = bpy.data.objects.new(name,mesh)
    collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return obj


# Both legs share a saddle-shaped crotch and one waist perimeter. This is an
# open cloth pattern, not capped leg solids intersected with a pelvis block.
vertices,faces,indices = [],[],[]
sections = [(2.70,.96,.94),(2.32,.89,.90),(1.84,.85,.88),
            (1.53,.92,.94),(1.20,.98,.94),(1.07,.80,.78),(.99,.72,.72)]
count = 12
tops = {}
for side,sign in [('L',1),('R',-1)]:
    hip = rig.data.bones['thigh.'+side].head_local
    knee = rig.data.bones['shin.'+side].head_local
    ankle = rig.data.bones['shin.'+side].tail_local
    rings = []
    for row,(z,width,depth) in enumerate(sections):
        ring = []
        if z>=knee.z:
            center = knee.lerp(hip,(z-knee.z)/(hip.z-knee.z))
        else:
            center = ankle.lerp(knee,(z-ankle.z)/(knee.z-ankle.z))
        for j in range(count):
            angle = radians(-90+30*j)
            x,y = sign*width/2*cos(angle),depth/2*sin(angle)
            height = z
            if row==0:
                height -= .23*max(0,-cos(angle))
            # Cloth pulls into broad diagonal folds at the knee; the back
            # gathers slightly while the front retains room over the joint.
            if row==2:
                height += .10 if j in (0,6) else -.045
                y += -.045 if j==0 else -.035 if j in (5,6,7) else 0
            if row==3:
                height += .045*cos(angle*2)+sign*.012*sin(angle)
            ring.append(len(vertices))
            vertices.append((center.x+x,center.y+y,height))
        rings.append(ring)
    tops[side] = rings[0]
    inset_faces = []
    for row in range(len(sections)-1):
        for j in range(count):
            a,b = rings[row][j],rings[row][(j+1)%count]
            c,d = rings[row+1][(j+1)%count],rings[row+1][j]
            # The inset wraps the outside, including its front and rear bevels.
            if row==3 and j in (2,3):
                inset_faces.append((a,b,c,d))
            elif row in (1,2,3) and j in (0,1,4,5,6,7,10,11):
                faces.extend(((a,b,c),(a,c,d)) if (row+j)%2 else ((a,b,d),(b,c,d)))
                indices.extend((0,2 if row==2 and j==6 else 0))
            else:
                faces.append((a,b,c,d))
                indices.append(1 if row==len(sections)-2 else 0)
    inset = {}
    perimeter = {}
    for face in inset_faces:
        for index in face:
            if index not in inset:
                p = Vector(vertices[index])
                p.x -= sign*.025
                # Ramp the upper/lower cavity walls toward the inset. This
                # leaves room for fabric thickness at the gathered hem.
                p.z += .025 if p.z<1.3 else -.025
                inset[index] = len(vertices)
                vertices.append(tuple(p))
        faces.append(tuple(inset[i] for i in face))
        indices.append(3)
        for a,b in zip(face,face[1:]+face[:1]):
            key = tuple(sorted((a,b)))
            perimeter[key] = None if key in perimeter else (a,b)
    for edge in perimeter.values():
        if edge:
            a,b = edge
            faces.append((a,b,inset[b],inset[a]))
            indices.append(1)

# Sew the inner semicircles across a shared center seam. The outer semicircles
# become the front, sides and back of the upper garment without a junction lip.
inner = [6,7,8,9,10,11,0]
middle = []
for j in inner:
    p = (Vector(vertices[tops['L'][j]])+Vector(vertices[tops['R'][j]]))/2
    p.y += .018*sin(radians(-90+30*j))
    middle.append(len(vertices))
    vertices.append(tuple(p))
for side in ('L','R'):
    for k in range(len(inner)-1):
        faces.append((tops[side][inner[k]],tops[side][inner[k+1]],middle[k+1],middle[k]))
        indices.append(0)
perimeter = [middle[-1]]+tops['L'][:7]+[middle[0]]+list(reversed(tops['R'][:7]))
half = [(.46,-.48),(.71,-.42),(.87,-.26),(.94,.01),(.88,.28),(.72,.45),(.46,.52)]
profile = [(0,-.49)]+half+[(0,.54)]+[(-x,y) for x,y in reversed(half)]
for row,(z,width,depth) in enumerate([(2.85,1.07,1.02),(2.88,1.065,1.015),(3.08,.99,.98),
                                     (3.10,1.01,1.02),(3.18,1,1),(3.20,.98,.98)]):
    ring = []
    for x,y in profile:
        sag = -.045*max(0,-y/.5)**2 + .012*sin(x*3)
        yoke = -.07*max(0,y/.54)*(1-abs(x)) if row<2 else 0
        ring.append(len(vertices))
        vertices.append((x*width,y*depth,z+sag+yoke))
    for j in range(len(ring)):
        next_j = (j+1)%len(ring)
        faces.append((perimeter[j],perimeter[next_j],ring[next_j],ring[j]))
        indices.append(1 if row==1 and profile[j][1]>.2 else 0)
    perimeter = ring
pants = cloth_mesh('Trouser / continuous pants',vertices,faces,indices)
# Bind the whole cloth spatially so inset lights and their walls bend together.
for name in groups:
    pants.vertex_groups.new(name=name)
for vertex in pants.data.vertices:
    x,_,z = vertex.co
    pelvis_weight = max(0,min(1,(z-2.55)/.59))
    pelvis_weight = pelvis_weight*pelvis_weight*(3-2*pelvis_weight)
    if z>2.6:
        pelvis_weight = max(pelvis_weight, max(0,1-abs(x)/.35))
    shin_weight = max(0,min(1,(2.05-z)/.55))
    shin_weight = shin_weight*shin_weight*(3-2*shin_weight)
    left_weight = max(0,min(1,.5+x/.3))
    values = {'pelvis':pelvis_weight}
    for side,share in [('L',left_weight),('R',1-left_weight)]:
        values['thigh.'+side] = (1-pelvis_weight)*(1-shin_weight)*share
        values['shin.'+side] = (1-pelvis_weight)*shin_weight*share
    for name,weight in values.items():
        if weight:
            pants.vertex_groups[name].add([vertex.index],weight,'REPLACE')
pants.parent = rig
modifier = pants.modifiers.new('Continuous hip and knee deformation','ARMATURE')
modifier.object = rig
modifier.use_deform_preserve_volume = True
thickness = pants.modifiers.new('Cloth thickness and turned openings','SOLIDIFY')
thickness.thickness = .018
thickness.offset = -1
thickness.solidify_mode = 'NON_MANIFOLD'
thickness.nonmanifold_thickness_mode = 'CONSTRAINTS'
thickness.thickness_clamp = 1

# The second pose exercises the actual knee, rather than repeating straight legs.
scene.frame_set(40)
rig.pose.bones['thigh.L'].rotation_euler.x = radians(-24)
rig.pose.bones['shin.L'].rotation_euler.x = radians(48)
for name in ('thigh.L','shin.L'):
    rig.pose.bones[name].keyframe_insert('rotation_euler',frame=40,group=name)
scene.timeline_markers.clear()
scene.timeline_markers.new('NEUTRAL',frame=1)
scene.timeline_markers.new('KNEE BEND',frame=40)
scene.frame_set(1)

scene['pants_construction'] = 'One waist, seat and leg surface; recessed outer calf lights; continuous knees'
nodes,links = scene.world.node_tree.nodes,scene.world.node_tree.links
background = nodes.new('ShaderNodeBackground')
background.inputs['Color'].default_value = (.44,.45,.48,1)
background.inputs['Strength'].default_value = 1.2
path = nodes.new('ShaderNodeLightPath')
mix = nodes.new('ShaderNodeMixShader')
links.new(path.outputs['Is Camera Ray'],mix.inputs[0])
links.new(nodes['Background'].outputs[0],mix.inputs[1])
links.new(background.outputs[0],mix.inputs[2])
links.new(mix.outputs[0],nodes['World Output'].inputs['Surface'])
bpy.data.objects['Studio / floor'].hide_render = True
bpy.data.objects['Studio / floor'].hide_set(True)
scene.camera.location = (4,-12,4.2)
scene.camera.rotation_euler = (Vector((0,0,1.65))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.ortho_scale = 4.1
scene.render.resolution_x = scene.render.resolution_y = 1200
scene.render.film_transparent = False
scene.render.filepath = str(HERE/'renders/pants-three-quarter.png')
notes = bpy.data.texts['START HERE · Logan']
notes.name = 'START HERE · Pants study'
notes.clear()
notes.write('''PANTS STUDY

One connected pair of trousers: waist, seat, legs and recessed calf lights.
Boots are the unchanged master geometry, included as fitting references.
Frame 1: neutral. Frame 40: knee bend. The original leg rig remains editable.
This study does not modify the approved coat or the full-body master.
F12 renders the study; pants-study.py rebuilds it from logan.blend.
''')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space = area.spaces.active
            space.region_3d.view_perspective = 'CAMERA'
            space.region_3d.view_camera_zoom = 0
            space.region_3d.view_camera_offset = (0,0)
            space.overlay.show_overlays = False
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'pants-study.blend'),compress=True)
