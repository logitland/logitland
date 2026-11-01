"""Build separate articulated hands or hollow boots, using the master's fitted rig.

blender --background --python-exit-code 1 --python hands-shoes-study.py -- hands
Use 'shoes' for the boot study. Neither operation saves the full-body master.
"""
from math import radians
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
kind = sys.argv[sys.argv.index('--') + 1]
assert kind in ('hands', 'shoes')
bpy.ops.wm.open_mainfile(filepath=str(HERE / 'logan.blend'))
scene = bpy.data.scenes['LOGAN']
scene.name = kind.upper() + ' STUDY'
scene.frame_set(1)
rig = bpy.data.objects['LOGAN · Pose me']
rig.animation_data_clear()
for obj in list(scene.objects):
    if not (obj.type == 'ARMATURE' or obj.name.startswith(('Studio /', 'Camera /', 'Reference /'))):
        bpy.data.objects.remove(obj, do_unlink=True)
collection = bpy.data.collections['01 · Logan / meshes']

if kind=='hands' and not scene.get('approved_hands'):
    # Keep wrist and fingertips fixed while allocating more length to the palm.
    # Move the actual hinges with the shortened digits so curls remain seated.
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for side in ('L','R'):
        for digit in ('finger1','finger2','finger3','thumb'):
            first = rig.data.edit_bones[f'{digit}.01.{side}']
            second = rig.data.edit_bones[f'{digit}.02.{side}']
            tip = second.tail.copy()
            length_ratio = .90 if digit=='thumb' else .80
            points = [tip+(point-tip)*length_ratio
                      for point in (first.head.copy(),first.tail.copy(),second.tail.copy())]
            first.head, first.tail = points[:2]
            second.head, second.tail = points[1:]
    bpy.ops.object.mode_set(mode='OBJECT')


