"""Fit the current portrait's backdrop without changing its camera or character.

Camera parenting follows translation and rotation; scale drivers follow focal
length. Re-run after changing sensor fit, lens shift or render aspect ratio.
Does not save the file.
"""
import bpy
from mathutils import Matrix


def fit_background(scene):
    """Cover the active camera frame with the image plate, preserving its aspect."""
    camera = scene.camera
    plate = next(o for o in scene.objects if o.name.startswith('Portrait / command room'))
    distance, overscan = 23.0, 1.08
    corners = [v*(-distance/v.z) for v in camera.data.view_frame(scene=scene)]
    xmin, xmax = min(v.x for v in corners), max(v.x for v in corners)
    ymin, ymax = min(v.y for v in corners), max(v.y for v in corners)
    texture = next(n for n in plate.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE')
    aspect = texture.image.size[0]/texture.image.size[1]
    half_y = max((ymax-ymin)/2, (xmax-xmin)/(2*aspect))*overscan
    half_x = half_y*aspect
    if plate.data.users > 1:
        plate.data = plate.data.copy()
    for vertex, coordinate in zip(plate.data.vertices, [(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)]):
        vertex.co = coordinate
    plate.data.update()
    plate.parent = camera
    plate.matrix_parent_inverse = Matrix.Identity(4)
    plate.matrix_basis = Matrix.Identity(4)
    plate.location = ((xmin+xmax)/2, (ymin+ymax)/2, -distance)
    plate['frame_lens'] = camera.data.lens
    for axis, half in enumerate((half_x, half_y)):
        plate.driver_remove('scale', axis)
        driver = plate.driver_add('scale', axis).driver
        driver.type = 'SCRIPTED'
        driver.expression = f'{half!r} * {camera.data.lens!r} / lens'
        variable = driver.variables.new()
        variable.name = 'lens'
        variable.targets[0].id_type = 'CAMERA'
        variable.targets[0].id = camera.data
        variable.targets[0].data_path = 'lens'
    plate.update_tag()
    bpy.context.view_layer.update()
    return plate


if __name__ == '__main__':
    fit_background(bpy.context.scene)
