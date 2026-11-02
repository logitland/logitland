"""Open the jacket at neck, hem and wrists while preserving its outer surface."""
from pathlib import Path

import bmesh
import bpy

HERE = Path(__file__).resolve().parent
assert bpy.context.scene.name=='JACKET STUDY'


def open_cloth(obj, expected_openings, thickness):
    """Remove terminal caps and give the remaining garment an inward lining."""
    if obj.get('hollow_cloth'):
        return
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    if obj.name.startswith('Cuff /'):
        caps = [face for face in bm.faces if len(face.verts)==8]
    else:
        caps = []
        for face in bm.faces:
            p = face.calc_center_median()
            neck = p.z>5.11 and face.normal.z>.99
            hem = p.z<2.86 and face.normal.z<-.95
            wrist = abs(p.x)>1.9 and p.z<3.4 and len(face.verts)>=8
            if neck or hem or wrist:
                caps.append(face)
    bmesh.ops.delete(bm,geom=caps,context='FACES')
    boundary = {edge for edge in bm.edges if edge.is_boundary}
    openings = 0
    while boundary:
        pending = [boundary.pop()]
        while pending:
            edge = pending.pop()
            neighbors = {other for vertex in edge.verts for other in vertex.link_edges if other in boundary}
            boundary.difference_update(neighbors)
            pending.extend(neighbors)
        openings += 1
    assert openings==expected_openings, f'{obj.name}: expected {expected_openings} garment openings, got {openings}'
    bm.to_mesh(obj.data)
    bm.free()
    lining = obj.modifiers.new('Cloth thickness around open garment','SOLIDIFY')
    lining.thickness = thickness
    lining.offset = -1
    lining.solidify_mode = 'NON_MANIFOLD'
    lining.nonmanifold_thickness_mode = 'CONSTRAINTS'
    lining.thickness_clamp = 1
    obj['hollow_cloth'] = True
    obj['garment_openings'] = openings


open_cloth(bpy.data.objects['Jacket / torso'],4,.018)
for side in ('L','R'):
    open_cloth(bpy.data.objects['Cuff / band.'+side],2,.035)
dark = bpy.data.objects['Jacket / torso'].data.materials[1]
for name in ('Jacket / torso','Cuff / band.L','Cuff / band.R'):
    obj = bpy.data.objects[name]
    if obj.data.materials[-1]!=dark:
        obj.data.materials.append(dark)
    # Clamp all inside faces to the final dark material, keeping exterior
    # graphics and emissive panels on the outside of the fabric.
    obj.modifiers['Cloth thickness around open garment'].material_offset = len(obj.data.materials)-1
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'jacket-study.blend'),compress=True)
print('Opened neck, hem, sleeves and cuffs; retained outer silhouette with inward cloth thickness')
