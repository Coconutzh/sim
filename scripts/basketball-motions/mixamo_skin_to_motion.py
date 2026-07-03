"""
Bind a real Mixamo with-skin mesh to skeleton-only BVH/FBX motion files.

This keeps the target motion armature/animation and uses Blender automatic
weights to skin a Mixamo humanoid mesh onto that armature.
"""

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True, help="Mixamo with-skin FBX template.")
    parser.add_argument("--input", required=True, help="Target skeleton-only BVH/FBX file or directory.")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--format", choices=("glb", "fbx", "blend"), default="glb")
    parser.add_argument("--scale", type=float, default=1.0)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_motion(file_path: Path, scale: float) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    suffix = file_path.suffix.lower()
    if suffix == ".bvh":
        bpy.ops.import_anim.bvh(filepath=str(file_path), global_scale=scale, rotate_mode="NATIVE")
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(file_path), global_scale=scale, automatic_bone_orientation=False)
    else:
        raise ValueError(f"Unsupported file: {file_path}")
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def find_largest_armature(objects: list[bpy.types.Object]) -> bpy.types.Object:
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


def world_bbox_points(objects: list[bpy.types.Object]) -> list[Vector]:
    points: list[Vector] = []
    for obj in objects:
        if obj.type == "MESH":
            points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    return points


def armature_rest_points(armature: bpy.types.Object) -> list[Vector]:
    return [
        armature.matrix_world @ point
        for bone in armature.data.bones
        for point in (bone.head_local, bone.tail_local)
    ]


def bbox_center_and_height(points: list[Vector]) -> tuple[Vector, float, float]:
    if not points:
        raise RuntimeError("Cannot compute empty bounding box.")
    min_x = min(point.x for point in points)
    max_x = max(point.x for point in points)
    min_y = min(point.y for point in points)
    max_y = max(point.y for point in points)
    min_z = min(point.z for point in points)
    max_z = max(point.z for point in points)
    center = Vector(((min_x + max_x) * 0.5, (min_y + max_y) * 0.5, (min_z + max_z) * 0.5))
    return center, max(max_z - min_z, 0.001), min_z


def detach_template_meshes(
    template_objects: list[bpy.types.Object],
    template_actions: list[bpy.types.Action],
) -> list[bpy.types.Object]:
    armatures = [obj for obj in template_objects if obj.type == "ARMATURE"]
    for armature in armatures:
        armature.data.pose_position = "REST"
    bpy.context.view_layer.update()

    mesh_objects = [obj for obj in template_objects if obj.type == "MESH"]
    if not mesh_objects:
        raise RuntimeError("Template contains no mesh objects.")

    for mesh_obj in mesh_objects:
        mesh_obj.animation_data_clear()
        world = mesh_obj.matrix_world.copy()
        mesh_obj.parent = None
        mesh_obj.matrix_world = world
        for modifier in list(mesh_obj.modifiers):
            if modifier.type == "ARMATURE":
                mesh_obj.modifiers.remove(modifier)
        mesh_obj.vertex_groups.clear()

    for obj in armatures:
        obj.animation_data_clear()
        bpy.data.objects.remove(obj, do_unlink=True)

    for action in template_actions:
        bpy.data.actions.remove(action, do_unlink=True)

    return mesh_objects


def align_template_to_target(mesh_objects: list[bpy.types.Object], target_armature: bpy.types.Object) -> None:
    target_center, target_height, target_floor = bbox_center_and_height(armature_rest_points(target_armature))
    mesh_center, mesh_height, mesh_floor = bbox_center_and_height(world_bbox_points(mesh_objects))
    scale = target_height / mesh_height
    offset = Vector((target_center.x, target_center.y, target_floor)) - Vector(
        (mesh_center.x * scale, mesh_center.y * scale, mesh_floor * scale)
    )
    transform = Matrix.Translation(offset) @ Matrix.Scale(scale, 4)

    for mesh_obj in mesh_objects:
        mesh_obj.matrix_world = transform @ mesh_obj.matrix_world


def bind_meshes_to_armature(mesh_objects: list[bpy.types.Object], armature: bpy.types.Object) -> None:
    armature.data.pose_position = "REST"
    bpy.context.view_layer.update()

    bpy.ops.object.select_all(action="DESELECT")
    for mesh_obj in mesh_objects:
        mesh_obj.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    armature.data.pose_position = "POSE"
    bpy.context.view_layer.update()


def export_scene(
    output_path: Path,
    export_format: str,
    armature: bpy.types.Object,
    mesh_objects: list[bpy.types.Object],
) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for mesh_obj in mesh_objects:
        mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
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


def process_file(template_path: Path, target_path: Path, output_dir: Path, export_format: str, scale: float) -> Path:
    clear_scene()
    target_objects = import_motion(target_path, scale)
    target_armature = find_largest_armature(target_objects)
    target_armature.name = "Basketball_Motion_Armature"

    actions_before_template = set(bpy.data.actions)
    template_objects = import_motion(template_path, 1.0)
    template_actions = [action for action in bpy.data.actions if action not in actions_before_template]
    template_meshes = detach_template_meshes(template_objects, template_actions)
    align_template_to_target(template_meshes, target_armature)
    bind_meshes_to_armature(template_meshes, target_armature)

    suffix = {"glb": ".glb", "fbx": ".fbx", "blend": ".blend"}[export_format]
    output_path = output_dir / f"{target_path.stem}_mixamo_skin{suffix}"
    export_scene(output_path, export_format, target_armature, template_meshes)
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

    for target_path in files:
        output_path = process_file(template_path, target_path, output_dir, args.format, args.scale)
        print(f"Exported {output_path}")


if __name__ == "__main__":
    main()
