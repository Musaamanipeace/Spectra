"""RealTimeTrainingInstrument: per-epoch telemetry frames (<20 KB JSON each)."""
import base64
import json
import math
import zlib

import numpy as np
import torch
import torch.nn.functional as F

from .models import FEATURE_AXES

HIST_BINS = 40
HIST_RANGE = (-1.0, 1.0)
MESH = 25
FRAME_BUDGET = 20 * 1024
MAX_HIST_LAYERS = 6
PROBE_LABEL = "WISE 0855 (pinned probe)"


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _u8(t: torch.Tensor) -> dict:
    """Min-max quantise a tensor to uint8 + base64."""
    a = t.detach().float().cpu().numpy()
    lo, hi = float(a.min()), float(a.max())
    if hi - lo < 1e-12:
        q = np.zeros(a.shape, dtype=np.uint8)
    else:
        q = np.round((a - lo) / (hi - lo) * 255).astype(np.uint8)
    return {"shape": list(a.shape), "min": round(lo, 5), "max": round(hi, 5), "data": _b64(q.tobytes())}


def _pack_mesh(probs: torch.Tensor, drop_bits: int = 0) -> dict:
    q = np.round(probs.cpu().numpy() * 255).astype(np.uint8)
    if drop_bits:
        q = (q >> drop_bits) << drop_bits  # coarser levels compress better
    return {
        "shape": [MESH, MESH, MESH],
        "encoding": "uint8+zlib+base64",
        "axes": FEATURE_AXES,
        "range": [-1, 1],
        "drop_bits": drop_bits,
        "data": _b64(zlib.compress(q.tobytes(), 9)),
    }


def _cam(act: torch.Tensor, grad: torch.Tensor) -> torch.Tensor:
    if act.dim() == 2:  # kernel layer: per-landmark attribution
        return F.relu(act * grad)[0]
    w = grad.mean(dim=tuple(range(2, act.dim())), keepdim=True)
    cam = F.relu((w * act).sum(dim=1))[0]
    return cam.mean(dim=0) if cam.dim() == 3 else cam  # average over time for 3D stamps


def _feature_maps(act: torch.Tensor) -> torch.Tensor:
    a = act.detach()[0]
    if a.dim() == 1:
        return a[None]
    if a.dim() == 4:  # [C, T, H, W] -> [C, H, W]
        a = a.mean(dim=1)
    return a[:4]


class RealTimeTrainingInstrument:
    """Forward hook on the target layer captures activations and attaches a
    backward (tensor) hook to its output to capture gradients for Grad-CAM.
    Hooks are inert except during `capture_probe`, so training is not slowed."""

    def __init__(self, model: torch.nn.Module, target_layer: str):
        self._active = False
        self._act = None
        self._grad = None
        module = dict(model.named_modules())[target_layer]
        self.target_layer = target_layer
        self._handle = module.register_forward_hook(self._forward_hook)

    def _forward_hook(self, module, inputs, output):
        if not self._active:
            return
        self._act = output
        if output.requires_grad:
            output.register_hook(lambda g: setattr(self, "_grad", g))

    def close(self):
        self._handle.remove()

    @staticmethod
    def grad_stats(model: torch.nn.Module) -> float:
        """Global gradient L2 norm. Call after loss.backward(), before optimizer.step()."""
        total = sum(float(p.grad.detach().norm(2)) ** 2 for p in model.parameters() if p.grad is not None)
        return math.sqrt(total)

    @staticmethod
    def weight_histograms(model: torch.nn.Module) -> dict:
        named = [(n, p) for n, p in model.named_parameters() if p.dim() >= 2]
        if len(named) > MAX_HIST_LAYERS:
            idx = np.linspace(0, len(named) - 1, MAX_HIST_LAYERS).round().astype(int)
            named = [named[i] for i in idx]
        return {
            n: torch.histc(p.detach().float().flatten(), bins=HIST_BINS, min=HIST_RANGE[0], max=HIST_RANGE[1]).int().tolist()
            for n, p in named
        }

    def capture_probe(self, model: torch.nn.Module, probe_x: torch.Tensor, class_idx: int = 1) -> dict:
        was_training = model.training
        model.eval()
        self._active, self._act, self._grad = True, None, None
        try:
            with torch.enable_grad():
                logits = model(probe_x)
                prob = F.softmax(logits, dim=1)[0, class_idx].item()
                model.zero_grad(set_to_none=True)
                logits[0, class_idx].backward()
        finally:
            self._active = False
            model.train(was_training)
            model.zero_grad(set_to_none=True)
        probe = {"label": PROBE_LABEL, "class_prob": round(prob, 4), "target_layer": self.target_layer}
        if self._act is not None:
            probe["feature_maps"] = _u8(_feature_maps(self._act))
            if self._grad is not None:
                probe["gradcam"] = _u8(_cam(self._act.detach(), self._grad.detach()))
        return probe

    @staticmethod
    def boundary_probs(model: torch.nn.Module):
        return model.boundary_probs(MESH) if hasattr(model, "boundary_probs") else None

    def build_frame(self, model, *, model_name, run_id, mode, epoch, epochs, metrics, grad_norm, probe_x) -> dict:
        frame = {
            "type": "epoch",
            "run_id": run_id,
            "mode": mode,
            "model": model_name,
            "epoch": epoch,
            "epochs": epochs,
            **{k: round(float(v), 5) for k, v in metrics.items()},
            "grad_norm": round(float(grad_norm), 5),
            "histograms": {"bins": HIST_BINS, "range": list(HIST_RANGE), "layers": self.weight_histograms(model)},
            "probe": self.capture_probe(model, probe_x),
            "boundary": None,
        }
        probs = self.boundary_probs(model)
        if probs is not None:
            for drop in (0, 2, 4, 6):
                frame["boundary"] = _pack_mesh(probs, drop)
                if len(json.dumps(frame, separators=(",", ":"))) <= FRAME_BUDGET:
                    break
            else:
                frame["boundary"], frame["truncated"] = None, True
        return frame
