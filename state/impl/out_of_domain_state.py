from typing import List, Dict, Any, Tuple

from action.impl.restart_action import RestartAction
from action.window_action import WindowAction
from state.window_state import WindowState


class OutOfDomainState(WindowState):
    def __init__(self, app: str, ability_name: str) -> None:
        self.action = RestartAction(app, ability_name)

    def similarity(self, other: 'WindowState') -> float:
        return 0

    def get_action_list(self) -> List[WindowAction]:
        return [self.action]

    def get_action_detailed_data(self) -> Tuple[Dict[WindowAction, Any], Any]:
        return {self.action: None}, None

    def update_action_execution_time(self, action: WindowAction) -> None:
        pass

    def update_transition_information(self, action: WindowAction, new_state: 'WindowState') -> None:
        pass

    def __eq__(self, other: object) -> bool:
        if isinstance(other, OutOfDomainState):
            return self.action == other.action
        return False

    def __hash__(self) -> int:
        return hash(self.action)

    def __lt__(self, other: object) -> bool:
        if isinstance(other, OutOfDomainState):
            return self.action < other.action
        else:
            return type(self).__name__ < type(other).__name__

    def __str__(self) -> str:
        return f'OutOfDomainState(action={self.action})'
