import math
import random
from collections import defaultdict

from action.element_locator import ElementLocator
from action.impl.back_action import BackAction
from action.impl.click_action import ClickAction
from action.impl.restart_action import RestartAction
from action.window_action import WindowAction
from agent.agent import Agent
from agent.impl.q_learning_agent import QLearningAgent
from exceptions import NoActionsException
from hmdriver2.driver import Driver
from hmdriver2.utils import parse_bounds
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
        self.page_path_count = {}
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
        self.previous_page = self.current_page = None
        self.previous_action = None
        self.in_degree = defaultdict(int)
        self.router_pages = set()
        self.calculate_in_degree()
        self.state_used_action_dict: dict[WindowState, set[WindowAction]] = defaultdict(set)
        self.q_learning_agent = QLearningAgent(d, app, ability_name, PTG, True)
        self.total_action_number = 0
        self.exploration_page_counts = defaultdict(int)
        self.intra_q_try_count = defaultdict(int)
        if self.app == "com.itcast.pass_interview":
            # self.page_path_count["pages/BootPage"] = 1
            self.page_path_count["pages/LoginPage"] = 1
        self.start_page = None

    def calculate_in_degree(self):
        for source_page, actions in self.PTG.items():
            for action in actions:
                # self.router_pages.add(source_page)
                target_page = action.get("targetPage")
                if target_page and source_page != target_page:
                    self.in_degree[target_page] += 1
                # self.router_pages.add(target_page)
        print(self.in_degree)

    def calculate_router_pages(self):
        st = [self.start_page]
        while st:
            page = st.pop()
            self.router_pages.add(page)
            for obj in self.PTG[page]:
                c, t = obj["component"], obj["targetPage"]
                if t not in self.router_pages:
                    st.append(t)

    def get_action(self, window_state: WindowState):
        self.total_action_number += 1
        if not isinstance(window_state, ActionSetState):
            return window_state.get_action_list()[0]
        ability_name, page_path = self.d.get_ability_and_page()
        if self.total_action_number == 1:
            self.start_page = page_path
            self.calculate_router_pages()
        self.page_path_count[page_path] = self.page_path_count.get(page_path, 0) + 1
        actions = window_state.get_action_list()
        if len(actions) == 1 and isinstance(actions[0], BackAction):
            state_index = self.q_learning_agent.get_state_index(window_state)
            self.q_learning_agent.state_count[state_index] += 1
            return actions[0]
        # 如果遍历完全部页面了或者超过一些时间，q-learning执行：
        # if self.total_action_number >= 45 or len(self.page_path_count) == len(self.PTG):
        print(f"{self.total_action_number}, {len(self.page_path_count)}, {len(self.router_pages)}")
        if self.total_action_number >= 45 or len(self.page_path_count) >= len(self.router_pages):
            # if self.in_degree[page_path] == 0:
            #     temp_actions = [action for action in actions if not isinstance(action, BackAction)]
            #     if temp_actions:
            #         chosen_action = random.choice(temp_actions)
            #     else:
            #         chosen_action = BackAction(ability_name, page_path)
            # else:
            #     chosen_action = BackAction(ability_name, page_path)
            with open("output/log.txt", "a") as f:
                f.write(
                    f"{self.total_action_number}, {len(self.page_path_count)}, {len(self.router_pages)}, q-learning finished!\n")
            print(
                f"{self.total_action_number}, {len(self.page_path_count)}, {len(self.router_pages)}, q-learning finished!")
            state_index = self.q_learning_agent.get_state_index(window_state)
            self.q_learning_agent.state_count[state_index] += 1
            return self.q_learning_agent.get_action(window_state)
        # 页面间的跳转
        all_useful_actions = self.get_actions_in_ptg(ability_name, page_path)
        possible_useful_actions = [action for action, target_page in all_useful_actions if
                                   target_page not in self.page_path_count]
        # 如果没有页面间的跳转，返回上一个页面
        if len(possible_useful_actions) == 0:
            # 如果还是有，但可能已经被执行过了
            # if all_useful_actions:
            #     print("q-learning finishing")
            #     chosen_action = self.q_learning_agent.get_action(window_state)
            #     state_index = self.q_learning_agent.get_state_index(window_state)
            #     self.q_learning_agent.state_count[state_index] += 1
            #     return chosen_action
            # self.PTG_exploration[page_path] = True
            print("back")
            with open("output/log.txt", "a") as f:
                f.write("back\n")
            state_index = self.q_learning_agent.get_state_index(window_state)
            self.q_learning_agent.state_count[state_index] += 1
            # self.PTG_exploration[page_path] = True
            return BackAction(ability_name, page_path)
        # 真正在当前页面上的控件
        # useful_actions = []
        # for action in possible_useful_actions:
        #     # if self.d.xpath(action).exists():
        #     # raw_bounds = self.d.xpath(action).attributes["bounds"]
        #     # bounds = parse_bounds(raw_bounds)
        #     # center = bounds.get_center()
        #     # x, y = center.x, center.y
        #     new_action = ClickAction(ElementLocator.XPATH, action, None, None, ability_name, page_path)
        #     if new_action not in self.state_used_action_dict[window_state]:
        #         useful_actions.append(new_action)
        all_useful_actions_in_window = self.get_current_actions_in_ptg(actions, ability_name, page_path)
        useful_actions = [action for action, target_page in all_useful_actions_in_window if
                          action not in self.state_used_action_dict[window_state]]
        # 如果有真正在当前页面上的控件，执行
        # useful_actions = [action for action in possible_useful_actions if action not in useful_actions]
        print("useful actions:", useful_actions)
        if useful_actions:
            print("target")
            chosen_action = random.choice(useful_actions)
            self.state_used_action_dict[window_state].add(chosen_action)
            state_index = self.q_learning_agent.get_state_index(window_state)
            self.q_learning_agent.state_count[state_index] += 1
            with open("output/log.txt", "a") as f:
                f.write("target click\n")
            return chosen_action

        if self.intra_q_try_count[page_path] < 15:
            # print("q-learning finishing......")
            # temp_actions = [action for action in actions if not isinstance(action, BackAction)]
            # if temp_actions:
            #     chosen_action = random.choice(temp_actions)
            # else:
            #     chosen_action = BackAction(ability_name, page_path)
            # # return random.choice(actions)
            # return chosen_action
            state_index = self.q_learning_agent.get_state_index(window_state)
            self.q_learning_agent.state_count[state_index] += 1
            # with open("output/log.txt", "a") as f:
            #     f.write("q-learning finishing......\n")
            print(f"Page {page_path} no direct DFS jump. Try Q-learning within page.")
            with open("output/log.txt", "a") as f:
                f.write(f"Try Q-learning in {page_path}\n")
            chosen_action = self.q_learning_agent.get_action(window_state)
            while isinstance(chosen_action, BackAction):
                chosen_action = self.q_learning_agent.get_action(window_state)
            self.intra_q_try_count[page_path] += 1
            return chosen_action
        for action, target_page in all_useful_actions:
            if target_page not in self.page_path_count:
                self.page_path_count[target_page] = self.page_path_count.get(target_page, 0) + 1
                state_index = self.q_learning_agent.get_state_index(window_state)
                self.q_learning_agent.state_count[state_index] += 1
        print(f"Page {page_path}: Q-learning tries used up -> BackAction")
        with open("output/log.txt", "a") as f:
            f.write(f"Page {page_path}: Q-learning tries used up -> BacAction\n")
        return BackAction(ability_name, page_path)

        # [CHANGED] 如果本页面没有能跳到新页面的控件
        #    那就先让 Q-learning 在页面内尝试一下，看看能不能“点出”新的东西
        #    但要加个上限，避免无限Q-learning
        # if self.intra_q_try_count[page_path] < 15:
        #     print(f"Page {page_path} no direct DFS jump. Try Q-learning within page.")
        #     with open("output/log.txt", "a") as f:
        #         f.write(f"Try Q-learning in {page_path}\n")
        #
        #     state_index = self.q_learning_agent.get_state_index(window_state)
        #     self.q_learning_agent.state_count[state_index] += 1
        #
        #     chosen_action = self.q_learning_agent.get_action(window_state)
        #     self.intra_q_try_count[page_path] += 1  # [ADDED] 增加本页面的Q-learning尝试计数
        #
        #     # 如果Q-learning返回了BackAction，或者效果不理想，可以再尝试别的：
        #     # 这里做一个简单处理：如果它返回BackAction，就先返回给测试框架
        #     #    也可能你想随机选别的action，这里灵活处理
        #     temp_actions = [action for action in actions if not isinstance(action, BackAction)]
        #     if temp_actions:
        #         chosen_action = random.choice(temp_actions)
        #     else:
        #         chosen_action = BackAction(ability_name, page_path)
        #     # return random.choice(actions)

        # [CHANGED] 如果Q-learning次数也用完了，还没发现新页面 -> 那就Back，进行DFS回溯
        # print(f"Page {page_path}: Q-learning tries used up -> BackAction")
        # with open("output/log.txt", "a") as f:
        #     f.write(f"Page {page_path}: Q-learning tries used up -> Back\n")
        # state_index = self.q_learning_agent.get_state_index(window_state)
        # self.q_learning_agent.state_count[state_index] += 1
        # return BackAction(ability_name, page_path)

    # 得到PTG中和页面跳转相关的action
    def get_current_actions_in_ptg(self, actions, ability_name, page_path):
        res = []
        for action in actions:
            for obj in self.PTG[page_path]:
                c, t = obj["component"], obj["targetPage"]
                # if t not in self.page_path_count:
                #     actions.append(c)
                if c == action.location:
                    res.append((ClickAction(ElementLocator.XPATH, c, None, None, ability_name, page_path), t))
        return res

    def update_state(self, chosen_action: WindowAction, window_state: WindowState) -> None:
        ability_name, page_path = self.d.get_ability_and_page()
        self.previous_page = self.current_page
        self.current_page = page_path
        self.previous_action = chosen_action
        self.q_learning_agent.update_state(chosen_action, window_state)

    def get_actions_in_ptg(self, ability_name, page_path):
        actions = []
        for obj in self.PTG[page_path]:
            c, t = obj["component"], obj["targetPage"]
            # if t not in self.page_path_count:
            #     actions.append(c)
            if t not in self.page_path_count:
                actions.append((ClickAction(ElementLocator.XPATH, c, None, None, ability_name, page_path), t))
        return actions
