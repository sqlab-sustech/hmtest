import json
import logging
import os
import pickle
import threading
from datetime import datetime

from bs4 import BeautifulSoup

from action.impl.back_action import BackAction
from action.impl.restart_action import RestartAction
from config import LogConfig
from state.impl.out_of_domain_state import OutOfDomainState
from state.impl.same_url_state import SameUrlState
from app_test import AppTest

logger = logging.getLogger(__name__)
logger.addHandler(LogConfig.get_file_handler())


class DataCollector(threading.Thread):
    def __init__(self, app_test: AppTest, project_path: str):
        super().__init__()
        self.output_path = "./output"
        self.record_interval = 60
        self.app_test = app_test
        # self.open_sourced = open_sourced
        self.project_path = project_path
        self.stop_event = threading.Event()
        self.count = 0
        os.makedirs(os.path.join(self.output_path, "data"), exist_ok=True)
        os.makedirs(os.path.join(self.output_path, "pickles"), exist_ok=True)
        if os.path.exists(os.path.join(self.output_path, "coverage.csv")):
            os.remove(os.path.join(self.output_path, "coverage.csv"))
        with open(os.path.join(self.output_path, "coverage.csv"), "w", encoding="utf-8") as f:
            f.write("time,statement,branch,function,line\n")

    def run(self):
        while not self.stop_event.is_set():
            self.stop_event.wait(self.record_interval)
            self.count += 1
            if not self.stop_event.is_set():
                self.save_data()

        if self.stop_event.is_set():
            self.app_test.join()
            # self.count += 1
            self.save_data(finish=True)

    def save_data(self, finish=False):
        with self.app_test.lock:
            action_list = sorted(self.app_test.action_dict.keys())
            action_list_with_execution_time = [(str(key), self.app_test.action_dict[key]) for key in action_list]
            state_list = sorted(self.app_test.state_dict.keys())
            state_dict_list = []
            for state in state_list:
                if not isinstance(state, OutOfDomainState) and not isinstance(state, SameUrlState):
                    action_list_in_state = state.get_action_list()
                    action_index_list = []
                    for action in action_list_in_state:
                        action_index_list.append(action_list.index(action))
                    state_dict = {"info": str(state), "action_list": action_index_list,
                                  "visited_time": self.app_test.state_dict[state]}
                    state_dict_list.append(state_dict)
                else:
                    state_dict_list.append({"info": str(state), "action_list": list(map(str, state.get_action_list())),
                                            "visited_time": self.app_test.state_dict[state]})
            page_count_dict = self.app_test.page_count_dict.copy()
            transition_tuple_list = []
            for transition_record in self.app_test.transition_record_list:
                if transition_record[1] is None:
                    action_index_transition_record = None
                elif isinstance(transition_record[1], RestartAction) or isinstance(transition_record[1], BackAction):
                    action_index_transition_record = str(transition_record[1])
                else:
                    action_index_transition_record = action_list.index(transition_record[1])
                transition_tuple_list.append((state_list.index(transition_record[0]) if transition_record[
                                                                                            0] is not None else None,
                                              action_index_transition_record,
                                              state_list.index(transition_record[2])))

        with open(os.path.join(self.output_path, "data", f"{self.count * self.record_interval}" + ".json"),
                  "w") as f:
            json.dump(
                {"action_list": action_list_with_execution_time, "state_list": state_dict_list,
                 "page_count": page_count_dict,
                 "transition_list": transition_tuple_list,
                 "action_count": self.app_test.action_count}, f, indent=4, sort_keys=True,
            )

        states = [state for state in state_list]
        with open(os.path.join(self.output_path, "pickles", f"{self.count * self.record_interval}" + ".pkl"),
                  "wb") as f:
            pickle.dump(states, f)

        with open(os.path.join(self.output_path, "data", "newest" + ".json"), "w") as f:
            json.dump(
                {"action_list": action_list_with_execution_time, "state_list": state_dict_list,
                 "page_count": page_count_dict,
                 "transition_list": transition_tuple_list,
                 "action_count": self.app_test.action_count}, f, indent=4, sort_keys=True)
        with open(os.path.join(self.output_path, "pickles", "newest.pkl"), "wb") as f:
            pickle.dump(states, f)

        # if self.project_path:
        #     self.get_coverage()

        if finish:
            with open(os.path.join(self.output_path, "ptg.json"), "w") as f:
                json.dump(self.app_test.PTG, f, ensure_ascii=False, indent=2)

            with open(os.path.join(self.output_path, "dfa.pkl"), "wb") as f:
                pickle.dump(self.app_test.DFA, f)

        logger.info("Data saved successfully")

    def get_coverage(self):
        # module_name = "entry"
        module_name = "phone"

        data_cmd = f"hdc file recv data/app/el2/100/base/{self.app_test.app}/haps/{module_name}/cache {self.project_path}"
        report_cmd = f"hvigorw collectCoverage -p projectPath={self.project_path} -p reportPath={self.project_path}/report -p coverageFile={self.project_path}/{module_name}/.test/default/intermediates/ohosTest/init_coverage.json#{self.project_path}/cache"
        os.system(f"cd {self.project_path} && rm -rf cache report && {data_cmd} && {report_cmd}")
        try:
            with open(f"{self.project_path}/report/index.html") as f:
                html = f.read()
            soup = BeautifulSoup(html, 'html.parser')

            # 找到包含四个区块的div
            coverage_divs = soup.select('.clearfix > .fl.pad1y.space-right2')

            # coverage_divs是一个列表，每个元素对应一种覆盖率
            # 顺序一般为：Statements, Branches, Functions, Lines
            results = []
            output_json = []
            for div in coverage_divs:
                percentage = div.find('span', class_='strong').text.strip()
                metric_name = div.find('span', class_='quiet').text.strip()
                fraction = div.find('span', class_='fraction').text.strip()
                # results[metric_name] = {
                #     'percentage': percentage,
                #     'fraction': fraction
                # }
                results.append((percentage, fraction))
            # obj = {
            #     "time": self.count * self.record_interval,
            #     "statement": results[0],
            #     "branch": results[1],
            #     "function": results[2],
            #     "line": results[3]
            # }
            line = f"{self.count * self.record_interval},{results[0][0]};{results[0][1]},{results[1][0]};{results[1][1]},{results[2][0]};{results[2][1]},{results[3][0]};{results[3][1]}\n"
        except Exception as e:
            line = f"{self.count * self.record_interval},0%;0/1,0%;0/1,0%;0/1,0%;0/1\n"
        print("Coverage: ", line)
        with open(os.path.join(self.output_path, "coverage.csv"), "a") as f:
            f.write(line)

    def stop(self):
        self.stop_event.set()
