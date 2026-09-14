"""
Streamlit dashboard for the Intelligent Taxi Routing (Q-Learning) project.

This file is UI glue only - all the actual RL logic lives in `src/`.
Keeping the two separated means you can explain the algorithm (src/)
and the demo (app.py) as two independent, understandable pieces.
"""

from __future__ import annotations

import time

import numpy as np
import pandas as pd
import streamlit as st

from src.environment import ACTION_NAMES, LOCATIONS, LOCATION_LIST, decode_state, make_env, get_space_sizes
from src.q_learning import QLearningAgent
from src.random_policy import RandomPolicy
from src.training import train_agent
from src.evaluation import evaluate_policy
from src import visualization as viz

MODEL_PATH = "models/taxi_q_table.npy"
HISTORY_PATH = "models/training_history.npz"

LOCATION_COLORS = {"R": "#ef4444", "G": "#22c55e", "Y": "#eab308", "B": "#3b82f6"}
# Walls to the right of these (row, col) cells, matching Taxi-v3's built-in map.
WALLS_RIGHT = {(0, 1), (1, 1), (3, 0), (3, 2), (4, 0), (4, 2)}

st.set_page_config(
    page_title="Intelligent Taxi Routing - Q-Learning",
    page_icon="🚕",
    layout="wide",
)

