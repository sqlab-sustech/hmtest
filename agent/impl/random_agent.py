import random

from action.impl.back_action import BackAction
from action.window_action import WindowAction
from agent.agent import Agent
from state.window_state import WindowState


class RandomAgent(Agent):
    def get_action(self, window_state: WindowState) -> WindowAction:
        actions = window_state.get_action_list()
        # actions.append(BackAction())
        # with open("output/log.txt", "a") as f:
        #     f.write(str(actions) + "\n")
        return random.choice(actions) if actions else None

    def update_state(self, chosen_action: WindowAction, window_state: WindowState) -> None:
        pass
