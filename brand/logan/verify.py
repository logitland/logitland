"""Proves that Logan's visible parts touch the assembled character in both saved poses.

Run against a saved master with Blender --background FILE --python-exit-code 1
--python brand/logan/verify.py. This checks evaluated geometry, including bevels
and skinning; render inspection is still needed for silhouette and material quality.
"""
from collections import Counter
from itertools import combinations

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def geometry(obj, graph):
    evaluated = obj.evaluated_get(graph)
    data = evaluated.to_mesh()
    vertices = [evaluated.matrix_world @ v.co for v in data.vertices]
    polygons = [tuple(p.vertices) for p in data.polygons]
    edges = Counter(tuple(sorted(e)) for p in data.polygons for e in p.edge_keys)
    neighbors = {i: set() for i in range(len(vertices))}
    for a, b in edges:
        neighbors[a].add(b)
        neighbors[b].add(a)
    reached = set()
    pending = [0]
    while pending:
        current = pending.pop()
        if current in reached:
            continue
        reached.add(current)
        pending.extend(neighbors[current] - reached)
    assert len(reached) == len(vertices), f'Disconnected mesh islands: {obj.name}'
    closed = set(edges.values()) == {2}
    if obj.name.startswith(('Sleeve / continuous.', 'Trouser / continuous.', 'Jacket / torso')):
        assert all(p.area > 1e-9 for p in data.polygons), f'Collapsed cloth face: {obj.name}'
        assert closed, f'Open garment mesh: {obj.name}'
    tree = BVHTree.FromPolygons(vertices, polygons)
    bounds = [(min(p[i] for p in vertices), max(p[i] for p in vertices)) for i in range(3)]
    evaluated.to_mesh_clear()
    return {'tree': tree, 'vertices': vertices, 'bounds': bounds, 'closed': closed}


def contains(solid, point):
    """Ray parity handles either normal orientation on a closed solid."""
    if not solid['closed']:
        return False
    direction = Vector((.723, .431, .539)).normalized()
    origin = point.copy()
    hits = 0
    while True:
        location, _, _, _ = solid['tree'].ray_cast(origin, direction)
        if location is None:
            return hits % 2 == 1
        hits += 1
        origin = location + direction * 1e-6


def touches(a, b):
    if any(a['bounds'][i][1] < b['bounds'][i][0] or b['bounds'][i][1] < a['bounds'][i][0]
           for i in range(3)):
        return False
    if a['tree'].overlap(b['tree']):
        return True
    # A wholly embedded part has no crossing surface, but is still attached.
    return contains(a, b['vertices'][0]) or contains(b, a['vertices'][0])


scene = bpy.data.scenes['LOGAN']
objects = [o for o in bpy.data.collections['01 · Logan / meshes'].objects if o.type == 'MESH']
failures = []
for frame in [1, 40]:
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    meshes = {o.name: geometry(o, graph) for o in objects}
    adjacent = {name: set() for name in meshes}
    for a, b in combinations(meshes, 2):
        if touches(meshes[a], meshes[b]):
            adjacent[a].add(b)
            adjacent[b].add(a)
    reached = set()
    pending = ['Jacket / torso']
    while pending:
        current = pending.pop()
        if current in reached:
            continue
        reached.add(current)
        pending.extend(adjacent[current] - reached)
    detached = sorted(set(meshes) - reached)
    if detached:
        failures.append(f'Frame {frame}: detached parts {detached}')
    else:
        print(f'PASS frame {frame}: all {len(meshes)} mesh objects touch the coat assembly')
assert not failures, '\n'.join(failures)
scene.frame_set(1)
