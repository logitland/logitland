"""Tailor the isolated jacket as a windproof shell, leaving the body master alone.

Run against jacket-study.blend. The torso's storm flap, covered zipper, pocket
facings and hem are continuous faces of one closed mesh, not applied plates.
"""
from math import cos, sin, pi, sqrt
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
scene = bpy.data.scenes['JACKET STUDY']
scene.frame_set(1)
rig = bpy.data.objects['LOGAN · Pose me']
assert not bpy.data.objects['Jacket / torso'].get('continuous_sleeves'), 'Extract a fresh jacket before regenerating the tailored torso and joining sleeves'
cloth, dark, light, pink, logo = bpy.data.objects['Jacket / torso'].data.materials
rear_trim = dark.copy()
rear_trim.name = 'Jacket · muted magenta back seam'
rear_shader = rear_trim.node_tree.nodes['Principled BSDF']
rear_shader.inputs['Base Color'].default_value = (.28,.012,.16,1)
rear_shader.inputs['Emission Color'].default_value = (.28,.012,.16,1)
rear_shader.inputs['Emission Strength'].default_value = .25
rear_trim.diffuse_color = (.28,.012,.16,1)
back_panel = cloth.copy()
back_panel.name = 'Jacket · back panel nylon'
back_panel.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.032,.036,.045,1)
back_panel.diffuse_color = (.032,.036,.045,1)

# A quieter nylon finish lets construction and folds, rather than random
# contrasting triangles, define the low-poly fabric.
for material in (cloth, dark, light, logo):
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Metallic'].default_value = .035
    shader.inputs['Roughness'].default_value = .64
    for node in material.node_tree.nodes:
        if node.type == 'BUMP':
            node.inputs['Strength'].default_value = .11
            node.inputs['Distance'].default_value = .004
light.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.020,.022,.028,1)
logo.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = .45


def replace_mesh(obj, vertices, faces, materials, indices):
    """Keep the garment's rig binding while replacing its tailored surface."""
    data = bpy.data.meshes.new(obj.name + ' / tailored topology')
    data.from_pydata(vertices, [], faces)
    for material in materials:
        data.materials.append(material)
    for polygon, index in zip(data.polygons, indices):
        polygon.material_index = index
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj.data = data
    obj.matrix_world = Matrix.Identity(4)
    obj.vertex_groups.clear()
    group = obj.vertex_groups.new(name='torso')
    group.add(list(range(len(vertices))), 1, 'REPLACE')
    return data


# Closely spaced stations at the flap and pockets form actual folds and seam
# channels. The rest of the circumference is a rounded, faceted shell.
front = [-1,-.93,-.83,-.77,-.745,-.70,-.675,-.63,-.53,
         -.44,-.425,-.405,-.38,0,.38,.405,.425,.44,.53,
         .63,.675,.70,.745,.77,.83,.93,1]
profile = [(u, -sqrt(max(0,1-u*u)), True) for u in front]
profile += [(cos(j*pi/12), sin(j*pi/12), False) for j in (1,2,3,4,5,5.8,6,6.2,7,8,9,10,11)]
sections = [(2.82,2.17,1.22),(2.86,2.18,1.24),(2.96,2.17,1.23),
            (3.02,2.12,1.19),(3.14,2.07,1.16),(3.22,2.02,1.13),
            (3.65,1.91,1.08),(3.75,1.90,1.09),(3.80,1.91,1.10),
            (3.85,1.93,1.11),(4.12,2.02,1.20),(4.48,2.09,1.24),
            (4.64,2.06,1.20),(4.70,2.04,1.18),(4.94,1.84,1.08),
            (5.12,1.60,.99)]
vertices = []
for z,width,depth in sections:
    for u,v,is_front in profile:
        x,y,height = u*width/2, v*depth/2, z
        a = abs(u)
        if is_front:
            # A broad covered zip closure: stitched hinge on the left, folded
            # free edge on the right. Its lower edge overlaps the turned hem.
            if a <= .405:
                y = -.68 + .012*(z-2.82)
                if z > 4.70:
                    y += .28*(z-4.70)
                if a == .405:
                    y += .012
                if z <= 2.96:
                    height -= .035
            elif a <= .44:
                y = -depth/2 + (.012 if u > 0 else -.012)
            # Angled hand pockets cut into the front-side panels. Their pink
            # lining sits behind a dark fabric facing and a folded top lip.
            if .63 <= a <= .83 and 3.14 <= z <= 3.85:
                height += .30*(a-.73)
                if .675 <= a <= .77 and 3.22 <= z <= 3.75:
                    y += .035
                if z == 3.80:
                    y -= .045
                elif z == 3.85:
                    y -= .008
            if z in (4.12,4.64) and .53 <= a <= .63:
                y -= .020
        else:
            # Shoulder yoke and restrained back pleats follow the cloth.
            if z in (4.64,4.70):
                height -= .14*(1-abs(u))
                y += .025 if z==4.64 else .065
            if z == 4.94:
                y += .012
            if z in (3.02,3.65) and abs(u) < .3:
                y -= .035
            if 3.02 <= z <= 4.64 and abs(u) < .07:
                y -= .020
            if .2 < abs(u) < .55 and z in (3.65,4.12):
                y += -.035 if z==3.65 else .025
        if z <= 2.96 and not (is_front and a <= .44):
            y += -.016 if is_front else .016
        vertices.append((x,y,height))

