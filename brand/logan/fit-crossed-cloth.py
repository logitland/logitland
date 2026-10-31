"""Fit the coat to the crossed-arms preset and bake it into a driven shape key.

Run in the open master after fit-sleeve-drape.py, with the crossed pose keyed at
frame 80. Does not save. The roll-free drape skinning is the reference shape:
it already keeps the sleeves round and the shoulders untwisted. The last loops
of each sleeve follow part of the cuff's swing, so the opening stays inside the
cuff. Contact rounds then bend the reference locally, as-rigid-as-possible:
- hands, and the other arm's cuff, push the cloth and its lining away;
- the crossed sleeves keep to their own side of the bisector between the arms;
- where an arm rests on the coat, its sleeve flattens onto the coat surface, no
  closer to the body arm than its own padding allows;
- cloth keeps clear of the body arms and the torso core.
The result is a rest-space shape key blended by the rig's `crossed_cloth`
property, which the presets hold at 1 only on the crossed frame. The same
property swaps the cuffs from copying the hand's Euler rotation, which wrings
them when the palm turns, to swinging after the hand without twist, and eases
the raised-arm correctives that would drag the coat front over the shoulders.
Refit after changing the crossed pose or the garment topology.
"""
from collections import Counter
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_point_line

FRAME = 80
KEY = 'Crossed arms cloth'
ARMHOLE = .66          # cloth this close to a shoulder joint is sewn into the armhole
CONTACT_ROUNDS = 80
HAND_RADIUS = .04      # clear of hand surface samples, spaced ~.05
CUFF_RADIUS = .06
BODY_CLEARANCE = .05   # lining (.018) plus air over the body
SLEEVE_GAP = .06       # air between the crossed sleeves
SLEEVE_RADIUS = .43    # a relaxed sleeve around its arm axis
SQUASHED = .24         # the most a sleeve flattens: body arm (.15), clearance and lining
PRESS_GAP = .04        # air between a pressed sleeve and the coat behind it
TOLERANCE = .005       # contact already resolved within this distance
LINING_REACH = 2       # lining depth sampled, in shell thicknesses
CUFF_FOLLOW = .8       # share of the cuff's swing the sleeve opening takes
MOUTH_START, MOUTH_END = .8, 1.07   # forearm fractions over which the sleeve end takes it up
SOFT = .5              # pull back to the skinned shape; Laplacian rows are of order 1-10
PUSHED = 1e3           # stiffness of a contact correction
# Folded arms rise forward and bend; the raised-arm correctives were shaped for
# arms lifted out straight. Held fully, they drag the coat front over the
# shoulders and pull the sleeves out of their cuffs, so the crossed preset uses
# part of them. The cuffs keep their full ride up the wrist.
CROSSED_RAISE = .25
scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
drape = bpy.data.objects['LOGAN · Sleeve drape']
jacket = bpy.data.objects['Jacket / torso']
cuff_objects = [bpy.data.objects['Cuff / band.'+side] for side in 'LR']
lining = jacket.modifiers['Cloth thickness around open garment'].thickness

# Earlier fits stored a tailored offset attribute and a settle modifier.
group = bpy.data.node_groups.get('LOGAN / crossed sleeve settle')
if group:
    bpy.data.node_groups.remove(group)
for obj in [jacket]+cuff_objects:
    modifier = obj.modifiers.get('Crossed sleeve settle')
    if modifier:
        obj.modifiers.remove(modifier)
    if 'Crossed cloth / settled' in obj.data.attributes:
        obj.data.attributes.remove(obj.data.attributes['Crossed cloth / settled'])
keys = jacket.data.shape_keys
if keys.key_blocks.get(KEY):
    keys.driver_remove(f'key_blocks["{KEY}"].value')
    jacket.shape_key_remove(keys.key_blocks[KEY])
basis = keys.key_blocks['Basis']
rig['crossed_cloth'] = 1.0
rig.id_properties_ui('crossed_cloth').update(min=0, max=1, description='Garment fit for the crossed-arms preset')


def blend_by_crossed(constraint, crossed):
    """Drive a constraint's influence by `crossed_cloth` (or its complement)."""
    constraint.driver_remove('influence')
    driver = constraint.driver_add('influence').driver
    driver.type = 'SCRIPTED'
    driver.expression = 'c' if crossed else '1-c'
    variable = driver.variables.new()
    variable.name = 'c'
    variable.targets[0].id = rig
    variable.targets[0].data_path = '["crossed_cloth"]'


