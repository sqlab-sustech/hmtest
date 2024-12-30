import base64
import random
import string
from collections import defaultdict

import openai
from openai import OpenAI, APITimeoutError

from action.window_action import WindowAction
from agent.agent import Agent
from hmdriver2.driver import Driver
from state.window_state import WindowState

API_KEY = ""
TEMPERATURE = 1.5
# MAX_TOKENS = 1000
FREQUENCY_PENALTY = 1.5
PRESENCE_PENALTY = 1.5
openai.api_key = API_KEY


class ChatgptAgent(Agent):
    def __init__(self, d: Driver):
        super().__init__(d, "", "", {}, False, None)
        self.d = d
        self.state_repr_list: list[str] = list()
        self.page_path_count: dict[int, int] = dict()
        self.state_count = defaultdict(int)
        self.previous_state: int | None = None
        self.client = OpenAI(
            # defaults to os.environ.get("OPENAI_API_KEY")
            api_key=API_KEY,
            base_url=""
        )
        self.prompt = []
        self.initialize_chatgpt()

    def update_state(self, chosen_action: WindowAction, window_state: WindowState) -> None:
        pass

    def initialize_chatgpt(self):
        # INITIAL_SYSTEM_PROMPT = f"You are working as a HarmonyOS Next app tester and your task is to choose which clickable component to click on the page you are browsing in order to improve testing coverage. You are provided with a screenshot of the page you are browsing. You are viewing app: {self.app}. "
        INITIAL_SYSTEM_PROMPT = f"You are working as a HarmonyOS Next app tester and your task is to generate appropriate input texts. You are provided with a screenshot of the page you are browsing."
        self.prompt += [
            {"role": "system", "content": INITIAL_SYSTEM_PROMPT}
        ]

    def generate_user_input(self, ability_name, page_name, component_tree):
        visual_information = f"You are provided with a screenshot of the page you are browsing. You are viewing app: {self.app}. The entire screen coordinate range of the phone spans from [0,0] to [1216,2688]. "

        global_context = f" The current UIAbility is {ability_name}. The current page is {page_name}. "

        local_context = f"You are provided with a component tree of the current page. The tree is in json format: {component_tree}."
        # local_context = ""

        output_structure = 'Your job is to choose only one coordinate to click in order to explore as many states as you can. So do not repeat the previous answer frequently. You should only return the bounds (e.g. [0,0]) of only one clickable component on the component tree without any explanation.'

        failure = "If there is no clickable component on the current page, please "

        pattern = visual_information + global_context + local_context + output_structure

        return pattern

    def get_action(self, window_state: WindowState):
        pass
        # image_path = "./screenshot.png"
        # self.d.screenshot(image_path)
        #
        # # Function to encode the image
        # def encode_image(image_path):
        #     with open(image_path, "rb") as image_file:
        #         return base64.b64encode(image_file.read()).decode('utf-8')
        #
        # # Getting the base64 string
        # base64_image = encode_image(image_path)
        #
        # ability_name, page_name = self.d.get_ability_and_page()
        # component_tree = self.d.dump_simple_hierarchy()
        # # component_tree = None
        # user_prompt = self.generate_user_input(ability_name, page_name, component_tree)
        #
        # question = {
        #     "role": "user",
        #     "content": [
        #         {
        #             "type": "text",
        #             "text": f"{user_prompt}",
        #         },
        #         {
        #             "type": "image_url",
        #             "image_url": {
        #                 "url": f"data:image/jpeg;base64,{base64_image}"
        #             },
        #         },
        #     ],
        # }
        # self.prompt.append(question)
        #
        # while True:
        #     try:
        #         response = self.client.chat.completions.create(
        #             model="gpt-4o",
        #             messages=self.prompt,
        #             temperature=TEMPERATURE,
        #             frequency_penalty=FREQUENCY_PENALTY,
        #             presence_penalty=PRESENCE_PENALTY,
        #             timeout=5
        #         )
        #         break
        #     except APITimeoutError as e:
        #         self.prompt.pop(1)
        #         self.prompt.pop(1)
        #
        # result = response.choices[0].message.content
        # print(result)
        #
        # self.prompt.append({"role": "assistant", "content": result})
        #
        # # bounds = parse_bounds(result)
        # # center = bounds.get_center()
        # bounds = result[1:len(result) - 1]
        # x, y = bounds.split(",")
        # x, y = int(x), int(y)
        # return ClickAction(None, None, x, y, ability_name, page_name)

    def generate_text_input(self):
        image_path = "./screenshot.png"
        self.d.screenshot(image_path)

        # Function to encode the image
        def encode_image(image_path):
            with open(image_path, "rb") as image_file:
                return base64.b64encode(image_file.read()).decode('utf-8')

        # Getting the base64 string
        base64_image = encode_image(image_path)

        user_prompt = "You are given a screenshot of the page you are browsing, with the cursor focused on a specific input field. Your task is to generate appropriate content for this field. Please return five different the generated input texts separated by commas(,) without adding extra spaces around the semicolons and any explanations."
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
        response = None
        try:
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=self.prompt,
                temperature=TEMPERATURE,
                frequency_penalty=FREQUENCY_PENALTY,
                presence_penalty=PRESENCE_PENALTY,
                timeout=5,
                top_p=1.0,
                # n=5
            )
            # response = openai.chat.completions.create(
            #     model="gpt-4o",
            #     messages=self.prompt,
            #     temperature=TEMPERATURE,
            #     frequency_penalty=FREQUENCY_PENALTY,
            #     presence_penalty=PRESENCE_PENALTY,
            #     timeout=5,
            #     top_p=1.0,
            #     n=5
            # )
        except Exception as e:
            print(e)
            pass
        result = None
        if response:
            # outputs = [choice.message.content for choice in response.choices]
            s = response.choices[0].message.content
            outputs = s.split(",")
            print("Text inputs: ", outputs)
            result = random.choice(list(set(outputs)))
        if result is None:
            input_length = random.randint(1, 10)
            characters = string.ascii_letters + string.digits
            result = ''.join(random.choice(characters) for _ in range(input_length))
        return result
