import random

from selenium.webdriver.chrome.webdriver import WebDriver
from selenium.webdriver.support.ui import Select

from action.element_locator import ElementLocator
from action.window_action import WindowAction


class RandomSelectAction(WindowAction):
    def __init__(self, locator: ElementLocator, location: str, text: str) -> None:
        super().__init__()
        self.locator = locator
        self.location = location
        self.text = text

    def execute(self, driver: WebDriver) -> None:
        select = Select(self.locator.locate(driver, self.location))
        options = select.options
        select.select_by_value(random.choice(options).get_attribute('value'))

    def __eq__(self, other: object) -> bool:
        if isinstance(other, RandomSelectAction):
            return (self.locator == other.locator) and (self.location == other.location) and (self.text == other.text)
        return False

    def __hash__(self) -> int:
        return hash((self.locator, self.location, self.text))

    def __lt__(self, other: object) -> bool:
        if isinstance(other, RandomSelectAction):
            return (self.locator.value + self.location + self.text) < (
                        other.locator.value + other.location + other.text)
        else:
            return type(self).__name__ < type(other).__name__

    def __str__(self) -> str:
        return f'RandomSelectAction(locator={self.locator}, location={self.location}, text={self.text})'
