"""Refresh avatar surfaces and face artwork without changing cameras or poses.

Run in the existing avatar studio after regenerating face PNGs and the soft
background. Also used by avatar-studio.py when building a fresh studio.
Does not save; the caller controls persistence.
"""
from pathlib import Path
import xml.etree.ElementTree as ET
import runpy
import bpy

HERE = Path(__file__).resolve().parent
PREFIX = 'Portrait finish / '


def finish_nodes(material):
    """Replace only this finish's procedural nodes, retaining color and emission."""
    nodes = material.node_tree.nodes
    for node in list(nodes):
        if node.name.startswith(PREFIX):
            nodes.remove(node)
    return nodes, material.node_tree.links


def node(nodes, kind, name):
    result = nodes.new(kind)
    result.name = PREFIX+name
    result.label = name
    return result


def shell(material):
    """Fine woven membrane cloth; preserve the authored facets, print and neon."""
    nodes, links = finish_nodes(material)
    shader = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Metallic'].default_value = 0
    shader.inputs['Coat Weight'].default_value = 0
    shader.inputs['Sheen Weight'].default_value = .12
    shader.inputs['Sheen Roughness'].default_value = .65
    coords = node(nodes, 'ShaderNodeTexCoord', 'cloth coordinates')
    waves = []
    for direction in ('X', 'Y'):
        wave = node(nodes, 'ShaderNodeTexWave', 'woven '+direction)
        wave.bands_direction = direction
        wave.inputs['Scale'].default_value = 150
        wave.inputs['Distortion'].default_value = .8
        links.new(coords.outputs['Object'], wave.inputs['Vector'])
        waves.append(wave)
    weave = node(nodes, 'ShaderNodeMath', 'crossed threads')
    weave.operation = 'MULTIPLY'
    for wave, socket in zip(waves, weave.inputs):
        links.new(wave.outputs['Fac'], socket)
    bump = node(nodes, 'ShaderNodeBump', 'fine membrane weave')
    bump.inputs['Strength'].default_value = .22
    bump.inputs['Distance'].default_value = .0015
    links.new(weave.outputs[0], bump.inputs['Height'])
    links.new(bump.outputs[0], shader.inputs['Normal'])
    noise = node(nodes, 'ShaderNodeTexNoise', 'cloth roughness')
    noise.inputs['Scale'].default_value = 180
    noise.inputs['Detail'].default_value = 2
    links.new(coords.outputs['Object'], noise.inputs['Vector'])
    roughness = node(nodes, 'ShaderNodeMapRange', 'membrane roughness range')
    roughness.inputs['To Min'].default_value = .48
    roughness.inputs['To Max'].default_value = .66
    links.new(noise.outputs['Fac'], roughness.inputs['Value'])
    links.new(roughness.outputs[0], shader.inputs['Roughness'])


def teddy(name):
    """Base shading for teddy fleece; fleece-lining.py supplies exposed pile."""
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Roughness'].default_value = .96
    shader.inputs['Sheen Weight'].default_value = .8
    shader.inputs['Sheen Roughness'].default_value = .8
    coords = nodes.new('ShaderNodeTexCoord')
    clusters = nodes.new('ShaderNodeTexNoise')
    clusters.inputs['Scale'].default_value = 95
    clusters.inputs['Detail'].default_value = 3
    links.new(coords.outputs['Object'], clusters.inputs['Vector'])
    color = nodes.new('ShaderNodeValToRGB')
    color.color_ramp.elements[0].color = (.44,.34,.24,1)
    color.color_ramp.elements[1].color = (.82,.72,.58,1)
    links.new(clusters.outputs['Fac'], color.inputs['Fac'])
    links.new(color.outputs[0], shader.inputs['Base Color'])
    pile = nodes.new('ShaderNodeBump')
    pile.inputs['Strength'].default_value = .65
    pile.inputs['Distance'].default_value = .018
    links.new(clusters.outputs['Fac'], pile.inputs['Height'])
    fibers = nodes.new('ShaderNodeTexNoise')
    fibers.inputs['Scale'].default_value = 800
    fibers.inputs['Detail'].default_value = 2
    links.new(coords.outputs['Object'], fibers.inputs['Vector'])
    fine = nodes.new('ShaderNodeBump')
    fine.inputs['Strength'].default_value = .3
    fine.inputs['Distance'].default_value = .002
    links.new(fibers.outputs['Fac'], fine.inputs['Height'])
    links.new(pile.outputs[0], fine.inputs['Normal'])
    links.new(fine.outputs[0], shader.inputs['Normal'])
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(shader.outputs[0], output.inputs['Surface'])
    material.diffuse_color = (.65,.55,.43,1)
    return material


