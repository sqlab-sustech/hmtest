import random
import string
import time

from action.element_locator import ElementLocator
from action.window_action import WindowAction
from hmdriver2.driver import Driver
from hmdriver2.proto import KeyCode


class BackAction(WindowAction):
    def __init__(self, ability_name, page_name) -> None:
        super().__init__()
        self.location = ""
        self.ability_name = ability_name
        self.page_name = page_name

    def execute(self, d: Driver) -> None:
        d.go_back()

    def __eq__(self, other: object) -> bool:
        return isinstance(other, BackAction) and self.ability_name == other.ability_name and self.page_name == other.page_name

    def __hash__(self) -> int:
        return hash("BackAction") + hash(self.ability_name) + hash(self.page_name)

    # TODO:
    def __lt__(self, other: object) -> bool:
        if isinstance(other, BackAction):
            return False
        else:
            return type(self).__name__ < type(other).__name__

    def __str__(self) -> str:
        return f'BackAction(), {self.ability_name}, {self.page_name}'
