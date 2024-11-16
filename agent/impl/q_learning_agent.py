import math
import random
from collections import defaultdict

from action.impl.restart_action import RestartAction
from action.window_action import WindowAction
from agent.agent import Agent
from exceptions import NoActionsException
from hmdriver2.driver import Driver
from state.impl.action_execute_failed_state import ActionExecuteFailedState
from state.window_state import WindowState


class QLearningAgent(Agent):
    def __init__(self, d: Driver):
        super().__init__()
        self.d = d
        self.AGENT_TYPE = "Q"
        self.ALPHA = 1
        self.GAMMA = 0.5
        self.EPSILON = 0.5
        self.INITIAL_Q_VALUE = 10.0
        self.R_REWARD = 10.0
        self.R_PENALTY = -9999.0
        self.MAX_SIM_LINE = 0.8
        self.state_repr_list: list[str] = list()
        self.q_table: dict[int, dict[int, float]] = dict()
        self.page_path_count: dict[int, int] = dict()
        self.state_count = defaultdict(int)
        self.trans_count = defaultdict(int)
        self.previous_state: int | None = None
        self.previous_action: int | None = None

    def get_state_index(self, state: WindowState):
        # if len(self.state_repr_list) == 0:
        #     self.state_repr_list.append(OutOfDomainState("111"))
        #     self.state_repr_list.append(ActionExecuteFailedState("111"))
        #     self.state_repr_list.append(SameUrlState("111"))
        #     self.q_table[0] = dict()
        #     self.q_table[1] = dict()
        #     self.q_table[2] = dict()
        #     self.q_table[0][0] = -9999
        #     self.q_table[1][0] = -99
        #     self.q_table[2][0] = -99

        components = [
            '//root[1]/Column[1]/Tabs[1]/TabBar[1]/Column[1]',
            '//root[1]/Column[1]/Tabs[1]/Swiper[1]/TabContent[1]/Column[1]/Column[1]/Stack[1]/Row[1]/Image[1]',
            '//root[1]/Column[1]/Tabs[1]/Swiper[1]/TabContent[1]/Column[1]/Column[1]/Stack[1]/Row[1]/Image[2]',
            '//root[1]/Column[1]/Tabs[1]/Swiper[1]/TabContent[1]/Column[1]/List[1]/ListItem[1]',
            '//root[1]/Column[1]/Tabs[1]/Swiper[1]/TabContent[1]/Stack[1]/Column[1]/Column[1]/Stack[1]/Row[1]/Image[1]',
            '//root[1]/Column[1]/Tabs[1]/Swiper[1]/TabContent[1]/Stack[1]/Column[1]/Column[1]/Stack[1]/Row[1]/Image[2]',
            '//root[1]/Column[1]/Tabs[1]/Swiper[1]/TabContent[1]/Stack[1]/Column[1]/List[1]/ListItemGroup[1]/ListItem[1]',
            '//root[1]/Column[1]/Tabs[1]/Swiper[1]/TabContent[1]/Column[1]/Column[1]/Stack[1]/Row[1]/Image[1]',
            '//root[1]/Column[1]/Tabs[1]/Swiper[1]/TabContent[1]/Column[1]/Column[1]/Stack[1]/Row[1]/Image[2]',
            '//root[1]/Column[1]/Tabs[1]/Swiper[1]/TabContent[1]/Column[1]',
            '//root[1]/Column[1]/Tabs[1]/Swiper[1]/TabContent[1]/Column[1]/Row[1]',
            '//root[1]/Column[1]/Tabs[1]/Swiper[1]/TabContent[1]/Column[1]/Row[1]/Image[1]',
            '//root[1]/Column[1]/Tabs[1]/TabBar[1]/Column[1]',
            '//root[1]/Column[1]/Tabs[1]/TabBar[1]/Column[2]',
            '//root[1]/Column[1]/Tabs[1]/TabBar[1]/Column[3]',
            '//root[1]/Column[1]/Tabs[1]/TabBar[1]/Column[4]',
        ]

        # if len(self.action_list) == 0:
        #     self.action_list.append(RestartAction("111"))
        #     self.action_count[0] = 0
        # if isinstance(state, OutOfDomainState):
        #     return 0
        # if isinstance(state, ActionExecuteFailedState):
        #     return 1
        # if isinstance(state, SameUrlState):
        #     return 2

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
                if action.locator.value == 'xpath' and action.location in components:
                    # action_value[a_idx] = self.INITIAL_Q_VALUE
                    action_value[a_idx] = 1000
                else:
                    action_value[a_idx] = self.INITIAL_Q_VALUE
            self.q_table[s_idx] = action_value
        else:
            s_idx = self.state_repr_list.index(state_instance)
        return s_idx

    def get_reward(self, state_index):
        if self.AGENT_TYPE == "W":
            s = "{}-{}-{}".format(self.previous_state, self.previous_action, state_index)
            self.trans_count[s] += 1
            reward = 1 / math.sqrt(self.trans_count[s])
            return reward
        elif self.AGENT_TYPE == "Q":
            action_count = self.action_count[self.previous_action]
            if action_count == 1:
                reward = 500
            else:
                reward = 1 / action_count
            return reward

    def update(self, window_state_index, window_state):
        ps_q_values = self.q_table[self.previous_state]
        cs_q_values = self.q_table[window_state_index]
        reward = self.get_reward(window_state_index)
        q_predict = ps_q_values[self.previous_action]
        if self.AGENT_TYPE == "Q":
            action_len = 1
            if isinstance(window_state, ActionExecuteFailedState):
                action_list = window_state.get_action_list()
                action_len = len(action_list)
            gamma = 0.9 * math.exp(-0.1 * (abs(action_len) - 1))
        else:
            gamma = self.GAMMA
        q_target = reward + gamma * max(cs_q_values.values())
        print(f"Updated Q[{self.previous_state}][{self.previous_action}] Value:",
              self.q_table[self.previous_state][self.previous_action], "->",
              q_predict + self.ALPHA * (q_target - q_predict))
        self.q_table[self.previous_state][self.previous_action] = q_predict + self.ALPHA * (q_target - q_predict)

    def get_action_index(self, action):
        if isinstance(action, RestartAction):
            return 0
        return self.action_list.index(action)

    def get_action(self, window_state: WindowState, PTG: dict):
        actions = window_state.get_action_list()
        # TODO: Add ActionExecuteFailedState and RestartAction
        if len(actions) == 0:
            raise NoActionsException("The state does not have any actions")

        chosen_action = None
        stop_update = False

        state_index = self.get_state_index(window_state)
        self.state_count[state_index] += 1
        if random.uniform(0, 1) < self.EPSILON:
            max_val = max(self.q_table[state_index].values())
            chosen_action = random.choice(actions)
        else:
            chosen_action = actions[0]
            max_val = self.q_table[state_index][self.get_action_index(chosen_action)]
            for temp_action in actions:
                if isinstance(temp_action, RestartAction):
                    chosen_action = temp_action
                    break
                if self.q_table[state_index][self.get_action_index(temp_action)] > max_val:
                    max_val = self.q_table[state_index][self.get_action_index(temp_action)]
                    chosen_action = temp_action

        self.action_count[self.get_action_index(chosen_action)] += 1
        if self.previous_state is not None and self.previous_action is not None:
            self.update(state_index, window_state)
        print("previous_state: ", self.previous_state, "current_state: ", state_index)
        self.previous_state = state_index
        self.previous_action = self.get_action_index(chosen_action)
        print("max_q_value: ", max_val, "  chosen_action: ", chosen_action)
        print(self.state_count)
        print(self.action_count)
        print(self.q_table)
        return chosen_action
