import base64
from collections import defaultdict

from openai import OpenAI, APITimeoutError

from action.impl.click_action import ClickAction
from action.window_action import WindowAction
from agent.agent import Agent
from hmdriver2.driver import Driver
from hmdriver2.utils import parse_bounds
from state.window_state import WindowState

API_KEY = ""
TEMPERATURE = 0.8
# MAX_TOKENS = 1000
FREQUENCY_PENALTY = 1.5
PRESENCE_PENALTY = 1.5


class ChatgptAgent(Agent):
    def __init__(self, d: Driver, app: str):
        super().__init__()
        self.d = d
        self.app = app
        self.state_repr_list: list[str] = list()
        self.page_path_count: dict[int, int] = dict()
        self.state_count = defaultdict(int)
        self.previous_state: int | None = None
        self.client = OpenAI(
            # defaults to os.environ.get("OPENAI_API_KEY")
            api_key=API_KEY,
            base_url="https://api.chatanywhere.tech/v1"
            # base_url="https://api.chatanywhere.org/v1"
        )
        self.prompt = []
        self.initialize_chatgpt()

    def initialize_chatgpt(self):
        INITIAL_SYSTEM_PROMPT = (
            f"You are working as a HarmonyOS Next app tester and your task is to choose which clickable component to click on the page you are browsing in order to improve testing coverage. You are provided with a screenshot of the page you are browsing. You are viewing app: {self.app}. ")
        self.prompt += [
            {"role": "system", "content": INITIAL_SYSTEM_PROMPT}
        ]

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
        else:
            s_idx = self.state_repr_list.index(state_instance)
        return s_idx

    def generate_user_input(self, ability_name, page_name, component_tree):

        visual_information = f"You are provided with a screenshot of the page you are browsing. You are viewing app: {self.app}. The entire screen coordinate range of the phone spans from [0,0] to [1216,2688]. "

        global_context = f" The current UIAbility is {ability_name}. The current page is {page_name}. "

        local_context = f"You are provided with a component tree of the current page. The tree is in json format: {component_tree}."
        # local_context = ""

        output_structure = 'Your job is to choose only one coordinate to click in order to explore as many states as you can. So do not repeat the previous answer frequently. You should only return the bounds (e.g. [0,0]) of only one clickable component on the component tree without any explanation.'

        failure = "If there is no clickable component on the current page, please "

        pattern = visual_information + global_context + local_context + output_structure

        return pattern

    def get_action(self, window_state: WindowState, PTG: dict):
        image_path = "./screenshot.png"
        self.d.screenshot(image_path)

        # Function to encode the image
        def encode_image(image_path):
            with open(image_path, "rb") as image_file:
                return base64.b64encode(image_file.read()).decode('utf-8')

        # Getting the base64 string
        base64_image = encode_image(image_path)

        ability_name, page_name = self.d.get_ability_and_page()
        component_tree = self.d.dump_simple_hierarchy()
        # component_tree = None
        user_prompt = self.generate_user_input(ability_name, page_name, component_tree)

        question = {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": f"{user_prompt}",
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{base64_image}"
                    },
                },
            ],
        }
        self.prompt.append(question)

        while True:
            try:
                response = self.client.chat.completions.create(
                    model="gpt-4o",
                    messages=self.prompt,
                    temperature=TEMPERATURE,
                    frequency_penalty=FREQUENCY_PENALTY,
                    presence_penalty=PRESENCE_PENALTY,
                    timeout=5
                )
                break
            except APITimeoutError as e:
                self.prompt.pop(1)
                self.prompt.pop(1)

        result = response.choices[0].message.content
        print(result)

        self.prompt.append({"role": "assistant", "content": result})

        # bounds = parse_bounds(result)
        # center = bounds.get_center()
        bounds = result[1:len(result) - 1]
        x, y = bounds.split(",")
        x, y = int(x), int(y)
        return ClickAction(None, None, None, x, y)