sides = len(profile)
faces = [tuple(reversed(range(sides)))]
indices = [0]
armholes = [0]
for row in range(len(sections)-1):
    z = sections[row][0]
    for col,(u,v,is_front) in enumerate(profile):
        following = profile[(col+1)%sides]
        mid = (u+following[0])/2
        a = abs(mid)
        index = 0
        if is_front and following[2]:
            if a < .405:
                index = 4
            elif a < .44:
                index = 1
            if .63 < a < .83 and 3.14 <= z < 3.85:
                index = 1
                if .70 < a < .745 and 3.22 <= z < 3.65:
                    index = 3
                if 3.75 <= z < 3.80:
                    index = 2
        elif 4.64 <= z < 4.94:
            index = 2
            if z==4.64 and abs(mid)<.87:
                index = 5
        elif not is_front and abs(mid)<.55 and 3.02<=z<4.64:
            index = 1 if abs(mid)<.07 else 6
        if z < 2.96 and index != 4:
            index = 1
        quad = (row*sides+col,row*sides+(col+1)%sides,
                (row+1)*sides+(col+1)%sides,(row+1)*sides+col)
        faces.append(quad)
        indices.append(index)
        side = 0
        if 4.12 <= z < 4.94 and abs(mid) >= (.63 if is_front and following[2] else .5):
            side = 1 if mid>0 else 2
        armholes.append(side)
faces.append(tuple(range((len(sections)-1)*sides,len(sections)*sides)))
indices.append(0)
armholes.append(0)
torso = bpy.data.objects['Jacket / torso']
data = replace_mesh(torso,vertices,faces,[cloth,dark,light,pink,logo,rear_trim,back_panel],indices)
attribute = data.attributes.new('armhole_side','INT','FACE')
for item, side in zip(attribute.data,armholes):
    item.value = side
uv = data.uv_layers.new(name='Original SVG')
for loop in data.loops:
    p = data.vertices[loop.vertex_index].co
    uv.data[loop.index].uv = (p.x/1.14+.5,(p.z-4.57)/1.14+.5)

# A compact stand collar, with a rolled upper edge and real inner lining.
# The front closure's pink tab is a material region of the collar itself.
collar_profile = [(-.66,-.79),(-.32,-1),(.18,-.98),(.63,-.80),(.94,-.38),
                  (.96,.25),(.65,.78),(.20,.98),(-.28,1),(-.71,.73),(-.95,.15),(-.92,-.43)]
segments = len(collar_profile)
collar_rings = [(1.63,.98,5.01),(1.87,1.11,5.38),(1.85,1.10,5.44),
                (1.70,.94,5.44),(1.69,.93,5.37),(1.47,.80,5.01)]
vertices = []
for row,(w,d,z) in enumerate(collar_rings):
    for x,y in collar_profile:
        sag = -.16*max(0,-y)**2 + .035*x + .018*sin(x*5)
        if row in (0,5):
            sag *= .15
        vertices.append((w*x/2,d*y/2,z+sag))
faces,indices = [],[]
for row in range(len(collar_rings)):
    for j in range(segments):
        faces.append((row*segments+j,row*segments+(j+1)%segments,
                      ((row+1)%len(collar_rings))*segments+(j+1)%segments,
                      ((row+1)%len(collar_rings))*segments+j))
        indices.append(3 if row in (0,1) and j==2 else (1 if row>=3 else (2 if row==2 else 0)))
collar = bpy.data.objects['Collar / raised band']
replace_mesh(collar,vertices,faces,[cloth,dark,light,bpy.data.materials['Trim · magenta falloff']],indices)

# Retain sleeve topology and blended elbow weights. A small edge radius and
# restrained fabric gathers soften the hard panel edges without widening arms.
for obj in scene.objects:
    if obj.name.startswith('Sleeve /'):
        if not obj.get('windproof_tailoring'):
            side = obj.name.rsplit('.',1)[-1]
            elbow = rig.data.bones['forearm.'+side].head_local
            for vertex in obj.data.vertices:
                p = obj.matrix_world @ vertex.co
                distance = abs(p.z-elbow.z)
                if distance < .22:
                    p.y *= 1 - .045*(1-distance/.22)
                    vertex.co = obj.matrix_world.inverted() @ p
            obj['windproof_tailoring'] = True
        if not obj.modifiers.get('Soft fabric edges'):
            bevel = obj.modifiers.new('Soft fabric edges','BEVEL')
            bevel.width = .012
            bevel.segments = 1
            bevel.limit_method = 'ANGLE'
            bevel.angle_limit = .5

scene['jacket_construction'] = 'Windproof shell with integrated storm flap and covered zipper'
notes = bpy.data.texts.get('Jacket · construction') or bpy.data.texts.new('Jacket · construction')
notes.clear()
notes.write('''
Windproof construction: the broad front storm flap covers the zipper line.
Its hinge, folded free edge, pocket facings and turned hem share the torso mesh.
The collar is a lined stand collar with a rolled upper edge.
refine-jacket.py rebuilds these tailored surfaces in this study only.
''')
intro = bpy.data.texts['START HERE · Jacket study']
text = intro.as_string().split('\nWindproof construction:')[0]
intro.clear()
intro.write(text)
bpy.context.view_layer.update()
scene.render.filepath = str(HERE/'renders/jacket-three-quarter.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'jacket-study.blend'),compress=True)
print('Tailored storm flap, covered zipper seam, pocket facings, stand collar and sleeve edges')