def material(name, color, metallic, roughness, emission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Emission Color'].default_value = (*color, 1)
    shader.inputs['Emission Strength'].default_value = emission
    return mat


materials = [material('Extremities · graphite shell', (.025,.028,.037), .25, .48),
             material('Extremities · flexible graphite', (.011,.013,.018), .03, .63),
             material('Extremities · edge panels', (.042,.046,.058), .2, .48),
             material('Extremities · inset pink light', (.8,.008,.68), .1, .4, 2.2)]
if kind=='shoes':
    materials.extend([material('Boot · molded slate midsole',(.070,.075,.093),.08,.65),
                      material('Boot · aubergine quarter panels',(.042,.019,.049),.18,.51)])


def mesh_object(name, vertices, faces, indices, weights):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    for mat in materials:
        mesh.materials.append(mat)
    for face, index in zip(mesh.polygons, indices):
        face.material_index = index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    for name in sorted({name for values in weights for name in values}):
        group = obj.vertex_groups.new(name=name)
        for index, values in enumerate(weights):
            if values.get(name, 0):
                group.add([index], values[name], 'REPLACE')
    obj.parent = rig
    modifier = obj.modifiers.new('Articulation', 'ARMATURE')
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    return obj


def hand(side):
    """Branch four digits out of palm sockets, retaining shared webbing at their roots."""
    palm_bone = rig.data.bones['hand.' + side]
    origin = palm_bone.head_local
    down = (palm_bone.tail_local - origin).normalized()
    across = Vector((-down.z, 0, down.x)).normalized()
    front = Vector((0, -1, 0))
    vertices, faces, indices, weights = [], [], [], []

    def vertex(point, values=None):
        vertices.append(tuple(point))
        weights.append(values or {palm_bone.name: 1})
        return len(vertices) - 1

    def face(loop, mat=0):
        faces.append(tuple(loop))
        indices.append(mat)

    def bridge(a, b, mat=0):
        for j in range(len(a)):
            face((a[j], a[(j+1)%len(a)], b[(j+1)%len(a)], b[j]), mat)

    digits = sorted([rig.data.bones[f'finger{i}.01.{side}'] for i in (1,2,3)],
                    key=lambda b: (b.head_local-origin).dot(across))
    # Six columns leave a narrow material bridge between each pair of sockets.
    ends = [bone.head_local + across * offset for bone in digits for offset in (-.112, .112)]
    grid = {}
    for row, t in enumerate((0, .46, 1)):
        for col, end in enumerate(ends):
            wrist = origin + down*.07 + across*((col/5-.5)*.43)
            center = wrist.lerp(end, t)
            for surface, sign in ((0, 1), (1, -1)):
                depth = (.125, .145, .115)[row]
                grid[row,col,surface] = vertex(center + front*sign*depth)
    for row in range(2):
        for col in range(5):
            for surface in (0,1):
                face([grid[row,col,surface], grid[row,col+1,surface],
                      grid[row+1,col+1,surface], grid[row+1,col,surface]],
                     0 if surface==0 else 1)
    for col in range(5):
        face([grid[0,col,0],grid[0,col+1,0],grid[0,col+1,1],grid[0,col,1]],1)
    thumb = rig.data.bones['thumb.01.'+side]
    thumb_col = 0 if (thumb.head_local-origin).dot(across)<0 else 5
    thumb_socket = None
    for col in (0,5):
        for row in range(2):
            loop = [grid[row,col,0],grid[row+1,col,0],grid[row+1,col,1],grid[row,col,1]]
            if col == thumb_col and row == 0:
                thumb_socket = loop
            else:
                face(loop)
    for col in (1,3):
        face([grid[2,col,0],grid[2,col+1,0],grid[2,col+1,1],grid[2,col,1]],1)

    def digit(bone, socket, is_thumb=False):
        second = rig.data.bones[bone.name.replace('.01.', '.02.')]
        first_direction = (bone.tail_local-bone.head_local).normalized()
        second_direction = (second.tail_local-second.head_local).normalized()
        previous = socket
        # The silhouette tapers continuously. Joint loops control bending without
        # cinching the knuckle or inflating the next phalanx into a separate bulb.
        samples = [(bone.head_local+first_direction*.025, first_direction, 1, .10, 0),
                   (bone.head_local.lerp(bone.tail_local,.38), first_direction, .97, .9, 0),
                   (bone.head_local.lerp(bone.tail_local,.70), first_direction, .94, .8, .2),
                   (bone.tail_local, (first_direction+second_direction).normalized(), .91, .5, .5),
                   (second.head_local.lerp(second.tail_local,.32), second_direction, .88, .2, .8),
                   (second.head_local.lerp(second.tail_local,.73), second_direction, .84, 0, 1),
                   (second.head_local.lerp(second.tail_local,.94), second_direction, .80, 0, 1),
                   (second.tail_local, second_direction, .68, 0, 1)]
        for index,(center, direction, scale, w1, w2) in enumerate(samples):
            if is_thumb:
                center = center + across*(.08 if thumb_col==5 else -.08)
            u = Vector((-direction.z, 0, direction.x)).normalized()
            width = (.080 if is_thumb else .090)*scale
            depth = .095*scale
            values = {palm_bone.name:1-w1-w2, bone.name:w1, second.name:w2}
            ring = [vertex(center+u*x*width+front*y*depth,values)
                    for x,y in [(-1,1),(1,1),(1,-1),(-1,-1)]]
            if index==0:
                # Match the socket winding to the actual digit direction.
                candidates = [ring[n:]+ring[:n] for n in range(4)]
                candidates += [list(reversed(r)) for r in candidates]
                ring = min(candidates,key=lambda r: sum((Vector(vertices[a])-Vector(vertices[b])).length_squared
                                                        for a,b in zip(socket,r)))
                first_ids = ring.copy()
                canonical = sorted(first_ids)
                permutation = [canonical.index(i) for i in ring]
            else:
                ring = [ring[i] for i in permutation]
            bridge(previous,ring)
            previous = ring
        face(previous,1)

    for index, bone in enumerate(digits):
        col = index*2
        digit(bone,[grid[2,col,0],grid[2,col+1,0],grid[2,col+1,1],grid[2,col,1]])
    digit(thumb,thumb_socket,True)
    obj = mesh_object('Hand / continuous.'+side,vertices,faces,indices,weights)
    bevel = obj.modifiers.new('Broad edge chamfers','BEVEL')
    bevel.width = .022
    bevel.segments = 1
    bevel.limit_method = 'ANGLE'
    bevel.angle_limit = radians(30)
    bevel.use_clamp_overlap = True
    obj.modifiers.move(1,0)
    return obj


def shoe(side):
    """Loft the outsole, toe box, sloped vamp and open shaft as one continuous upper."""
    sign = 1 if side=='L' else -1
    bone = rig.data.bones['foot.'+side]
    center_x = bone.head_local.x
    profile = [(-.72,-1),(.72,-1),(1,-.80),(1,-.18),(.88,.62),
               (.65,1),(-.65,1),(-.88,.62),(-1,-.18),(-1,-.80)]
    vertices, faces, indices = [], [], []
    # Ring widths/depths preserve the chunky footprint, then retreat over the
    # toe into the ankle. This makes an instep instead of stacked cuboids.
    rings = [(1.12,1.72,-.20,.065), (1.18,1.80,-.20,.15),
             (1.14,1.74,-.20,.255), (1.10,1.68,-.20,.33),
             (1.02,1.54,-.19,.49), (.85,.85,.025,.80),
             (.96,.94,.025,.91), (.96,.94,.025,1.04),
             (.90,.88,.025,1.08)]
    for row,(width,depth,center_y,z) in enumerate(rings):
        for x,y in profile:
            height = z
            if row==0:
                height += .085*max(0,1-abs(y)/.62)+.035*max(0,-y)
            if row in (2,3):
                height += .045*(y+1)/2
            if row==4:
                height += .14*(y+1)/2
            if row>=6:
                height -= .055*max(0,-y)
            vertices.append((center_x+x*width/2,center_y+y*depth/2,height))

    def face(loop, mat=0, recess=False, narrow=False, raised=False, tread=False, straps=False):
        if not (recess or raised or tread or straps):
            faces.append(tuple(loop))
            indices.append(mat)
            return
        points = [Vector(vertices[i]) for i in loop]
        center = sum(points,Vector())/len(points)
        normal = (points[1]-points[0]).cross(points[2]-points[0]).normalized()
        if straps:
            # Two broad closures rise directly from the instep surface. Their
            # bevels and surrounding fabric share edges with the shoe upper.
            corners = [center+(point-center)*.86 for point in points]
            rows = []
            for t,lift in [(0,0),(.18,0),(.25,.035),(.39,.035),(.46,0),
                           (.59,0),(.66,.035),(.80,.035),(.87,0),(1,0)]:
                row = []
                for a,b in ((corners[0],corners[3]),(corners[1],corners[2])):
                    row.append(len(vertices))
                    vertices.append(tuple(a.lerp(b,t)+normal*lift))
                rows.append(row)
            for k in range(len(rows)-1):
                faces.append((rows[k][0],rows[k][1],rows[k+1][1],rows[k+1][0]))
                indices.append(2 if k in (2,6) else 1 if k in (1,3,5,7) else 0)
            faces.extend([(loop[0],loop[1],rows[0][1],rows[0][0]),
                          (loop[3],rows[-1][0],rows[-1][1],loop[2])])
            indices.extend([0,0])
            for side,a,b in ((0,loop[0],loop[3]),(1,loop[1],loop[2])):
                for k in range(len(rows)-1):
                    faces.append((a,rows[k][side],rows[k+1][side]))
                    indices.append(0)
                faces.append((a,rows[-1][side],b))
                indices.append(0)
            return
        # Ring order runs anticlockwise when viewed from above; bridge faces
        # therefore point outwards with this winding.
        inset = []
        for point in points:
            inset.append(len(vertices))
            delta = (point-center)*(.88 if raised else .74 if tread else .72)
            if narrow:
                delta.y *= .48
                delta.z *= 1.16
                if len(loop)==6:
                    delta.y += .16*delta.z
            displacement = .025 if raised or tread else -.025
            vertices.append(tuple(center+delta+normal*displacement))
        for j in range(len(loop)):
            faces.append((loop[j],loop[(j+1)%len(loop)],inset[(j+1)%len(loop)],inset[j]))
            indices.append(1 if tread or recess else 0)
        faces.append(tuple(inset))
        indices.append(3 if recess else mat)

    n = len(profile)
    for row in range(len(rings)-1):
        for j in range(n):
            loop = [row*n+j,row*n+(j+1)%n,(row+1)*n+(j+1)%n,(row+1)*n+j]
            outer = 3 if sign==1 else 7
            if row in (3,4) and j==outer:
                continue
            toe = row==2 and j==0
            sole_pixel = row==1 and j==(2 if sign==1 else 8)
            instep = row==4 and j==(1 if sign==1 else 9)
            heel_signal = row==5 and j==5
            mat = 1 if row==0 else 4 if row==1 else 1 if row==2 else 2 if row in (3,6) else 0
            if row==4 and j in (4,5,6):
                mat=5
            reinforced = (row==4 and j==5) or (row==6 and j==0)
            face(loop,mat,toe or sole_pixel or instep or heel_signal,
                 sole_pixel,reinforced,straps=(row==4 and j==0))
    j = 3 if sign==1 else 7
    face([3*n+j,3*n+(j+1)%n,4*n+(j+1)%n,5*n+(j+1)%n,5*n+j,4*n+j],
         recess=True,narrow=True)
    # Four transverse tread pads rise out of the sole; the grooves between them
    # and the higher midfoot keep the underside from being a flat slab.
    bottom_rows = [(0,1),(9,2),(8,3),(7,4),(6,5)]
    for (left,right),(next_left,next_right) in zip(bottom_rows,bottom_rows[1:]):
        face((left,next_left,next_right,right),1,tread=True)
    # A smooth inner last gives the inserts physical backing without forcing
    # solidify to offset the narrow recess walls into each other.
    previous = list(range(8*n,9*n))
    for source_row in (8,6,5,4,3):
        width,depth,center_y,z = rings[source_row]
        width -= .14 if source_row>=5 else .22
        depth -= .14 if source_row>=5 else .22
        inner = []
        for x,y in profile:
            height = z if source_row==8 else z-.035 if source_row>=4 else .36
            if source_row==4:
                height += .14*(y+1)/2
            if source_row>=6:
                height -= .055*max(0,-y)
            inner.append(len(vertices))
            vertices.append((center_x+x*width/2,center_y+y*depth/2,height))
        for j in range(n):
            face((previous[j],previous[(j+1)%n],inner[(j+1)%n],inner[j]),1)
        previous = inner
    face(tuple(reversed(previous)),1)
    obj = mesh_object('Boot / continuous.'+side,vertices,faces,indices,
                      [{bone.name:1} for _ in vertices])
    bevel = obj.modifiers.new('Molded edge chamfers','BEVEL')
    bevel.width = .012
    bevel.segments = 1
    bevel.limit_method = 'ANGLE'
    bevel.angle_limit = radians(40)
    return obj


for side in ('L','R'):
    hand(side) if kind=='hands' else shoe(side)
for bone in rig.pose.bones:
    bone.keyframe_insert('rotation_euler',frame=1,group=bone.name)
    bone.keyframe_insert('rotation_euler',frame=40,group=bone.name)
for side in ('L','R'):
    names = [f'{digit}.{joint:02}.{side}' for digit in ('finger1','finger2','finger3','thumb')
             for joint in (1,2)] if kind=='hands' else ['foot.'+side]
    for name in names:
        bone = rig.pose.bones[name]
        angle = (-32 if '.01.' in name else -52) if kind=='hands' else 22
        if name.startswith('thumb'):
            angle *= .6
        bone.rotation_euler.x += radians(angle)
        bone.keyframe_insert('rotation_euler',frame=40,group=name)
scene.frame_set(1)
if kind=='hands':
    for bone in rig.pose.bones:
        bone.keyframe_insert('rotation_euler',frame=70,group=bone.name)
    # Positive local Z opens finger1 away from finger2; the old master's wave
    # uses the opposite signs and brings the fingertips through each other.
    for side in ('L','R'):
        for digit,angle in ((1,8),(3,-10)):
            bone = rig.pose.bones[f'finger{digit}.01.{side}']
            bone.rotation_euler.z = radians(angle)
            bone.keyframe_insert('rotation_euler',frame=70,group=bone.name)
    scene.frame_end = 70
scene.frame_set(1)
scene.timeline_markers.clear()
scene.timeline_markers.new('REST',frame=1)
scene.timeline_markers.new('CURL' if kind=='hands' else 'ANKLE BEND',frame=40)
if kind=='hands':
    scene.timeline_markers.new('SPREAD',frame=70)
bpy.data.objects['Studio / floor'].hide_render = True
bpy.data.objects['Studio / floor'].hide_set(True)
nodes = scene.world.node_tree.nodes
links = scene.world.node_tree.links
background = nodes.new('ShaderNodeBackground')
background.inputs['Color'].default_value = (.44,.45,.48,1)
background.inputs['Strength'].default_value = 1.2
path = nodes.new('ShaderNodeLightPath')
mix = nodes.new('ShaderNodeMixShader')
links.new(path.outputs['Is Camera Ray'],mix.inputs[0])
links.new(nodes['Background'].outputs[0],mix.inputs[1])
links.new(background.outputs[0],mix.inputs[2])
links.new(mix.outputs[0],nodes['World Output'].inputs['Surface'])
for key in ('approved_head','approved_jacket','approved_pants'):
    if key in scene:
        del scene[key]
scene['study_kind'] = kind
scene.render.resolution_x = scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.render.filepath = str(HERE/'renders'/f'{kind}-three-quarter.png')
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = next(iter(collection.objects))
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.region_3d.view_camera_zoom=0
            area.spaces.active.region_3d.view_camera_offset=(0,0)
intro = bpy.data.texts['START HERE · Logan']
intro.name = 'START HERE · '+kind.title()
intro.clear()
intro.write(f'{kind.upper()} STUDY\n\nFrame 1: rest. Frame 40: articulation check.\n'
            'Each side is one continuous surface, bound to the existing character rig.\n'
            'This study is independent of the full-body master.\n')
if kind=='hands':
    # Keep the close-up useful; the opposite hand remains editable in the file.
    other = bpy.data.objects['Hand / continuous.R']
    other.hide_set(True)
    other.hide_render = True
    intro.write('The right hand is hidden for the close-up; enable it in the Outliner.\n')
    intro.write('Frame 70: spread fingers.\n')
# Frame each pair before saving, without changing their master-space coordinates.
direction = Vector((3,-12,5 if kind=='shoes' else 2))
rotation = (-direction).to_track_quat('-Z','Y')
bpy.context.view_layer.update()
points = [rotation.inverted()@(obj.matrix_world@Vector(p)) for obj in collection.objects
          if not obj.hide_render for p in obj.bound_box]
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
target = rotation@((low+high)/2)
scene.camera.location = target+direction
scene.camera.rotation_euler = rotation.to_euler()
scene.camera.data.ortho_scale = max(high.x-low.x,high.y-low.y)*1.15
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/f'{kind}-study.blend'),compress=True)
