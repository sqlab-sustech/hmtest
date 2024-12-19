import time

from action.element_locator import ElementLocator
from action.window_action import WindowAction
from agent.impl.chatgpt_agent import ChatgptAgent
from hmdriver2.driver import Driver
from hmdriver2.proto import KeyCode


class ClickAction(WindowAction):
    def __init__(self, locator: ElementLocator, location: str, x: int | float, y: int | float, ability_name: str,
                 page_path: str) -> None:
        super().__init__()
        self.locator = locator
        self.location = location
        self.x = x
        self.y = y
        self.ability_name = ability_name
        self.page_path = page_path


    def execute(self, d: Driver) -> None:
        a, p = d.get_ability_and_page()
        keyboard_exist = d(id="KeyCanvasKeyboard").exists(retries=1)
        xml_element = None
        if self.locator is not None and self.location is not None:
            xml_element = self.locator.locate(d, self.location)
            # xml_element.click()
            xml_element.click_if_exists()
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
        ability_name, page_name = d.get_ability_and_page()
        if (not keyboard_exist or a != ability_name or p != page_name) and d(id="KeyCanvasKeyboard").exists(retries=1):
            pre_text_len = 5
            if xml_element:
                pre_text_len = len(xml_element.attributes.get("text"))
            for _ in range(pre_text_len):
                d.shell(f"uitest uiInput keyEvent {KeyCode.DEL.value}")
            chatgpt_agent = ChatgptAgent(d)
            input_text = chatgpt_agent.generate_text_input()
            print("Generate TextInput: ", input_text)
            d.input_text(input_text)
            d.press_key(KeyCode.ENTER)
            time.sleep(2)


    def __eq__(self, other: object) -> bool:
        if isinstance(other, ClickAction):
            # return self.locator == other.locator and self.location == other.location and self.x == other.x and self.y == other.y and self.ability_name == other.ability_name and self.page_path == other.page_path
            return self.locator == other.locator and self.location == other.location and self.ability_name == other.ability_name and self.page_path == other.page_path
        return False

    def __hash__(self) -> int:
        # return hash((self.locator, self.location, self.x, self.y, self.ability_name, self.page_path))
        return hash((self.locator, self.location, self.ability_name, self.page_path))

    # TODO:
    def __lt__(self, other: object) -> bool:
        if isinstance(other, ClickAction):
            # return (self.locator.value + self.location + self.text) < (
            #         other.locator.value + other.location + other.text)
            return self.__hash__() < other.__hash__()
        else:
            return type(self).__name__ < type(other).__name__

    def __str__(self) -> str:
        return f'ClickAction(locator={self.locator}, location={self.location}, x={self.x}, y={self.y}, ability_name={self.ability_name}, page_path={self.page_path})'
