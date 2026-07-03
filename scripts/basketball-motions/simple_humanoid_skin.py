"""
Create a simple skinned humanoid mesh for skeleton-only BVH/FBX motion files.

Run with Blender:

  blender --background --python scripts/basketball-motions/simple_humanoid_skin.py -- \
    --input imgs/basketball-motions/cmu-fbx \
    --output-dir imgs/basketball-motions/skinned-glb \
    --format glb
"""

import argparse
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


SEGMENTS = 10
SPHERE_LAT = 5
SPHERE_LON = 10


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Input BVH/FBX file or directory.")
    parser.add_argument("--output-dir", required=True, help="Directory for exported files.")
    parser.add_argument("--format", choices=("glb", "fbx", "blend"), default="glb")
    parser.add_argument("--scale", type=float, default=1.0)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_motion(file_path: Path, scale: float) -> None:
    suffix = file_path.suffix.lower()
    if suffix == ".bvh":
        bpy.ops.import_anim.bvh(
            filepath=str(file_path),
            global_scale=scale,
            rotate_mode="NATIVE",
        )
        return

    if suffix == ".fbx":
        bpy.ops.import_scene.fbx(
            filepath=str(file_path),
            global_scale=scale,
            automatic_bone_orientation=False,
        )
        return

    raise ValueError(f"Unsupported input file: {file_path}")


def find_armature() -> bpy.types.Object:
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("No armature found after import.")
    return max(armatures, key=lambda obj: len(obj.data.bones))


def normalized(value: str) -> str:
    return value.lower().replace("_", "").replace(" ", "")


def should_skin_bone(bone_name: str, length: float) -> bool:
    name = normalized(bone_name)
    if length <= 0.001:
        return False
    if "finger" in name or "thumb" in name:
        return False
    if name.endswith("joint"):
        return False
    return any(
        key in name
        for key in (
            "hip",
            "spine",
            "back",
            "neck",
            "head",
            "leg",
            "foot",
            "toe",
            "shoulder",
            "arm",
            "forearm",
            "hand",
        )
    )


def radius_for_bone(bone_name: str, length: float) -> float:
    name = normalized(bone_name)
    base = max(length * 0.12, 0.035)

    if "head" in name:
        return max(length * 0.8, 0.16)
    if "neck" in name:
        return max(base * 0.75, 0.045)
    if "spine" in name or "back" in name or name == "hips":
        return max(base * 1.35, 0.11)
    if "upleg" in name or name.endswith("leg"):
        return max(base * 0.85, 0.075)
    if "foot" in name or "toe" in name:
        return max(base * 0.75, 0.055)
    if "shoulder" in name:
        return max(base * 0.7, 0.045)
    if "arm" in name:
        return max(base * 0.65, 0.055)
    if "forearm" in name:
        return max(base * 0.55, 0.045)
    if "hand" in name:
        return max(base * 0.8, 0.06)
    return base


def basis_for_segment(start: Vector, end: Vector) -> tuple[Vector, Vector, Vector]:
    axis = end - start
    length = axis.length
    if length == 0:
        raise ValueError("Cannot create basis for zero-length segment.")

    w = axis.normalized()
    helper = Vector((0, 0, 1))
    if abs(w.dot(helper)) > 0.92:
        helper = Vector((1, 0, 0))
    u = w.cross(helper).normalized()
    v = w.cross(u).normalized()
    return u, v, w


def add_cylinder(
    verts: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    groups: list[str],
    start: Vector,
    end: Vector,
    radius: float,
    group_name: str,
) -> None:
    u, v, _ = basis_for_segment(start, end)
    start_index = len(verts)

    for center in (start, end):
        for index in range(SEGMENTS):
            angle = math.tau * index / SEGMENTS
            point = center + radius * math.cos(angle) * u + radius * math.sin(angle) * v
            verts.append(tuple(point))
            groups.append(group_name)

    for index in range(SEGMENTS):
        a = start_index + index
        b = start_index + (index + 1) % SEGMENTS
        c = start_index + SEGMENTS + (index + 1) % SEGMENTS
        d = start_index + SEGMENTS + index
        faces.append((a, b, c, d))

    faces.append(tuple(start_index + index for index in reversed(range(SEGMENTS))))
    faces.append(tuple(start_index + SEGMENTS + index for index in range(SEGMENTS)))


