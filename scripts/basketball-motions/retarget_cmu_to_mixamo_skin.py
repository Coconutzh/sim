"""
Retarget CMU basketball motion onto an existing Mixamo with-skin armature.

Unlike automatic re-binding, this keeps the original Mixamo mesh, armature, and
vertex weights intact. Only the animation is baked from the CMU source skeleton
onto the Mixamo skeleton.
"""

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


BONE_MAP = {
    "hip": "mixamorig:Hips",
    "abdomen": "mixamorig:Spine",
    "chest": "mixamorig:Spine2",
    "neck": "mixamorig:Neck",
    "head": "mixamorig:Head",
    "rCollar": "mixamorig:RightShoulder",
    "rShldr": "mixamorig:RightArm",
    "rForeArm": "mixamorig:RightForeArm",
    "rHand": "mixamorig:RightHand",
    "rThumb1": "mixamorig:RightHandThumb1",
    "rThumb2": "mixamorig:RightHandThumb2",
    "rIndex1": "mixamorig:RightHandIndex1",
    "rIndex2": "mixamorig:RightHandIndex2",
    "rMid1": "mixamorig:RightHandMiddle1",
    "rMid2": "mixamorig:RightHandMiddle2",
    "rRing1": "mixamorig:RightHandRing1",
    "rRing2": "mixamorig:RightHandRing2",
    "rPinky1": "mixamorig:RightHandPinky1",
    "rPinky2": "mixamorig:RightHandPinky2",
    "lCollar": "mixamorig:LeftShoulder",
    "lShldr": "mixamorig:LeftArm",
    "lForeArm": "mixamorig:LeftForeArm",
    "lHand": "mixamorig:LeftHand",
    "lThumb1": "mixamorig:LeftHandThumb1",
    "lThumb2": "mixamorig:LeftHandThumb2",
    "lIndex1": "mixamorig:LeftHandIndex1",
    "lIndex2": "mixamorig:LeftHandIndex2",
    "lMid1": "mixamorig:LeftHandMiddle1",
    "lMid2": "mixamorig:LeftHandMiddle2",
    "lRing1": "mixamorig:LeftHandRing1",
    "lRing2": "mixamorig:LeftHandRing2",
    "lPinky1": "mixamorig:LeftHandPinky1",
    "lPinky2": "mixamorig:LeftHandPinky2",
    "rThigh": "mixamorig:RightUpLeg",
    "rShin": "mixamorig:RightLeg",
    "rFoot": "mixamorig:RightFoot",
    "lThigh": "mixamorig:LeftUpLeg",
    "lShin": "mixamorig:LeftLeg",
    "lFoot": "mixamorig:LeftFoot",
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--format", choices=("glb", "fbx", "blend"), default="glb")
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--sample-step", type=int, default=1)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_file(file_path: Path, scale: float = 1.0) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    suffix = file_path.suffix.lower()
    if suffix == ".bvh":
        bpy.ops.import_anim.bvh(filepath=str(file_path), global_scale=scale, rotate_mode="NATIVE")
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(file_path), global_scale=scale, automatic_bone_orientation=False)
    else:
        raise ValueError(f"Unsupported file: {file_path}")
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def largest_armature(objects: list[bpy.types.Object]) -> bpy.types.Object:
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("No armature found.")
    return max(armatures, key=lambda obj: len(obj.data.bones))


def input_files(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path]
    return sorted(
        file_path
        for file_path in input_path.rglob("*")
        if file_path.suffix.lower() in {".bvh", ".fbx"}
    )


def armature_height(armature: bpy.types.Object) -> float:
    points = [
        armature.matrix_world @ point
        for bone in armature.data.bones
        for point in (bone.head_local, bone.tail_local)
    ]
    return max((point.z for point in points), default=1.0) - min((point.z for point in points), default=0.0)


def rest_local_matrix(bone: bpy.types.Bone) -> Matrix:
    if bone.parent:
        return bone.parent.matrix_local.inverted() @ bone.matrix_local
    return bone.matrix_local.copy()


def pose_local_matrix(pose_bone: bpy.types.PoseBone) -> Matrix:
    if pose_bone.parent:
        return pose_bone.parent.matrix.inverted() @ pose_bone.matrix
    return pose_bone.matrix.copy()


def source_delta(source_pose_bone: bpy.types.PoseBone) -> Matrix:
    rest_local = rest_local_matrix(source_pose_bone.bone)
    pose_local = pose_local_matrix(source_pose_bone)
    return rest_local.inverted() @ pose_local


def clear_mixamo_animation(mixamo_armature: bpy.types.Object) -> None:
    mixamo_armature.animation_data_clear()
    for pose_bone in mixamo_armature.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.location = (0, 0, 0)
        pose_bone.rotation_quaternion = (1, 0, 0, 0)
        pose_bone.scale = (1, 1, 1)


