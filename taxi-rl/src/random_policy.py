"""
Random policy baseline.

To show that Q-learning actually *learned* something, we need a baseline
to compare against. The simplest possible baseline is an agent that picks
a uniformly random action at every step, ignoring the state entirely.

Any competent learning algorithm should dramatically outperform this,
both in reward and in the number of steps needed to complete the task.
"""

from __future__ import annotations

import numpy as np


class RandomPolicy:
    """Baseline policy: choose a uniformly random action every step."""

    def __init__(self, n_actions: int, seed: int | None = None):
        self.n_actions = n_actions
        self.rng = np.random.default_rng(seed)

    def select_action(self, state: int, greedy: bool = False) -> int:
        # `state` and `greedy` are unused - the random policy ignores both,
        # that's precisely what makes it a naive baseline.
        return int(self.rng.integers(self.n_actions))
