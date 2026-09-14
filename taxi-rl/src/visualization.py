"""
Matplotlib chart generation.

All plots use a shared dark, presentation-ready style so figures look
consistent whether they are saved to results/*.png or rendered inline
inside the Streamlit dashboard.
"""

from __future__ import annotations

import matplotlib
import matplotlib.pyplot as plt
import numpy as np

matplotlib.use("Agg")  # safe for headless / server-side rendering

BG = "#0e1117"
PANEL = "#161b22"
ACCENT = "#facc15"   # amber - Q-learning
ACCENT2 = "#38bdf8"  # blue - random policy / secondary series
GRID = "#30363d"
TEXT = "#e6edf3"


def _style_axes(ax):
    ax.set_facecolor(PANEL)
    ax.tick_params(colors=TEXT, labelsize=9)
    ax.xaxis.label.set_color(TEXT)
    ax.yaxis.label.set_color(TEXT)
    ax.title.set_color(TEXT)
    for spine in ax.spines.values():
        spine.set_color(GRID)
    ax.grid(True, color=GRID, linewidth=0.6, alpha=0.6)


def _new_fig(figsize=(8, 4.5)):
    fig, ax = plt.subplots(figsize=figsize)
    fig.patch.set_facecolor(BG)
    _style_axes(ax)
    return fig, ax


def plot_reward_progression(episode_rewards, moving_avg_window: int = 100, save_path: str | None = None):
    rewards = np.array(episode_rewards, dtype=float)
    fig, ax = _new_fig()
    ax.plot(rewards, color=ACCENT2, alpha=0.35, linewidth=0.8, label="Episode reward")

    if len(rewards) >= 2:
        window = min(moving_avg_window, len(rewards))
        moving_avg = np.convolve(rewards, np.ones(window) / window, mode="valid")
        ax.plot(
            np.arange(window - 1, len(rewards)),
            moving_avg,
            color=ACCENT,
            linewidth=2.2,
            label=f"Moving average ({window})",
        )

    ax.set_xlabel("Episode")
    ax.set_ylabel("Total Reward")
    ax.set_title("Reward Progression During Training")
    legend = ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, fontsize=9)
    fig.tight_layout()
    if save_path:
        fig.savefig(save_path, dpi=150, facecolor=BG)
    return fig


def plot_steps_progression(episode_steps, moving_avg_window: int = 100, save_path: str | None = None):
    steps = np.array(episode_steps, dtype=float)
    fig, ax = _new_fig()
    ax.plot(steps, color=ACCENT2, alpha=0.35, linewidth=0.8, label="Steps per episode")

    if len(steps) >= 2:
        window = min(moving_avg_window, len(steps))
        moving_avg = np.convolve(steps, np.ones(window) / window, mode="valid")
        ax.plot(
            np.arange(window - 1, len(steps)),
            moving_avg,
            color=ACCENT,
            linewidth=2.2,
            label=f"Moving average ({window})",
        )

    ax.set_xlabel("Episode")
    ax.set_ylabel("Steps Taken")
    ax.set_title("Steps per Episode During Training")
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, fontsize=9)
    fig.tight_layout()
    if save_path:
        fig.savefig(save_path, dpi=150, facecolor=BG)
    return fig


def plot_epsilon_decay(epsilon_history, save_path: str | None = None):
    fig, ax = _new_fig()
    ax.plot(epsilon_history, color=ACCENT, linewidth=2.0)
    ax.set_xlabel("Episode")
    ax.set_ylabel("Epsilon (exploration rate)")
    ax.set_title("Epsilon Decay Over Training (Exploration -> Exploitation)")
    fig.tight_layout()
    if save_path:
        fig.savefig(save_path, dpi=150, facecolor=BG)
    return fig


def plot_policy_comparison(random_summary: dict, qlearning_summary: dict, save_path: str | None = None):
    metrics = ["avg_reward", "avg_steps", "success_rate"]
    labels = ["Avg Reward", "Avg Steps", "Success Rate (%)"]

    random_vals = [
        random_summary["avg_reward"],
        random_summary["avg_steps"],
        random_summary["success_rate"] * 100,
    ]
    q_vals = [
        qlearning_summary["avg_reward"],
        qlearning_summary["avg_steps"],
        qlearning_summary["success_rate"] * 100,
    ]

    fig, axes = plt.subplots(1, 3, figsize=(12, 4.2))
    fig.patch.set_facecolor(BG)
    for ax, label, r_val, q_val in zip(axes, labels, random_vals, q_vals):
        _style_axes(ax)
        bars = ax.bar(
            ["Random", "Q-Learning"],
            [r_val, q_val],
            color=[ACCENT2, ACCENT],
            width=0.55,
        )
        ax.set_title(label, fontsize=11)
        for bar in bars:
            height = bar.get_height()
            ax.annotate(
                f"{height:.1f}",
                xy=(bar.get_x() + bar.get_width() / 2, height),
                xytext=(0, 4),
                textcoords="offset points",
                ha="center",
                color=TEXT,
                fontsize=9,
            )
    fig.suptitle("Random Policy vs. Q-Learning", color=TEXT, fontsize=13)
    fig.tight_layout()
    if save_path:
        fig.savefig(save_path, dpi=150, facecolor=BG)
    return fig


def plot_reward_distribution(random_rewards, qlearning_rewards, save_path: str | None = None):
    fig, ax = _new_fig()
    bins = np.linspace(
        min(np.min(random_rewards), np.min(qlearning_rewards)),
        max(np.max(random_rewards), np.max(qlearning_rewards)),
        30,
    )
    ax.hist(random_rewards, bins=bins, alpha=0.55, color=ACCENT2, label="Random Policy")
    ax.hist(qlearning_rewards, bins=bins, alpha=0.75, color=ACCENT, label="Q-Learning")
    ax.set_xlabel("Total Episode Reward")
    ax.set_ylabel("Number of Episodes")
    ax.set_title("Evaluation Reward Distribution")
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TEXT, fontsize=9)
    fig.tight_layout()
    if save_path:
        fig.savefig(save_path, dpi=150, facecolor=BG)
    return fig
