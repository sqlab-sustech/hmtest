import json
import logging
import os.path
import pickle
import random
import threading
import time
from collections import defaultdict, deque

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
from state.impl.action_set_state import ActionSetState
from state.impl.out_of_domain_state import OutOfDomainState
from state.impl.same_url_state import SameUrlState
from state.window_state import WindowState

logger = logging.getLogger(__name__)
logger.addHandler(LogConfig.get_file_handler())


class AppTest:
    def __init__(self, serial: str, app: str, project_path: str, use_ptg: bool, use_dfa: bool, agent_type, module_name,
                 TIME):
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
        self.transition_record_list: list[tuple[WindowState, WindowAction, WindowState]] = []
        self.ability_count_dict: dict[str, int] = {}
        self.action_count = 0
        self.PTG = {}
        self.DFA: dict[WindowState, dict[WindowAction, WindowState]] = {}
        self.same_page_count = 0
        self.same_state_count = 0
        self.no_action_count = 0
        self.state_count = 0
        self.similar_states = defaultdict(list)
        self.all_states = set()
        self.module_name = module_name
        if self.use_ptg and self.project_path:
            if os.path.exists("PTG.json"):
                with open("PTG.json", "r", encoding="utf-8") as f:
                    self.PTG = json.load(f)
        if agent_type == "random":
            self.agent = RandomAgent()
        elif "dfs" in agent_type:
            self.agent = DFSAgent(self.d, self.app, self.ability_name, self.PTG)
        elif agent_type == "q-learning" or agent_type == "dynamic-q-learning":
            self.agent = QLearningAgent(self.d, self.app, self.ability_name, self.PTG, False)
        else:
            self.agent = QLearningAgent(self.d, self.app, self.ability_name, self.PTG, True)
        # self.agent = QLearningAgent(self.d, self.app, self.ability_name, self.PTG)
        # self.agent = RandomAgent()
        # self.agent = DFSAgent(self.d, self.app, self.ability_name, self.PTG)
        # self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.transition_record_count: dict[tuple[WindowState, WindowAction, WindowState], int] = defaultdict(int)
        self.TIME = TIME
        if os.path.exists("output"):
            os.removedirs("output")
        os.makedirs("output", exist_ok=True)
        os.makedirs("output/data", exist_ok=True)
        if os.path.exists("output/coverage.csv"):
            os.remove("output/coverage.csv")

    @property
    def ability_name(self):
        # 有时候bm dump会卡住
        # app_info = self.d.get_app_info(self.app)
        # return app_info["hapModuleInfos"][0]["mainAbility"]
        if self.app == "com.itcast.pass_interview":
            return "PhoneAbility"
        return "EntryAbility"

    def start_test(self):
        # self.d.stop_app(self.app)
        logger.info("Execution start")
        self.d.start_app(self.app, self.ability_name)
        if self.app == "com.itcast.pass_interview":
            time.sleep(1.5)
            self.d.xpath("//root[1]/Flex[1]/Tabs[1]/TabBar[1]/Column[4]").click_if_exists()
            self.d.xpath("//root[1]/Flex[1]/Tabs[1]/Swiper[1]/TabContent[1]/Column[1]/Row[1]/Text[1]").click_if_exists()
            self.d.xpath(
                "//root[1]/Column[1]/Navigation[1]/NavBar[1]/NavBarContent[1]/Column[1]/Column[2]/Row[1]/Checkbox[1]").click_if_exists()
            self.d.xpath(
                "//root[1]/Column[1]/Navigation[1]/NavBar[1]/NavBarContent[1]/Column[1]/Column[2]/Button[1]").click_if_exists()
            self.d.force_stop_app()
            self.d.start_app(self.app, self.ability_name)
        if self.app == "com.huawei.hmos.world":
            time.sleep(1.5)
            self.d.xpath("//root[1]/GridRow[1]/GridCol[1]/Column[1]/Row[1]/Button[2]").click_if_exists()
            self.d.xpath("//root[1]/Column[1]/Stack[1]/Button[1]").click_if_exists()
            self.d.xpath("//root[1]/Stack[1]/GridRow[1]/GridCol[1]/Column[1]/Button[1]").click_if_exists()
            time.sleep(1)
            self.d.xpath("//root[1]/Stack[1]/Scroll[1]/Column[1]/Button[1]").click_if_exists()
        # if self.app == "com.legado.app" or self.app == "com.itcast.pass_interview":
        time.sleep(1.5)
        # self.stop_event.wait(3)
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
        self.data_thread = threading.Thread(target=self.save_tmp_data)
        self.data_thread.daemon = True  # 将线程设置为守护线程，主线程退出时它也会退出
        self.data_thread.start()
        pre_page_path = page_path
        start_time = time.time()
        while time.time() - start_time <= self.TIME:
            chosen_action = self.agent.get_action(self.current_state)
            logger.info(f"Chosen action: {chosen_action}")
            print(f"Chosen action: {chosen_action}")
            with self.lock:
                # if not isinstance(chosen_action, RestartAction):
                # if isinstance(chosen_action, ClickAction):
                # self.action_dict[chosen_action] += 1
                self.action_dict[chosen_action] = self.action_dict.get(chosen_action, 0) + 1
                self.action_count += 1

            with open("output/log.txt", "a") as f:
                f.write(str(self.current_state) + "\n")
                f.write(str(chosen_action) + "\n")
            with self.lock:
                prev_state_count = len(self.state_dict)
            chosen_action.execute(self.d)
            # if (self.app == "com.legado.app" or self.app == "com.itcast.pass_interview") and isinstance(chosen_action, RestartAction):
            time.sleep(1.5)
            # pass
            # self.stop_event.wait(3)
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
            #     # self.stop_event.wait(0.5)
            # with self.lock:
            #     self.state_dict[self.current_state] = self.state_dict.get(self.current_state, 0) + 1
            #     actions = self.action_detector.get_actions(self.d)
            #     for action in actions:
            #         self.action_dict.setdefault(action, 0)
            # continue

            check_result = self.check_valid_state()
            ability_name, page_path = self.d.get_ability_and_page()
            check_result = check_result and ability_name != "" and page_path != ""
            # if check_result and self.same_page_count < 1000 and self.same_state_count < 5000:
            if check_result:
                with self.lock:
                    self.ability_count_dict[ability_name] = self.ability_count_dict.get(ability_name, 0) + 1
                    self.page_count_dict[page_path] = self.page_count_dict.get(page_path, 0) + 1
                action_list = self.action_detector.get_actions(self.d)
                with self.lock:
                    for action in action_list:
                        self.action_dict.setdefault(action, 0)

                new_state = self.pre_process(self.state_class(action_list, ability_name, page_path))
                # print(f"new_state: {self.agent.state_abstraction(new_state)}")
                if pre_page_path == page_path:
                    self.same_page_count += 1
                else:
                    self.same_page_count = 0
                print(f"page transition: {pre_page_path}, {chosen_action} -> {page_path}")
                if self.use_ptg:
                    self.update_ptg(pre_page_path, page_path, chosen_action)
                pre_page_path = page_path
                # self.transit(chosen_action, new_state)
            # elif not check_result:
            else:
                self.same_page_count = 0
                self.same_state_count = 0
                print(f"{chosen_action} -> OutOfDomainState")
                new_state = OutOfDomainState(self.app, self.ability_name)
                # self.transit(chosen_action, new_state)
            # else:
            #     self.same_page_count = 0
            #     self.same_state_count = 0
            #     self.state_count = 0
            #     new_state = SameUrlState(self.app, self.ability_name)
            # self.transit(chosen_action, new_state)
            self.agent.update_state(chosen_action, new_state)
            self.transit(chosen_action, new_state)
            with self.lock:
                curr_state_count = len(self.state_dict)
            if curr_state_count == prev_state_count:
                self.state_count += 1
            else:
                self.state_count = 0
            print(f"prev_state_count: {prev_state_count}, curr_state_count: {curr_state_count}")
            if self.use_dfa and (self.state_count >= 7 or self.same_page_count >= 14):
                # print(f"prev_state_count: {prev_state_count}, curr_state_count: {curr_state_count}")
                # if random.random() < 0.2:
                print(f"{self.state_count, self.same_page_count}, restart!")
                with open("output/log.txt", "a") as f:
                    f.write(f"{self.state_count, self.same_page_count}" + "\n")
                self.action_count += 1
                RestartAction(self.app, self.ability_name).execute(self.d)
                # if (self.app == "com.legado.app" or self.app == "com.itcast.pass_interview") and isinstance(chosen_action, RestartAction):
                time.sleep(1.5)
                # self.stop_event.wait(3)
                action_list = self.action_detector.get_actions(self.d)
                ability_name, page_path = self.d.get_ability_and_page()
                self.ability_count_dict[ability_name] = self.ability_count_dict.get(ability_name, 0) + 1
                self.page_count_dict[page_path] = self.page_count_dict.get(page_path, 0) + 1
                self.prev_state = None
                self.current_state = self.pre_process(self.state_class(action_list, ability_name, page_path))
                self.agent.previous_state = self.agent.previous_action = None
                # if random.random() < 0.5:
                actions = self.get_shortest_path(self.current_state, ability_name, page_path)
                # actions = []
                if actions:
                    print("start recover")
                    with open("output/log.txt", "a") as f:
                        f.write(
                            f"prev_state_count: {prev_state_count}, curr_state_count: {curr_state_count}, start recover\n")
                for action in actions:
                    with self.lock:
                        self.action_dict[action] = self.action_dict.get(action, 0) + 1
                    action.execute(self.d)
                    self.action_count += 1
                    with open("output/log.txt", "a") as f:
                        f.write(f"recover action: {action}\n")
                    print(f"recover action: {action}")
                    # self.stop_event.wait(0.5)
                    self.prev_state = self.current_state
                    ability_name, page_path = self.d.get_ability_and_page()
                    action_list = self.action_detector.get_actions(self.d)
                    self.current_state = self.pre_process(self.state_class(action_list, ability_name, page_path))
                    self.transition_record_count[(self.prev_state, action, self.current_state)] += 1
                    if isinstance(self.agent, QLearningAgent):
                        self.agent.previous_state = self.agent.get_state_index(self.current_state)
                        self.agent.previous_action = self.agent.get_action_index(action)
                    self.agent.state_count[self.agent.get_state_index(self.current_state)] += 1
                    self.agent.action_count[self.agent.get_action_index(action)] += 1
                    self.ability_count_dict[ability_name] = self.ability_count_dict.get(ability_name, 0) + 1
                    self.page_count_dict[page_path] = self.page_count_dict.get(page_path, 0) + 1
                with self.lock:
                    self.state_dict[self.current_state] = self.state_dict.get(self.current_state, 0) + 1
                    actions = self.action_detector.get_actions(self.d)
                    for action in actions:
                        self.action_dict.setdefault(action, 0)
                self.state_count = self.same_page_count = 0
                action_list = self.action_detector.get_actions(self.d)
                ability_name, page_path = self.d.get_ability_and_page()
                self.prev_state = self.current_state = self.pre_process(
                    self.state_class(action_list, ability_name, page_path))
                # self.state_dict[self.current_state] = self.state_dict.get(self.current_state, 0) + 1
        self.data_thread.join()
        self.save_final_data()
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
        self.transition_record_count[(self.prev_state, chosen_action, self.current_state)] += 1
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
    def get_shortest_path(self, current_state, ability_name, page_path) -> list[WindowAction]:
        # dist: dict[WindowState, int] = defaultdict(lambda: len(self.state_dict))
        if current_state not in self.DFA:
            return []
        vis = set()
        parents = defaultdict(lambda: (None, None))
        q = deque([current_state])
        vis.add(current_state)
        # while q:
        #     state = q.popleft()
        #     for action, next_state in self.DFA[state].items():
        #         if next_state not in vis:
        #             vis.add(next_state)
        #             parents[next_state] = (action, state)
        #             q.append(next_state)
        # target_state = min([node for node in self.state_dict if node in vis], key=self.state_dict.get)
        # arr = [(prev_state, chosen_action, curr_state) for (prev_state, chosen_action, curr_state), cnt in
        #            self.transition_record_count.items() if
        #            cnt > 0 and isinstance(chosen_action, ClickAction) and prev_state != curr_state]
        if len(self.page_count_dict) == 0:
            return []
        # min_count = min(page_cnt for page_name, page_cnt in self.page_count_dict.items())
        # if arr is None:
        #     return []
        # min_count = min([cnt for (prev_state, chosen_action, curr_state), cnt in
        #                  self.transition_record_count.items() if
        #                  cnt > 0 and isinstance(chosen_action, ClickAction) and prev_state != curr_state])
        # temp = []
        # for prev_state, chosen_action, curr_state in arr:
        #     if self.transition_record_count[(prev_state, chosen_action, curr_state)] == min_count:
        #         temp.append((prev_state, chosen_action, curr_state))
        # for page_name, page_cnt in self.page_count_dict.items():
        #     if page_cnt == min_count:
        #         temp.append(page_name)

        if random.random() < 0.5:
            target_page = min([page_name for page_name in self.page_count_dict.keys()], key=self.page_count_dict.get,
                              default=None)
            # target_page = random.choice(temp)
            print("min_count", self.page_count_dict[target_page])
            print("target_page", target_page)
            with open("output/log.txt", "a") as f:
                f.write(f"min_count: {self.page_count_dict[target_page]}, target_page: {target_page}" + "\n")
        else:
            out_degrees = defaultdict(int)
            for source_page, actions in self.PTG.items():
                for action in actions:
                    target_page = action.get("targetPage")
                    if target_page and source_page != target_page:
                        out_degrees[source_page] += 1
            target_page = max([page_name for page_name in out_degrees.keys()], key=out_degrees.get, default=None)
            print("max_out_degree", out_degrees[target_page])
            print("target_page", target_page)
            with open("output/log.txt", "a") as f:
                f.write(f"max_out_degree: {out_degrees[target_page]}, target_page: {target_page}" + "\n")
        if target_page is None:
            return []
        target_state = None

        if target_page == page_path:
            return []

        while q:
            state = q.popleft()
            if state.page_path == target_page:
                target_state = state
                break
            for action, next_state in self.DFA[state].items():
                if next_state not in vis:
                    vis.add(next_state)
                    parents[next_state] = (action, state)
                    q.append(next_state)

        if target_state is None:
            return []

        # target_state, target_action, curr_state = random.choice(temp)
        path = []
        cur = target_state
        while True:
            action, cur = parents[cur]
            if action is None or cur is None:
                break
            path.append(action)
        path.reverse()
        # path.append(target_action)
        print("recover path: ", path)
        with open("output/log.txt", "a") as f:
            f.write(f"{str(path)}\n")
        return path

    def pre_process(self, new_state: WindowState) -> WindowState:
        self.all_states.add(new_state)
        if not isinstance(new_state, ActionSetState):
            return new_state
        with self.lock:
            for state in self.state_dict.keys():
                if not isinstance(state, ActionSetState):
                    continue
                similarity = state.similarity(new_state)
                if similarity >= 0.80:
                    print("similarity: ", similarity)
                    print(self.agent.state_abstraction(state))
                    print(self.agent.state_abstraction(new_state))
                    self.similar_states[state].append(new_state)
                    return state
                for similar_state in self.similar_states[state]:
                    similarity = similar_state.similarity(new_state)
                    if similarity >= 0.80:
                        print("similarity: ", similarity)
                        print(self.agent.state_abstraction(state))
                        print(self.agent.state_abstraction(new_state))
                        self.similar_states[state].append(new_state)
                        return state

            print("new_state: ", self.agent.state_abstraction(new_state))
            return new_state

    def check_valid_state(self):
        app, ability_name = self.d.current_app()
        return app == self.app and ability_name != ""

    def save_final_data(self):
        # with open(f"{self.app}_q-learning_{TIME}s.txt", "a") as f:
        # with open(f"{self.TIME}s.txt", "a") as f:
        #     f.write(f"action_count: {self.action_count}\n")
        #     f.write("\n")
        #     for ability_name, ability_count in self.ability_count_dict.items():
        #         f.write(f"{ability_name}: {ability_count}\n")
        #     f.write("\n")
        #     for page_path, page_count in self.page_count_dict.items():
        #         f.write(f"{page_path}: {page_count}\n")
        #     f.write("\n")
        #     for state, count in self.state_dict.items():
        #         f.write(f"{state}: {count}\n")
        ability_count_dict = self.ability_count_dict.copy()
        page_count_dict = self.page_count_dict.copy()
        with open(f"output/data/final.json", "w") as f:
            json.dump(
                {
                    "ability_count": ability_count_dict,
                    "page_count": page_count_dict,
                    "action_count": self.action_count,
                    "state_count": len(self.state_dict.keys()),
                    "all_state_count": len(self.all_states),
                }, f, indent=4, sort_keys=True,
            )
        with open("output/ptg.json", "w", encoding="utf-8") as f:
            json.dump(self.PTG, f, ensure_ascii=False, indent=2)
        with open("output/dfa.pkl", "wb") as f:
            pickle.dump(self.DFA, f)
        with open("output/all_states.pkl", "wb") as f:
            pickle.dump(self.all_states, f)
        with open("output/states.pkl", "wb") as f:
            pickle.dump(self.state_dict, f)
        with open(f"output/similar_states.pkl", "wb") as f:
            pickle.dump(self.similar_states, f)

    def save_tmp_data(self):
        t = 0
        while t <= self.TIME:
            # s = f"{t},{len(self.ability_count_dict)},{len(self.page_count_dict)},{len(self.state_dict)},{self.action_count}\n"
            # res += s
            # print(s)
            ability_count_dict = self.ability_count_dict.copy()
            page_count_dict = self.page_count_dict.copy()
            with open(f"output/data/{t}.json", "w") as f:
                json.dump(
                    {
                        "ability_count": ability_count_dict,
                        "page_count": page_count_dict,
                        "action_count": self.action_count,
                        "state_count": len(self.state_dict.keys()),
                        "all_state_count": len(self.all_states)
                    }, f, indent=4, sort_keys=True,
                )
            time.sleep(1)  # 每隔一秒打印一次
            t += 1

    # def stop(self):
    #     self.d.force_stop_app()
