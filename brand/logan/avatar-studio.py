"""Build editable production and staging portrait scenes from the saved master.

Run with Blender in background on logan.blend. Saves avatar-studio.blend beside
the master; never rewrites the character source. Optional -- preview renders
the production scene at 768px for lighting review.
"""
from pathlib import Path
from math import radians
import colorsys
import sys

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
scene = bpy.data.scenes['LOGAN']
bpy.context.window.scene = scene
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
scene.frame_set(80)
for other in list(bpy.data.scenes):
    if other != scene:
        bpy.data.scenes.remove(other)
scene.name = 'AVATAR · Production'


def aim(obj, point):
    obj.rotation_euler = (Vector(point)-obj.location).to_track_quat('-Z', 'Y').to_euler()


def area(name, position, target, energy, color, size, width=None):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.color = energy, color
    data.shape = 'RECTANGLE' if width else 'DISK'
    data.size = size
    if width:
        data.size_y = width
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = position
    aim(obj, target)
    return obj


# A quiet HDR studio supplies real reflection shapes; the portrait lights set
# direction and contrast. The generated background is a camera-only plate.
for obj in scene.objects:
    if obj.type == 'LIGHT' or obj.name.startswith('Studio / floor'):
        obj.hide_render = True
        obj.hide_set(True)
world = bpy.data.worlds.new('Portrait / studio reflections')
world.use_nodes = True
scene.world = world
nodes, links = world.node_tree.nodes, world.node_tree.links
env = nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(str(HERE/'environment/studio_small_09_2k.hdr'), check_existing=True)
env.image.pack()
mapping = nodes.new('ShaderNodeMapping')
mapping.inputs['Rotation'].default_value.z = radians(110)
coords = nodes.new('ShaderNodeTexCoord')
links.new(coords.outputs['Generated'], mapping.inputs['Vector'])
links.new(mapping.outputs['Vector'], env.inputs['Vector'])
links.new(env.outputs['Color'], nodes['Background'].inputs['Color'])
nodes['Background'].inputs['Strength'].default_value = .05

area('Portrait / key · silk', (-4.5, -6, 9.5), (0, 0, 5.8), 650, (1, .83, .76), 4.5)
area('Portrait / fill · cool', (4.5, -5, 5.5), (0, 0, 5.5), 100, (.4, .65, 1), 3.2)
area('Portrait / rim · magenta', (-3.4, 2.1, 7.2), (0, 0, 5.7), 900, (1, .055, .38), 1.4, 4)
area('Portrait / rim · ice', (3.5, 1.8, 7.8), (0, 0, 5.5), 950, (.22, .62, 1), 1.3, 3.2)
area('Portrait / top edge', (0, .3, 10), (0, 0, 6), 180, (.72, .8, 1), 3.2)

# Preserve faceted silhouettes, but distinguish woven nylon, ceramic metal and
# rubber through their light response. No subdivision or geometry is added.
materials = {slot.material for obj in scene.objects if obj.type == 'MESH' for slot in obj.material_slots if slot.material}
for mat in materials:
    if not mat.use_nodes:
        continue
    for node in mat.node_tree.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            if mat.name.startswith('Jacket'):
                node.inputs['Roughness'].default_value = .55
                node.inputs['Sheen Weight'].default_value = .18
                node.inputs['Sheen Roughness'].default_value = .6
                if not node.inputs['Base Color'].is_linked:
                    color = node.inputs['Base Color'].default_value
                    if max(color[:3]) < .1:
                        node.inputs['Base Color'].default_value = (*(v*1.1 for v in color[:3]), 1)
            if mat.name.startswith(('Head ·', 'Graphite ·', 'Trim ·')):
                node.inputs['Roughness'].default_value = .36
                node.inputs['Metallic'].default_value = .58
                node.inputs['Coat Weight'].default_value = .22
                node.inputs['Coat Roughness'].default_value = .25
            accent = (mat.name.startswith('Pink ·') or 'inset pink light' in mat.name
                      or 'magenta' in mat.name or 'depth fade' in mat.name
                      or 'original SVG print' in mat.name)
            if accent:
                emission = node.inputs['Emission Color']
                base = node.inputs['Base Color']
                if not emission.is_linked:
                    if base.is_linked:
                        mat.node_tree.links.new(base.links[0].from_socket, emission)
                    else:
                        emission.default_value = base.default_value
                node.inputs['Emission Strength'].default_value = 1.8 if mat.name.startswith(('Head ·', 'Trim ·')) else 2.6
        if node.type == 'BUMP':
            node.inputs['Strength'].default_value = .09
            node.inputs['Distance'].default_value = .004