def bake_animation(
    source_armature: bpy.types.Object,
    mixamo_armature: bpy.types.Object,
    action_name: str,
    sample_step: int,
) -> bpy.types.Action:
    source_action = source_armature.animation_data.action if source_armature.animation_data else None
    if not source_action:
        raise RuntimeError(f"Source armature has no action: {source_armature.name}")

    start, end = (int(value) for value in source_action.frame_range)
    bpy.context.scene.frame_start = start
    bpy.context.scene.frame_end = end

    clear_mixamo_animation(mixamo_armature)
    mixamo_armature.animation_data_create()
    retarget_action = bpy.data.actions.new(action_name)
    mixamo_armature.animation_data.action = retarget_action

    height_scale = armature_height(mixamo_armature) / max(armature_height(source_armature), 0.001)

    for frame in range(start, end + 1, max(sample_step, 1)):
        bpy.context.scene.frame_set(frame)

        for pose_bone in mixamo_armature.pose.bones:
            pose_bone.location = (0, 0, 0)
            pose_bone.rotation_quaternion = (1, 0, 0, 0)
            pose_bone.scale = (1, 1, 1)

        for source_name, target_name in BONE_MAP.items():
            source_pose = source_armature.pose.bones.get(source_name)
            target_pose = mixamo_armature.pose.bones.get(target_name)
            if not source_pose or not target_pose:
                continue

            delta = source_delta(source_pose)
            if source_name == "hip":
                delta.translation *= height_scale
            else:
                delta.translation = Vector((0, 0, 0))

            target_pose.matrix_basis = delta
            if source_name == "hip":
                target_pose.keyframe_insert(data_path="location", frame=frame)
            target_pose.keyframe_insert(data_path="rotation_quaternion", frame=frame)
            target_pose.keyframe_insert(data_path="scale", frame=frame)

    return retarget_action


def remove_objects(objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        obj.animation_data_clear()
        bpy.data.objects.remove(obj, do_unlink=True)


def keep_only_action(action_to_keep: bpy.types.Action) -> None:
    for action in list(bpy.data.actions):
        if action != action_to_keep:
            bpy.data.actions.remove(action, do_unlink=True)


def export_scene(output_path: Path, export_format: str, keep_objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in keep_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = keep_objects[0]
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if export_format == "glb":
        bpy.ops.export_scene.gltf(
            filepath=str(output_path),
            export_format="GLB",
            use_selection=True,
            export_skins=True,
            export_animations=True,
        )
    elif export_format == "fbx":
        bpy.ops.export_scene.fbx(
            filepath=str(output_path),
            use_selection=True,
            add_leaf_bones=False,
            bake_anim=True,
        )
    elif export_format == "blend":
        bpy.ops.wm.save_as_mainfile(filepath=str(output_path))
    else:
        raise ValueError(f"Unsupported export format: {export_format}")


def process_file(
    template_path: Path,
    source_path: Path,
    output_dir: Path,
    export_format: str,
    scale: float,
    sample_step: int,
) -> Path:
    clear_scene()
    actions_before_template = set(bpy.data.actions)
    template_objects = import_file(template_path, 1.0)
    template_actions = [action for action in bpy.data.actions if action not in actions_before_template]
    mixamo_armature = largest_armature(template_objects)
    mixamo_meshes = [obj for obj in template_objects if obj.type == "MESH"]
    if not mixamo_meshes:
        raise RuntimeError("Mixamo template has no mesh.")

    clear_mixamo_animation(mixamo_armature)
    for action in template_actions:
        bpy.data.actions.remove(action, do_unlink=True)

    actions_before_source = set(bpy.data.actions)
    source_objects = import_file(source_path, scale)
    source_actions = [action for action in bpy.data.actions if action not in actions_before_source]
    source_armature = largest_armature(source_objects)
    retarget_action = bake_animation(source_armature, mixamo_armature, source_path.stem, sample_step)
    remove_objects(source_objects)
    for action in source_actions:
        if bpy.data.actions.get(action.name):
            bpy.data.actions.remove(action, do_unlink=True)
    keep_only_action(retarget_action)

    suffix = {"glb": ".glb", "fbx": ".fbx", "blend": ".blend"}[export_format]
    output_path = output_dir / f"{source_path.stem}_mixamo_retarget{suffix}"
    export_scene(output_path, export_format, [mixamo_armature, *mixamo_meshes])
    return output_path


def main() -> None:
    args = parse_args()
    template_path = Path(args.template).resolve()
    input_path = Path(args.input).resolve()
    output_dir = Path(args.output_dir).resolve()
    files = input_files(input_path)

    if not template_path.exists():
        raise RuntimeError(f"Template does not exist: {template_path}")
    if not files:
        raise RuntimeError(f"No BVH/FBX files found under {input_path}")

    for source_path in files:
        output_path = process_file(
            template_path,
            source_path,
            output_dir,
            args.format,
            args.scale,
            args.sample_step,
        )
        print(f"Exported {output_path}")


if __name__ == "__main__":
    main()
