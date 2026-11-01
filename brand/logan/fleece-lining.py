"""Grow instanced curly fleece from the deformed collar's lining faces.

The collar keeps its original topology. Each small shared tuft is rooted in
the inner/rim surface after the contact modifiers, so the pile follows posing.
"""
import math
import bmesh
import bpy
from mathutils import Vector

GROUP = 'LOGAN / teddy fleece pile'
SOURCE = 'Lining / fleece tuft source'


def fleece_lining():
    """Add editable curly pile to collar material slots 1 and 2."""
    scene = bpy.data.scenes['AVATAR · Production']
    collar = scene.objects['Collar / raised band']
    material = collar.data.materials[1]
    for node in material.node_tree.nodes:
        if node.type == 'VALTORGB':
            node.color_ramp.elements[0].color = (.44,.34,.24,1)
            node.color_ramp.elements[1].color = (.82,.72,.58,1)
    material.diffuse_color = (.65,.55,.43,1)
    # Fibers need more scattering than the solid backing, which otherwise leaks
    # a bright stripe through the inside of the collar.
    fiber = bpy.data.materials.get('Jacket · teddy fibers')
    if fiber is None:
        fiber = material.copy()
        fiber.name = 'Jacket · teddy fibers'
    source = scene.objects.get(SOURCE)
    if source is None:
        vertices, faces = [], []
        for strand in range(3):
            phase = strand*math.tau/3
            centers = []
            for step in range(10):
                t = step/9
                angle = phase+t*math.tau*1.1
                radius = .0035*(1-.25*t)
                centers.append(Vector((.003*math.cos(phase)+radius*math.cos(angle),
                                       .003*math.sin(phase)+radius*math.sin(angle),
                                       -.002+t*(.019+.003*strand))))
            start = len(vertices)
            for index, center in enumerate(centers):
                tangent = (centers[min(index+1,9)]-centers[max(index-1,0)]).normalized()
                side = tangent.cross(Vector((0,0,1))).normalized()
                other = tangent.cross(side).normalized()
                for corner in range(3):
                    angle = corner*math.tau/3
                    vertices.append(center+.0015*(math.cos(angle)*side+math.sin(angle)*other))
            for ring in range(9):
                for corner in range(3):
                    a = start+ring*3+corner
                    b = start+ring*3+(corner+1)%3
                    faces.append((a,b,b+3,a+3))
            faces.extend(((start+2,start+1,start),(start+27,start+28,start+29)))
        mesh = bpy.data.meshes.new(SOURCE)
        mesh.from_pydata(vertices,[],faces)
        for face in mesh.polygons:
            face.use_smooth = True
        mesh.materials.append(fiber)
        source = bpy.data.objects.new(SOURCE,mesh)
        scene.collection.objects.link(source)
        source.hide_render = True
        source.hide_set(True)
    source.data.materials[0] = fiber
    # Existing tuft sources need closed tips for random-walk subsurface paths.
    if len(source.data.polygons) == 81:
        bm = bmesh.new();bm.from_mesh(source.data);bm.verts.ensure_lookup_table()
        for start in (0,30,60):
            for cap in ((start+2,start+1,start),(start+27,start+28,start+29)):
                bm.faces.new([bm.verts[i] for i in cap])
        bm.normal_update();bm.to_mesh(source.data);bm.free()
    group = bpy.data.node_groups.get(GROUP)
    if group is None:
        group = bpy.data.node_groups.new(GROUP,'GeometryNodeTree')
        group.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry')
        density = group.interface.new_socket(name='Tufts per square meter',in_out='INPUT',socket_type='NodeSocketFloat')
        density.default_value, density.min_value, density.max_value = 4500,0,12000
        group.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
        nodes, links = group.nodes, group.links
        incoming = nodes.new('NodeGroupInput')
        outgoing = nodes.new('NodeGroupOutput')
        index = nodes.new('GeometryNodeInputMaterialIndex')
        low = nodes.new('ShaderNodeMath'); low.operation = 'GREATER_THAN'; low.inputs[1].default_value = 0
        high = nodes.new('ShaderNodeMath'); high.operation = 'LESS_THAN'; high.inputs[1].default_value = 3
        both = nodes.new('ShaderNodeMath'); both.operation = 'MULTIPLY'
        for compare in (low,high):
            links.new(index.outputs[0],compare.inputs[0])
        links.new(low.outputs[0],both.inputs[0]); links.new(high.outputs[0],both.inputs[1])
        scatter = nodes.new('GeometryNodeDistributePointsOnFaces')
        scatter.distribute_method = 'RANDOM'
        scatter.inputs['Seed'].default_value = 37
        links.new(incoming.outputs['Geometry'],scatter.inputs['Mesh'])
        links.new(incoming.outputs['Tufts per square meter'],scatter.inputs['Density'])
        links.new(both.outputs[0],scatter.inputs['Selection'])
        tuft = nodes.new('GeometryNodeObjectInfo')
        tuft.transform_space = 'ORIGINAL'
        tuft.inputs['Object'].default_value = source
        tuft.inputs['As Instance'].default_value = True
        instance = nodes.new('GeometryNodeInstanceOnPoints')
        links.new(scatter.outputs['Points'],instance.inputs['Points'])
        links.new(scatter.outputs['Rotation'],instance.inputs['Rotation'])
        links.new(tuft.outputs['Geometry'],instance.inputs['Instance'])
        scale = nodes.new('FunctionNodeRandomValue'); scale.data_type = 'FLOAT'
        scale.inputs['Min'].default_value = .7; scale.inputs['Max'].default_value = 1.35
        links.new(scale.outputs['Value'],instance.inputs['Scale'])
        join = nodes.new('GeometryNodeJoinGeometry')
        links.new(incoming.outputs['Geometry'],join.inputs['Geometry'])
        links.new(instance.outputs['Instances'],join.inputs['Geometry'])
        links.new(join.outputs[0],outgoing.inputs['Geometry'])
        for n, pos in ((incoming,(-650,200)),(index,(-650,-200)),(low,(-450,-100)),
                       (high,(-450,-300)),(both,(-250,-150)),(scatter,(-40,200)),
                       (tuft,(-40,-200)),(scale,(150,-260)),(instance,(370,150)),
                       (join,(600,200)),(outgoing,(800,200))):
            n.location = pos
    modifier = collar.modifiers.get('Teddy fleece / rooted pile') or collar.modifiers.new('Teddy fleece / rooted pile','NODES')
    modifier.node_group = group
    return collar


if __name__ == '__main__':
    fleece_lining()
