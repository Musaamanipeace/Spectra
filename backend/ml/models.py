"""The three active-learning architectures (SPECIFICATION.md section 6.4.1)."""
import math

import torch
import torch.nn as nn
import torch.nn.functional as F

# Module whose activations/gradients feed the feature maps and Grad-CAM.
TARGET_LAYERS = {
    "DipoleConvNet3D": "act2",
    "SpectralResNet102": "block2.out_act",
    "AstroFeatureSVM": "rbf",
}
FEATURE_AXES = ["ir_color_d5_d2", "motion_snr", "ice_methane_depth"]


class DipoleConvNet3D(nn.Module):
    """3D spatio-temporal ConvNet on [B, 6, N_epochs, 32, 32] difference stamps."""

    def __init__(self, in_ch: int = 6, num_classes: int = 2):
        super().__init__()
        self.conv1 = nn.Conv3d(in_ch, 8, 3, padding=1)
        self.bn1 = nn.BatchNorm3d(8)
        self.act1 = nn.ReLU()
        self.pool1 = nn.MaxPool3d((1, 2, 2))
        self.conv2 = nn.Conv3d(8, 16, 3, padding=1)
        self.bn2 = nn.BatchNorm3d(16)
        self.act2 = nn.ReLU()
        self.pool2 = nn.MaxPool3d((1, 2, 2))
        self.head = nn.Linear(16, num_classes)

    def forward(self, x):
        x = self.pool1(self.act1(self.bn1(self.conv1(x))))
        x = self.pool2(self.act2(self.bn2(self.conv2(x))))
        return self.head(x.mean(dim=(2, 3, 4)))


class ResBlock1D(nn.Module):
    def __init__(self, ch: int):
        super().__init__()
        self.conv1 = nn.Conv1d(ch, ch, 5, padding=2)
        self.bn1 = nn.BatchNorm1d(ch)
        self.act = nn.ReLU()
        self.conv2 = nn.Conv1d(ch, ch, 5, padding=2)
        self.bn2 = nn.BatchNorm1d(ch)
        self.out_act = nn.ReLU()

    def forward(self, x):
        h = self.bn2(self.conv2(self.act(self.bn1(self.conv1(x)))))
        return self.out_act(h + x)


class SpectralResNet102(nn.Module):
    """1D ResNet + self-attention over a 102-bin spectrum.

    Input [B, 2, 102]: channel 0 = flux, channel 1 = inverse-variance weights.
    """

    def __init__(self, in_ch: int = 2, width: int = 16, num_classes: int = 2):
        super().__init__()
        self.stem = nn.Sequential(nn.Conv1d(in_ch, width, 7, padding=3), nn.BatchNorm1d(width), nn.ReLU())
        self.block1 = ResBlock1D(width)
        self.block2 = ResBlock1D(width)
        self.attn = nn.MultiheadAttention(width, num_heads=2, batch_first=True)
        self.head = nn.Linear(width, num_classes)

    def forward(self, x):
        h = self.block2(self.block1(self.stem(x)))  # [B, C, L]
        seq = h.transpose(1, 2)  # [B, L, C]
        attn_out, _ = self.attn(seq, seq, seq, need_weights=False)
        return self.head((seq + attn_out).mean(dim=1))


class RBFLayer(nn.Module):
    """Gaussian kernel against learnable landmarks: exp(-gamma * ||x - c||^2)."""

    def __init__(self, in_dim: int, n_centers: int, gamma: float = 2.0):
        super().__init__()
        self.centers = nn.Parameter(torch.rand(n_centers, in_dim) * 2 - 1)
        self.log_gamma = nn.Parameter(torch.tensor(math.log(gamma)))

    def forward(self, x):
        return torch.exp(-self.log_gamma.exp() * torch.cdist(x, self.centers).pow(2))


class AstroFeatureSVM(nn.Module):
    """RBF kernel machine on [IR color D5/D2, motion SNR, ice/methane depth], each scaled to [-1, 1].

    Implemented in torch (learned RBF landmarks + linear readout) so it trains
    epoch by epoch and exposes weights/gradients like the other two models.
    """

    def __init__(self, in_dim: int = 3, n_centers: int = 32, num_classes: int = 2):
        super().__init__()
        self.rbf = RBFLayer(in_dim, n_centers)
        self.readout = nn.Linear(n_centers, num_classes)

    def forward(self, x):
        return self.readout(self.rbf(x))

    @torch.no_grad()
    def boundary_probs(self, n: int = 25):
        """P(class 1) on an n x n x n grid over the 3D feature space, indexing='ij'."""
        was_training = self.training
        self.eval()
        ax = torch.linspace(-1, 1, n)
        grid = torch.stack(torch.meshgrid(ax, ax, ax, indexing="ij"), dim=-1).reshape(-1, 3)
        probs = F.softmax(self(grid), dim=1)[:, 1].reshape(n, n, n)
        self.train(was_training)
        return probs


def build_model(name: str) -> nn.Module:
    models = {
        "DipoleConvNet3D": DipoleConvNet3D,
        "SpectralResNet102": SpectralResNet102,
        "AstroFeatureSVM": AstroFeatureSVM,
    }
    if name not in models:
        raise ValueError(f"Unknown model: {name}")
    return models[name]()
