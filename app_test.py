import json
import logging
import os.path
import random
import threading
from collections import defaultdict, deque

from math import inf

from action.detector.click_action_detector import ClickActionDetector
from action.impl.back_action import BackAction
from action.impl.click_action import ClickAction
from action.impl.restart_action import RestartAction
from action.window_action import WindowAction
from agent.impl.dfs_agent import DFSAgent
from agent.impl.q_learning_agent import QLearningAgent
from agent.impl.random_agent import RandomAgent
from config import LogConfig
from hmdriver2.driver import Driver
from hmdriver2.proto import KeyCode
from state.impl.action_set_state import ActionSetState
from state.impl.out_of_domain_state import OutOfDomainState
from state.impl.same_url_state import SameUrlState
from state.window_state import WindowState

logger = logging.getLogger(__name__)
logger.addHandler(LogConfig.get_file_handler())


class AppTest(threading.Thread):
    def __init__(self, serial: str, app: str, project_path: str, use_ptg: bool, use_dfa: bool, agent_type):
        super().__init__()
        self.d: Driver = Driver(serial)
        self.app = app
        # self.open_sourced = open_sourced
        self.project_path = project_path
        self.use_ptg = use_ptg
        self.use_dfa = use_dfa
        self.action_detector = ClickActionDetector(self.d)
        self.state_class = ActionSetState
        self.prev_state: WindowState | None = None
        self.current_state: WindowState | None = None
        self.action_dict: dict[WindowAction, int] = {}
        self.state_dict: dict[WindowState, int] = {}
        self.page_count_dict: dict[str, int] = {}
        self.transition_record_list: list[tuple[WindowState | None, WindowAction, WindowState]] = []
        self.ability_count_dict: dict[str, int] = {}
        self.action_count = 0
        self.PTG = {}
        self.DFA: dict[WindowState, dict[WindowAction, WindowState]] = {}
        self.same_page_count = 0
        self.same_state_count = 0
        self.no_action_count = 0
        self.state_count = 0
        if self.use_ptg and self.project_path:
            if os.path.exists("PTG.json"):
                with open("PTG.json", "r", encoding="utf-8") as f:
                    self.PTG = json.load(f)
        if agent_type == "random":
            self.agent = RandomAgent()
        elif agent_type == "q-learning" or agent_type == "dynamic-q-learning":
            self.agent = QLearningAgent(self.d, self.app, self.ability_name, self.PTG, False)
        else:
            self.agent = QLearningAgent(self.d, self.app, self.ability_name, self.PTG, True)
        # self.agent = QLearningAgent(self.d, self.app, self.ability_name, self.PTG)
        # self.agent = RandomAgent()
        # self.agent = DFSAgent(self.d, self.app, self.ability_name, self.PTG)
        self.stop_event = threading.Event()
        self.lock = threading.Lock()

    @property
    def ability_name(self):
        # 有时候bm dump会卡住
        # app_info = self.d.get_app_info(self.app)
        # return app_info["hapModuleInfos"][0]["mainAbility"]
        return "EntryAbility"
        # return "PhoneAbility"

    def run(self):
        # self.d.stop_app(self.app)
        logger.info("Execution start")
        self.d.start_app(self.app, self.ability_name)
        self.stop_event.wait(3)
        action_list = self.action_detector.get_actions(self.d)
        ability_name, page_path = self.d.get_ability_and_page()
        self.current_state = self.state_class(action_list, ability_name, page_path)
        self.state_dict[SameUrlState(self.app, self.ability_name)] = 0
        self.state_dict[OutOfDomainState(self.app, self.ability_name)] = 0
        with self.lock:
            for action in action_list:
                self.action_dict.setdefault(action, 0)
            self.state_dict[self.current_state] = 1
            self.ability_count_dict[ability_name] = self.ability_count_dict.get(ability_name, 0) + 1
            self.page_count_dict[page_path] = self.page_count_dict.get(page_path, 0) + 1
        logger.info(f"Initial state: {self.current_state}")
        # self.status_thread = threading.Thread(target=self.print_status)
        # self.status_thread.daemon = True  # 将线程设置为守护线程，主线程退出时它也会退出
        # self.status_thread.start()
        pre_page_path = page_path
        while not self.stop_event.is_set():
            chosen_action = self.agent.get_action(self.current_state)
            if chosen_action is None:
                # if self.no_action_count <= 3:
                #     self.no_action_count += 1
                #     continue
                # self.no_action_count = 0
                # if random.random() < 0.5:
                #     chosen_action = RestartAction(self.app, self.ability_name)
                # else:
                chosen_action = BackAction()
                # chosen_action = random.choice([RestartAction(self.app, self.ability_name), BackAction()])
            logger.info(f"Chosen action: {chosen_action}")
            print(f"Chosen action: {chosen_action}")
            with self.lock:
                # if not isinstance(chosen_action, RestartAction):
                if isinstance(chosen_action, ClickAction):
                    # self.action_dict[chosen_action] += 1
                    self.action_dict[chosen_action] = self.action_dict.get(chosen_action, 0) + 1
                    self.action_count += 1

            with open("output/log.txt", "a") as f:
                f.write(str(self.current_state) + "\n")
                f.write(str(chosen_action) + "\n")
            prev_state_count = len(self.state_dict)
            chosen_action.execute(self.d)
            if isinstance(chosen_action, RestartAction):
                self.stop_event.wait(3)
                # 跳转到目前覆盖数最少的状态
                # target_state = min(self.state_dict, key=self.state_dict.get)

                # if random.random() < 0.2:
                # action_list = self.action_detector.get_actions(self.d)
                # ability_name, page_path = self.d.get_ability_and_page()
                # self.current_state = self.state_class(action_list, ability_name, page_path)
                # actions = self.get_shortest_path(self.current_state)
                # if actions:
                #     print("start recover")
                # for action in actions:
                #     with self.lock:
                #         self.action_dict[action] = self.action_dict.get(action, 0) + 1
                #     action.execute(self.d)
                #     self.stop_event.wait(0.5)
                # with self.lock:
                #     self.state_dict[self.current_state] = self.state_dict.get(self.current_state, 0) + 1
                #     actions = self.action_detector.get_actions(self.d)
                #     for action in actions:
                #         self.action_dict.setdefault(action, 0)
                # continue

            check_result = self.check_valid_state()
            ability_name, page_path = self.d.get_ability_and_page()
            check_result = check_result and ability_name != "" and page_path != ""
            if check_result and self.same_page_count < 1000 and self.same_state_count < 5000:
                with self.lock:
                    self.ability_count_dict[ability_name] = self.ability_count_dict.get(ability_name, 0) + 1
                    self.page_count_dict[page_path] = self.page_count_dict.get(page_path, 0) + 1
                action_list = self.action_detector.get_actions(self.d)
                with self.lock:
                    for action in action_list:
                        self.action_dict.setdefault(action, 0)

                new_state = self.state_class(action_list, ability_name, page_path)
                print(f"new_state: {self.agent.state_abstraction(new_state)}")
                if pre_page_path == page_path:
                    self.same_page_count += 1
                else:
                    self.same_page_count = 0
                print(f"page transition: {pre_page_path}, {chosen_action} -> {page_path}")
                if self.use_ptg:
                    self.update_ptg(pre_page_path, page_path, chosen_action)
                pre_page_path = page_path
                # self.transit(chosen_action, new_state)
            elif not check_result:
                self.same_page_count = 0
                self.same_state_count = 0
                print(f"{chosen_action} -> OutOfDomainState")
                new_state = OutOfDomainState(self.app, self.ability_name)
                # self.transit(chosen_action, new_state)
            else:
                self.same_page_count = 0
                self.same_state_count = 0
                new_state = SameUrlState(self.app, self.ability_name)
                # self.transit(chosen_action, new_state)
            self.agent.update_state(chosen_action, new_state)
            self.transit(chosen_action, new_state)
            curr_state_count = len(self.state_dict)
            if curr_state_count == prev_state_count:
                self.state_count += 1
            else:
                self.state_count = 0
            print(f"prev_state_count: {prev_state_count}, curr_state_count: {curr_state_count}")
            if self.use_dfa and self.state_count >= 10:
                # print(f"prev_state_count: {prev_state_count}, curr_state_count: {curr_state_count}")
                # if random.random() < 0.2:
                RestartAction(self.app, self.ability_name).execute(self.d)
                self.stop_event.wait(3)
                action_list = self.action_detector.get_actions(self.d)
                ability_name, page_path = self.d.get_ability_and_page()
                self.prev_state = None
                self.current_state = self.state_class(action_list, ability_name, page_path)
                actions = self.get_shortest_path(self.current_state)
                self.agent.previous_state = self.agent.previous_action = None
                if actions:
                    print("start recover")
                    with open("output/log.txt", "a") as f:
                        f.write(f"prev_state_count: {prev_state_count}, curr_state_count: {curr_state_count}, start recover\n")
                for action in actions:
                    with self.lock:
                        self.action_dict[action] = self.action_dict.get(action, 0) + 1
                    action.execute(self.d)
                    with open("output/log.txt", "a") as f:
                        f.write(f"recover action: {action}\n")
                    print(f"recover action: {action}")
                    # self.stop_event.wait(0.5)
                    self.prev_state = self.current_state
                    ability_name, page_path = self.d.get_ability_and_page()
                    action_list = self.action_detector.get_actions(self.d)
                    self.current_state = self.state_class(action_list, ability_name, page_path)
                    if isinstance(self.agent, QLearningAgent):
                        self.agent.previous_state = self.agent.get_state_index(self.current_state)
                        self.agent.previous_action = self.agent.get_action_index(action)
                with self.lock:
                    self.state_dict[self.current_state] = self.state_dict.get(self.current_state, 0) + 1
                    actions = self.action_detector.get_actions(self.d)
                    for action in actions:
                        self.action_dict.setdefault(action, 0)
                    self.state_count = 0
                action_list = self.action_detector.get_actions(self.d)
                ability_name, page_path = self.d.get_ability_and_page()
                self.prev_state = self.current_state = self.state_class(action_list, ability_name, page_path)
        # self.status_thread.join()
        # self.save_testing_result()
        # self.d.stop_app(self.app)
        self.d.force_stop_app()

    def add_new_state_to_list(self, new_state: WindowState):
        for state in self.state_dict.keys():
            if state == new_state:
                with self.lock:
                    self.state_dict[state] += 1
                    # self.state_dict[state] = self.state_dict.get(state, 0) + 1
                return state
        with self.lock:
            self.state_dict[new_state] = 1
        # new_state_abstraction = self.agent.state_abstraction(new_state)
        # self.state_dict[new_state_abstraction] = self.state_dict.get(new_state_abstraction, 0) + 1
        # if new_state_abstraction in self.state_dict:
        #     self.state_dict[new_state_abstraction] += 1
        # else:
        #     self.state_dict[new_state_abstraction] = 1

    def transit(self, chosen_action: WindowAction, new_state: WindowState) -> None:
        self.add_new_state_to_list(new_state)
        if chosen_action is not None:
            self.current_state.update_action_execution_time(chosen_action)
            self.current_state.update_transition_information(chosen_action, new_state)
        self.prev_state = self.current_state
        self.current_state = new_state
        if self.prev_state == self.current_state:
            self.same_state_count += 1
        else:
            self.same_state_count = 0
        print(f"previous state: {self.prev_state}, current state: {self.current_state}")
        with self.lock:
            self.transition_record_list.append((self.prev_state, chosen_action, self.current_state))
        self.update_dfa(self.prev_state, self.current_state, chosen_action)

    def update_ptg(self, pre_page_path, page_path, chosen_action):
        if page_path not in self.PTG:
            self.PTG[page_path] = []
        if isinstance(chosen_action, ClickAction) and pre_page_path != page_path:
            print({"component": chosen_action.location, "action": "click", "targetPage": page_path})
            exist = False
            for obj in self.PTG[pre_page_path]:
                c, t = obj["component"], obj["targetPage"]
                if c == chosen_action.location and t == page_path:
                    exist = True
                    break
            if not exist:
                print(f"updatePTG: component: {chosen_action.location}, action: click, targetPage: {page_path}")
                self.PTG[pre_page_path].append(
                    {"component": chosen_action.location, "action": "click", "targetPage": page_path})

    def update_dfa(self, prev_state, current_state, chosen_action):
        if prev_state is None or not isinstance(prev_state, ActionSetState) or not isinstance(current_state,
                                                                                              ActionSetState) or not isinstance(
            chosen_action, ClickAction):
            return
        if prev_state not in self.DFA:
            self.DFA[prev_state] = {}
        if current_state not in self.DFA:
            self.DFA[current_state] = {}
        if not isinstance(chosen_action, BackAction) and prev_state != current_state:
            if chosen_action in self.DFA[prev_state] and self.DFA[prev_state][chosen_action] == current_state:
                return
            print(f"updateDFA: prev_state: {prev_state}, current_state: {current_state}")
            self.DFA[prev_state][chosen_action] = current_state
        # print(self.DFA)

    # 无边权BFS求最短路
    def get_shortest_path(self, current_state) -> list[WindowAction]:
        # dist: dict[WindowState, int] = defaultdict(lambda: len(self.state_dict))
        if current_state not in self.DFA:
            return []
        vis = set()
        parents = defaultdict(lambda: (None, None))
        q = deque([current_state])
        vis.add(current_state)
        while q:
            state = q.popleft()
            for action, next_state in self.DFA[state].items():
                if next_state not in vis:
                    vis.add(next_state)
                    parents[next_state] = (action, state)
                    q.append(next_state)
        target_state = min([node for node in self.state_dict if node in vis], key=self.state_dict.get)
        path = []
        cur = target_state
        while True:
            action, cur = parents[cur]
            if action is None or cur is None:
                break
            path.append(action)
        path.reverse()
        return path

    def check_valid_state(self):
        app, ability_name = self.d.current_app()
        return app == self.app and ability_name != ""

    # def save_testing_result(self):
    #     with open(f"{self.app}_q-learning_{TIME}s.txt", "a") as f:
    #         f.write(f"action_count: {self.action_count}\n")
    #         f.write("\n")
    #         for ability_name, ability_count in self.ability_count_dict.items():
    #             f.write(f"{ability_name}: {ability_count}\n")
    #         f.write("\n")
    #         for page_path, page_count in self.page_count_dict.items():
    #             f.write(f"{page_path}: {page_count}\n")
    #         f.write("\n")
    #         for state, count in self.state_dict.items():
    #             f.write(f"{state}: {count}\n")
    #     with open("new_PTG.json", "w", encoding="utf-8") as f:
    #         json.dump(self.PTG, f, ensure_ascii=False, indent=2)
    #
    # def print_status(self):
    #     t = 0
    #     res = ""
    #     while t <= TIME:
    #         s = f"{t},{len(self.ability_count_dict)},{len(self.page_count_dict)},{len(self.state_dict)},{self.action_count}\n"
    #         res += s
    #         print(s)
    #         time.sleep(1)  # 每隔一秒打印一次
    #         t += 1
    #     with open(f"{self.app}_q-learning_{TIME}s.txt", "w") as f:
    #         f.write(res)
    #         f.write("\n")

    def stop(self):
        self.d.force_stop_app()
        self.stop_event.set()
