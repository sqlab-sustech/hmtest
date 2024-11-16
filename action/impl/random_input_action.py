import random
import string

from action.element_locator import ElementLocator
from action.window_action import WindowAction
from hmdriver2.driver import Driver


class RandomInputAction(WindowAction):
    def __init__(self, locator: ElementLocator, location: str, text: str) -> None:
        super().__init__()
        self.locator = locator
        self.location = location
        self.text = text
        self.max_input_length = 10

    def execute(self, driver: Driver) -> None:
        input_length = random.randint(1, self.max_input_length)
        characters = string.ascii_letters + string.digits
        input_str = ''.join(random.choice(characters) for _ in range(input_length))
        web_element = self.locator.locate(driver, self.location)
        web_element.clear()
        web_element.send_keys(input_str)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, RandomInputAction):
            return (self.locator == other.locator) and (self.location == other.location) and (self.text == other.text)
        return False

    def __hash__(self) -> int:
        return hash((self.locator, self.location, self.text))

    def __lt__(self, other: object) -> bool:
        if isinstance(other, RandomInputAction):
            return (self.locator.value + self.location + self.text) < (other.locator.value + other.location + other.text)
        else:
            return type(self).__name__ < type(other).__name__

    def __str__(self) -> str:
        return f'RandomInputAction(locator={self.locator}, location={self.location}, text={self.text})'
