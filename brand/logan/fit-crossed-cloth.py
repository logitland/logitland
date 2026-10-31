"""Fit the coat to the crossed-arms preset and bake it into a driven shape key.

Run in the open master after fit-sleeve-drape.py, with the crossed pose keyed at
frame 80. Does not save. `crossed-cloth.json` holds the original tailored fit:
fabric squeezed around the tucked left hand, the cuffs and the crossed left
forearm. That bake also wrung the upper sleeves around the humerus roll and,
with the diffused armhole weights, collapsed the underarms into craters. Here
only those contact zones, the left forearm and the left cuff keep it. Each
upper sleeve below its cap stays rigid on its roll-free drape bone, the coat
above the shoulder joints stays on the torso, and the band between them
relaxes as-rigid-as-possible, so the fabric bends instead of folding. Contact
rounds then push the dressed cloth and its lining off both hands, the other
arm's cuff and sleeve, and the body arms away from the hands. The result is a
rest-space shape key blended by the rig's `crossed_cloth` property, which the
presets hold at 1 only on the crossed frame. Refit after changing the crossed
pose or the garment topology.
"""
from collections import Counter
import json
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_point_line
from mathutils.kdtree import KDTree

FRAME = 80
KEY = 'Crossed arms cloth'
SETTLED = 'Crossed cloth / settled'
BAND = 1.1             # free armhole band radius around each shoulder joint
TUBE = .55             # the upper sleeve is rigid beyond this fraction of its bone
SLEEVE_WEIGHT = .3     # minimum arm weight for a vertex to belong to its sleeve
CONTACT = .35          # cloth this close to the tucked hand or the other cuff keeps the tailored fit
BLEND = .3             # then relaxes freely over this distance
ARAP_ITERATIONS = 40
CONTACT_ROUNDS = 60
HAND_RADIUS = .09      # clear of hand vertex and face samples; hand faces are ~.1 across
CUFF_RADIUS = .06
BODY_CLEARANCE = .05   # lining (.018) plus air over the body arms
UNDER_HAND = .3        # the hand hides a sleeve pressed onto the body arm this close to it
SLEEVE_GAP = .06       # air between the crossed sleeves
TOLERANCE = .005       # contact already resolved within this distance
HELD = 1e6             # anchor stiffness; Laplacian rows are of order 1-10
PUSHED = 1e3           # stiffness of a contact correction
# The tailored fit predates lifting the right arm a few degrees, so that palm
# rests on the left sleeve instead of sinking into it: away from the contact
# zones, only the coat body and the left arm still match it.
TAILORED = ('', 'L')
here = Path(__file__).parent
scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
drape = bpy.data.objects['LOGAN · Sleeve drape']
jacket = bpy.data.objects['Jacket / torso']
cuff_objects = [bpy.data.objects['Cuff / band.'+side] for side in 'LR']
lining = jacket.modifiers['Cloth thickness around open garment'].thickness
tailoring = json.loads((here/'crossed-cloth.json').read_text())

# The left cuff keeps its tailored offsets, blended by `crossed_cloth`.
group = bpy.data.node_groups.get('LOGAN / crossed sleeve settle')
if group:
    bpy.data.node_groups.remove(group)
group = bpy.data.node_groups.new('LOGAN / crossed sleeve settle', 'GeometryNodeTree')
group.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
group.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
nodes, links = group.nodes, group.links
inp, out = nodes.new('NodeGroupInput'), nodes.new('NodeGroupOutput')
attribute = nodes.new('GeometryNodeInputNamedAttribute')
attribute.data_type = 'FLOAT_VECTOR'
attribute.inputs['Name'].default_value = SETTLED
gain = nodes.new('ShaderNodeValue')
gain_driver = gain.outputs[0].driver_add('default_value').driver
gain_driver.expression = 'value'
variable = gain_driver.variables.new()
variable.name = 'value'
variable.targets[0].id = rig
variable.targets[0].data_path = '["crossed_cloth"]'
scale = nodes.new('ShaderNodeVectorMath')
scale.operation = 'SCALE'
links.new(attribute.outputs['Attribute'], scale.inputs[0])
links.new(gain.outputs[0], scale.inputs['Scale'])
move = nodes.new('GeometryNodeSetPosition')
links.new(inp.outputs[0], move.inputs['Geometry'])
links.new(scale.outputs[0], move.inputs['Offset'])
links.new(move.outputs[0], out.inputs[0])
for index, node in enumerate((inp, attribute, gain, scale, move, out)):
    node.location = (index*200, 0)
