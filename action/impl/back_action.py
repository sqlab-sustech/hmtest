import random
import string
import time

from action.element_locator import ElementLocator
from action.window_action import WindowAction
from hmdriver2.driver import Driver
from hmdriver2.proto import KeyCode


class BackAction(WindowAction):
    def __init__(self) -> None:
        super().__init__()
        self.location = ""

    def execute(self, d: Driver) -> None:
        d.go_back()

    def __eq__(self, other: object) -> bool:
        return isinstance(other, BackAction)

    def __hash__(self) -> int:
        return hash("BackAction")

    # TODO:
    def __lt__(self, other: object) -> bool:
        if isinstance(other, BackAction):
            return False
        else:
            return type(self).__name__ < type(other).__name__

    def __str__(self) -> str:
        return f'BackAction()'
