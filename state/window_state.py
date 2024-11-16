from abc import ABC, abstractmethod
from typing import List, Dict, Any, Tuple

from action.window_action import WindowAction


class WindowState(ABC):
    @abstractmethod
    def get_action_list(self) -> List[WindowAction]:
        pass

    @abstractmethod
    def get_action_detailed_data(self) -> Tuple[Dict[WindowAction, Any], Any]:
        pass

    @abstractmethod
    def update_action_execution_time(self, action: WindowAction) -> None:
        pass

    @abstractmethod
    def update_transition_information(self, action: WindowAction, new_state: 'WindowState') -> None:
        pass

    @abstractmethod
    def __lt__(self, other: object) -> bool:
        pass

    @abstractmethod
    def similarity(self, other: 'WindowState') -> float:
        pass
