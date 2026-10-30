"""Build simple skinned limbs beneath the garments and add live clothing clearance.

Run after importing approved studies. Keeps their visible surfaces and existing
poses; clearance modifiers run after skinning and before garment thickness.
"""
from math import cos, sin, tau
import bmesh
import bpy
from mathutils import Vector

scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
collection = bpy.data.collections['01 · Logan / meshes']
scene.frame_set(1)
for obj in list(collection.objects):
    if obj.name.startswith(('Body /', 'Neck /')):
        bpy.data.objects.remove(obj, do_unlink=True)
scene['floating_head'] = True

material = bpy.data.materials.get('Body · graphite undersuit') or bpy.data.materials.new('Body · graphite undersuit')
material.diffuse_color = (.022, .025, .033, 1)
material.use_nodes = True
shader = material.node_tree.nodes.get('Principled BSDF')
shader.inputs['Base Color'].default_value = material.diffuse_color
shader.inputs['Metallic'].default_value = .15
shader.inputs['Roughness'].default_value = .58
joint_material = bpy.data.materials.get('Body · flexible joints') or material.copy()
joint_material.name = 'Body · flexible joints'
joint_material.diffuse_color = (.009, .012, .017, 1)
joint_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = joint_material.diffuse_color


def tube(name, rings, joint_rows=()):
    """Connect elliptical sections with shared elbow/knee loops and blended weights."""
    vertices, faces, weights = [], [], []
    count = 8
    for i, (center, width, depth, influences) in enumerate(rings):
        tangent = rings[min(i+1, len(rings)-1)][0] - rings[max(0, i-1)][0]
        tangent.normalize()
        across = Vector((0, 1, 0)).cross(tangent).normalized()
        front = tangent.cross(across).normalized()
        for j in range(count):
            angle = tau*(j+.5)/count
            vertices.append(center + across*cos(angle)*width + front*sin(angle)*depth)
            weights.append(influences)
        if i:
            for j in range(count):
                a, b = (i-1)*count+j, (i-1)*count+(j+1)%count
                faces.append((a, b, b+count, a+count))
    faces.extend([tuple(reversed(range(count))), tuple(range(len(vertices)-count, len(vertices)))])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    mesh.materials.append(joint_material)
    for polygon in mesh.polygons:
        if polygon.index//count in joint_rows and polygon.index<(len(rings)-1)*count:
            polygon.material_index = 1
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = rig
    for bone in sorted({bone for values in weights for bone in values}):
        group = obj.vertex_groups.new(name=bone)
        for index, values in enumerate(weights):
            if values.get(bone, 0):
                group.add([index], values[bone], 'REPLACE')
    modifier = obj.modifiers.new('Continuous body deformation', 'ARMATURE')
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    return obj


tube('Body / torso core', [
    (Vector((0, 0, 2.85)), .60, .30, {'pelvis': 1}),
    (Vector((0, 0, 3.40)), .65, .30, {'pelvis': .5, 'torso': .5}),
    (Vector((0, 0, 4.30)), .77, .32, {'torso': 1}),
    (Vector((0, 0, 4.85)), .80, .32, {'torso': 1}),
    (Vector((0, 0, 5.04)), .63, .30, {'torso': 1}),
])
for side in ('L', 'R'):
    upper, lower, hand = [rig.data.bones[name+'.'+side] for name in ('upper_arm', 'forearm', 'hand')]
    a, b, c = upper.head_local, lower.head_local, lower.tail_local
    down = (c-b).normalized()
    tube('Body / arm.'+side, [
        (a-(b-a).normalized()*.10, .23, .22, {upper.name: 1}),
        (a.lerp(b, .2), .23, .22, {upper.name: 1}),
        (a.lerp(b, .55), .22, .20, {upper.name: 1}),
        (b-(b-a).normalized()*.24, .15, .14, {upper.name: .95, lower.name: .05}),
        (b-(b-a).normalized()*.12, .13, .13, {upper.name: .80, lower.name: .20}),
        (b, .145, .14, {upper.name: .5, lower.name: .5}),
        (b+down*.12, .13, .13, {upper.name: .20, lower.name: .80}),
        (b+down*.24, .15, .14, {upper.name: .05, lower.name: .95}),
        (b.lerp(c, .55), .17, .15, {lower.name: 1}),
        (c, .155, .115, {lower.name: 1}),
        (hand.head_local, .155, .115, {lower.name: .5, hand.name: .5}),
        (hand.head_local+down*.13, .155, .115, {hand.name: 1}),
    ], joint_rows=(3,4,5,6))
    thigh, shin, foot = [rig.data.bones[name+'.'+side] for name in ('thigh', 'shin', 'foot')]
    a, b, c = thigh.head_local, shin.head_local, shin.tail_local
    tube('Body / leg.'+side, [
        (a+Vector((0, 0, .12)), .25, .24, {thigh.name: 1}),
        (a.lerp(b, .25), .25, .23, {thigh.name: 1}),
        (a.lerp(b, .82), .21, .20, {thigh.name: 1}),
        (a.lerp(b, .94), .20, .19, {thigh.name: .75, shin.name: .25}),
        (b, .20, .19, {thigh.name: .5, shin.name: .5}),
        (b.lerp(c, .10), .20, .19, {thigh.name: .25, shin.name: .75}),
        (b.lerp(c, .55), .19, .18, {shin.name: 1}),
        (c, .17, .16, {shin.name: .5, foot.name: .5}),
        (c.lerp(foot.tail_local, .65), .18, .17, {foot.name: 1}),
    ])


