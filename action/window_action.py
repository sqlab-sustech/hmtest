from abc import ABC, abstractmethod

from action.element_locator import ElementLocator
from hmdriver2.driver import Driver


class WindowAction(ABC):
    def __init__(self, locator: ElementLocator, location: str, x: int | float, y: int | float) -> None:
        self.locator: ElementLocator | None = locator
        self.location: str | None = location
        self.x = x
        self.y = y

    @abstractmethod
    def execute(self, driver: Driver) -> None:
        pass

    @abstractmethod
    def __lt__(self, other: object) -> bool:
        pass
