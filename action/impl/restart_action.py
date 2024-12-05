import time

from action.window_action import WindowAction
from hmdriver2.driver import Driver


class RestartAction(WindowAction):
    def __init__(self, app: str, ability_name: str) -> None:
        super().__init__()
        self.app = app
        self.ability_name = ability_name

    def execute(self, driver: Driver) -> None:
        driver.stop_app(self.app)
        driver.start_app(self.app, self.ability_name)
        time.sleep(3)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, RestartAction):
            return self.app == other.app and self.ability_name == other.ability_name
        return False

    def __hash__(self) -> int:
        return hash((self.app, self.ability_name))

    def __lt__(self, other: object) -> bool:
        if isinstance(other, RestartAction):
            return self.app < other.app and self.ability_name < other.ability_name
        else:
            return type(self).__name__ < type(other).__name__

    def __str__(self) -> str:
        return f'RestartAction(restart_app={self.app, self.ability_name})'
