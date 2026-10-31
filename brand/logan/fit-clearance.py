"""Use a head-following lattice to spread contact across the low-poly garments.

The 245-point cage provides broad clearance; outside-only shrinkwrap finishes
local contact. Neither changes the garment topology or requires a simulation.
"""
from math import exp
import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

objects = bpy.data.objects
scene = bpy.context.scene
rig = objects['LOGAN · Pose me']
collection = bpy.data.collections.get('04 · Contact surfaces')
if collection is None:
    collection = bpy.data.collections.new('04 · Contact surfaces')
    scene.collection.children.link(collection)

proxy_name = 'Contact surface / head assembly'
cage_name = 'Deform cage / head contact'
garments = ['Jacket / torso', 'Cuff / band.L', 'Cuff / band.R', 'Collar / raised band',
            'Trouser / continuous pants']
for name in garments:
    obj = objects[name]
    for modifier in list(obj.modifiers):
        if modifier.type=='SUBSURF' or modifier.name.startswith(('Contact /', 'Lattice head contact')):
            obj.modifiers.remove(modifier)
    for modifier in obj.modifiers:
        if modifier.type=='SOLIDIFY':
            modifier.solidify_mode = 'NON_MANIFOLD'
            modifier.nonmanifold_thickness_mode = 'FIXED'
            modifier.use_even_offset = False
            modifier.use_quality_normals = True
        if name.startswith('Cuff /') and modifier.type=='SHRINKWRAP':
            modifier.offset = .15
for name in (proxy_name, cage_name):
    if objects.get(name):
        bpy.data.objects.remove(objects[name], do_unlink=True)

# Construct in the true rest pose so binding never applies a pose twice.
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

    points = [v.co.copy() for v in mesh.vertices]
    low = Vector(tuple(min(p[a] for p in points)-.6 for a in range(3)))
    high = Vector(tuple(max(p[a] for p in points)+.6 for a in range(3)))
    center = (low+high)*.5
    data = bpy.data.lattices.new(cage_name)
    data.points_u, data.points_v, data.points_w = 7, 5, 7
    data.interpolation_type_u = data.interpolation_type_v = data.interpolation_type_w = 'KEY_BSPLINE'
    cage = bpy.data.objects.new(cage_name, data)
    collection.objects.link(cage)
    cage.parent, cage.parent_type, cage.parent_bone = rig, 'BONE', 'head'
    cage.matrix_world = Matrix.Translation(center) @ Matrix.Diagonal((*(high-low),1))
    inverse = cage.matrix_world.inverted()
    surface = BVHTree.FromPolygons(points, [p.vertices[:] for p in mesh.polygons])
    # A smooth outward field avoids sending adjacent control points to opposite
    # sides of the head. Its falloff distributes contact over nearby cloth loops.
    for point in data.points:
        world = cage.matrix_world @ point.co
        delta = world-center
        radius = delta.length
        if radius<1e-6:
            continue
        direction = delta.normalized()
        hit, _, _, distance = surface.ray_cast(center, direction)
        if hit is None:
            continue
        push = .55*exp(-((radius-distance)/.85)**2)*min(1,radius/.4)
        point.co_deform = inverse @ (world+direction*push)
    cage.hide_render = True
    cage.hide_set(True)
finally:
    rig.data.pose_position = pose_position
    bpy.context.view_layer.update()


def contact(obj, target, offset):
    """Finish local clearance after broad lattice deformation."""
    mod = obj.modifiers.new('Contact / '+target.name, 'SHRINKWRAP')
    mod.target = target
    mod.wrap_method, mod.wrap_mode, mod.offset = 'NEAREST_SURFACEPOINT', 'OUTSIDE', offset


for name in garments:
    obj = objects[name]
    if name!='Trouser / continuous pants':
        mod = obj.modifiers.new('Lattice head contact', 'LATTICE')
        mod.object = cage
        obj.modifiers.move(len(obj.modifiers)-1, next(i+1 for i,m in enumerate(obj.modifiers) if m.type=='ARMATURE'))
        contact(obj, proxy, .25)
        for side in ('R','L'):
            contact(obj, objects['Hand / continuous.'+side], .15 if name.startswith('Cuff /') else .075)
    else:
        for side in ('L','R'):
            contact(obj, objects['Boot / continuous.'+side], .07)
    for mod in list(obj.modifiers):
        if mod.type=='SOLIDIFY':
            obj.modifiers.move(list(obj.modifiers).index(mod), len(obj.modifiers)-1)

scene['garment_contact'] = True
bpy.context.view_layer.update()
print('245 lattice control points; no garment subdivision; live head and extremity clearance')
