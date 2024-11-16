import argparse


class CliOptions:
    def __init__(self) -> None:
        self.parser = argparse.ArgumentParser(description="A web test tool")
        self.parser.add_argument("--output", type=str, default=None,
                                 help="output path, default=<default_output_path> in settings file")
        self.parser.add_argument("--model_path", type=str, default=None,
                                 help="model save path, default=<default_model_path> in settings file")
        self.parser.add_argument("--session", type=str, default=None,
                                 help="session, default=<default_session> in settings file")
        self.parser.add_argument("--restart_interval", type=int, default=None,
                                 help="restart_interval, default=<default_restart_interval> in settings file")
        self.parser.add_argument("--continuous_restart_threshold", type=int, default=None,
                                 help="continuous_restart_threshold, default=<default_continuous_restart_threshold> "
                                      "in settings file")
        self.parser.add_argument("--enable_screen_shot", type=bool, default=None,
                                 help="enable_screen_shot, default=<default_enable_screen_shot> in settings file")
        self.parser.add_argument("--settings", type=str, default="settings.yaml",
                                 help="path of settings file, default=%(default)s")
        self.parser.add_argument("--profile", type=str, default=None,
                                 help="profile to run, default=<default_profile> in settings file")

        self.parser.add_argument("--gamma", type=float, default=None,
                                 help="parameter gamma for the drl agent or q learning agent")
        self.parser.add_argument("--max_random", type=float, default=None,
                                 help="parameter max_random for the drl agent or q learning agent")
        self.parser.add_argument("--min_random", type=float, default=None,
                                 help="parameter min_random for the drl agent or q learning agent")

        self.parser.add_argument("--model_module", type=str, default=None,
                                 help="parameter model_module for the drl agent")
        self.parser.add_argument("--model_class", type=str, default=None,
                                 help="parameter model_class for the drl agent")
        self.parser.add_argument("--model_load_type", type=str, default=None, help="load or new a model")
        self.parser.add_argument("--model_load_name", type=str, default=None, help="which model to load")
        self.parser.add_argument("--transformer_module", type=str, default=None,
                                 help="parameter transformer_module for the drl agent")
        self.parser.add_argument("--transformer_class", type=str, default=None,
                                 help="parameter transformer_class for the drl agent")
        self.parser.add_argument("--reward_function", type=str, default=None,
                                 help="parameter reward_function for the drl agent")
        self.parser.add_argument("--stop_update", type=bool, default=None,
                                 help="parameter stop_update for the drl agent")
        self.parser.add_argument("--batch_size", type=int, default=None, help="parameter batch_size for the drl agent")
        self.parser.add_argument("--learning_rate", type=float, default=None,
                                 help="parameter learning_rate for the drl agent")

        self.parser.add_argument("--agent_type", type=str, default=None,
                                 help="parameter agent_type for the q learning agent")
        self.parser.add_argument("--alpha", type=float, default=None, help="parameter alpha for the q learning agent")
        self.parser.add_argument("--epsilon", type=float, default=None,
                                 help="parameter epsilon for the q learning agent")
        self.parser.add_argument("--initial_q_value", type=float, default=None,
                                 help="parameter initial_q_value for the q learning agent")
        self.parser.add_argument("--r_reward", type=float, default=None,
                                 help="parameter r_reward for the q learning agent")
        self.parser.add_argument("--r_penalty", type=float, default=None,
                                 help="parameter r_penalty for the q learning agent")
        self.parser.add_argument("--max_sim_line", type=float, default=None,
                                 help="parameter max_sim_line for the q learning agent")
        self.output = None
        self.model_path = None
        self.restart_interval = None
        self.continuous_restart_threshold = None
        self.enable_screen_shot = None
        self.session = None
        self.settings = None
        self.profile = None

        self.gamma = None
        self.max_random =None
        self.min_random =None

        self.model_module = None
        self.model_class = None
        self.transformer_module = None
        self.transformer_class = None
        self.model_load_type = None
        self.model_load_name = None
        self.reward_function = None
        self.stop_update = None
        self.batch_size = None
        self.learning_rate = None

        self.agent_type = None
        self.alpha = None
        self.epsilon = None
        self.initial_q_value = None
        self.r_reward = None
        self.r_penalty = None
        self.max_sim_line = None

    def parse_args(self) -> None:
        args = self.parser.parse_args()
        self.output = args.output
        self.model_path = args.model_path
        self.restart_interval = args.restart_interval
        self.continuous_restart_threshold = args.continuous_restart_threshold
        self.enable_screen_shot = args.enable_screen_shot
        self.session = args.session
        self.settings = args.settings
        self.profile = args.profile

        self.gamma = args.gamma
        self.max_random = args.max_random
        self.min_random = args.min_random

        self.model_module = args.model_module
        self.model_class = args.model_class
        self.model_load_type = args.model_load_type
        self.model_load_name = args.model_load_name
        self.transformer_module = args.transformer_module
        self.transformer_class = args.transformer_class
        self.reward_function = args.reward_function
        self.stop_update = args.stop_update
        self.batch_size = args.batch_size
        self.learning_rate = args.learning_rate

        self.agent_type = args.agent_type
        self.alpha = args.alpha
        self.epsilon = args.epsilon
        self.initial_q_value = args.initial_q_value
        self.r_reward = args.r_reward
        self.r_penalty = args.r_penalty
        self.max_sim_line = args.max_sim_line


cli_options = CliOptions()
cli_options.parse_args()
