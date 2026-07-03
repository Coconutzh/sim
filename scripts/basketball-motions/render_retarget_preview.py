"""Render a preview frame for a generated basketball GLB."""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--frame", type=int, default=-1)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def animation_range() -> tuple[int, int]:
    start = 1
    end = 1
    found_action = False
    for obj in bpy.context.scene.objects:
        if not obj.animation_data or not obj.animation_data.action:
            continue
        action_start, action_end = obj.animation_data.action.frame_range
        start = min(start, int(action_start))
        end = max(end, int(action_end))
        found_action = True
    return (start, end) if found_action else (1, 1)


def mesh_bounds() -> tuple[Vector, float, float, float]:
    points = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))

    if not points:
        return Vector((0, 0, 1)), 0, 2, 2

    center = sum(points, Vector()) / len(points)
    min_z = min(point.z for point in points)
    max_z = max(point.z for point in points)
    radius = max((point - center).length for point in points)
    return center, min_z, max_z, radius


def apply_preview_material() -> None:
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        material = bpy.data.materials.new(f"{obj.name}_preview_mat")
        material.diffuse_color = (0.9, 0.38, 0.32, 1.0)
        obj.data.materials.clear()
        obj.data.materials.append(material)


def setup_camera(center: Vector, min_z: float, max_z: float, radius: float) -> None:
    bpy.ops.object.light_add(type="AREA", location=(0, -4, 5))
    light = bpy.context.object
    light.data.energy = 550
    light.data.size = 5

    bpy.ops.object.camera_add(
        location=(center.x + radius * 1.4, center.y - radius * 3.0, center.z + radius * 0.9),
        rotation=(math.radians(68), 0, math.radians(28)),
    )
    camera = bpy.context.object
    bpy.context.scene.camera = camera
    direction = center - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max((max_z - min_z) * 1.25, radius * 1.8)


def configure_render(output_path: Path) -> None:
    bpy.context.scene.render.resolution_x = 900
    bpy.context.scene.render.resolution_y = 1100
    bpy.context.scene.view_settings.view_transform = "Standard"
    bpy.context.scene.render.film_transparent = False
    try:
        bpy.context.scene.render.engine = "BLENDER_WORKBENCH"
        bpy.context.scene.display.shading.light = "STUDIO"
        bpy.context.scene.display.shading.color_type = "MATERIAL"
    except Exception:
        pass
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(output_path)


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(input_path))

    start, end = animation_range()
    frame = args.frame if args.frame >= 0 else int((start + end) / 2)
    bpy.context.scene.frame_set(frame)

    apply_preview_material()
    center, min_z, max_z, radius = mesh_bounds()
    setup_camera(center, min_z, max_z, radius)
    configure_render(output_path)
    bpy.ops.render.render(write_still=True)
    print(f"Rendered frame {frame} to {output_path}")


if __name__ == "__main__":
    main()
