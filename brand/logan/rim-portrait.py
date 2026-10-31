"""Shape saturated rim highlights and expose familiar portrait grading controls.

Apply to production, then sync-staging.py makes the matching color swap.
Preserves camera, pose, screen gloss and screen diffusion.
"""
import bpy
from mathutils import Vector


def rim_portrait():
    scene = bpy.data.scenes['AVATAR · Production']
    lights = {
        'Portrait / key · silk': ((-4.5,-6,9.5),260,(1,.9,.88),4.5,None),
        'Portrait / fill · cool': ((4.5,-5,5.5),45,(.4,.65,1),3.2,None),
        'Portrait / rim · magenta': ((-3.3,.4,7.6),600,(1,.012,.8),.25,3.5),
        'Portrait / rim · ice': ((3.0,1.4,7.6),450,(.035,.28,1),.3,3.2),
        'Portrait / top edge': ((0,1.2,8.1),250,(1,.012,.8),3.5,.25),
    }
    for name, (position,power,color,width,height) in lights.items():
        obj = scene.objects[name]
        obj.location = position
        obj.rotation_euler = (Vector((0,0,5.9))-obj.location).to_track_quat('-Z','Y').to_euler()
        obj.data.energy, obj.data.color = power, color
        obj.data.shape = 'RECTANGLE' if height else 'DISK'
        obj.data.size = width
        if height:
            obj.data.size_y = height
    rig = next(o for o in scene.objects if o.get('logan_pose_controls'))
    rig['screen_brightness'] = 1.0
    rig.keyframe_insert(data_path='["screen_brightness"]',frame=80)
    materials = {slot.material for obj in scene.objects if obj.type=='MESH'
                 for slot in obj.material_slots if slot.material}
    for material in materials:
        if not material.use_nodes or 'Face ·' in material.name or 'Portrait /' in material.name:
            continue
        for shader in material.node_tree.nodes:
            if shader.type != 'BSDF_PRINCIPLED':
                continue
            if shader.inputs['Emission Strength'].default_value > 0:
                shader.inputs['Emission Strength'].default_value = .5 if material.name.startswith(('Head ·','Trim ·')) else 1.0
            if shader.inputs['Metallic'].default_value < .5:
                # Shallow scattering in cloth/rubber catches backlight without
                # turning opaque metal into wax. No scattering on screen glass.
                shader.inputs['Subsurface Weight'].default_value = .07
                shader.inputs['Subsurface Scale'].default_value = .009
                shader.inputs['Subsurface Radius'].default_value = (1,.55,.7)
            if material.name.startswith('Jacket ·'):
                shader.inputs['Sheen Weight'].default_value = .3 if 'teddy' not in material.name else .8
    shell = scene.objects['Head / faceted shell']
    bevel = next(m for m in shell.modifiers if m.type=='BEVEL')
    bevel.width, bevel.segments = .009, 2

    tree = scene.compositing_node_group
    nodes, links = tree.nodes, tree.links
    render = next(n for n in nodes if n.type=='R_LAYERS')
    glow = next(n for n in nodes if n.type=='GLARE')
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
    glow.inputs['Strength'].default_value = .4
    glow.inputs['Size'].default_value = .6
    glow.location = (1100,250)
    scene.view_settings.exposure = -.4
    scene['portrait_notes'] = 'Narrow saturated backlights; matte metal bevels, shallow cloth scattering; compositor grading controls.'


if __name__ == '__main__':
    rim_portrait()