def crossed_factor(driver, factor):
    """Scale a corrective's driver to `factor` in the crossed preset only."""
    variables = driver.driver.variables
    if 'c' not in variables:
        variable = variables.new()
        variable.name = 'c'
        variable.targets[0].id = rig
        variable.targets[0].data_path = '["crossed_cloth"]'
        driver.driver.expression = f'({driver.driver.expression})*(1-{1-factor:g}*c)'
    else:
        base = driver.driver.expression.rsplit(')*(1-', 1)[0]
        driver.driver.expression = f'{base})*(1-{1-factor:g}*c)'


# Cuffs: swing after the hand without twist in the crossed preset. The other
# presets keep the approved Euler copy exactly.
for side, cuff in zip('LR', cuff_objects):
    bone = rig.pose.bones['wrist_cuff.'+side]
    copy = next(c for c in bone.constraints if c.type=='COPY_ROTATION')
    blend_by_crossed(copy, False)
    swing = bone.constraints.get('Crossed swing') or bone.constraints.new('DAMPED_TRACK')
    swing.name = 'Crossed swing'
    swing.target, swing.subtarget, swing.head_tail = rig, 'hand.'+side, 1.0
    blend_by_crossed(swing, True)
    # The side-bend bulge answers the Euler copy's wringing, so the swung
    # cuff does without it.
    for driver in cuff.data.shape_keys.animation_data.drivers:
        if driver.data_path=='key_blocks["Wrist side clearance"].value':
            crossed_factor(driver, 0)
for driver in jacket.data.shape_keys.animation_data.drivers:
    if 'Raised arm cloth' in driver.data_path:
        crossed_factor(driver, CROSSED_RAISE)

scene.frame_set(FRAME)
enabled = {m.name: m.show_viewport for m in jacket.modifiers}
skinning = next(m for m in jacket.modifiers if m.type=='ARMATURE')
assert skinning.object==drape, 'Run fit-sleeve-drape.py first'


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


def smoothstep(low, high, value):
    t = max(0, min(1, (value-low)/(high-low)))
    return t*t*(3-2*t)


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
    # Face centres and edge midpoints fill the gaps between vertex spheres.
    centres = [to @ p.center for p in mesh.polygons]+[(points[a]+points[b])/2 for a, b in mesh.edge_keys]
    evaluated.to_mesh_clear()
    return tree, np.array([p[:] for p in points]), np.array([p[:] for p in centres])


hands = [surface('Hand / continuous.'+side) for side in 'LR']
cuffs = [surface(obj.name) for obj in cuff_objects]
bodies = [surface('Body / arm.'+side)[0] for side in 'LR']
core = surface('Body / torso core')[0]
bones = ('torso', 'upper_arm.L', 'forearm.L', 'upper_arm.R', 'forearm.R')
matrices = {name: deform(name) for name in bones}
group_names = {jacket.vertex_groups[name].index: name for name in bones}
# Posed arm axes: the forearm through its cuff, the upper arm below its cap.
arm_axes = {side: [tuple(Vector(carried(matrices[name], p)) for p in segment(name))
                   for name in ('upper_arm.'+side, 'forearm.'+side)] for side in 'LR'}
shoulders = {side: arm_axes[side][0][0] for side in 'LR'}
# Only the elbow half of the upper arm and the forearm can press on the coat;
# the cap is sewn into the armhole.
press_axes = {side: [(arm_axes[side][0][0].lerp(arm_axes[side][0][1], .5), arm_axes[side][0][1]), arm_axes[side][1]]
              for side in 'LR'}
sleeve_side = np.zeros(count, dtype='<U1')   # the arm that carries a vertex more than the torso does
for vertex in jacket.data.vertices:
    carriers = Counter({'': 0})
    for g in vertex.groups:
        name = group_names.get(g.group)
        if name:
            carriers['' if name=='torso' else name[-1]] += g.weight
    sleeve_side[vertex.index] = carriers.most_common(1)[0][0]


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
# The roll-free drape skinning is the reference shape: contacts bend it locally.
# The sleeve mouth sits inside the cuff, which swings partly with the hand.
# Carry the last loops of each sleeve along, so the opening stays in the cuff.
reference = initial.copy()
to_rig = to_jacket @ rig.matrix_world


def posed(name):
    bone = rig.pose.bones[name]
    return np.array(to_rig @ bone.matrix @ bone.bone.matrix_local.inverted() @ to_rig.inverted())


for side in 'LR':
    # The cuff's swing relative to its own forearm, without the drape's roll.
    carry = posed('wrist_cuff.'+side) @ np.linalg.inv(posed('forearm.'+side))
    head, tail = segment('forearm.'+side)
    for i in np.nonzero(sleeve_side==side)[0]:
        point = Vector(rest[i])
        if distance(point, 'forearm.'+side)>distance(point, 'upper_arm.'+side):
            continue
        along = (point-head).dot(tail-head)/(tail-head).length_squared
        ramp = smoothstep(MOUTH_START, MOUTH_END, along)
        reference[i] += CUFF_FOLLOW*ramp*(carried(carry, initial[i])-initial[i])