rig = next(o for o in scene.objects if o.get('logan_pose_controls'))
rig['screen_brightness'] = 2.6
rig.keyframe_insert(data_path='["screen_brightness"]', frame=80)

camera = scene.camera
camera.name = 'Portrait / 85mm'
camera.data.type = 'PERSP'
camera.data.lens = 85
camera.data.sensor_width = 36
camera.location = (2.1, -12.3, 6.0)
aim(camera, (-.05, 0, 5.35))
camera.rotation_euler.rotate_axis('Z', radians(-2))
camera.data.dof.use_dof = True
focus = bpy.data.objects.new('Portrait / focus · eyes', None)
scene.collection.objects.link(focus)
focus.location = (0, -.67, 6.35)
camera.data.dof.focus_object = focus
camera.data.dof.aperture_fstop = 2.8
camera.data.dof.aperture_blades = 9
camera.data.dof.aperture_ratio = 1.12
camera.data.passepartout_alpha = 1

# Keep the background in-camera and editable, without contaminating lighting.
distance = 23
half = distance*camera.data.sensor_width/(2*camera.data.lens)*1.08
mesh = bpy.data.meshes.new('Portrait / background quad')
mesh.from_pydata([(-half,-half,0),(half,-half,0),(half,half,0),(-half,half,0)], [], [(0,1,2,3)])
uv = mesh.uv_layers.new()
for loop, coord in zip(uv.data, [(0,0),(1,0),(1,1),(0,1)]):
    loop.uv = coord
plate = bpy.data.objects.new('Portrait / command room', mesh)
scene.collection.objects.link(plate)
plate.rotation_euler = camera.rotation_euler.copy()
plate.location = camera.location+camera.rotation_euler.to_quaternion() @ Vector((0,0,-distance))
for attr in ('visible_shadow','visible_diffuse','visible_glossy','visible_transmission','visible_volume_scatter'):
    setattr(plate, attr, False)
mat = bpy.data.materials.new('Portrait / command room plate')
mat.use_nodes = True
mesh.materials.append(mat)
n, l = mat.node_tree.nodes, mat.node_tree.links
n.clear()
tex = n.new('ShaderNodeTexImage')
tex.image = bpy.data.images.load(str(HERE/'environment/command-room.png'), check_existing=True)
tex.image.pack()
emission = n.new('ShaderNodeEmission')
emission.inputs['Strength'].default_value = .7
output = n.new('ShaderNodeOutputMaterial')
l.new(tex.outputs['Color'], emission.inputs['Color'])
l.new(emission.outputs[0], output.inputs['Surface'])

# Bloom belongs to the bright details. Lens aberration is deliberately subpixel
# at icon size so the face stays legible instead of becoming a rainbow fringe.
tree = bpy.data.node_groups.new('Portrait / optical finish', 'CompositorNodeTree')
tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
n, l = tree.nodes, tree.links
render = n.new('CompositorNodeRLayers')
render.scene = scene
glow = n.new('CompositorNodeGlare')
glow.inputs['Type'].default_value = 'Fog Glow'
glow.inputs['Threshold'].default_value = .10
glow.inputs['Strength'].default_value = 1.0
glow.inputs['Size'].default_value = .70
l.new(render.outputs['Image'], glow.inputs['Image'])
lens = n.new('CompositorNodeLensdist')
lens.inputs['Fit'].default_value = True
lens.inputs['Distortion'].default_value = .006
lens.inputs['Dispersion'].default_value = .0005
l.new(glow.outputs['Image'], lens.inputs['Image'])
out = n.new('NodeGroupOutput')
l.new(lens.outputs['Image'], out.inputs['Image'])
scene.compositing_node_group = tree
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.cycles.adaptive_threshold = .02
scene.render.resolution_x = scene.render.resolution_y = 2048
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -.25
scene.render.filepath = str(HERE/'renders/logan-avatar.png')
scene['portrait_notes'] = '85mm, f/2.8, focus on eyes, 2-degree roll; pink production identity.'

