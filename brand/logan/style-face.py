"""Put an editable 2D face through a CRT shader on the existing screen mesh.

The PNG layers come from face/face.svg. Eye UV transforms retain the rig's
blink controls. The CRT group's Image input also accepts a movie or sequence.
"""
from math import tau
from pathlib import Path
import xml.etree.ElementTree as ET
import bpy

directory = Path(__file__).resolve().parent
svg = ET.parse(directory/'face'/'face.svg').getroot()
canvas_height = float(svg.get('height'))
SVG = '{http://www.w3.org/2000/svg}'
rig = bpy.data.objects['LOGAN · Pose me']
screen = bpy.data.objects['Screen / glass']
material = bpy.data.materials.get('Face · 2D CRT display') or bpy.data.materials.new('Face · 2D CRT display')
material.use_nodes = True
nodes, links = material.node_tree.nodes, material.node_tree.links
nodes.clear()


def math(nodes, links, operation, first, second=0):
    """Connect a scalar operation, allowing either socket or constant operands."""
    node = nodes.new('ShaderNodeMath')
    node.operation = operation
    for value, socket in zip((first, second), node.inputs):
        if isinstance(value, (float, int)):
            socket.default_value = value
        else:
            links.new(value, socket)
    return node.outputs[0]


def control(name, expression, prop):
    """Expose an existing rig control to the display material."""
    node = nodes.new('ShaderNodeValue')
    node.name = name
    driver = node.outputs[0].driver_add('default_value').driver
    driver.expression = expression
    variable = driver.variables.new()
    variable.name = 'value'
    variable.targets[0].id = rig
    variable.targets[0].data_path = f'["{prop}"]'
    return node.outputs[0]


uv = nodes.new('ShaderNodeUVMap')
uv.uv_map = 'CRT face'
uv.location = (-1000, 100)
separate = nodes.new('ShaderNodeSeparateXYZ')
links.new(uv.outputs[0], separate.inputs[0])
layers = []
for index, name in enumerate(('static', 'eye-L', 'eye-R')):
    texture = nodes.new('ShaderNodeTexImage')
    texture.name = '2D artwork / '+name
    texture.label = name+' · editable PNG layer'
    texture.location = (-500, 300-index*260)
    image = bpy.data.images.load(str(directory/'face'/f'{name}.png'), check_existing=True)
    image.reload()
    image.pack()
    texture.image = image
    texture.extension = 'CLIP'
    vector = uv.outputs[0]
    if name.startswith('eye-'):
        side = name[-1]
        opening = control('Blink '+side, 'max(0.035,1-value)', 'blink_'+side)
        # Sampling inversely scales the raster around the centre of the eye's first rect.
        eye = svg.find(f"{SVG}g[@id='{name}']/{SVG}rect")
        centre = 1-(float(eye.get('y'))+float(eye.get('height'))/2)/canvas_height
        y = math(nodes, links, 'SUBTRACT', separate.outputs['Y'], centre)
        y = math(nodes, links, 'ADD', math(nodes, links, 'DIVIDE', y, opening), centre)
        combine = nodes.new('ShaderNodeCombineXYZ')
        links.new(separate.outputs['X'], combine.inputs['X'])
        links.new(y, combine.inputs['Y'])
        vector = combine.outputs[0]
    links.new(vector, texture.inputs['Vector'])
    layers.append(texture.outputs['Color'])
composite = layers[0]
# Lighten keeps overlapping brows and eyes one opaque colour; adding would brighten them.
for layer in layers[1:]:
    lighten = nodes.new('ShaderNodeMixRGB')
    lighten.blend_type = 'LIGHTEN'
    lighten.inputs[0].default_value = 1
    links.new(composite, lighten.inputs[1])
    links.new(layer, lighten.inputs[2])
    composite = lighten.outputs[0]

# CRT stays downstream of the artwork, so an animated image uses the same display.
group = bpy.data.node_groups.get('LOGAN / CRT display')
if group:
    bpy.data.node_groups.remove(group, do_unlink=True)