# --------------------------------------------------------------------------
# Global styling: dark theme + glass-card panels
# --------------------------------------------------------------------------
st.markdown(
    """
    <style>
    .stApp { background: radial-gradient(circle at 20% -10%, #1b2130 0%, #0e1117 45%); }
    h1, h2, h3 { letter-spacing: -0.02em; }
    div[data-testid="stVerticalBlockBorderWrapper"] > div {
        background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015));
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 16px;
    }
    div[data-testid="stMetric"] {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        padding: 12px 14px;
    }
    .badge {
        display: inline-block; padding: 3px 12px; border-radius: 999px;
        font-size: 0.75rem; font-weight: 600; margin-right: 8px;
        border: 1px solid rgba(255,255,255,0.15);
    }
    .badge-amber { background: rgba(250,204,21,0.15); color: #facc15; }
    .badge-blue { background: rgba(56,189,248,0.15); color: #38bdf8; }
    .subtitle { color: #9aa4b2; font-size: 1.02rem; margin-top: -8px; }
    .cell-grid {
        display: grid; grid-template-columns: repeat(5, 64px); gap: 3px;
        background: #05070a; padding: 10px; border-radius: 14px; width: fit-content;
        border: 1px solid rgba(255,255,255,0.08);
    }
    .cell {
        width: 64px; height: 64px; border-radius: 6px; position: relative;
        display: flex; align-items: center; justify-content: center;
        background: #161b22; font-size: 26px;
    }
    .cell .loc-label {
        position: absolute; top: 2px; left: 5px; font-size: 11px; font-weight: 700; opacity: 0.85;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

# --------------------------------------------------------------------------
# Header
# --------------------------------------------------------------------------
st.markdown(
    """
    <span class="badge badge-amber">Q-Learning</span><span class="badge badge-blue">Taxi-v3</span>
    """,
    unsafe_allow_html=True,
)
st.title("🚕 Intelligent Taxi Routing")
st.markdown('<p class="subtitle">Learning optimal navigation through reinforcement learning</p>', unsafe_allow_html=True)
st.write("")

# --------------------------------------------------------------------------
# Session state / model loading
# --------------------------------------------------------------------------
env = make_env()
n_states, n_actions = get_space_sizes(env)

if "agent" not in st.session_state:
    st.session_state.history = None
    try:
        q_table = np.load(MODEL_PATH)
        st.session_state.agent = QLearningAgent.from_q_table(q_table)
        try:
            data = np.load(HISTORY_PATH)
            st.session_state.history = {
                "episode_rewards": data["episode_rewards"].tolist(),
                "episode_steps": data["episode_steps"].tolist(),
                "epsilon_history": data["epsilon_history"].tolist(),
            }
        except FileNotFoundError:
            pass
    except FileNotFoundError:
        st.session_state.agent = QLearningAgent(n_states, n_actions)

if "eval_q" not in st.session_state:
    st.session_state.eval_q = None
    st.session_state.eval_random = None

# --------------------------------------------------------------------------
# Sidebar: hyperparameters
# --------------------------------------------------------------------------
with st.sidebar:
    st.header("Hyperparameters")
    learning_rate = st.slider("Learning Rate (alpha)", 0.01, 1.0, 0.1, 0.01)
    discount_factor = st.slider("Discount Factor (gamma)", 0.50, 0.999, 0.95, 0.001)
    initial_epsilon = st.slider("Initial Epsilon", 0.1, 1.0, 1.0, 0.05)
    epsilon_decay = st.slider("Epsilon Decay", 0.90, 0.999, 0.995, 0.001)
    epsilon_min = st.slider("Epsilon Min", 0.001, 0.2, 0.01, 0.001)
    episodes = st.number_input("Training Episodes", 100, 50000, 10000, 100)
    max_steps = st.number_input("Max Steps per Episode", 20, 500, 200, 10)

    st.divider()
    train_clicked = st.button("🚀 Train / Retrain Agent", width="stretch", type="primary")

    st.divider()
    st.caption(
        "**Exploration vs. Exploitation**\n\n"
        "Epsilon controls how often the agent tries a random action "
        "(explore) instead of its current best-known action (exploit). "
        "It starts high so the agent sees lots of the environment, then "
        "decays so the agent increasingly relies on what it has learned."
    )

# --------------------------------------------------------------------------
# Training
# --------------------------------------------------------------------------
if train_clicked:
    progress_bar = st.progress(0, text="Training agent...")

    def _cb(ep, total, history):
        progress_bar.progress(ep / total, text=f"Training agent... episode {ep}/{total}")

    agent, history = train_agent(
        learning_rate=learning_rate,
        discount_factor=discount_factor,
        epsilon=initial_epsilon,
        epsilon_decay=epsilon_decay,
        epsilon_min=epsilon_min,
        episodes=int(episodes),
        max_steps=int(max_steps),
        progress_callback=_cb,
    )
    progress_bar.progress(1.0, text="Training complete.")

    agent.save(MODEL_PATH)
    np.savez(
        HISTORY_PATH,
        episode_rewards=np.array(history.episode_rewards),
        episode_steps=np.array(history.episode_steps),
        epsilon_history=np.array(history.epsilon_history),
    )

    st.session_state.agent = agent
    st.session_state.history = {
        "episode_rewards": history.episode_rewards,
        "episode_steps": history.episode_steps,
        "epsilon_history": history.epsilon_history,
    }

    with st.spinner("Evaluating trained agent vs. random baseline..."):
        st.session_state.eval_q = evaluate_policy(agent, episodes=100, max_steps=int(max_steps))
        st.session_state.eval_random = evaluate_policy(
            RandomPolicy(n_actions, seed=1), episodes=100, max_steps=int(max_steps)
        )
    st.success("Training finished and Q-table saved to models/taxi_q_table.npy")

agent: QLearningAgent = st.session_state.agent
history = st.session_state.history

# Auto-run evaluation once if a trained model exists but hasn't been evaluated yet this session.
if history is not None and st.session_state.eval_q is None:
    st.session_state.eval_q = evaluate_policy(agent, episodes=100, max_steps=int(max_steps))
    st.session_state.eval_random = evaluate_policy(RandomPolicy(n_actions, seed=1), episodes=100, max_steps=int(max_steps))

eval_q = st.session_state.eval_q
eval_random = st.session_state.eval_random

if history is None:
    st.info("No trained model found yet. Click **Train / Retrain Agent** in the sidebar to get started.")

# --------------------------------------------------------------------------
# Section 1: Training Overview
# --------------------------------------------------------------------------
st.header("📊 Training Overview")
with st.container(border=True):
    c1, c2, c3, c4 = st.columns(4)
    if history is not None:
        rewards = history["episode_rewards"]
        c1.metric("Episodes Trained", f"{len(rewards):,}")
        c2.metric("Final Epsilon", f"{history['epsilon_history'][-1]:.3f}")
        c3.metric("Best Episode Reward", f"{max(rewards):.0f}")
        c4.metric("Avg Reward (last 100)", f"{np.mean(rewards[-100:]):.2f}")
    else:
        c1.metric("Episodes Trained", "0")
        c2.metric("Final Epsilon", "-")
        c3.metric("Best Episode Reward", "-")
        c4.metric("Avg Reward (last 100)", "-")

# --------------------------------------------------------------------------
# Section 2: Learning Progress
# --------------------------------------------------------------------------
st.header("📈 Learning Progress")
if history is not None:
    with st.container(border=True):
        tab1, tab2, tab3 = st.tabs(["Reward Progression", "Steps per Episode", "Epsilon Decay"])
        with tab1:
            st.pyplot(viz.plot_reward_progression(history["episode_rewards"]), clear_figure=True)
        with tab2:
            st.pyplot(viz.plot_steps_progression(history["episode_steps"]), clear_figure=True)
        with tab3:
            st.pyplot(viz.plot_epsilon_decay(history["epsilon_history"]), clear_figure=True)
else:
    st.caption("Train the agent to see learning curves here.")

# --------------------------------------------------------------------------
# Section 3: Policy Comparison
# --------------------------------------------------------------------------
st.header("⚖️ Policy Comparison — Random vs. Q-Learning")
if eval_q is not None and eval_random is not None:
    with st.container(border=True):
        cols = st.columns(3)
        q_summary = eval_q.summary()
        r_summary = eval_random.summary()

        cols[0].metric(
            "Avg Reward",
            f"{q_summary['avg_reward']:.2f}",
            delta=f"{q_summary['avg_reward'] - r_summary['avg_reward']:.1f} vs random",
        )
        cols[1].metric(
            "Avg Steps",
            f"{q_summary['avg_steps']:.1f}",
            delta=f"{q_summary['avg_steps'] - r_summary['avg_steps']:.1f} vs random",
            delta_color="inverse",
        )
        cols[2].metric(
            "Success Rate",
            f"{q_summary['success_rate']*100:.1f}%",
            delta=f"{(q_summary['success_rate'] - r_summary['success_rate'])*100:.1f} pts vs random",
        )

        comp_tab1, comp_tab2, comp_tab3 = st.tabs(["Comparison Bars", "Reward Distribution", "Raw Metrics"])
        with comp_tab1:
            st.pyplot(viz.plot_policy_comparison(r_summary, q_summary), clear_figure=True)
        with comp_tab2:
            st.pyplot(
                viz.plot_reward_distribution(eval_random.rewards, eval_q.rewards),
                clear_figure=True,
            )
        with comp_tab3:
            df = pd.DataFrame(
                {
                    "Metric": ["Avg Reward", "Std Reward", "Avg Steps", "Success Rate"],
                    "Random Policy": [
                        f"{r_summary['avg_reward']:.2f}",
                        f"{r_summary['std_reward']:.2f}",
                        f"{r_summary['avg_steps']:.2f}",
                        f"{r_summary['success_rate']*100:.1f}%",
                    ],
                    "Q-Learning": [
                        f"{q_summary['avg_reward']:.2f}",
                        f"{q_summary['std_reward']:.2f}",
                        f"{q_summary['avg_steps']:.2f}",
                        f"{q_summary['success_rate']*100:.1f}%",
                    ],
                }
            )
            st.dataframe(df, hide_index=True, width="stretch")
else:
    st.caption("Train the agent to compare it against the random-policy baseline.")

# --------------------------------------------------------------------------
# Section 4: Live Taxi Simulation
# --------------------------------------------------------------------------
st.header("🚕 Live Taxi Simulation")


def render_grid(decoded, action_name: str | None) -> str:
    cells = []
    for row in range(5):
        for col in range(5):
            content = ""
            style = ""
            loc_label = ""
            for name, (lr, lc) in LOCATIONS.items():
                if (lr, lc) == (row, col):
                    color = LOCATION_COLORS[name]
                    style += f"background:{color}22;box-shadow:inset 0 0 0 2px {color}66;"
                    loc_label = f'<span class="loc-label" style="color:{color};">{name}</span>'

            is_taxi = (row, col) == (decoded.taxi_row, decoded.taxi_col)
            is_passenger = (not decoded.passenger_in_taxi) and decoded.passenger_location == (row, col)
            is_destination = decoded.destination_location == (row, col)

            icons = ""
            if is_destination:
                icons += '<span style="position:absolute;top:2px;right:4px;font-size:15px;">🎯</span>'
            if is_passenger:
                icons += '<span style="font-size:26px;">🧍</span>'
            if is_taxi:
                taxi_bg = "#facc15" if decoded.passenger_in_taxi else "#e2e8f0"
                icons += (
                    f'<span style="font-size:28px;filter:drop-shadow(0 0 6px {taxi_bg}88);">🚕</span>'
                )

            border_right = "border-right:3px solid #94a3b8;" if (row, col) in WALLS_RIGHT else ""
            cells.append(
                f'<div class="cell" style="{style}{border_right}">{loc_label}{icons}</div>'
            )
    return f'<div class="cell-grid">{"".join(cells)}</div>'


if "sim_env" not in st.session_state:
    st.session_state.sim_env = make_env()
    st.session_state.sim_state, _ = st.session_state.sim_env.reset(seed=7)
    st.session_state.sim_total_reward = 0.0
    st.session_state.sim_steps = 0
    st.session_state.sim_done = False
    st.session_state.sim_last_action = None
    st.session_state.sim_last_reward = None

sim_col, info_col = st.columns([1.3, 1])

mode = info_col.radio("Mode", ["Play Full Episode", "Step-by-Step"], horizontal=True)
btn_cols = info_col.columns(3)
reset_clicked = btn_cols[0].button("🔄 Reset", width="stretch")
step_clicked = btn_cols[1].button("➡️ Step", width="stretch", disabled=(mode != "Step-by-Step"))
play_clicked = btn_cols[2].button("▶️ Play Episode", width="stretch", disabled=(mode != "Play Full Episode"))


def do_reset():
    st.session_state.sim_state, _ = st.session_state.sim_env.reset()
    st.session_state.sim_total_reward = 0.0
    st.session_state.sim_steps = 0
    st.session_state.sim_done = False
    st.session_state.sim_last_action = None
    st.session_state.sim_last_reward = None


def do_step():
    if st.session_state.sim_done:
        return
    s = st.session_state.sim_state
    action = agent.select_action(s, greedy=True)
    next_s, reward, terminated, truncated, _ = st.session_state.sim_env.step(action)
    st.session_state.sim_state = next_s
    st.session_state.sim_total_reward += reward
    st.session_state.sim_steps += 1
    st.session_state.sim_last_action = ACTION_NAMES[action]
    st.session_state.sim_last_reward = reward
    st.session_state.sim_done = terminated or truncated


if reset_clicked:
    do_reset()
if step_clicked:
    do_step()

grid_placeholder = sim_col.empty()
info_placeholder = info_col.empty()


def render_info():
    decoded = decode_state(st.session_state.sim_env, st.session_state.sim_state)
    with info_placeholder.container():
        st.markdown(f"**Current Action:** {st.session_state.sim_last_action or '-'}")
        m1, m2, m3 = st.columns(3)
        m1.metric("Step", st.session_state.sim_steps)
        m2.metric("Reward", f"{st.session_state.sim_last_reward if st.session_state.sim_last_reward is not None else '-'}")
        m3.metric("Cumulative", f"{st.session_state.sim_total_reward:.0f}")
        status = "🟡 In taxi" if decoded.passenger_in_taxi else "⚪ Waiting for pickup"
        st.caption(f"Passenger status: {status}")
        if st.session_state.sim_done:
            if st.session_state.sim_total_reward > 0:
                st.success("Passenger delivered successfully! 🎉")
            else:
                st.warning("Episode ended without a successful drop-off (max steps reached).")


def render_current():
    decoded = decode_state(st.session_state.sim_env, st.session_state.sim_state)
    grid_placeholder.markdown(render_grid(decoded, st.session_state.sim_last_action), unsafe_allow_html=True)
    render_info()


if play_clicked:
    if st.session_state.sim_done:
        do_reset()
    render_current()
    while not st.session_state.sim_done and st.session_state.sim_steps < max_steps:
        time.sleep(0.35)
        do_step()
        render_current()
else:
    render_current()

# --------------------------------------------------------------------------
# Section 5: How the Agent Learns
# --------------------------------------------------------------------------
st.header("🧠 How the Agent Learns")
with st.container(border=True):
    st.markdown(
        """
**State → Action → Reward → Next State → Q-table Update**

1. The agent observes the current **state** (an integer encoding taxi
   position, passenger position, and destination).
2. It chooses an **action** using an epsilon-greedy policy: mostly the
   best action it currently knows, occasionally a random one to keep
   exploring.
3. The environment returns a **reward** (-1 per step, +20 for a correct
   drop-off, -10 for an illegal pickup/drop-off) and the **next state**.
4. The agent updates its **Q-table** using the Bellman equation:

   `Q(s,a) ← Q(s,a) + α [ r + γ · maxₐ′ Q(s′,a′) − Q(s,a) ]`

   This nudges the value of the action just taken towards the reward
   received plus the best value achievable from the next state.
5. Repeated over thousands of episodes, the Q-table converges towards
   values that encode the optimal policy — the agent learns to reach the
   passenger and destination in the fewest possible steps.
"""
    )

    st.subheader("Explore a learned state")
    st.caption("Pick a scenario to see the Q-values the agent has learned for it.")
    q1, q2, q3, q4 = st.columns(4)
    taxi_row = q1.number_input("Taxi row", 0, 4, 0)
    taxi_col = q2.number_input("Taxi col", 0, 4, 0)
    passenger_idx = q3.selectbox(
        "Passenger", options=list(range(5)),
        format_func=lambda i: LOCATION_LIST[i] if i < 4 else "In Taxi",
    )
    destination_idx = q4.selectbox("Destination", options=list(range(4)), format_func=lambda i: LOCATION_LIST[i])

    state_id = env.unwrapped.encode(taxi_row, taxi_col, passenger_idx, destination_idx)
    q_values = agent.q_table[state_id]
    best_action = int(np.argmax(q_values))

    q_df = pd.DataFrame(
        {
            "Action": [ACTION_NAMES[a] for a in range(len(q_values))],
            "Q-value": q_values,
        }
    )
    st.caption(f"State id: **{state_id}**  |  Best action: **{ACTION_NAMES[best_action]}**")
    st.dataframe(
        q_df.style.apply(
            lambda row: ["background-color: rgba(250,204,21,0.25)" if row.name == best_action else "" for _ in row],
            axis=1,
        ).format({"Q-value": "{:.3f}"}),
        hide_index=True,
        width="stretch",
    )

# --------------------------------------------------------------------------
# Section 6: Failure Analysis
# --------------------------------------------------------------------------
st.header("🔍 Failure Analysis")
if eval_q is not None:
    with st.container(border=True):
        failures = eval_q.failure_cases(reward_threshold=0)
        if not failures:
            st.success("No failure episodes found in the last evaluation run — the agent solved every episode!")
        else:
            fdf = pd.DataFrame(
                [{"Episode": f.episode, "Total Reward": f.total_reward, "Steps": f.steps, "Success": f.success} for f in failures]
            )
            st.dataframe(fdf, hide_index=True, width="stretch")
        st.markdown(
            """
**Why failures happen even after training:**
- **Insufficient exploration** of rare states — some rare passenger/destination
  combinations may have been visited too few times during training for the
  Q-values to converge.
- **Suboptimal learned values** — if `epsilon` decayed too quickly, the agent
  may have "locked in" a decent-but-not-optimal policy before fully exploring.
- **Finite training horizon** — with more episodes, remaining gaps in the
  Q-table would keep shrinking; 10,000 episodes is usually enough for near-
  optimal play, but not a strict guarantee for every rare state.
- **Max-step truncation** — if the agent enters a loop between a small set of
  states, the episode is cut off at `max_steps` before a drop-off occurs.
"""
        )
else:
    st.caption("Run an evaluation (train the agent) to see failure-case analysis.")