for obj in [jacket]+cuff_objects:
    modifier = obj.modifiers.get('Crossed sleeve settle')
    if modifier:
        obj.modifiers.remove(modifier)
    if SETTLED in obj.data.attributes:
        obj.data.attributes.remove(obj.data.attributes[SETTLED])
for obj in cuff_objects[:1]:
    values = tailoring[obj.name]
    assert len(obj.data.vertices)==len(values), f'Rebake crossed cloth after changing {obj.name}'
    attribute = obj.data.attributes.new(SETTLED, 'FLOAT_VECTOR', 'POINT')
    for value, point in zip(values, attribute.data):
        point.vector = value
    modifier = obj.modifiers.new('Crossed sleeve settle', 'NODES')
    modifier.node_group = group
    obj.modifiers.move(len(obj.modifiers)-1, next(i+1 for i, m in enumerate(obj.modifiers) if m.type=='ARMATURE'))
keys = jacket.data.shape_keys
if keys.key_blocks.get(KEY):
    keys.driver_remove(f'key_blocks["{KEY}"].value')
    jacket.shape_key_remove(keys.key_blocks[KEY])
basis = keys.key_blocks['Basis']
assert len(jacket.data.vertices)==len(tailoring[jacket.name]), 'Rebake crossed cloth after changing the jacket'
rig['crossed_cloth'] = 1.0
rig.id_properties_ui('crossed_cloth').update(min=0, max=1, description='Garment fit for the crossed-arms preset')

scene.frame_set(FRAME)
enabled = {m.name: m.show_viewport for m in jacket.modifiers}
skinning = next(m for m in jacket.modifiers if m.type=='ARMATURE')


def evaluate(stack='armature'):
    """Vertex positions at rest, after skinning, or dressed: every modifier but the lining."""
    for modifier in jacket.modifiers:
        modifier.show_viewport = {'rest': False, 'armature': modifier.type=='ARMATURE',
                                  'dressed': modifier.type!='SOLIDIFY' and enabled[modifier.name]}[stack]
    jacket.data.update()
    jacket.update_tag(refresh={'DATA'})
    bpy.context.view_layer.update()
    evaluated = jacket.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return np.array([v.co[:] for v in evaluated.data.vertices])


count = len(jacket.data.vertices)
rest = evaluate('rest')   # includes the active pose-driven shapes
initial = evaluate()
# The tailored fit was made on the pose rig's skinning.
skinning.object = rig
tailored = evaluate()+np.array(tailoring[jacket.name])
skinning.object = drape

# Skinning is affine per vertex: probe it once to map posed fits to rest space.
probe = jacket.shape_key_add(name='Temporary deformation probe', from_mix=False)
axes = []
for axis in range(3):
    offset = Vector((0, 0, 0))
    offset[axis] = .01
    for index, point in enumerate(probe.data):
        point.co = basis.data[index].co+offset
    probe.value = 1
    axes.append((evaluate()-initial)/.01)
jacket.shape_key_remove(probe)
skin = np.stack(axes, axis=2)
key = jacket.shape_key_add(name=KEY, from_mix=False)
key.value = 1
basis_points = np.array([p.co[:] for p in basis.data])


