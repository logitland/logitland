"""Replace staging with an exact production duplicate, then invert only its face.

Run after production art direction. Copies the current pose, camera, geometry,
lights, grading and render settings together, preserving production's appearance.
"""
from pathlib import Path
import runpy
import bpy

HERE = Path(__file__).resolve().parent


def sync_staging():
    """Keep staging's pink character and lighting; invert only screen polarity."""
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
    face_polarity = runpy.run_path(str(HERE/'screen-controls.py'))['dark_features']
    for obj in staging.objects:
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
            nodes = material.node_tree.nodes
            if 'Face · 2D CRT display' in source.name:
                crt = next(n for n in nodes if n.type == 'GROUP' and n.node_tree.name == 'LOGAN / CRT display')
                face_polarity(material,crt)
    staging.compositing_node_group = production.compositing_node_group.copy()
    for node in staging.compositing_node_group.nodes:
        if node.type == 'R_LAYERS':
            node.scene = staging
    staging.render.filepath = str(HERE/'renders/logan-staging-avatar.png')
    staging['portrait_notes'] = 'Production character, pink accents, lighting and framing; only the face is inverted to pink on black.'
    bpy.context.window.scene = production
    bpy.context.view_layer.update()
    return staging


if __name__ == '__main__':
    sync_staging()
