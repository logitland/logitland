"""Give posed clothing live contact against Logan's rigid head and extremities.

Outside-only projection follows the evaluated targets at any timeline frame.
Simple sampling preserves the faceted rest silhouette while letting the middle
of a cloth panel dent around a collider. This is pose clearance, not simulation.
"""
import bmesh
import bpy

objects = bpy.data.objects
scene = bpy.context.scene
frame = scene.frame_current
scene.frame_set(1)
rig = objects['LOGAN · Pose me']
pose_position = rig.data.pose_position
rig.data.pose_position = 'REST'
bpy.context.view_layer.update()
collection = bpy.data.collections.get('04 · Contact surfaces')
if collection is None:
    collection = bpy.data.collections.new('04 · Contact surfaces')
    scene.collection.children.link(collection)


def hull(name, sources):
    """Make a closed rigid contact surface from a connected assembly."""
    bm = bmesh.new()
    graph = bpy.context.evaluated_depsgraph_get()
    for source in sources:
        obj = objects[source].evaluated_get(graph)
        for vertex in obj.data.vertices:
            bm.verts.new(obj.matrix_world @ vertex.co)
    bmesh.ops.convex_hull(bm, input=list(bm.verts), use_existing_faces=False)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


proxy_name = 'Contact surface / head assembly'
old = objects.get(proxy_name)
if old:
    bpy.data.objects.remove(old, do_unlink=True)
proxy = hull(proxy_name, ['Head / faceted shell', 'Screen / glass'] + [
    obj.name for obj in objects if obj.name.startswith('Headset /')])
group = proxy.vertex_groups.new(name='head')
group.add(list(range(len(proxy.data.vertices))), 1, 'REPLACE')
pose = proxy.modifiers.new('Follow head pose', 'ARMATURE')
pose.object = objects['LOGAN · Pose me']
proxy.hide_render = True
proxy.hide_set(True)
proxy.display_type = 'WIRE'
rig.data.pose_position = pose_position
scene.frame_set(frame)
head_nodes = bpy.data.node_groups.get('Contact / rigid head exterior')
if head_nodes:
    head_nodes.nodes.clear()
    head_nodes.interface.clear()


def sample(obj):
    """Add contact samples after skinning without rounding the resting garment."""
    mod = obj.modifiers.get('Clearance samples') or obj.modifiers.new('Clearance samples', 'SUBSURF')
    mod.subdivision_type = 'SIMPLE'
    mod.levels = mod.render_levels = 3 if obj.name=='Jacket / torso' else 2
    index = next(i+1 for i,m in enumerate(obj.modifiers) if m.type=='ARMATURE')
    obj.modifiers.move(list(obj.modifiers).index(mod), index)
    for thickness in obj.modifiers:
        if thickness.type=='SOLIDIFY':
            # Constraint thickness extrapolates near-coplanar seam fragments
            # into spikes. Fixed thickness keeps the lining local while complex
            # solidify still separates the boolean armhole's touching vertices.
            thickness.solidify_mode = 'NON_MANIFOLD'
            thickness.nonmanifold_thickness_mode = 'FIXED'
            thickness.use_even_offset = False
            thickness.use_quality_normals = True


def contact(obj, target, offset=.07):
    """Resolve penetration before adding the garment's inward lining."""
    name = 'Contact / '+target
    mod = obj.modifiers.get(name) or obj.modifiers.new(name, 'SHRINKWRAP')
    mod.target = objects[target]
    mod.wrap_method = 'NEAREST_SURFACEPOINT'
    mod.wrap_mode = 'OUTSIDE'
    mod.offset = offset
    thickness = next((m for m in obj.modifiers if m.type=='SOLIDIFY'), None)
    if thickness:
        obj.modifiers.move(list(obj.modifiers).index(mod), list(obj.modifiers).index(thickness))


