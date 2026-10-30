"""Sew the sleeve openings into actual armholes, creating one continuous coat mesh.

Run after refine-jacket.py. Removes the buried sleeve caps and torso armhole
faces, bridges their boundary loops, and retains blended elbow skinning.
"""
from pathlib import Path
from math import atan2, pi, sin, cos

import bmesh
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
scene = bpy.data.scenes['JACKET STUDY']
scene.frame_set(1)
torso = bpy.data.objects['Jacket / torso']
assert not torso.get('continuous_sleeves'), 'Sleeves are already sewn into the torso'
bm = bmesh.new()
bm.from_mesh(torso.data)
deform = bm.verts.layers.deform.verify()
hole_tag = bm.faces.layers.int['armhole_side']


def angular_loop(edges, axis):
    """Order an armhole boundary in a common plane, retaining recessed corners."""
    vertices = {v for edge in edges for v in edge.verts}
    across = Vector((0,1,0)).cross(axis).normalized()
    center_x = (min(v.co.dot(across) for v in vertices)+max(v.co.dot(across) for v in vertices))/2
    center_y = (min(v.co.y for v in vertices)+max(v.co.y for v in vertices))/2
    angles = {v: atan2(v.co.y-center_y,v.co.dot(across)-center_x) for v in vertices}
    adjacency = {v: [e.other_vert(v) for e in edges if v in e.verts] for v in vertices}
    first = min(vertices,key=lambda v: angles[v])
    ordered = [first]
    current = min(adjacency[first],key=lambda v: (angles[v]-angles[first])%(2*pi))
    while current != first:
        ordered.append(current)
        current = next(v for v in adjacency[current] if v != ordered[-2])
    result = []
    for vertex in ordered:
        angle = angles[vertex]
        if result and angle <= result[-1][0]:
            angle = result[-1][0]+1e-5
        result.append((angle,vertex))
    assert result[-1][0]-result[0][0] < 2*pi
    return result


def resample_loop(loop, angles):
    """Split existing boundary edges so two loops have matching angular stations."""
    output = []
    for angle in angles:
        match = next((v for a,v in loop if abs(a-angle)<1e-8),None)
        if match is not None:
            output.append(match)
            continue
        position = angle if angle>loop[0][0] else angle+2*pi
        extended = loop+[(loop[0][0]+2*pi,loop[0][1])]
        for (a,start),(b,end) in zip(extended,extended[1:]):
            if a<position<b:
                edge = next(e for e in start.link_edges if end in e.verts)
                _,vertex = bmesh.utils.edge_split(edge,start,(position-a)/(b-a))
                output.append(vertex)
                loop.append((angle,vertex))
                loop.sort(key=lambda item:item[0])
                break
        else:
            raise ValueError('Could not resample shoulder boundary')
    return output

for side, sign, tag in [('L',1,1),('R',-1,2)]:
    sleeve = bpy.data.objects['Sleeve / continuous.'+side]
    groups = {}
    for group in sleeve.vertex_groups:
        target = torso.vertex_groups.get(group.name) or torso.vertex_groups.new(name=group.name)
        groups[group.index] = target.index

    patch = [f for f in bm.faces if f[hole_tag] == tag]
    perimeter = {e for f in patch for e in f.edges if sum(face in patch for face in e.link_faces)==1}
    bmesh.ops.delete(bm,geom=patch,context='FACES')
    body_loop = [e for e in perimeter if e.is_valid and e.is_boundary]
    assert body_loop, f'Missing armhole on {side}'
    # Remove the first 23 percent of the old sleeve, including its capped
    # shoulder and transverse pink shoulder strip. Keep the outer lining below.
    start = Vector((sign*.85,0,3.78))
    joint = Vector((sign*1.57,0,3.08))
    end = Vector((sign*2.18,-.015,2.48))
    pivot = (joint-start).length / ((joint-start).length+(end-joint).length)
    points,progress = {},{}
    for v in sleeve.data.vertices:
        p = sleeve.matrix_world @ v.co
        points[v.index] = p
        raw = Vector((p.x/1.05,p.y/1.20,(p.z-2.9)/1.28+2.2))
        progress[v.index] = (raw-start).dot(joint-start)/(joint-start).length_squared*pivot
    keep = [f for f in sleeve.data.polygons if all(progress[i]>=.23-1e-5 for i in f.vertices)]
    used = {i for face in keep for i in face.vertices}
    vertices = {}
    for index in used:
        v = bm.verts.new(points[index])
        for group in sleeve.data.vertices[index].groups:
            v[deform][groups[group.group]] = group.weight
        vertices[index] = v
    sleeve_faces = []
    for polygon in keep:
        face = bm.faces.new([vertices[i] for i in polygon.vertices])
        # All retained pink is the recessed outer lining; shoulder fabric is dark.
        face.material_index = polygon.material_index if polygon.material_index<4 else 0
        face[hole_tag] = 0
        sleeve_faces.append(face)
    sleeve_loop = list({e for f in sleeve_faces for e in f.edges if e.is_boundary})
    axis = Vector((sign*.72*1.05,0,-.70*1.28)).normalized()
    body_angles = angular_loop(body_loop,axis)
    sleeve_angles = angular_loop(sleeve_loop,axis)
    angles = sorted(set(a for a,v in body_angles+sleeve_angles))
    body_ring = resample_loop(body_angles,angles)
    sleeve_ring = resample_loop(sleeve_angles,angles)
    # Shape a cloth shoulder around the joint, with a crown above the direct
    # chest-to-arm line and a tucked lower fold. Curved intermediate rings keep
    # it distinct from both a straight bridge and an applied shoulder block.
    across = Vector((0,1,0)).cross(axis).normalized()
    rings = [body_ring]
    for t in (.25,.5,.75):
        ring = []
        blend = t*t*(3-2*t)
        for angle,a,b in zip(angles,body_ring,sleeve_ring):
            radial = across*cos(angle) + Vector((0,.55*sin(angle),0))
            crown = .10 if radial.z>0 else .065
            point = a.co.lerp(b.co,t) + radial*(crown*sin(pi*t))
            v = bm.verts.new(point)
            for index in set(a[deform].keys())|set(b[deform].keys()):
                v[deform][index] = (1-blend)*a[deform].get(index,0)+blend*b[deform].get(index,0)
            ring.append(v)
        rings.append(ring)
    rings.append(sleeve_ring)
    for first,second in zip(rings,rings[1:]):
        for j in range(len(angles)):
            next_j = (j+1)%len(angles)
            face = bm.faces.new((first[j],first[next_j],second[next_j],second[j]))
            face.material_index = 0
            face[hole_tag] = 0
    bpy.data.objects.remove(sleeve,do_unlink=True)

bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
assert all(e.is_manifold for e in bm.edges), 'The sewn coat must have no open or doubled edges'
bm.to_mesh(torso.data)
bm.free()
torso.data.update()
torso['continuous_sleeves'] = True
torso['construction'] = 'Rounded cloth shoulders with shared armhole loops and blended joint weights'
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'jacket-study.blend'),compress=True)
print('Built rounded cloth shoulders around the arm joints; removed block caps')