def clearance(obj, target, name, selected=None, offset=.035):
    """Push only penetrating cloth vertices out of the target's closed surface."""
    old = obj.modifiers.get(name)
    if old:
        obj.modifiers.remove(old)
    group = obj.vertex_groups.get(name)
    if group:
        obj.vertex_groups.remove(group)
    modifier = obj.modifiers.new(name, 'SHRINKWRAP')
    modifier.target = target
    modifier.wrap_method = 'NEAREST_SURFACEPOINT'
    modifier.wrap_mode = 'OUTSIDE'
    modifier.offset = offset
    if selected is not None:
        group = obj.vertex_groups.new(name=name)
        group.add(selected, 1, 'REPLACE')
        modifier.vertex_group = group.name
    # The lining is generated after clearance, leaving its physical thickness.
    thickness = next((m for m in obj.modifiers if m.type == 'SOLIDIFY'), None)
    if thickness:
        obj.modifiers.move(len(obj.modifiers)-1, list(obj.modifiers).index(thickness))


jacket = bpy.data.objects['Jacket / torso']
pants = bpy.data.objects['Trouser / continuous pants']
# The tucked hems travel with the boot collar, blending back into the shin.
# Only the buried opening narrows; the approved calf silhouette stays intact.
if not pants.get('fitted_boot_hems'):
    for side, sign in (('L', 1), ('R', -1)):
        shin = rig.data.bones['shin.'+side]
        foot_group = pants.vertex_groups.get('foot.'+side) or pants.vertex_groups.new(name='foot.'+side)
        for vertex in pants.data.vertices:
            if sign*vertex.co.x<=0 or vertex.co.z>=1.53:
                continue
            weight = min(1, (1.53-vertex.co.z)/.40)
            old_weights = [(g.group, g.weight) for g in vertex.groups]
            for index, value in old_weights:
                pants.vertex_groups[index].add([vertex.index], value*(1-weight), 'REPLACE')
            foot_group.add([vertex.index], weight, 'REPLACE')
            if vertex.co.z<1.20:
                center = shin.tail_local.lerp(shin.head_local, (vertex.co.z-shin.tail_local.z)/(shin.head_local.z-shin.tail_local.z))
                scale = 1-.12*min(1, (1.20-vertex.co.z)/.13)
                vertex.co.x = center.x+(vertex.co.x-center.x)*scale
                vertex.co.y = center.y+(vertex.co.y-center.y)*scale
    pants['fitted_boot_hems'] = True