def refresh_face():
    """Reload packed artwork and keep each blink centered on its new pupil."""
    svg = ET.parse(HERE/'face/face.svg').getroot()
    ns = '{http://www.w3.org/2000/svg}'
    for material in bpy.data.materials:
        if not material.use_nodes or 'Face · 2D CRT display' not in material.name:
            continue
        for layer in ('static', 'eye-L', 'eye-R'):
            texture = material.node_tree.nodes['2D artwork / '+layer]
            texture.image.filepath = str(HERE/'face'/f'{layer}.png')
            texture.image.reload()
            texture.image.pack()
            if layer == 'static':
                continue
            eye = svg.find(f"{ns}g[@id='{layer}']/{ns}rect")
            center = 1-(float(eye.get('y'))+float(eye.get('height'))/2)/float(svg.get('height'))
            combine = texture.inputs['Vector'].links[0].from_node
            add = combine.inputs['Y'].links[0].from_node
            divide = add.inputs[0].links[0].from_node
            subtract = divide.inputs[0].links[0].from_node
            add.inputs[1].default_value = subtract.inputs[1].default_value = center


def finish_avatar():
    """Apply the portrait finish to both independent palette scenes in place."""
    materials = {slot.material for scene in bpy.data.scenes if scene.name.startswith('AVATAR ·')
                 for obj in scene.objects if obj.type == 'MESH'
                 for slot in obj.material_slots if slot.material}
    for material in materials:
        name = material.name.removeprefix('Staging / ')
        if name.startswith('Jacket ·'):
            shell(material)
        if name.startswith(('Head ·', 'Graphite ·', 'Trim ·')):
            for shader in material.node_tree.nodes:
                if shader.type == 'BSDF_PRINCIPLED':
                    shader.inputs['Metallic'].default_value = 0
                    shader.inputs['Roughness'].default_value = .44
                    shader.inputs['Coat Weight'].default_value = .12
        if 'command room plate' in name:
            # Neutral rack silhouettes support both saturated accent palettes.
            image = bpy.data.images.load(str(HERE/'environment/server-room-neutral.png'), check_existing=True)
            image.reload()
            image.pack()
            texture = next(n for n in material.node_tree.nodes if n.type == 'TEX_IMAGE')
            texture.image = image
            next(n for n in material.node_tree.nodes if n.type == 'EMISSION').inputs['Strength'].default_value = .5
    for scene in bpy.data.scenes:
        if not scene.name.startswith('AVATAR ·'):
            continue
        lining = teddy(('Staging / ' if scene.name.endswith('Staging') else '')+'Jacket · teddy lining')
        jacket = next(o for o in scene.objects if o.name.startswith('Jacket / torso'))
        jacket.data.materials[7] = lining
        collar = next(o for o in scene.objects if o.name.startswith('Collar / raised band'))
        # Authored collar slot 1 is the inner wall; slot 2 is its folded top rim.
        collar.data.materials[1] = lining
        collar.data.materials[2] = lining
    refresh_face()
    runpy.run_path(str(HERE/'screen-controls.py'))['setup_screen_controls']()
    bpy.context.view_layer.update()


if __name__ == '__main__':
    finish_avatar()