def head_contact(obj):
    """Push cloth away from the head centre, keeping a panel on one side.

    Nearest-surface projection can send neighbouring points to opposite faces
    of the ear cup, leaving their connecting edge running through its centre.
    An inward ray from outside the head gives a coherent outward correction.
    """
    name = 'Contact / rigid head exterior'
    old = obj.modifiers.get('Contact / '+proxy_name)
    if old:
        obj.modifiers.remove(old)
    mod = obj.modifiers.get(name) or obj.modifiers.new(name, 'NODES')
    mod.show_viewport = mod.show_render = True
    group = bpy.data.node_groups.get(name) or bpy.data.node_groups.new(name, 'GeometryNodeTree')
    if not group.nodes:
        group.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
        group.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
        nodes, links = group.nodes, group.links
        source = nodes.new('NodeGroupInput')
        output = nodes.new('NodeGroupOutput')
        target = nodes.new('GeometryNodeObjectInfo')
        target.transform_space = 'RELATIVE'
        bounds = nodes.new('GeometryNodeBoundBox')
        links.new(target.outputs['Geometry'], bounds.inputs['Geometry'])
        def vector(operation, a, b=None, scale=None):
            node = nodes.new('ShaderNodeVectorMath')
            node.operation = operation
            links.new(a, node.inputs[0])
            if b is not None:
                links.new(b, node.inputs[1])
            if scale is not None:
                node.inputs['Scale'].default_value = scale
            return node.outputs['Vector']
        center = vector('SCALE', vector('ADD', bounds.outputs['Min'], bounds.outputs['Max']), scale=.5)
        position = nodes.new('GeometryNodeInputPosition').outputs['Position']
        direction = vector('NORMALIZE', vector('SUBTRACT', position, center))
        ray = nodes.new('GeometryNodeRaycast')
        links.new(target.outputs['Geometry'], ray.inputs['Target Geometry'])
        links.new(vector('ADD', position, vector('SCALE', direction, scale=5)), ray.inputs['Source Position'])
        links.new(vector('SCALE', direction, scale=-1), ray.inputs['Ray Direction'])
        ray.inputs['Ray Length'].default_value = 5.12
        # Radial clearance can approach zero along a grazing face. A normal
        # offset also leaves room for the inward lining at these contacts.
        clearance = vector('ADD', vector('SCALE', direction, scale=.12),
                           vector('SCALE', ray.outputs['Hit Normal'], scale=.055))
        corrected = vector('ADD', ray.outputs['Hit Position'], clearance)
        offset = nodes.new('GeometryNodeSwitch')
        offset.input_type = 'VECTOR'
        links.new(ray.outputs['Is Hit'], offset.inputs['Switch'])
        links.new(vector('SUBTRACT', corrected, position), offset.inputs['True'])
        offset.inputs['False'].default_value = (0,0,0)
        smooth = nodes.new('GeometryNodeBlurAttribute')
        smooth.data_type = 'FLOAT_VECTOR'
        smooth.inputs['Iterations'].default_value = 12
        links.new(offset.outputs['Output'], smooth.inputs['Value'])
        set_position = nodes.new('GeometryNodeSetPosition')
        links.new(source.outputs['Geometry'], set_position.inputs['Geometry'])
        links.new(smooth.outputs['Value'], set_position.inputs['Offset'])
        links.new(set_position.outputs['Geometry'], output.inputs['Geometry'])
    next(node for node in group.nodes if node.type=='OBJECT_INFO').inputs['Object'].default_value = proxy
    mod.node_group = group
    thickness = next((m for m in obj.modifiers if m.type=='SOLIDIFY'), None)
    if thickness:
        obj.modifiers.move(list(obj.modifiers).index(mod), list(obj.modifiers).index(thickness))


for name in ('Jacket / torso', 'Cuff / band.L', 'Cuff / band.R', 'Collar / raised band'):
    obj = objects[name]
    sample(obj)
    # A convex envelope keeps cloth outside the whole rigid assembly, including
    # the narrow spaces between headset parts that cannot accommodate a sleeve.
    for mod in list(obj.modifiers):
        if mod.name.startswith(('Contact / Head', 'Contact / Screen')):
            obj.modifiers.remove(mod)
    head_contact(obj)
    # Enforce local clearance on near-misses too: a radial ray can pass just
    # beside a corner while the inward lining would still cross that corner.
    contact(obj, proxy_name, .08)

# Hands can touch the torso or the opposite sleeve, not only their own cuff.
for name in ('Jacket / torso', 'Collar / raised band', 'Cuff / band.L', 'Cuff / band.R'):
    for side in ('L','R'):
        contact(objects[name], 'Hand / continuous.'+side, .075)

pants = objects['Trouser / continuous pants']
sample(pants)
for side in ('L','R'):
    contact(pants, 'Boot / continuous.'+side)

for name in ('Jacket / torso', 'Cuff / band.L', 'Cuff / band.R', 'Collar / raised band',
             'Trouser / continuous pants'):
    obj = objects[name]
    # Reapplying the setup must produce the same evaluation order as a rebuild.
    order = ['Contact / '+proxy_name, 'Contact / Hand / continuous.R',
             'Contact / Hand / continuous.L', 'Contact / rigid head exterior']
    order += [m.name for m in obj.modifiers if m.type=='SOLIDIFY']
    for modifier_name in order:
        mod = obj.modifiers.get(modifier_name)
        if mod:
            obj.modifiers.move(list(obj.modifiers).index(mod), len(obj.modifiers)-1)

bpy.context.scene['garment_contact'] = True
bpy.context.view_layer.update()
print('Added live garment contact with head, headset, both hands and boots')
