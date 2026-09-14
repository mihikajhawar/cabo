"""
Taxi-v3 environment wrapper.

Gymnasium's Taxi-v3 is a classic "gridworld" RL benchmark:

    - The world is a 5x5 grid with four marked locations: R, G, Y, B.
    - A taxi must drive to a passenger, pick them up, then drive to the
      passenger's destination and drop them off.
    - The environment is fully observable and discrete, which makes it a
      great teaching example for tabular Q-learning (no neural network
      or function approximation needed).

STATE SPACE (Discrete(500)):
    Every state is a single integer in [0, 499] that *encodes* four
    pieces of information:
        taxi_row   in [0, 4]   -> 5 values
        taxi_col   in [0, 4]   -> 5 values
        passenger  in [0, 4]   -> 5 values (4 pickup points + "in taxi")
        destination in [0, 3]  -> 4 values (4 drop-off points)
    5 * 5 * 5 * 4 = 500 total states.

ACTION SPACE (Discrete(6)):
    0 = move south
    1 = move north
    2 = move east
    3 = move west
    4 = pickup passenger
    5 = drop off passenger

REWARD STRUCTURE (built into the environment):
    -1   for every step (encourages the agent to be efficient)
    +20  for a successful drop-off
    -10  for an illegal pickup/drop-off action
"""

from __future__ import annotations

from dataclasses import dataclass

import gymnasium as gym

ENV_ID = "Taxi-v3"

ACTION_NAMES = {
    0: "South",
    1: "North",
    2: "East",
    3: "West",
    4: "Pickup",
    5: "Drop-off",
}

# Fixed locations used by Taxi-v3 (row, col), matching the env's internal map.
LOCATIONS = {
    "R": (0, 0),
    "G": (0, 4),
    "Y": (4, 0),
    "B": (4, 3),
}
LOCATION_LIST = ["R", "G", "Y", "B"]  # index order used by the env encoding


@dataclass
class DecodedState:
    """Human-readable breakdown of a Taxi-v3 integer state."""

    taxi_row: int
    taxi_col: int
    passenger_idx: int  # 0-3 = at a location, 4 = inside the taxi
    destination_idx: int  # 0-3

    @property
    def passenger_in_taxi(self) -> bool:
        return self.passenger_idx == 4

    @property
    def passenger_location(self) -> tuple[int, int] | None:
        if self.passenger_in_taxi:
            return None
        return LOCATIONS[LOCATION_LIST[self.passenger_idx]]

    @property
    def destination_location(self) -> tuple[int, int]:
        return LOCATIONS[LOCATION_LIST[self.destination_idx]]


def make_env(render_mode: str | None = None) -> gym.Env:
    """Create a fresh Taxi-v3 environment instance."""
    return gym.make(ENV_ID, render_mode=render_mode)


def decode_state(env: gym.Env, state: int) -> DecodedState:
    """Turn the integer state id into its 4 underlying variables."""
    taxi_row, taxi_col, passenger_idx, destination_idx = env.unwrapped.decode(state)
    return DecodedState(int(taxi_row), int(taxi_col), int(passenger_idx), int(destination_idx))


def get_space_sizes(env: gym.Env) -> tuple[int, int]:
    """Return (num_states, num_actions) for the environment."""
    return env.observation_space.n, env.action_space.n
