"""
Tabular Q-learning agent.

Q-learning is a *model-free, off-policy* reinforcement learning algorithm.
It learns the value of taking action `a` in state `s` — written Q(s, a) —
without needing to know the environment's transition probabilities.

The learned quantity, Q(s, a), approximates the expected total future
reward of taking action `a` in state `s` and then acting optimally
afterwards.

BELLMAN / Q-LEARNING UPDATE RULE:

    Q(s, a) <- Q(s, a) + alpha * [ r + gamma * max_a' Q(s', a') - Q(s, a) ]

    - alpha (learning_rate): how much we trust the new information vs.
      the old estimate. alpha=0 -> never learn, alpha=1 -> overwrite fully.
    - gamma (discount_factor): how much we value future reward vs.
      immediate reward. gamma close to 1 -> far-sighted agent.
    - r: the immediate reward received.
    - max_a' Q(s', a'): the best possible value achievable from the next
      state s' — this is the "bootstrap" term that lets Q-learning learn
      before an episode even finishes.
    - The bracketed term [r + gamma*max Q(s',a') - Q(s,a)] is called the
      TD error (temporal-difference error): the gap between what we
      expected and what we now believe is true.

This is "off-policy" because the update uses max_a' Q(s', a') (the best
possible next action) regardless of which action the agent actually takes
next — the agent can explore randomly while still learning the optimal
policy.
"""

from __future__ import annotations

import numpy as np


class QLearningAgent:
    """A tabular Q-learning agent for discrete state/action spaces."""

    def __init__(
        self,
        n_states: int,
        n_actions: int,
        learning_rate: float = 0.1,
        discount_factor: float = 0.95,
        epsilon: float = 1.0,
        epsilon_decay: float = 0.995,
        epsilon_min: float = 0.01,
        seed: int | None = None,
    ):
        self.n_states = n_states
        self.n_actions = n_actions
        self.alpha = learning_rate
        self.gamma = discount_factor
        self.epsilon = epsilon
        self.epsilon_decay = epsilon_decay
        self.epsilon_min = epsilon_min

        # The Q-table: one row per state, one column per action.
        # Initialized to zero -> the agent starts with no knowledge at all
        # ("optimistic-neutral" initialization).
        self.q_table = np.zeros((n_states, n_actions))

        self.rng = np.random.default_rng(seed)

    def select_action(self, state: int, greedy: bool = False) -> int:
        """
        Epsilon-greedy action selection.

        With probability epsilon: EXPLORE by picking a random action.
        This lets the agent discover new states/rewards it wouldn't find
        by always trusting its current (possibly wrong) estimates.

        Otherwise: EXPLOIT by picking the action with the highest known
        Q-value for the current state — i.e. act on what it has learned
        so far.

        `greedy=True` forces pure exploitation, used at evaluation time
        once training is done (no more exploring needed).
        """
        if not greedy and self.rng.random() < self.epsilon:
            return int(self.rng.integers(self.n_actions))
        return int(np.argmax(self.q_table[state]))

    def update(self, state: int, action: int, reward: float, next_state: int, done: bool) -> None:
        """Apply one Q-learning (Bellman) update step."""
        best_next_value = 0.0 if done else np.max(self.q_table[next_state])
        td_target = reward + self.gamma * best_next_value
        td_error = td_target - self.q_table[state, action]
        self.q_table[state, action] += self.alpha * td_error

    def decay_epsilon(self) -> None:
        """Shrink epsilon after each episode so the agent explores less
        over time as it becomes more confident in its Q-values."""
        self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)

    def save(self, path: str) -> None:
        np.save(path, self.q_table)

    def load(self, path: str) -> None:
        self.q_table = np.load(path)
        self.n_states, self.n_actions = self.q_table.shape

    @classmethod
    def from_q_table(cls, q_table: np.ndarray, **kwargs) -> "QLearningAgent":
        n_states, n_actions = q_table.shape
        agent = cls(n_states, n_actions, **kwargs)
        agent.q_table = q_table
        return agent
