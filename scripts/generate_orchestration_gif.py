"""Generate animated orchestration preview GIF for omp-worker-mcp.

This script creates a clean, GitHub-compatible animated GIF illustrating
concurrent worker tasks streaming into an aggregated, verified result envelope.
"""

from __future__ import annotations

import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def create_orchestration_gif() -> Path:
    # 2x supersampling for high-quality antialiasing
    scale = 2
    w, h = 800 * scale, 360 * scale
    frames_count = 40
    fps = 20
    duration = int(1000 / fps)

    # Resolve output path relative to repository root
    repo_root = Path(__file__).resolve().parent.parent
    assets_dir = repo_root / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    out_path = assets_dir / "orchestration.gif"

    # Try loading clean system sans-serif fonts, fallback to default
    def get_font(size: int, bold: bool = False):
        font_candidates = [
            "segoeui.ttf" if not bold else "segoeuib.ttf",
            "arial.ttf" if not bold else "arialbd.ttf",
            "DejaVuSans.ttf" if not bold else "DejaVuSans-Bold.ttf",
        ]
        for candidate in font_candidates:
            try:
                return ImageFont.truetype(candidate, int(size * scale))
            except OSError:
                continue
        return ImageFont.load_default()

    font_title = get_font(13, bold=True)
    font_badge = get_font(11, bold=True)
    font_node_title = get_font(13, bold=True)
    font_node_desc = get_font(11, bold=False)
    font_status = get_font(10, bold=True)

    frames: list[Image.Image] = []

    # Node layouts (in 1x coordinates, scaled later)
    # Left 3 task nodes
    task_nodes = [
        {
            "id": "T1",
            "title": "Task A: Code Gen",
            "desc": "write: src/server.ts",
            "color": (56, 189, 248),  # Cyan
            "bg": (15, 23, 42),
            "x": 40,
            "y": 70,
            "w": 210,
            "h": 65,
        },
        {
            "id": "T2",
            "title": "Task B: Run Tests",
            "desc": "read_only: tests/",
            "color": (192, 132, 252),  # Purple
            "bg": (24, 16, 42),
            "x": 40,
            "y": 150,
            "w": 210,
            "h": 65,
        },
        {
            "id": "T3",
            "title": "Task C: Type Verification",
            "desc": "read_only: tsconfig.json",
            "color": (251, 191, 36),  # Amber
            "bg": (36, 24, 12),
            "x": 40,
            "y": 230,
            "w": 210,
            "h": 65,
        },
    ]

    # Right aggregated result node
    result_node = {
        "id": "OUT",
        "title": "Aggregated Result",
        "desc": "Verified & Structured Output",
        "color": (52, 211, 153),  # Emerald
        "bg": (6, 32, 24),
        "x": 540,
        "y": 125,
        "w": 220,
        "h": 115,
    }

    # Bezier curve evaluator
    def bezier_pt(p0, p1, p2, p3, t):
        x = (
            (1 - t) ** 3 * p0[0]
            + 3 * (1 - t) ** 2 * t * p1[0]
            + 3 * (1 - t) * t**2 * p2[0]
            + t**3 * p3[0]
        )
        y = (
            (1 - t) ** 3 * p0[1]
            + 3 * (1 - t) ** 2 * t * p1[1]
            + 3 * (1 - t) * t**2 * p2[1]
            + t**3 * p3[1]
        )
        return int(x), int(y)

    for f in range(frames_count):
        # Base image
        img = Image.new("RGBA", (w, h), (13, 17, 23, 255))  # #0d1117
        draw = ImageDraw.Draw(img)

        # Subtle background grid dots
        for gx in range(int(20 * scale), w, int(30 * scale)):
            for gy in range(int(20 * scale), h, int(30 * scale)):
                draw.rectangle(
                    [gx, gy, gx + int(1 * scale), gy + int(1 * scale)],
                    fill=(30, 41, 59, 140),
                )

        # Outer rounded container card
        border_rect = [
            int(12 * scale),
            int(12 * scale),
            int(w - 12 * scale),
            int(h - 12 * scale),
        ]
        draw.rounded_rectangle(
            border_rect,
            radius=int(12 * scale),
            outline=(48, 54, 61, 255),
            width=int(2 * scale),
            fill=(16, 22, 34, 230),
        )

        # Top header bar
        header_h = int(36 * scale)
        draw.rectangle(
            [
                int(12 * scale),
                int(12 * scale),
                int(w - 12 * scale),
                int(12 * scale + header_h),
            ],
            fill=(22, 27, 34, 255),
        )
        draw.line(
            [
                (int(12 * scale), int(12 * scale + header_h)),
                (int(w - 12 * scale), int(12 * scale + header_h)),
            ],
            fill=(48, 54, 61, 255),
            width=int(1 * scale),
        )

        # Header window controls
        for idx, col in enumerate(
            [(248, 113, 113), (251, 191, 36), (52, 211, 153)]
        ):
            cx = int((28 + idx * 14) * scale)
            cy = int((12 + 18) * scale)
            r = int(4 * scale)
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)

        # Header titles
        title_text = "OMP WORKER MCP  •  ASYNC DAG & CONCURRENT WORKER FLOW"
        draw.text(
            (int(80 * scale), int(21 * scale)),
            title_text,
            fill=(139, 148, 158),
            font=font_title,
        )

        # Header status badge
        badge_x = int(w - 180 * scale)
        badge_y = int(19 * scale)
        badge_w = int(150 * scale)
        badge_h = int(22 * scale)
        draw.rounded_rectangle(
            [badge_x, badge_y, badge_x + badge_w, badge_y + badge_h],
            radius=int(6 * scale),
            fill=(30, 41, 59, 200),
            outline=(56, 189, 248, 120),
            width=int(1 * scale),
        )
        # Pulse dot
        pulse_alpha = int(180 + 75 * math.sin(f * 2 * math.pi / frames_count))
        draw.ellipse(
            [
                badge_x + int(8 * scale),
                badge_y + int(7 * scale),
                badge_x + int(14 * scale),
                badge_y + int(13 * scale),
            ],
            fill=(56, 189, 248, pulse_alpha),
        )
        draw.text(
            (badge_x + int(20 * scale), badge_y + int(3 * scale)),
            "PARALLEL WORKERS",
            fill=(226, 232, 240),
            font=font_badge,
        )

        # Connection curves and flowing particle streams
        for idx, task in enumerate(task_nodes):
            # Start at right edge of task node
            start_x = int((task["x"] + task["w"]) * scale)
            start_y = int((task["y"] + task["h"] / 2) * scale)
            # End at left edge of result node
            target_y_offset = (idx - 1) * 26
            end_x = int(result_node["x"] * scale)
            end_y = int(
                (result_node["y"] + result_node["h"] / 2 + target_y_offset) * scale
            )

            # Control points for smooth S-curve
            p0 = (start_x, start_y)
            p1 = (start_x + int(130 * scale), start_y)
            p2 = (end_x - int(130 * scale), end_y)
            p3 = (end_x, end_y)

            # Draw background curve track
            curve_pts = [
                bezier_pt(p0, p1, p2, p3, step / 40.0) for step in range(41)
            ]
            for step_idx in range(len(curve_pts) - 1):
                draw.line(
                    [curve_pts[step_idx], curve_pts[step_idx + 1]],
                    fill=(40, 50, 70, 180),
                    width=int(2 * scale),
                )

            # Draw animated traveling packets (3 packets per stream, offset in phase)
            particles_per_stream = 3
            for p_idx in range(particles_per_stream):
                t = (
                    (f / frames_count) + (p_idx / particles_per_stream) + (idx * 0.15)
                ) % 1.0
                px, py = bezier_pt(p0, p1, p2, p3, t)

                # Particle glow halo
                halo_r = int(7 * scale)
                halo_color = (*task["color"], 60)
                draw.ellipse(
                    [px - halo_r, py - halo_r, px + halo_r, py + halo_r],
                    fill=halo_color,
                )

                # Particle core
                core_r = int(3.5 * scale)
                draw.ellipse(
                    [px - core_r, py - core_r, px + core_r, py + core_r],
                    fill=(255, 255, 255, 240),
                )

        # Draw left task nodes
        for idx, task in enumerate(task_nodes):
            nx = int(task["x"] * scale)
            ny = int(task["y"] * scale)
            nw = int(task["w"] * scale)
            nh = int(task["h"] * scale)

            # Node card background
            draw.rounded_rectangle(
                [nx, ny, nx + nw, ny + nh],
                radius=int(8 * scale),
                fill=(*task["bg"], 220),
                outline=task["color"],
                width=int(2 * scale),
            )

            # Status pill inside node
            status_x = nx + nw - int(66 * scale)
            status_y = ny + int(10 * scale)
            draw.rounded_rectangle(
                [
                    status_x,
                    status_y,
                    status_x + int(56 * scale),
                    status_y + int(18 * scale),
                ],
                radius=int(4 * scale),
                fill=(30, 41, 59, 220),
                outline=(*task["color"], 160),
                width=int(1 * scale),
            )
            draw.text(
                (status_x + int(8 * scale), status_y + int(2 * scale)),
                "ACTIVE",
                fill=task["color"],
                font=font_status,
            )

            # Node icon / identifier circle
            icon_r = int(10 * scale)
            icon_cx = nx + int(20 * scale)
            icon_cy = ny + int(24 * scale)
            draw.ellipse(
                [
                    icon_cx - icon_r,
                    icon_cy - icon_r,
                    icon_cx + icon_r,
                    icon_cy + icon_r,
                ],
                fill=(*task["color"], 40),
                outline=task["color"],
                width=int(1 * scale),
            )
            draw.text(
                (icon_cx - int(5 * scale), icon_cy - int(7 * scale)),
                task["id"][-1],
                fill=task["color"],
                font=font_node_title,
            )

            # Node text labels
            draw.text(
                (nx + int(38 * scale), ny + int(12 * scale)),
                task["title"],
                fill=(241, 245, 249),
                font=font_node_title,
            )
            draw.text(
                (nx + int(38 * scale), ny + int(34 * scale)),
                task["desc"],
                fill=(148, 163, 184),
                font=font_node_desc,
            )

        # Draw right aggregated result node
        rx = int(result_node["x"] * scale)
        ry = int(result_node["y"] * scale)
        rw = int(result_node["w"] * scale)
        rh = int(result_node["h"] * scale)

        # Subtle pulsing glow around the destination node
        pulse_val = 0.5 + 0.5 * math.sin(f * 2 * math.pi / frames_count)
        glow_pad = int((3 + pulse_val * 4) * scale)
        draw.rounded_rectangle(
            [rx - glow_pad, ry - glow_pad, rx + rw + glow_pad, ry + rh + glow_pad],
            radius=int(12 * scale),
            outline=(52, 211, 153, int(40 + 70 * pulse_val)),
            width=int(2 * scale),
        )

        # Main destination card
        draw.rounded_rectangle(
            [rx, ry, rx + rw, ry + rh],
            radius=int(10 * scale),
            fill=(*result_node["bg"], 235),
            outline=result_node["color"],
            width=int(2 * scale),
        )

        # Status badge inside destination card
        res_badge_x = rx + rw - int(100 * scale)
        res_badge_y = ry + int(12 * scale)
        draw.rounded_rectangle(
            [
                res_badge_x,
                res_badge_y,
                res_badge_x + int(88 * scale),
                res_badge_y + int(20 * scale),
            ],
            radius=int(5 * scale),
            fill=(6, 78, 59, 220),
            outline=(52, 211, 153, 200),
            width=int(1 * scale),
        )
        draw.text(
            (res_badge_x + int(8 * scale), res_badge_y + int(3 * scale)),
            "COMPLETED ✓",
            fill=(167, 243, 208),
            font=font_status,
        )

        # Title & descriptions
        draw.text(
            (rx + int(16 * scale), ry + int(14 * scale)),
            result_node["title"],
            fill=(240, 253, 244),
            font=font_node_title,
        )
        draw.text(
            (rx + int(16 * scale), ry + int(38 * scale)),
            "• 3/3 Sub-Tasks Reconciled",
            fill=(187, 247, 208),
            font=font_node_desc,
        )
        draw.text(
            (rx + int(16 * scale), ry + int(56 * scale)),
            "• Path Isolation Validated",
            fill=(187, 247, 208),
            font=font_node_desc,
        )
        draw.text(
            (rx + int(16 * scale), ry + int(74 * scale)),
            "• Structured Envelope Ready",
            fill=(187, 247, 208),
            font=font_node_desc,
        )

        # Downsample to target resolution with LANCZOS for high quality
        frame_final = img.resize((800, 360), resample=Image.Resampling.LANCZOS)
        # Convert to P mode with adaptive palette for crisp GIF output
        frame_p = frame_final.convert("RGB").convert(
            "P", palette=Image.Palette.ADAPTIVE, colors=128
        )
        frames.append(frame_p)

    # Save as GIF
    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        optimize=True,
    )
    print(f"Generated {out_path} ({out_path.stat().st_size} bytes, {len(frames)} frames)")
    return out_path


if __name__ == "__main__":
    create_orchestration_gif()
