from abc import ABC, abstractmethod

from action.window_action import WindowAction
from state.window_state import WindowState


class Agent(ABC):

    def __init__(self):
        self.action_list: list[WindowAction] = []
        self.action_count: dict[int, int] = {}

    @abstractmethod
    def get_action(self, window_state: WindowState) -> WindowAction:
        pass

    @abstractmethod
    def update_state(self, chosen_action: WindowAction, window_state: WindowState) -> None:
        pass

    def state_abstraction(self, state: WindowState):
        actions = state.get_action_list()
        for a in actions:
            if a not in self.action_list:
                self.action_list.append(a)
                self.action_count[self.action_list.index(a)] = 0

        action_index_set = set()
        for a in actions:
            action_index_set.add(self.action_list.index(a))
        action_index_list = list(action_index_set)
        action_index_list.sort()
        action_index_list_str = [str(x) for x in action_index_list]
        state_representation = ','.join(action_index_list_str)
        return state_representation
