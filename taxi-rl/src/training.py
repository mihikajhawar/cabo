"""
Training loop for the Q-learning agent on Taxi-v3.

Each *episode* is one full pickup-and-dropoff attempt. Over many episodes
the agent's Q-table converges towards the true action-values, and its
behaviour shifts from mostly random (epsilon ~= 1.0) to mostly optimal
(epsilon ~= epsilon_min).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .environment import make_env, get_space_sizes
from .q_learning import QLearningAgent


@dataclass
class TrainingHistory:
    """Everything we track during training, used later for plots/metrics."""

    episode_rewards: list[float] = field(default_factory=list)
    episode_steps: list[int] = field(default_factory=list)
    epsilon_history: list[float] = field(default_factory=list)

    def moving_average(self, window: int = 100) -> np.ndarray:
        rewards = np.array(self.episode_rewards, dtype=float)
        if len(rewards) < window:
            window = max(1, len(rewards))
        kernel = np.ones(window) / window
        return np.convolve(rewards, kernel, mode="valid")


def train_agent(
    learning_rate: float = 0.1,
    discount_factor: float = 0.95,
    epsilon: float = 1.0,
    epsilon_decay: float = 0.995,
    epsilon_min: float = 0.01,
    episodes: int = 10000,
    max_steps: int = 200,
    seed: int | None = 42,
    progress_callback=None,
) -> tuple[QLearningAgent, TrainingHistory]:
    """
    Run the full Q-learning training loop.

    progress_callback, if given, is called as progress_callback(episode,
    episodes, history) every 100 episodes -- used by the Streamlit UI to
    show a live progress bar without importing Streamlit into this module.
    """
    env = make_env()
    n_states, n_actions = get_space_sizes(env)

    agent = QLearningAgent(
        n_states,
        n_actions,
        learning_rate=learning_rate,
        discount_factor=discount_factor,
        epsilon=epsilon,
        epsilon_decay=epsilon_decay,
        epsilon_min=epsilon_min,
        seed=seed,
    )
    history = TrainingHistory()

    for episode in range(episodes):
        state, _ = env.reset(seed=None if seed is None else seed + episode)
        total_reward = 0.0
        steps = 0

        for _ in range(max_steps):
            action = agent.select_action(state)
            next_state, reward, terminated, truncated, _ = env.step(action)
            done = terminated or truncated

            agent.update(state, action, reward, next_state, done)

            state = next_state
            total_reward += reward
            steps += 1
            if done:
                break

        agent.decay_epsilon()

        history.episode_rewards.append(total_reward)
        history.episode_steps.append(steps)
        history.epsilon_history.append(agent.epsilon)

        if progress_callback is not None and (episode + 1) % 100 == 0:
            progress_callback(episode + 1, episodes, history)

    env.close()
    return agent, history


def save_q_table(agent: QLearningAgent, path: str) -> None:
    agent.save(path)


def main() -> None:
    """
    Standalone training entry point.

    Run with: python -m src.training
    Trains with the default hyperparameters, saves the Q-table and
    training history to models/, and writes the training-progress plots
    to results/. This is the same code path the Streamlit app uses when
    you click "Train / Retrain Agent".
    """
    import os

    from .evaluation import evaluate_policy
    from .random_policy import RandomPolicy
    from . import visualization as viz

    os.makedirs("models", exist_ok=True)
    os.makedirs("results", exist_ok=True)

    print("Training Q-learning agent on Taxi-v3 ...")
    agent, history = train_agent()

    agent.save("models/taxi_q_table.npy")
    np.savez(
        "models/training_history.npz",
        episode_rewards=np.array(history.episode_rewards),
        episode_steps=np.array(history.episode_steps),
        epsilon_history=np.array(history.epsilon_history),
    )
    print(f"Saved Q-table to models/taxi_q_table.npy  (shape={agent.q_table.shape})")

    viz.plot_reward_progression(history.episode_rewards, save_path="results/reward_progression.png")
    viz.plot_steps_progression(history.episode_steps, save_path="results/steps_progression.png")
    viz.plot_epsilon_decay(history.epsilon_history, save_path="results/epsilon_decay.png")

    print("\nEvaluating trained agent (100 episodes, greedy policy)...")
    eval_q = evaluate_policy(agent, episodes=100)
    print(eval_q.summary())

    print("\nEvaluating random-policy baseline (100 episodes)...")
    eval_random = evaluate_policy(RandomPolicy(agent.n_actions, seed=1), episodes=100)
    print(eval_random.summary())

    viz.plot_policy_comparison(eval_random.summary(), eval_q.summary(), save_path="results/policy_comparison.png")
    viz.plot_reward_distribution(eval_random.rewards, eval_q.rewards, save_path="results/reward_distribution.png")
    print("\nSaved plots to results/")


if __name__ == "__main__":
    main()
