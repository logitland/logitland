"""Build Logan's editable Blender master from the supplied concept.

Run with Blender 5.2: blender --background --python brand/logan/build.py
Only the LOGAN scene is rebuilt. Front is -Y; one unit is one stylized metre.
"""
from pathlib import Path
from math import radians, sin, cos, pi
import random

import bpy
from mathutils import Matrix, Vector

ASSET_DIR = Path(__file__).resolve().parent
ASSET_DIR.mkdir(parents=True, exist_ok=True)
(ASSET_DIR / "renders").mkdir(exist_ok=True)
random.seed(18)

old_scene = bpy.data.scenes.get("LOGAN")
if old_scene:
    old_data = {obj.data for obj in old_scene.objects if obj.data}
    old_materials = {mat for obj in old_scene.objects if obj.type=='MESH' for mat in obj.data.materials}
    for obj in list(old_scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for data in old_data:
        if data.users == 0:
            bpy.data.batch_remove([data])
    for mat in old_materials:
        if mat.users == 0:
            bpy.data.materials.remove(mat)
    for group in list(old_scene.collection.children):
        if not group.objects and not group.children:
            bpy.data.collections.remove(group)
    scene = old_scene
else:
    scene = bpy.data.scenes.new("LOGAN")
if bpy.context.window:
    bpy.context.window.scene = scene


def collection(name):
    group = bpy.data.collections.new(name)
    scene.collection.children.link(group)
    return group


character = collection("01 · Logan / meshes")
rig_collection = collection("02 · Pose rig")
studio = collection("03 · Studio")
reference_collection = collection("04 · Reference")
bindings = []
deform_bindings = []


def material(name, color, metallic=0, roughness=.4, emission=0, texture=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = emission
    if texture:
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 160
        noise.inputs["Detail"].default_value = 2
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = .16
        bump.inputs["Distance"].default_value = .009
        mat.node_tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        mat.node_tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return mat


shell = material("Graphite · ceramic metal", (.014, .015, .020), .50, .43, texture=True)
edge = material("Graphite · edge facets", (.042, .045, .053), .6, .34, texture=True)
black = material("Ink · face graphics", (.002, .001, .004), .05, .32)
rubber = material("Joint · soft black", (.012, .014, .019), .1, .58)
cloth = material("Jacket · charcoal", (.013, .014, .018), .12, .57, texture=True)
cloth_dark = material("Jacket · shadow facet", (.010, .011, .014), .12, .58, texture=True)
cloth_light = material("Jacket · light facet", (.017, .018, .022), .12, .56, texture=True)
pink = material("Pink · anodised trim", (.8, .012, .66), .35, .45)
light_pink = material("Pink · lit inlay", (.8, .008, .68), .15, .35, 2.2)
screen_mat = material("Screen · hot pink", (.8, .008, .68), 0, .5, 1.7)
highlight = material("Screen · eye pixels", (.95, .025, .8), 0, .35, .5)
ground_mat = material("Studio · warm grey", (.44, .45, .48), 0, .8, 1.2)


def gradient_metal(name, stops, axis='X'):
    """A surface finish, with the reference's magenta-to-graphite fade baked into its coordinates."""
    mat=material(name,(.10,.002,.08),.65,.42,texture=True)
    nodes=mat.node_tree.nodes
    links=mat.node_tree.links
    coords=nodes.new('ShaderNodeTexCoord')
    separate=nodes.new('ShaderNodeSeparateXYZ')
    ramp=nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
    for i,(position,color) in enumerate(stops):
        element=ramp.color_ramp.elements[0] if i==0 else ramp.color_ramp.elements.new(position)
        element.position=position
        element.color=(*color,1)
    links.new(coords.outputs['Generated'],separate.inputs[0])
    links.new(separate.outputs[axis],ramp.inputs[0])
    shader=nodes.get('Principled BSDF')
    links.new(ramp.outputs['Color'],shader.inputs['Base Color'])
    links.new(ramp.outputs['Color'],shader.inputs['Emission Color'])
    shader.inputs['Emission Strength'].default_value=.22
    return mat


hot=(.95,.008,.78)
ink=(.009,.002,.012)
head_gradient=gradient_metal('Head · twin magenta fades',[
    (0,hot),(.08,(.30,.002,.24)),(.30,(.045,.002,.035)),(.55,ink),
    (.575,ink),(.58,hot),(.67,(.24,.002,.18)),(.85,(.035,.002,.026)),(1,ink)])
side_gradient=gradient_metal('Head · edge fade',[(0,(.15,.002,.12)),(.08,ink),(.90,ink),(1,(.25,.002,.20))],'Z')
trim_gradient=gradient_metal('Trim · magenta falloff',[(0,hot),(1,ink)])

# A brighter centre gives the display luminous depth, while retaining its pink edge.
nodes=screen_mat.node_tree.nodes
links=screen_mat.node_tree.links
coords=nodes.new('ShaderNodeTexCoord')
distance=nodes.new('ShaderNodeVectorMath')
distance.operation='DISTANCE'
distance.inputs[1].default_value=(.5,0,.5)
ramp=nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color=(.95,.035,.90,1)
ramp.color_ramp.elements[1].position=.72
ramp.color_ramp.elements[1].color=(.70,.004,.60,1)
links.new(coords.outputs['Generated'],distance.inputs[0])
links.new(distance.outputs['Value'],ramp.inputs[0])
for socket in ['Base Color','Emission Color']:
    links.new(ramp.outputs['Color'],nodes.get('Principled BSDF').inputs[socket])


def link(obj, group=character, bone=None):
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    group.objects.link(obj)
    if bone:
        bindings.append((obj, bone))
    return obj


def finish(obj, mat, bevel=0, segments=1, bone=None):
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("Machined edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = segments
    normal = obj.modifiers.new("Face normals", "WEIGHTED_NORMAL")
    normal.keep_sharp = True
    link(obj, bone=bone)
    return obj


def box(name, loc, size, mat=shell, bevel=.035, bone=None, rotation=None, segments=1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rotation:
        obj.rotation_euler = rotation
    return finish(obj, mat, bevel, segments, bone)


def mesh(name, verts, faces, mat, bone=None, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    character.objects.link(obj)
    return finish(obj, mat, bevel, 1, bone)


def outline(width, height, cut):
    x, z = width / 2, height / 2
    return [(-x+cut,-z),(x-cut,-z),(x,-z+cut),(x,z-cut),
            (x-cut,z),(-x+cut,z),(-x,z-cut),(-x,-z+cut)]


def monitor_head():
    """Steep top-front and bottom-rear chamfers related by a half turn in side profile."""
    rings=[(2.50,1.78,5.27,-.67,.035),
           (2.36,1.67,5.29,-.678,.025),
           (2.19,1.50,5.31,-.675,.012),
           (2.19,1.50,5.31,-.57,.012),
           (2.66,2.18,5.47,-.39,.035),
           (2.66,2.18,5.47,.72,.035),
           (2.50,1.78,5.67,1.00,.035),
           (1.98,1.26,5.67,1.00,.09),
           (1.98,1.26,5.67,.95,.09)]
    verts=[(x,y,z+center_z) for w,h,center_z,y,c in rings for x,z in outline(w,h,c)]
    faces=[]
    # Outer slope, dark inner lip, screen recess, casing sides, rear cap.
    for a,b in [(0,1),(1,2),(2,3),(4,0),(5,4),(6,5),(7,6),(8,7)]:
        faces.extend((a*8+j,a*8+(j+1)%8,b*8+(j+1)%8,b*8+j) for j in range(8))
    faces.append(tuple(reversed(range(64,72))))
    housing=shell.copy()
    housing.name='Head · brushed graphite casing'
    shader=housing.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Metallic'].default_value=.25
    shader.inputs['Roughness'].default_value=.60
    obj=mesh('Head / chamfered monitor housing',verts,faces,housing,'head',.018)
    obj.data.materials.append(head_gradient)
    obj.data.materials.append(side_gradient)
    for poly in obj.data.polygons:
        if 24<=poly.index<32:
            poly.material_index=1 if poly.index%8 in (3,4,5) else 2
        elif 40<=poly.index<48:
            poly.material_index=1 if poly.index%8 in (7,0,1) else 2
        elif 48<=poly.index<64:
            poly.material_index=2
    return obj


def panel(name, points, y, mat, bone, bevel=.012, depth=.035):
    """Extruded XZ silhouette, useful for the face and jacket's fitted panels."""
    verts = [(x,y,z) for x,z in points] + [(x,y+depth,z) for x,z in points]
    n = len(points)
    faces = [tuple(reversed(range(n))), tuple(range(n,2*n))]
    faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    return mesh(name, verts, faces, mat, bone, bevel)


def face_tile(name, center, size, radius, mat, bone):
    """Round the screen-space silhouette without bevel clamping to its thin depth."""
    width,height=size
    points=[]
    for cx,cz,start in [(width/2-radius,height/2-radius,0),
                        (-width/2+radius,height/2-radius,90),
                        (-width/2+radius,-height/2+radius,180),
                        (width/2-radius,-height/2+radius,270)]:
        for i in range(7):
            angle=radians(start+i*15)
            points.append((cx+radius*cos(angle),cz+radius*sin(angle)))
    obj=panel(name,points,0,mat,bone,0)
    obj.location=center
    return obj


def segment_rotation(direction):
    """Keep the cross-section's front along -Y while aiming its length down a limb."""
    z=Vector(direction).normalized()
    x=Vector((0,1,0)).cross(z).normalized()
    y=z.cross(x)
    return Matrix((x,y,z)).transposed().to_quaternion()


def segment_box(name, start, end, width, depth, mat, bone, bevel=.05):
    a,b = Vector(start),Vector(end)
    obj = box(name,(a+b)/2,(width,depth,(b-a).length),mat,bevel,bone)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = segment_rotation(b-a)
    return obj


def faceted_segment(name, start, end, rings, bone, mat=cloth):
    """Octagonal armor with broad, deliberately low-poly facets."""
    a,b = Vector(start),Vector(end)
    direction = b-a
    rotation = segment_rotation(direction)
    verts = []
    for t,w,d in rings:
        cross = outline(w,d,min(w,d)*.30)
        verts.extend(a + direction*t + rotation @ Vector((x,y,0)) for x,y in cross)
    faces = [tuple(reversed(range(8)))]
    for j in range(len(rings)-1):
        for i in range(8):
            k=(i+1)%8
            if i in (0,4) and j % 2 == 0:
                faces.extend([(j*8+i,j*8+k,(j+1)*8+k),
                              (j*8+i,(j+1)*8+k,(j+1)*8+i)])
            else:
                faces.append((j*8+i,j*8+k,(j+1)*8+k,(j+1)*8+i))
    faces.append(tuple(range((len(rings)-1)*8,len(rings)*8)))
    obj = mesh(name,verts,faces,mat,bone,.012)
    if mat == cloth:
        obj.data.materials.append(cloth_dark)
        obj.data.materials.append(cloth_light)
        for poly in obj.data.polygons:
            poly.material_index = random.choices([0,1,2],[7,1,1])[0]
    return obj


def continuous_limb(name, start, joint, end, rings, bones, side, stripe=True):
    """One watertight low-poly sleeve or trouser leg, smoothly weighted across its joint."""
    start,joint,end=map(Vector,(start,joint,end))
    pivot=(joint-start).length/((joint-start).length+(end-joint).length)
    # An elliptical polygon, rather than a rectangle with clipped corners.
    profile=[(-.191,-.462),(-.075,-.485),(.075,-.485),(.191,-.462),(.265,-.388),
             (.462,-.191),(.462,.191),(.191,.462),(-.191,.462),(-.462,.191),
             (-.462,-.191),(-.265,-.388)]
    sides=len(profile)
    verts=[]
    weights=[]
    for t,w,d in rings:
        w*=1.20 if stripe else 1.35
        d*=1.22
        if t<=pivot:
            center=start.lerp(joint,t/pivot)
        else:
            center=joint.lerp(end,(t-pivot)/(1-pivot))
        blend=max(0,min(1,(t-(pivot-.17))/.34))
        blend=blend*blend*(3-2*blend)
        tangent=(joint-start).normalized().lerp((end-joint).normalized(),blend)
        rotation=segment_rotation(tangent)
        for index,(x,y) in enumerate(profile):
            # Slightly irregular cross sections produce real triangular cloth facets.
            depth=d*y-(.028*sin(t*pi*3) if index in (1,2) else 0)
            verts.append(center+rotation @ Vector((w*x,depth,0)))
            weights.append(blend)
    faces=[tuple(reversed(range(sides)))]
    material_indices=[0]
    for row in range(len(rings)-1):
        for j in range(sides):
            a=row*sides+j
            b=row*sides+(j+1)%sides
            c=(row+1)*sides+(j+1)%sides
            d=(row+1)*sides+j
            pink_edge=j in ((0,11) if side==1 else (2,3))
            # Sleeves have a continuous outer stripe; trousers light only the lower side.
            if stripe:
                accented=pink_edge and rings[row][0]<.78
            else:
                accented=j==(10 if side==1 else 4) and .7<rings[row][0]<.91
            mat_index=3 if accented else random.choices([0,1,2],[14,1,1])[0]
            faces.extend([(a,b,d),(b,c,d)] if (row+j)%2 else [(a,b,c),(a,c,d)])
            material_indices.extend([mat_index,mat_index])
    faces.append(tuple(range((len(rings)-1)*sides,len(rings)*sides)))
    material_indices.append(0)
    obj=mesh(name,verts,faces,cloth)
    obj.data.materials.append(cloth_dark)
    obj.data.materials.append(cloth_light)
    obj.data.materials.append(light_pink)
    for poly,index in zip(obj.data.polygons,material_indices):
        poly.material_index=index
    deform_bindings.append((obj,bones,weights))
    return obj


def tailored_sleeve(name, start, joint, end, bones, side):
    """Split outer fabric over a recessed glowing lining, continuous through the elbow."""
    start,joint,end=map(Vector,(start,joint,end))
    pivot=(joint-start).length/((joint-start).length+(end-joint).length)
    profile=[(-.30,-.50),(0,-.50),(.30,-.50),(.50,-.30),(.50,.30),
             (.30,.50),(-.30,.50),(-.50,.30),(-.50,-.30)]
    sides=len(profile)
    rings=[(0,.60,.66),(.07,.79,.83),(.20,.78,.78),(.215,.78,.78),
           (.23,.78,.78),(.32,.74,.74),(.44,.75,.74),(.53,.76,.75),
           (.61,.78,.76),(.66,.79,.76),(.675,.82,.80),
           (.86,.81,.72),(1,.68,.62)]
    rings=[(t,w*.90,d*.90) for t,w,d in rings]
    def surface_point(t,width,depth,x,y):
        # The forearm seam descends along the inner front edge in the concept.
        slope=max(0,min(1,(t-.53)/.13,(.86-t)/.185))
        t+=.14*slope*max(0,min(1,(side*x+.30)/.60))
        center=start.lerp(joint,t/pivot) if t<=pivot else joint.lerp(end,(t-pivot)/(1-pivot))
        blend=max(0,min(1,(t-pivot+.17)/.34))
        blend=blend*blend*(3-2*blend)
        rotation=segment_rotation((joint-start).normalized().lerp((end-joint).normalized(),blend))
        return center+rotation @ Vector((width*x,depth*y,0)),blend
    verts=[]
    weights=[]
    for t,width,depth in rings:
        for x,y in profile:
            point,blend=surface_point(t,width,depth,x,y)
            verts.append(point)
            weights.append(blend)
    faces=[tuple(reversed(range(sides)))]
    indices=[0]
    outer_faces={6,7,8} if side==1 else {2,3,4}
    recessed=[]
    for row in range(len(rings)-1):
        t=rings[row][0]
        for j in range(sides):
            a=row*sides+j
            b=row*sides+(j+1)%sides
            c=(row+1)*sides+(j+1)%sides
            d=(row+1)*sides+j
            accented=(j in outer_faces and .215<=t<.66) or (t in (.20,.66) and j in outer_faces|{0,1,5})
            # The shoulder crown has a coloured bevel, with a dark broad front panel.
            material_index=3 if accented else (4 if t<.20 and j in outer_faces else (1 if j==0 else 0))
            # The stepped panel is a finish on the shared sleeve faces, so its
            # notch cannot peel away from the fabric when the elbow bends.
            if .215<=t<.66 and j in ({0,1} if t<.32 else {0 if side==1 else 1}):
                material_index=2
            if row in (10,11) and j in (0,1):
                faces.extend([(a,b,c),(a,c,d)])
                indices.extend([material_index,2 if row==11 else material_index])
            else:
                if accented:
                    recessed.append(len(faces))
                faces.append((a,b,c,d))
                indices.append(material_index)
    faces.append(tuple(range((len(rings)-1)*sides,len(rings)*sides)))
    indices.append(0)
    # Replace the contiguous outer patch with a lower surface and join its
    # perimeter to the cloth with dark walls. Shared vertices keep it watertight.
    inset={}
    boundary={}
    for face_index in recessed:
        face=faces[face_index]
        for vertex in face:
            if vertex not in inset:
                row,column=divmod(vertex,sides)
                t,width,depth=rings[row]
                x,y=profile[column]
                point,blend=surface_point(t,width-.10,depth-.10,x,y)
                inset[vertex]=len(verts)
                verts.append(point)
                weights.append(blend)
        for a,b in zip(face,face[1:]+face[:1]):
            key=tuple(sorted((a,b)))
            if key in boundary:
                del boundary[key]
            else:
                boundary[key]=(a,b)
        faces[face_index]=tuple(inset[v] for v in face)
    for a,b in boundary.values():
        faces.append((a,b,inset[b],inset[a]))
        indices.append(1)
    used=sorted({v for face in faces for v in face})
    remap={old:new for new,old in enumerate(used)}
    verts=[verts[i] for i in used]
    weights=[weights[i] for i in used]
    faces=[tuple(remap[v] for v in face) for face in faces]
    obj=mesh(name,verts,faces,cloth)
    for mat in [cloth_dark,cloth_light,light_pink,pink]:
        obj.data.materials.append(mat)
    for face,index in zip(obj.data.polygons,indices):
        face.material_index=index
    deform_bindings.append((obj,bones,weights))
    return obj


def tailored_coat():
    """One closed coat mesh, including pocket openings, folded hems and rear yoke."""
    base_profile=[Vector((.5*cos(-pi/2+j*pi/6),.5*sin(-pi/2+j*pi/6))) for j in range(12)]
    base_rings=[(2.15,2.16,1.12),(2.30,2.15,1.12),(2.62,1.95,1.05),
           (3.03,1.78,.99),(3.48,1.97,1.10),(3.78,1.91,.99),
           (3.94,1.54,.86)]
    def dimensions(z):
        for a,b in zip(base_rings,base_rings[1:]):
            if a[0]<=z<=b[0]:
                t=(z-a[0])/(b[0]-a[0])
                return a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])
        raise ValueError(z)
    levels=sorted({r[0] for r in base_rings}|{2.27,2.36,2.46,3.02,3.12,3.20})
    rings=[(z,*dimensions(z)) for z in levels]
    profile=[]
    for j in range(12):
        # Extra vertices on the two front-side facets belong to the torso,
        # including the lip and recessed luminous lining of each pocket.
        stations=[0,.12,.22,.78,.88] if j in (1,10) else {
            4:[0,.94],5:[0,.06,.92,.96],6:[0,.04,.08,.94],7:[0,.06]
        }.get(j,[0])
        for u in stations:
            p=base_profile[j].lerp(base_profile[(j+1)%12],u)
            profile.append((p.x,p.y,j,u))
    sides=len(profile)
    verts=[]
    for z,w,d in rings:
        for x,y,j,u in profile:
            offset=0
            height=z
            if j in (1,10) and .12<=u<=.88:
                if 2.36<=z<=3.20:
                    height+=.12*(u-.5)*(1 if j==1 else -1)
                if 2.36<=z<=3.12:
                    offset=.028
                if .22<=u<=.78 and 2.46<=z<=3.02:
                    offset=.004
                if z==3.12:
                    offset=.055
                if z==3.20:
                    offset=.010
            # The hem and back yoke are changes in the coat's own surface.
            if z<=2.27:
                offset+=.022
            if 3<=j<=8 and z==3.48:
                offset+=.015
            if 2.27<=z<=3.03 and j in (5,7) and u==0:
                offset+=.020
            if 2.27<=z<=3.48 and ((j==5 and u==.96) or (j==6 and u in (0,.04))):
                offset-=.009
            verts.append((x*w,y*d-offset if y<0 else y*d+offset,height))
    faces=[tuple(reversed(range(sides)))]
    indices=[0]
    for row in range(len(rings)-1):
        z=rings[row][0]
        for col,(_,_,j,u) in enumerate(profile):
            a=row*sides+col
            b=row*sides+(col+1)%sides
            c=(row+1)*sides+(col+1)%sides
            d=(row+1)*sides+col
            index=1 if j in (0,11) else 0
            if j in (1,10) and .12<=u<.88:
                if 2.36<=z<3.12:
                    index=1
                if u==.22 and 2.46<=z<3.02:
                    index=3
                if 3.12<=z<3.20:
                    index=2
            if 3<=j<=8 and 3.48<=z<3.78:
                index=2
            if 2.27<=z<3.48 and ((j==5 and u==.96) or (j==6 and u==0)):
                index=1
            faces.append((a,b,c,d))
            indices.append(index)
    faces.append(tuple(range((len(rings)-1)*sides,len(rings)*sides)))
    indices.append(0)
    obj=mesh('Jacket / torso',verts,faces,cloth,'torso')
    for mat in [cloth_dark,cloth_light,light_pink]:
        obj.data.materials.append(mat)
    for face,index in zip(obj.data.polygons,indices):
        face.material_index=index
    return obj


def hollow_collar():
    """Flared elliptical collar with a real opening around the neck."""
    rings=[(1.63,.91,3.90),(1.96,1.10,4.23),(1.62,.76,4.23),(1.28,.59,3.90)]
    verts=[(w*.5*cos(2*pi*j/12),d*.5*sin(2*pi*j/12),z) for w,d,z in rings for j in range(12)]
    faces=[(row*12+j,row*12+(j+1)%12,((row+1)%4)*12+(j+1)%12,((row+1)%4)*12+j)
           for row in range(4) for j in range(12)]
    obj=mesh('Collar / raised band',verts,faces,shell,'torso',.008)
    obj.data.materials.append(trim_gradient)
    obj.data.polygons[9].material_index=1
    return obj


def cylinder(name, center, radius, depth, mat, bone, axis='Y', vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=center)
    obj=bpy.context.object
    obj.name=name
    if axis == 'Y':
        obj.rotation_euler.x = pi/2
    elif axis == 'X':
        obj.rotation_euler.y = pi/2
    return finish(obj,mat,.025,1,bone)


# Skeleton first: coordinates also define the actual mechanical joint centres.
arm_data = bpy.data.armatures.new("Logan · skeleton")
rig = bpy.data.objects.new("LOGAN · Pose me", arm_data)
rig_collection.objects.link(rig)
rig.show_in_front = True
arm_data.display_type = 'STICK'
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')


def bone(name, head, tail, parent=None):
    item=arm_data.edit_bones.new(name)
    item.head=head
    item.tail=tail
    item.align_roll(Vector((0,-1,0)))
    if parent:
        item.parent=arm_data.edit_bones[parent]
    return item


bone('root',(0,0,.12),(0,0,.65))
bone('pelvis',(0,0,2.12),(0,0,2.56),'root')
bone('torso',(0,0,2.56),(0,0,3.85),'pelvis')
bone('head',(0,0,4.12),(0,0,5.65),'torso')
arm_points={}
for side,s in [('L',1),('R',-1)]:
    shoulder=(s*.85,0,3.78)
    elbow=(s*1.57,0,3.08)
    wrist=(s*2.18,-.015,2.48)
    palm=(s*2.35,-.015,2.16)
    arm_points[side]=(shoulder,elbow,wrist,palm)
    bone('upper_arm.'+side,shoulder,elbow,'torso')
    bone('forearm.'+side,elbow,wrist,'upper_arm.'+side)
    bone('hand.'+side,wrist,palm,'forearm.'+side)
    hip=(s*.49,.02,2.26)
    knee=(s*.65,-.07,1.46)
    ankle=(s*.73,.015,.65)
    bone('thigh.'+side,hip,knee,'pelvis')
    bone('shin.'+side,knee,ankle,'thigh.'+side)
    bone('foot.'+side,ankle,(s*.73,-.55,.3),'shin.'+side)
    # Hands are assembled around a local down-axis, matching the sleeve angle.
    hand_down=(Vector(palm)-Vector(wrist)).normalized()
    hand_rot=segment_rotation(hand_down)
    for index,(offset,length) in enumerate([(-.21,.38),(0,.44),(.21,.38)]):
        a=Vector(palm)+hand_rot @ Vector((offset,0,.02))
        b=a+hand_rot @ Vector((0,-.025,length*.55))
        c=b+hand_rot @ Vector((0,-.075,length*.45))
        bone(f'finger{index+1}.01.{side}',a,b,'hand.'+side)
        bone(f'finger{index+1}.02.{side}',b,c,f'finger{index+1}.01.{side}')
    a=Vector(wrist)+hand_rot @ Vector((s*.27,-.005,.15))
    b=a+hand_rot @ Vector((s*.11,-.03,.18))
    c=b+hand_rot @ Vector((-s*.015,-.04,.18))
    bone('thumb.01.'+side,a,b,'hand.'+side)
    bone('thumb.02.'+side,b,c,'thumb.01.'+side)
bpy.ops.object.mode_set(mode='OBJECT')
for pbone in rig.pose.bones:
    pbone.rotation_mode='XYZ'

# The gradients belong to the sloped housing itself, with no raised crown patch.
monitor_head()
box('Screen / glass',(0,-.59,5.31),(2.20,.07,1.51),screen_mat,.018,'head')
for s in [-1,1]:
    for z in [5.34,5.48,5.62,5.76,5.90]:
        box('Head / recessed rear vent',(s*.49,.952,z),(.63,.024,.052),black,.008,'head')
    for z in [5.14,6.20]:
        cylinder('Head / service fastener',(s*.87,.953,z),.028,.024,edge,'head','Y',8)
box('Head / rear status light',(0,.950,5.16),(.28,.024,.035),light_pink,.004,'head')

# Headset on Logan's left; faceted ear cup and rectangular antenna.
box('Headset / mount',(1.43,.02,5.10),(.28,.65,.89),rubber,.09,'head')
box('Headset / pink gasket',(1.59,-.015,5.10),(.18,.72,.88),pink,.06,'head')
box('Headset / ear cup',(1.70,-.015,5.10),(.12,.65,.78),shell,.06,'head')
box('Headset / glowing outer pixel',(1.756,-.02,5.10),(.025,.25,.30),light_pink,.006,'head')
box('Headset / antenna socket',(1.52,.12,5.59),(.25,.26,.22),rubber,.025,'head')
box('Headset / antenna',(1.52,.12,5.82),(.12,.14,.38),shell,.018,'head')
box('Headset / antenna lamp',(1.52,.12,6.08),(.23,.23,.24),light_pink,.012,'head')

# Each eye group can blink about its own centre, keeping its square highlight attached.
eye_objects=[]
for s,side in [(-1,'R'),(1,'L')]:
    eye=face_tile('Face / eye.'+side,(s*.61,-.650,5.27),(.40,.59),.065,black,'head')
    glint=box('Face / eye pixel.'+side,(s*.61+.065,-.652,5.40),(.105,.018,.105),highlight,.008,'head')
    eye_objects.append((side,eye,glint))
    brow=box('Face / brow.'+side,(s*.61,-.638,5.58),(.63,.045,.135),black,.018,'head',segments=3)
    brow.rotation_euler.y=radians(-s*7)

# Explicit ribbon faces preserve the crescent's concave upper contour.
mouth_verts=[(-.25,-.628,4.94)]
for i in range(1,24):
    t=i/24
    top=4.94+.105*t-.07*sin(pi*t)
    mouth_verts.extend([(-.25+.5*t,-.628,top),(-.25+.5*t,-.628,top-.075*sin(pi*t))])
mouth_verts.append((.25,-.628,5.045))
mouth_faces=[(0,1,2)]
mouth_faces.extend((1+i*2,3+i*2,4+i*2,2+i*2) for i in range(22))
mouth_faces.append((45,47,46))
mouth=mesh('Face / smirk',mouth_verts,mouth_faces,black,'head')
solid=mouth.modifiers.new('Ink embedded in glass','SOLIDIFY')
solid.thickness=.012
solid.offset=0

# Neck and jacket: fitted torso, broad raised collar, hem, lapels and glowing pockets.
cylinder('Neck / swivel',(0,0,4.23),.35,.40,rubber,'head','Z')
coat=tailored_coat()
box('Pelvis / waist joint',(0,0,2.20),(1.39,.71,.40),rubber,.10,'pelvis')
hollow_collar()

# The supplied SVG is rasterized intact, then printed in the coat shader. Its
# black canvas adds no ink; no logo geometry or backing plate is created.
logo_image=bpy.data.images.load(str(ASSET_DIR/'reference/logit-texture.png'),check_existing=False)
logo_image.pack()
logo_material=cloth_dark.copy()
logo_material.name='Jacket · original SVG print'
nodes=logo_material.node_tree.nodes
links=logo_material.node_tree.links
texture=nodes.new('ShaderNodeTexImage')
texture.image=logo_image
texture.extension='CLIP'
texture.interpolation='Linear'
add=nodes.new('ShaderNodeMix')
add.data_type='RGBA'
add.blend_type='ADD'
add.inputs[0].default_value=1
add.inputs[6].default_value=cloth_dark.diffuse_color
links.new(texture.outputs['Color'],add.inputs[7])
shader=nodes.get('Principled BSDF')
links.new(add.outputs[2],shader.inputs['Base Color'])
links.new(texture.outputs['Color'],shader.inputs['Emission Color'])
shader.inputs['Emission Strength'].default_value=1.2
coat.data.materials.append(logo_material)
for face in coat.data.polygons:
    if face.material_index==1 and face.center.y<0 and abs(face.center.x)<.35:
        face.material_index=4
uv=coat.data.uv_layers.new(name='Original SVG')
for loop in coat.data.loops:
    v=coat.data.vertices[loop.vertex_index].co
    # Compensate for the later torso proportion mapping to keep the SVG square.
    uv.data[loop.index].uv=(v.x/1.30+.5,(v.z-3.49)/(1.30*1.05/1.28)+.5)

# Articulated sleeves, wrist bands, palms and individually jointed digits.
for side,s in [('L',1),('R',-1)]:
    shoulder,elbow,wrist,palm=map(Vector,arm_points[side])
    upper='upper_arm.'+side
    lower='forearm.'+side
    hand='hand.'+side
    tailored_sleeve('Sleeve / continuous.'+side,shoulder,elbow,wrist,(upper,lower),s)
    cuff_dir=(wrist-elbow).normalized()
    a=wrist-cuff_dir*.035
    b=wrist+cuff_dir*.20
    cuff=faceted_segment('Cuff / band.'+side,a,b,
                        [(0,.69,.68),(.25,.69,.68),(.75,.70,.69),(1,.70,.69)],lower,shell)
    cuff.data.materials.append(light_pink)
    for face in cuff.data.polygons:
        t=(face.center-a).dot(b-a)/(b-a).length_squared
        if .25<t<.75:
            face.material_index=1
    faceted_segment('Hand / palm.'+side,wrist+cuff_dir*.12,palm+cuff_dir*.05,
                    [(0,.46,.29),(1,.61,.33)],hand,shell)
    for index in range(1,4):
        for joint in [1,2]:
            bname=f'finger{index}.{joint:02}.{side}'
            bd=arm_data.bones[bname]
            a,b=bd.head_local,bd.tail_local
            direction=(b-a).normalized()
            segment_box('Hand / '+bname,a-direction*.025,b+direction*.025,
                        .175,.20,shell,bname,.036)
            cylinder('Knuckle / '+bname,a,.073,.14,rubber,bname,'X',8)
    for joint in [1,2]:
        bname=f'thumb.{joint:02}.{side}'
        bd=arm_data.bones[bname]
        direction=(bd.tail_local-bd.head_local).normalized()
        segment_box('Hand / '+bname,bd.head_local-direction*.045,bd.tail_local+direction*.025,.17,.20,shell,bname,.035)

# Sturdy articulated legs with boot collars, thick soles and inset toe lights.
for side,s in [('L',1),('R',-1)]:
    thigh='thigh.'+side
    shin='shin.'+side
    foot='foot.'+side
    hip=arm_data.bones[thigh].head_local.copy()
    knee=arm_data.bones[shin].head_local.copy()
    ankle=arm_data.bones[foot].head_local.copy()
    # Gather the hem above the ankle band; extending it to the foot pivot clips the boot.
    hem=Vector((ankle.x,ankle.y,.94))
    continuous_limb('Trouser / continuous.'+side,hip,knee,hem,
                    [(0,.75,.78),(.24,.78,.78),(.39,.75,.73),(.5,.73,.72),
                     (.61,.75,.73),(.78,.86,.80),(.91,.87,.79),
                     (1,.59,.57)],(thigh,shin),s,False)
    x=s*.73
    faceted_segment('Boot / ankle band.'+side,(x,0,.72),(x,0,.99),
                    [(0,.96,.94),(1,.98,.96)],foot,shell)
    box('Boot / upper.'+side,(x,-.19,.45),(.94,1.30,.66),shell,.15,foot)
    box('Boot / sole.'+side,(x,-.21,.14),(1.06,1.45,.23),rubber,.055,foot)
    box('Boot / heel.'+side,(x,.32,.28),(1.0,.32,.28),shell,.035,foot)
    box('Boot / toe light.'+side,(x,-.810,.31),(.65,.070,.13),light_pink,.012,foot)
    box('Boot / outer side light.'+side,(x+s*.455,.10,.49),(.060,.24,.38),light_pink,.009,foot)
    box('Boot / sole pixel.'+side,(x+s*.515,-.36,.15),(.040,.15,.10),pink,.005,foot)
    box('Boot / instep stripe.'+side,(x+s*.23,-.22,.775),(.18,.44,.040),pink,.008,foot)

# Match the latest full-body reference: longer trousers and a smaller, rectangular head.
def reference_proportions(point, is_head=False):
    p=Vector(point)
    if is_head:
        return Vector((p.x*.82,p.y*.94,5.50+(p.z-4.3)*.80))
    p.x*=1.05
    p.y*=1.20
    if p.z<=.85:
        return p
    if p.z<2.2:
        p.z=.85+(p.z-.85)*(2.9-.85)/(2.2-.85)
    elif p.z<4.3:
        p.z=2.9+(p.z-2.2)*1.28
    else:
        p.x*=.9
        p.y*=.9
        p.z=5.50+(p.z-4.3)*.80
    return p


bpy.context.view_layer.update()
head_parts={obj for obj,bname in bindings if bname=='head'}
for obj in character.objects:
    transform=obj.matrix_world.copy()
    origin=reference_proportions(obj.location,obj in head_parts)
    for vertex in obj.data.vertices:
        vertex.co=reference_proportions(transform @ vertex.co,obj in head_parts)-origin
    obj.matrix_world=Matrix.Translation(origin)
bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='EDIT')
for item in arm_data.edit_bones:
    item.head=reference_proportions(item.head,item.name=='head')
    item.tail=reference_proportions(item.tail,item.name=='head')
    item.align_roll(Vector((0,-1,0)))
bpy.ops.object.mode_set(mode='OBJECT')

# Rigid accessories, but continuous dual-quaternion skinning across knees and elbows.
for obj,bname in bindings:
    group=obj.vertex_groups.new(name=bname)
    group.add(list(range(len(obj.data.vertices))),1.0,'REPLACE')
    modifier=obj.modifiers.new('Rigid joint','ARMATURE')
    modifier.object=rig
    obj.parent=rig
for obj,bnames,weights in deform_bindings:
    groups=[obj.vertex_groups.new(name=name) for name in bnames]
    for index,weight in enumerate(weights):
        groups[0].add([index],1-weight,'REPLACE')
        groups[1].add([index],weight,'REPLACE')
    modifier=obj.modifiers.new('Continuous cloth deformation','ARMATURE')
    modifier.object=rig
    modifier.use_deform_preserve_volume=True
    obj.parent=rig

rig['blink_L']=0.0
rig['blink_R']=0.0
rig['screen_brightness']=1.7
for prop in ['blink_L','blink_R']:
    rig.id_properties_ui(prop).update(min=0,max=1,description='0 = open; 1 = closed')
rig.id_properties_ui('screen_brightness').update(min=0,max=3,description='Emission strength of the pink face screen')
for side,eye,glint in eye_objects:
    for obj in [eye,glint]:
        driver=obj.driver_add('scale',2).driver
        driver.expression='max(0.06, 1-blink)'
        variable=driver.variables.new()
        variable.name='blink'
        variable.targets[0].id=rig
        variable.targets[0].data_path=f'["blink_{side}"]'
    driver=glint.driver_add('location',2).driver
    driver.expression=f'{reference_proportions((0,0,5.27),True).z} + {0.13*.80} * (1-blink)'
    variable=driver.variables.new()
    variable.name='blink'
    variable.targets[0].id=rig
    variable.targets[0].data_path=f'["blink_{side}"]'
shader=screen_mat.node_tree.nodes.get('Principled BSDF')
driver=shader.inputs['Emission Strength'].driver_add('default_value').driver
driver.expression='brightness'
variable=driver.variables.new()
variable.name='brightness'
variable.targets[0].id=rig
variable.targets[0].data_path='["screen_brightness"]'

# Group the selectable controls for manual posing in Blender's Bone Collections.
for name,names in [('Body',['root','pelvis','torso','head']),
                   ('Arms',[b.name for b in arm_data.bones if b.name.startswith(('upper_arm','forearm','hand'))]),
                   ('Legs',[b.name for b in arm_data.bones if b.name.startswith(('thigh','shin','foot'))]),
                   ('Fingers',[b.name for b in arm_data.bones if b.name.startswith(('finger','thumb'))])]:
    group=arm_data.collections.new(name)
    for bname in names:
        group.assign(arm_data.bones[bname])
        arm_data.bones[bname].color.palette='THEME04' if name=='Fingers' else 'THEME03'

# Two named poses on the timeline make reuse and the articulation proof immediate.
scene.frame_start=1
scene.frame_end=40
scene.timeline_markers.clear()
rig.pose.bones['head'].rotation_euler.z=radians(4)
for b in rig.pose.bones:
    b.keyframe_insert('rotation_euler',frame=1,group=b.name)
    b.keyframe_insert('location',frame=1,group=b.name)
scene.timeline_markers.new('NEUTRAL',frame=1)
scene.timeline_markers.new('HELLO',frame=40)
rig.pose.bones['upper_arm.L'].rotation_euler.z=radians(78)
rig.pose.bones['forearm.L'].rotation_euler.z=radians(38)
rig.pose.bones['hand.L'].rotation_euler.y=radians(-12)
rig.pose.bones['head'].rotation_euler.y=radians(-6)
rig.pose.bones['head'].rotation_euler.z=radians(-5)
for i,angle in [(1,-8),(2,0),(3,10)]:
    rig.pose.bones[f'finger{i}.01.L'].rotation_euler.z=radians(angle)
for b in rig.pose.bones:
    b.keyframe_insert('rotation_euler',frame=40,group=b.name)
    b.keyframe_insert('location',frame=40,group=b.name)
rig.animation_data.action.name='Logan · Neutral to hello'
scene.frame_set(1)

# Large softboxes and a neutral floor reproduce the reference's studio lighting.
floor=box('Studio / floor',(0,0,-.035),(200,200,.05),ground_mat,0)
link(floor,studio)
world=bpy.data.worlds.new('Logan · neutral studio')
world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.32,.34,.39,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.45
scene.world=world


def area(name,position,energy,color,size,target=(0,0,3.2)):
    data=bpy.data.lights.new(name,'AREA')
    data.energy=energy
    data.color=color
    data.shape='DISK'
    data.size=size
    obj=bpy.data.objects.new(name,data)
    studio.objects.link(obj)
    obj.location=position
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


area('Studio / key softbox',(-4,-6,9),1000,(1,.93,.96),5)
area('Studio / fill softbox',(5,-3,5),500,(.79,.85,1),4)
area('Studio / magenta rim',(3,3,6),80,(1,.015,.75),3)
area('Studio / crown',(-3,1,9),130,(1,.025,.8),3)
camera_data=bpy.data.cameras.new('Logan · portrait camera')
camera=bpy.data.objects.new('Camera / portrait',camera_data)
studio.objects.link(camera)
camera.location=(5,-28,8.2)
target=Vector((0,0,3.65))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera_data.type='ORTHO'
camera_data.ortho_scale=8.4
camera_data.lens=55
scene.camera=camera

reference=bpy.data.images.load(str(ASSET_DIR/'reference/logan.png'),check_existing=False)
reference.pack()
ref=bpy.data.objects.new('Reference / original concept',None)
reference_collection.objects.link(ref)
ref.empty_display_type='IMAGE'
ref.data=reference
ref.empty_display_size=6.5
ref.location=(0,1.5,3.25)
ref.rotation_euler=(pi/2,0,0)
ref.hide_render=True
ref.hide_viewport=True

scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.cycles.seed=18
scene.render.resolution_x=1200
scene.render.resolution_y=1200
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=False
scene.view_settings.view_transform='Standard'
scene.view_settings.look='None'
scene.view_settings.exposure=-.6
scene.render.filepath=str(ASSET_DIR/'renders/logan-neutral.png')

# Optical glow is part of the saved scene, so every camera and pose renders consistently.
compositor=bpy.data.node_groups.new('Logan · neon bloom','CompositorNodeTree')
compositor.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
layers=compositor.nodes.new('CompositorNodeRLayers')
layers.scene=scene
scene.view_layers[0].use_pass_emit=True
scene.view_layers[0].update_render_passes()
glow=compositor.nodes.new('CompositorNodeGlare')
glow.inputs['Type'].default_value='Fog Glow'
glow.inputs['Quality'].default_value='High'
# Keep the neutral studio floor below the optical-glow threshold.
glow.inputs['Threshold'].default_value=.8
glow.inputs['Strength'].default_value=.85
glow.inputs['Size'].default_value=.9
add=compositor.nodes.new('ShaderNodeMix')
add.data_type='RGBA'
add.blend_type='ADD'
add.inputs[0].default_value=1
compositor.links.new(layers.outputs['Emission'],glow.inputs['Image'])
compositor.links.new(layers.outputs['Image'],add.inputs[6])
compositor.links.new(glow.outputs['Glare'],add.inputs[7])
# Export the halo into PNG alpha, including outside the character silhouette.
channels=compositor.nodes.new('CompositorNodeSeparateColor')
compositor.links.new(glow.outputs['Glare'],channels.inputs[0])
maximum=compositor.nodes.new('ShaderNodeMath')
maximum.operation='MAXIMUM'
compositor.links.new(channels.outputs[0],maximum.inputs[0])
compositor.links.new(channels.outputs[2],maximum.inputs[1])
alpha=compositor.nodes.new('ShaderNodeMath')
alpha.operation='MAXIMUM'
alpha.use_clamp=True
compositor.links.new(layers.outputs['Alpha'],alpha.inputs[0])
compositor.links.new(maximum.outputs[0],alpha.inputs[1])
# Avoid saturated hidden RGB where PNG's 8-bit alpha rounds a faint halo to zero.
visible=compositor.nodes.new('ShaderNodeMath')
visible.operation='GREATER_THAN'
visible.inputs[1].default_value=.5/255
compositor.links.new(alpha.outputs[0],visible.inputs[0])
masked=compositor.nodes.new('ShaderNodeMix')
masked.data_type='RGBA'
masked.inputs[6].default_value=(0,0,0,0)
compositor.links.new(visible.outputs[0],masked.inputs[0])
compositor.links.new(add.outputs[2],masked.inputs[7])
masked_alpha=compositor.nodes.new('ShaderNodeMath')
masked_alpha.operation='MULTIPLY'
compositor.links.new(alpha.outputs[0],masked_alpha.inputs[0])
compositor.links.new(visible.outputs[0],masked_alpha.inputs[1])
set_alpha=compositor.nodes.new('CompositorNodeSetAlpha')
set_alpha.inputs['Type'].default_value='Replace Alpha'
compositor.links.new(masked.outputs[2],set_alpha.inputs['Image'])
compositor.links.new(masked_alpha.outputs[0],set_alpha.inputs['Alpha'])
output=compositor.nodes.new('NodeGroupOutput')
compositor.links.new(set_alpha.outputs['Image'],output.inputs['Image'])
scene.compositing_node_group=compositor

# Keep the first opening useful: camera view, material colours and the rig selected.
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active=rig
for screen in bpy.data.screens:
    for area_item in screen.areas:
        if area_item.type=='VIEW_3D':
            space=next((s for s in area_item.spaces if s.type=='VIEW_3D'),None)
            if space is None:
                continue
            space.region_3d.view_perspective='CAMERA'
            space.region_3d.view_camera_zoom=0
            space.region_3d.view_camera_offset=(0,0)
            space.shading.type='MATERIAL'
            space.shading.use_scene_world=False
            space.overlay.show_overlays=False

readme=bpy.data.texts.get('START HERE · Logan') or bpy.data.texts.new('START HERE · Logan')
readme.clear()
readme.write('''LOGAN — master character

Frame 1: neutral. Frame 40: hello. Timeline markers name both poses.
Select LOGAN · Pose me, enter Pose Mode, rotate the named bones.
Enable viewport Overlays to see bones; Alt-R clears a selected bone rotation.
Root moves the whole character; torso/head/limbs and every finger are articulated.
Insert keyframes after editing the animated pose, before rendering or changing frames.
Object Custom Properties: blink_L, blink_R (0–1), screen_brightness (0–3).
Sleeves and trousers deform continuously; the head, boots and accessories are rigid.
Surface gradients and optical neon bloom are saved in the materials and compositor.
Camera, materials and lights remain editable.
The original reference is packed into this file, in the hidden Reference collection.
F12 renders the current pose. Render Properties > Film > Transparent removes the sky;
hide Studio / floor as well for a completely transparent character cutout.
''')
import runpy
runpy.run_path(str(ASSET_DIR/'integrate-head.py'))
runpy.run_path(str(ASSET_DIR/'integrate-clothes.py'))
runpy.run_path(str(ASSET_DIR/'integrate-hands.py'))
runpy.run_path(str(ASSET_DIR/'integrate-shoes.py'))
bpy.ops.wm.save_as_mainfile(filepath=str(ASSET_DIR/'logan.blend'),compress=True)
result={'blend':str(ASSET_DIR/'logan.blend'),'objects':len(scene.objects),'bones':len(arm_data.bones)}
print(result)
