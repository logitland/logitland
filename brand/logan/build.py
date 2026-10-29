"""Build Logan's editable, rigidly rigged Blender master from the supplied concept.

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


character = collection("01 · Logan / rigid parts")
rig_collection = collection("02 · Pose rig")
studio = collection("03 · Studio")
reference_collection = collection("04 · Reference")
bindings = []


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
pink = material("Pink · anodised trim", (.8, .012, .66), .55, .3)
light_pink = material("Pink · lit inlay", (.8, .008, .68), .15, .35, .35)
screen_mat = material("Screen · hot pink", (.8, .008, .68), 0, .5, .5)
highlight = material("Screen · eye pixels", (.95, .025, .8), 0, .35, .5)
ground_mat = material("Studio · warm grey", (.44, .45, .48), 0, .8, .23)


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


def frame(name, center, outer, inner, depth, cut, bone, mat=shell):
    cx, cy, cz = center
    rings = [(outer, cut, cy-depth/2), (inner, .025, cy-depth/2-.004),
             (inner, .025, cy+depth/2), (outer, cut, cy+depth/2)]
    verts = [(cx+x, y, cz+z) for size, c, y in rings for x,z in outline(*size,c)]
    faces = []
    for ring in range(4):
        nxt = (ring+1) % 4
        for j in range(8):
            k = (j+1) % 8
            faces.append((ring*8+j,ring*8+k,nxt*8+k,nxt*8+j))
    return mesh(name, verts, faces, mat, bone, .012)


def panel(name, points, y, mat, bone, bevel=.012):
    """Extruded XZ silhouette, useful for the face and jacket's fitted panels."""
    verts = [(x,y,z) for x,z in points] + [(x,y+.035,z) for x,z in points]
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
        cross = outline(w,d,min(w,d)*.18)
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
    shoulder=(s*1.10,0,3.78)
    elbow=(s*1.72,0,3.08)
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

# Head: a deep chamfered casing behind a recessed, luminous display.
box('Head / rear casing',(0,.18,5.35),(2.76,1.10,2.08),shell,.19,'head')
frame('Head / continuous screen bezel',(0,-.47,5.35),(2.84,2.10),(2.31,1.47),.35,.23,'head')
box('Screen / glass',(0,-.59,5.31),(2.32,.07,1.48),screen_mat,.018,'head')
box('Head / crown inset',(0,.04,6.38),(1.6,.57,.035),edge,.015,'head')
# Small purposeful purple panels echo the image without painting every facet pink.
box('Head / crown pink stripe',(.73,-.06,6.39),(.40,.82,.045),pink,.012,'head')
panel('Head / lower pink stripe',[(.53,4.32),(.95,4.32),(.89,4.49),(.50,4.49)],-.66,pink,'head')
for s in [-1,1]:
    for z in [5.0,5.16,5.32]:
        box('Head / rear vent',(s*.87,.744,z),(.54,.025,.045),rubber,.008,'head')

# Headset on Logan's left; faceted ear cup and rectangular antenna.
box('Headset / mount',(1.43,.02,5.10),(.28,.65,.89),rubber,.09,'head')
box('Headset / pink gasket',(1.59,-.015,5.10),(.18,.72,.88),pink,.06,'head')
box('Headset / ear cup',(1.70,-.015,5.10),(.12,.65,.78),shell,.06,'head')
box('Headset / glowing outer pixel',(1.766,-.02,5.10),(.015,.25,.30),light_pink,.006,'head')
box('Headset / antenna socket',(1.52,.12,5.65),(.25,.26,.16),rubber,.025,'head')
box('Headset / antenna',(1.52,.12,5.99),(.12,.14,.62),shell,.018,'head')
box('Headset / antenna lamp',(1.52,.12,6.34),(.23,.23,.24),light_pink,.012,'head')

# Each eye group can blink about its own centre, keeping its square highlight attached.
eye_objects=[]
for s,side in [(-1,'R'),(1,'L')]:
    eye=face_tile('Face / eye.'+side,(s*.61,-.682,5.27),(.40,.59),.065,black,'head')
    glint=box('Face / eye pixel.'+side,(s*.61+.065,-.678,5.40),(.105,.018,.105),highlight,.008,'head')
    eye_objects.append((side,eye,glint))
    brow=box('Face / brow.'+side,(s*.61,-.676,5.58),(.63,.045,.135),black,.025,'head',segments=3)
    brow.rotation_euler.y=radians(-s*7)

# A thin asymmetric crescent makes the confident smirk actual editable geometry.
mouth_points=[]
for i in range(25):
    t=i/24
    mouth_points.append((-.25+.5*t,4.94+.105*t-.07*sin(pi*t)))
for i in range(24,-1,-1):
    t=i/24
    mouth_points.append((-.25+.5*t,4.94+.105*t-.13*sin(pi*t)))
mouth=panel('Face / smirk',mouth_points,-.659,black,'head',.005)

