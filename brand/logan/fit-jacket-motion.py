"""Let raised arms draw fabric from the coat body and slide sleeves up the wrists.

Pose-driven tailoring, not a cloth simulation. Keeps the approved resting mesh;
smooth armhole skinning distributes tension before the corrective shapes lift it.
"""
from math import radians
import bpy
from mathutils import Matrix, Vector

scene = bpy.data.scenes['LOGAN']
rig = bpy.data.objects['LOGAN · Pose me']
jacket = bpy.data.objects['Jacket / torso']
scene.frame_set(1)
for modifier in jacket.modifiers:
    if modifier.type=='ARMATURE':
        modifier.use_deform_preserve_volume = True


def smoothstep(low, high, value):
    t = max(0, min(1, (value-low)/(high-low)))
    return t*t*(3-2*t)


# The sewn/unioned armhole inherited abrupt weights across very short edges.
# Diffuse only its shoulder transition; preserve the spine, hem and elbow bends.
names = ['torso', 'upper_arm.L', 'forearm.L', 'upper_arm.R', 'forearm.R']
groups = [jacket.vertex_groups[name] for name in names]
weights = []
for group in groups:
    name = 'Rest weights / '+group.name
    attribute = jacket.data.attributes.get(name)
    if attribute is None:
        attribute = jacket.data.attributes.new(name, 'FLOAT', 'POINT')
        for vertex in jacket.data.vertices:
            attribute.data[vertex.index].value = next((g.weight for g in vertex.groups if g.group==group.index), 0)
    weights.append([v.value for v in attribute.data])
neighbors = [[] for vertex in jacket.data.vertices]
for edge in jacket.data.edges:
    a, b = edge.vertices
    distance = (jacket.data.vertices[a].co-jacket.data.vertices[b].co).length
    conductance = 1/max(.02, distance)
    neighbors[a].append((b, conductance))
    neighbors[b].append((a, conductance))
for side, sign in (('L', 1), ('R', -1)):
    upper_index = names.index('upper_arm.'+side)
    lower_index = names.index('forearm.'+side)
    # Preserve elbow skinning: only redistribute the torso/upper-arm share.
    # The distal sleeve is an anchor, so smoothing cannot drag it back to the
    # chest and concentrate a new stretch farther down the arm.
    values = [u/(u+t) if u+t>1e-6 else 1
              for u,t in zip(weights[upper_index], weights[0])]
    transition = [v.index for v in jacket.data.vertices
                  if .45<sign*v.co.x<1.25 and 3.35<v.co.z<5.15]
    for iteration in range(240):
        updated = values.copy()
        for index in transition:
            adjacent = neighbors[index]
            updated[index] = sum(values[j]*w for j,w in adjacent)/sum(w for j,w in adjacent)
        values = updated
    for index in transition:
        share = 1-weights[lower_index][index]
        weights[upper_index][index] = share*values[index]
        weights[0][index] = share*(1-values[index])
for group, values in zip(groups, weights):
    for index, value in enumerate(values):
        group.add([index], value, 'REPLACE')


def corrective(obj, name, displacement, side):
    """Replace a rest-space cloth correction and drive it from shoulder elevation."""
    if not obj.data.shape_keys:
        obj.shape_key_add(name='Basis')
    basis = obj.data.shape_keys.key_blocks['Basis']
    key = obj.data.shape_keys.key_blocks.get(name) or obj.shape_key_add(name=name)
    for index, point in enumerate(basis.data):
        key.data[index].co = point.co+displacement(index, point.co)
    driver = key.driver_add('value').driver
    driver.type = 'SCRIPTED'
    raised = 'max(0,rz)' if side=='L' else 'max(0,-rz)'
    driver.expression = f'min(1,max(0,(sqrt(rx*rx+{raised}*{raised})-0.174533)/1.186824))'
    while driver.variables:
        driver.variables.remove(driver.variables[0])
    for name, axis in (('rx', 'ROT_X'), ('rz', 'ROT_Z')):
        variable = driver.variables.new()
        variable.name = name
        variable.type = 'TRANSFORMS'
        target = variable.targets[0]
        target.id = rig
        target.bone_target = 'upper_arm.'+side
        target.transform_type = axis
        target.transform_space = 'LOCAL_SPACE'
        target.rotation_mode = 'XYZ'


