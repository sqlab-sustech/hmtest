from collections import defaultdict
from typing import List

from action.element_locator import ElementLocator
from action.impl.back_action import BackAction
from action.impl.click_action import ClickAction
from action.window_action import WindowAction
from action.window_action_detector import WindowActionDetector
from hmdriver2.driver import Driver
from hmdriver2.utils import parse_bounds


class ClickActionDetector(WindowActionDetector):
    def __init__(self, driver: Driver):
        self.d = driver
        pass

    def get_actions(self, driver: Driver) -> List[WindowAction]:
        window_action_list: list[WindowAction] = []
        root = self.d.dump_hierarchy()
        ability_name, page_path = self.d.get_ability_and_page()

        def dfs(node: dict, xpath: str):
            if node["attributes"]["clickable"] == "true":
                bounds = parse_bounds(node["attributes"]["bounds"])
                center = bounds.get_center()
                window_action_list.append(
                    ClickAction(ElementLocator.XPATH, xpath, center.x, center.y, ability_name, page_path))
            type_dict: dict[str, int] = defaultdict(lambda: 0)
            for child in node["children"]:
                child_type = child["attributes"]["type"]
                if child_type == "WindowScene":
                    return
                type_dict[child_type] += 1
                dfs(child, xpath + "/" + child_type + f"[{type_dict[child_type]}]")

        dfs(root, "/")
        window_action_list.append(BackAction(ability_name, page_path))
        return window_action_list