def fitted(points, stack='dressed'):
    """Store posed points in the shape key and evaluate them through the stack."""
    correction = np.linalg.solve(skin, (points-initial)[:, :, None])[:, :, 0]
    key.data.foreach_set('co', (basis_points+correction).ravel())
    return evaluate(stack)


graph = bpy.context.evaluated_depsgraph_get()
to_jacket = jacket.matrix_world.inverted()
to_object = to_jacket @ drape.matrix_world


def deform(name):
    bone = drape.pose.bones[name]
    return np.array(to_object @ bone.matrix @ bone.bone.matrix_local.inverted() @ to_object.inverted())


def segment(name):
    bone = drape.data.bones[name]
    return to_object @ bone.head_local, to_object @ bone.tail_local


def nearest(point, head, tail):
    _, along = intersect_point_line(point, head, tail)
    return head.lerp(tail, max(0, min(1, along)))


def distance(point, name):
    return (point-nearest(point, *segment(name))).length


def carried(matrix, point):
    return (matrix @ np.append(np.array(point), 1))[:3]


def surface(name):
    obj = bpy.data.objects[name]
    evaluated = obj.evaluated_get(graph)
    mesh = evaluated.to_mesh()
    to = to_jacket @ obj.matrix_world
    points = [to @ v.co for v in mesh.vertices]
    tree = BVHTree.FromPolygons(points, [tuple(p.vertices) for p in mesh.polygons])
    centres = [to @ p.center for p in mesh.polygons]
    evaluated.to_mesh_clear()
    return tree, np.array([p[:] for p in points]), np.array([p[:] for p in centres])


hands = [surface('Hand / continuous.'+side) for side in 'LR']
cuffs = [surface(obj.name) for obj in cuff_objects]
bodies = [surface('Body / arm.'+side)[0] for side in 'LR']
bones = ('torso', 'upper_arm.L', 'forearm.L', 'upper_arm.R', 'forearm.R')
matrices = {name: deform(name) for name in bones}
group_names = {jacket.vertex_groups[name].index: name for name in bones}
arm_axes = {side: [tuple(Vector(carried(matrices[name], p)) for p in segment(name))
                   for name in ('upper_arm.'+side, 'forearm.'+side)] for side in 'LR'}
sleeve_side = np.zeros(count, dtype='<U1')   # the arm that carries a vertex more than the torso does
for vertex in jacket.data.vertices:
    carriers = Counter({'': 0})
    for g in vertex.groups:
        name = group_names.get(g.group)
        if name:
            carriers['' if name=='torso' else name[-1]] += g.weight
    sleeve_side[vertex.index] = carriers.most_common(1)[0][0]


def index(points):
    tree = KDTree(len(points))
    for i, point in enumerate(points):
        tree.insert(Vector(point), i)
    tree.balance()
    return tree


hand_index = index(np.vstack([h[1] for h in hands]))
tucked_index = index(hands[0][1])   # the left hand, tucked behind the right arm
cuff_index = {side: index(cuff[1]) for side, cuff in zip('LR', cuffs)}

# Contact zones keep the tailored fit; elsewhere geometry, not the diffused
# weights, decides what carries each vertex.
free = np.zeros(count, bool)
target = tailored.copy()
for vertex in jacket.data.vertices:
    i, point = vertex.index, Vector(rest[vertex.index])
    side = 'L' if point.x>0 else 'R'
    weights = {group_names[g.group]: g.weight for g in vertex.groups if g.group in group_names}
    upper, lower = weights.get('upper_arm.'+side, 0), weights.get('forearm.'+side, 0)
    head, tail = segment('upper_arm.'+side)
    depth = (point-head).dot((tail-head).normalized())/(tail-head).length
    sleeve = (min(distance(point, 'upper_arm.'+side), distance(point, 'forearm.'+side)) < distance(point, 'torso')
              and upper+lower>SLEEVE_WEIGHT)
    rigid = carried((upper*matrices['upper_arm.'+side]+lower*matrices['forearm.'+side])/max(upper+lower, 1e-6), rest[i])
    valid = sleeve_side[i] in TAILORED
    near = min(tucked_index.find(Vector(tailored[i]))[2],
               cuff_index['R' if side=='L' else 'L'].find(Vector(tailored[i]))[2])
    if near<CONTACT:
        continue
    if near<CONTACT+BLEND:
        free[i] = True
    elif sleeve and distance(point, 'forearm.'+side)<distance(point, 'upper_arm.'+side):
        if not valid:
            target[i] = rigid   # crossed forearms keep their tailored squeeze where it still fits
    elif sleeve and depth>TUBE:
        target[i] = rigid
    elif depth<0:
        target[i] = carried(matrices['torso'], rest[i])   # above the joint: the shoulder line
    elif sleeve or (point-head).length<BAND:
        free[i] = True
    elif not valid:
        target[i] = initial[i]