# Neck and jacket: fitted torso, broad raised collar, hem, lapels and glowing pockets.
cylinder('Neck / swivel',(0,0,4.18),.35,.34,rubber,'head','Z')
faceted_segment('Jacket / torso',(0,0,2.19),(0,0,3.88),
                [(0,2.28,1.09),(.12,2.25,1.08),(.57,1.88,.95),(1,2.04,.97)],'torso')
box('Pelvis / waist joint',(0,0,2.20),(1.39,.71,.40),rubber,.10,'pelvis')
faceted_segment('Collar / raised band',(0,0,3.89),(0,0,4.23),
                [(0,1.54,.91),(.40,1.98,1.12),(1,2.10,1.18)],'torso',shell)
box('Collar / pink clasp',(.43,-.595,4.08),(.29,.035,.32),pink,.014,'torso')
panel('Jacket / left lapel',[(-.91,3.83),(-.54,3.83),(-.30,3.18),(-.60,3.35)],-.535,edge,'torso')
panel('Jacket / right lapel',[(.91,3.83),(.54,3.83),(.30,3.18),(.60,3.35)],-.535,edge,'torso')
panel('Jacket / centre placket',[(-.39,2.20),(.39,2.20),(.31,3.18),(-.31,3.18)],-.575,cloth_dark,'torso')
box('Jacket / hem',(0,-.015,2.20),(2.29,1.08,.12),shell,.025,'torso')
for s,side in [(-1,'R'),(1,'L')]:
    pts=[(s*.69,2.36),(s*1.02,2.40),(s*.81,3.15),(s*.55,3.04)]
    panel('Pocket / housing.'+side,pts,-.59,shell,'torso',.028)
    pts=[(s*.72,2.49),(s*.91,2.52),(s*.76,3.00),(s*.60,2.94)]
    panel('Pocket / inlay.'+side,pts,-.625,light_pink,'torso',.005)
    pts=[(s*.55,3.01),(s*.86,3.10),(s*.82,3.23),(s*.52,3.12)]
    panel('Pocket / flap.'+side,pts,-.67,edge,'torso',.015)

