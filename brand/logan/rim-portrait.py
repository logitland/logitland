"""Shape saturated rim highlights and expose familiar portrait grading controls.

Apply to production, then sync-staging.py makes the matching color swap.
Preserves camera, pose, screen gloss and screen diffusion.
"""
import bpy
from mathutils import Vector


def soft_fabric_edges(scene):
    """Wrap backlight through cloth and fibers without lighting the collar backing."""
    materials = {slot.material for o in scene.objects if o.type=='MESH'
                 for slot in o.material_slots if slot.material}
    for material in materials:
        if not material.name.startswith('Jacket ·'):continue
        nodes,links = material.node_tree.nodes,material.node_tree.links
        shader = next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
        if 'teddy' in material.name:
            shader.inputs['Subsurface Weight'].default_value = .85 if 'fibers' in material.name else .15
            shader.inputs['Subsurface Scale'].default_value = .002
            shader.inputs['Subsurface Radius'].default_value = (1,1,1)
            continue
        if not any(word in material.name for word in ('charcoal','shadow facet','light facet','nylon')):continue
        scatter = nodes.get('Fabric / shallow scattering') or nodes.new('ShaderNodeSubsurfaceScattering')
        scatter.name = 'Fabric / shallow scattering'
        scatter.inputs['Color'].default_value = (.3,.23,.27,1)
        scatter.inputs['Scale'].default_value = .12
        scatter.inputs['Radius'].default_value = (1,.7,.85)
        scatter.inputs['Anisotropy'].default_value = .35
        for link in shader.inputs['Normal'].links:
            links.new(link.from_socket,scatter.inputs['Normal'])
        output = next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
        mix = nodes.get('Fabric / scattering blend') or nodes.get('Fabric / grazing scatter')
        if mix is None:
            original = output.inputs['Surface'].links[0].from_socket
            mix = nodes.new('ShaderNodeMixShader')
            links.new(original,mix.inputs[1])
        mix.name = mix.label = 'Fabric / scattering blend'
        for link in list(mix.inputs[0].links):links.remove(link)
        mix.inputs[0].default_value = .55
        for name in ('Fabric / grazing angle','Fabric / edge scatter weight'):
            if nodes.get(name):nodes.remove(nodes[name])
        links.new(scatter.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],output.inputs['Surface'])
        scatter.location = (440,-600)
        mix.location = (700,0)


