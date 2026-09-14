# 🚕 Intelligent Taxi Routing — Q-Learning on Gymnasium Taxi-v3

An end-to-end reinforcement learning project: a tabular **Q-learning** agent
learns to pick up a passenger and drop them at the correct destination in
the classic **Taxi-v3** gridworld, with a polished **Streamlit** dashboard
for training, evaluating, and watching the agent drive.

```
taxi-rl/
├── app.py                       # Streamlit dashboard
├── requirements.txt
├── README.md
├── src/
│   ├── environment.py           # Taxi-v3 wrapper + state decoding
│   ├── q_learning.py            # QLearningAgent (Bellman update, epsilon-greedy)
│   ├── training.py              # Training loop + CLI entry point
│   ├── evaluation.py            # Policy evaluation & failure-case detection
│   ├── random_policy.py         # Random-action baseline
│   └── visualization.py         # Matplotlib chart generation
├── models/
│   ├── taxi_q_table.npy         # Trained Q-table (500 states x 6 actions)
│   └── training_history.npz     # Reward/steps/epsilon history
├── results/
│   ├── reward_progression.png
│   ├── steps_progression.png
│   ├── epsilon_decay.png
│   ├── policy_comparison.png
│   └── reward_distribution.png
└── notebooks/
    └── taxi_q_learning.ipynb    # Same pipeline, explained cell-by-cell
```

---

## 1. Project Overview

The agent controls a taxi on a 5x5 grid. It must:
1. Drive to the passenger's location and **pick them up**.
2. Drive to the correct destination and **drop them off**.

It learns to do this purely from trial and error — no human ever tells it
"turn left here." It only receives a numeric reward after each action, and
over thousands of attempts it works out which actions lead to the best
long-term outcome.

## 2. Problem Statement

Efficient point-to-point routing with pickup/drop-off constraints is a
simplified stand-in for real-world problems like ride-hailing dispatch,
warehouse robot navigation, and delivery routing. Taxi-v3 keeps the state
and action spaces small enough to solve exactly with a lookup table, which
makes the underlying RL concepts easy to inspect and explain.

## 3. What is Reinforcement Learning?

Reinforcement learning (RL) is a branch of machine learning where an
**agent** learns to make decisions by interacting with an **environment**:

- At each timestep the agent observes a **state**.
- It chooses an **action**.
- The environment returns a **reward** and a **new state**.
- The agent's goal is to maximize its *cumulative* reward over time, not
  just the immediate one.

Unlike supervised learning, there's no labeled "correct action" — the
agent must discover good behavior itself through **exploration** and
feedback.

## 4. The Taxi-v3 Environment

