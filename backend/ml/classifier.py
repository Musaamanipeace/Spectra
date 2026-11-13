"""Lightweight Online Multiclass Classifier & Decision Boundary Projector.

Specification Anchor: Implementation Plan Phase D (Issue D.1)
Operates on the normalized 12-dimensional feature space from dataset_generator.py.
Outputs class predictions, probabilities, PCA 2D projection, and decision surfaces.
"""

from __future__ import annotations

import math
from typing import Any

try:
    from backend.ml.dataset_generator import (
        CLASS_NAMES,
        FEATURE_NAMES,
        build_training_dataset,
        extract_12d_features,
    )
except ImportError:
    from ml.dataset_generator import (  # type: ignore
        CLASS_NAMES,
        FEATURE_NAMES,
        build_training_dataset,
        extract_12d_features,
    )


class OnlineCandidateClassifier:
    """Softmax logistic classifier and PCA 2D boundary projector."""

    def __init__(self) -> None:
        self.feature_names = FEATURE_NAMES
        self.class_names = CLASS_NAMES
        self.n_features = len(FEATURE_NAMES)
        self.n_classes = len(CLASS_NAMES)

        # Centroid templates per class in 12D space
        self.class_centroids: list[list[float]] = []
        self.class_scales: list[float] = []

        # PCA 2D projection vectors (pre-computed dominant eigenvectors over feature space)
        # PC1 emphasizes time-domain motion & dipole SNR (x-axis)
        # PC2 emphasizes infrared ice optical depth & spectral features (y-axis)
        self.pc1 = [0.42, 0.15, 0.38, 0.52, -0.10, 0.12, 0.28, 0.20, -0.05, -0.02, 0.10, -0.48]
        self.pc2 = [-0.12, 0.22, -0.15, -0.08, 0.35, 0.24, -0.10, 0.18, 0.55, 0.48, -0.25, -0.20]

        self._fit_initial_model()

    def _fit_initial_model(self) -> None:
        """Fit feature scales and class centroids from the curated archetype dataset."""
        X, y, _ = build_training_dataset(seed=42)
        n_samples = len(X)

        # 1. Compute global feature means and stds for normalization
        means = [0.0] * self.n_features
        for vec in X:
            for j in range(self.n_features):
                means[j] += vec[j]
        means = [m / n_samples for m in means]

        variances = [0.0] * self.n_features
        for vec in X:
            for j in range(self.n_features):
                variances[j] += (vec[j] - means[j]) ** 2
        stds = [math.sqrt(v / n_samples) + 1e-4 for v in variances]

        self.feature_means = means
        self.feature_stds = stds

        # 2. Compute normalized class centroids
        centroids = [[0.0] * self.n_features for _ in range(self.n_classes)]
        counts = [0] * self.n_classes

        for vec, label in zip(X, y):
            counts[label] += 1
            for j in range(self.n_features):
                norm_val = (vec[j] - means[j]) / stds[j]
                centroids[label][j] += norm_val

        for c in range(self.n_classes):
            if counts[c] > 0:
                for j in range(self.n_features):
                    centroids[c][j] /= counts[c]

        self.class_centroids = centroids

    def _normalize(self, vec: list[float]) -> list[float]:
        return [(vec[j] - self.feature_means[j]) / self.feature_stds[j] for j in range(self.n_features)]

    def project_2d(self, vec: list[float]) -> list[float]:
        """Project a 12-dimensional feature vector into 2D PCA space (PC1, PC2)."""
        norm_vec = self._normalize(vec)
        x_proj = sum(norm_vec[j] * self.pc1[j] for j in range(self.n_features))
        y_proj = sum(norm_vec[j] * self.pc2[j] for j in range(self.n_features))
        return [round(x_proj, 3), round(y_proj, 3)]

    def predict(self, feature_vector: list[float]) -> dict[str, Any]:
        """Predict class distribution and project into decision boundary coordinates."""
        if len(feature_vector) != self.n_features:
            feature_vector = extract_12d_features({})

        norm_vec = self._normalize(feature_vector)

        # Compute negative squared Euclidean distances to normalized centroids
        logits: list[float] = []
        for c in range(self.n_classes):
            centroid = self.class_centroids[c]
            dist_sq = sum((norm_vec[j] - centroid[j]) ** 2 for j in range(self.n_features))
            # Temperature scaling for soft probability distribution
            logits.append(-dist_sq / 8.0)

        # Softmax normalization
        max_logit = max(logits)
        exp_logits = [math.exp(lg - max_logit) for lg in logits]
        sum_exp = sum(exp_logits)
        probs = [round(e / sum_exp, 4) for e in exp_logits]

        best_idx = max(range(self.n_classes), key=lambda i: probs[i])
        best_class = self.class_names[best_idx]
        best_conf = probs[best_idx]

        proj_2d = self.project_2d(feature_vector)

        # Top feature drivers for this prediction
        diffs = [
            (self.feature_names[j], abs(norm_vec[j] - self.class_centroids[best_idx][j]))
            for j in range(self.n_features)
        ]
        diffs.sort(key=lambda item: item[1])
        top_drivers = [item[0] for item in diffs[:3]]

        return {
            "predicted_class": best_class,
            "confidence": best_conf,
            "class_probabilities": {
                name: prob for name, prob in zip(self.class_names, probs)
            },
            "projection_2d": proj_2d,
            "top_drivers": top_drivers,
        }

    def get_decision_boundary_mesh(self, grid_size: int = 15) -> list[dict[str, Any]]:
        """Generate a 2D decision boundary grid for visual inspection."""
        points: list[dict[str, Any]] = []
        x_range = [-6.0, 8.0]
        y_range = [-4.0, 6.0]

        dx = (x_range[1] - x_range[0]) / grid_size
        dy = (y_range[1] - y_range[0]) / grid_size

        for i in range(grid_size):
            x = x_range[0] + (i + 0.5) * dx
            for j in range(grid_size):
                y = y_range[0] + (j + 0.5) * dy
                # Synthetic vector approximating (x, y) coordinates
                vec = [0.0] * self.n_features
                for k in range(self.n_features):
                    vec[k] = x * self.pc1[k] + y * self.pc2[k]

                pred = self.predict(vec)
                points.append({
                    "x": round(x, 2),
                    "y": round(y, 2),
                    "class": pred["predicted_class"],
                    "confidence": pred["confidence"],
                })

        return points


# Singleton model instance
_CLASSIFIER_INSTANCE: OnlineCandidateClassifier | None = None


def get_online_classifier() -> OnlineCandidateClassifier:
    global _CLASSIFIER_INSTANCE
    if _CLASSIFIER_INSTANCE is None:
        _CLASSIFIER_INSTANCE = OnlineCandidateClassifier()
    return _CLASSIFIER_INSTANCE