for side, sign in (('L', 1), ('R', -1)):
    upper = rig.data.bones['upper_arm.'+side]
    lower = rig.data.bones['forearm.'+side]
    upper_axis = (upper.tail_local-upper.head_local).normalized()
    lower_axis = (lower.tail_local-lower.head_local).normalized()
    upper_weights = weights[names.index(upper.name)]
    lower_weights = weights[names.index(lower.name)]

    def displacement(index, point):
        body = weights[0][index]
        side_amount = smoothstep(-.25, 1.0, sign*point.x)
        below_collar = 1-smoothstep(4.65, 5.12, point.z)
        lift = (.13+.15*smoothstep(3.05, 4.2, point.z))*side_amount*below_collar*body
        # Feed cloth up the arm rather than extending its shoulder-to-cuff span.
        progress = smoothstep(0, (lower.tail_local-upper.head_local).length,
                              (point-upper.head_local).dot((lower.tail_local-upper.head_local).normalized()))
        slide = (upper_axis*upper_weights[index]+lower_axis*lower_weights[index])*(-.12*progress)
        return Vector((0,0,lift))+slide

    corrective(jacket, 'Raised arm cloth / '+side, displacement, side)
    cuff = bpy.data.objects['Cuff / band.'+side]
    slide = cuff.matrix_world.inverted().to_3x3() @ (-lower_axis*.12)
    corrective(cuff, 'Sleeve ride / '+side, lambda index, point: slide, side)

# Sculpt a tension-limited correction at the raised pose. Target 12 percent
# edge extension; excess draw propagates through adjacent cloth instead of being
# absorbed by the small armhole faces. The solved shape remains editable.
action = rig.animation_data.action
rig.animation_data.action = None
rest_pose = {bone.name: bone.matrix_basis.copy() for bone in rig.pose.bones}
enabled = {modifier.name: modifier.show_viewport for modifier in jacket.modifiers}
for modifier in jacket.modifiers:
    modifier.show_viewport = modifier.type=='ARMATURE'
probe = jacket.shape_key_add(name='Temporary deformation probe', from_mix=False)
probe.value = 0
basis = jacket.data.shape_keys.key_blocks['Basis']
links = {tuple(sorted(edge.vertices)) for edge in jacket.data.edges}
for face in jacket.data.polygons:
    if len(face.vertices)==4:
        a,b,c,d = face.vertices
        links.update((tuple(sorted((a,c))),tuple(sorted((b,d)))))
edges = [(a,b,(basis.data[a].co-basis.data[b].co).length) for a,b in sorted(links)]


def evaluated_points():
    jacket.data.update()
    jacket.data.shape_keys.update_tag()
    jacket.update_tag(refresh={'DATA'})
    rig.update_tag()
    bpy.context.view_layer.update()
    evaluated = jacket.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return [v.co.copy() for v in evaluated.data.vertices]


