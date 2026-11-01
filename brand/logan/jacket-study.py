"""Extract the jacket into its own editable, poseable Blender file.

blender --background --python jacket-study.py [-- SOURCE.blend]
The source master is read without saving changes to it.
"""
from pathlib import Path
import sys

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
source = Path(sys.argv[sys.argv.index('--') + 1]) if '--' in sys.argv else HERE / 'logan.blend'
bpy.ops.wm.open_mainfile(filepath=str(source))
scene = bpy.data.scenes['LOGAN']
scene.frame_set(1)
prefixes = ('Jacket /', 'Collar /', 'Sleeve /', 'Cuff /')
for obj in list(scene.objects):
    if not (obj.name.startswith(prefixes + ('Studio /', 'Camera /', 'Reference /'))
            or obj.type == 'ARMATURE'):
        bpy.data.objects.remove(obj, do_unlink=True)
garment = [o for o in scene.objects if o.type == 'MESH' and o.name.startswith(prefixes)]
assert len(garment) in (4, 6), 'Expected torso, collar, cuffs and optionally separate legacy sleeves'
scene.name = 'JACKET STUDY'
if 'approved_head' in scene:
    del scene['approved_head']
bpy.data.objects['Studio / floor'].hide_render = True
bpy.data.objects['Studio / floor'].hide_set(True)

# Keep the master's lighting, with a neutral background for the isolated garment.
nodes = scene.world.node_tree.nodes
links = scene.world.node_tree.links
background = nodes.new('ShaderNodeBackground')
background.inputs['Color'].default_value = (.44, .45, .48, 1)
background.inputs['Strength'].default_value = 1.2
path = nodes.new('ShaderNodeLightPath')
mix = nodes.new('ShaderNodeMixShader')
links.new(path.outputs['Is Camera Ray'], mix.inputs[0])
links.new(nodes['Background'].outputs[0], mix.inputs[1])
links.new(background.outputs[0], mix.inputs[2])
links.new(mix.outputs[0], nodes['World Output'].inputs['Surface'])

bpy.context.view_layer.update()
points = [obj.matrix_world @ Vector(corner) for obj in garment for corner in obj.bound_box]
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
target = (low + high) / 2
camera = scene.camera
camera.location = target + Vector((4, -12, 3))
camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.ortho_scale = max(high - low) * 1.18
scene.render.resolution_x = scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.render.filepath = str(HERE / 'renders/jacket-three-quarter.png')
scene.render.film_transparent = False

notes = bpy.data.texts['START HERE · Logan']
notes.name = 'START HERE · Jacket study'
notes.clear()
notes.write('''JACKET STUDY

Torso, collar, sleeves and cuffs, isolated from the full-body master.
The coat's logo, pocket hems, seams and sleeve lining remain editable.
The original rig and continuous sleeve weights are retained: frame 1 is neutral,
frame 40 bends the raised sleeve. Enable Overlays to select the rig in Pose Mode.
Edit this file directly; jacket-study.py extracts a fresh copy of the master.
F12 renders the jacket. Changes here do not change logan.blend.
''')
bpy.ops.object.select_all(action='DESELECT')
torso = bpy.data.objects['Jacket / torso']
torso.select_set(True)
bpy.context.view_layer.objects.active = torso
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            space = area.spaces.active
            space.region_3d.view_perspective = 'CAMERA'
            space.region_3d.view_camera_zoom = 0
            space.region_3d.view_camera_offset = (0, 0)
            space.overlay.show_overlays = False
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / 'jacket-study.blend'), compress=True)