def light_edges(scene):
    """Use pink rear strip lights for a narrow silhouette and soft fabric edges."""
    lights = {
        'Portrait / key · silk': ((-4.5,-6,9.5),340,(1,.9,.88),4.5,None),
        'Portrait / fill · pink': ((4.5,-5,5.5),60,(1,.12,.55),3.2,None),
        'Portrait / rim · magenta': ((-3.3,1.2,7.6),850,(1,.018,.55),.18,3.0),
        'Portrait / rim · pink right': ((3,3,7.4),650,(1,.018,.55),.18,3.0),
        'Portrait / top edge': ((0,1.6,8.8),750,(1,.025,.6),2.5,.2),
    }
    old_names = {'Portrait / fill · pink':'Portrait / fill · cool',
                 'Portrait / rim · pink right':'Portrait / rim · ice'}
    for name, (position,power,color,width,height) in lights.items():
        obj = scene.objects.get(name) or scene.objects[old_names[name]]
        obj.name = name
        obj.location = position
        target = (0,0,7.1) if name == 'Portrait / top edge' else (0,0,5.9)
        obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
        if name == 'Portrait / top edge':obj.data.spread = 1.309
        obj.data.energy, obj.data.color = power, color
        obj.data.shape = 'RECTANGLE' if height else 'DISK'
        obj.data.size = width
        if height:
            obj.data.size_y = height
    materials = {slot.material for obj in scene.objects if obj.type=='MESH'
                 for slot in obj.material_slots if slot.material}
    for material in materials:
        if not material.use_nodes or 'Face ·' in material.name or 'Portrait /' in material.name:
            continue
        for shader in material.node_tree.nodes:
            if shader.type != 'BSDF_PRINCIPLED':
                continue
            if material.name.startswith(('Head ·','Graphite ·','Trim ·')):
                shader.inputs['Metallic'].default_value = 0
                shader.inputs['Roughness'].default_value = .44
                shader.inputs['IOR'].default_value = 1.46
                shader.inputs['Coat Weight'].default_value = .12
                shader.inputs['Coat Roughness'].default_value = .25
            if shader.inputs['Metallic'].default_value < .5:
                # Short-path scattering lets backlight soften thin plastic and
                # fabric edges. The screen keeps its independent glass shader.
                plastic = material.name.startswith(('Head ·','Graphite ·','Trim ·'))
                shader.inputs['Subsurface Weight'].default_value = .5 if plastic else .25
                shader.inputs['Subsurface Scale'].default_value = .025 if plastic else .035
                shader.inputs['Subsurface Radius'].default_value = (1,.55,.7)
            if material.name.startswith('Jacket ·'):
                shader.inputs['Sheen Weight'].default_value = .6 if 'teddy' not in material.name else .8
    shell = scene.objects['Head / faceted shell']
    bevel = next(m for m in shell.modifiers if m.type=='BEVEL')
    bevel.width, bevel.segments, bevel.angle_limit = .018,3,.5235988
    edge = bpy.data.materials.get('Head · polished plastic edges') or bpy.data.materials.new('Head · polished plastic edges')
    edge.use_nodes = True
    shader = next(n for n in edge.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    for name,value in {'Base Color':(.12,.1,.11,1),'Metallic':0,'Roughness':.2,
                       'Coat Weight':.35,'Coat Roughness':.15,'IOR':1.46,
                       'Subsurface Weight':.5,'Subsurface Scale':.025,
                       'Subsurface Radius':(1,.55,.7)}.items():
        shader.inputs[name].default_value = value
    if edge.name not in shell.data.materials:shell.data.materials.append(edge)
    bevel.material = shell.data.materials.find(edge.name)
    soft_fabric_edges(scene)


def rim_portrait():
    """Build the portrait finish; light_edges can update just the backlighting."""
    scene = bpy.data.scenes['AVATAR · Production']
    light_edges(scene)
    rig = next(o for o in scene.objects if o.get('logan_pose_controls'))
    rig['screen_brightness'] = 1.6
    rig.keyframe_insert(data_path='["screen_brightness"]',frame=80)
    materials = {slot.material for obj in scene.objects if obj.type=='MESH'
                 for slot in obj.material_slots if slot.material}
    for material in materials:
        if not material.use_nodes or 'Face ·' in material.name or 'Portrait /' in material.name:
            continue
        for shader in material.node_tree.nodes:
            if shader.type == 'BSDF_PRINCIPLED' and shader.inputs['Emission Strength'].default_value > 0:
                shader.inputs['Emission Strength'].default_value = .7 if material.name.startswith(('Head ·','Trim ·')) else 1.4

    tree = scene.compositing_node_group
    nodes, links = tree.nodes, tree.links
    render = next(n for n in nodes if n.type=='R_LAYERS')
    glow = next(n for n in nodes if n.type=='GLARE')
    render.location = (-280,250)
    next(n for n in nodes if n.type=='LENSDIST').location = (1360,250)
    next(n for n in nodes if n.type=='GROUP_OUTPUT').location = (1620,250)
    signal = render.outputs['Image']
    for index,(kind,label) in enumerate((
        ('CompositorNodeExposure','Grade / Exposure · stops'),
        ('CompositorNodeColorBalance','Grade / Lift Gamma Gain'),
        ('CompositorNodeCurveRGB','Grade / RGB Curves'),
        ('CompositorNodeHueSat','Grade / Saturation'),
    )):
        node = nodes.get(label) or nodes.new(kind)
        node.name = node.label = label
        node.location = (index*260,250)
        links.new(signal,node.inputs['Image'])
        signal = node.outputs['Image']
    nodes['Grade / Saturation'].inputs['Saturation'].default_value = 1.12
    links.new(signal,glow.inputs['Image'])
    glow.inputs['Threshold'].default_value = .5
    glow.inputs['Strength'].default_value = .5
    glow.inputs['Size'].default_value = .6
    glow.location = (1100,250)
    scene.view_settings.exposure = -.3
    scene['portrait_notes'] = 'Pink rear strips; matte plastic edge scattering, woven shell and curly fleece; compositor grading controls.'


if __name__ == '__main__':
    rim_portrait()
