"""ML engine package.

This __init__ MUST stay free of torch / sklearn imports. Heavy modules
(models, data, telemetry, trainer internals) are only imported lazily when an
/admin route is invoked, so the public /explore cold boot stays fast.
"""
import os
from pathlib import Path

MODEL_NAMES = ("DipoleConvNet3D", "SpectralResNet102", "AstroFeatureSVM")
RING_SIZE = 100
REPLAY_DIR = Path(os.getenv("ML_REPLAY_DIR", str(Path(__file__).parent / "replay")))


def replay_path(model_name: str) -> Path:
    return REPLAY_DIR / f"{model_name}.json"


def replay_exists(model_name: str) -> bool:
    return replay_path(model_name).is_file()
