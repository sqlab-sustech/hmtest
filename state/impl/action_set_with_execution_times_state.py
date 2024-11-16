import math
from collections import Counter
from collections import defaultdict
from typing import List, Dict, Union, Any, Tuple

from action.impl.click_action import ClickAction
from action.impl.random_input_action import RandomInputAction
from action.impl.random_select_action import RandomSelectAction
from action.window_action import WindowAction
from exceptions import WebtestException
from state.window_state import WindowState


class ActionSetWithExecutionTimesState(WindowState):
    def __init__(self, actions: List[WindowAction], url: str) -> None:
        self.action_dict: Dict[WindowAction, Dict[str, Union[int, WindowState]]] = {
            key: {'execution_time': 0, 'child_state': None} for key in actions}
        self.action_execution_time_histogram: List[int] = [0] * 10
        self.action_execution_time_histogram[0] = len(self.action_dict)
        self.url: str = url
        self.sim_dic = defaultdict(float)

        self.global_url_list = set()  # 用来保存所有网页中可能出现的 URL
        self.global_form_list = set()  # 用来保存可能的form的操作次数
        self.global_tag_list = set()  # 用来保存可能的action的type

    def get_action_list(self) -> List[WindowAction]:
        action_list = list(self.action_dict.keys())
        action_list.sort()
        return action_list

    def get_action_detailed_data(self) -> Tuple[Dict[WindowAction, Any], Any]:
        return self.action_dict, self.action_execution_time_histogram

    def update_action_execution_time(self, action: WindowAction) -> None:
        if action in self.action_dict:
            self.action_dict[action]['execution_time'] += 1
            execution_time = self.action_dict[action]['execution_time']
            if execution_time < 10:
                self.action_execution_time_histogram[execution_time - 1] -= 1
                self.action_execution_time_histogram[execution_time] += 1
        else:
            raise WebtestException("The action is not exist in the state")

    def update_transition_information(self, action: WindowAction, new_state: 'WindowState') -> None:
        if action in self.action_dict:
            self.action_dict[action]['child_state'] = new_state
        else:
            raise WebtestException("The action is not exist in the state")

    # def similarity(self, other: 'WindowState') -> float:
    #     if not isinstance(other, ActionSetWithExecutionTimesState):
    #         return 0
    #     if not self.sim_dic.__contains__(other):
    #         action_list_self = set(self.get_action_list())
    #         action_list_other = set(other.get_action_list())
    #
    #         if len(action_list_self) == 0 and len(action_list_other) == 0:
    #             return 1.0
    #         intersection = action_list_self.intersection(action_list_other)
    #         union = action_list_self.union(action_list_other)
    #         self.sim_dic[other] = len(intersection) / len(union)
    #         other.sim_dic[other] = len(intersection) / len(union)
    #     return self.sim_dic[other]

    def cosine_similarity(self, X: List[int], Y: List[int]) -> float:
        dot_product = sum(x * y for x, y in zip(X, Y))
        magnitude_X = math.sqrt(sum(x ** 2 for x in X))
        magnitude_Y = math.sqrt(sum(y ** 2 for y in Y))

        if magnitude_X == 0 or magnitude_Y == 0:
            return 0
        return float(dot_product) / (magnitude_X * magnitude_Y)

    def convert_action_to_vector(self, actions: List[WindowAction]) -> Dict[str, list[int]]:
        action_counts = defaultdict(Counter)
        for action in actions:
            if isinstance(action, ClickAction):
                addition_info = action.addition_info
                action_counts[action.action_type][addition_info] += 1
                # 维护全局变量
                if action.action_type == 'redirect':
                    self.global_url_list.add(addition_info)
                elif action.action_type == 'submit':
                    self.global_form_list.add(addition_info)
                else:
                    self.global_tag_list.add(addition_info)
            elif isinstance(action, RandomInputAction):
                action_counts['default']['random_input'] += 1
            elif isinstance(action, RandomSelectAction):
                action_counts['default']['random_select'] += 1
                # 其他类型的 WindowAction 计入 jsevent
        global_url_list_sorted = sorted(self.global_url_list)
        global_form_list_sorted = sorted(self.global_form_list)
        global_tag_list_sorted = sorted(self.global_tag_list)

        # 返回计数字典
        # 将 Counter 转换为出现次数列表
        result = {}
        for action_type, addition_info_counter in action_counts.items():
            if action_type == "redirect":
                result[action_type] = [
                    addition_info_counter.get(href, 0) for href in global_url_list_sorted
                ]
            elif action_type == "submit":
                result[action_type] = [
                    addition_info_counter.get(count, 0) for count in global_form_list_sorted
                ]
            else:
                result[action_type] = [
                    addition_info_counter.get(tag_name, 0) for tag_name in global_tag_list_sorted
                ]
        return result

    def similarity(self, other: WindowState) -> float:
        if not isinstance(other, ActionSetWithExecutionTimesState):
            return 0
        if not self.sim_dic.__contains__(other):
            vector_self = self.convert_action_to_vector(self.get_action_list())
            vector_other = self.convert_action_to_vector(other.get_action_list())
            redirect_similarity = 0 if not vector_self.get('redirect') or not vector_other.get('redirect') \
                else float(self.cosine_similarity(vector_self['redirect'], vector_other['redirect']))
            submit_similarity = 0 if not vector_self.get('submit') or not vector_other.get('submit') \
                else float(self.cosine_similarity(vector_self['submit'], vector_other['submit']))

            default_similarity = 0 if not vector_self.get('default') or not vector_other.get('default') \
                else float(self.cosine_similarity(vector_self['default'], vector_other['default']))

            weights = {
                'redirect': 0.5,  # URL 重定向的权重最大  这里是需要记录网页中url出现的次数 感觉有点不太现实
                'submit': 0.3,  # Form 提交的权重适中  这里是表单事件，提交之类的
                'default': 0.2  # JavaScript 事件的权重最小  应该就是我们通俗意义上的action
            }
            overall_similarity = float(weights['redirect'] * redirect_similarity +
                                  weights['submit'] * submit_similarity +
                                  weights['default'] * default_similarity)
            self.sim_dic[other] = overall_similarity
            other.sim_dic[other] = overall_similarity
        return self.sim_dic[other]

    def __eq__(self, other: object) -> bool:
        if isinstance(other, ActionSetWithExecutionTimesState):
            return (self.action_dict.keys() == other.action_dict.keys()) and (self.url == other.url)
        return False

    def __hash__(self) -> int:
        hash_value = 0
        for action in self.action_dict.keys():
            hash_value += hash(action)
        hash_value += hash(self.url)
        return hash_value

    def __lt__(self, other: object) -> bool:
        if isinstance(other, ActionSetWithExecutionTimesState):
            return hash(self) < hash(other)
        else:
            return type(self).__name__ < type(other).__name__

    def __str__(self) -> str:
        return f"ActionSetWithExecutionTimesState(action_number={len(self.action_dict)}, action_execution_time_histogram={self.action_execution_time_histogram}, url={self.url})"