def add_sphere(
    verts: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    groups: list[str],
    center: Vector,
    radius: float,
    group_name: str,
) -> None:
    start_index = len(verts)
    for lat in range(SPHERE_LAT + 1):
        theta = math.pi * lat / SPHERE_LAT
        z = math.cos(theta)
        ring_radius = math.sin(theta)
        for lon in range(SPHERE_LON):
            phi = math.tau * lon / SPHERE_LON
            point = center + radius * Vector((ring_radius * math.cos(phi), ring_radius * math.sin(phi), z))
            verts.append(tuple(point))
            groups.append(group_name)

    for lat in range(SPHERE_LAT):
        for lon in range(SPHERE_LON):
            a = start_index + lat * SPHERE_LON + lon
            b = start_index + lat * SPHERE_LON + (lon + 1) % SPHERE_LON
            c = start_index + (lat + 1) * SPHERE_LON + (lon + 1) % SPHERE_LON
            d = start_index + (lat + 1) * SPHERE_LON + lon
            faces.append((a, b, c, d))


def create_humanoid_mesh(armature: bpy.types.Object) -> bpy.types.Object:
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    vertex_groups: list[str] = []
    terminal_markers: list[tuple[Vector, float, str]] = []

    for bone in armature.data.bones:
        start = bone.head_local.copy()
        end = bone.tail_local.copy()
        length = (end - start).length
        if not should_skin_bone(bone.name, length):
            continue

        radius = radius_for_bone(bone.name, length)
        add_cylinder(verts, faces, vertex_groups, start, end, radius, bone.name)

        name = normalized(bone.name)
        if any(key in name for key in ("head", "hand", "foot", "toe")):
            terminal_markers.append((end, radius * (1.45 if "head" in name else 1.2), bone.name))

    for center, radius, group_name in terminal_markers:
        add_sphere(verts, faces, vertex_groups, center, radius, group_name)

    mesh = bpy.data.meshes.new("simple_humanoid_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    mesh_obj = bpy.data.objects.new("Simple_Humanoid_Skin", mesh)
    bpy.context.collection.objects.link(mesh_obj)

    material = bpy.data.materials.new("simple_skin_warm_gray")
    material.diffuse_color = (0.72, 0.70, 0.66, 1.0)
    mesh_obj.data.materials.append(material)

    for bone in armature.data.bones:
        mesh_obj.vertex_groups.new(name=bone.name)

    for index, group_name in enumerate(vertex_groups):
        group = mesh_obj.vertex_groups.get(group_name)
        if group:
            group.add([index], 1.0, "REPLACE")

    mesh_obj.parent = armature
    modifier = mesh_obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = armature

    armature.show_in_front = True
    return mesh_obj


def export_scene(output_path: Path, export_format: str, armature: bpy.types.Object, mesh_obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj

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


def input_files(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path]
    return sorted(
        file_path
        for file_path in input_path.rglob("*")
        if file_path.suffix.lower() in {".bvh", ".fbx"}
    )


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_dir = Path(args.output_dir).resolve()
    files = input_files(input_path)

    if not files:
        raise RuntimeError(f"No BVH/FBX files found under {input_path}")

    for file_path in files:
        clear_scene()
        import_motion(file_path, args.scale)
        armature = find_armature()
        mesh_obj = create_humanoid_mesh(armature)
        suffix = {"glb": ".glb", "fbx": ".fbx", "blend": ".blend"}[args.format]
        output_path = output_dir / f"{file_path.stem}_simple_humanoid{suffix}"
        export_scene(output_path, args.format, armature, mesh_obj)
        print(f"Exported {output_path}")


if __name__ == "__main__":
    main()
