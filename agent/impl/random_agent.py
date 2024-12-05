import random

from action.window_action import WindowAction
from agent.agent import Agent
from state.window_state import WindowState


class RandomAgent(Agent):
    def get_action(self, window_state: WindowState) -> WindowAction:
        return random.choice(window_state.get_action_list())