group = bpy.data.node_groups.new('LOGAN / CRT display', 'ShaderNodeTree')
for name, kind, direction in [('Image','NodeSocketColor','INPUT'), ('UV','NodeSocketVector','INPUT'),
                              ('Brightness','NodeSocketFloat','INPUT'), ('Shader','NodeSocketShader','OUTPUT')]:
    group.interface.new_socket(name=name, in_out=direction, socket_type=kind)
n, l = group.nodes, group.links
inp, out = n.new('NodeGroupInput'), n.new('NodeGroupOutput')
xy = n.new('ShaderNodeSeparateXYZ')
l.new(inp.outputs['UV'], xy.inputs[0])
# Dark intervals affect the emitted image, rather than a subtle brightness ripple.
phase = math(n,l,'FRACT',math(n,l,'MULTIPLY',xy.outputs['Y'],72))
line = math(n,l,'GREATER_THAN',phase,.28)
line = math(n,l,'ADD',math(n,l,'MULTIPLY',line,.94),.06)
columns = math(n,l,'SINE',math(n,l,'MULTIPLY',xy.outputs['X'],240*tau))
columns = math(n,l,'ADD',math(n,l,'MULTIPLY',columns,.09),.91)
pattern = math(n,l,'MULTIPLY',line,columns)
pattern = math(n,l,'MULTIPLY',pattern,inp.outputs['Brightness'])
emission = n.new('ShaderNodeEmission')
l.new(inp.outputs['Image'], emission.inputs['Color'])
l.new(pattern, emission.inputs['Strength'])
glass = n.new('ShaderNodeBsdfPrincipled')
glass.inputs['Base Color'].default_value = (.001,.0005,.002,1)
glass.inputs['Roughness'].default_value = .38
glass.inputs['Specular IOR Level'].default_value = .12
mix = n.new('ShaderNodeAddShader')
l.new(emission.outputs[0],mix.inputs[0])
l.new(glass.outputs[0],mix.inputs[1])
l.new(mix.outputs[0],out.inputs['Shader'])
crt = nodes.new('ShaderNodeGroup')
crt.node_tree = group
crt.name = 'CRT display / plug image or movie into Image'
crt.location = (300,100)
links.new(composite,crt.inputs['Image'])
links.new(uv.outputs[0],crt.inputs['UV'])
links.new(control('Screen brightness','value','screen_brightness'),crt.inputs['Brightness'])
output = nodes.new('ShaderNodeOutputMaterial')
output.location = (600,100)
links.new(crt.outputs[0],output.inputs[0])

# Keep the editable artwork and CRT stages readable in the Shader Editor.
for tree in (material.node_tree, group):
    depths, rows = {}, {}
    def depth(node):
        if node.name not in depths:
            parents = [link.from_node for socket in node.inputs for link in socket.links]
            depths[node.name] = 1+max((depth(parent) for parent in parents), default=-1)
        return depths[node.name]
    for node in tree.nodes:
        column = depth(node)
        row = rows.get(column, 0)
        node.location = (column*240, -row*300)
        rows[column] = row+1
screen.data.materials.clear()
screen.data.materials.append(material)
uv_layer = screen.data.uv_layers.get('CRT face') or screen.data.uv_layers.new(name='CRT face')
for loop in screen.data.loops:
    point = screen.matrix_world @ screen.data.vertices[loop.vertex_index].co
    uv_layer.data[loop.index].uv = ((point.x+.902)/1.804,(point.z-5.784)/1.128)
screen.data.update()
# The screen now carries all graphics; no protruding eyes, eyebrows or mouth.
for obj in list(bpy.data.objects):
    if obj.name.startswith('Face /'):
        bpy.data.objects.remove(obj,do_unlink=True)
bpy.context.scene['face_style'] = '2D texture layers through CRT display'
bpy.context.view_layer.update()
print('2D textured face; CRT scanlines; existing blink and brightness controls')
