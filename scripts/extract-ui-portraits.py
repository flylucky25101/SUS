"""Extract high-resolution idle poses for selection and shop UI portraits."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PACKER_PATH = ROOT / "scripts" / "pack-player-spritesheet.py"
OUTPUT_DIR = ROOT / "public" / "assets" / "portraits"
CANVAS_SIZE = (384, 512)
MAX_POSE_SIZE = (336, 452)
FOOT_BASELINE = 486

SOURCE_SPECS = {
    "kade": (ROOT / "artifacts" / "sprites" / "player-spritesheet-transparent-hires.png", (4, 8, 8, 6, 3, 6)),
    "mira": (ROOT / "artifacts" / "sprites" / "all-fighters" / "mira-transparent-hires.png", (4, 8, 8, 6, 3, 5)),
    "bram": (ROOT / "artifacts" / "sprites" / "all-fighters" / "bram-transparent-hires.png", (4, 8, 8, 6, 3, 5)),
    "suri": (ROOT / "artifacts" / "sprites" / "all-fighters" / "suri-transparent-hires.png", (4, 8, 8, 6, 3, 6)),
    "juno": (ROOT / "artifacts" / "sprites" / "new-fighters" / "juno-transparent-hires.png", (4, 8, 8, 6, 3, 6)),
    "orin": (ROOT / "artifacts" / "sprites" / "new-fighters" / "orin-transparent-hires.png", (4, 8, 8, 6, 3, 6)),
}


def load_packer():
    spec = importlib.util.spec_from_file_location("sprite_sheet_packer", PACKER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {PACKER_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def extract_portrait(name: str, source_path: Path, frame_counts: tuple[int, ...], packer) -> Path:
    source = Image.open(source_path).convert("RGBA")
    source_array = np.asarray(source)
    labels, components = packer.connected_components(source_array[:, :, 3])
    rows = packer.ordered_main_components(components, frame_counts)
    assignments = packer.assign_accessories(components, rows)
    idle_pose = rows[0][0]
    selected_labels = assignments[idle_pose.label]
    left, top, right, bottom = packer.frame_bounds(labels, selected_labels)

    selected = np.isin(labels[top:bottom, left:right], selected_labels)
    crop_array = source_array[top:bottom, left:right].copy()
    crop_array[~selected] = 0
    crop = Image.fromarray(crop_array, "RGBA")

    scale = min(MAX_POSE_SIZE[0] / crop.width, MAX_POSE_SIZE[1] / crop.height)
    target_size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    crop = crop.resize(target_size, Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    target_x = (CANVAS_SIZE[0] - crop.width) // 2
    target_y = FOOT_BASELINE - crop.height
    canvas.alpha_composite(crop, (target_x, target_y))

    output_path = OUTPUT_DIR / f"{name}-portrait.png"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, optimize=True)
    print(f"{name}: {source_path.name} -> {output_path.relative_to(ROOT)} ({crop.width}x{crop.height} pose)")
    return output_path


def main() -> None:
    packer = load_packer()
    for name, (source_path, frame_counts) in SOURCE_SPECS.items():
        extract_portrait(name, source_path, frame_counts, packer)


if __name__ == "__main__":
    main()