# The chest reproduces the repository's pixel-L mark as geometry and gradients.
box('Chest / badge',(0,-.602,3.47),(.91,.12,.97),black,.025,'torso')
gradient=material('Logo / pink to ink', (1,.04,.82),.15,.4)
nodes=gradient.node_tree.nodes
links=gradient.node_tree.links
coord=nodes.new('ShaderNodeTexCoord')
separate=nodes.new('ShaderNodeSeparateXYZ')
ramp=nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color=(1,.04,.82,1)
ramp.color_ramp.elements[1].color=(.004,.002,.005,1)
links.new(coord.outputs['Generated'],separate.inputs[0])
links.new(separate.outputs['X'],ramp.inputs[0])
links.new(ramp.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
# Match the original 280x280 SVG's placement within the badge.
unit=.91/280
for name,x,z,w,h,mat in [('trail',60,60,80,120,gradient),('stem',140,60,40,120,light_pink),
                         ('foot trail',100,180,80,40,gradient),('foot pixel',180,180,40,40,light_pink)]:
    box('Logo / '+name,((x+w/2-140)*unit,-.67,3.47+(140-z-h/2)*unit),
        (w*unit,.015,h*unit),mat,.001,'torso')

# Articulated sleeves, wrist bands, palms and individually jointed digits.
for side,s in [('L',1),('R',-1)]:
    shoulder,elbow,wrist,palm=map(Vector,arm_points[side])
    upper='upper_arm.'+side
    lower='forearm.'+side
    hand='hand.'+side
    cylinder('Shoulder / swivel.'+side,shoulder,.29,.71,rubber,upper)
    faceted_segment('Sleeve / upper.'+side,shoulder,elbow,
                    [(0,.71,.80),(.30,.85,.89),(1,.82,.81)],upper)
    faceted_segment('Sleeve / forearm.'+side,elbow,wrist,
                    [(0,.82,.81),(.6,.87,.84),(1,.74,.73)],lower)
    cylinder('Elbow / hinge.'+side,elbow,.25,.60,rubber,lower)
    # Follow the front surface instead of burying a rectangular stripe in its bevel.
    for part,a,b,bname,depths in [('upper',shoulder,elbow,upper,[(.06,.82),(.30,.89),(.94,.82)]),
                                 ('lower',elbow,wrist,lower,[(.04,.82),(.60,.84),(.94,.75)])]:
        rotation=segment_rotation(b-a)
        verts=[a.lerp(b,t)+rotation @ Vector((x,-d/2-.012,0))
               for t,d in depths for x in [-.18,.18]]
        mesh('Sleeve / pink stripe '+part+'.'+side,verts,[(0,1,3,2),(2,3,5,4)],pink,bname)
    cuff_dir=(wrist-elbow).normalized()
    a=wrist-cuff_dir*.035
    b=wrist+cuff_dir*.20
    segment_box('Cuff / band.'+side,a,b,.79,.78,shell,lower,.045)
    segment_box('Cuff / light.'+side,a+Vector((0,-.406,0))+cuff_dir*.06,
                b+Vector((0,-.406,0))-cuff_dir*.06,.51,.04,light_pink,lower,.008)
    faceted_segment('Hand / palm.'+side,wrist+cuff_dir*.14,palm,
                    [(0,.46,.29),(1,.61,.33)],hand,shell)
    for index in range(1,4):
        for joint in [1,2]:
            bname=f'finger{index}.{joint:02}.{side}'
            bd=arm_data.bones[bname]
            a,b=bd.head_local,bd.tail_local
            direction=(b-a).normalized()
            segment_box('Hand / '+bname,a+direction*.012,b-direction*.012,
                        .175,.20,shell,bname,.036)
            cylinder('Knuckle / '+bname,a,.073,.14,rubber,bname,'X',8)
    for joint in [1,2]:
        bname=f'thumb.{joint:02}.{side}'
        bd=arm_data.bones[bname]
        segment_box('Hand / '+bname,bd.head_local,bd.tail_local,.17,.20,shell,bname,.035)

# Sturdy articulated legs with boot collars, thick soles and inset toe lights.
for side,s in [('L',1),('R',-1)]:
    thigh='thigh.'+side
    shin='shin.'+side
    foot='foot.'+side
    hip=arm_data.bones[thigh].head_local.copy()
    knee=arm_data.bones[shin].head_local.copy()
    ankle=arm_data.bones[foot].head_local.copy()
    faceted_segment('Trouser / thigh.'+side,hip,knee,
                    [(0,.75,.78),(.6,.78,.77),(1,.73,.70)],thigh)
    cylinder('Knee / hinge.'+side,knee,.23,.62,rubber,shin)
    faceted_segment('Trouser / shin.'+side,knee,ankle,
                    [(0,.73,.70),(.65,.82,.73),(1,.69,.65)],shin)
    segment_box('Trouser / outer stripe.'+side,knee+Vector((s*.29,-.29,-.02)),
                ankle+Vector((s*.29,-.29,.15)),.17,.045,pink,shin,.01)
    x=s*.73
    box('Boot / ankle band.'+side,(x,0,.85),(.96,.91,.26),shell,.055,foot)
    box('Boot / upper.'+side,(x,-.19,.45),(.94,1.30,.66),shell,.15,foot)
    box('Boot / sole.'+side,(x,-.21,.14),(1.06,1.45,.23),rubber,.055,foot)
    box('Boot / heel.'+side,(x,.32,.28),(1.0,.32,.28),shell,.035,foot)
    box('Boot / toe light.'+side,(x,-.863,.31),(.65,.025,.13),light_pink,.018,foot)
    box('Boot / outer side light.'+side,(x+s*.475,.10,.49),(.025,.24,.38),light_pink,.009,foot)
    box('Boot / sole pixel.'+side,(x+s*.53,-.36,.15),(.018,.15,.10),pink,.005,foot)
    box('Boot / instep stripe.'+side,(x+s*.23,-.22,.788),(.18,.44,.022),pink,.008,foot)

# Single-bone weights preserve the hard-surface silhouettes through every pose.
for obj,bname in bindings:
    group=obj.vertex_groups.new(name=bname)
    group.add(list(range(len(obj.data.vertices))),1.0,'REPLACE')
    modifier=obj.modifiers.new('Rigid joint','ARMATURE')
    modifier.object=rig
    obj.parent=rig

rig['blink_L']=0.0
rig['blink_R']=0.0
rig['screen_brightness']=.5
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
    driver.expression='5.27 + 0.13 * (1-blink)'
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


area('Studio / key softbox',(-4,-6,9),1350,(1,.93,.96),5)
area('Studio / fill softbox',(5,-3,5),850,(.79,.85,1),4)
area('Studio / magenta rim',(3,3,6),550,(1,.09,.73),3)
area('Studio / crown',(-2,2,8),1000,(1,.85,1),3)
camera_data=bpy.data.cameras.new('Logan · portrait camera')
camera=bpy.data.objects.new('Camera / portrait',camera_data)
studio.objects.link(camera)
camera.location=(5,-28,8.2)
target=Vector((0,0,3.28))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera_data.type='ORTHO'
camera_data.ortho_scale=7.8
camera_data.lens=55
scene.camera=camera

reference=bpy.data.images.load(str(ASSET_DIR/'reference/logan.png'),check_existing=True)
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
Object Custom Properties: blink_L, blink_R (0–1), screen_brightness (0–3).
All shell parts have rigid weights. Camera, materials and lights remain editable.
The original reference is packed into this file, in the hidden Reference collection.
F12 renders the current pose. Render Properties > Film > Transparent removes the sky;
hide Studio / floor as well for a completely transparent character cutout.
''')
bpy.ops.wm.save_as_mainfile(filepath=str(ASSET_DIR/'logan.blend'),compress=True)
result={'blend':str(ASSET_DIR/'logan.blend'),'objects':len(scene.objects),'bones':len(arm_data.bones)}
print(result)
