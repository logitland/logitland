"""Replace staging with an exact production duplicate, then swap only its colors.

Run after production art direction. Copies the current pose, camera, geometry,
lights, grading and render settings together, preserving production's appearance.
"""
from pathlib import Path
import colorsys
import bpy

HERE = Path(__file__).resolve().parent


def blue(color):
    hue, saturation, value = colorsys.rgb_to_hsv(*color[:3])
    if saturation > .25 and (hue > .73 or hue < .02):
        return (*colorsys.hsv_to_rgb(.59, saturation, value), color[3])
    return tuple(color)


def sync_staging():
    """Keep staging identical to production apart from character accent hues."""
    production = bpy.data.scenes['AVATAR · Production']
    old = bpy.data.scenes.get('AVATAR · Staging')
    if old:
        exclusive = [o for o in old.objects if len(o.users_scene) == 1]
        old_data = {o.data for o in exclusive if o.data}
        bpy.context.window.scene = production
        bpy.data.scenes.remove(old)
        for obj in exclusive:
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.batch_remove(ids=[data for data in old_data if data.users == 0])
    for material in list(bpy.data.materials):
        if material.name.startswith('Staging / ') and material.users == 0:
            bpy.data.materials.remove(material)
    for obj in production.objects:
        obj['portrait_source'] = obj.name
    bpy.context.window.scene = production
    bpy.ops.scene.new(type='FULL_COPY')
    staging = bpy.context.scene
    staging.name = 'AVATAR · Staging'
    source_rig = next(o for o in production.objects if o.get('logan_pose_controls'))
    target_rig = next(o for o in staging.objects if o.get('logan_pose_controls'))
    copies = {}
    for obj in staging.objects:
        if obj.type == 'LIGHT':
            rgba = (*obj.data.color,1)
            obj.data.color = blue(rgba)[:3]
            if obj.name.startswith('Portrait / rim · ice'):
                obj.data.color = (1,.012,.8)
            continue
        if obj.type != 'MESH':
            continue
        for slot in obj.material_slots:
            source = slot.material
            if source is None:
                continue
            if source in copies:
                slot.material = copies[source]
                continue
            material = source.copy()
            material.name = 'Staging / '+source.name
            copies[source] = material
            slot.material = material
            if material.node_tree.animation_data:
                for driver in material.node_tree.animation_data.drivers:
                    for variable in driver.driver.variables:
                        for target in variable.targets:
                            if target.id == source_rig:
                                target.id = target_rig
            nodes, links = material.node_tree.nodes, material.node_tree.links
            if 'Face · 2D CRT display' in source.name:
                crt = next(n for n in nodes if n.type == 'GROUP' and n.node_tree.name == 'LOGAN / CRT display')
                for name, label in (('Image','Staging / blue phosphor'),
                                    ('Diffusion Image','Screen diffusion / blue phosphor')):
                    destination = crt.inputs[name]
                    signal = destination.links[0].from_socket
                    hue = nodes.new('ShaderNodeHueSaturation')
                    hue.name = label
                    hue.inputs['Hue'].default_value = .25
                    links.new(signal, hue.inputs['Color'])
                    links.new(hue.outputs[0], destination)
                continue
            material.diffuse_color = blue(material.diffuse_color)
            for node in list(nodes):
                for socket in list(node.inputs)+list(node.outputs):
                    if socket.type == 'RGBA' and hasattr(socket,'default_value'):
                        socket.default_value = blue(socket.default_value)
                if node.type == 'VALTORGB':
                    for element in node.color_ramp.elements:
                        element.color = blue(element.color)
                if node.type == 'TEX_IMAGE' and 'original SVG print' in source.name:
                    destinations = [link.to_socket for link in node.outputs['Color'].links]
                    hue = nodes.new('ShaderNodeHueSaturation')
                    hue.name = 'Staging / blue SVG ink'
                    hue.inputs['Hue'].default_value = .25
                    links.new(node.outputs['Color'],hue.inputs['Color'])
                    for destination in destinations:
                        links.new(hue.outputs[0],destination)
    staging.compositing_node_group = production.compositing_node_group.copy()
    for node in staging.compositing_node_group.nodes:
        if node.type == 'R_LAYERS':
            node.scene = staging
    staging.render.filepath = str(HERE/'renders/logan-staging-avatar.png')
    staging['portrait_notes'] = 'Production pose, framing, lighting and warm arcade backdrop; blue character accents.'
    bpy.context.window.scene = production
    bpy.context.view_layer.update()
    return staging


if __name__ == '__main__':
    sync_staging()
