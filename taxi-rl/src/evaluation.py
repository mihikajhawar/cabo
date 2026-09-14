"""
Evaluation utilities: run a policy for many episodes and compute metrics.

Used for both:
    - the trained Q-learning agent (greedy, no exploration)
    - the random-policy baseline

so the two can be compared fairly on identical terms.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .environment import make_env


@dataclass
class EpisodeRecord:
    episode: int
    total_reward: float
    steps: int
    success: bool  # passenger was dropped off correctly before max_steps


@dataclass
class EvaluationResult:
    records: list[EpisodeRecord] = field(default_factory=list)

    @property
    def rewards(self) -> np.ndarray:
        return np.array([r.total_reward for r in self.records], dtype=float)

    @property
    def steps(self) -> np.ndarray:
        return np.array([r.steps for r in self.records], dtype=float)

    @property
    def avg_reward(self) -> float:
        return float(np.mean(self.rewards))

    @property
    def std_reward(self) -> float:
        return float(np.std(self.rewards))

    @property
    def avg_steps(self) -> float:
        return float(np.mean(self.steps))

    @property
    def success_rate(self) -> float:
        return float(np.mean([r.success for r in self.records]))

    def failure_cases(self, reward_threshold: float = 0.0) -> list[EpisodeRecord]:
        """Episodes that hit max_steps, failed to deliver, or scored low."""
        return [
            r for r in self.records
            if (not r.success) or r.total_reward < reward_threshold
        ]

    def summary(self) -> dict:
        return {
            "avg_reward": self.avg_reward,
            "std_reward": self.std_reward,
            "avg_steps": self.avg_steps,
            "success_rate": self.success_rate,
            "episodes": len(self.records),
        }


def evaluate_policy(policy, episodes: int = 100, max_steps: int = 200, seed: int | None = 123) -> EvaluationResult:
    """
    Run `policy` (anything with a `select_action(state, greedy=True)`
    method - QLearningAgent or RandomPolicy both qualify) for a fixed
    number of episodes and collect per-episode statistics.
    """
    env = make_env()
    result = EvaluationResult()

    for episode in range(episodes):
        state, _ = env.reset(seed=None if seed is None else seed + episode)
        total_reward = 0.0
        steps = 0
        terminated = False
        truncated = False

        for _ in range(max_steps):
            action = policy.select_action(state, greedy=True)
            state, reward, terminated, truncated, _ = env.step(action)
            total_reward += reward
            steps += 1
            if terminated or truncated:
                break

        # Taxi-v3 only sets terminated=True on a successful drop-off.
        success = bool(terminated and not truncated)
        result.records.append(EpisodeRecord(episode, total_reward, steps, success))

    env.close()
    return result
