import random

from action.window_action import WindowAction
from agent.agent import Agent
from hmdriver2.driver import Driver
from state.window_state import WindowState


class RandomAgent(Agent):
    def __init__(self, d: Driver, app: str, ability_name: str, PTG: dict, use_ptg: bool, config):
        super().__init__(d, app, ability_name, PTG, use_ptg, config)

    def get_action(self, window_state: WindowState) -> WindowAction:
        actions = window_state.get_action_list()
        return random.choice(actions) if actions else None

    def update_state(self, chosen_action: WindowAction, window_state: WindowState) -> None:
        pass
