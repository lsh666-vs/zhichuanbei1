"""Render local, self-contained scientific diagnostics from completed solver artifacts.

This is a Stage 1 inspection artifact, not the final application. It reads only
the explicitly selected result files and verification receipt, never .env or keys.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
from datetime import UTC, datetime
from pathlib import Path

import h5py
import numpy as np
import plotly
import plotly.graph_objects as go
from plotly.subplots import make_subplots


def read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"Expected a JSON object: {path}")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_run(directory: Path) -> dict:
    names = ("spec.json", "result.json", "scene.json", "fields.h5")
    for name in names:
        if not (directory / name).is_file():
            raise FileNotFoundError(
                f"Required completed-result artifact missing: {directory / name}"
            )
    spec, result, scene = (read_json(directory / name) for name in names[:3])
    canonical = json.dumps(
        spec, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )
    spec_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    if result.get("spec_hash") != spec_hash or scene.get("spec_hash") != spec_hash:
        raise ValueError("Result, scene and canonical specification hashes do not agree")
    artifacts = {a["name"]: a for a in result.get("artifacts", [])}
    for name in ("spec.json", "scene.json", "fields.h5"):
        record = artifacts.get(name)
        path = directory / name
        if record is None or record.get("sha256") != sha256(path):
            raise ValueError(f"Missing or mismatched manifest checksum: {name}")
        if record.get("bytes") != path.stat().st_size:
            raise ValueError(f"Manifest byte count mismatch: {name}")
    with h5py.File(directory / "fields.h5", "r") as data:
        if data.attrs.get("spec_hash") != spec_hash:
            raise ValueError("HDF5 specification hash does not match")
        if data.attrs.get("axis_order") != "x,y,z,component":
            raise ValueError("Unsupported HDF5 axis order")
        if data.attrs.get("coordinate_units") != "um":
            raise ValueError("Expected micrometre coordinates")
        axes = tuple(np.asarray(data[f"axes/{axis}_um"], dtype=float) for axis in "xyz")
        for axis in axes:
            if axis.ndim != 1 or len(axis) < 3 or not np.isfinite(axis).all():
                raise ValueError("Invalid display coordinate axis")
            if not (np.diff(axis) > 0).all():
                raise ValueError("Display coordinate axis is not strictly increasing")
        shape = tuple(len(axis) for axis in axes)
        if math.prod(shape) > 500_000:
            raise ValueError("Display volume exceeds this diagnostic's 500000-voxel budget")
        if data["E/real"].shape != shape + (3,) or data["E/imag"].shape != shape + (3,):
            raise ValueError("Electric-field shape does not match x/y/z/component axes")
        real = np.asarray(data["E/real"][:, :, :, 1], dtype=float)
        imag = np.asarray(data["E/imag"][:, :, :, 1], dtype=float)
        if not np.isfinite(real).all() or not np.isfinite(imag).all():
            raise ValueError("Nonfinite field values")
        sampling = str(data.attrs.get("sampling", "unspecified"))
    if result.get("field_units", {}).get("E") != "V/m":
        raise ValueError("Unexpected electric-field units")
    return {
        "directory": directory,
        "spec": spec,
        "result": result,
        "scene": scene,
        "axes": axes,
        "real": real,
        "amplitude": np.hypot(real, imag),
        "sampling": sampling,
        "spec_hash": spec_hash,
        "sources": {name: sha256(directory / name) for name in names},
    }


def load_verification(path: Path) -> tuple[dict, list[dict]]:
    if not path.is_file():
        raise FileNotFoundError(f"Scientific verification receipt missing: {path}")
    receipt = read_json(path)
    rows = receipt.get("manufactured_cavity")
    if not isinstance(rows, list) or len(rows) < 2:
        raise ValueError("Convergence requires at least two actual manufactured-cavity results")
    for row in rows:
        for key in ("relative_electric_l2_error", "analytic_discrete_relative_error"):
            val = row.get(key)
            if not isinstance(val, (int, float)) or not math.isfinite(val) or val <= 0:
                raise ValueError(f"Missing/invalid actual convergence value: {key}")
        spacing = row.get("spacing_um")
        if not isinstance(spacing, list) or len(spacing) != 3:
            raise ValueError("Missing actual three-axis spacing in convergence receipt")
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0 for v in spacing):
            raise ValueError("Invalid convergence spacing")
    return receipt, sorted(rows, key=lambda row: max(row["spacing_um"]), reverse=True)


def layout_scene() -> dict:
    axis = {"gridcolor": "#253342", "zerolinecolor": "#455464", "backgroundcolor": "#0d151e"}
    return {
        "xaxis": {**axis, "title": "x [μm]"},
        "yaxis": {**axis, "title": "y [μm]"},
        "zaxis": {**axis, "title": "z [μm]"},
        "aspectmode": "data",
        "camera": {"eye": {"x": 1.5, "y": 1.5, "z": 1.1}},
    }


def volume_figure(run: dict) -> go.Figure:
    xx, yy, zz = np.meshgrid(*run["axes"], indexing="ij")
    fig = go.Figure()
    for kind, label, scale in (
        ("real", "Re(Ey) [V/m]", "RdBu_r"),
        ("amplitude", "|Ey| [V/m]", "Viridis"),
    ):
        values = run[kind]
        peak = float(np.max(np.abs(values)))
        if peak <= 0:
            raise ValueError(f"The selected result has zero {kind} Ey; no isosurface can be drawn")
        signed = kind == "real"
        fig.add_trace(
            go.Isosurface(
                x=xx.ravel(),
                y=yy.ravel(),
                z=zz.ravel(),
                value=values.ravel(),
                isomin=-0.85 * peak if signed else 0.15 * peak,
                isomax=0.85 * peak,
                surface_count=9 if signed else 6,
                opacity=0.28,
                colorscale=scale,
                cmin=-peak if signed else 0,
                cmax=peak,
                colorbar={"title": label},
                caps={"x_show": False, "y_show": False, "z_show": False},
                visible=not signed,
                name=label,
                hovertemplate="x=%{x:.4g} μm<br>y=%{y:.4g} μm<br>z=%{z:.4g} μm"
                "<br>field=%{value:.5g} V/m<extra></extra>",
            )
        )
    fig.update_layout(
        title="真实三维场等值面 · 初始显示 |Ey|",
        template="plotly_dark",
        paper_bgcolor="#0b1016",
        scene=layout_scene(),
        margin={"l": 15, "r": 15, "t": 75, "b": 10},
        height=660,
        updatemenus=[
            {
                "type": "buttons",
                "direction": "right",
                "active": 1,
                "x": 0.75,
                "y": 1.08,
                "bgcolor": "#dae5ef",
                "font": {"color": "#10202e"},
                "buttons": [
                    {
                        "label": "Re(Ey)",
                        "method": "update",
                        "args": [
                            {"visible": [True, False]},
                            {"title": "真实三维场等值面 · Re(Ey)"},
                        ],
                    },
                    {
                        "label": "|Ey|",
                        "method": "update",
                        "args": [{"visible": [False, True]}, {"title": "真实三维场等值面 · |Ey|"}],
                    },
                ],
            }
        ],
        uirevision=run["spec_hash"],
    )
    return fig


def slices_figure(run: dict, field_kind: str) -> go.Figure:
    values = run[field_kind]
    peak = float(np.max(np.abs(values)))
    signed = field_kind == "real"
    label = "Re(Ey)" if signed else "|Ey|"
    cmin, cmax = (-peak, peak) if signed else (0, peak)
    xx, yy = np.meshgrid(run["axes"][0], run["axes"][1], indexing="ij")
    mid = len(run["axes"][2]) // 2
    fig = go.Figure()
    for index, z_um in enumerate(run["axes"][2]):
        fig.add_trace(
            go.Surface(
                x=xx,
                y=yy,
                z=np.full_like(xx, z_um),
                surfacecolor=values[:, :, index],
                cmin=cmin,
                cmax=cmax,
                colorscale="RdBu_r" if signed else "Viridis",
                colorbar={"title": f"{label} [V/m]"},
                visible=index == mid,
                name=f"z={z_um:.5g} μm",
                hovertemplate="x=%{x:.4g} μm<br>y=%{y:.4g} μm<br>z=%{z:.4g} μm"
                "<br>field=%{surfacecolor:.5g} V/m<extra></extra>",
            )
        )
    steps = []
    for index, z_um in enumerate(run["axes"][2]):
        steps.append(
            {
                "method": "update",
                "label": f"{z_um:.3g}",
                "args": [
                    {"visible": [i == index for i in range(len(run["axes"][2]))]},
                    {"title": f"{label} 实际采样切片 · z={z_um:.5g} μm"},
                ],
            }
        )
    scene = layout_scene()
    scene["zaxis"]["range"] = [float(run["axes"][2][0]), float(run["axes"][2][-1])]
    fig.update_layout(
        title=f"{label} 实际采样切片 · 拖动 z 滑块",
        template="plotly_dark",
        paper_bgcolor="#0b1016",
        scene=scene,
        height=580,
        margin={"l": 15, "r": 15, "t": 55, "b": 50},
        sliders=[{"active": mid, "currentvalue": {"prefix": "实际 z [μm] = "}, "steps": steps}],
        uirevision=run["spec_hash"],
    )
    return fig


def convergence_figure(receipt: dict, rows: list[dict]) -> go.Figure:
    spacing = [max(row["spacing_um"]) for row in rows]
    custom = [
        [row.get("cells_per_axis"), row.get("unknowns"), row.get("spec_hash")] for row in rows
    ]
    fig = make_subplots(
        rows=1, cols=2, subplot_titles=("实际原始边场相对 L2 误差", "实际线性系统残差")
    )
    for key, label in (
        ("relative_electric_l2_error", "实测离散场误差"),
        ("analytic_discrete_relative_error", "解析离散误差预测"),
    ):
        fig.add_trace(
            go.Scatter(
                x=spacing,
                y=[row[key] for row in rows],
                mode="lines+markers",
                name=label,
                customdata=custom,
                hovertemplate="h=%{x:.6g} μm<br>相对误差=%{y:.6g}"
                "<br>每轴单元=%{customdata[0]}<br>未知数=%{customdata[1]}"
                "<br>spec=%{customdata[2]}<extra>%{fullData.name}</extra>",
            ),
            row=1,
            col=1,
        )
    residuals = [row.get("relative_residual") for row in rows]
    if any(not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0 for v in residuals):
        raise ValueError("Missing/invalid actual residual in convergence receipt")
    fig.add_trace(
        go.Scatter(x=spacing, y=residuals, mode="lines+markers", name="线性残差"), row=1, col=2
    )
    fig.update_xaxes(title_text="实际最大网格间距 h [μm]", type="log", autorange="reversed")
    fig.update_yaxes(title_text="无量纲相对误差", type="log", row=1, col=1)
    fig.update_yaxes(title_text="||Ae-b|| / ||b||", type="log", row=1, col=2)
    measured = receipt.get("measured_convergence_order")
    order_text = (
        f"；回执中的实测收敛阶 {measured:.5g}" if isinstance(measured, (int, float)) else ""
    )
    fig.update_layout(
        template="plotly_dark",
        paper_bgcolor="#0b1016",
        height=480,
        title=f"PEC 制造解网格收敛 · 只绘制 verification.json 已有数值{order_text}",
        margin={"l": 65, "r": 35, "t": 90, "b": 65},
        legend={"orientation": "h", "y": -0.24},
    )
    return fig


def render(run_dir: Path, verification: Path, output_dir: Path) -> Path:
    run = load_run(run_dir)
    receipt, rows = load_verification(verification)
    result = run["result"]
    figures = [
        volume_figure(run),
        slices_figure(run, "real"),
        slices_figure(run, "amplitude"),
        convergence_figure(receipt, rows),
    ]
    figure_html = [
        figure.to_html(
            full_html=False,
            include_plotlyjs=i == 0,
            config={
                "responsive": True,
                "displaylogo": False,
                "toImageButtonOptions": {"format": "png", "scale": 2},
            },
            div_id=f"diagnostic-{i}",
        )
        for i, figure in enumerate(figures)
    ]
    escape = html.escape
    field_limits = "".join(
        f"<li>{escape(str(value))}</li>" for value in result.get("limitations", [])
    )
    verification_limits = "".join(
        f"<li>{escape(str(value))}</li>" for value in receipt.get("limitations", [])
    )
    validation = escape(json.dumps(result.get("validation", {}), ensure_ascii=False, indent=2))
    metadata = {
        "model": result.get("model"),
        "normalization": result.get("normalization"),
        "geometry_kind": result.get("geometry_kind"),
        "wavelength_um": result.get("wavelength_um"),
        "spec_hash": run["spec_hash"],
        "time_convention": result.get("time_convention"),
        "engine_version": result.get("engine_version"),
        "sampling": run["sampling"],
        "display_shape_xyz": [len(axis) for axis in run["axes"]],
        "scene_physical_bounds_um": run["scene"].get("physical_bounds_um"),
        "source_directory": str(run_dir.resolve()),
        "verification_file": str(verification.resolve()),
    }
    pml_state = receipt.get("pml_converged_to_one_percent")
    warning = (
        "回执中的开放脊波导尚未达到1%边界收敛要求；当前腔体或电流场图不证明光学端口效率。"
        if pml_state is False
        else "开放边界/PML状态请读取下方原始回执；腔体收敛不能替代光学端口验证。"
    )
    html_text = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LightForge · 真实三维场诊断</title><style>
:root{color-scheme:dark}body{margin:0;background:#0b1016;color:#e8edf2;font:16px/1.7 system-ui,sans-serif}
main{max-width:1420px;margin:auto;padding:30px 24px 60px}h1{font-size:32px;line-height:1.3}
h2{font-size:22px;margin-top:36px}p,li{max-width:1100px}.muted{color:#a8b6c6}
.warning{border-left:4px solid #f4af67;padding:14px 18px;background:#201c18}
.panel{border:1px solid #263443;border-radius:12px;padding:18px;margin:20px 0;overflow:auto}
pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#bedbd6;font-size:13px}code{color:#54d8c7}
.plots{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:1000px){.plots{grid-template-columns:1fr}}
</style></head><body><main>
<p class="muted">LIGHTFORGE / STAGE 1 SCIENTIFIC DIAGNOSTIC</p>
<h1>来自数值结果的三维场与收敛诊断</h1>
<p>可旋转等值面、缩放，并拖动实际 z 采样切片。场数据来自已有 <code>fields.h5</code>，
坐标为 μm，电场为 V/m。二维收敛曲线直接读取已有验证回执。此文件是独立调试/教学产物，正式三维工作台由后续阶段交付。</p>
<p class="warning">__WARNING__</p>
<details class="panel"><summary>数据身份、模型、归一化与采样方式</summary><pre>__META__</pre></details>
__VOLUME__
<h2>移动实际采样截面</h2><p class="muted">切片按数据中的实际 z 坐标切换，保持固定色标。
显示是原始交错网格场的插值采样；此处没有运行新求解，也没有生成中间波长或伪造场值。</p>
<div class="plots"><div>__REAL_SLICE__</div><div>__AMP_SLICE__</div></div>
<h2>解析基准的实际收敛记录</h2><p class="muted">横轴为实际网格间距，纵轴为无量纲误差/残差。
收敛点来自同一回执的多次独立数值运行。线性残差与物理离散误差分别显示。</p>
__CONVERGENCE__
<details class="panel" open><summary>当前场结果的验证覆盖</summary><pre>__VALIDATION__</pre><ul>__LIMITS__</ul></details>
<details class="panel" open><summary>验证回执的范围与不足</summary><ul>__RECEIPT_LIMITS__</ul>
<pre>__RECEIPT_STATUS__</pre></details>
<p class="muted">此HTML内嵌Plotly运行库及图表数据，无需CDN。浏览器需支持WebGL才能显示三维图。
等值面仅展示已有离散数据的空间分布，不是实验照片、真实流片证明或分波器验收结论。</p>
</main></body></html>"""
    replacements = {
        "__WARNING__": escape(warning),
        "__META__": escape(json.dumps(metadata, ensure_ascii=False, indent=2)),
        "__VOLUME__": figure_html[0],
        "__REAL_SLICE__": figure_html[1],
        "__AMP_SLICE__": figure_html[2],
        "__CONVERGENCE__": figure_html[3],
        "__VALIDATION__": validation,
        "__LIMITS__": field_limits,
        "__RECEIPT_LIMITS__": verification_limits,
        "__RECEIPT_STATUS__": escape(
            json.dumps(
                {key: value for key, value in receipt.items() if not isinstance(value, list)},
                ensure_ascii=False,
                indent=2,
            )
        ),
    }
    for token, value in replacements.items():
        html_text = html_text.replace(token, value)
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "field-diagnostics.html"
    output.write_text(html_text, encoding="utf-8")
    manifest = {
        "schema_version": 1,
        "purpose": "actual-data scientific diagnostic, not final product",
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "plotly_version": plotly.__version__,
        "metadata": metadata,
        "source_hashes": run["sources"],
        "verification_sha256": sha256(verification),
        "convergence_point_count": len(rows),
        "output": {"name": output.name, "bytes": output.stat().st_size, "sha256": sha256(output)},
        "self_contained_plotly": True,
        "browser_visual_verification": "not performed by this renderer",
    }
    (output_dir / "diagnostics-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )
    return output


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--run", type=Path, default=root / ".runtime/science-verification/cavity-12"
    )
    parser.add_argument(
        "--verification",
        type=Path,
        default=root / ".runtime/science-verification/verification.json",
    )
    parser.add_argument("--output", type=Path, default=root / ".runtime/diagnostics")
    args = parser.parse_args()
    output = render(args.run, args.verification, args.output)
    print(
        json.dumps(
            {
                "output": str(output.resolve()),
                "bytes": output.stat().st_size,
                "sha256": sha256(output),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