edges = {tuple(sorted(e.vertices)) for e in jacket.data.edges}
for face in jacket.data.polygons:
    if len(face.vertices)==4:
        a, b, c, d = face.vertices
        edges.update((tuple(sorted((a, c))), tuple(sorted((b, d)))))
edges = np.array(sorted(edges))
A, B = edges[:, 0], edges[:, 1]
laplacian = np.zeros((count, count))
np.add.at(laplacian, (A, A), 1)
np.add.at(laplacian, (B, B), 1)
np.add.at(laplacian, (A, B), -1)
np.add.at(laplacian, (B, A), -1)
rest_edges = rest[B]-rest[A]
stiffness = np.where(free, 0.0, HELD)


def relax(points, iterations):
    """Local/global ARAP: best-fit rotation per vertex, then a least-squares fit."""
    solver = np.linalg.inv(laplacian+np.diag(stiffness))
    for _ in range(iterations):
        current = points[B]-points[A]
        covariance = np.zeros((count, 3, 3))
        outer = rest_edges[:, :, None]*current[:, None, :]
        np.add.at(covariance, A, outer)
        np.add.at(covariance, B, outer)
        u, _, vt = np.linalg.svd(covariance)
        u[np.linalg.det(u @ vt)<0, :, 2] *= -1
        rotation = np.transpose(u @ vt, (0, 2, 1))
        rotated = np.einsum('nij,nj->ni', (rotation[A]+rotation[B])*.5, rest_edges)
        rhs = stiffness[:, None]*target
        np.add.at(rhs, A, -rotated)
        np.add.at(rhs, B, rotated)
        points = solver @ rhs
    return points


# Opposite sleeves are told apart the way verify-crossed.py does.
regions = []
for polygon in jacket.data.polygons:
    weights = Counter()
    for i in polygon.vertices:
        for g in jacket.data.vertices[i].groups:
            name = jacket.vertex_groups[g.group].name
            weights['L' if name.endswith('.L') else 'R' if name.endswith('.R') else 'torso'] += g.weight
    regions.append(weights.most_common(1)[0][0] if weights else 'torso')
polygons = [tuple(p.vertices) for p in jacket.data.polygons]
# Hand vertices and face centres, and cuff vertices, are small spheres. A cuff
# may overlap its own sleeve but not the coat body or the other arm.
obstacles = [('hand'+side, np.vstack(hand[1:]), HAND_RADIUS, None) for side, hand in zip('LR', hands)]
obstacles += [('cuff'+side, cuff[1], CUFF_RADIUS, side) for side, cuff in zip('LR', cuffs)]


def normals(points):
    face = np.zeros((len(polygons), 3))
    vertex = np.zeros((count, 3))
    for i, polygon in enumerate(polygons):
        corners = points[list(polygon)]
        n = sum(np.cross(corners[k]-corners[0], corners[k+1]-corners[0]) for k in range(1, len(polygon)-1))
        face[i] = n/max(np.linalg.norm(n), 1e-9)
        vertex[list(polygon)] += face[i]
    return face, vertex/np.maximum(np.linalg.norm(vertex, axis=1), 1e-9)[:, None]