# Full-copy remaps the armature, constraints and drivers together. Materials are
# then copied explicitly so changing staging cannot recolor production.
bpy.ops.scene.new(type='FULL_COPY')
staging = bpy.context.scene
staging.name = 'AVATAR · Staging'
copies = {}
production_rig = next(o for o in scene.objects if o.get('logan_pose_controls'))
staging_rig = next(o for o in staging.objects if o.get('logan_pose_controls'))


def blue(color):
    h, saturation, value = colorsys.rgb_to_hsv(*color[:3])
    if saturation > .25 and (h > .73 or h < .02):
        return (*colorsys.hsv_to_rgb(.59, saturation, value), color[3])
    return tuple(color)


for obj in staging.objects:
    if obj.type == 'LIGHT' and 'rim · magenta' in obj.name:
        obj.data.color = (.08, .38, 1)
    if obj.type != 'MESH':
        continue
    for slot in obj.material_slots:
        source = slot.material
        if source is None:
            continue
        if source not in copies:
            copy = source.copy()
            copy.name = 'Staging / '+source.name
            copies[source] = copy
            if copy.node_tree.animation_data:
                for driver in copy.node_tree.animation_data.drivers:
                    for variable in driver.driver.variables:
                        for target in variable.targets:
                            if target.id == production_rig:
                                target.id = staging_rig
            copy.diffuse_color = blue(copy.diffuse_color)
            for node in copy.node_tree.nodes:
                for socket in list(node.inputs)+list(node.outputs):
                    if socket.type == 'RGBA' and hasattr(socket, 'default_value'):
                        socket.default_value = blue(socket.default_value)
                if node.type == 'VALTORGB':
                    for element in node.color_ramp.elements:
                        element.color = blue(element.color)
            # Artwork remains 2D: recolor its image signal before the CRT stage.
            for node in list(copy.node_tree.nodes):
                if node.type == 'TEX_IMAGE' and 'original SVG print' in source.name:
                    destinations = [link.to_socket for link in node.outputs['Color'].links]
                    hue = copy.node_tree.nodes.new('ShaderNodeHueSaturation')
                    hue.name = 'Staging / blue SVG ink'
                    hue.inputs['Hue'].default_value = .25
                    copy.node_tree.links.new(node.outputs['Color'], hue.inputs['Color'])
                    for destination in destinations:
                        copy.node_tree.links.new(hue.outputs['Color'], destination)
                if node.type == 'GROUP' and 'CRT display' in node.node_tree.name:
                    socket = node.inputs['Image']
                    signal = socket.links[0].from_socket
                    hue = copy.node_tree.nodes.new('ShaderNodeHueSaturation')
                    hue.name = 'Staging / blue phosphor'
                    hue.inputs['Hue'].default_value = .25
                    copy.node_tree.links.new(signal, hue.inputs['Color'])
                    copy.node_tree.links.new(hue.outputs['Color'], socket)
        slot.material = copies[source]
staging.compositing_node_group = scene.compositing_node_group.copy()
for node in staging.compositing_node_group.nodes:
    if node.type == 'R_LAYERS':
        node.scene = staging
staging.render.filepath = str(HERE/'renders/logan-staging-avatar.png')
staging['portrait_notes'] = 'Matching 85mm portrait; blue staging identity.'

bpy.context.window.scene = scene
for screen in bpy.data.screens:
    for space in (a.spaces.active for a in screen.areas if a.type == 'VIEW_3D'):
        space.region_3d.view_perspective = 'CAMERA'
        space.overlay.show_overlays = False
        space.shading.type = 'MATERIAL'
        space.shading.use_scene_world = True
        space.shading.use_scene_lights = True
        space.shading.use_compositor = 'CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'avatar-studio.blend'), compress=True)
if '--' in sys.argv and 'preview' in sys.argv[sys.argv.index('--')+1:]:
    scene.render.resolution_x = scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 32
    scene.render.filepath = '/tmp/logan-avatar-preview.png'
    bpy.ops.render.render(write_still=True)
