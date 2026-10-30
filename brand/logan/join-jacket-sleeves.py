"""Join the shaped sleeve caps to the coat along their actual contact seams.

Keep the shoulder crown and armhole crease. Union removes buried cap/torso
faces, yielding one closed mesh; skin weights blend across the resulting seam.
"""
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

HERE = Path(__file__).resolve().parent
scene = bpy.data.scenes['JACKET STUDY']
scene.frame_set(1)
rig = bpy.data.objects['LOGAN · Pose me']
torso = bpy.data.objects['Jacket / torso']
assert not torso.get('continuous_sleeves'), 'Sleeves are already sewn into the torso'
rig.data.pose_position = 'REST'
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
torso.select_set(True)
bpy.context.view_layer.objects.active = torso
torso.modifiers.clear()
source_weights = []
for vertex in torso.data.vertices:
    source_weights.append((vertex.co.copy(), {'torso':1.0}))

for side,sign in [('L',1),('R',-1)]:
    sleeve = bpy.data.objects['Sleeve / continuous.'+side]
    # Dark fabric retains the raised cap and seam silhouette. Emission starts
    # below the shoulder, on the recessed outer-arm lining.
    start = Vector((sign*.85,0,3.78))
    joint = Vector((sign*1.57,0,3.08))
    end = Vector((sign*2.18,-.015,2.48))
    pivot = (joint-start).length/((joint-start).length+(end-joint).length)
    for face in sleeve.data.polygons:
        p = sleeve.matrix_world @ face.center
        raw = Vector((p.x/1.05,p.y/1.20,(p.z-2.9)/1.28+2.2))
        t = (raw-start).dot(joint-start)/(joint-start).length_squared*pivot
        if face.material_index==4 or (face.material_index==3 and t<.23):
            face.material_index = 0
    for vertex in sleeve.data.vertices:
        weights = {sleeve.vertex_groups[g.group].name:g.weight for g in vertex.groups}
        source_weights.append((sleeve.matrix_world @ vertex.co,weights))
    # Join undeformed surfaces; restore the armature after the seam is sewn.
    sleeve.modifiers.clear()
    union = torso.modifiers.new('Sewn shoulder '+side,'BOOLEAN')
    union.operation = 'UNION'
    union.solver = 'EXACT'
    union.object = sleeve
    bpy.ops.object.modifier_apply(modifier=union.name)
    bpy.data.objects.remove(sleeve,do_unlink=True)

tree = KDTree(len(source_weights))
for index,(point,weights) in enumerate(source_weights):
    tree.insert(point,index)
tree.balance()
weights = []
seam = set()
for vertex in torso.data.vertices:
    _,index,distance = tree.find(vertex.co)
    weights.append(source_weights[index][1].copy())
    if distance>1e-5:
        seam.add(vertex.index)
neighbors = {v.index:set() for v in torso.data.vertices}
for edge in torso.data.edges:
    a,b = edge.vertices
    neighbors[a].add(b)
    neighbors[b].add(a)
transition = seam | {n for i in seam for n in neighbors[i]}
for iteration in range(3):
    updated = [value.copy() for value in weights]
    for index in transition:
        nearby = [index]+list(neighbors[index])
        keys = {name for i in nearby for name in weights[i]}
        updated[index] = {name:sum(weights[i].get(name,0) for i in nearby)/len(nearby) for name in keys}
    weights = updated
torso.vertex_groups.clear()
groups = {name:torso.vertex_groups.new(name=name) for name in sorted({key for value in weights for key in value})}
for index,value in enumerate(weights):
    for name,weight in value.items():
        if weight>0:
            groups[name].add([index],weight,'REPLACE')
modifier = torso.modifiers.new('Continuous jacket deformation','ARMATURE')
modifier.object = rig
modifier.use_deform_preserve_volume = True
rig.data.pose_position = 'POSE'

bm = bmesh.new()
bm.from_mesh(torso.data)
assert all(edge.is_manifold for edge in bm.edges), 'The sewn coat must be closed'
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bm.to_mesh(torso.data)
bm.free()
torso.data.update()
torso['continuous_sleeves'] = True
torso['construction'] = 'Shaped shoulder caps sewn to torso along shared contact seams'
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'jacket-study.blend'),compress=True)
print('Joined shaped shoulder caps with shared seams; removed shoulder pink')