def contacts(points):
    """Moves that clear the dressed cloth and its lining off every obstacle."""
    start = fitted(points)
    points = start.copy()
    face_normals, vertex_normals = normals(points)
    moves = np.zeros((count, 3))
    votes = np.zeros(count)
    stats.clear()
    # The nearest cloth surface point leaves each sphere, carrying its face.
    layers = [BVHTree.FromPolygons([Vector(p) for p in layer], polygons)
              for layer in (points, points-vertex_normals*lining)]
    for label, spheres, radius, own in obstacles:
        for center in map(Vector, spheres):
            for layer in layers:
                location, _, face, gap = layer.find_nearest(center, radius)
                if location is None or gap>=radius-TOLERANCE or regions[face]==own:
                    continue
                direction = (location-center).normalized() if gap>1e-6 else Vector(face_normals[face])
                for i in polygons[face]:
                    moves[i] += np.array(direction*(radius-gap))
                    votes[i] += 1
                stats[label] = stats.get(label, 0)+1
    moved = votes>0
    points[moved] += moves[moved]/votes[moved, None]
    # Each sleeve keeps to its own arm's side of the bisector between the arms.
    for i in np.nonzero(sleeve_side)[0]:
        point = Vector(points[i])
        own = min((nearest(point, *a) for a in arm_axes[sleeve_side[i]]), key=lambda q: (q-point).length)
        other = min((nearest(point, *a) for a in arm_axes['L' if sleeve_side[i]=='R' else 'R']),
                    key=lambda q: (q-point).length)
        if (other-own).length<1e-6:
            continue
        normal = (other-own).normalized()
        depth = (point-((own+other)/2-normal*SLEEVE_GAP/2)).dot(normal)
        if depth>TOLERANCE:
            points[i] = (point-normal*depth)[:]
            moved[i] = True
            stats['sleeves'] = stats.get('sleeves', 0)+1
    for i in range(count):
        point = Vector(points[i])
        if hand_index.find(point)[2]<UNDER_HAND:
            continue
        for label, tree in zip(('bodyL', 'bodyR'), bodies):
            location, normal, _, gap = tree.find_nearest(point)
            if location is not None and gap<.4 and (point-location).dot(normal)<BODY_CLEARANCE-TOLERANCE:
                point = location+normal*BODY_CLEARANCE
                moved[i] = True
                stats[label] = stats.get(label, 0)+1
        points[i] = point[:]
    return points-start, moved


stats = {}
points = relax(np.where(free[:, None], tailored, target), ARAP_ITERATIONS)
for round in range(CONTACT_ROUNDS):
    moves, moved = contacts(points)
    if not moved.any():
        break
    if round%10==0:
        print('Crossed cloth contact round', round, stats)
    points = points+moves
    target[moved] = points[moved]
    stiffness[moved] = np.maximum(stiffness[moved], PUSHED)
    points = relax(points, 8)
else:
    print('Crossed cloth: contacts unresolved for', int(moved.sum()), 'vertices', stats)
print(f'Crossed cloth: relaxed {int(free.sum())} vertices; {round+1} contact rounds')

residual = np.linalg.norm(fitted(points, 'armature')-points, axis=1).max()
assert residual<.001, f'Crossed cloth mapping error {residual:.6f}'
for modifier in jacket.modifiers:
    modifier.show_viewport = enabled[modifier.name]
driver = key.driver_add('value').driver
driver.type = 'AVERAGE'
variable = driver.variables.new()
variable.targets[0].id = rig
variable.targets[0].data_path = '["crossed_cloth"]'
for frame, value in ((1, 0.0), (40, 0.0), (FRAME, 1.0)):
    rig['crossed_cloth'] = value
    rig.keyframe_insert(data_path='["crossed_cloth"]', frame=frame)
scene.frame_set(FRAME)
bpy.context.view_layer.update()
print('Baked', KEY)