Taxi-v3 (from [Gymnasium](https://gymnasium.farama.org/environments/toy_text/taxi/))
is a discrete, fully-observable gridworld:

- A 5x5 grid with four marked locations: **R** (red), **G** (green),
  **Y** (yellow), **B** (blue).
- One of the four is the passenger's pickup point; another is the
  destination.
- A few internal walls restrict certain moves between cells.

## 5. State Space

`Discrete(500)`. Each state is a single integer that encodes four
variables:

| Variable          | Range  | Meaning                                |
|-------------------|--------|-----------------------------------------|
| taxi row           | 0–4    | Taxi's row on the grid                  |
| taxi column        | 0–4    | Taxi's column on the grid               |
| passenger location | 0–4    | 0-3 = at R/G/Y/B, 4 = inside the taxi   |
| destination        | 0–3    | Which of R/G/Y/B is the drop-off point  |

`5 x 5 x 5 x 4 = 500` total states. `env.unwrapped.decode(state)` and
`env.unwrapped.encode(...)` convert between the integer and these four
variables (see `src/environment.py::decode_state`).

## 6. Action Space

`Discrete(6)`:

| Action | Meaning       |
|--------|---------------|
| 0      | Move South    |
| 1      | Move North    |
| 2      | Move East     |
| 3      | Move West     |
| 4      | Pickup        |
| 5      | Drop-off      |

## 7. Reward System

Built into the environment:

- **-1** for every step taken (encourages short, efficient routes)
- **+20** for a successful drop-off (episode ends)
- **-10** for an illegal pickup or drop-off (e.g. dropping off with no
  passenger aboard, or picking up at the wrong cell)

Because every step costs -1, the optimal policy is not just "eventually
succeed" but "succeed in as few steps as possible."

## 8. Q-Learning Algorithm

Q-learning is a **model-free, off-policy, tabular** RL algorithm. It
maintains a table `Q(s, a)` estimating the expected total future reward
of taking action `a` in state `s` and then acting optimally afterwards.

Training loop, per episode:
1. Reset the environment, get the initial state.
2. Repeat until done or `max_steps` reached:
   - Choose an action with **epsilon-greedy** selection.
   - Take the action, observe `reward` and `next_state`.
   - Update `Q(s, a)` using the Bellman equation (below).
   - Move to `next_state`.
3. Decay epsilon.

Implementation: `src/q_learning.py::QLearningAgent`.

## 9. The Bellman / Q-Learning Equation

```
Q(s, a) <- Q(s, a) + alpha * [ r + gamma * max_a' Q(s', a') - Q(s, a) ]
```

- **alpha** (learning rate): how much new information overrides the old
  estimate.
- **gamma** (discount factor): how much future reward matters relative to
  immediate reward.
- **r**: the reward just received.
- **max_a' Q(s', a')**: the best value achievable from the next state —
  this "bootstraps" the update using the agent's own current estimates,
  which is what lets it learn before an episode finishes.
- The bracketed term is the **TD (temporal-difference) error**: the gap
  between what the agent expected and what it now believes.

This is *off-policy* because the update always uses the **best possible**
next action (`max`), regardless of which action the agent actually takes
next (which might be a random exploratory action).

## 10. Epsilon-Greedy Strategy

At each step:
- With probability `epsilon`: take a **random** action (**explore**).
- Otherwise: take `argmax_a Q(s, a)`, the best known action (**exploit**).

`epsilon` starts high (1.0 = always explore) and decays multiplicatively
after every episode (`epsilon *= epsilon_decay`) down to a small floor
(`epsilon_min`), so the agent explores heavily early on and increasingly
trusts its learned values as training progresses.

## 11. Hyperparameters

| Hyperparameter     | Default | Meaning                                    |
|---------------------|---------|---------------------------------------------|
| `learning_rate`      | 0.1     | alpha in the Bellman update                 |
| `discount_factor`    | 0.95    | gamma in the Bellman update                 |
| `epsilon`            | 1.0     | initial exploration rate                    |
| `epsilon_decay`      | 0.995   | multiplicative decay per episode            |
| `epsilon_min`        | 0.01    | floor for epsilon                           |
| `episodes`           | 10000   | number of training episodes                 |
| `max_steps`          | 200     | step cap per episode (avoids infinite loops)|

All of these are configurable sliders in the Streamlit sidebar.

## 12. Training Process

Run standalone:
```bash
python -m src.training
```
This trains with the defaults above, then:
- Saves the Q-table to `models/taxi_q_table.npy`
- Saves reward/steps/epsilon history to `models/training_history.npz`
- Saves training-progress charts to `results/`
- Prints an evaluation summary for both the trained agent and a random
  baseline

You can also retrain from inside the Streamlit app with custom
hyperparameters via the **"Train / Retrain Agent"** button.

## 13. Evaluation

`src/evaluation.py::evaluate_policy` runs a policy **greedily** (no
exploration) for a configurable number of episodes (100 by default) and
reports:
- **Average reward**
- **Reward standard deviation**
- **Average steps**
- **Success rate** (fraction of episodes that ended in a real drop-off,
  as opposed to hitting `max_steps`)

## 14. Random-Policy Comparison

`src/random_policy.py::RandomPolicy` picks a uniformly random action every
step, ignoring the state. It's evaluated with the exact same
`evaluate_policy` function so the comparison is apples-to-apples. This is
the baseline the trained agent is measured against throughout the
dashboard.

## 15. Results

From a full training run (10,000 episodes, default hyperparameters),
evaluated over 100 episodes each:

| Metric         | Random Policy | Q-Learning |
|-----------------|---------------|------------|
| Avg Reward       | ≈ -789        | ≈ +7.7     |
| Avg Steps        | ≈ 200 (capped)| ≈ 13.3     |
| Success Rate     | ≈ 2%          | **100%**   |

The trained agent reliably solves the task in roughly 13 steps, versus the
random policy almost always timing out at `max_steps` without ever
delivering the passenger. Exact numbers vary slightly run to run since
Taxi-v3's start states are randomized.

## 16. Limitations

- **Tabular** approach: only scales to environments with a small, discrete
  state space (500 states here). It would not extend directly to
  continuous or high-dimensional states without function approximation
  (e.g. Deep Q-Networks).
- **No generalization**: the Q-table has a separate value for every state;
  it doesn't generalize learned behavior to unseen states the way a neural
  network would.
- **Stochastic convergence**: with a fixed training budget, a small number
  of rarely-visited states may retain suboptimal Q-values (see the
  in-app Failure Analysis section).

## 17. Future Improvements

- Deep Q-Networks (DQN) for environments with larger/continuous state
  spaces.
- Reward shaping or curriculum learning to accelerate convergence.
- Multi-agent routing (multiple taxis, shared city grid).
- SARSA / Expected SARSA as an on-policy alternative for comparison.

## 18. Installation

Requires Python 3.9+.

```bash
git clone <this-repo>
cd taxi-rl
pip install -r requirements.txt
```

## 19. How to Run

**Train from the command line** (optional — a pretrained `models/taxi_q_table.npy`
is already included in this repo):
```bash
python -m src.training
```

**Launch the interactive dashboard:**
```bash
streamlit run app.py
```

Then open the URL Streamlit prints (typically http://localhost:8501) in
your browser. From there you can:
- Tune hyperparameters in the sidebar and retrain live
- Watch the learning curves and epsilon decay
- Compare Q-learning vs. the random-policy baseline
- Run the trained agent on the animated taxi grid (Play or Step-by-Step)
- Inspect learned Q-values for any hand-picked state
- Review failure-case episodes and why they happen

**Explore the notebook:**
```bash
jupyter notebook notebooks/taxi_q_learning.ipynb
```
