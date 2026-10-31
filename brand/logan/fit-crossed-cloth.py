"""Install the baked sleeve settle and compression for the frame-80 pose.

The small cloth contribution was settled with a pinned torso and padded arm
colliders, then constrained to preserve the faceted silhouette. These offsets
belong to this pose and topology; re-simulate after changing either.
"""
import json
from pathlib import Path
import bpy

rig = bpy.data.objects['LOGAN · Pose me']
scene = bpy.context.scene
fields = json.loads(Path(__file__).with_name('crossed-cloth.json').read_text())
rig['crossed_cloth'] = 1.0
rig.id_properties_ui('crossed_cloth').update(min=0,max=1,description='Baked sleeve settling for the crossed-arms pose')
name = 'LOGAN / crossed sleeve settle'
group = bpy.data.node_groups.get(name)
if group:
    bpy.data.node_groups.remove(group,do_unlink=True)
group = bpy.data.node_groups.new(name,'GeometryNodeTree')
group.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry')
group.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
nodes, links = group.nodes, group.links
inp, out = nodes.new('NodeGroupInput'), nodes.new('NodeGroupOutput')
attribute = nodes.new('GeometryNodeInputNamedAttribute')
attribute.data_type = 'FLOAT_VECTOR'
attribute.inputs['Name'].default_value = 'Crossed cloth / settled'
gain = nodes.new('ShaderNodeValue')
driver = gain.outputs[0].driver_add('default_value').driver
driver.expression = 'value'
variable = driver.variables.new()
variable.name = 'value'
variable.targets[0].id = rig
variable.targets[0].data_path = '["crossed_cloth"]'
scale = nodes.new('ShaderNodeVectorMath')
scale.operation = 'SCALE'
links.new(attribute.outputs['Attribute'],scale.inputs[0])
links.new(gain.outputs[0],scale.inputs['Scale'])
move = nodes.new('GeometryNodeSetPosition')
links.new(inp.outputs[0],move.inputs['Geometry'])
links.new(scale.outputs[0],move.inputs['Offset'])
links.new(move.outputs[0],out.inputs[0])
for index,node in enumerate((inp,attribute,gain,scale,move,out)):
    node.location = (index*200,0)
for name,values in fields.items():
    obj = bpy.data.objects[name]
    assert len(obj.data.vertices)==len(values), f'Rebake crossed cloth after changing {name}'
    attribute = obj.data.attributes.get('Crossed cloth / settled') or obj.data.attributes.new('Crossed cloth / settled','FLOAT_VECTOR','POINT')
    for value,point in zip(values,attribute.data):
        point.vector = value
    old = obj.modifiers.get('Crossed sleeve settle')
    if old:
        obj.modifiers.remove(old)
    mod = obj.modifiers.new('Crossed sleeve settle','NODES')
    mod.node_group = group
    obj.modifiers.move(len(obj.modifiers)-1,next(i+1 for i,m in enumerate(obj.modifiers) if m.type=='ARMATURE'))
    obj.data.update()
for frame,value in ((1,0.0),(40,0.0),(80,1.0)):
    rig['crossed_cloth'] = value
    rig.keyframe_insert(data_path='["crossed_cloth"]',frame=frame)
scene.frame_set(80)
bpy.context.view_layer.update()
