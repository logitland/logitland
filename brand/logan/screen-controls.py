"""Expose real glass roughness and add adjustable diffusion below the reflection.

Run on an existing CRT screen without changing its artwork, pose or camera.
Viewport Display roughness does not drive the shader; these sockets drive the
rendered shader in Eevee and Cycles. Re-running preserves the dialed-in values.
"""
from pathlib import Path
import bpy

HERE = Path(__file__).resolve().parent


def lock_eye_raster():
    """Sample each eye once per phosphor row, switching inside the dark gap.

    SVG coordinates alone cannot align filtered textures with procedural lines.
    One shared raster drives both the scanline phase and the eye sampling UVs,
    including while the blink transform changes the artwork's vertical scale.
    """
    raster = bpy.data.node_groups.get('LOGAN / CRT raster')
    if raster is None:
        raster = bpy.data.node_groups.new('LOGAN / CRT raster','ShaderNodeTree')
        for name, kind, direction in (
            ('UV','NodeSocketVector','INPUT'),('Row UV','NodeSocketVector','OUTPUT'),
            ('Phase','NodeSocketFloat','OUTPUT'),('Dark Fraction','NodeSocketFloat','OUTPUT'),
        ):
            raster.interface.new_socket(name=name,socket_type=kind,in_out=direction)
        nodes, links = raster.nodes, raster.links
        inp, out = nodes.new('NodeGroupInput'), nodes.new('NodeGroupOutput')
        xy = nodes.new('ShaderNodeSeparateXYZ')
        links.new(inp.outputs['UV'],xy.inputs[0])
        rows = nodes.new('ShaderNodeValue')
        rows.name = 'Phosphor rows'
        rows.outputs[0].default_value = 72
        gap = nodes.new('ShaderNodeValue')
        gap.name = 'Dark gap fraction'
        gap.outputs[0].default_value = .28

        def math(operation, a, b=0):
            node = nodes.new('ShaderNodeMath')
            node.operation = operation
            for value, socket in zip((a,b),node.inputs):
                if isinstance(value,(float,int)):
                    socket.default_value = value
                else:
                    links.new(value,socket)
            return node.outputs[0]

        y = math('MULTIPLY',xy.outputs['Y'],rows.outputs[0])
        gap_center = math('MULTIPLY',gap.outputs[0],.5)
        row = math('FLOOR',math('SUBTRACT',y,gap_center))
        # Bright band center = (1 + dark fraction)/2; transitions at gap/2.
        sample = math('DIVIDE',math('ADD',row,math('ADD',gap_center,.5)),rows.outputs[0])
        uv = nodes.new('ShaderNodeCombineXYZ')
        links.new(xy.outputs['X'],uv.inputs['X'])
        links.new(sample,uv.inputs['Y'])
        links.new(uv.outputs[0],out.inputs['Row UV'])
        links.new(math('FRACT',y),out.inputs['Phase'])
        links.new(gap.outputs[0],out.inputs['Dark Fraction'])
        for index, node in enumerate(nodes):
            node.location = ((index%5)*230,-(index//5)*220)
    crt = bpy.data.node_groups['LOGAN / CRT display']
    if not crt.nodes.get('Shared phosphor raster'):
        node = crt.nodes.new('ShaderNodeGroup')
        node.node_tree, node.name = raster, 'Shared phosphor raster'
        inputs = next(n for n in crt.nodes if n.type=='GROUP_INPUT')
        threshold = crt.nodes['Math.002']
        crt.links.new(inputs.outputs['UV'],node.inputs['UV'])
        crt.links.new(node.outputs['Phase'],threshold.inputs[0])
        crt.links.new(node.outputs['Dark Fraction'],threshold.inputs[1])
        for name in ('Math.001','Math'):
            crt.nodes.remove(crt.nodes[name])
    for material in bpy.data.materials:
        if not material.use_nodes or 'Face · 2D CRT display' not in material.name:
            continue
        nodes, links = material.node_tree.nodes, material.node_tree.links
        node = nodes.get('Shared phosphor raster') or nodes.new('ShaderNodeGroup')
        node.node_tree, node.name = raster, 'Shared phosphor raster'
        node.location = (nodes['Separate XYZ'].location.x-220,400)
        links.new(nodes['UV Map'].outputs[0],node.inputs['UV'])
        links.new(node.outputs['Row UV'],nodes['Separate XYZ'].inputs[0])


def dark_features(material, crt):
    """Use the artwork as a negative mask, before staging recolors its phosphor."""
    nodes, links = material.node_tree.nodes, material.node_tree.links
    # Image textures decode sRGB before entering the shader. Subtract the same
    # linear-light pink to retain genuinely black features, including the smirk.
    def linear(channel):
        value = channel/255
        return value/12.92 if value <= .04045 else ((value+.055)/1.055)**2.4
    pink = (*(linear(c) for c in (255,85,221)),1)
    for socket_name, hue_name in (
        ('Image','Staging / blue phosphor'),
        ('Diffusion Image','Screen diffusion / blue phosphor'),
    ):
        destination = crt.inputs[socket_name]
        if material.name.startswith('Staging / '):
            destination = nodes[hue_name].inputs['Color']
        name = 'Face polarity / '+socket_name
        signal = destination.links[0].from_socket
        if signal.node.name == name:
            continue
        invert = nodes.get(name) or nodes.new('ShaderNodeMixRGB')
        invert.name = name
        invert.label = 'Black features on luminous phosphor'
        invert.blend_type = 'SUBTRACT'
        invert.use_clamp = True
        invert.inputs[0].default_value = 1
        invert.inputs[1].default_value = pink
        links.new(signal, invert.inputs[2])
        links.new(invert.outputs[0], destination)
        invert.location = (crt.location.x-250, -1000 if socket_name == 'Image' else -2500)


def setup_screen_controls():
    """Connect both glass reflection lobes to one control and keep glow separate."""
    group = bpy.data.node_groups['LOGAN / CRT display']
    n, links = group.nodes, group.links
    inputs = next(node for node in n if node.type == 'GROUP_INPUT')
    output = next(node for node in n if node.type == 'GROUP_OUTPUT')
    glass = next(node for node in n if node.type == 'BSDF_PRINCIPLED')
    definitions = (
        ('Glass Roughness', 'NodeSocketFloat', glass.inputs['Roughness'].default_value,
         'Reflection blur in Eevee and Cycles; drives both glass and clearcoat.'),
        ('Screen Diffusion', 'NodeSocketFloat', .5,
         'Soft spread of the emitted artwork beneath the sharp glass reflection.'),
        ('Glass Reflection', 'NodeSocketFloat', .45,
         'Strength of the glass highlight, independent of emission and roughness.'),
        ('Diffusion Image', 'NodeSocketColor', None,
         'Blurred artwork, transformed with the same blink controls as the face.'),
    )
    created = {}
    for name, kind, value, description in definitions:
        if any(item.name == name and item.item_type == 'SOCKET' for item in group.interface.items_tree):
            continue
        socket = group.interface.new_socket(name=name, in_out='INPUT', socket_type=kind)
        socket.description = description
        if value is not None:
            socket.default_value = value
            socket.min_value, socket.max_value = 0, 1
            created[name] = value
        else:
            socket.hide_value = True
    for name in ('Roughness', 'Coat Roughness'):
        links.new(inputs.outputs['Glass Roughness'], glass.inputs[name])
    if not n.get('Glass reflection / strength'):
        destinations = [link.to_socket for link in glass.outputs[0].links]
        reflection = n.new('ShaderNodeMixShader')
        reflection.name = 'Glass reflection / strength'
        links.new(inputs.outputs['Glass Reflection'],reflection.inputs[0])
        links.new(glass.outputs[0],reflection.inputs[2])
        for destination in destinations:
            links.new(reflection.outputs[0],destination)
        reflection.location = (glass.location.x+240,glass.location.y)
    if not n.get('Screen diffusion / emission'):
        strength = n.new('ShaderNodeMath')
        strength.name = 'Screen diffusion / brightness'
        strength.operation = 'MULTIPLY'
        links.new(inputs.outputs['Screen Diffusion'], strength.inputs[0])
        links.new(inputs.outputs['Brightness'], strength.inputs[1])
        emission = n.new('ShaderNodeEmission')
        emission.name = 'Screen diffusion / emission'
        links.new(inputs.outputs['Diffusion Image'], emission.inputs['Color'])
        links.new(strength.outputs[0], emission.inputs['Strength'])
        surface = output.inputs['Shader'].links[0].from_socket
        add = n.new('ShaderNodeAddShader')
        add.name = 'Screen diffusion / under glass'
        links.new(surface, add.inputs[0])
        links.new(emission.outputs[0], add.inputs[1])
        links.new(add.outputs[0], output.inputs['Shader'])
        strength.location = (0,-1200)
        emission.location = (250,-1200)
        add.location = (500,-800)

    if not n.get('Screen diffusion / ink mask'):
        channels = n.new('ShaderNodeSeparateColor')
        channels.name = 'Screen diffusion / phosphor channels'
        links.new(inputs.outputs['Image'], channels.inputs['Color'])
        mask = None
        for first, second in ((channels.outputs[0],channels.outputs[1]), (None,channels.outputs[2])):
            maximum = n.new('ShaderNodeMath')
            maximum.operation = 'MAXIMUM'
            links.new(first if first is not None else mask, maximum.inputs[0])
            links.new(second, maximum.inputs[1])
            mask = maximum.outputs[0]
        # Keep the dark artwork opaque; diffusion belongs to the lit phosphor,
        # rather than filling the eyes and thin smirk with a pink veil.
        masked = n.new('ShaderNodeMixRGB')
        masked.name = 'Screen diffusion / ink mask'
        masked.blend_type = 'MULTIPLY'
        masked.inputs[0].default_value = 1
        links.new(inputs.outputs['Diffusion Image'], masked.inputs[1])
        links.new(mask, masked.inputs[2])
        links.new(masked.outputs[0], n['Screen diffusion / emission'].inputs['Color'])
        masked.location = (0,-1500)

    for material in bpy.data.materials:
        if not material.use_nodes or 'Face · 2D CRT display' not in material.name:
            continue
        nodes, material_links = material.node_tree.nodes, material.node_tree.links
        crt = next(node for node in nodes if node.type == 'GROUP' and node.node_tree == group)
        # Existing group instances initially receive zero when an interface
        # socket is added; seed only new controls, never an artist's later edit.
        for name, value in created.items():
            crt.inputs[name].default_value = value
        # Rebuild our texture branch without disturbing either artist control.
        for old in list(nodes):
            if old.name.startswith('Screen diffusion /'):
                nodes.remove(old)
        composite = None
        for index, layer in enumerate(('static', 'eye-L', 'eye-R')):
            artwork = nodes['2D artwork / '+layer]
            texture = nodes.new('ShaderNodeTexImage')
            texture.name = 'Screen diffusion / '+layer
            texture.image = bpy.data.images.load(str(HERE/'face'/f'{layer}-diffusion.png'), check_existing=True)
            texture.image.reload()
            texture.image.pack()
            texture.extension = 'CLIP'
            material_links.new(artwork.inputs['Vector'].links[0].from_socket, texture.inputs['Vector'])
            texture.location = (artwork.location.x, -1600-index*280)
            if composite is None:
                composite = texture.outputs['Color']
                continue
            lighten = nodes.new('ShaderNodeMixRGB')
            lighten.name = 'Screen diffusion / combine '+layer
            lighten.blend_type = 'LIGHTEN'
            lighten.inputs[0].default_value = 1
            material_links.new(composite, lighten.inputs[1])
            material_links.new(texture.outputs['Color'], lighten.inputs[2])
            lighten.location = (texture.location.x+300, texture.location.y)
            composite = lighten.outputs[0]
        if material.name.startswith('Staging / '):
            hue = nodes.new('ShaderNodeHueSaturation')
            hue.name = 'Screen diffusion / blue phosphor'
            hue.inputs['Hue'].default_value = .25
            material_links.new(composite, hue.inputs['Color'])
            composite = hue.outputs['Color']
            hue.location = (crt.location.x-250,-2200)
        material_links.new(composite, crt.inputs['Diffusion Image'])
        dark_features(material, crt)
    lock_eye_raster()
    bpy.context.view_layer.update()


if __name__ == '__main__':
    setup_screen_controls()
