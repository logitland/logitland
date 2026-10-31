"""Resolve local head contact on the existing low-poly garment vertices.

Sample vertices, edge midpoints and face centres so broad cloth faces yield too.
Only penetrating samples move: no permanent cage bulge, subdivision or simulation.
"""
import bmesh
import bpy

objects = bpy.data.objects
scene = bpy.context.scene
rig = objects['LOGAN · Pose me']
collection = bpy.data.collections.get('04 · Contact surfaces')
if collection is None:
    collection = bpy.data.collections.new('04 · Contact surfaces')
    scene.collection.children.link(collection)

proxy_name = 'Contact surface / head assembly'
garments = ['Jacket / torso', 'Cuff / band.L', 'Cuff / band.R', 'Collar / raised band',
            'Trouser / continuous pants']
for name in garments:
    obj = objects[name]
    for modifier in list(obj.modifiers):
        if modifier.type=='SUBSURF' or modifier.name.startswith(('Contact /', 'Lattice head contact', 'Local head contact')):
            obj.modifiers.remove(modifier)
    for modifier in obj.modifiers:
        if modifier.type=='SOLIDIFY':
            modifier.solidify_mode = 'NON_MANIFOLD'
            modifier.nonmanifold_thickness_mode = 'FIXED'
            modifier.use_even_offset = False
            modifier.use_quality_normals = True
        if name.startswith('Cuff /') and modifier.type=='SHRINKWRAP':
            modifier.offset = .025
for name in (proxy_name, 'Deform cage / head contact'):
    if objects.get(name):
        bpy.data.objects.remove(objects[name], do_unlink=True)

# A single convex contact surface avoids contradictory normals where the rigid
# head parts overlap. Construct it in REST so the pose is applied exactly once.
pose_position = rig.data.pose_position
rig.data.pose_position = 'REST'
bpy.context.view_layer.update()
try:
    bm = bmesh.new()
    graph = bpy.context.evaluated_depsgraph_get()
    for obj in list(objects):
        if obj.name not in ('Head / faceted shell', 'Screen / glass') and not obj.name.startswith('Headset /'):
            continue
        evaluated = obj.evaluated_get(graph)
        for vertex in evaluated.data.vertices:
            bm.verts.new(evaluated.matrix_world @ vertex.co)
    bmesh.ops.convex_hull(bm, input=list(bm.verts), use_existing_faces=False)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    mesh = bpy.data.meshes.new(proxy_name)
    bm.to_mesh(mesh)
    bm.free()
    proxy = bpy.data.objects.new(proxy_name, mesh)
    collection.objects.link(proxy)
    group = proxy.vertex_groups.new(name='head')
    group.add(list(range(len(mesh.vertices))), 1, 'REPLACE')
    proxy.modifiers.new('Follow head pose', 'ARMATURE').object = rig
    proxy.hide_render = True
    proxy.hide_set(True)
finally:
    rig.data.pose_position = pose_position
    bpy.context.view_layer.update()

name = 'LOGAN / local surface contact'
old = bpy.data.node_groups.get(name)
if old:
    bpy.data.node_groups.remove(old, do_unlink=True)
group = bpy.data.node_groups.new(name, 'GeometryNodeTree')
group.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
group.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
nodes, links = group.nodes, group.links
inp, out = nodes.new('NodeGroupInput'), nodes.new('NodeGroupOutput')
target = nodes.new('GeometryNodeObjectInfo')
target.transform_space = 'RELATIVE'
target.inputs['Object'].default_value = proxy
position = nodes.new('GeometryNodeInputPosition')
normal = nodes.new('GeometryNodeInputNormal')
near = nodes.new('GeometryNodeProximity')
near.target_element = 'FACES'
links.new(target.outputs['Geometry'], near.inputs['Geometry'])
links.new(position.outputs[0], near.inputs['Sample Position'])
sample = nodes.new('GeometryNodeSampleNearestSurface')
sample.data_type = 'FLOAT_VECTOR'
links.new(target.outputs['Geometry'], sample.inputs['Mesh'])
links.new(normal.outputs[0], sample.inputs['Value'])
links.new(position.outputs[0], sample.inputs['Sample Position'])


def vector(operation, a, b):
    """Connect vector arithmetic in the local contact field."""
    node = nodes.new('ShaderNodeVectorMath')
    node.operation = operation
    links.new(a, node.inputs[0])
    links.new(b, node.inputs[1])
    return node.outputs['Value' if operation=='DOT_PRODUCT' else 'Vector']


delta = vector('SUBTRACT', position.outputs[0], near.outputs['Position'])
signed_distance = vector('DOT_PRODUCT', delta, sample.outputs['Value'])
penetration = nodes.new('ShaderNodeMath')
penetration.operation = 'SUBTRACT'
# Includes the .018-thick lining and a small allowance for faceted polygons.
penetration.inputs[0].default_value = .045
links.new(signed_distance, penetration.inputs[1])
clamp = nodes.new('ShaderNodeMath')
clamp.operation = 'MAXIMUM'
links.new(penetration.outputs[0], clamp.inputs[0])
clamp.inputs[1].default_value = 0
scale = nodes.new('ShaderNodeVectorMath')
scale.operation = 'SCALE'
links.new(sample.outputs['Value'], scale.inputs[0])
links.new(clamp.outputs[0], scale.inputs['Scale'])
delta = scale.outputs['Vector']
face, edge = [nodes.new('GeometryNodeFieldOnDomain') for _ in range(2)]
for node, domain in ((face,'FACE'), (edge,'EDGE')):
    node.data_type, node.domain = 'FLOAT_VECTOR', domain
    links.new(delta, node.inputs['Value'])
total = vector('ADD', vector('ADD', delta, face.outputs[0]), edge.outputs[0])
damp = nodes.new('ShaderNodeVectorMath')
damp.operation = 'SCALE'
links.new(total, damp.inputs[0])
damp.inputs['Scale'].default_value = .8
geometry = inp.outputs['Geometry']
# Re-evaluate contact as vertices move. This converges locally without creating
# any new vertices or applying an offset to cloth that is already clear.
for iteration in range(24):
    move = nodes.new('GeometryNodeSetPosition')
    move.label = f'Contact relaxation {iteration+1}'
    links.new(geometry, move.inputs['Geometry'])
    links.new(damp.outputs[0], move.inputs['Offset'])
    geometry = move.outputs[0]
links.new(geometry, out.inputs[0])


def contact(obj, target, offset):
    """Keep garment openings clear of hands and boots."""
    mod = obj.modifiers.new('Contact / '+target.name, 'SHRINKWRAP')
    mod.target = target
    mod.wrap_method, mod.wrap_mode, mod.offset = 'NEAREST_SURFACEPOINT', 'OUTSIDE', offset


for name in garments:
    obj = objects[name]
    if name!='Trouser / continuous pants':
        for side in ('R','L'):
            contact(obj, objects['Hand / continuous.'+side], .025 if name.startswith('Cuff /') else .015)
        mod = obj.modifiers.new('Local head contact', 'NODES')
        mod.node_group = group
    else:
        for side in ('L','R'):
            contact(obj, objects['Boot / continuous.'+side], .07)
    for mod in list(obj.modifiers):
        if mod.type=='SOLIDIFY':
            obj.modifiers.move(list(obj.modifiers).index(mod), len(obj.modifiers)-1)

scene['garment_contact'] = True
bpy.context.view_layer.update()
print('Local head contact; no static cage bulge or garment subdivision')
