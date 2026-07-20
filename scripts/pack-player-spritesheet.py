"""Pack generated character poses into an exact 8x6, 64px sprite sheet.

The input is expected to be a transparent image containing the 35 generated
poses in row order. Connected-component extraction prevents wide attack and
death poses from leaking into neighboring animation cells.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


FRAME_SIZE = 64
FRAME_COUNTS = (4, 8, 8, 6, 3, 6)
MAIN_COMPONENT_MIN_AREA = 1_000
ACCESSORY_MIN_AREA = 18
ALPHA_THRESHOLD = 16
CONTENT_MARGIN = 2
FOOT_BASELINE = 60


@dataclass(frozen=True)
class Component:
    label: int
    area: int
    left: int
    top: int
    right: int
    bottom: int

    @property
    def center_x(self) -> float:
        return (self.left + self.right) / 2

    @property
    def center_y(self) -> float:
        return (self.top + self.bottom) / 2


def connected_components(alpha: np.ndarray) -> tuple[np.ndarray, list[Component]]:
    height, width = alpha.shape
    mask = alpha > ALPHA_THRESHOLD
    labels = np.full((height, width), -1, dtype=np.int32)
    components: list[Component] = []

    for y in range(height):
        for x in range(width):
            if not mask[y, x] or labels[y, x] >= 0:
                continue
            label = len(components)
            stack = [(y, x)]
            labels[y, x] = label
            area = 0
            left = right = x
            top = bottom = y

            while stack:
                current_y, current_x = stack.pop()
                area += 1
                left = min(left, current_x)
                right = max(right, current_x)
                top = min(top, current_y)
                bottom = max(bottom, current_y)

                for next_y, next_x in (
                    (current_y - 1, current_x),
                    (current_y + 1, current_x),
                    (current_y, current_x - 1),
                    (current_y, current_x + 1),
                ):
                    if (
                        0 <= next_y < height
                        and 0 <= next_x < width
                        and mask[next_y, next_x]
                        and labels[next_y, next_x] < 0
                    ):
                        labels[next_y, next_x] = label
                        stack.append((next_y, next_x))

            components.append(Component(label, area, left, top, right + 1, bottom + 1))

    return labels, components


def ordered_main_components(
    components: list[Component],
    frame_counts: tuple[int, ...] = FRAME_COUNTS,
) -> list[list[Component]]:
    expected = sum(frame_counts)
    main = [component for component in components if component.area >= MAIN_COMPONENT_MIN_AREA]
    if len(main) != expected:
        raise ValueError(f"Expected {expected} character poses, found {len(main)}.")

    by_vertical_position = sorted(main, key=lambda component: (component.center_y, component.center_x))
    rows: list[list[Component]] = []
    offset = 0
    for frame_count in frame_counts:
        row = sorted(by_vertical_position[offset:offset + frame_count], key=lambda component: component.center_x)
        rows.append(row)
        offset += frame_count
    return rows


def assign_accessories(
    components: list[Component],
    rows: list[list[Component]],
) -> dict[int, list[int]]:
    main = [component for row in rows for component in row]
    main_labels = {component.label for component in main}
    assignments = {component.label: [component.label] for component in main}

    for accessory in components:
        if accessory.label in main_labels or accessory.area < ACCESSORY_MIN_AREA:
            continue
        nearest = min(
            main,
            key=lambda component: (
                (accessory.center_x - component.center_x) ** 2
                + (accessory.center_y - component.center_y) ** 2 * 1.5
            ),
        )
        if abs(accessory.center_y - nearest.center_y) <= 120 and abs(accessory.center_x - nearest.center_x) <= 180:
            assignments[nearest.label].append(accessory.label)
    return assignments


def frame_bounds(labels: np.ndarray, selected_labels: list[int]) -> tuple[int, int, int, int]:
    selected = np.isin(labels, selected_labels)
    y_values, x_values = np.nonzero(selected)
    if len(x_values) == 0:
        raise ValueError("A selected pose has no visible pixels.")
    return int(x_values.min()), int(y_values.min()), int(x_values.max() + 1), int(y_values.max() + 1)


def pack(source_path: Path, output_path: Path, final_pose_path: Path | None = None) -> None:
    source = Image.open(source_path).convert("RGBA")
    source_array = np.asarray(source)
    labels, components = connected_components(source_array[:, :, 3])
    source_frame_counts = FRAME_COUNTS if final_pose_path is None else (*FRAME_COUNTS[:-1], FRAME_COUNTS[-1] - 1)
    rows = ordered_main_components(components, source_frame_counts)
    assignments = assign_accessories(components, rows)

    bounds = {
        component.label: frame_bounds(labels, assignments[component.label])
        for row in rows
        for component in row
    }
    maximum_width = max(right - left for left, _top, right, _bottom in bounds.values())
    maximum_height = max(bottom - top for _left, top, _right, bottom in bounds.values())
    available = FRAME_SIZE - CONTENT_MARGIN * 2
    uniform_scale = min(available / maximum_width, available / maximum_height)

    sheet = Image.new("RGBA", (FRAME_SIZE * 8, FRAME_SIZE * 6), (0, 0, 0, 0))
    for row_index, row in enumerate(rows):
        for column_index, component in enumerate(row):
            selected_labels = assignments[component.label]
            left, top, right, bottom = bounds[component.label]
            selected = np.isin(labels[top:bottom, left:right], selected_labels)
            crop_array = source_array[top:bottom, left:right].copy()
            crop_array[~selected] = 0
            crop = Image.fromarray(crop_array, "RGBA")
            target_width = max(1, round(crop.width * uniform_scale))
            target_height = max(1, round(crop.height * uniform_scale))
            crop = crop.resize((target_width, target_height), Image.Resampling.LANCZOS)
            target_x = column_index * FRAME_SIZE + (FRAME_SIZE - target_width) // 2
            target_y = row_index * FRAME_SIZE + FOOT_BASELINE - target_height
            sheet.alpha_composite(crop, (target_x, target_y))

    if final_pose_path is not None:
        final_pose = Image.open(final_pose_path).convert("RGBA")
        final_bbox = final_pose.getchannel("A").getbbox()
        if final_bbox is None:
            raise ValueError("The supplied final pose has no visible pixels.")
        final_pose = final_pose.crop(final_bbox)
        final_scale = min(available / final_pose.width, available / final_pose.height)
        final_width = max(1, round(final_pose.width * final_scale))
        final_height = max(1, round(final_pose.height * final_scale))
        final_pose = final_pose.resize((final_width, final_height), Image.Resampling.LANCZOS)
        final_x = (FRAME_COUNTS[-1] - 1) * FRAME_SIZE + (FRAME_SIZE - final_width) // 2
        final_y = (len(FRAME_COUNTS) - 1) * FRAME_SIZE + FOOT_BASELINE - final_height
        sheet.alpha_composite(final_pose, (final_x, final_y))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, optimize=True)
    print(
        f"Packed {sum(FRAME_COUNTS)} poses into {output_path} "
        f"({sheet.width}x{sheet.height}, scale={uniform_scale:.4f}, baseline={FOOT_BASELINE}px)."
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--final-pose", type=Path)
    arguments = parser.parse_args()
    pack(arguments.input, arguments.output, arguments.final_pose)


if __name__ == "__main__":
    main()
