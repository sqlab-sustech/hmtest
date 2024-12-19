import math
import random
from collections import defaultdict

from action.impl.back_action import BackAction
from action.impl.restart_action import RestartAction
from action.window_action import WindowAction
from agent.agent import Agent
from exceptions import NoActionsException
from hmdriver2.driver import Driver
from state.impl.action_set_state import ActionSetState
from state.impl.out_of_domain_state import OutOfDomainState
from state.impl.same_url_state import SameUrlState
from state.window_state import WindowState


class DFSAgent(Agent):
    def __init__(self, d: Driver, app: str, ability_name: str, PTG: dict):
        super().__init__()
        self.d = d
        self.app = app
        self.ability_name = ability_name
        self.PTG = PTG
        self.state_repr_list = list()
        self.page_path_count = defaultdict(int)
        self.state_count = defaultdict(int)
        self.trans_count = defaultdict(int)
        self.previous_state: int | None = None
        self.previous_action: int | None = None
        # self.page_intra = defaultdict(lambda: True)
        self.is_intra = True
        # self.page_set = set()
        self.page_intra_count = defaultdict(int)
        self.PTG_exploration = defaultdict(bool)
        self.intra_explore_limit = 10  # 每个页面内随机探索的最大次数

    def get_action(self, window_state: WindowState):
        if not isinstance(window_state, ActionSetState):
            return window_state.get_action_list()[0]
        self.page_path_count[window_state.page_path] = self.page_path_count.get(window_state.page_path, 0) + 1
        # self.page_set.add(window_state.page_path)
        actions = window_state.get_action_list()
        # TODO: Add ActionExecuteFailedState and RestartAction
        if len(actions) == 0:
            return None
            # raise NoActionsException("The state does not have any actions")
        # 如果是页面内跳转
        # if self.page_intra[window_state.page_path]:
        if self.page_intra_count[window_state.page_path] < self.intra_explore_limit:
            intra_actions = []
            for action in actions:
                component, target_page = self.get_action_in_PTG(window_state, action)
                if component is None and target_page is None:
                    intra_actions.append(action)
            if intra_actions:
                # self.intra_count += 1
                # if self.intra_count >= self.intra_explore_limit:
                #     self.page_intra[window_state.page_path] = False
                #     self.intra_count = 0
                self.page_intra_count[window_state.page_path] += 1
                return random.choice(intra_actions)
        for action in actions:
            component, target_page = self.get_action_in_PTG(window_state, action)
            if component is not None and target_page is not None:
                # if target_page not in self.page_path_count:
                # if self.page_path_count[target_page] < self.intra_explore_limit:
                if not self.PTG_exploration[target_page]:
                    return action
        self.PTG_exploration[window_state.page_path] = True
        # 如果暂时没找到页面间的跳转，就先随机执行
        # return random.choice(actions)
        # 没有页面间的跳转，就返回
        # return BackAction()
        if self.PTG[window_state.page_path]:
            return random.choice(actions)
        else:
            return BackAction()

    # 得到PTG中和页面跳转相关的action
    def get_action_in_PTG(self, state: WindowState, action: WindowAction):
        for obj in self.PTG[state.page_path]:
            c, t = obj["component"], obj["targetPage"]
            if c == action.location:
                return c, t
        return None, None
