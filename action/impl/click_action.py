import random
import string
import time

from action.element_locator import ElementLocator
from action.window_action import WindowAction
from hmdriver2.driver import Driver
from hmdriver2.proto import KeyCode


class ClickAction(WindowAction):
    def __init__(self, locator: ElementLocator, location: str, text: str, x: int | float, y: int | float) -> None:
        super().__init__(locator, location, x, y)
        self.text = text

    def execute(self, d: Driver) -> None:
        if self.locator is not None and self.location is not None:
            xml_element = self.locator.locate(d, self.location)
            xml_element.click()
        else:
            d.click(self.x, self.y)
        # TODO: optimize code
        # if xml_element.ele_type == "TextInput":
        #     input_length = random.randint(1, 10)
        #     characters = string.ascii_letters + string.digits
        #     input_str = ''.join(random.choice(characters) for _ in range(input_length))
        #     d.input_text(input_str)
        #     d.press_key(KeyCode.ENTER)
        #     time.sleep(2)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, ClickAction):
            return self.locator == other.locator and self.location == other.location
        return False

    def __hash__(self) -> int:
        return hash((self.locator, self.location, self.text))

    # TODO:
    def __lt__(self, other: object) -> bool:
        if isinstance(other, ClickAction):
            # return (self.locator.value + self.location + self.text) < (
            #         other.locator.value + other.location + other.text)
            return self.__hash__() < other.__hash__()
        else:
            return type(self).__name__ < type(other).__name__

    def __str__(self) -> str:
        return f'ClickAction(locator={self.locator}, location={self.location}, text={self.text}, x={self.x}, y={self.y})'