rest_edges = reference[B]-reference[A]
target = reference.copy()
stiffness = np.full(count, SOFT)


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
# Hand and cuff surface samples are small spheres. A cuff may overlap its own
# sleeve but not the coat body or the other arm.
obstacles = [('hand'+side, np.vstack(hand[1:]), HAND_RADIUS, None) for side, hand in zip('LR', hands)]
obstacles += [('cuff'+side, np.vstack(cuff[1:]), CUFF_RADIUS, side) for side, cuff in zip('LR', cuffs)]
armhole = np.array([min((Vector(initial[i])-shoulders[s]).length for s in 'LR')<ARMHOLE for i in range(count)])


def normals(points):
    face = np.zeros((len(polygons), 3))
    vertex = np.zeros((count, 3))
    for i, polygon in enumerate(polygons):
        corners = points[list(polygon)]
        n = sum(np.cross(corners[k]-corners[0], corners[k+1]-corners[0]) for k in range(1, len(polygon)-1))
        face[i] = n/max(np.linalg.norm(n), 1e-9)
        vertex[list(polygon)] += face[i]
    return face, vertex/np.maximum(np.linalg.norm(vertex, axis=1), 1e-9)[:, None]


def pressing(point, side, coat_tree):
    """The flat contact where an arm rests on the coat nearest `point`: plane
    origin and normal (toward the body) and the arm axis point, or None where
    the arm is clear of the coat."""
    axis = min((nearest(point, *a) for a in press_axes[side]), key=lambda q: (q-point).length)
    location = core.find_nearest(axis)[0]
    if location is None:
        return None
    normal = (location-axis).normalized()
    front = coat_tree.ray_cast(axis, normal, SLEEVE_RADIUS+PRESS_GAP)[0]
    if front is None:
        return None
    reach = max(SQUASHED, (front-axis).length-PRESS_GAP)
    return axis+normal*reach, normal, axis


def contacts(points):
    """Moves that clear the dressed cloth and its lining off every obstacle."""
    start = fitted(points)
    points = start.copy()
    face_normals, vertex_normals = normals(points)
    moves = np.zeros((count, 3))
    votes = np.zeros(count)
    stats.clear()
    # The nearest cloth surface point leaves each sphere, carrying its face.
    # The solidified lining may sit a little deeper than one thickness where it
    # keeps an even shell around folds.
    layers = [BVHTree.FromPolygons([Vector(p) for p in layer], polygons)
              for layer in (points, points-vertex_normals*lining*LINING_REACH)]
    coat_tree = BVHTree.FromPolygons([Vector(p) for p in points], [p for p, r in zip(polygons, regions) if r=='torso'])
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
    for i in range(count):
        point = Vector(points[i])
        own = sleeve_side[i]
        if own:
            # Each sleeve keeps to its own arm's side of the bisector between the arms.
            mine = min((nearest(point, *a) for a in arm_axes[own]), key=lambda q: (q-point).length)
            other = min((nearest(point, *a) for a in arm_axes['L' if own=='R' else 'R']),
                        key=lambda q: (q-point).length)
            if (other-mine).length>1e-6:
                normal = (other-mine).normalized()
                depth = (point-((mine+other)/2-normal*SLEEVE_GAP/2)).dot(normal)
                if depth>TOLERANCE:
                    point -= normal*depth
                    moved[i] = True
                    stats['sleeves'] = stats.get('sleeves', 0)+1
            # A sleeve pressed on the coat flattens onto the contact plane.
            plane = pressing(point, own, coat_tree) if not armhole[i] else None
            if plane and (point-plane[2]).dot(plane[1])>0:
                depth = (point-plane[0]).dot(plane[1])+lining
                if depth>TOLERANCE:
                    point -= plane[1]*depth
                    moved[i] = True
                    stats['flatten'+own] = stats.get('flatten'+own, 0)+1
        for label, tree in (('bodyL', bodies[0]), ('bodyR', bodies[1]), ('core', core)):
            location, normal, _, gap = tree.find_nearest(point)
            if location is not None and gap<.4 and (point-location).dot(normal)<BODY_CLEARANCE-TOLERANCE:
                point = location+normal*BODY_CLEARANCE
                moved[i] = True
                stats[label] = stats.get(label, 0)+1
        points[i] = point[:]
    return points-start, moved


stats = {}
points = reference.copy()
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
print(f'Crossed cloth: {int((stiffness>SOFT).sum())} vertices in contact; {round+1} contact rounds')

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
