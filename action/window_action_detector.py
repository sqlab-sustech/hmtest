from abc import ABC, abstractmethod
from typing import List

from action.window_action import WindowAction
from hmdriver2.driver import Driver


class WindowActionDetector(ABC):
    @abstractmethod
    def get_actions(self, driver: Driver) -> List[WindowAction]:
        pass
