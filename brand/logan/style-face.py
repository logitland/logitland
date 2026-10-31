"""Pink phosphor graphics on black CRT glass, with a slightly lopsided smirk.

Raster detail lives in materials and a common face UV map; no added geometry.
The existing blink controls and head rig remain in place.
"""
from math import tau
import bpy

rig = bpy.data.objects['LOGAN · Pose me']
screen = bpy.data.objects['Screen / glass']
mouth = bpy.data.objects['Face / smirk']
rest = mouth.data.attributes.get('Rest / smirk')
if rest is None:
    rest = mouth.data.attributes.new('Rest / smirk', 'FLOAT_VECTOR', 'POINT')
    for point, vertex in zip(rest.data, mouth.data.vertices):
        point.vector = vertex.co
for vertex, point in zip(mouth.data.vertices, rest.data):
    vertex.co = point.vector
    t = max(0,min(1,(vertex.co.x+.205)/.410))
    vertex.co.x = vertex.co.x*1.22+.035
    vertex.co.z += .055*t*t


def crt_material(name, color, strength, glass=False):
    """Build stable scanlines and fine phosphor variation in face UV space."""
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*color,1)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Base Color'].default_value = (*color,1)
    shader.inputs['Roughness'].default_value = .26 if glass else .55
    shader.inputs['Coat Weight'].default_value = .3 if glass else .05
    shader.inputs['Coat Roughness'].default_value = .22
    shader.inputs['Emission Color'].default_value = (*color,1)
    links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    uv = nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'CRT face'
    separate = nodes.new('ShaderNodeSeparateXYZ')
    links.new(uv.outputs['UV'], separate.inputs[0])

    def math(operation, first, second=0, label=''):
        node = nodes.new('ShaderNodeMath')
        node.operation = operation
        node.label = label
        links.new(first, node.inputs[0])
        node.inputs[1].default_value = second
        return node.outputs[0]

    rows = math('SINE', math('MULTIPLY', separate.outputs['Y'], 128*tau), label='128 scanlines')
    rows = math('ADD', math('MULTIPLY', rows, .22), .78)
    columns = math('SINE', math('MULTIPLY', separate.outputs['X'], 384*tau), label='Phosphor columns')
    columns = math('ADD', math('MULTIPLY', columns, .04), .96)
    raster = nodes.new('ShaderNodeMath')
    raster.operation = 'MULTIPLY'
    links.new(rows, raster.inputs[0])
    links.new(columns, raster.inputs[1])
    gain = nodes.new('ShaderNodeValue')
    gain.name = 'Screen brightness'
    driver = gain.outputs[0].driver_add('default_value').driver
    driver.expression = 'brightness'
    variable = driver.variables.new()
    variable.name = 'brightness'
    variable.targets[0].id = rig
    variable.targets[0].data_path = '["screen_brightness"]'
    intensity = nodes.new('ShaderNodeMath')
    intensity.operation = 'MULTIPLY'
    links.new(math('MULTIPLY', raster.outputs[0], strength), intensity.inputs[0])
    links.new(gain.outputs[0], intensity.inputs[1])
    links.new(intensity.outputs[0], shader.inputs['Emission Strength'])
    # Minute roughness variation suggests coated glass without surface bumps.
    if glass:
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 180
        noise.inputs['Detail'].default_value = 1
        links.new(uv.outputs[0], noise.inputs['Vector'])
        links.new(math('ADD', math('MULTIPLY', noise.outputs['Fac'], .035), .24), shader.inputs['Roughness'])
    return material


phosphor = crt_material('Face · pink CRT phosphor', (1,.018,.62), 2.0)
glass = crt_material('Face · black CRT glass', (.003,.001,.006), .6, glass=True)
cutout = crt_material('Face · dark pixel cutouts', (.001,.0004,.002), .05)
parts = [obj for obj in bpy.data.objects if obj.name.startswith(('Face /','Screen /'))]
for obj in parts:
    material = glass if obj==screen else cutout if obj.name.startswith('Face / eye pixel') else phosphor
    obj.data.materials.clear()
    obj.data.materials.append(material)
    uv = obj.data.uv_layers.get('CRT face') or obj.data.uv_layers.new(name='CRT face')
    for loop in obj.data.loops:
        point = obj.matrix_world @ obj.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((point.x+.902)/1.804, (point.z-5.7843)/1.1274)
    obj.data.update()
bpy.context.scene['face_style'] = 'Pink phosphor on black CRT glass'
bpy.context.view_layer.update()
print('Applied pink-on-black CRT face and asymmetric smirk; topology unchanged')
