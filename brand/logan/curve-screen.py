"""Give the existing screen shallow CRT curvature while keeping its rim seated.

Only the front quad is gridded. Its UVs and head weights interpolate across
the new vertices, so the artwork, raster and glass remain one surface. The
shape key returns to flat at zero and is adjustable independently of the rig.
"""
import bmesh
import bpy

KEY = 'CRT glass / shallow bulge'
DEPTH = .045


def curve_screen():
    """Bow the glass center outward 4.5 cm across its 1.77 m visible width."""
    obj = bpy.data.scenes['AVATAR · Production'].objects['Screen / glass']
    if obj.data.shape_keys and KEY in obj.data.shape_keys.key_blocks:
        return obj
    if obj.data.users > 1:
        obj.data = obj.data.copy()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    front = max((f for f in bm.faces if f.normal.y < -.99),key=lambda f:f.calc_area())
    xmin,xmax = min(v.co.x for v in front.verts),max(v.co.x for v in front.verts)
    zmin,zmax = min(v.co.z for v in front.verts),max(v.co.z for v in front.verts)
    y = front.calc_center_median().y
    bmesh.ops.subdivide_edges(bm,edges=list(front.edges),cuts=31,use_grid_fill=True)
    for face in bm.faces:
        face.smooth = all(abs(v.co.y-y)<1e-6 for v in face.verts)
    for edge in bm.edges:
        if any(f.smooth for f in edge.link_faces) and not all(f.smooth for f in edge.link_faces):
            edge.smooth = False
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    obj.shape_key_add(name='Basis')
    bulge = obj.shape_key_add(name=KEY)
    for point in bulge.data:
        if abs(point.co.y-y)>1e-6:
            continue
        u = (2*point.co.x-xmin-xmax)/(xmax-xmin)
        v = (2*point.co.z-zmin-zmax)/(zmax-zmin)
        point.co.y -= DEPTH*max(0,1-u*u)*max(0,1-v*v)
    bulge.value = 1
    bulge.slider_max = 1.5
    obj['crt_bulge_depth'] = DEPTH
    bpy.context.view_layer.update()
    return obj


if __name__ == '__main__':
    curve_screen()