for side, sign in (('L', 1), ('R', -1)):
    hand = bpy.data.objects['Hand / continuous.'+side]
    cuff = bpy.data.objects['Cuff / band.'+side]
    # Cloth follows wrist flexion/deviation, while the hand can turn inside its
    # opening. Passing pronation into cuff skinning winds the fabric into a knot.
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    name = 'wrist_cuff.'+side
    helper = rig.data.edit_bones.get(name) or rig.data.edit_bones.new(name)
    helper.length = .20
    helper.matrix = rig.data.edit_bones['hand.'+side].matrix.copy()
    helper.parent = rig.data.edit_bones['forearm.'+side]
    helpers = rig.data.collections.get('Clothing deformation') or rig.data.collections.new('Clothing deformation')
    helpers.assign(helper)
    helpers.is_visible = False
    bpy.ops.object.mode_set(mode='OBJECT')
    pose = rig.pose.bones[name]
    bend = pose.constraints.get('Wrist bend without twist') or pose.constraints.new('COPY_ROTATION')
    bend.name = 'Wrist bend without twist'
    bend.target = rig
    bend.subtarget = 'hand.'+side
    bend.owner_space = bend.target_space = 'LOCAL'
    bend.euler_order = 'XYZ'
    bend.use_y = False
    old_group = cuff.vertex_groups.get('hand.'+side)
    if old_group:
        old_group.name = name
    if not cuff.data.shape_keys:
        cuff.shape_key_add(name='Basis')
        opening = cuff.shape_key_add(name='Wrist side clearance')
        forearm = rig.data.bones['forearm.'+side]
        axis = (forearm.tail_local-forearm.head_local).normalized()
        across = Vector((0,1,0)).cross(axis).normalized()
        across = cuff.matrix_world.inverted().to_3x3() @ across
        for row in range(4):
            ring = list(cuff.data.vertices[row*8:(row+1)*8])
            center = sum((v.co for v in ring), Vector())/8
            for vertex in ring:
                opening.data[vertex.index].co += across*(vertex.co-center).dot(across)*.35*(row/3)**2-axis*.12*(row/3)
        # A broad corrective opening keeps the thumb root clear on sideways
        # wrist bends; shrinkwrap then handles the remaining local contact.
        driver = opening.driver_add('value').driver
        driver.expression = 'min(1, abs(bend)/0.6981317)'
        variable = driver.variables.new()
        variable.name = 'bend'
        variable.type = 'SINGLE_PROP'
        variable.targets[0].id = rig
        variable.targets[0].data_path = f'pose.bones["hand.{side}"].rotation_euler[2]'
    if not cuff.get('flexible_wrist'):
        hand_group = cuff.vertex_groups.get(name) or cuff.vertex_groups.new(name=name)
        forearm_group = cuff.vertex_groups['forearm.'+side]
        # Four existing cuff rings: the sleeve end stays put, while its opening
        # shares the wrist bend instead of behaving like a rigid metal bracelet.
        for vertex in cuff.data.vertices:
            weight = (0, .15, .35, .50)[vertex.index//8]
            forearm_group.add([vertex.index], 1-weight, 'REPLACE')
            hand_group.add([vertex.index], weight, 'REPLACE')
        cuff['flexible_wrist'] = True
    # Simple subdivision adds collision samples without rounding the facets.
    samples = cuff.modifiers.get('Clearance samples') or cuff.modifiers.new('Clearance samples', 'SUBSURF')
    samples.subdivision_type = 'SIMPLE'
    samples.levels = samples.render_levels = 2
    cuff.modifiers.move(list(cuff.modifiers).index(samples), next(i+1 for i,m in enumerate(cuff.modifiers) if m.type=='ARMATURE'))
    clearance(cuff, hand, 'Clearance · hand', offset=.075)
    sleeve = [v.index for v in jacket.data.vertices if sign*v.co.x>1.45 and v.co.z<3.95]
    clearance(jacket, hand, 'Clearance · hand.'+side, sleeve)
    hem = [v.index for v in pants.data.vertices if sign*v.co.x>0 and v.co.z<1.55]
    clearance(pants, bpy.data.objects['Boot / continuous.'+side], 'Clearance · boot.'+side, hem)
collar = bpy.data.objects['Collar / raised band']
samples = collar.modifiers.get('Clearance samples') or collar.modifiers.new('Clearance samples', 'SUBSURF')
samples.subdivision_type = 'SIMPLE'
samples.levels = samples.render_levels = 2
collar.modifiers.move(list(collar.modifiers).index(samples), next(i+1 for i,m in enumerate(collar.modifiers) if m.type=='ARMATURE'))
clearance(collar, bpy.data.objects['Head / faceted shell'], 'Clearance · head', offset=.07)
scene['body_and_clearance'] = True
bpy.context.view_layer.update()
print('Built skinned torso, arms and legs; added live cuff, hem and collar clearance')
