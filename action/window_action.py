from abc import ABC, abstractmethod

from action.element_locator import ElementLocator
from hmdriver2.driver import Driver


class WindowAction(ABC):
    def __init__(self) -> None:
        pass

    @abstractmethod
    def execute(self, driver: Driver) -> None:
        pass

    @abstractmethod
    def __lt__(self, other: object) -> bool:
        pass
