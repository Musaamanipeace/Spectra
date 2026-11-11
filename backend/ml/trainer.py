"""Training loop, pre-computed 50-epoch replay, and CLI.

Pre-compute (CPU only, ~1-2 min total):  python -m backend.ml.trainer
This module is torch-free at import time; torch is imported inside run_training.
"""
import json
import sys
import threading
import time
import uuid

from . import MODEL_NAMES, REPLAY_DIR, replay_path

LR = {"DipoleConvNet3D": 3e-3, "SpectralResNet102": 3e-3, "AstroFeatureSVM": 5e-2}
BATCH = {"DipoleConvNet3D": 32, "SpectralResNet102": 32, "AstroFeatureSVM": 64}
_replay_lock = threading.Lock()


def run_training(model_name, epochs=50, seed=0, mode="replay", on_frame=None, stop_event=None):
    """Train on CPU, emitting one telemetry frame per epoch. Returns all frames."""
    import torch
    import torch.nn.functional as F
    from sklearn.metrics import accuracy_score

    from .data import DATASET_SIZE, make_dataset, make_probe
    from .models import TARGET_LAYERS, build_model
    from .telemetry import RealTimeTrainingInstrument

    torch.manual_seed(seed)
    x, y = make_dataset(model_name, DATASET_SIZE[model_name], seed)
    split = int(0.8 * len(x))
    xtr, ytr, xva, yva = x[:split], y[:split], x[split:], y[split:]

    model = build_model(model_name)
    opt = torch.optim.Adam(model.parameters(), lr=LR[model_name])
    instr = RealTimeTrainingInstrument(model, TARGET_LAYERS[model_name])
    probe_x = make_probe(model_name)
    run_id, bs, frames, t0 = uuid.uuid4().hex[:8], BATCH[model_name], [], time.time()

    try:
        for epoch in range(1, epochs + 1):
            if stop_event is not None and stop_event.is_set():
                break
            model.train()
            perm = torch.randperm(len(xtr))
            starts = list(range(0, len(xtr), bs))
            loss_sum, correct, grad_norm = 0.0, 0, 0.0
            for k, i in enumerate(starts):
                idx = perm[i:i + bs]
                opt.zero_grad(set_to_none=True)
                out = model(xtr[idx])
                loss = F.cross_entropy(out, ytr[idx])
                loss.backward()
                if k == len(starts) - 1:
                    grad_norm = instr.grad_stats(model)
                opt.step()
                loss_sum += loss.item() * len(idx)
                correct += (out.argmax(1) == ytr[idx]).sum().item()

            model.eval()
            with torch.no_grad():
                vo = model(xva)
                vloss = F.cross_entropy(vo, yva).item()
                vacc = accuracy_score(yva.numpy(), vo.argmax(1).numpy())

            frame = instr.build_frame(
                model, model_name=model_name, run_id=run_id, mode=mode, epoch=epoch, epochs=epochs,
                metrics={"loss": loss_sum / len(xtr), "acc": correct / len(xtr), "val_loss": vloss,
                         "val_acc": vacc, "elapsed_s": time.time() - t0},
                grad_norm=grad_norm, probe_x=probe_x,
            )
            frames.append(frame)
            if on_frame:
                on_frame(frame)
    finally:
        instr.close()
    return frames


def load_replay(model_name):
    """Cached 50-epoch trajectory; generated once on CPU if the file is missing."""
    with _replay_lock:
        path = replay_path(model_name)
        if path.is_file():
            return json.loads(path.read_text())
        frames = run_training(model_name, epochs=50, seed=0, mode="replay")
        REPLAY_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(frames, separators=(",", ":")))
        tmp.replace(path)
        return frames


if __name__ == "__main__":
    for name in (sys.argv[1:] or MODEL_NAMES):
        print(f"precomputing {name} ...", flush=True)
        frames = load_replay(name)
        print(f"  {len(frames)} frames, max {max(len(json.dumps(f)) for f in frames)} bytes/frame")
