from collections import defaultdict
from typing import List

from action.element_locator import ElementLocator
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
        window_action_list = []
        root = self.d.dump_hierarchy()

        def dfs(node: dict, xpath: str):
            if node["attributes"]["clickable"] == "true":
                bounds = parse_bounds(node["attributes"]["bounds"])
                center = bounds.get_center()
                window_action_list.append(
                    ClickAction(ElementLocator.XPATH, xpath, node["attributes"]["text"], center.x, center.y))
            type_dict: dict[str, int] = defaultdict(lambda: 0)
            for child in node["children"]:
                child_type = child["attributes"]["type"]
                if child_type == "WindowScene":
                    return
                type_dict[child_type] += 1
                dfs(child, xpath + "/" + child_type + f"[{type_dict[child_type]}]")

        dfs(root, "/")
        return window_action_list