try:
    for side, sign in (('L',1),('R',-1)):
        for name, matrix in rest_pose.items():
            rig.pose.bones[name].matrix_basis = matrix
        rig.pose.bones['upper_arm.'+side].rotation_euler.z = radians(sign*78)
        rig.pose.bones['forearm.'+side].rotation_euler.z = radians(sign*38)
        initial = evaluated_points()
        points = [p.copy() for p in initial]
        mobility = []
        lower = rig.data.bones['forearm.'+side]
        lower_axis = (lower.tail_local-lower.head_local).normalized()
        sleeve_weights = [a.value+b.value for a,b in zip(
            jacket.data.attributes['Rest weights / upper_arm.'+side].data,
            jacket.data.attributes['Rest weights / forearm.'+side].data)]
        for vertex in jacket.data.vertices:
            p = vertex.co
            move = smoothstep(-.15,.70,sign*p.x)*(1-smoothstep(1.65,1.90,sign*p.x))
            move *= 1-smoothstep(4.75,5.12,p.z)*(1-smoothstep(.65,1.1,abs(p.x)))
            # Let whole sleeve sections travel; pinning their inner vertices
            # traps all remaining tension in the last mobile armhole row.
            move *= 1-.65*smoothstep(.20,.80,sleeve_weights[vertex.index])
            if weights[names.index(lower.name)][vertex.index]>.5:
                move *= 1-smoothstep(.35,.80,(p-lower.head_local).dot(lower_axis)/lower.length)
            mobility.append(move)
        # Cross-section braces keep the sleeve broad while its centre can slide.
        # Use opposite points in the same rest-space section, including pairs
        # that are not mesh edges, so the solver cannot flatten a fabric tube.
        upper = rig.data.bones['upper_arm.'+side]
        axis = (lower.tail_local-upper.head_local).normalized()
        sleeve = [i for i,w in enumerate(sleeve_weights) if w>.8]
        braces = []
        for offset,a in enumerate(sleeve):
            for b in sleeve[offset+1:]:
                delta = basis.data[b].co-basis.data[a].co
                if abs(delta.dot(axis))<.055 and delta.length>.20:
                    braces.append((a,b,(initial[b]-initial[a]).length))
        iterations = 1200
        for iteration in range(iterations):
            for a,b,rest_length in edges:
                delta = points[b]-points[a]
                length = delta.length
                total = mobility[a]+mobility[b]
                limit = rest_length*1.12
                if length<=limit or total<1e-8:
                    continue
                correction = delta*((length-limit)/(length*total))
                points[a] += correction*mobility[a]
                points[b] -= correction*mobility[b]
            for a,b,width in braces:
                delta = points[b]-points[a]
                length = delta.length
                total = mobility[a]+mobility[b]
                if total<1e-8 or length<1e-8:
                    continue
                if length>=width*.95:
                    continue
                correction = delta*((length-width*.95)/(length*total))
                points[a] += correction*mobility[a]
                points[b] -= correction*mobility[b]
            if iteration<350:
                for index, move in enumerate(mobility):
                    points[index] = points[index].lerp(initial[index], .005*move)
            # Spread each correction into adjacent loops while solving, rather
            # than concentrating it into narrow folds that spike the lining.
            offsets = [p-q for p,q in zip(points,initial)]
            for index, move in enumerate(mobility):
                if move<=0:
                    continue
                adjacent = neighbors[index]
                average = sum((offsets[j]*w for j,w in adjacent), Vector())/sum(w for j,w in adjacent)
                points[index] = initial[index]+offsets[index].lerp(average,.12*max(0,1-iteration/600))
        # Boolean seam fragments are much smaller than neighbouring cloth
        # panels. Fair the displacement field so they do not become sharp
        # puckers when the length constraints pull the side of the coat up.
        for iteration in range(24):
            offsets = [p-q for p,q in zip(points,initial)]
            for index, move in enumerate(mobility):
                adjacent = neighbors[index]
                average = sum((offsets[j]*w for j,w in adjacent), Vector())/sum(w for j,w in adjacent)
                points[index] = initial[index]+offsets[index].lerp(average,.35*move)
        # Armature skinning is affine per vertex. Probe its three basis vectors
        # to map the posed displacement back into a rest-space shape key, also
        # supporting the existing dual-quaternion volume-preserving modifier.
        axes = []
        for axis in range(3):
            offset = Vector((0,0,0))
            offset[axis] = .01
            for index, point in enumerate(basis.data):
                probe.data[index].co = point.co+offset
            probe.value = 1
            axes.append([(p-q)/.01 for p,q in zip(evaluated_points(), initial)])
        probe.value = 0
        key = jacket.data.shape_keys.key_blocks['Raised arm cloth / '+side]
        for index, point in enumerate(key.data):
            transform = Matrix([axis[index] for axis in axes]).transposed()
            assert abs(transform.determinant())>.2, f'Degenerate deformation probe at {index}: {transform}, weights {[w[index] for w in weights]}'
            point.co += transform.inverted() @ (points[index]-initial[index])
        actual = evaluated_points()
        residual = max((a-b).length for a,b in zip(actual,points))
        assert residual<.001, f'Arm {side}: cloth correction mapping error {residual:.6f}'
        print(f'Arm {side}: spread cloth tension through {sum(m>0 for m in mobility)} vertices')
finally:
    jacket.shape_key_remove(probe)
    for modifier in jacket.modifiers:
        modifier.show_viewport = enabled[modifier.name]
    for name, matrix in rest_pose.items():
        rig.pose.bones[name].matrix_basis = matrix
    rig.animation_data.action = action
    scene.frame_set(1)

scene['jacket_motion'] = True
rig.update_tag()
bpy.context.view_layer.update()
print('Distributed armhole weights; added driven coat lift and sleeve ride')

