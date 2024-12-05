from typing import List, Dict, Any, Tuple, Set

from action.impl.back_action import BackAction
from action.window_action import WindowAction
from state.window_state import WindowState


class ActionSetState(WindowState):
    def __init__(self, actions: List[WindowAction], ability_name: str, page_path: str) -> None:
        self.action_set: Set[WindowAction] = set(actions)
        self.ability_name = ability_name
        self.page_path = page_path

    def similarity(self, other: WindowState) -> float:
        return 0

    def get_action_list(self) -> List[WindowAction]:
        action_list = list(self.action_set)
        # action_list.append(BackAction())
        action_list.sort()
        return action_list

    def get_action_detailed_data(self) -> Tuple[Dict[WindowAction, Any], Any]:
        return {key: None for key in self.action_set}, None

    def update_action_execution_time(self, action: WindowAction) -> None:
        pass

    def update_transition_information(self, action: WindowAction, new_state: WindowState) -> None:
        pass

    def __eq__(self, other: object) -> bool:
        if isinstance(other, ActionSetState):
            return (self.action_set == other.action_set) and (self.ability_name == other.ability_name) and (
                    self.page_path == other.page_path)
        return False

    def __hash__(self) -> int:
        hash_value = 0
        for action in self.action_set:
            hash_value += hash(action)
        hash_value += hash(self.ability_name) + hash(self.page_path)
        return hash_value

    def __lt__(self, other: object) -> bool:
        if isinstance(other, ActionSetState):
            return hash(self) < hash(other)
        else:
            return type(self).__name__ < type(other).__name__

    def __str__(self) -> str:
        return f'ActionSetState(action_number={len(self.action_set)}, abilityName={self.ability_name}, pagePath={self.page_path})'
