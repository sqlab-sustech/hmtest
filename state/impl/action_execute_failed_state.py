from typing import List, Dict, Any, Tuple

from action.impl.restart_action import RestartAction
from action.window_action import WindowAction
from state.window_state import WindowState


class ActionExecuteFailedState(WindowState):
    def similarity(self, other: 'WindowState') -> float:
        return 0

    def __init__(self, restart_url: str) -> None:
        self.action = RestartAction(restart_url)

    def get_action_list(self) -> List[WindowAction]:
        return [self.action]

    def get_action_detailed_data(self) -> Tuple[Dict[WindowAction, Any], Any]:
        return {self.action: None}, None

    def update_action_execution_time(self, action: WindowAction) -> None:
        pass

    def update_transition_information(self, action: WindowAction, new_state: 'WindowState') -> None:
        pass

    def __eq__(self, other: object) -> bool:
        if isinstance(other, ActionExecuteFailedState):
            return self.action == other.action
        return False

    def __hash__(self) -> int:
        return hash(self.action)

    def __lt__(self, other: object) -> bool:
        if isinstance(other, ActionExecuteFailedState):
            return self.action < other.action
        else:
            return type(self).__name__ < type(other).__name__

    def __str__(self) -> str:
        return f'ActionExecuteFailedState(action={self.action})'
