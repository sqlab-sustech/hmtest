import logging

import math
import random
from collections import defaultdict

from action.impl.back_action import BackAction
from action.impl.click_action import ClickAction
from action.impl.restart_action import RestartAction
from action.window_action import WindowAction
from agent.agent import Agent
from config import LogConfig
from exceptions import NoActionsException
from hmdriver2.driver import Driver
from state.impl.action_set_state import ActionSetState
from state.impl.out_of_domain_state import OutOfDomainState
from state.impl.same_url_state import SameUrlState
from state.window_state import WindowState

LogConfig.init_log_config('output')

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
logger.addHandler(LogConfig.get_file_handler())
logger.propagate = False


class QLearningAgent(Agent):
    def __init__(self, d: Driver, app: str, ability_name: str, PTG: dict, use_ptg: bool, config):
        super().__init__(d, app, ability_name, PTG, use_ptg, config)
        self.d = d
        self.app = app
        self.ability_name = ability_name
        self.PTG = PTG
        self.AGENT_TYPE = "Q"
        self.ALPHA = config["agent"].get("alpha", 0.1)
        self.GAMMA = config["agent"].get("gamma", 0.5)
        self.EPSILON = config["agent"].get("epsilon", 0.1)
        self.INITIAL_Q_VALUE = config["agent"].get("initial-q-value", 10.0)
        self.state_repr_list = list()
        self.q_table: dict[int, dict[int, float]] = dict()
        self.page_path_count = defaultdict(int)
        self.state_count = defaultdict(int)
        self.trans_count = defaultdict(int)
        self.previous_state: int | None = None
        self.previous_action: int | None = None
        self.use_ptg = use_ptg
        self.in_degree = defaultdict(int)
        self.calculate_in_degree()
        self.transition_count: dict[tuple[int, int, int], int] = defaultdict(int)
        self.total_action_count = 0

    def calculate_in_degree(self):
        for source_page, actions in self.PTG.items():
            for action in actions:
                target_page = action.get("targetPage")
                if target_page and source_page != target_page:
                    self.in_degree[target_page] += 1
        print(self.in_degree)

    def get_state_index(self, state: WindowState):
        if len(self.state_repr_list) == 0:
            self.state_repr_list.append(OutOfDomainState(self.app, self.ability_name))
            # self.state_repr_list.append(ActionExecuteFailedState("111"))
            self.state_repr_list.append(SameUrlState(self.app, self.ability_name))
            self.q_table[0] = dict()
            self.q_table[1] = dict()
            # self.q_table[2] = dict()
            self.q_table[0][0] = -9999
            self.q_table[1][0] = -99
            self.q_table[0][1] = -9999
            self.q_table[1][1] = -99
            # self.q_table[2][0] = -99

        ability_name, page_path = self.d.get_ability_and_page()
        if len(self.action_list) == 0:
            self.action_list.append(RestartAction(self.app, self.ability_name))
            self.action_list.append(BackAction(ability_name, page_path))
            self.action_count[0] = 0
            self.action_count[1] = 0
        if isinstance(state, OutOfDomainState):
            return 0
        # if isinstance(state, ActionExecuteFailedState):
        #     return 1
        if isinstance(state, SameUrlState):
            return 1

        state_instance = self.state_abstraction(state)
        if state_instance not in self.state_repr_list:
            s_idx = len(self.state_repr_list)
            self.state_repr_list.append(state_instance)
            action_value = dict()
            actions = state.get_action_list()
            for action in actions:
                if action not in self.action_list:
                    self.action_list.append(action)
                a_idx = self.action_list.index(action)
                # if  action.locator.value == 'xpath':
                # action_value[a_idx] = self.INITIAL_Q_VALUE
                exist = False
                if self.use_ptg and state.page_path in self.PTG:
                    for obj in self.PTG[state.page_path]:
                        c, t = obj["component"], obj["targetPage"]
                        if c == action.location and state.page_path != t:
                            exist = True
                            next_page = t
                            break
                    # 如果存在PTG的边，初始值设置高的分数
                    if exist:
                        print("exist")
                        print(f"{state.page_path}, {c} -> {t}")
                        # 跳转
                        if t:
                            action_value[a_idx] = 10.4
                        # 返回
                        else:
                            action_value[a_idx] = self.INITIAL_Q_VALUE
                    elif self.in_degree[state.page_path] == 0 and isinstance(action, BackAction):
                        action_value[a_idx] = -9999
                    else:
                        action_value[a_idx] = self.INITIAL_Q_VALUE
                else:
                    action_value[a_idx] = self.INITIAL_Q_VALUE
                # else:
                #     action_value[a_idx] = self.INITIAL_Q_VALUE
                # if self.use_ptg:
                #     if isinstance(action, ClickAction) and "TabBar" in action.location:
                #         print("TabBar exist")
                #         action_value[a_idx] = 10.5
            self.q_table[s_idx] = action_value
        else:
            s_idx = self.state_repr_list.index(state_instance)
        return s_idx

    def get_reward(self, prev_state_index, action_index, state_index):
        # if self.AGENT_TYPE == "W":
        #     s = "{}-{}-{}".format(self.previous_state, self.previous_action, state_index)
        #     self.trans_count[s] += 1
        #     reward = 1 / math.sqrt(self.trans_count[s])
        #     return reward
        # elif self.AGENT_TYPE == "Q":
        # window_state = self.state_repr_list[state_index]
        # if isinstance(window_state, OutOfDomainState) or isinstance(window_state, SameUrlState):
        #     return 0
        action_count = self.action_count[self.previous_action]
        print(f"transition: {prev_state_index}, {action_index}, {state_index}")
        self.transition_count[(prev_state_index, action_index, state_index)] += 1
        # if action_count == 1:
        #     reward = 1.0
        # else:
        #     reward = 1.0 / action_count
        # reward = 1.0 / math.sqrt(action_count)
        reward = 1.0 / self.transition_count[(prev_state_index, action_index, state_index)]
        print(f"reward: {reward}")
        with open("output/log.txt", "a") as f:
            f.write(f"transition: {prev_state_index}, {action_index}, {state_index}\n")
            f.write(f"reward: {reward}\n")
        # reward = 1.0 / math.sqrt(self.state_count[state_index] + 1)
        # 负奖励，与访问次数相关
        # penalty = 0.1 * self.state_count[state_index]
        # 如果是第一次访问
        # ability_name, page_path = self.d.get_ability_and_page()
        # if self.state_count[state_index] == 1:
        # if self.use_ptg:
        #     if page_path:
        #         if self.page_path_count[page_path] == 0 and page_path in self.PTG:
        #             # 获取出度
        #             # out_degree = len(self.PTG[state_index])
        #             out_degree = len(self.PTG[page_path])
        #             # 定义一个系数来平衡奖励大小，可根据实验调整
        #             bonus_factor = 0.25
        #             bonus = out_degree * bonus_factor
        #
        #             # 额外奖励叠加
        #             reward += bonus
        #         self.page_path_count[page_path] += 1
        return reward

    # def update(self, window_state_index, window_state):
    #     ps_q_values = self.q_table[self.previous_state]
    #     cs_q_values = self.q_table[window_state_index]
    #     reward = self.get_reward(window_state_index)
    #     q_predict = ps_q_values[self.previous_action]
    #     if self.AGENT_TYPE == "Q":
    #         action_len = 1
    #         # if isinstance(window_state, ActionExecuteFailedState):
    #         #     action_list = window_state.get_action_list()
    #         #     action_len = len(action_list)
    #         # gamma = 0.9 * math.exp(-0.1 * (abs(action_len) - 1))
    #         gamma = self.GAMMA
    #     else:
    #         gamma = self.GAMMA
    #     q_target = reward + gamma * max(cs_q_values.values())
    #     print(f"Updated Q[{self.previous_state}][{self.previous_action}] Value:",
    #           self.q_table[self.previous_state][self.previous_action], "->",
    #           q_predict + self.ALPHA * (q_target - q_predict))
    #     msg = f"Updated Q[{self.previous_state}][{self.previous_action}] Value:"+str(self.q_table[self.previous_state][self.previous_action])+"->"+str(q_predict + self.ALPHA * (q_target - q_predict))
    #     with open("log.txt", "a") as f:
    #         f.write(msg+"\n")
    #     logger.info(msg)
    #     self.q_table[self.previous_state][self.previous_action] = q_predict + self.ALPHA * (q_target - q_predict)

    def update(self, state_index, action_index):
        ps_q_values = self.q_table[self.previous_state]
        cs_q_values = self.q_table[state_index]
        reward = self.get_reward(self.previous_state, action_index, state_index)
        q_predict = ps_q_values[action_index]
        if self.AGENT_TYPE == "Q":
            action_len = 1
            # if isinstance(window_state, ActionExecuteFailedState):
            #     action_list = window_state.get_action_list()
            #     action_len = len(action_list)
            # gamma = 0.9 * math.exp(-0.1 * (abs(action_len) - 1))
            gamma = self.GAMMA
        else:
            gamma = self.GAMMA
        q_target = reward + gamma * max(cs_q_values.values())
        print(f"Updated Q[{self.previous_state}][{action_index}] Value:",
              self.q_table[self.previous_state][action_index], "->",
              q_predict + self.ALPHA * (q_target - q_predict))
        msg = f"Updated Q[{self.previous_state}][{action_index}] Value:" + str(
            self.q_table[self.previous_state][action_index]) + "->" + str(
            q_predict + self.ALPHA * (q_target - q_predict))
        with open("output/log.txt", "a") as f:
            f.write(msg + "\n")
        logger.info(msg)
        self.q_table[self.previous_state][action_index] = q_predict + self.ALPHA * (q_target - q_predict)

    def get_action_index(self, action):
        if isinstance(action, RestartAction):
            return 0
        return self.action_list.index(action)

    def get_action(self, window_state: WindowState):
        actions = window_state.get_action_list()
        # TODO: Add ActionExecuteFailedState and RestartAction
        ability_name, page_path = self.d.get_ability_and_page()
        chosen_action = None
        if len(actions) == 0:
            chosen_action = BackAction(ability_name, page_path)
            # raise NoActionsException("The state does not have any actions")

        stop_update = False

        state_index = self.get_state_index(window_state)
        self.state_count[state_index] += 1
        # x = random.uniform(0, 1)
        x = random.random()
        with open("output/log.txt", "a") as f:
            f.write(str(x) + "\n")
        print(x)
        # if chosen_action or 0 <= x < self.EPSILON:
        #     print("q-learning")
        #     with open("output/log.txt", "a") as f:
        #         f.write("q-learning" + "\n")
        #     chosen_action = actions[0]
        #     max_val = self.q_table[state_index][self.get_action_index(chosen_action)]
        #     max_actions = [chosen_action]
        #     for i in range(1, len(actions)):
        #         temp_action = actions[i]
        #         if isinstance(temp_action, RestartAction):
        #             chosen_action = temp_action
        #             max_actions = [temp_action]
        #             break
        #         if self.q_table[state_index][self.get_action_index(temp_action)] > max_val:
        #             max_val = self.q_table[state_index][self.get_action_index(temp_action)]
        #             chosen_action = temp_action
        #             max_actions = [temp_action]
        #         elif self.q_table[state_index][self.get_action_index(temp_action)] == max_val:
        #             max_actions.append(temp_action)
        #     chosen_action = random.choice(max_actions)
        # elif self.EPSILON <= x < 0.5 + self.EPSILON / 2:
        #     with open("output/log.txt", "a") as f:
        #         f.write("random" + "\n")
        #     print("random")
        #     max_val = max(self.q_table[state_index].values())
        #     chosen_action = random.choice([action for action in actions if action != BackAction()])
        # else:
        #     with open("output/log.txt", "a") as f:
        #         f.write("random back" + "\n")
        #     print("random back")
        #     chosen_action = BackAction()
        #     max_val = self.q_table[state_index][self.get_action_index(chosen_action)]
        if chosen_action:
            max_val = self.q_table[state_index][self.get_action_index(chosen_action)]
        elif len(actions) == 1 and isinstance(actions[0], RestartAction):
            chosen_action = actions[0]
            max_val = self.q_table[state_index][self.get_action_index(chosen_action)]
        else:
            if x >= self.EPSILON:
                with open("output/log.txt", "a") as f:
                    f.write("q-learning" + "\n")
                print("q-learning")
                chosen_action = actions[0]
                max_val = self.q_table[state_index][self.get_action_index(chosen_action)]
                max_actions = [chosen_action]
                for i in range(1, len(actions)):
                    temp_action = actions[i]
                    # if isinstance(temp_action, RestartAction):
                    #     chosen_action = temp_action
                    #     max_actions = [temp_action]
                    #     break
                    if self.q_table[state_index][self.get_action_index(temp_action)] > max_val:
                        max_val = self.q_table[state_index][self.get_action_index(temp_action)]
                        chosen_action = temp_action
                        max_actions = [temp_action]
                    elif self.q_table[state_index][self.get_action_index(temp_action)] == max_val:
                        max_actions.append(temp_action)
                chosen_action = random.choice(max_actions)
                print(chosen_action)
            # elif 0.5 <= x < (1 if self.use_ptg and self.in_degree[page_path] == 0 else 1):
            else:
                with open("output/log.txt", "a") as f:
                    f.write("random" + "\n")
                print("random")
                max_val = max(self.q_table[state_index].values())
                # chosen_action = random.choice(actions)
                if self.use_ptg and self.in_degree[page_path] == 0:
                    temp_actions = [action for action in actions if not isinstance(action, BackAction)]
                    if temp_actions:
                        chosen_action = random.choice(temp_actions)
                    else:
                        chosen_action = BackAction(ability_name, page_path)
                else:
                    chosen_action = random.choice(actions)
                # # 基础参数设置
                # unvisited_bonus = 5.0  # 未访问过的状态附加高权重
                # out_degree_factor = 0.1  # 根据出度增加的权重系数
                # weights = []
                # for action in actions:
                #     a_idx = self.get_action_index(action)
                #     exist = False
                #     if isinstance(window_state, ActionSetState) and window_state.page_path in self.PTG:
                #         for obj in self.PTG[window_state.page_path]:
                #             c, t = obj["component"], obj["targetPage"]
                #             if c == action.location:
                #                 exist = True
                #                 next_page = t
                #                 break
                #     if exist:
                #         # 已访问过的状态
                #         out_degree = len(self.PTG[next_page])
                #         # 基础权重1.0 + 出度因子
                #         w = 1.0 + out_degree_factor * out_degree
                #
                #         # 如果想进一步降低访问过很多次的状态的权重，可根据访问次数做折减
                #         # visit_count = visited_states[next_state]
                #         visit_count = self.state_count[state_index]
                #         # 简单示例：每访问10次，该状态的探索价值减半
                #         w = w / (1 + (visit_count / 10.0))
                #      weights
            # else:
            #     with open("output/log.txt", "a") as f:
            #         f.write("random back" + "\n")
            #     print("random back")
            #     chosen_action = BackAction()
            #     max_val = self.q_table[state_index][self.get_action_index(chosen_action)]

        self.action_count[self.get_action_index(chosen_action)] += 1
        # if self.previous_state is not None and self.previous_action is not None:
        #     self.update(state_index, window_state)
        # print("previous_state: ", self.previous_state, "current_state: ", state_index)
        # self.previous_state = state_index
        # self.previous_action = self.get_action_index(chosen_action)
        print("max_q_value: ", max_val, "  chosen_action: ", chosen_action)
        with open("output/log.txt", "a") as f:
            f.write(f"max_q_value: {max_val}  chosen_action: {chosen_action}\n")
        print(self.state_count)
        print(self.action_count)
        print(self.q_table)
        self.total_action_count += 1
        # decay_rate = (0.5 - 0.2) / 80
        # self.EPSILON = max(self.EPSILON - decay_rate * self.total_action_count, 0.2)
        return chosen_action

    def update_state(self, chosen_action: WindowAction, window_state: WindowState) -> None:
        state_index = self.get_state_index(window_state)
        action_index = self.get_action_index(chosen_action)
        if self.previous_state is not None and self.previous_action is not None:
            self.update(state_index, action_index)
        print("previous_state: ", self.previous_state, "current_state: ", state_index)
        self.previous_state = state_index
        self.previous_action = action_index
