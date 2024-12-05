import json
import logging
import random
import string
import threading

from action.detector.click_action_detector import ClickActionDetector
from action.impl.back_action import BackAction
from action.impl.restart_action import RestartAction
from action.window_action import WindowAction
from agent.impl.q_learning_agent import QLearningAgent
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
    def __init__(self, serial: str, app: str, open_sourced: bool):
        super().__init__()
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
        self.transition_record_list: list[tuple[WindowState | None, WindowAction, WindowState]] = []
        self.ability_count_dict: dict[str, int] = {}
        self.action_count = 0
        self.PTG = {}
        self.same_page_count = 0
        self.same_state_count = 0
        if self.open_sourced:
            with open("PTG.json", "r", encoding="utf-8") as f:
                self.PTG = json.load(f)
        self.agent = QLearningAgent(self.d, self.app, self.ability_name, self.PTG)
        self.stop_event = threading.Event()
        self.lock = threading.Lock()

    @property
    def ability_name(self):
        # 有时候bm dump会卡住
        # app_info = self.d.get_app_info(self.app)
        # return app_info["hapModuleInfos"][0]["mainAbility"]
        return "EntryAbility"

    def run(self):
        # self.d.stop_app(self.app)
        logger.info("Execution start")
        self.d.start_app(self.app, self.ability_name)
        self.stop_event.wait(3)
        action_list = self.action_detector.get_actions(self.d)
        ability_name, page_path = self.d.get_ability_and_page()
        self.current_state = self.state_class(action_list, ability_name, page_path)
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
            logger.info(f"Chosen action: {chosen_action}")
            print(f"Chosen action: {chosen_action}")
            with self.lock:
                if not isinstance(chosen_action, RestartAction):
                    self.action_dict[chosen_action] += 1
                    self.action_count += 1
            self.action_dict[chosen_action] = self.action_dict.get(chosen_action, 0) + 1
            chosen_action.execute(self.d)
            check_result = self.check_valid_state()
            if check_result and self.same_page_count < 15 and self.same_state_count < 5:
                with self.lock:
                    self.ability_count_dict[ability_name] = self.ability_count_dict.get(ability_name, 0) + 1
                    self.page_count_dict[page_path] = self.page_count_dict.get(page_path, 0) + 1
                action_list = self.action_detector.get_actions(self.d)
                with self.lock:
                    for action in action_list:
                        self.action_dict.setdefault(action, 0)
                ability_name, page_path = self.d.get_ability_and_page()

                new_state = self.state_class(action_list, ability_name, page_path)
                self.transit(chosen_action, new_state)
                if pre_page_path == page_path:
                    self.same_page_count += 1
                else:
                    self.same_page_count = 0
                print(f"page transition: {pre_page_path}, {chosen_action} -> {page_path}")
                pre_page_path = page_path
                self.updatePTG(pre_page_path, page_path, chosen_action)
            elif not check_result:
                new_state = OutOfDomainState(self.app, self.ability_name)
                self.transit(chosen_action, new_state)
            else:
                self.same_page_count = 0
                self.same_state_count = 0
                new_state = SameUrlState(self.app, self.ability_name)
                self.transit(chosen_action, new_state)
            # TODO: optimize code
            self.stop_event.wait(0.5)
            if self.d(id="KeyCanvasKeyboard").exists():
                input_length = random.randint(1, 10)
                characters = string.ascii_letters + string.digits
                input_str = ''.join(random.choice(characters) for _ in range(input_length))
                for i in range(10):
                    self.d.shell(f"uitest uiInput keyEvent {KeyCode.DEL.value}")
                self.d.input_text(input_str)
                # 搜索
                # self.d.click(1100, 2500)
                self.d.press_key(KeyCode.ENTER)
                # time.sleep(2)
                self.stop_event.wait(2)
        # self.status_thread.join()
        # self.save_testing_result()
        # self.d.stop_app(self.app)

    def add_new_state_to_list(self, new_state: WindowState):
        for state in self.state_dict.keys():
            if state == new_state:
                with self.lock:
                    self.state_dict[state] += 1
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
        if self.prev_state == self.current_state:
            self.same_state_count += 1
        else:
            self.same_state_count = 0
        self.prev_state = self.current_state
        self.current_state = new_state
        self.transition_record_list.append((self.prev_state, chosen_action, self.current_state))

    def updatePTG(self, pre_page_path, page_path, chosen_action):
        if page_path not in self.PTG:
            self.PTG[page_path] = []
        if not isinstance(chosen_action, BackAction) and pre_page_path != page_path:
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

    def check_valid_state(self):
        app, ability_name = self.d.current_app()
        return app == self.app

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
        self.stop_event.set()
