import logging
import threading
import time
import random
import string

from action.detector.click_action_detector import ClickActionDetector
from action.window_action import WindowAction
from agent.impl.chatgpt_agent import ChatgptAgent
from agent.impl.q_learning_agent import QLearningAgent
from agent.impl.random_agent import RandomAgent
from config import LogConfig
from hmdriver2.driver import Driver
from hmdriver2.proto import KeyCode
from state.impl.action_set_state import ActionSetState
from state.window_state import WindowState

logger = logging.getLogger(__name__)
logger.addHandler(LogConfig.get_file_handler())

# 测试时间
TIME = 60


class AppTest:
    def __init__(self, serial, app, open_sourced):
        self.d: Driver = Driver(serial)
        self.app = app
        self.open_sourced = open_sourced
        self.action_detector = ClickActionDetector(self.d)
        self.state_class = ActionSetState
        self.prev_state: WindowState | None = None
        self.current_state: WindowState | None = None
        self.action_dict: dict[WindowAction, int] = {}
        self.state_dict: dict[WindowState, int] = {}
        self.page_count_dict: dict[str, int] = {}
        self.agent = QLearningAgent(self.d)
        self.transition_record_list: list[tuple[WindowState | None, WindowAction, WindowState]] = []
        self.ability_count_dict: dict[str, int] = {}
        self.action_count = 0

    @property
    def ability_name(self):
        # 有时候bm dump会卡住
        app_info = self.d.get_app_info(self.app)
        return app_info["hapModuleInfos"][0]["mainAbility"]
        # return "EntryAbility"

    def start(self):
        # self.d.stop_app(self.app)
        logger.info("Execution start")
        self.d.start_app(self.app, self.ability_name)
        time.sleep(2)
        action_list = self.action_detector.get_actions(self.d)
        ability_name, page_path = self.d.get_ability_and_page()
        self.current_state = self.state_class(action_list, ability_name, page_path)
        for action in action_list:
            self.action_dict.setdefault(action, 0)
        self.state_dict[self.agent.state_abstraction(self.current_state)] = 1
        self.ability_count_dict[ability_name] = self.ability_count_dict.get(ability_name, 0) + 1
        self.page_count_dict[page_path] = self.page_count_dict.get(page_path, 0) + 1
        logger.info(f"Initial state: {self.current_state}")
        t = time.time()
        self.status_thread = threading.Thread(target=self.print_status)
        self.status_thread.daemon = True  # 将线程设置为守护线程，主线程退出时它也会退出
        self.status_thread.start()
        while time.time() - t <= TIME:
            chosen_action = self.agent.get_action(self.current_state, None)
            # logger.info(f"Chosen action: {chosen_action}")
            print(f"Chosen action: {chosen_action}")
            # TODO:
            # self.action_dict[chosen_action] += 1
            self.action_dict[chosen_action] = self.action_dict.get(chosen_action, 0) + 1
            chosen_action.execute(self.d)
            self.action_count += 1
            # TODO: optimize code
            if self.d(id="KeyMenu").exists():
                input_length = random.randint(1, 10)
                characters = string.ascii_letters + string.digits
                input_str = ''.join(random.choice(characters) for _ in range(input_length))
                self.d.input_text(input_str)
                # self.d.press_key(KeyCode.ENTER)
                time.sleep(2)
            action_list = self.action_detector.get_actions(self.d)
            for action in action_list:
                self.action_dict.setdefault(action, 0)
            ability_name, page_path = self.d.get_ability_and_page()
            self.ability_count_dict[ability_name] = self.ability_count_dict.get(ability_name, 0) + 1
            self.page_count_dict[page_path] = self.page_count_dict.get(page_path, 0) + 1
            new_state = self.state_class(action_list, ability_name, page_path)
            self.transit(chosen_action, new_state)
        self.status_thread.join()
        self.save_testing_result()
        # self.d.stop_app(self.app)

    def add_new_state_to_list(self, new_state: WindowState):
        # for state in self.state_dict.keys():
        #     if state == new_state:
        #         self.state_dict[state] += 1
        #         return state
        # self.state_dict[new_state] = 1
        new_state_abstraction = self.agent.state_abstraction(new_state)
        self.state_dict[new_state_abstraction] = self.state_dict.get(new_state_abstraction, 0) + 1
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
        self.transition_record_list.append((self.prev_state, chosen_action, self.current_state))

    def save_testing_result(self):
        with open(f"{self.app}_q-learning_{TIME}s.txt", "a") as f:
            f.write(f"action_count: {self.action_count}\n")
            f.write("\n")
            for ability_name, ability_count in self.ability_count_dict.items():
                f.write(f"{ability_name}: {ability_count}\n")
            f.write("\n")
            for page_path, page_count in self.page_count_dict.items():
                f.write(f"{page_path}: {page_count}\n")
            f.write("\n")
            for state, count in self.state_dict.items():
                f.write(f"{state}: {count}\n")

    def print_status(self):
        t = 0
        res = ""
        while t <= TIME:
            s = f"{t},{len(self.ability_count_dict)},{len(self.page_count_dict)},{len(self.state_dict)},{self.action_count}\n"
            res += s
            print(s)
            time.sleep(1)  # 每隔一秒打印一次
            t += 1
        with open(f"{self.app}_q-learning_{TIME}s.txt", "w") as f:
            f.write(res)
            f.write("\n")
